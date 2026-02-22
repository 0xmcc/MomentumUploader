import {
  MEMO_ESTIMATED_COST_PER_MINUTE_USD,
  formatMemoEstimatedCost,
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
});
