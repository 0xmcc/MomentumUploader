import { supabase } from "@/lib/supabase";

export const DEFAULT_PENDING_MIME_TYPE = "audio/webm";
export const MANUAL_UPLOAD_ACCEPT =
  ".mp3,.m4a,audio/mpeg,audio/mp3,audio/mp4,audio/x-m4a";

function clampUploadPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

type UploadProgressCallback = (percent: number) => void;
type PrepareSignedUploadResponse = {
  ok?: boolean;
  path?: unknown;
  token?: unknown;
};
type CreateLiveMemoResponse = {
  memoId?: unknown;
};

function parseJsonResponse(responseText: string) {
  if (!responseText) return null;
  return JSON.parse(responseText) as unknown;
}

function readSignedUploadValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

async function uploadViaFetch(formData: FormData) {
  const response = await fetch("/api/transcribe", { method: "POST", body: formData });
  if (!response.ok) {
    throw new Error("Upload failed");
  }
  return (await response.json()) as unknown;
}

export async function uploadAudioForTranscription(
  formData: FormData,
  onProgress?: UploadProgressCallback
) {
  if (typeof XMLHttpRequest === "undefined" || !onProgress) {
    return uploadViaFetch(formData);
  }

  return await new Promise<unknown>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/transcribe");
    xhr.responseType = "json";

    xhr.upload.onprogress = (event: ProgressEvent<EventTarget>) => {
      if (!event.lengthComputable || event.total <= 0) return;
      const percent = clampUploadPercent((event.loaded / event.total) * 100);
      onProgress(percent);
    };

    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error("Upload failed"));
        return;
      }

      onProgress(100);
      if (xhr.response !== null && xhr.response !== "") {
        resolve(xhr.response as unknown);
        return;
      }

      try {
        resolve(parseJsonResponse(xhr.responseText));
      } catch (error) {
        reject(error);
      }
    };

    xhr.onerror = () => {
      reject(new Error("Upload failed"));
    };

    xhr.onabort = () => {
      reject(new Error("Upload aborted"));
    };

    xhr.send(formData);
  });
}

export async function uploadManualAudioBySignedUrl(
  file: File,
  mimeType: string,
) {
  const liveMemoResponse = await fetch("/api/memos/live", {
    method: "POST",
  });
  if (!liveMemoResponse.ok) {
    throw new Error("Failed to create memo");
  }

  const liveMemoPayload =
    (await liveMemoResponse.json()) as CreateLiveMemoResponse;
  const memoId = readSignedUploadValue(liveMemoPayload.memoId);
  if (!memoId) {
    throw new Error("Failed to create memo");
  }

  const prepareResponse = await fetch("/api/transcribe/upload-chunks", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      memoId,
      startIndex: 0,
      endIndex: 1,
      contentType: mimeType,
    }),
  });
  if (!prepareResponse.ok) {
    throw new Error("Upload failed");
  }

  const prepared =
    (await prepareResponse.json()) as PrepareSignedUploadResponse;
  const uploadPath = readSignedUploadValue(prepared.path);
  const uploadToken = readSignedUploadValue(prepared.token);
  if (!uploadPath || !uploadToken) {
    throw new Error("Upload failed");
  }

  const { error } = await supabase.storage
    .from("voice-memos")
    .uploadToSignedUrl(uploadPath, uploadToken, file, {
      upsert: true,
      contentType: mimeType,
    });
  if (error) {
    throw new Error(`Upload failed: ${error.message}`);
  }

  const finalizeResponse = await fetch("/api/transcribe/finalize", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      memoId,
      totalChunks: 1,
      uploadContentType: mimeType,
      uploadFileExtension: getFileExtensionFromMime(mimeType),
    }),
  });
  if (!finalizeResponse.ok) {
    throw new Error("Upload failed");
  }

  return (await finalizeResponse.json()) as unknown;
}

export function resolveUploadMimeType(file: File): string | null {
  const normalizedMime = file.type.toLowerCase();
  if (normalizedMime.includes("mpeg") || normalizedMime.includes("mp3")) {
    return "audio/mpeg";
  }
  if (normalizedMime.includes("mp4") || normalizedMime.includes("m4a")) {
    return "audio/mp4";
  }

  const normalizedName = file.name.toLowerCase();
  if (normalizedName.endsWith(".mp3")) return "audio/mpeg";
  if (normalizedName.endsWith(".m4a")) return "audio/mp4";
  return null;
}

export function getFileExtensionFromMime(mimeType: string) {
  const normalizedMime = mimeType.toLowerCase();
  if (normalizedMime.includes("m4a")) return "m4a";
  if (normalizedMime.includes("ogg")) return "ogg";
  if (normalizedMime.includes("mp4")) return "mp4";
  if (normalizedMime.includes("wav")) return "wav";
  if (normalizedMime.includes("mpeg") || normalizedMime.includes("mp3")) return "mp3";
  return "webm";
}
