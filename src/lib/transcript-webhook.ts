/**
 * One webhook, fired when a transcript is finished or has failed.
 *
 * This is the smallest useful version of the "programmable" half of the spec:
 * a single configurable endpoint, not per-user webhook management. It exists so
 * that something outside this app can act on a recording without polling — the
 * point of the pipeline, per docs/PRODUCT-SPEC.md.
 *
 * Two properties make it worth anything:
 *
 *   - **Signed.** The receiver can tell our call from anyone else's. The
 *     signature covers the timestamp and the exact bytes posted, so a captured
 *     body cannot be edited or replayed as fresh.
 *   - **Retried.** A receiver that was down when we called still gets the
 *     event. Delivery never throws at its caller: a webhook that cannot be
 *     delivered must not turn a finished transcript into a failed job.
 *
 * Configure with TRANSCRIPT_WEBHOOK_URL and TRANSCRIPT_WEBHOOK_SECRET. With
 * neither set, delivery is a no-op — the default is off, not unsigned.
 *
 * This module is imported by the Next app AND by agent-worker, so it must stay
 * free of next/* and of any Supabase import.
 */
import { createHmac } from "node:crypto";

export const TRANSCRIPT_WEBHOOK_SIGNATURE_HEADER = "x-momentum-signature";
export const TRANSCRIPT_WEBHOOK_TIMESTAMP_HEADER = "x-momentum-timestamp";

const DEFAULT_MAX_ATTEMPTS = 3;
const FIRST_RETRY_DELAY_MS = 1_000;

export type TranscriptWebhookEvent =
    | {
          event: "transcript.ready";
          memoId: string;
          userId: string;
          transcript: string;
          transcriptStatus: "complete";
          durationSeconds?: number;
          segmentCount?: number;
          audioUrl?: string | null;
      }
    | {
          event: "transcript.failed";
          memoId: string;
          userId: string;
          transcriptStatus: "failed";
          error: string;
          audioUrl?: string | null;
      };

export type TranscriptWebhookResult = {
    delivered: boolean;
    attempts: number;
    status?: number;
    reason?: string;
};

export type DeliverTranscriptWebhookOptions = {
    fetchImpl?: typeof fetch;
    /** Epoch milliseconds; injected so the signature is assertable. */
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    maxAttempts?: number;
    url?: string;
    secret?: string;
};

/**
 * HMAC-SHA256 over `<unix seconds>.<body>`, hex. The receiver recomputes this
 * with its copy of the secret and compares; binding the timestamp in is what
 * makes a captured body useless later.
 */
export function signWebhookBody(
    body: string,
    secret: string,
    timestampSeconds: number
): string {
    return createHmac("sha256", secret)
        .update(`${timestampSeconds}.${body}`)
        .digest("hex");
}

function defaultSleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function readErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    return String(error);
}

export async function deliverTranscriptWebhook(
    event: TranscriptWebhookEvent,
    options: DeliverTranscriptWebhookOptions = {}
): Promise<TranscriptWebhookResult> {
    const url = options.url ?? process.env.TRANSCRIPT_WEBHOOK_URL?.trim();
    if (!url) {
        return { delivered: false, attempts: 0, reason: "not_configured" };
    }

    const secret = options.secret ?? process.env.TRANSCRIPT_WEBHOOK_SECRET?.trim();
    if (!secret) {
        // An unsigned event is worse than no event: the receiver cannot tell it
        // from anybody else's POST.
        console.error(
            "[transcript-webhook] TRANSCRIPT_WEBHOOK_URL is set but TRANSCRIPT_WEBHOOK_SECRET is not — not sending."
        );
        return { delivered: false, attempts: 0, reason: "no_secret" };
    }

    const fetchImpl = options.fetchImpl ?? fetch;
    const sleep = options.sleep ?? defaultSleep;
    const now = options.now ?? Date.now;
    const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

    const body = JSON.stringify({
        ...event,
        deliveredAt: new Date(now()).toISOString(),
    });
    const timestampSeconds = Math.floor(now() / 1000);
    const signature = signWebhookBody(body, secret, timestampSeconds);

    let lastReason = "";

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            const response = await fetchImpl(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    [TRANSCRIPT_WEBHOOK_TIMESTAMP_HEADER]: String(timestampSeconds),
                    [TRANSCRIPT_WEBHOOK_SIGNATURE_HEADER]: signature,
                },
                body,
            });

            if (response.ok) {
                return { delivered: true, attempts: attempt, status: response.status };
            }

            lastReason = `HTTP ${response.status}`;
        } catch (error) {
            lastReason = readErrorMessage(error);
        }

        if (attempt < maxAttempts) {
            await sleep(FIRST_RETRY_DELAY_MS * 2 ** (attempt - 1));
        }
    }

    console.error("[transcript-webhook] giving up", {
        event: event.event,
        memoId: event.memoId,
        attempts: maxAttempts,
        reason: lastReason,
    });

    return { delivered: false, attempts: maxAttempts, reason: lastReason };
}
