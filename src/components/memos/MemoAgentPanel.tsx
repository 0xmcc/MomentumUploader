"use client";

import { useEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { AgentStreamEvent, PersistedUIMessage, UIMessage } from "@/lib/memo-agent-types";

type Props = {
  memoId: string;
  shareToken: string;
};

type SessionResponse = {
  sessionId: string;
  creditBalance: number;
  hasHistory: boolean;
};

type HistoryResponse = {
  messages: PersistedUIMessage[];
  hasHistory: boolean;
};

type ChatResponse = {
  jobId: number;
  channelName: string;
};

function formatCredits(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(4)));
}

function createMessageId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function toUiMessages(messages: PersistedUIMessage[]): UIMessage[] {
  return messages.map((message, index) => ({
    id: `history-${index}`,
    ...message,
  }));
}

export default function MemoAgentPanel({ memoId, shareToken }: Props) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [creditBalance, setCreditBalance] = useState<number>(100);
  const [isBootstrapping, setIsBootstrapping] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const channelRef = useRef<{ on: (...args: unknown[]) => unknown } | null>(null);
  const activeAssistantMessageIdRef = useRef<string | null>(null);

  useEffect(() => {
    let isCancelled = false;

    async function bootstrap() {
      setIsBootstrapping(true);
      setError(null);

      try {
        const sessionResponse = await fetch(`/api/memo-agent/${memoId}/session`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ shareToken }),
        });
        const sessionData = (await sessionResponse.json()) as SessionResponse & {
          error?: string;
        };

        if (!sessionResponse.ok) {
          throw new Error(sessionData.error ?? "Failed to create memo agent session.");
        }

        if (isCancelled) {
          return;
        }

        setSessionId(sessionData.sessionId);
        setCreditBalance(Number(sessionData.creditBalance));

        const historyResponse = await fetch(
          `/api/memo-agent/${memoId}/history?sessionId=${sessionData.sessionId}&shareToken=${encodeURIComponent(
            shareToken
          )}`
        );
        const historyData = (await historyResponse.json()) as HistoryResponse & {
          error?: string;
        };

        if (!historyResponse.ok) {
          throw new Error(historyData.error ?? "Failed to load memo agent history.");
        }

        if (!isCancelled) {
          activeAssistantMessageIdRef.current = null;
          setMessages(toUiMessages(historyData.messages ?? []));
        }
      } catch (cause) {
        if (!isCancelled) {
          setError(cause instanceof Error ? cause.message : "Failed to load memo agent.");
        }
      } finally {
        if (!isCancelled) {
          setIsBootstrapping(false);
        }
      }
    }

    void bootstrap();

    return () => {
      isCancelled = true;
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current as never);
        channelRef.current = null;
      }
    };
  }, [memoId, shareToken]);

  async function sendMessage() {
    if (!sessionId || isSending) {
      return;
    }

    const message = draft.trim();
    if (!message) {
      return;
    }

    setDraft("");
    setError(null);
    setIsSending(true);
    activeAssistantMessageIdRef.current = null;
    setMessages((current) => [
      ...current,
      { id: createMessageId("user"), role: "user", text: message },
    ]);

    try {
      const response = await fetch(`/api/memo-agent/${memoId}/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sessionId,
          message,
          shareToken,
        }),
      });
      const data = (await response.json()) as ChatResponse & { error?: string };

      if (!response.ok) {
        throw new Error(data.error ?? "Failed to queue chat job.");
      }

      const nextChannel = supabase.channel(data.channelName);
      channelRef.current = nextChannel as never;

      nextChannel
        .on("broadcast", { event: "*" }, (payload: { payload: AgentStreamEvent }) => {
          const event = payload.payload;

          if (event.type === "text_delta") {
            const assistantMessageId =
              activeAssistantMessageIdRef.current ?? createMessageId("assistant");
            activeAssistantMessageIdRef.current = assistantMessageId;

            setMessages((current) => {
              const hasAssistantMessage = current.some(
                (message) => message.id === assistantMessageId
              );

              if (hasAssistantMessage) {
                return current.map((message) =>
                  message.id === assistantMessageId
                    ? { ...message, text: `${message.text}${event.delta}` }
                    : message
                );
              }

              return [
                ...current,
                { id: assistantMessageId, role: "assistant", text: event.delta },
              ];
            });
            return;
          }

          if (event.type === "tool_start") {
            setMessages((current) => [
              ...current,
              {
                id: createMessageId("tool"),
                role: "assistant",
                text: `Using ${event.toolName}...`,
              },
            ]);
            return;
          }

          if (event.type === "tool_result") {
            setMessages((current) => [
              ...current,
              {
                id: createMessageId("tool"),
                role: "assistant",
                text: event.isError
                  ? `${event.toolName} returned an error.`
                  : `${event.toolName} finished.`,
              },
            ]);
            return;
          }

          if (event.type === "error") {
            setError(event.message);
            setIsSending(false);
            activeAssistantMessageIdRef.current = null;
            if (channelRef.current) {
              supabase.removeChannel(channelRef.current as never);
              channelRef.current = null;
            }
            return;
          }

          if (event.type === "done") {
            setCreditBalance((current) => Number((current - event.creditCost).toFixed(4)));
            setIsSending(false);
            activeAssistantMessageIdRef.current = null;
            if (channelRef.current) {
              supabase.removeChannel(channelRef.current as never);
              channelRef.current = null;
            }
          }
        })
        .subscribe();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Failed to queue chat job.");
      setIsSending(false);
      activeAssistantMessageIdRef.current = null;
    }
  }

  return (
    <section className="flex min-h-[720px] flex-col rounded-3xl border border-orange-200/60 bg-[#fffaf1] p-6 text-stone-900 shadow-[0_32px_80px_-48px_rgba(25,20,10,0.45)]">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-orange-700/70">
            Claude Code, but for your meetings
          </p>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">Memo agent</h2>
        </div>
        <div className="rounded-full border border-stone-300 bg-white px-4 py-2 text-sm font-medium text-stone-700">
          {formatCredits(creditBalance)} credits
        </div>
      </div>

      <div className="flex-1 space-y-3 overflow-y-auto rounded-3xl border border-stone-200 bg-white p-4">
        {isBootstrapping ? (
          <p className="text-sm text-stone-500">Loading memo context…</p>
        ) : null}

        {!isBootstrapping && messages.length === 0 ? (
          <p className="text-sm text-stone-500">
            Ask for action items, decisions, blockers, or anything else in the memo.
          </p>
        ) : null}

        {messages.map((message) => (
          <div
            key={message.id}
            className={`max-w-[90%] rounded-2xl px-4 py-3 text-sm leading-6 ${
              message.role === "user"
                ? "ml-auto bg-stone-900 text-white"
                : "bg-[#f4eee0] text-stone-800"
            }`}
          >
            {message.text}
          </div>
        ))}
      </div>

      {error ? (
        <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : null}

      <div className="mt-4 rounded-3xl border border-stone-200 bg-white p-3">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void sendMessage();
            }
          }}
          disabled={isBootstrapping || isSending || !sessionId}
          placeholder="Ask this memo anything..."
          className="min-h-28 w-full resize-none border-0 bg-transparent p-2 text-sm text-stone-900 outline-none placeholder:text-stone-400 disabled:cursor-not-allowed disabled:text-stone-400"
        />
        <div className="flex items-center justify-between border-t border-stone-100 px-2 pt-3">
          <p className="text-xs text-stone-400">Enter to send. Shift+Enter for a newline.</p>
          <button
            type="button"
            onClick={() => void sendMessage()}
            disabled={isBootstrapping || isSending || !sessionId || draft.trim().length === 0}
            className="rounded-full bg-stone-900 px-4 py-2 text-sm font-medium text-white transition disabled:cursor-not-allowed disabled:bg-stone-300"
          >
            Send
          </button>
        </div>
      </div>
    </section>
  );
}
