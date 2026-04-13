import test from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { processJob } from "./worker";

function makeAsyncStream(messages: unknown[]) {
  return (async function* () {
    for (const message of messages) {
      yield message;
    }
  })();
}

test("emits assistant text before done when the SDK returns a non-delta assistant message", async () => {
  const queryImpl = () =>
    makeAsyncStream([
      {
        type: "assistant",
        session_id: "provider-session-1",
        message: {
          content: [{ type: "text", text: "Streaming fallback reply." }],
        },
      },
      {
        type: "result",
        session_id: "provider-session-1",
        usage: {
          input_tokens: 12,
          output_tokens: 34,
        },
      },
    ]);

  const sendCalls: unknown[] = [];
  const channel = {
    subscribe(callback: (status: string) => void) {
      callback("SUBSCRIBED");
      return channel;
    },
    async send(payload: unknown) {
      sendCalls.push(payload);
    },
  };

  let sessionUpdatePayload: Record<string, unknown> | null = null;
  const sessionSingle = async () => ({
    data: {
      id: "session-1",
      provider: "anthropic",
      provider_session_id: null,
      ui_messages: [],
    },
    error: null,
  });
  const sessionEq = () => ({ single: sessionSingle });
  const sessionSelect = () => ({ eq: sessionEq });

  const sessionUpdateEq = async () => ({ data: null, error: null });
  const sessionUpdate = (payload: Record<string, unknown>) => {
    sessionUpdatePayload = payload;
    return { eq: sessionUpdateEq };
  };

  const jobUpdateEq = async () => ({ data: null, error: null });
  const jobUpdate = () => ({ eq: jobUpdateEq });

  const supabase = {
    channel: () => channel,
    removeChannel: () => {},
    rpc: async () => ({
      data: { ok: true },
      error: null,
    }),
    from: (table: string) => {
      if (table === "memo_agent_sessions") {
        return {
          select: sessionSelect,
          update: sessionUpdate,
        };
      }

      if (table === "job_runs") {
        return {
          update: jobUpdate,
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  } as unknown as Pick<SupabaseClient, "channel" | "removeChannel" | "from" | "rpc">;

  await processJob(
    {
      id: 123,
      user_id: "user-1",
      job_type: "memo_agent_chat",
      entity_type: "memo_agent_session",
      entity_id: "session-1",
      status: "running",
      params: {
        user_message: "What is this transcript about?",
        channel_name: "memo-agent:job:1",
        memo_id: "memo-1",
      },
    },
    supabase,
    {
      queryImpl,
      materializeWorkspaceImpl: async () => ({ workspaceDir: "/tmp/memo-agent" }),
      computeCreditCostImpl: () => 1,
    }
  );

  const emittedEvents = sendCalls.map((call) => {
    const row = call as { payload: { type?: string; delta?: string } };
    return row.payload;
  });
  const textDeltaIndex = emittedEvents.findIndex(
    (event) => event.type === "text_delta" && event.delta === "Streaming fallback reply."
  );
  const doneIndex = emittedEvents.findIndex((event) => event.type === "done");

  assert.ok(textDeltaIndex >= 0);
  assert.ok(doneIndex > textDeltaIndex);
  assert.ok(sessionUpdatePayload !== null);
  assert.equal(sessionUpdatePayload!.provider_session_id, "provider-session-1");
  assert.deepEqual(sessionUpdatePayload!.ui_messages, [
    { role: "user", text: "What is this transcript about?" },
    { role: "assistant", text: "Streaming fallback reply." },
  ]);
  assert.match(String(sessionUpdatePayload!.last_active_at), /^\d{4}-/);
});

test("grounds memo chats in workspace transcript files before answering", async () => {
  let queryInput:
    | {
        prompt: string;
        options?: { systemPrompt?: string | { append?: string } };
      }
    | undefined;

  const queryImpl = (
    input: {
      prompt: string;
      options?: { systemPrompt?: string | { append?: string } };
    }
  ) => {
    queryInput = input;
    return makeAsyncStream([
      {
        type: "assistant",
        session_id: "provider-session-1",
        message: {
          content: [{ type: "text", text: "Grounded reply." }],
        },
      },
      {
        type: "result",
        session_id: "provider-session-1",
        usage: {
          input_tokens: 12,
          output_tokens: 34,
        },
      },
    ]);
  };

  const channel = {
    subscribe(callback: (status: string) => void) {
      callback("SUBSCRIBED");
      return channel;
    },
    async send() {},
  };

  const sessionSingle = async () => ({
    data: {
      id: "session-1",
      provider: "anthropic",
      provider_session_id: null,
      ui_messages: [],
    },
    error: null,
  });
  const sessionEq = () => ({ single: sessionSingle });
  const sessionSelect = () => ({ eq: sessionEq });
  const sessionUpdateEq = async () => ({ data: null, error: null });
  const sessionUpdate = () => ({ eq: sessionUpdateEq });
  const jobUpdateEq = async () => ({ data: null, error: null });
  const jobUpdate = () => ({ eq: jobUpdateEq });

  const supabase = {
    channel: () => channel,
    removeChannel: () => {},
    rpc: async () => ({
      data: { ok: true },
      error: null,
    }),
    from: (table: string) => {
      if (table === "memo_agent_sessions") {
        return {
          select: sessionSelect,
          update: sessionUpdate,
        };
      }

      if (table === "job_runs") {
        return {
          update: jobUpdate,
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  } as unknown as Pick<SupabaseClient, "channel" | "removeChannel" | "from" | "rpc">;

  await processJob(
    {
      id: 456,
      user_id: "user-1",
      job_type: "memo_agent_chat",
      entity_type: "memo_agent_session",
      entity_id: "session-1",
      status: "running",
      params: {
        user_message: "Summarize this memo.",
        channel_name: "memo-agent:job:2",
        memo_id: "memo-1",
      },
    },
    supabase,
    {
      queryImpl,
      materializeWorkspaceImpl: async () => ({ workspaceDir: "/tmp/memo-agent" }),
      computeCreditCostImpl: () => 1,
    }
  );

  assert.ok(queryInput);
  assert.equal(queryInput.prompt, "Summarize this memo.");

  const systemPrompt = queryInput.options?.systemPrompt;
  const groundingInstructions =
    typeof systemPrompt === "string" ? systemPrompt : systemPrompt?.append ?? "";

  assert.match(groundingInstructions, /transcript\.md/);
  assert.match(groundingInstructions, /context\.md/);
  assert.match(groundingInstructions, /source of truth/i);
  assert.match(groundingInstructions, /do not claim you cannot access the transcript/i);
});
