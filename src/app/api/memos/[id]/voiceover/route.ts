import { Buffer } from "buffer";
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase";
import {
  CURATED_VOICES,
  ELEVENLABS_STS_MODEL,
} from "@/lib/elevenlabs-voices";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

type Params = { params: Promise<{ id: string }> };

type MemoAudioRow = {
  id: string;
  audio_url: string | null;
};

type MemoVoiceoverRow = {
  id: string;
  memo_id: string;
  user_id: string;
  voice_id: string;
  audio_url: string | null;
  storage_path: string | null;
  content_type: string | null;
  status: "processing" | "ready";
};

const AUDIO_FETCH_TIMEOUT_MS = 10_000;
const ELEVENLABS_TIMEOUT_MS = 30_000;
const VOICEOVER_WAIT_TIMEOUT_MS = 35_000;
const VOICEOVER_POLL_INTERVAL_MS = 300;
const VOICEOVER_STORAGE_BUCKET = "voice-memos";
const VOICEOVER_STORAGE_PREFIX = "voiceovers";

type ElevenLabsErrorDetail = {
  code: string | null;
  message: string | null;
};

type PostgresError = {
  code?: string;
  message?: string;
  statusCode?: number;
};

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.name === "AbortError";
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function isUniqueViolation(error: unknown): boolean {
  const candidate = error as PostgresError | null;
  return candidate?.code === "23505";
}

function isStorageConflict(error: unknown): boolean {
  const candidate = error as PostgresError | null;
  if (candidate?.statusCode === 409) return true;
  const message = candidate?.message;
  return typeof message === "string" && message.toLowerCase().includes("already exists");
}

function shouldBypassPersistence(error: unknown): boolean {
  const candidate = error as PostgresError | null;
  if (!candidate) return false;
  if (candidate.code === "42P01" || candidate.code === "42703") return true;
  const message = typeof candidate.message === "string" ? candidate.message.toLowerCase() : "";
  return message.includes("memo_voiceovers") && (message.includes("does not exist") || message.includes("column"));
}

function buildStoragePath(userId: string, memoId: string, voiceId: string): string {
  return `${VOICEOVER_STORAGE_PREFIX}/${userId}/${memoId}/${voiceId}.mp3`;
}

function getStoragePublicUrl(storagePath: string): string {
  const { data } = supabaseAdmin.storage.from(VOICEOVER_STORAGE_BUCKET).getPublicUrl(storagePath);
  return data.publicUrl;
}

async function findVoiceoverRow(
  memoId: string,
  voiceId: string,
  userId: string
): Promise<MemoVoiceoverRow | null> {
  const { data, error } = await supabaseAdmin
    .from("memo_voiceovers")
    .select("id, memo_id, user_id, voice_id, audio_url, storage_path, content_type, status")
    .eq("memo_id", memoId)
    .eq("voice_id", voiceId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error || !data) return null;
  return data as MemoVoiceoverRow;
}

async function waitForReadyVoiceover(
  memoId: string,
  voiceId: string,
  userId: string
): Promise<MemoVoiceoverRow | null> {
  const deadline = Date.now() + VOICEOVER_WAIT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(VOICEOVER_POLL_INTERVAL_MS);
    const row = await findVoiceoverRow(memoId, voiceId, userId);
    if (!row) return null;
    if (row.status === "ready" && row.audio_url) return row;
    if (row.status !== "processing") return row;
  }
  return null;
}

