export type PersistedUIMessage = {
  role: "user" | "assistant";
  text: string;
};

export type UIMessage = PersistedUIMessage & {
  id: string;
};

export type AgentStreamEvent =
  | { type: "text_delta"; delta: string }
  | { type: "tool_start"; toolName: string }
  | { type: "tool_result"; toolName: string; isError: boolean }
  | { type: "done"; creditCost: number }
  | { type: "error"; message: string };
