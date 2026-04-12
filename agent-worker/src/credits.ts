const PROVIDER_WEIGHTS = {
  anthropic: { input_token: 0.001, output_token: 0.003, tool_round: 0.5 },
  openai: { input_token: 0.0008, output_token: 0.002, tool_round: 0.4 },
  google: { input_token: 0.0006, output_token: 0.0018, tool_round: 0.35 },
} as const;

type Provider = keyof typeof PROVIDER_WEIGHTS;

export function computeCreditCost(
  provider: string,
  usage: { inputTokens: number; outputTokens: number; toolRounds: number }
): number {
  const weights = PROVIDER_WEIGHTS[(provider as Provider) ?? "anthropic"] ?? PROVIDER_WEIGHTS.anthropic;
  const total =
    usage.inputTokens * weights.input_token +
    usage.outputTokens * weights.output_token +
    usage.toolRounds * weights.tool_round;

  return Number(total.toFixed(4));
}

export { PROVIDER_WEIGHTS };