function streamResponse(stream: Response): NextResponse {
  return new NextResponse(stream.body, {
    headers: {
      ...CORS,
      "Content-Type": stream.headers.get("content-type") ?? "audio/mpeg",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}

async function streamPersistedVoiceover(audioUrl: string): Promise<NextResponse> {
  try {
    const res = await fetchWithTimeout(audioUrl, {}, AUDIO_FETCH_TIMEOUT_MS);
    if (!res.ok || !res.body) {
      return NextResponse.json({ error: "Unable to fetch generated audio" }, { status: 502, headers: CORS });
    }
    return streamResponse(res);
  } catch (error) {
    if (isAbortError(error)) {
      return NextResponse.json({ error: "Timed out fetching generated audio" }, { status: 504, headers: CORS });
    }
    return NextResponse.json({ error: "Unable to fetch generated audio" }, { status: 502, headers: CORS });
  }
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function readElevenLabsError(response: Response): Promise<ElevenLabsErrorDetail> {
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return { code: null, message: null };
  }

  try {
    const payload = (await response.json()) as unknown;
    if (!payload || typeof payload !== "object") {
      return { code: null, message: null };
    }

    const detail = (payload as { detail?: unknown }).detail;
    if (detail && typeof detail === "object") {
      const code =
        typeof (detail as { status?: unknown }).status === "string"
          ? (detail as { status: string }).status
          : null;
      const message =
        typeof (detail as { message?: unknown }).message === "string"
          ? (detail as { message: string }).message
          : null;

      return { code, message };
    }

    if (typeof detail === "string") {
      return { code: null, message: detail };
    }

    const errorMessage =
      typeof (payload as { error?: unknown }).error === "string"
        ? (payload as { error: string }).error
        : typeof (payload as { message?: unknown }).message === "string"
          ? (payload as { message: string }).message
          : null;

    return { code: null, message: errorMessage };
  } catch {
    return { code: null, message: null };
  }
}

function formatElevenLabsError(
  baseMessage: string,
  detail: ElevenLabsErrorDetail
): string {
  if (detail.code && detail.message) {
    return `${baseMessage} (${detail.code}): ${detail.message}`;
  }

  if (detail.code) {
    return `${baseMessage} (${detail.code})`;
  }

  if (detail.message) {
    return `${baseMessage}: ${detail.message}`;
  }

  return baseMessage;
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(req: NextRequest, { params }: Params) {
  const elevenLabsApiKey = process.env.ELEVENLABS_API_KEY;
  if (!elevenLabsApiKey) {
    console.error("ELEVENLABS_API_KEY is not configured");
    return NextResponse.json(
      { error: "Voiceover service is not configured" },
      { status: 500, headers: CORS }
    );
  }

  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: CORS });
  }

  const { id } = await params;

  let payload: { voiceId?: unknown };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: CORS });
  }

  const voiceId = typeof payload.voiceId === "string" ? payload.voiceId : "";
  const selectedVoice = CURATED_VOICES.find((voice) => voice.id === voiceId);
  if (!selectedVoice) {
    return NextResponse.json({ error: "Invalid voice ID" }, { status: 400, headers: CORS });
  }

  const { data: memo, error: memoError } = await supabaseAdmin
    .from("memos")
    .select("id, audio_url")
    .eq("id", id)
    .eq("user_id", userId)
    .maybeSingle();

  if (memoError || !memo) {
    return NextResponse.json({ error: "Memo not found" }, { status: 404, headers: CORS });
  }

  const memoRow = memo as MemoAudioRow;
  const memoUrl = typeof memoRow.audio_url === "string" ? memoRow.audio_url : null;
  if (!memoUrl) {
    return NextResponse.json({ error: "Memo has no audio" }, { status: 422, headers: CORS });
  }

  const existingVoiceover = await findVoiceoverRow(id, voiceId, userId);
  if (existingVoiceover?.status === "ready" && existingVoiceover.audio_url) {
    return streamPersistedVoiceover(existingVoiceover.audio_url);
  }

  let canPersistVoiceover = true;
  let processingRowId: string | null = null;
  const cleanupProcessingRow = async () => {
    if (processingRowId) {
      await supabaseAdmin.from("memo_voiceovers").delete().eq("id", processingRowId);
      processingRowId = null;
    }
  };

  const { data: insertedRow, error: insertError } = await supabaseAdmin
    .from("memo_voiceovers")
    .insert({ memo_id: id, voice_id: voiceId, user_id: userId, status: "processing" })
    .select("id, memo_id, user_id, voice_id, audio_url, storage_path, content_type, status")
    .single();

  if (insertError) {
    if (!isUniqueViolation(insertError)) {
      if (!shouldBypassPersistence(insertError)) {
        return NextResponse.json(
          { error: "Failed to initialize voiceover generation" },
          { status: 500, headers: CORS }
        );
      }
      canPersistVoiceover = false;
      console.warn("[voiceover] Persistence unavailable; continuing without persistence", insertError);
    }
    if (canPersistVoiceover) {
      const conflictedRow = await findVoiceoverRow(id, voiceId, userId);
      if (conflictedRow?.status === "ready" && conflictedRow.audio_url) {
        return streamPersistedVoiceover(conflictedRow.audio_url);
      }
      const waitedRow = await waitForReadyVoiceover(id, voiceId, userId);
      if (waitedRow?.audio_url) return streamPersistedVoiceover(waitedRow.audio_url);
      return NextResponse.json(
        { error: "Voiceover generation already in progress" },
        { status: 409, headers: CORS }
      );
    }
  } else {
    const inserted = insertedRow as MemoVoiceoverRow | null;
    if (inserted?.id) processingRowId = inserted.id;
    else canPersistVoiceover = false;
  }

  let memoAudioResponse: Response;
  try {
    memoAudioResponse = await fetchWithTimeout(memoUrl, {}, AUDIO_FETCH_TIMEOUT_MS);
  } catch (error) {
    await cleanupProcessingRow();
    if (isAbortError(error)) {
      return NextResponse.json(
        { error: "Timed out fetching audio" },
        { status: 504, headers: CORS }
      );
    }

    return NextResponse.json(
      { error: "Unable to fetch source audio" },
      { status: 502, headers: CORS }
    );
  }

  if (!memoAudioResponse.ok) {
    await cleanupProcessingRow();
    return NextResponse.json(
      { error: "Unable to fetch source audio" },
      { status: 502, headers: CORS }
    );
  }

  const inputAudioBlob = await memoAudioResponse.blob();
  const requestBody = new FormData();
  requestBody.append("audio", inputAudioBlob, `memo-${id}.webm`);
  requestBody.append("model_id", ELEVENLABS_STS_MODEL);
  requestBody.append(
    "voice_settings",
    JSON.stringify({
      stability: selectedVoice.stability,
      similarity_boost: selectedVoice.similarityBoost,
    })
  );
  requestBody.append("remove_background_noise", String(true));
  requestBody.append("file_format", "other");

  const elevenLabsUrl =
    `https://api.elevenlabs.io/v1/speech-to-speech/${voiceId}` +
    "?output_format=mp3_44100_128";

  let elevenLabsResponse: Response;
  try {
    elevenLabsResponse = await fetchWithTimeout(
      elevenLabsUrl,
      {
        method: "POST",
        headers: {
          "xi-api-key": elevenLabsApiKey,
          Accept: "application/octet-stream",
        },
        body: requestBody,
      },
      ELEVENLABS_TIMEOUT_MS
    );
  } catch (error) {
    await cleanupProcessingRow();
    if (isAbortError(error)) {
      return NextResponse.json(
        { error: "ElevenLabs timed out" },
        { status: 504, headers: CORS }
      );
    }
    return NextResponse.json(
      { error: "ElevenLabs request failed" },
      { status: 502, headers: CORS }
    );
  }

  if (elevenLabsResponse.status === 429) {
    await cleanupProcessingRow();
    return NextResponse.json(
      { error: "ElevenLabs rate limit — try again shortly" },
      { status: 429, headers: CORS }
    );
  }
  if (elevenLabsResponse.status === 422) {
    await cleanupProcessingRow();
    return NextResponse.json(
      { error: "ElevenLabs validation error (status 422)" },
      { status: 422, headers: CORS }
    );
  }
  if (elevenLabsResponse.status === 400) {
    await cleanupProcessingRow();
    const detail = await readElevenLabsError(elevenLabsResponse);
    return NextResponse.json(
      { error: formatElevenLabsError("ElevenLabs request rejected", detail) },
      { status: 400, headers: CORS }
    );
  }
  if (elevenLabsResponse.status === 401) {
    await cleanupProcessingRow();
    const detail = await readElevenLabsError(elevenLabsResponse);
    return NextResponse.json(
      { error: formatElevenLabsError("ElevenLabs authentication failed", detail) },
      { status: 401, headers: CORS }
    );
  }
  if (elevenLabsResponse.status === 403) {
    await cleanupProcessingRow();
    const detail = await readElevenLabsError(elevenLabsResponse);
    return NextResponse.json(
      { error: formatElevenLabsError("ElevenLabs blocked this voice", detail) },
      { status: 403, headers: CORS }
    );
  }
  if (!elevenLabsResponse.ok) {
    await cleanupProcessingRow();
    return NextResponse.json(
      { error: `ElevenLabs error (status ${elevenLabsResponse.status})` },
      { status: 502, headers: CORS }
    );
  }
  if (!elevenLabsResponse.body) {
    await cleanupProcessingRow();
    return NextResponse.json(
      { error: "ElevenLabs returned no audio" },
      { status: 502, headers: CORS }
    );
  }

  const elevenLabsBytes = Buffer.from(await elevenLabsResponse.arrayBuffer());
  if (elevenLabsBytes.byteLength === 0) {
    await cleanupProcessingRow();
    return NextResponse.json(
      { error: "ElevenLabs returned no audio" },
      { status: 502, headers: CORS }
    );
  }

  const outputContentType =
    elevenLabsResponse.headers.get("content-type") ?? "audio/mpeg";

  if (!canPersistVoiceover) {
    return new NextResponse(elevenLabsBytes, {
      headers: { ...CORS, "Content-Type": outputContentType, "Cache-Control": "no-store" },
    });
  }

  const storagePath = buildStoragePath(userId, id, voiceId);
  const { error: storageError } = await supabaseAdmin.storage
    .from(VOICEOVER_STORAGE_BUCKET)
    .upload(storagePath, elevenLabsBytes, {
      contentType: outputContentType,
      upsert: false,
    });

  if (storageError && !isStorageConflict(storageError)) {
    await cleanupProcessingRow();
    return NextResponse.json(
      { error: "Failed to persist generated audio" },
      { status: 500, headers: CORS }
    );
  }

  if (!processingRowId) {
    return new NextResponse(elevenLabsBytes, {
      headers: { ...CORS, "Content-Type": outputContentType, "Cache-Control": "no-store" },
    });
  }

  const persistedAudioUrl = getStoragePublicUrl(storagePath);
  const { error: finalizeError } = await supabaseAdmin
    .from("memo_voiceovers")
    .update({
      audio_url: persistedAudioUrl,
      storage_path: storagePath,
      content_type: outputContentType,
      status: "ready",
    })
    .eq("id", processingRowId);

  if (finalizeError) {
    await cleanupProcessingRow();
    return NextResponse.json(
      { error: "Failed to save generated voiceover" },
      { status: 500, headers: CORS }
    );
  }

  return streamPersistedVoiceover(persistedAudioUrl);
}
