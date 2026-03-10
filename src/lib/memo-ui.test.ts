import {
  MEMO_ESTIMATED_COST_PER_MINUTE_USD,
  FAILED_TRANSCRIPT,
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
