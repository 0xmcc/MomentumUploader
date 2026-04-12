import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import {
  query,
  type SDKAssistantMessage,
  type SDKMessage,
  type SDKPartialAssistantMessage,
  type SDKResultMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { computeCreditCost } from "./credits";
import { materializeWorkspace } from "./workspace";
import type { AgentStreamEvent, JobRow, MemoAgentSessionRow } from "./types";

const PROVIDER_DEFAULTS = {
  anthropic: { model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5" },
  openai: { model: process.env.OPENAI_MODEL ?? "codex-mini" },
  google: { model: process.env.GOOGLE_MODEL ?? "gemini-2.5-pro" },
} as const;

export const MAX_GLOBAL_JOBS = 5;
const MAX_JOBS_PER_USER = 2;
const activeByUser = new Map<string, number>();

function resolveProvider(provider: string | null | undefined) {
  if (provider === "openai" || provider === "google") {
    return provider;
  }

  return "anthropic";
}

function extractTextDelta(message: SDKMessage): string | null {
  if (message.type !== "stream_event") {
    return null;
  }

  const event = (message as SDKPartialAssistantMessage).event;
  if (event.type !== "content_block_delta" || event.delta.type !== "text_delta") {
    return null;
  }

  return event.delta.text;
}

function extractToolStart(message: SDKMessage): { toolUseId: string; toolName: string } | null {
  if (message.type !== "stream_event") {
    return null;
  }

  const event = (message as SDKPartialAssistantMessage).event;
  if (event.type !== "content_block_start") {
    return null;
  }

  const block = event.content_block;
  if (block.type === "tool_use" || block.type === "mcp_tool_use") {
    return { toolUseId: block.id, toolName: block.name };
  }

  return null;
}

function extractToolResults(
  message: SDKMessage,
  toolNamesById: Map<string, string>
): Array<{ toolName: string; isError: boolean }> {
  if (message.type !== "user") {
    return [];
  }

  const content = (message as SDKUserMessage).message.content;
  if (!Array.isArray(content)) {
    return [];
  }

  const results: Array<{ toolName: string; isError: boolean }> = [];
  for (const block of content) {
    if (typeof block !== "object" || block === null || !("type" in block)) {
      continue;
    }

    const blockType = typeof block.type === "string" ? String(block.type) : "";
    if (
      (blockType === "tool_result" || blockType === "mcp_tool_result") &&
      "tool_use_id" in block &&
      typeof block.tool_use_id === "string"
    ) {
      const toolName = toolNamesById.get(block.tool_use_id) ?? "Tool";
      const isError =
        "is_error" in block && typeof block.is_error === "boolean" ? block.is_error : false;
      results.push({ toolName, isError });
      toolNamesById.delete(block.tool_use_id);
    }
  }

  return results;
}

function extractAssistantText(message: SDKAssistantMessage): string {
  return message.message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("");
}

function extractUsage(message: SDKResultMessage) {
  const usage = message.usage;
  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
  };
}

async function subscribeChannel(channel: RealtimeChannel) {
  await new Promise<void>((resolve) => {
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        resolve();
      }
    });
  });
}

function asUiMessages(
  value: MemoAgentSessionRow["ui_messages"]
): Array<{ role: "user" | "assistant"; text: string }> {
  return Array.isArray(value) ? value : [];
}

