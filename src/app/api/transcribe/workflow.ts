import { NextRequest, NextResponse } from "next/server";
import { uploadAudio, supabase, supabaseAdmin } from "@/lib/supabase";
import { transcribeAudio } from "@/lib/riva";

const MAX_AUDIO_UPLOAD_BYTES = 75 * 1024 * 1024;
const MAX_AUDIO_UPLOAD_MB = Math.round(MAX_AUDIO_UPLOAD_BYTES / (1024 * 1024));
const TRANSCRIBE_MODEL = "nvidia/parakeet-rnnt-1.1b";

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
): Promise<StepResult<string>> {
    LOG("nvidia", "Sending audio to NVIDIA Parakeet via gRPC...");
    const transcribeStartMs = Date.now();

    try {
        const transcriptionText = await transcribeAudio(
            uploaded.audioBuffer,
            nvidiaApiKey,
            uploaded.file.type || "audio/webm",
            { priority: "final" }
        );

        LOG("nvidia", "Transcription result", transcriptionText);
        LOG("timing", "Transcription ms", Date.now() - transcribeStartMs);
        return ok(transcriptionText);
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
    url: string
): JsonResponse {
    return NextResponse.json({
        success: true,
        id,
        text,
        url,
        modelUsed: TRANSCRIBE_MODEL,
    });
}

export async function persistMemo(
    uploaded: UploadedAudio,
    transcriptionText: string,
    userId: string,
    startedAtMs: number
): Promise<JsonResponse> {
    LOG("db", uploaded.memoId ? "Updating existing memo row..." : "Inserting into memos table...");

    try {
        if (uploaded.memoId) {
            const { data: updatedMemo, error: updateError } = await supabaseAdmin
                .from("memos")
                .update({
                    title: uploaded.file.name || "Voice Memo",
                    transcript: transcriptionText,
                    audio_url: uploaded.fileUrl,
                })
                .eq("id", uploaded.memoId)
                .eq("user_id", userId)
                .select("id")
                .maybeSingle();

            if (!updateError && updatedMemo?.id) {
                LOG("db", "Updated existing memo row", { id: updatedMemo.id });
                LOG("timing", "Total request ms", Date.now() - startedAtMs);
                LOG("done", "Returning success response");
                return successResponse(updatedMemo.id, transcriptionText, uploaded.fileUrl);
            }

            LOG("db", "Live memo update failed, falling back to insert", {
                memoId: uploaded.memoId,
                error: updateError?.message ?? "memo not found",
            });
        }

        const { data: dbData, error: dbError } = await supabaseAdmin.from("memos").insert({
            title: uploaded.file.name || "Voice Memo",
            transcript: transcriptionText,
            audio_url: uploaded.fileUrl,
            user_id: userId,
        }).select();

        if (dbError) {
            ERR("db", "DB insert error", dbError);
            return NextResponse.json(
                { error: "Failed to save memo", detail: dbError.message },
                { status: 500 }
            );
        }

        const insertedId = dbData?.[0]?.id as string | undefined;
        if (!insertedId) {
            ERR("db", "Insert returned no ID", dbData);
            return NextResponse.json(
                { error: "Failed to save memo", detail: "No ID returned" },
                { status: 500 }
            );
        }

        LOG("db", "Inserted row", dbData);
        LOG("timing", "Total request ms", Date.now() - startedAtMs);
        LOG("done", "Returning success response");
        return successResponse(insertedId, transcriptionText, uploaded.fileUrl);
    } catch (dbError) {
        ERR("db", "Unexpected DB error", dbError);
        return NextResponse.json(
            { error: "Failed to save memo", detail: String(dbError) },
            { status: 500 }
        );
    }
}
