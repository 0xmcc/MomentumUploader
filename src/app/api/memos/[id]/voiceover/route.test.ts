/** @jest-environment node */

import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase";
import { POST } from "./route";
import { CURATED_VOICES } from "@/lib/elevenlabs-voices";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    from: jest.fn(),
  },
}));

type MockState = {
  memo: Record<string, unknown> | null;
  memoError: { message: string } | null;
};

function setupSupabaseMock(state: MockState) {
  const maybeSingle = jest.fn().mockResolvedValue({
    data: state.memo,
    error: state.memoError,
  });

  const query = {
    eq: jest.fn(),
    maybeSingle,
  };

  query.eq.mockReturnValue(query);

  (supabaseAdmin.from as jest.Mock).mockReturnValue({
    select: jest.fn(() => query),
  });
}

function makeRequest(voiceId: unknown): NextRequest {
  return {
    json: jest.fn().mockResolvedValue({ voiceId }),
  } as unknown as NextRequest;
}

describe("POST /api/memos/:id/voiceover", () => {
  const previousKey = process.env.ELEVENLABS_API_KEY;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.ELEVENLABS_API_KEY = "test-elevenlabs-key";
    (auth as unknown as jest.Mock).mockResolvedValue({ userId: "user_123" });
    Object.defineProperty(global, "fetch", {
      writable: true,
      value: jest.fn(),
    });
  });

  afterAll(() => {
    process.env.ELEVENLABS_API_KEY = previousKey;
  });

  it("returns 401 when unauthenticated", async () => {
    (auth as unknown as jest.Mock).mockResolvedValue({ userId: null });

    const res = await POST(makeRequest(CURATED_VOICES[0].id), {
      params: Promise.resolve({ id: "memo-1" }),
    });

    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("returns 404 when memo is missing", async () => {
    setupSupabaseMock({ memo: null, memoError: null });

    const res = await POST(makeRequest(CURATED_VOICES[0].id), {
      params: Promise.resolve({ id: "missing" }),
    });

    const body = await res.json();

    expect(res.status).toBe(404);
    expect(body.error).toBe("Memo not found");
  });

  it("returns 422 when memo has no url", async () => {
    setupSupabaseMock({
      memo: { id: "memo-1", audio_url: null },
      memoError: null,
    });

    const res = await POST(makeRequest(CURATED_VOICES[0].id), {
      params: Promise.resolve({ id: "memo-1" }),
    });

    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.error).toBe("Memo has no audio");
  });

  it("returns 400 when voiceId is invalid", async () => {
    const res = await POST(makeRequest("invalid-voice"), {
      params: Promise.resolve({ id: "memo-1" }),
    });

    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe("Invalid voice ID");
  });

  it("returns 429 when ElevenLabs rate limits", async () => {
    setupSupabaseMock({
      memo: { id: "memo-1", audio_url: "https://cdn.example.com/memo.webm" },
      memoError: null,
    });

    const fetchMock = global.fetch as jest.Mock;
    fetchMock
      .mockResolvedValueOnce(new Response(new Blob(["input-audio"]), { status: 200 }))
      .mockResolvedValueOnce(new Response("rate limited", { status: 429 }));

    const res = await POST(makeRequest(CURATED_VOICES[0].id), {
      params: Promise.resolve({ id: "memo-1" }),
    });

    const body = await res.json();

    expect(res.status).toBe(429);
    expect(body.error).toBe("ElevenLabs rate limit — try again shortly");
  });

  it("returns 401 when ElevenLabs rejects the API key or voice access", async () => {
    setupSupabaseMock({
      memo: { id: "memo-1", audio_url: "https://cdn.example.com/memo.webm" },
      memoError: null,
    });

    const fetchMock = global.fetch as jest.Mock;
    fetchMock
      .mockResolvedValueOnce(new Response(new Blob(["input-audio"]), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            detail: {
              status: "invalid_api_key",
              message: "Invalid API key",
            },
          }),
          {
            status: 401,
            headers: { "content-type": "application/json" },
          }
        )
      );

    const res = await POST(makeRequest(CURATED_VOICES[0].id), {
      params: Promise.resolve({ id: "memo-1" }),
    });

    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toBe(
      "ElevenLabs authentication failed (invalid_api_key): Invalid API key"
    );
  });

  it("returns 400 with upstream detail when ElevenLabs rejects a voice id", async () => {
    setupSupabaseMock({
      memo: { id: "memo-1", audio_url: "https://cdn.example.com/memo.webm" },
      memoError: null,
    });

    const fetchMock = global.fetch as jest.Mock;
    fetchMock
      .mockResolvedValueOnce(new Response(new Blob(["input-audio"]), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            detail: {
              status: "voice_not_found",
              message: "Voice not found",
            },
          }),
          {
            status: 400,
            headers: { "content-type": "application/json" },
          }
        )
      );

    const res = await POST(makeRequest(CURATED_VOICES[0].id), {
      params: Promise.resolve({ id: "memo-1" }),
    });

    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error).toBe(
      "ElevenLabs request rejected (voice_not_found): Voice not found"
    );
  });

  it("returns 502 when ElevenLabs errors", async () => {
    setupSupabaseMock({
      memo: { id: "memo-1", audio_url: "https://cdn.example.com/memo.webm" },
      memoError: null,
    });

    const fetchMock = global.fetch as jest.Mock;
    fetchMock
      .mockResolvedValueOnce(new Response(new Blob(["input-audio"]), { status: 200 }))
      .mockResolvedValueOnce(new Response("server error", { status: 500 }));

    const res = await POST(makeRequest(CURATED_VOICES[0].id), {
      params: Promise.resolve({ id: "memo-1" }),
    });

    const body = await res.json();

    expect(res.status).toBe(502);
    expect(body.error).toBe("ElevenLabs error (status 500)");
  });

  it("returns 422 when ElevenLabs rejects multipart validation", async () => {
    setupSupabaseMock({
      memo: { id: "memo-1", audio_url: "https://cdn.example.com/memo.webm" },
      memoError: null,
    });

    const fetchMock = global.fetch as jest.Mock;
    fetchMock
      .mockResolvedValueOnce(new Response(new Blob(["input-audio"]), { status: 200 }))
      .mockResolvedValueOnce(new Response("validation failed", { status: 422 }));

    const res = await POST(makeRequest(CURATED_VOICES[0].id), {
      params: Promise.resolve({ id: "memo-1" }),
    });

    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.error).toBe("ElevenLabs validation error (status 422)");
  });

  it("returns 200 with streamed audio on success", async () => {
    setupSupabaseMock({
      memo: { id: "memo-1", audio_url: "https://cdn.example.com/memo.webm" },
      memoError: null,
    });

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("mock-mp3"));
        controller.close();
      },
    });

    const fetchMock = global.fetch as jest.Mock;
    fetchMock
      .mockResolvedValueOnce(new Response(new Blob(["input-audio"]), { status: 200 }))
      .mockResolvedValueOnce(new Response(stream, { status: 200 }));

    const res = await POST(makeRequest(CURATED_VOICES[0].id), {
      params: Promise.resolve({ id: "memo-1" }),
    });

    const bodyText = Buffer.from(await res.arrayBuffer()).toString("utf8");
    const elevenLabsCall = fetchMock.mock.calls[1];
    const elevenLabsUrl = elevenLabsCall[0] as string;
    const elevenLabsInit = elevenLabsCall[1] as RequestInit;
    const formData = elevenLabsInit.body as FormData;

    expect(res.status).toBe(200);
    expect(elevenLabsUrl).toBe(
      `https://api.elevenlabs.io/v1/speech-to-speech/${CURATED_VOICES[0].id}?output_format=mp3_44100_128`
    );
    expect(elevenLabsInit.method).toBe("POST");
    expect(elevenLabsInit.headers).toEqual(
      expect.objectContaining({
        "xi-api-key": "test-elevenlabs-key",
        Accept: "application/octet-stream",
      })
    );
    expect(formData.get("model_id")).toBe("eleven_multilingual_sts_v2");
    expect(formData.get("remove_background_noise")).toBe("true");
    expect(formData.get("file_format")).toBe("other");
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(bodyText).toBe("mock-mp3");
  });
});
