import { NextRequest, NextResponse } from "next/server";
import { resolveMemoUserId } from "@/lib/memo-api-auth";
import {
    enqueueTranscriptionJob,
    shouldQueueTranscription,
} from "@/lib/transcription-queue";
import { supabase, supabaseAdmin, uploadAudio } from "@/lib/supabase";
import {
    ERR,
    LOG,
    persistMemoProvisional,
    promoteLiveSegmentsToFinal,
    transcribeUploadedAudio,
    updateMemoFailed,
    updateMemoFinal,
} from "../workflow";

const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const CHUNK_FILE_NAME = /^(\d{7})-(\d{7})\.webm$/;

type FinalizeRequestBody = {
    memoId?: unknown;
    totalChunks?: unknown;
    provisionalTranscript?: unknown;
    uploadContentType?: unknown;
    uploadFileExtension?: unknown;
    durationSeconds?: unknown;
};

type ChunkBatch = {
    name: string;
    startIndex: number;
    endIndex: number;
    sizeBytes: number;
};

function withCors(response: NextResponse) {
    if (typeof response.headers?.set === "function") {
        Object.entries(CORS).forEach(([key, value]) => {
            response.headers.set(key, value);
        });
    }
    return response;
}

function readChunkSize(entry: { metadata?: unknown }): number {
    const metadata = entry.metadata;
    if (metadata && typeof metadata === "object" && "size" in metadata) {
        const size = (metadata as { size?: unknown }).size;
        if (typeof size === "number" && Number.isFinite(size) && size > 0) {
            return size;
        }
    }
    return 0;
}

function parseChunkBatch(name: string, sizeBytes = 0): ChunkBatch | null {
    const match = CHUNK_FILE_NAME.exec(name);
    if (!match) return null;

    const startIndex = Number.parseInt(match[1] ?? "", 10);
    const endIndex = Number.parseInt(match[2] ?? "", 10);
    if (!Number.isInteger(startIndex) || !Number.isInteger(endIndex) || endIndex <= startIndex) {
        return null;
    }

    return {
        name,
        startIndex,
        endIndex,
        sizeBytes,
    };
}

