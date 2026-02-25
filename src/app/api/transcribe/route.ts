import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { uploadAudio, supabase, supabaseAdmin } from "@/lib/supabase";
import { transcribeAudio } from "@/lib/riva";

const MAX_AUDIO_UPLOAD_BYTES = 75 * 1024 * 1024;
const MAX_AUDIO_UPLOAD_MB = Math.round(MAX_AUDIO_UPLOAD_BYTES / (1024 * 1024));

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

const LOG = (step: string, msg: string, data?: unknown) => {
    const prefix = `[transcribe/${step}]`;
    if (data !== undefined) {
        console.log(prefix, msg, JSON.stringify(data, null, 2));
    } else {
        console.log(prefix, msg);
    }
};

const ERR = (step: string, msg: string, err: unknown) => {
    console.error(`[transcribe/${step}] ❌ ${msg}`, err);
};

export async function POST(req: NextRequest) {
    const startedAtMs = Date.now();
    LOG("init", "Request received");
    const { userId } = await auth();
    if (!userId) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const nvidiaApiKey = process.env.NVIDIA_API_KEY?.trim();
    if (!nvidiaApiKey) {
        ERR("env", "NVIDIA_API_KEY is missing", null);
        return NextResponse.json(
            {
                error: "Transcription is not configured",
                detail: "NVIDIA_API_KEY is not set on the server.",
            },
            { status: 500 }
        );
    }

    // --- Env check ---
    LOG("env", "NEXT_PUBLIC_SUPABASE_URL set?", !!process.env.NEXT_PUBLIC_SUPABASE_URL);
    LOG("env", "NEXT_PUBLIC_SUPABASE_ANON_KEY set?", !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    LOG("env", "NVIDIA_API_KEY set?", !!process.env.NVIDIA_API_KEY);
    // Log first 20 chars of each key so you can confirm it's not the placeholder
    LOG("env", "SUPABASE_URL prefix", process.env.NEXT_PUBLIC_SUPABASE_URL?.slice(0, 30));
    LOG("env", "SUPABASE_KEY prefix", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.slice(0, 20));
    LOG("env", "NVIDIA_KEY prefix", process.env.NVIDIA_API_KEY?.slice(0, 12));

    try {
        let formData: FormData;
        try {
            formData = await req.formData();
        } catch (formDataError) {
            if (isPayloadTooLargeError(formDataError)) {
                ERR("parse", "Audio payload exceeds configured request limit", formDataError);
                return NextResponse.json(
                    {
                        error: "Audio file too large",
                        detail: `Please keep uploads under ${MAX_AUDIO_UPLOAD_MB}MB.`,
                    },
                    { status: 413 }
                );
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
            return NextResponse.json({ error: "No audio file provided" }, { status: 400 });
        }

        LOG("parse", `File received: name=${file.name}, size=${file.size} bytes, type=${file.type}`);

        if (file.size > MAX_AUDIO_UPLOAD_BYTES) {
            return NextResponse.json(
                {
                    error: "Audio file too large",
                    detail: `Please keep uploads under ${MAX_AUDIO_UPLOAD_MB}MB.`,
                },
                { status: 413 }
            );
        }

        // --- Step 1: Upload to Supabase Storage ---
        const fileName = `${Date.now()}_${file.name || "audio.webm"}`;
        LOG("storage", `Uploading as: audio/${fileName}`);

        const audioBuffer = Buffer.from(await file.arrayBuffer());
        LOG("storage", `Audio buffer size: ${audioBuffer.byteLength} bytes`);

        let fileUrl = "";
        const uploadContentType = normalizeUploadContentType(file.type, file.name);
        try {
            const uploadResult = await uploadAudio(audioBuffer, fileName, uploadContentType);
            LOG("storage", "Upload result", uploadResult);

            const { data } = supabase.storage
                .from("voice-memos")
                .getPublicUrl(`audio/${fileName}`);
            fileUrl = data.publicUrl;
            LOG("storage", "Public URL", fileUrl);
            LOG("timing", "Storage upload ms", Date.now() - startedAtMs);
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
                fileName: file.name,
                fileType: file.type,
                fileSizeBytes: file.size,
                audioBufferSizeBytes: audioBuffer.byteLength,
                uploadObjectPath: `audio/${fileName}`,
                uploadContentType,
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
                isLikelySupabaseSocketSizeCapError(uploadError, file.size)
            ) {
                return NextResponse.json(
                    {
                        error: "Audio file too large for storage",
                        detail:
                            "This file exceeds your current Supabase upload cap (often bucket size limit or active spend cap). Upload a smaller file or disable spend cap / raise the bucket limit.",
                    },
                    { status: 413 }
                );
            }

            ERR("storage", "Supabase upload failed", uploadError);
            return NextResponse.json(
                { error: "Failed to upload file to Supabase", detail: String(uploadError) },
                { status: 500 }
            );
        }

        // --- Step 2: Transcribe via NVIDIA Parakeet-CTC (gRPC) ---
        LOG("nvidia", "Sending audio to NVIDIA Parakeet via gRPC...");
        const transcribeStartMs = Date.now();
        let transcriptionText = "";
        try {
            transcriptionText = await transcribeAudio(
                audioBuffer,
                nvidiaApiKey,
                file.type || "audio/webm",
                { priority: "final" }
            );

            LOG("nvidia", "Transcription result", transcriptionText);
            LOG("timing", "Transcription ms", Date.now() - transcribeStartMs);
        } catch (transcriptionError) {
            ERR("nvidia", "Transcription failed", transcriptionError);
            return NextResponse.json(
                {
                    error: "Failed to transcribe audio with NVIDIA",
                    detail:
                        readErrorMessage(transcriptionError) ||
                        "Upstream transcription service failed.",
                },
                { status: 502 }
            );
        }

        // --- Step 3: Save to Supabase DB ---
        LOG("db", memoId ? "Updating existing memo row..." : "Inserting into memos table...");
        try {
            if (memoId) {
                const { data: updatedMemo, error: updateError } = await supabaseAdmin
                    .from("memos")
                    .update({
                        title: file.name || "Voice Memo",
                        transcript: transcriptionText,
                        audio_url: fileUrl,
                    })
                    .eq("id", memoId)
                    .eq("user_id", userId)
                    .select("id")
                    .maybeSingle();

                if (!updateError && updatedMemo?.id) {
                    LOG("db", "Updated existing memo row", { id: updatedMemo.id });
                    LOG("timing", "Total request ms", Date.now() - startedAtMs);
                    LOG("done", "Returning success response");
                    return NextResponse.json({
                        success: true,
                        id: updatedMemo.id,
                        text: transcriptionText,
                        url: fileUrl,
                        modelUsed: "nvidia/parakeet-rnnt-1.1b",
                    });
                }

                LOG("db", "Live memo update failed, falling back to insert", {
                    memoId,
                    error: updateError?.message ?? "memo not found",
                });
            }

            const { data: dbData, error: dbError } = await supabaseAdmin.from("memos").insert({
                title: file.name || "Voice Memo",
                transcript: transcriptionText,
                audio_url: fileUrl,
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
            return NextResponse.json({
                success: true,
                id: insertedId,
                text: transcriptionText,
                url: fileUrl,
                modelUsed: "nvidia/parakeet-rnnt-1.1b",
            });
        } catch (dbErr) {
            ERR("db", "Unexpected DB error", dbErr);
            return NextResponse.json(
                { error: "Failed to save memo", detail: String(dbErr) },
                { status: 500 }
            );
        }

    } catch (error) {
        ERR("catch", "Unhandled error in POST handler", error);
        return NextResponse.json({ error: "Failed to transcribe audio" }, { status: 500 });
    }
}
