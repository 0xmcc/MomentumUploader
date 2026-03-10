import { NextRequest, NextResponse } from "next/server";
import { uploadAudio, supabase, supabaseAdmin } from "@/lib/supabase";
import { transcribeAudio } from "@/lib/riva";
import { FAILED_TRANSCRIPT } from "@/lib/memo-ui";
import type { TranscriptSegment } from "@/lib/transcript";
import { isMissingColumnError } from "@/lib/supabase-compat";
import { generateMemoTitle } from "@/lib/memo-title";

const MAX_AUDIO_UPLOAD_BYTES = 75 * 1024 * 1024;
const MAX_AUDIO_UPLOAD_MB = Math.round(MAX_AUDIO_UPLOAD_BYTES / (1024 * 1024));
const TRANSCRIBE_MODEL = "nvidia/parakeet-rnnt-1.1b";
const PROVISIONAL_MEMO_TITLE = "Voice Memo";

type JsonResponse = ReturnType<typeof NextResponse.json>;
export type StepResult<T> =
    | { ok: true; data: T }
    | { ok: false; response: JsonResponse };

type ParsedUpload = {
    memoId: string | null;
    file: File;
    fileName: string;
    audioBuffer: Buffer;
    uploadContentType: string;
};

type UploadedAudio = ParsedUpload & {
    fileUrl: string;
};

function ok<T>(data: T): StepResult<T> {
    return { ok: true, data };
}

function fail<T>(response: JsonResponse): StepResult<T> {
    return { ok: false, response };
}

function readErrorMessage(error: unknown): string {
    if (typeof error === "string") return error;
    if (error && typeof error === "object") {
        const maybeMessage = (error as { message?: unknown }).message;
        if (typeof maybeMessage === "string") return maybeMessage;
    }
    return "";
}

function isPayloadTooLargeError(error: unknown): boolean {
    const msg = readErrorMessage(error).toLowerCase();
    return [
        "body exceeded",
        "payload too large",
        "entity too large",
        "request body larger than",
    ].some((needle) => msg.includes(needle));
}

function normalizeUploadContentType(mimeType: string | undefined, fileName: string | undefined): string {
    const normalized = (mimeType ?? "").toLowerCase();
    const normalizedName = (fileName ?? "").toLowerCase();

    if (
        normalized.includes("m4a") ||
        normalized.includes("mp4") ||
        normalizedName.endsWith(".m4a") ||
        normalizedName.endsWith(".mp4")
    ) {
        return "audio/mp4";
    }
    if (
        normalized.includes("mpeg") ||
        normalized.includes("mp3") ||
        normalizedName.endsWith(".mp3")
    ) {
        return "audio/mpeg";
    }
    if (normalized.includes("ogg") || normalizedName.endsWith(".ogg")) {
        return "audio/ogg";
    }
    if (normalized.includes("wav") || normalizedName.endsWith(".wav")) {
        return "audio/wav";
    }

    if (normalized && normalized !== "application/octet-stream") {
        return mimeType!;
    }
    return "audio/webm";
}

function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object"
        ? (value as Record<string, unknown>)
        : null;
}

function pickString(obj: Record<string, unknown> | null, key: string): string | undefined {
    const value = obj?.[key];
    return typeof value === "string" ? value : undefined;
}

function pickNumber(obj: Record<string, unknown> | null, key: string): number | undefined {
    const value = obj?.[key];
    return typeof value === "number" ? value : undefined;
}

function pickNumberOrString(
    obj: Record<string, unknown> | null,
    key: string
): number | string | undefined {
    const value = obj?.[key];
    return typeof value === "number" || typeof value === "string"
        ? value
        : undefined;
}

function isSupabaseStorageTooLargeError(error: unknown): boolean {
    const errorRecord = asRecord(error);
    const status = pickNumberOrString(errorRecord, "status");
    const statusCode = pickNumberOrString(errorRecord, "statusCode");
    const namespace = pickString(errorRecord, "namespace");
    const message = readErrorMessage(error).toLowerCase();

    return (
        namespace === "storage" &&
        (
            status === 413 ||
            status === "413" ||
            statusCode === 413 ||
            statusCode === "413" ||
            message.includes("maximum allowed size") ||
            message.includes("object exceeded")
        )
    );
}

