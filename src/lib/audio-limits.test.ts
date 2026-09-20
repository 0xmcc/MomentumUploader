/** @jest-environment node */

/**
 * What the app will accept, now that nothing is transcribed inside a request.
 *
 * The 75MB cap was sized for a file that had to be parsed, held in memory and
 * transcribed before the response was written. None of that happens any more:
 * the recorder uploads chunks straight to storage and the worker joins them.
 * The spec asks for "hundreds of MB, even multiple GB", and a 75MB cap makes a
 * three-hour recording unreachable before any worker runs.
 *
 * There is still one route that reads a whole file inside a request — the
 * single-shot multipart upload — and its ceiling is Next's body limit, not a
 * policy. That ceiling stays, separately named, so the message can say which
 * limit was hit and what to do instead.
 */
import {
  MAX_AUDIO_UPLOAD_BYTES,
  MAX_AUDIO_UPLOAD_MB,
  MAX_DIRECT_UPLOAD_BYTES,
  MAX_DIRECT_UPLOAD_MB,
} from "@/lib/audio-limits";

const THREE_HOUR_BYTES = 320 * 1024 * 1024;

describe("the chunked upload ceiling", () => {
  it("admits a three-hour recording", () => {
    expect(MAX_AUDIO_UPLOAD_BYTES).toBeGreaterThanOrEqual(THREE_HOUR_BYTES);
  });

  it("admits at least the 500MB the pipeline was asked for", () => {
    expect(MAX_AUDIO_UPLOAD_BYTES).toBeGreaterThanOrEqual(500 * 1024 * 1024);
  });

  it("states the limit in whole megabytes, for the message a person reads", () => {
    expect(MAX_AUDIO_UPLOAD_MB).toBe(
      Math.round(MAX_AUDIO_UPLOAD_BYTES / (1024 * 1024))
    );
  });
});

describe("the single-request ceiling that remains", () => {
  it("is smaller than the chunked one — it is a request body, not a policy", () => {
    expect(MAX_DIRECT_UPLOAD_BYTES).toBeLessThan(MAX_AUDIO_UPLOAD_BYTES);
  });

  it("matches the body size configured for the Next server", () => {
    // next.config.ts sets proxyClientMaxBodySize/bodySizeLimit to this.
    expect(MAX_DIRECT_UPLOAD_MB).toBe(75);
  });
});
