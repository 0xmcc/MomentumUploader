import { NextRequest, NextResponse } from "next/server";
import { uploadAudio, supabase } from "@/lib/supabase";
import { transcribeAudio } from "@/lib/riva";
import type { TranscriptSegment } from "@/lib/transcript";
import {
    asRecord,
    ERR,
    fail,
    LOG,
    MAX_AUDIO_UPLOAD_BYTES,
    MAX_AUDIO_UPLOAD_MB,
    MIN_SUPABASE_SOCKET_SIZE_CAP_BYTES,
    ok,
    pickNumber,
    pickNumberOrString,
    pickString,
    readErrorMessage,
    type ParsedUpload,
    type StepResult,
    type UploadedAudio,
} from "./workflow.shared";

function isPayloadTooLargeError(error: unknown): boolean {
    const msg = readErrorMessage(error).toLowerCase();
    return [
        "body exceeded",
        "payload too large",
        "entity too large",
        "request body larger than",
    ].some((needle) => msg.includes(needle));
}

function normalizeUploadContentType(
    mimeType: string | undefined,
    fileName: string | undefined
): string {
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

function tooLargeBodyResponse() {
    return NextResponse.json(
        {
            error: "Audio file too large",
            detail: `Please keep uploads under ${MAX_AUDIO_UPLOAD_MB}MB.`,
        },
        { status: 413 }
    );
}

type UploadNetworkCause = {
    causeCode?: string;
    causeMessage?: string;
    socketBytesWritten?: number;
    socketBytesRead?: number;
};

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

    const closedByPeer = (causeMessage ?? "")
        .toLowerCase()
        .includes("other side closed");
    const plausiblyAtSupabaseCap =
        fileSizeBytes >= MIN_SUPABASE_SOCKET_SIZE_CAP_BYTES;
    const nearFullWrite =
        typeof socketBytesWritten === "number" &&
        fileSizeBytes > 0 &&
        socketBytesWritten >= Math.floor(fileSizeBytes * 0.95);

    return closedByPeer && plausiblyAtSupabaseCap && nearFullWrite;
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
    const provisionalTranscriptValue = formData.get("provisionalTranscript");
    const provisionalTranscript =
        typeof provisionalTranscriptValue === "string" &&
        provisionalTranscriptValue.trim().length > 0
            ? provisionalTranscriptValue.trim()
            : null;
    const file = formData.get("file") as File | null;

    if (!file) {
        ERR("parse", "No file in formData", null);
        return fail(NextResponse.json({ error: "No audio file provided" }, { status: 400 }));
    }

    LOG(
        "parse",
        `File received: name=${file.name}, size=${file.size} bytes, type=${file.type}`
    );

    if (file.size > MAX_AUDIO_UPLOAD_BYTES) {
        return fail(tooLargeBodyResponse());
    }

    const fileName = `${Date.now()}_${file.name || "audio.webm"}`;
    const audioBuffer = Buffer.from(await file.arrayBuffer());
    const uploadContentType = normalizeUploadContentType(file.type, file.name);

    return ok({
        memoId,
        provisionalTranscript,
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
        const uploadResult = await uploadAudio(
            parsed.audioBuffer,
            parsed.fileName,
            parsed.uploadContentType
        );
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
                {
                    error: "Failed to upload file to Supabase",
                    detail: String(uploadError),
                },
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