type UploadNetworkCause = {
    causeCode?: string;
    causeMessage?: string;
    socketBytesWritten?: number;
    socketBytesRead?: number;
};

function extractUploadNetworkCause(error: unknown): UploadNetworkCause {
    const uploadErrorRecord = asRecord(error);
    const originalErrorRecord = asRecord(uploadErrorRecord?.originalError);
    const causeRecord =
        asRecord(originalErrorRecord?.cause) ??
        asRecord(uploadErrorRecord?.cause);
    const socketRecord = asRecord(causeRecord?.socket);

    return {
        causeCode: pickString(causeRecord, "code"),
        causeMessage: pickString(causeRecord, "message"),
        socketBytesWritten: pickNumber(socketRecord, "bytesWritten"),
        socketBytesRead: pickNumber(socketRecord, "bytesRead"),
    };
}

function isLikelySupabaseSocketSizeCapError(
    error: unknown,
    fileSizeBytes: number
): boolean {
    const uploadErrorRecord = asRecord(error);
    const namespace = pickString(uploadErrorRecord, "namespace");
    if (namespace !== "storage") return false;

    const { causeCode, causeMessage, socketBytesWritten } =
        extractUploadNetworkCause(error);
    if (causeCode !== "UND_ERR_SOCKET") return false;

    const closedByPeer = (causeMessage ?? "").toLowerCase().includes("other side closed");
    const nearFullWrite =
        typeof socketBytesWritten === "number" &&
        fileSizeBytes > 0 &&
        socketBytesWritten >= Math.floor(fileSizeBytes * 0.95);

    return closedByPeer && nearFullWrite;
}

export const LOG = (step: string, msg: string, data?: unknown) => {
    const prefix = `[transcribe/${step}]`;
    if (data !== undefined) {
        console.log(prefix, msg, JSON.stringify(data, null, 2));
    } else {
        console.log(prefix, msg);
    }
};

export const ERR = (step: string, msg: string, err: unknown) => {
    console.error(`[transcribe/${step}] ❌ ${msg}`, err);
};

function tooLargeBodyResponse() {
    return NextResponse.json(
        {
            error: "Audio file too large",
            detail: `Please keep uploads under ${MAX_AUDIO_UPLOAD_MB}MB.`,
        },
        { status: 413 }
    );
}

export async function parseUploadRequest(
    req: NextRequest,
    startedAtMs: number
): Promise<StepResult<ParsedUpload>> {
    let formData: FormData;
    try {
        formData = await req.formData();
    } catch (formDataError) {
        if (isPayloadTooLargeError(formDataError)) {
            ERR("parse", "Audio payload exceeds configured request limit", formDataError);
            return fail(tooLargeBodyResponse());
        }
        throw formDataError;
    }

    LOG("timing", "Parsed form data ms", Date.now() - startedAtMs);

    const memoIdValue = formData.get("memoId");
    const memoId =
        typeof memoIdValue === "string" && memoIdValue.trim().length > 0
            ? memoIdValue.trim()
            : null;
    const file = formData.get("file") as File | null;

    if (!file) {
        ERR("parse", "No file in formData", null);
        return fail(NextResponse.json({ error: "No audio file provided" }, { status: 400 }));
    }

    LOG("parse", `File received: name=${file.name}, size=${file.size} bytes, type=${file.type}`);

    if (file.size > MAX_AUDIO_UPLOAD_BYTES) {
        return fail(tooLargeBodyResponse());
    }

    const fileName = `${Date.now()}_${file.name || "audio.webm"}`;
    const audioBuffer = Buffer.from(await file.arrayBuffer());
    const uploadContentType = normalizeUploadContentType(file.type, file.name);

    return ok({
        memoId,
        file,
        fileName,
        audioBuffer,
        uploadContentType,
    });
}

