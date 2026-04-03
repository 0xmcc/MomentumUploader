import { NextRequest, NextResponse } from "next/server";
import { resolveMemoUserId } from "@/lib/memo-api-auth";
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
};

type ChunkBatch = {
    name: string;
    startIndex: number;
    endIndex: number;
};

function withCors(response: NextResponse) {
    if (typeof response.headers?.set === "function") {
        Object.entries(CORS).forEach(([key, value]) => {
            response.headers.set(key, value);
        });
    }
    return response;
}

function parseChunkBatch(name: string): ChunkBatch | null {
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

        if (!memoId || totalChunks == null) {
            return withCors(
                NextResponse.json({ error: "Invalid finalize payload" }, { status: 400 })
            );
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
            .map((entry) => parseChunkBatch(entry.name))
            .filter((entry): entry is ChunkBatch => entry !== null)
            .sort((left, right) => left.startIndex - right.startIndex);
        const continuityError = validateChunkContinuity(chunkBatches, totalChunks);
        if (continuityError) {
            return withCors(
                NextResponse.json({ error: continuityError }, { status: 409 })
            );
        }

        const buffers: Buffer[] = [];
        const chunkPaths = chunkBatches.map((batch) => `${chunkPrefix}/${batch.name}`);

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

        const finalizeFromTranscript = async (transcript: string) => {
            await promoteLiveSegmentsToFinal(resolvedMemoId, userId);
            return updateMemoFinal(
                resolvedMemoId,
                transcript,
                [],
                fileUrl,
                userId,
                startedAtMs,
            );
        };

        let response: NextResponse;
        if (provisionalTranscript) {
            response = await finalizeFromTranscript(provisionalTranscript);
        } else {
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

            if (!transcription.ok) {
                response = await updateMemoFailed(
                    resolvedMemoId,
                    fileUrl,
                    userId,
                    startedAtMs,
                );
            } else {
                response = await updateMemoFinal(
                    resolvedMemoId,
                    transcription.data.transcript,
                    transcription.data.segments,
                    fileUrl,
                    userId,
                    startedAtMs,
                );
            }
        }

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