function readMemoId(value: unknown): string | null {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readTotalChunks(value: unknown): number | null {
    return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

function readProvisionalTranscript(value: unknown): string | null {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readUploadContentType(value: unknown): string | null {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readDurationSeconds(value: unknown): number {
    return typeof value === "number" && Number.isFinite(value) && value > 0
        ? value
        : 0;
}

function isDuplicateJobError(error: unknown): boolean {
    // job_runs has a unique index on one active job per (entity, type). A
    // second finalize for the same memo means it is already queued, which is
    // the state the caller wanted.
    const record =
        error && typeof error === "object" ? (error as Record<string, unknown>) : null;
    const code = typeof record?.code === "string" ? record.code : "";
    const message =
        typeof record?.message === "string" ? record.message.toLowerCase() : "";
    return code === "23505" || message.includes("duplicate key");
}

function readUploadFileExtension(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim().toLowerCase();
    if (!/^[a-z0-9]+$/.test(trimmed)) return null;
    return trimmed;
}

function validateChunkContinuity(batches: ChunkBatch[], totalChunks: number) {
    if (batches.length === 0) {
        return "No uploaded audio chunks were found.";
    }
    if (batches[0]?.startIndex !== 0) {
        return `Chunk upload is missing the opening range starting at 0.`;
    }

    for (let index = 0; index < batches.length - 1; index += 1) {
        const current = batches[index];
        const next = batches[index + 1];
        if (current && next && current.endIndex !== next.startIndex) {
            return `Chunk upload has a gap between ${current.endIndex} and ${next.startIndex}.`;
        }
    }

    if (batches.at(-1)?.endIndex !== totalChunks) {
        return `Chunk upload ended at ${batches.at(-1)?.endIndex ?? 0}, expected ${totalChunks}.`;
    }

    return null;
}

async function deleteChunkFiles(chunkPaths: string[]) {
    if (chunkPaths.length === 0) return;

    const { error } = await supabaseAdmin.storage.from("voice-memos").remove(chunkPaths);
    if (error) {
        ERR("storage", "Chunk cleanup failed", error);
    }
}

export async function OPTIONS() {
    return withCors(new NextResponse(null, { status: 204 }));
}

export async function POST(req: NextRequest) {
    const startedAtMs = Date.now();
    const userId = await resolveMemoUserId(req);
    if (!userId) {
        return withCors(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    }

    try {
        const body = (await req.json()) as FinalizeRequestBody;
        const memoId = readMemoId(body.memoId);
        const totalChunks = readTotalChunks(body.totalChunks);
        const provisionalTranscript = readProvisionalTranscript(body.provisionalTranscript);
        const uploadContentType = readUploadContentType(body.uploadContentType) ?? "audio/webm";
        const uploadFileExtension = readUploadFileExtension(body.uploadFileExtension) ?? "webm";
        const durationSeconds = readDurationSeconds(body.durationSeconds);

        if (!memoId || totalChunks == null) {
            return withCors(
                NextResponse.json({ error: "Invalid finalize payload" }, { status: 400 })
            );
        }

        if (provisionalTranscript) {
            await promoteLiveSegmentsToFinal(memoId, userId);
            const response = await updateMemoFinal(
                memoId,
                provisionalTranscript,
                [],
                null,
                userId,
                startedAtMs,
            );

            LOG("done", "Finalize completed from provisional transcript", { memoId });
            return withCors(response);
        }

        const chunkPrefix = `audio/chunks/${memoId}`;
        const storage = supabaseAdmin.storage.from("voice-memos");
        const { data: listedChunks, error: listError } = await storage.list(chunkPrefix, {
            limit: 1000,
            sortBy: { column: "name", order: "asc" },
        });

        if (listError) {
            ERR("storage", "Chunk listing failed", listError);
            return withCors(
                NextResponse.json({ error: "Failed to read uploaded chunks" }, { status: 500 })
            );
        }

        const chunkBatches = (listedChunks ?? [])
            .map((entry) => parseChunkBatch(entry.name, readChunkSize(entry)))
            .filter((entry): entry is ChunkBatch => entry !== null)
            .sort((left, right) => left.startIndex - right.startIndex);
        const continuityError = validateChunkContinuity(chunkBatches, totalChunks);
        if (continuityError) {
            return withCors(
                NextResponse.json({ error: continuityError }, { status: 409 })
            );
        }

        const chunkPaths = chunkBatches.map((batch) => `${chunkPrefix}/${batch.name}`);
        const uploadedBytes = chunkBatches.reduce(
            (total, batch) => total + batch.sizeBytes,
            0
        );

        // Anything that cannot be trusted to finish inside this request goes to
        // the worker. A 1h42m recording once sat on "Transcribing…" forever
        // because this route held the whole transcription itself.
        if (shouldQueueTranscription({ durationSeconds, fileSizeBytes: uploadedBytes })) {
            const provisional = await persistMemoProvisional(memoId, null, userId);
            if (!provisional.ok) {
                return withCors(provisional.response);
            }

            const queuedMemoId = provisional.data.memoId;

            try {
                await enqueueTranscriptionJob(queuedMemoId, userId, supabaseAdmin, {
                    chunk_paths: chunkPaths,
                    upload_content_type: uploadContentType,
                    upload_file_extension: uploadFileExtension,
                    duration_seconds: durationSeconds,
                });
            } catch (queueError) {
                if (!isDuplicateJobError(queueError)) {
                    ERR("queue", "Could not queue transcription", queueError);
                    return withCors(
                        NextResponse.json(
                            {
                                error: "Failed to queue transcription",
                                detail:
                                    queueError instanceof Error
                                        ? queueError.message
                                        : String(queueError),
                            },
                            { status: 500 }
                        )
                    );
                }
                LOG("queue", "Transcription was already queued", { memoId: queuedMemoId });
            }

            // The chunks stay: the worker joins them into the audio object.
            LOG("done", "Finalize queued transcription", {
                memoId: queuedMemoId,
                chunks: chunkPaths.length,
                bytes: uploadedBytes,
                durationSeconds,
            });

            return withCors(
                NextResponse.json(
                    {
                        success: true,
                        id: queuedMemoId,
                        queued: true,
                        transcriptStatus: "processing",
                    },
                    { status: 202 }
                )
            );
        }

        const buffers: Buffer[] = [];

        for (const chunkPath of chunkPaths) {
            const { data, error } = await storage.download(chunkPath);
            if (error || !data) {
                ERR("storage", "Chunk download failed", { chunkPath, error });
                return withCors(
                    NextResponse.json({ error: "Failed to download uploaded chunks" }, { status: 500 })
                );
            }

            buffers.push(Buffer.from(await data.arrayBuffer()));
        }

        const audioBuffer = Buffer.concat(buffers);
        const fileName = `${Date.now()}_${memoId}.${uploadFileExtension}`;
        await uploadAudio(audioBuffer, fileName, uploadContentType);
        const {
            data: { publicUrl: fileUrl },
        } = supabase.storage.from("voice-memos").getPublicUrl(`audio/${fileName}`);

        const provisional = await persistMemoProvisional(memoId, fileUrl, userId);
        if (!provisional.ok) {
            return withCors(provisional.response);
        }

        const resolvedMemoId = provisional.data.memoId;

        const nvidiaApiKey = process.env.NVIDIA_API_KEY?.trim();
        if (!nvidiaApiKey) {
            return withCors(
                NextResponse.json(
                    {
                        error: "Transcription is not configured",
                        detail: "NVIDIA_API_KEY is not set on the server.",
                    },
                    { status: 500 }
                )
            );
        }

        const transcription = await transcribeUploadedAudio(
            {
                memoId: resolvedMemoId,
                provisionalTranscript,
                file: new File([audioBuffer], fileName, { type: uploadContentType }),
                fileName,
                audioBuffer,
                uploadContentType,
                fileUrl,
            },
            nvidiaApiKey
        );

        const response = !transcription.ok
            ? await updateMemoFailed(
                resolvedMemoId,
                fileUrl,
                userId,
                startedAtMs,
            )
            : await updateMemoFinal(
                resolvedMemoId,
                transcription.data.transcript,
                transcription.data.segments,
                fileUrl,
                userId,
                startedAtMs,
            );

        void deleteChunkFiles(chunkPaths);

        LOG("done", "Finalize completed", { memoId: resolvedMemoId });
        return withCors(response);
    } catch (error) {
        ERR("catch", "Unhandled finalize error", error);
        return withCors(
            NextResponse.json({ error: "Failed to finalize audio" }, { status: 500 })
        );
    }
}