export async function uploadAudioToStorage(
    parsed: ParsedUpload,
    startedAtMs: number
): Promise<StepResult<UploadedAudio>> {
    LOG("storage", `Uploading as: audio/${parsed.fileName}`);
    LOG("storage", `Audio buffer size: ${parsed.audioBuffer.byteLength} bytes`);

    try {
        const uploadResult = await uploadAudio(parsed.audioBuffer, parsed.fileName, parsed.uploadContentType);
        LOG("storage", "Upload result", uploadResult);

        const { data } = supabase.storage
            .from("voice-memos")
            .getPublicUrl(`audio/${parsed.fileName}`);
        const fileUrl = data.publicUrl;

        LOG("storage", "Public URL", fileUrl);
        LOG("timing", "Storage upload ms", Date.now() - startedAtMs);

        return ok({
            ...parsed,
            fileUrl,
        });
    } catch (uploadError) {
        const uploadErrorRecord = asRecord(uploadError);
        const originalErrorRecord = asRecord(uploadErrorRecord?.originalError);
        const nestedCauseRecord =
            asRecord(originalErrorRecord?.cause) ??
            asRecord(uploadErrorRecord?.cause);
        const nestedDiagnosticsSource =
            nestedCauseRecord ?? originalErrorRecord ?? uploadErrorRecord;
        const {
            causeCode,
            causeMessage,
            socketBytesRead,
            socketBytesWritten,
        } = extractUploadNetworkCause(uploadError);

        console.error("[transcribe/storage] ❌ Upload diagnostics", {
            fileName: parsed.file.name,
            fileType: parsed.file.type,
            fileSizeBytes: parsed.file.size,
            audioBufferSizeBytes: parsed.audioBuffer.byteLength,
            uploadObjectPath: `audio/${parsed.fileName}`,
            uploadContentType: parsed.uploadContentType,
            errorName:
                pickString(uploadErrorRecord, "name") ??
                (uploadError instanceof Error ? uploadError.name : undefined),
            errorMessage: readErrorMessage(uploadError),
            storageNamespace: pickString(uploadErrorRecord, "namespace"),
            storageStatus: pickNumberOrString(uploadErrorRecord, "status"),
            storageStatusCode: pickNumberOrString(uploadErrorRecord, "statusCode"),
            originalErrorName: pickString(originalErrorRecord, "name"),
            originalErrorMessage: pickString(originalErrorRecord, "message"),
            errorCode: causeCode ?? pickString(nestedDiagnosticsSource, "code"),
            errorErrno: pickNumber(nestedDiagnosticsSource, "errno"),
            errorSyscall: pickString(nestedDiagnosticsSource, "syscall"),
            causeMessage: causeMessage ?? pickString(nestedCauseRecord, "message"),
            socketBytesWritten,
            socketBytesRead,
        });

        if (
            isSupabaseStorageTooLargeError(uploadError) ||
            isLikelySupabaseSocketSizeCapError(uploadError, parsed.file.size)
        ) {
            return fail(
                NextResponse.json(
                    {
                        error: "Audio file too large for storage",
                        detail:
                            "This file exceeds your current Supabase upload cap (often bucket size limit or active spend cap). Upload a smaller file or disable spend cap / raise the bucket limit.",
                    },
                    { status: 413 }
                )
            );
        }

        ERR("storage", "Supabase upload failed", uploadError);
        return fail(
            NextResponse.json(
                { error: "Failed to upload file to Supabase", detail: String(uploadError) },
                { status: 500 }
            )
        );
    }
}

export async function transcribeUploadedAudio(
    uploaded: UploadedAudio,
    nvidiaApiKey: string
): Promise<StepResult<{ transcript: string; segments: TranscriptSegment[] }>> {
    LOG("nvidia", "Sending audio to NVIDIA Parakeet via gRPC...");
    const transcribeStartMs = Date.now();

    try {
        const result = await transcribeAudio(
            uploaded.audioBuffer,
            nvidiaApiKey,
            uploaded.file.type || "audio/webm",
            { priority: "final" }
        );

        LOG("nvidia", "Transcription result", result.transcript);
        LOG("timing", "Transcription ms", Date.now() - transcribeStartMs);
        return ok(result);
    } catch (transcriptionError) {
        ERR("nvidia", "Transcription failed", transcriptionError);
        return fail(
            NextResponse.json(
                {
                    error: "Failed to transcribe audio with NVIDIA",
                    detail:
                        readErrorMessage(transcriptionError) ||
                        "Upstream transcription service failed.",
                },
                { status: 502 }
            )
        );
    }
}

