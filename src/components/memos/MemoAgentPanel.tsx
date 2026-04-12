"use client";

import type { ReactNode } from "react";
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

async function fetchHistory(
  memoId: string,
  sessionId: string,
  shareToken: string
): Promise<HistoryResponse> {
  const historyResponse = await fetch(
    `/api/memo-agent/${memoId}/history?sessionId=${sessionId}&shareToken=${encodeURIComponent(
      shareToken
    )}`
  );
  const historyData = (await historyResponse.json()) as HistoryResponse & {
    error?: string;
  };

  if (!historyResponse.ok) {
    throw new Error(historyData.error ?? "Failed to load memo agent history.");
  }

  return historyData;
}

function formatCredits(value: number): string {
  return String(Math.floor(value));
}

function createMessageId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`;
}

function normalizeMarkdownHref(href: string): string | null {
  try {
    const url = new URL(href);
    if (url.protocol === "http:" || url.protocol === "https:") {
      return url.toString();
    }
  } catch {
    return null;
  }

  return null;
}

function renderInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern =
    /(\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|`([^`]+)`|\*([^*]+)\*)/g;
  let lastIndex = 0;
  let matchIndex = 0;

  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;

    if (start > lastIndex) {
      nodes.push(text.slice(lastIndex, start));
    }

    const [fullMatch, _token, linkLabel, linkHref, strongText, codeText, emphasisText] = match;
    const key = `${keyPrefix}-${matchIndex}`;

    if (linkLabel && linkHref) {
      const safeHref = normalizeMarkdownHref(linkHref);
      nodes.push(
        safeHref ? (
          <a
            key={key}
            href={safeHref}
            target="_blank"
            rel="noreferrer"
            className="font-medium text-stone-900 underline decoration-orange-400 underline-offset-4"
          >
            {renderInlineMarkdown(linkLabel, `${key}-link`)}
          </a>
        ) : (
          fullMatch
        )
      );
    } else if (strongText) {
      nodes.push(
        <strong key={key} className="font-semibold text-stone-900">
          {renderInlineMarkdown(strongText, `${key}-strong`)}
        </strong>
      );
    } else if (codeText) {
      nodes.push(
        <code
          key={key}
          className="rounded-md bg-stone-200 px-1.5 py-0.5 font-mono text-[0.92em] text-stone-900"
        >
          {codeText}
        </code>
      );
    } else if (emphasisText) {
      nodes.push(
        <em key={key} className="italic">
          {renderInlineMarkdown(emphasisText, `${key}-em`)}
        </em>
      );
    } else {
      nodes.push(fullMatch);
    }

    lastIndex = start + fullMatch.length;
    matchIndex += 1;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

function renderAssistantMarkdown(text: string): ReactNode {
  const normalizedText = text.replace(/\r\n/g, "\n").trim();
  if (!normalizedText) {
    return null;
  }

  const lines = normalizedText.split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index]?.trim() ?? "";

    if (!line) {
      index += 1;
      continue;
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const content = headingMatch[2];
      const className =
        level === 1
          ? "text-lg font-semibold tracking-tight text-stone-900"
          : level === 2
            ? "text-base font-semibold tracking-tight text-stone-900"
            : "text-sm font-semibold uppercase tracking-[0.08em] text-stone-700";

      blocks.push(
        <p key={`heading-${index}`} className={className}>
          {renderInlineMarkdown(content, `heading-${index}`)}
        </p>
      );
      index += 1;
      continue;
    }

    const orderedMatch = line.match(/^\d+\.\s+(.+)$/);
    if (orderedMatch) {
      const items: ReactNode[] = [];
      let listIndex = index;

      while (listIndex < lines.length) {
        const currentLine = lines[listIndex]?.trim() ?? "";
        const currentMatch = currentLine.match(/^\d+\.\s+(.+)$/);
        if (!currentMatch) {
          break;
        }

        items.push(
          <li key={`ordered-${listIndex}`} className="pl-1">
            {renderInlineMarkdown(currentMatch[1], `ordered-${listIndex}`)}
          </li>
        );
        listIndex += 1;
      }

      blocks.push(
        <ol
          key={`ordered-list-${index}`}
          className="list-decimal space-y-2 pl-5 marker:font-semibold marker:text-stone-500"
        >
          {items}
        </ol>
      );
      index = listIndex;
      continue;
    }

    const unorderedMatch = line.match(/^[-*+]\s+(.+)$/);
    if (unorderedMatch) {
      const items: ReactNode[] = [];
      let listIndex = index;

      while (listIndex < lines.length) {
        const currentLine = lines[listIndex]?.trim() ?? "";
        const currentMatch = currentLine.match(/^[-*+]\s+(.+)$/);
        if (!currentMatch) {
          break;
        }

        items.push(
          <li key={`unordered-${listIndex}`} className="pl-1">
            {renderInlineMarkdown(currentMatch[1], `unordered-${listIndex}`)}
          </li>
        );
        listIndex += 1;
      }

      blocks.push(
        <ul key={`unordered-list-${index}`} className="list-disc space-y-2 pl-5">
          {items}
        </ul>
      );
      index = listIndex;
      continue;
    }

    const paragraphLines: string[] = [line];
    let paragraphIndex = index + 1;

    while (paragraphIndex < lines.length) {
      const currentLine = lines[paragraphIndex]?.trim() ?? "";
      if (
        !currentLine ||
        /^#{1,3}\s+/.test(currentLine) ||
        /^\d+\.\s+/.test(currentLine) ||
        /^[-*+]\s+/.test(currentLine)
      ) {
        break;
      }

      paragraphLines.push(currentLine);
      paragraphIndex += 1;
    }

    blocks.push(
      <p key={`paragraph-${index}`} className="text-[15px] leading-7 text-stone-800">
        {renderInlineMarkdown(paragraphLines.join(" "), `paragraph-${index}`)}
      </p>
    );
    index = paragraphIndex;
  }

  return <div className="space-y-3">{blocks}</div>;
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

        const historyData = await fetchHistory(memoId, sessionData.sessionId, shareToken);

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
            const shouldReloadHistory = activeAssistantMessageIdRef.current === null;
            const currentChannel = channelRef.current;

            setCreditBalance((current) => Number((current - event.creditCost).toFixed(4)));
            activeAssistantMessageIdRef.current = null;

            const finish = async () => {
              try {
                if (shouldReloadHistory) {
                  const historyData = await fetchHistory(memoId, sessionId, shareToken);
                  setMessages(toUiMessages(historyData.messages ?? []));
                }
              } catch (cause) {
                setError(
                  cause instanceof Error
                    ? cause.message
                    : "Failed to load memo agent history."
                );
              } finally {
                setIsSending(false);
                if (currentChannel) {
                  supabase.removeChannel(currentChannel as never);
                }
                if (channelRef.current === currentChannel) {
                  channelRef.current = null;
                }
              }
            };

            void finish();
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
    <section className="flex min-h-[720px] flex-col rounded-3xl border border-orange-200/60 bg-[#fffaf1] p-6 text-stone-900 shadow-[0_32px_80px_-48px_rgba(25,20,10,0.45)] lg:h-full lg:min-h-0">
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
            {message.role === "assistant" ? renderAssistantMarkdown(message.text) : message.text}
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
          className="min-h-18 w-full resize-none border-0 bg-transparent p-2 text-sm text-stone-900 outline-none placeholder:text-stone-400 disabled:cursor-not-allowed disabled:text-stone-400"
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
