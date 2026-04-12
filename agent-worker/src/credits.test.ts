import test from "node:test";
import assert from "node:assert/strict";
import { computeCreditCost } from "./credits";

test("computeCreditCost applies provider-specific weights", () => {
  assert.equal(
    computeCreditCost("anthropic", {
      inputTokens: 1000,
      outputTokens: 500,
      toolRounds: 2,
    }),
    3.5
  );

  assert.equal(
    computeCreditCost("openai", {
      inputTokens: 1000,
      outputTokens: 500,
      toolRounds: 2,
    }),
    2.6
  );
});

test("computeCreditCost falls back to anthropic weights for unknown providers", () => {
  assert.equal(
    computeCreditCost("unknown", {
      inputTokens: 100,
      outputTokens: 100,
      toolRounds: 1,
    }),
    0.9
  );
});
