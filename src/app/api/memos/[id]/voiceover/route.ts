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

const AUDIO_FETCH_TIMEOUT_MS = 10_000;
const ELEVENLABS_TIMEOUT_MS = 30_000;

type ElevenLabsErrorDetail = {
  code: string | null;
  message: string | null;
};

function isAbortError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  return error.name === "AbortError";
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

  let memoAudioResponse: Response;
  try {
    memoAudioResponse = await fetchWithTimeout(memoUrl, {}, AUDIO_FETCH_TIMEOUT_MS);
  } catch (error) {
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
    return NextResponse.json(
      { error: "ElevenLabs rate limit — try again shortly" },
      { status: 429, headers: CORS }
    );
  }

  if (elevenLabsResponse.status === 422) {
    return NextResponse.json(
      { error: "ElevenLabs validation error (status 422)" },
      { status: 422, headers: CORS }
    );
  }

  if (elevenLabsResponse.status === 400) {
    const detail = await readElevenLabsError(elevenLabsResponse);
    return NextResponse.json(
      {
        error: formatElevenLabsError("ElevenLabs request rejected", detail),
      },
      { status: 400, headers: CORS }
    );
  }

  if (elevenLabsResponse.status === 401) {
    const detail = await readElevenLabsError(elevenLabsResponse);
    return NextResponse.json(
      {
        error: formatElevenLabsError("ElevenLabs authentication failed", detail),
      },
      { status: 401, headers: CORS }
    );
  }

  if (elevenLabsResponse.status === 403) {
    const detail = await readElevenLabsError(elevenLabsResponse);
    return NextResponse.json(
      {
        error: formatElevenLabsError("ElevenLabs blocked this voice", detail),
      },
      { status: 403, headers: CORS }
    );
  }

  if (!elevenLabsResponse.ok) {
    return NextResponse.json(
      { error: `ElevenLabs error (status ${elevenLabsResponse.status})` },
      { status: 502, headers: CORS }
    );
  }

  if (!elevenLabsResponse.body) {
    return NextResponse.json(
      { error: "ElevenLabs returned no audio" },
      { status: 502, headers: CORS }
    );
  }

  const upstreamContentType =
    elevenLabsResponse.headers.get("content-type") ?? "application/octet-stream";

  return new NextResponse(elevenLabsResponse.body, {
    headers: {
      ...CORS,
      "Content-Type": upstreamContentType,
      "Cache-Control": "no-store",
    },
  });
}
