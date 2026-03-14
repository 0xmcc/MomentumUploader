import { NextResponse } from "next/server";

export const MAX_AUDIO_UPLOAD_BYTES = 75 * 1024 * 1024;
export const MAX_AUDIO_UPLOAD_MB = Math.round(MAX_AUDIO_UPLOAD_BYTES / (1024 * 1024));
export const MIN_SUPABASE_SOCKET_SIZE_CAP_BYTES = 50 * 1024 * 1024;
export const TRANSCRIBE_MODEL = "nvidia/parakeet-rnnt-1.1b";
export const PROVISIONAL_MEMO_TITLE = "Voice Memo";

export type JsonResponse = ReturnType<typeof NextResponse.json>;
export type StepResult<T> =
    | { ok: true; data: T }
    | { ok: false; response: JsonResponse };

export type ParsedUpload = {
    memoId: string | null;
    provisionalTranscript: string | null;
    file: File;
    fileName: string;
    audioBuffer: Buffer;
    uploadContentType: string;
};

export type UploadedAudio = ParsedUpload & {
    fileUrl: string;
};

export function ok<T>(data: T): StepResult<T> {
    return { ok: true, data };
}

export function fail<T>(response: JsonResponse): StepResult<T> {
    return { ok: false, response };
}

export function readErrorMessage(error: unknown): string {
    if (typeof error === "string") return error;
    if (error && typeof error === "object") {
        const maybeMessage = (error as { message?: unknown }).message;
        if (typeof maybeMessage === "string") return maybeMessage;
    }
    return "";
}

export function asRecord(value: unknown): Record<string, unknown> | null {
    return value && typeof value === "object"
        ? (value as Record<string, unknown>)
        : null;
}

export function pickString(
    obj: Record<string, unknown> | null,
    key: string
): string | undefined {
    const value = obj?.[key];
    return typeof value === "string" ? value : undefined;
}

export function pickNumber(
    obj: Record<string, unknown> | null,
    key: string
): number | undefined {
    const value = obj?.[key];
    return typeof value === "number" ? value : undefined;
}

export function pickNumberOrString(
    obj: Record<string, unknown> | null,
    key: string
): number | string | undefined {
    const value = obj?.[key];
    return typeof value === "number" || typeof value === "string"
        ? value
        : undefined;
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