function successResponse(
    id: string,
    text: string,
    url: string,
    transcriptStatus: "complete" | "failed" = "complete"
): JsonResponse {
    return NextResponse.json({
        success: true,
        id,
        text,
        url,
        modelUsed: TRANSCRIBE_MODEL,
        transcriptStatus,
    });
}

/**
 * Stage A: Persist a memo row as soon as audio is stored in Supabase.
 * Creates a new row or updates the existing live memo row.
 * Sets transcript_status = 'processing' so the UI can show the memo immediately.
 * On DB error, retries once. Never deletes the uploaded audio.
 */
export async function persistMemoProvisional(
    memoId: string | null,
    audioUrl: string,
    userId: string
): Promise<StepResult<{ memoId: string }>> {
    LOG("db", memoId ? "Provisional update of existing memo..." : "Provisional insert into memos...");

    const tryUpsert = async (): Promise<StepResult<{ memoId: string }>> => {
        const updateExistingMemo = (includeTranscriptStatus: boolean) => {
            const payload: Record<string, unknown> = { audio_url: audioUrl };
            if (includeTranscriptStatus) {
                payload.transcript_status = "processing";
            }

            return supabaseAdmin
                .from("memos")
                .update(payload)
                .eq("id", memoId)
                .eq("user_id", userId)
                .select("id")
                .maybeSingle();
        };

        const insertMemo = (includeTranscriptStatus: boolean) => {
            const payload: Record<string, unknown> = {
                title: PROVISIONAL_MEMO_TITLE,
                transcript: "",
                audio_url: audioUrl,
                user_id: userId,
            };
            if (includeTranscriptStatus) {
                payload.transcript_status = "processing";
            }

            return supabaseAdmin
                .from("memos")
                .insert(payload)
                .select("id")
                .single();
        };

        if (memoId) {
            let { data: updatedMemo, error: updateError } = await updateExistingMemo(true);

            if (isMissingColumnError(updateError, "memos", "transcript_status")) {
                const legacyResult = await updateExistingMemo(false);
                updatedMemo = legacyResult.data;
                updateError = legacyResult.error;
            }

            if (!updateError && updatedMemo?.id) {
                LOG("db", "Provisional update succeeded", { id: updatedMemo.id });
                return ok({ memoId: updatedMemo.id });
            }

            LOG("db", "Provisional update found no row, falling back to insert", {
                memoId,
                error: updateError?.message ?? "memo not found",
            });
        }

        let { data: insertData, error: insertError } = await insertMemo(true);

        if (isMissingColumnError(insertError, "memos", "transcript_status")) {
            const legacyResult = await insertMemo(false);
            insertData = legacyResult.data;
            insertError = legacyResult.error;
        }

        if (insertError || !insertData?.id) {
            ERR("db", "Provisional insert failed", insertError);
            return fail(
                NextResponse.json(
                    { error: "Failed to save memo", detail: insertError?.message ?? "No ID returned" },
                    { status: 500 }
                )
            );
        }

        LOG("db", "Provisional insert succeeded", { id: insertData.id });
        return ok({ memoId: insertData.id });
    };

    try {
        const result = await tryUpsert();
        if (!result.ok) {
            LOG("db", "Provisional persist failed, retrying once...");
            return await tryUpsert();
        }
        return result;
    } catch (dbError) {
        ERR("db", "Provisional persist threw, retrying once...", dbError);
        try {
            return await tryUpsert();
        } catch (retryError) {
            ERR("db", "Provisional persist retry also threw", retryError);
            return fail(
                NextResponse.json(
                    { error: "Failed to save memo", detail: String(retryError) },
                    { status: 500 }
                )
            );
        }
    }
}

/**
 * Stage B (success): Write the final transcript and mark the memo complete.
 */
