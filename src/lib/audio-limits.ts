/**
 * Upload size limits, in a module the browser can import.
 *
 * These used to live only in the transcribe route's shared module, which pulls
 * in `next/server` — so the client had no way to check a file before sending
 * it, and an oversize upload failed deep in the chain instead of at the file
 * picker. The server still enforces them; this is so the UI can say so first.
 *
 * Two ceilings, because there are two paths and only one of them is a policy:
 *
 *   MAX_AUDIO_UPLOAD_BYTES — the chunked path (record, or manual upload).
 *     Chunks go straight to storage and the worker joins them, so nothing here
 *     is bounded by a request. 2GB is a deliberate, generous, STATED limit, as
 *     the spec asks: "constrained by storage, not by an arbitrary time cap".
 *
 *   MAX_DIRECT_UPLOAD_BYTES — the single-shot multipart route, which reads the
 *     whole file inside one request. That ceiling is Next's configured body
 *     size (see next.config.ts), not a choice about how long a recording may
 *     be, and the error message says so rather than pretending it is the cap.
 */
export const MAX_AUDIO_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;
export const MAX_AUDIO_UPLOAD_MB = Math.round(
    MAX_AUDIO_UPLOAD_BYTES / (1024 * 1024)
);

export const MAX_DIRECT_UPLOAD_BYTES = 75 * 1024 * 1024;
export const MAX_DIRECT_UPLOAD_MB = Math.round(
    MAX_DIRECT_UPLOAD_BYTES / (1024 * 1024)
);

export const MIN_SUPABASE_SOCKET_SIZE_CAP_BYTES = 50 * 1024 * 1024;
