/**
 * Upload size limits, in a module the browser can import.
 *
 * These used to live only in the transcribe route's shared module, which pulls
 * in `next/server` — so the client had no way to check a file before sending
 * it, and an oversize upload failed deep in the chain instead of at the file
 * picker. The server still enforces them; this is so the UI can say so first.
 */
export const MAX_AUDIO_UPLOAD_BYTES = 75 * 1024 * 1024;
export const MAX_AUDIO_UPLOAD_MB = Math.round(
    MAX_AUDIO_UPLOAD_BYTES / (1024 * 1024)
);
export const MIN_SUPABASE_SOCKET_SIZE_CAP_BYTES = 50 * 1024 * 1024;
