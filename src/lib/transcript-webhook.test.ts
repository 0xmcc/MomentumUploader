/** @jest-environment node */

/**
 * The programmable half of the spec: something outside this app has to learn
 * that a transcript exists without polling for it.
 *
 * Two things make a webhook trustworthy rather than decorative — the receiver
 * can prove the call came from us (signature), and a receiver that was down
 * when we called still gets the event (retries). Both are tested here; neither
 * is allowed to take the caller down with it, because a failed delivery must
 * not turn a finished transcript into a failed job.
 */
import { createHmac } from "node:crypto";
import {
  TRANSCRIPT_WEBHOOK_SIGNATURE_HEADER,
  TRANSCRIPT_WEBHOOK_TIMESTAMP_HEADER,
  deliverTranscriptWebhook,
  signWebhookBody,
} from "@/lib/transcript-webhook";

function readyEvent() {
  return {
    event: "transcript.ready" as const,
    memoId: "memo-1",
    userId: "user-1",
    transcript: "hello world",
    transcriptStatus: "complete" as const,
    durationSeconds: 6117,
    segmentCount: 2,
    audioUrl: "https://example.com/audio/memo-1.webm",
  };
}

describe("signing", () => {
  it("signs the exact bytes sent, with the timestamp bound in", () => {
    const body = JSON.stringify({ hello: "world" });
    const signature = signWebhookBody(body, "shhh", 1_700_000_000);

    expect(signature).toBe(
      createHmac("sha256", "shhh").update(`1700000000.${body}`).digest("hex")
    );
  });

  it("changes when the body changes, so a replayed body cannot be edited", () => {
    const a = signWebhookBody(JSON.stringify({ n: 1 }), "shhh", 1);
    const b = signWebhookBody(JSON.stringify({ n: 2 }), "shhh", 1);
    expect(a).not.toBe(b);
  });
});

describe("delivering a transcript event", () => {
  const originalUrl = process.env.TRANSCRIPT_WEBHOOK_URL;
  const originalSecret = process.env.TRANSCRIPT_WEBHOOK_SECRET;

  afterEach(() => {
    process.env.TRANSCRIPT_WEBHOOK_URL = originalUrl;
    process.env.TRANSCRIPT_WEBHOOK_SECRET = originalSecret;
  });

  it("does nothing when no endpoint is configured", async () => {
    delete process.env.TRANSCRIPT_WEBHOOK_URL;
    const fetchImpl = jest.fn();

    const result = await deliverTranscriptWebhook(readyEvent(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result).toEqual({ delivered: false, attempts: 0, reason: "not_configured" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("POSTs the event with a signature the receiver can verify", async () => {
    process.env.TRANSCRIPT_WEBHOOK_URL = "https://hooks.example.com/momentum";
    process.env.TRANSCRIPT_WEBHOOK_SECRET = "shhh";
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, status: 200 });

    const result = await deliverTranscriptWebhook(readyEvent(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      now: () => 1_700_000_000_000,
    });

    expect(result).toEqual({ delivered: true, attempts: 1, status: 200 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://hooks.example.com/momentum");
    expect(init.method).toBe("POST");

    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers[TRANSCRIPT_WEBHOOK_TIMESTAMP_HEADER]).toBe("1700000000");
    expect(headers[TRANSCRIPT_WEBHOOK_SIGNATURE_HEADER]).toBe(
      signWebhookBody(String(init.body), "shhh", 1_700_000_000)
    );

    const sent = JSON.parse(String(init.body));
    expect(sent).toMatchObject({
      event: "transcript.ready",
      memoId: "memo-1",
      transcriptStatus: "complete",
    });
  });

  it("retries a receiver that was down, and reports the attempt it took", async () => {
    process.env.TRANSCRIPT_WEBHOOK_URL = "https://hooks.example.com/momentum";
    process.env.TRANSCRIPT_WEBHOOK_SECRET = "shhh";
    const fetchImpl = jest
      .fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValueOnce({ ok: false, status: 503 })
      .mockResolvedValueOnce({ ok: true, status: 204 });

    const sleeps: number[] = [];
    const result = await deliverTranscriptWebhook(readyEvent(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async (ms: number) => {
        sleeps.push(ms);
      },
    });

    expect(result).toEqual({ delivered: true, attempts: 3, status: 204 });
    expect(sleeps).toEqual([1_000, 2_000]);
  });

  it("gives up after the last attempt without throwing at the caller", async () => {
    process.env.TRANSCRIPT_WEBHOOK_URL = "https://hooks.example.com/momentum";
    process.env.TRANSCRIPT_WEBHOOK_SECRET = "shhh";
    const fetchImpl = jest.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await deliverTranscriptWebhook(readyEvent(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
      maxAttempts: 4,
    });

    expect(result.delivered).toBe(false);
    expect(result.attempts).toBe(4);
    expect(result.reason).toMatch(/ECONNREFUSED/);
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it("refuses to sign with nothing, rather than sending an unsigned event", async () => {
    process.env.TRANSCRIPT_WEBHOOK_URL = "https://hooks.example.com/momentum";
    delete process.env.TRANSCRIPT_WEBHOOK_SECRET;
    const fetchImpl = jest.fn();

    const result = await deliverTranscriptWebhook(readyEvent(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(result).toEqual({ delivered: false, attempts: 0, reason: "no_secret" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("carries a failure as its own event rather than silence", async () => {
    process.env.TRANSCRIPT_WEBHOOK_URL = "https://hooks.example.com/momentum";
    process.env.TRANSCRIPT_WEBHOOK_SECRET = "shhh";
    const fetchImpl = jest.fn().mockResolvedValue({ ok: true, status: 200 });

    await deliverTranscriptWebhook(
      {
        event: "transcript.failed",
        memoId: "memo-1",
        userId: "user-1",
        transcriptStatus: "failed",
        error: "transcriber returned nothing",
      },
      { fetchImpl: fetchImpl as unknown as typeof fetch }
    );

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toMatchObject({
      event: "transcript.failed",
      error: "transcriber returned nothing",
    });
  });
});
