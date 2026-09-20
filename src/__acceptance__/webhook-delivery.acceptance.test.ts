/** @jest-environment node */
/**
 * ACCEPTANCE — docs/PRODUCT-SPEC.md criterion 4, second half:
 *
 *     "A webhook fires on completion, and the delivery is retried when the
 *      receiver is down."
 *
 * The firing half — that the event goes out only once the transcript row
 * exists, and that a lie produces transcript.failed rather than
 * transcript.ready — is in long-form-pipeline.acceptance.test.ts, because it is
 * a property of the pipeline rather than of the delivery.
 *
 * This file is about the delivery itself, through the real module. The network
 * is the only thing doubled: fetch and the sleep between attempts. Nothing here
 * waits on a real timer and nothing leaves the process.
 *
 * Why retries are an acceptance criterion and not a nicety: the point of the
 * hook is that something outside this app acts on a recording without polling.
 * A receiver that was restarting when we called, and never hears about a
 * three-hour recording, has silently lost the session.
 */
import {
    TRANSCRIPT_WEBHOOK_SIGNATURE_HEADER,
    TRANSCRIPT_WEBHOOK_TIMESTAMP_HEADER,
    deliverTranscriptWebhook,
    signWebhookBody,
    type TranscriptWebhookEvent,
} from "@/lib/transcript-webhook";

const URL = "https://hooks.example.com/momentum";
const SECRET = "acceptance-secret";
const FIXED_NOW_MS = 1_789_000_000_000;

function readyEvent(): TranscriptWebhookEvent {
    return {
        event: "transcript.ready",
        memoId: "memo-3h",
        userId: "user_acceptance",
        transcript: "minute 0: spoken words here. minute 179: spoken words here.",
        transcriptStatus: "complete",
        durationSeconds: 3 * 60 * 60,
        segmentCount: 180,
        audioUrl: "https://storage.example/memo-3h.webm",
    };
}

function okResponse() {
    return { ok: true, status: 200 } as unknown as Response;
}

describe("Criterion 4: the webhook survives a receiver that is down", () => {
    it("keeps trying until the receiver comes back, and the event still arrives", async () => {
        const attempts: Array<{ body: string; headers: Record<string, string> }> = [];
        const sleeps: number[] = [];

        const fetchImpl = jest.fn(async (_url: unknown, init?: RequestInit) => {
            attempts.push({
                body: String(init?.body ?? ""),
                headers: (init?.headers ?? {}) as Record<string, string>,
            });
            if (attempts.length < 3) {
                throw new Error("ECONNREFUSED hooks.example.com:443");
            }
            return okResponse();
        }) as unknown as typeof fetch;

        const result = await deliverTranscriptWebhook(readyEvent(), {
            url: URL,
            secret: SECRET,
            fetchImpl,
            now: () => FIXED_NOW_MS,
            sleep: async (ms: number) => {
                sleeps.push(ms);
            },
        });

        // done means the receiver got it — not that we tried.
        expect(result.delivered).toBe(true);
        expect(result.attempts).toBe(3);
        expect(attempts).toHaveLength(3);
        expect(sleeps).toHaveLength(2);
        expect(sleeps[1]).toBeGreaterThan(sleeps[0]); // backing off, not hammering

        // The retry is the same event, not a fresh one the receiver has to
        // reconcile: same bytes, same signature, so it can be deduplicated.
        expect(new Set(attempts.map((attempt) => attempt.body)).size).toBe(1);
        const body = attempts[0].body;
        expect(JSON.parse(body).memoId).toBe("memo-3h");
        expect(attempts[2].headers[TRANSCRIPT_WEBHOOK_SIGNATURE_HEADER]).toBe(
            signWebhookBody(body, SECRET, Math.floor(FIXED_NOW_MS / 1000))
        );
        expect(attempts[2].headers[TRANSCRIPT_WEBHOOK_TIMESTAMP_HEADER]).toBe(
            String(Math.floor(FIXED_NOW_MS / 1000))
        );
    });

    it("retries a receiver that answers with a server error, not only a dead socket", async () => {
        let calls = 0;
        const fetchImpl = jest.fn(async () => {
            calls += 1;
            return calls < 2
                ? ({ ok: false, status: 503 } as unknown as Response)
                : okResponse();
        }) as unknown as typeof fetch;

        const result = await deliverTranscriptWebhook(readyEvent(), {
            url: URL,
            secret: SECRET,
            fetchImpl,
            now: () => FIXED_NOW_MS,
            sleep: async () => {},
        });

        expect(result.delivered).toBe(true);
        expect(result.attempts).toBe(2);
    });

    it("reports honestly, rather than throwing, when the receiver never comes back", async () => {
        const fetchImpl = jest.fn(async () => {
            throw new Error("ECONNREFUSED hooks.example.com:443");
        }) as unknown as typeof fetch;

        const result = await deliverTranscriptWebhook(readyEvent(), {
            url: URL,
            secret: SECRET,
            fetchImpl,
            now: () => FIXED_NOW_MS,
            sleep: async () => {},
            maxAttempts: 4,
        });

        expect(result.delivered).toBe(false);
        expect(result.attempts).toBe(4);
        expect(String(result.reason)).toContain("ECONNREFUSED");
    });
});
