import {
  MEMO_ESTIMATED_COST_PER_MINUTE_USD,
  formatMemoEstimatedCost,
  getMemoAudioDownloadName,
  getMemoEstimatedCostUsd,
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
