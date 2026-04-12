export type AgentStreamEvent =
  | { type: "text_delta"; delta: string }
  | { type: "tool_start"; toolName: string }
  | { type: "tool_result"; toolName: string; isError: boolean }
  | { type: "done"; creditCost: number }
  | { type: "error"; message: string };

export type JobRow = {
  id: number;
  user_id: string;
  job_type: string;
  entity_type: string;
  entity_id: string;
  status: string;
  params: {
    user_message: string;
    channel_name: string;
    memo_id: string;
  };
};

export type MemoAgentSessionRow = {
  id: string;
  provider: string | null;
  provider_session_id: string | null;
  ui_messages: Array<{ role: "user" | "assistant"; text: string }> | null;
};