export async function updateMemoFinal(
    memoId: string,
    transcript: string,
    segments: TranscriptSegment[],
    audioUrl: string,
    userId: string,
    startedAtMs: number
): Promise<JsonResponse> {
    LOG("db", "Finalizing memo with transcript...");

    try {
        const updateFinalMemo = (includeTranscriptStatus: boolean) => {
            const payload: Record<string, unknown> = { transcript };
            if (includeTranscriptStatus) {
                payload.transcript_status = "complete";
            }

            return supabaseAdmin
                .from("memos")
                .update(payload)
                .eq("id", memoId)
                .eq("user_id", userId);
        };

        let { error } = await updateFinalMemo(true);

        if (isMissingColumnError(error, "memos", "transcript_status")) {
            const legacyResult = await updateFinalMemo(false);
            error = legacyResult.error;
        }

        if (error) {
            ERR("db", "Final transcript update failed", error);
            return NextResponse.json(
                { error: "Failed to save transcript", detail: error.message },
                { status: 500 }
            );
        }

        LOG("db", "Memo finalized", { id: memoId });

        // Generate AI title from transcript. Non-fatal: falls back to "Memo #N".
        try {
            const aiTitle = await generateMemoTitle(transcript, userId, supabaseAdmin);
            const { error: titleError } = await supabaseAdmin
                .from("memos")
                .update({ title: aiTitle })
                .eq("id", memoId)
                .eq("user_id", userId);
            if (titleError) {
                ERR("db", "Failed to save AI title", titleError);
            } else {
                LOG("db", "AI title saved", { id: memoId, title: aiTitle });
            }
        } catch (titleErr) {
            ERR("db", "AI title generation threw", titleErr);
        }

        // Insert timestamped segments. Non-fatal: if this fails the transcript
        // is already saved and the share page falls back to plain-text.
        if (segments.length > 0) {
            try {
                // Delete any previous segments first (idempotent on retry).
                const { error: deleteErr } = await supabaseAdmin
                    .from("memo_transcript_segments")
                    .delete()
                    .eq("memo_id", memoId)
                    .eq("source", "final");

                if (deleteErr) {
                    throw deleteErr;
                }

                const rows = segments.map((seg, i) => ({
                    memo_id: memoId,
                    user_id: userId,
                    segment_index: i,
                    start_ms: seg.startMs,
                    end_ms: seg.endMs,
                    text: seg.text,
                    source: "final" as const,
                }));

                const { error: segErr } = await supabaseAdmin
                    .from("memo_transcript_segments")
                    .insert(rows);

                if (segErr) {
                    throw segErr;
                }
            } catch (segmentError) {
                ERR("db", "Segment persistence failed — anchor timestamps unavailable for this memo", {
                    memoId,
                    segmentCount: segments.length,
                    error: readErrorMessage(segmentError) || String(segmentError),
                });
                // Do NOT rethrow — the transcript write already succeeded.
            }
        }

        LOG("timing", "Total request ms", Date.now() - startedAtMs);
        LOG("done", "Returning success response");

        return successResponse(memoId, transcript, audioUrl);
    } catch (dbError) {
        ERR("db", "Unexpected error finalizing memo", dbError);
        return NextResponse.json(
            { error: "Failed to save transcript", detail: String(dbError) },
            { status: 500 }
        );
    }
}

/**
 * Stage B (failure): Mark the memo as failed so the UI shows the correct state.
 * The audio_url remains intact — the recording is preserved.
 */
export async function updateMemoFailed(
    memoId: string,
    audioUrl: string,
    userId: string,
    startedAtMs: number
): Promise<JsonResponse> {
    LOG("db", "Marking memo as transcription-failed...");

    try {
        const updateFailedMemo = (includeTranscriptStatus: boolean) => {
            const payload: Record<string, unknown> = {
                transcript: FAILED_TRANSCRIPT,
            };
            if (includeTranscriptStatus) {
                payload.transcript_status = "failed";
            }

            return supabaseAdmin
                .from("memos")
                .update(payload)
                .eq("id", memoId)
                .eq("user_id", userId);
        };

        let { error } = await updateFailedMemo(true);

        if (isMissingColumnError(error, "memos", "transcript_status")) {
            const legacyResult = await updateFailedMemo(false);
            error = legacyResult.error;
        }

        if (error) {
            throw error;
        }
    } catch (dbError) {
        ERR("db", "Failed to mark memo as failed", dbError);
    }

    LOG("timing", "Total request ms", Date.now() - startedAtMs);
    return successResponse(memoId, FAILED_TRANSCRIPT, audioUrl, "failed");
}