export async function processJob(
  job: JobRow,
  supabase: Pick<SupabaseClient, "channel" | "removeChannel" | "from" | "rpc">
) {
  const { user_message, channel_name, memo_id } = job.params;

  if ((activeByUser.get(job.user_id) ?? 0) >= MAX_JOBS_PER_USER) {
    await supabase
      .from("job_runs")
      .update({ status: "pending", started_at: null })
      .eq("id", job.id);
    return;
  }

  activeByUser.set(job.user_id, (activeByUser.get(job.user_id) ?? 0) + 1);

  const { data: session, error: sessionError } = await supabase
    .from("memo_agent_sessions")
    .select("id, provider, provider_session_id, ui_messages")
    .eq("id", job.entity_id)
    .single();

  if (sessionError || !session) {
    throw new Error(`Memo agent session ${job.entity_id} not found.`);
  }

  const sessionRow = session as MemoAgentSessionRow;
  const provider = resolveProvider(sessionRow.provider);
  const { model } = PROVIDER_DEFAULTS[provider];
  const { workspaceDir } = await materializeWorkspace(sessionRow.id, memo_id, supabase as never);

  const channel = supabase.channel(channel_name);
  await subscribeChannel(channel);

  const emit = (event: AgentStreamEvent) =>
    channel.send({ type: "broadcast", event: event.type, payload: event });

  try {
    let providerSessionId = sessionRow.provider_session_id ?? undefined;
    let accumulatedAssistantText = "";
    let sawStreamText = false;
    let inputTokens = 0;
    let outputTokens = 0;
    let toolRounds = 0;
    const toolNamesById = new Map<string, string>();

    for await (const message of query({
      prompt: user_message,
      options: {
        cwd: workspaceDir,
        allowedTools: ["Read", "Glob", "Grep"],
        model,
        ...(sessionRow.provider_session_id ? { resume: sessionRow.provider_session_id } : {}),
      },
    })) {
      providerSessionId = providerSessionId ?? message.session_id;

      const textDelta = extractTextDelta(message);
      if (textDelta) {
        accumulatedAssistantText += textDelta;
        sawStreamText = true;
        await emit({ type: "text_delta", delta: textDelta });
      }

      const toolStart = extractToolStart(message);
      if (toolStart) {
        toolNamesById.set(toolStart.toolUseId, toolStart.toolName);
        await emit({ type: "tool_start", toolName: toolStart.toolName });
      }

      for (const result of extractToolResults(message, toolNamesById)) {
        toolRounds += 1;
        await emit({
          type: "tool_result",
          toolName: result.toolName,
          isError: result.isError,
        });
      }

      if (message.type === "assistant" && !sawStreamText) {
        accumulatedAssistantText += extractAssistantText(message);
      }

      if (message.type === "result") {
        const usage = extractUsage(message);
        inputTokens = usage.inputTokens;
        outputTokens = usage.outputTokens;
      }
    }

    const creditCost = computeCreditCost(provider, {
      inputTokens,
      outputTokens,
      toolRounds,
    });

    const { data: deductData, error: deductError } = await supabase.rpc("deduct_credits", {
      p_user_id: job.user_id,
      p_job_id: job.id,
      p_amount: creditCost,
      p_detail: {
        provider,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        tool_rounds: toolRounds,
      },
    });

    if (deductError || !deductData || deductData.ok === false) {
      await supabase
        .from("job_runs")
        .update({
          status: "failed",
          finished_at: new Date().toISOString(),
          error: deductData?.error ?? deductError?.message ?? "credit_deduction_failed",
        })
        .eq("id", job.id);
      await emit({ type: "error", message: "Insufficient credits." });
      return;
    }

    const uiMessages = asUiMessages(sessionRow.ui_messages);
    await supabase
      .from("memo_agent_sessions")
      .update({
        provider_session_id: providerSessionId ?? null,
        ui_messages: [
          ...uiMessages,
          { role: "user", text: user_message },
          { role: "assistant", text: accumulatedAssistantText },
        ],
        last_active_at: new Date().toISOString(),
      })
      .eq("id", sessionRow.id);

    await supabase
      .from("job_runs")
      .update({
        status: "succeeded",
        finished_at: new Date().toISOString(),
        result: {
          credits_deducted: creditCost,
          provider_session_id: providerSessionId ?? null,
        },
      })
      .eq("id", job.id);

    await emit({ type: "done", creditCost });
  } catch (error) {
    await supabase
      .from("job_runs")
      .update({
        status: "failed",
        finished_at: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      })
      .eq("id", job.id);
    await emit({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    activeByUser.set(job.user_id, Math.max(0, (activeByUser.get(job.user_id) ?? 1) - 1));
    supabase.removeChannel(channel);
  }
}
