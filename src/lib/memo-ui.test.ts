import {
  MEMO_ESTIMATED_COST_PER_MINUTE_USD,
  FAILED_TRANSCRIPT,
  describeTranscriptProgress,
  isMemoStalled,
  formatMemoEstimatedCost,
  getMemoAudioDownloadName,
  getMemoEstimatedCostUsd,
  isMemoFailed,
  isMemoProcessing,
} from "./memo-ui";

describe("memo cost formatting", () => {
  it("uses the configured rate of $0.30 per minute", () => {
    expect(MEMO_ESTIMATED_COST_PER_MINUTE_USD).toBe(0.3);
  });

  it("calculates estimated cost from memo duration", () => {
    expect(getMemoEstimatedCostUsd(60)).toBe(0.3);
    expect(getMemoEstimatedCostUsd(90)).toBe(0.45);
    expect(getMemoEstimatedCostUsd(125)).toBe(0.63);
  });

  it("formats estimated cost in USD with cents", () => {
    expect(formatMemoEstimatedCost(60)).toBe("$0.30");
    expect(formatMemoEstimatedCost(90)).toBe("$0.45");
    expect(formatMemoEstimatedCost(125)).toBe("$0.63");
  });

  it("returns placeholder when duration is missing or invalid", () => {
    expect(getMemoEstimatedCostUsd(undefined)).toBeNull();
    expect(getMemoEstimatedCostUsd(null)).toBeNull();
    expect(getMemoEstimatedCostUsd(-1)).toBeNull();
    expect(getMemoEstimatedCostUsd(Number.NaN)).toBeNull();
    expect(formatMemoEstimatedCost(undefined)).toBe("--");
  });

  it("builds an audio download filename from memo metadata", () => {
    expect(
      getMemoAudioDownloadName({
        id: "memo-12345678-abcdef",
        createdAt: "2026-02-26T11:00:00.000Z",
        url: "https://cdn.example.com/audio/clip_123.m4a?token=abc",
      })
    ).toBe("memo-2026-02-26-memo-123.m4a");
  });

  it("falls back to webm extension for unknown or malformed audio URLs", () => {
    expect(
      getMemoAudioDownloadName({
        id: "memo-1",
        createdAt: "invalid-date",
        url: "not-a-valid-url",
      })
    ).toBe("memo-unknown-date-memo-1.webm");
  });
});

describe("transcript status helpers", () => {
  it("isMemoProcessing returns true for processing status", () => {
    expect(isMemoProcessing({ transcriptStatus: "processing" })).toBe(true);
  });

  it("isMemoProcessing returns false for complete and failed status", () => {
    expect(isMemoProcessing({ transcriptStatus: "complete" })).toBe(false);
    expect(isMemoProcessing({ transcriptStatus: "failed" })).toBe(false);
    expect(isMemoProcessing({})).toBe(false);
  });

  it("isMemoFailed returns true only for failed status, not for processing", () => {
    expect(isMemoFailed({ transcript: "", transcriptStatus: "failed" })).toBe(true);
    expect(isMemoFailed({ transcript: "", transcriptStatus: "processing" })).toBe(false);
  });

  it("isMemoFailed does not treat processing memo as failed even with empty transcript", () => {
    // A processing memo has an empty transcript but should NOT show as failed
    expect(isMemoFailed({ transcript: "", transcriptStatus: "processing" })).toBe(false);
    expect(isMemoProcessing({ transcriptStatus: "processing" })).toBe(true);
  });

  it("isMemoFailed falls back to FAILED_TRANSCRIPT sentinel for memos without explicit status", () => {
    // Memos created before transcript_status column existed have no transcriptStatus
    expect(isMemoFailed({ transcript: FAILED_TRANSCRIPT })).toBe(true);
    expect(isMemoFailed({ transcript: "actual content" })).toBe(false);
  });

  it("isMemoFailed returns false for complete status even with FAILED_TRANSCRIPT content", () => {
    // Explicit status wins over content heuristic
    expect(isMemoFailed({ transcript: FAILED_TRANSCRIPT, transcriptStatus: "complete" })).toBe(false);
  });
});

/**
 * A memo stuck mid-transcription must eventually say so.
 *
 * Reported 2026-09-18: an upload sat on "Transcribing…" for many minutes with
 * 0:00, 0 words and "Refresh this page when it is ready." The page was in fact
 * polling every three seconds the whole time, so the instruction was wrong and
 * there was no way to tell a slow job from a dead one.
 */
describe("a transcription that never finishes", () => {
  const minutesAgo = (n: number) =>
    new Date(Date.now() - n * 60_000).toISOString();

  it("is not stalled while it is still plausibly working", () => {
    expect(
      isMemoStalled(
        { transcript: "", transcriptStatus: "processing", createdAt: minutesAgo(2) },
      )
    ).toBe(false);
  });

  it("is stalled once it has been processing far too long", () => {
    expect(
      isMemoStalled(
        { transcript: "", transcriptStatus: "processing", createdAt: minutesAgo(45) },
      )
    ).toBe(true);
  });

  it("is never stalled once a transcript exists or the memo finished", () => {
    expect(
      isMemoStalled({ transcript: "words", transcriptStatus: "processing", createdAt: minutesAgo(45) })
    ).toBe(false);
    expect(
      isMemoStalled({ transcript: "", transcriptStatus: "complete", createdAt: minutesAgo(45) })
    ).toBe(false);
    expect(
      isMemoStalled({ transcript: "", transcriptStatus: "failed", createdAt: minutesAgo(45) })
    ).toBe(false);
  });

  /**
   * Ten minutes was right when transcription ran inside one request: nothing
   * legitimately took longer. A queued 1h42m recording does, and telling its
   * owner it "looks stuck — try uploading it again" is how you get two copies
   * of a two-hour meeting and no transcript.
   */
  it("gives a long recording the time its own length needs", () => {
    expect(
      isMemoStalled({
        transcript: "",
        transcriptStatus: "processing",
        createdAt: minutesAgo(45),
        durationSeconds: 6117, // 1h42m
      })
    ).toBe(false);
  });

  it("still calls a long recording stuck once even its length cannot explain it", () => {
    expect(
      isMemoStalled({
        transcript: "",
        transcriptStatus: "processing",
        createdAt: minutesAgo(200),
        durationSeconds: 6117,
      })
    ).toBe(true);
  });

  it("does not tell the owner of a long recording to upload it again", () => {
    const waiting = describeTranscriptProgress({
      transcript: "",
      transcriptStatus: "processing",
      createdAt: minutesAgo(45),
      durationSeconds: 6117,
    });
    expect(waiting).not.toMatch(/stuck|again/i);
    expect(waiting).toMatch(/45 min/);
  });

  it("never tells the user to refresh a page that refreshes itself", () => {
    const working = describeTranscriptProgress({
      transcript: "",
      transcriptStatus: "processing",
      createdAt: minutesAgo(3),
    });
    expect(working).not.toMatch(/refresh/i);
    expect(working).toMatch(/3 min/);
  });

  it("says the job looks stuck, and how long it has been, once it is stalled", () => {
    const stuck = describeTranscriptProgress({
      transcript: "",
      transcriptStatus: "processing",
      createdAt: minutesAgo(45),
    });
    expect(stuck).toMatch(/45 min/);
    expect(stuck).toMatch(/stuck|stalled|failed/i);
    expect(stuck).not.toMatch(/refresh this page/i);
  });
});
