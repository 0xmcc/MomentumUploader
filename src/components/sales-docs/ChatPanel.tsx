"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, CheckCircle2, ClipboardPaste, FileText, Lightbulb, Upload } from "lucide-react";
import type { ChatSession } from "@/data/salesDocTypes";
import WhimsicalLoadingSpinner from "./WhimsicalLoadingSpinner";

function AssistantAvatar() {
  return (
    <div
      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-white"
      style={{ background: "var(--sd-gradient-btn)" }}
    >
      <FileText size={12} strokeWidth={2.2} />
    </div>
  );
}

function UserAvatar({ name }: { name: string }) {
  return (
    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-[#3b4a6b] to-[#22293d] text-[10px] font-semibold text-[var(--sd-text-secondary)]">
      {name.slice(0, 1).toUpperCase()}
    </div>
  );
}

export default function ChatPanel({
  prompt,
  chat,
  userName = "M",
  onGenerate,
  pendingPrompt = null,
  error = null,
  showSessionChat = true,
}: {
  prompt: string;
  chat: ChatSession;
  userName?: string;
  onGenerate?: (prompt: string) => void;
  pendingPrompt?: string | null;
  error?: string | null;
  /** Off while seeding a new session: the pending prompt is the first message. */
  showSessionChat?: boolean;
}) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const isGenerating = pendingPrompt !== null;

  // Keep the generating indicator in view when it appears.
  useEffect(() => {
    if (isGenerating && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [isGenerating]);

  function submit() {
    const text = draft.trim();
    if (!text || !onGenerate || isGenerating) return;
    onGenerate(text);
    setDraft("");
  }

  return (
    <div className="flex h-full w-[324px] shrink-0 flex-col border-r border-[var(--sd-border)] bg-[var(--sd-bg)]">
      {/* Header */}
      <div className="flex items-center gap-2 px-5 pt-5 pb-3">
        <h2 className="text-[14px] font-semibold tracking-tight text-[var(--sd-text)]">
          Call Prep Assistant
        </h2>
        <span className="rounded border border-[var(--sd-border-strong)] bg-[var(--sd-panel-raised)] px-1.5 py-px text-[9.5px] font-semibold tracking-wide text-[var(--sd-text-secondary)]">
          AI
        </span>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-2">
        {showSessionChat && (
          <>
          {/* User prompt */}
          <div className="flex items-end justify-end gap-2">
            <div className="max-w-[85%] rounded-2xl rounded-br-md border border-[rgba(139,92,246,0.25)] bg-[rgba(99,82,200,0.22)] px-3.5 py-3">
              <p className="text-[12.5px] leading-relaxed text-[var(--sd-text)]">{prompt}</p>
              <div className="mt-2 text-[10px] text-[var(--sd-text-faint)]">
                {chat.userTimestamp}
              </div>
            </div>
            <UserAvatar name={userName} />
          </div>

          {/* Assistant intro */}
          <div className="mt-4 flex items-end gap-2">
            <AssistantAvatar />
            <div className="max-w-[85%] rounded-2xl rounded-bl-md border border-[var(--sd-border)] bg-[var(--sd-panel-raised)] px-3.5 py-3">
              <p className="text-[12.5px] leading-relaxed text-[var(--sd-text-secondary)]">
                {chat.assistantIntro}
              </p>
              <div className="mt-2 text-[10px] text-[var(--sd-text-faint)]">
                {chat.assistantTimestamp}
              </div>
            </div>
          </div>

          {/* Generated checklist */}
          <div className="mt-3 ml-8 rounded-xl border border-[var(--sd-border)] bg-[var(--sd-panel)] px-3.5 py-3">
            <div className="flex flex-col gap-2.5">
              {chat.generatedChecklist.map((item) => (
                <div key={item} className="flex items-center gap-2.5">
                  <CheckCircle2 size={14} className="shrink-0 text-[var(--sd-green)]" />
                  <span className="text-[12px] text-[var(--sd-text-secondary)]">{item}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Assistant outro */}
          <div className="mt-4 flex items-end gap-2">
            <AssistantAvatar />
            <div className="max-w-[85%] rounded-2xl rounded-bl-md border border-[var(--sd-border)] bg-[var(--sd-panel-raised)] px-3.5 py-3">
              <p className="text-[12.5px] leading-relaxed text-[var(--sd-text-secondary)]">
                {chat.assistantOutro}
              </p>
              <div className="mt-2 text-[10px] text-[var(--sd-text-faint)]">
                {chat.assistantTimestamp}
              </div>
            </div>
          </div>
          </>
        )}

        {/* In-flight generation: the new prompt + a working indicator */}
        {isGenerating && (
          <>
            <div className="mt-4 flex items-end justify-end gap-2">
              <div className="max-w-[85%] rounded-2xl rounded-br-md border border-[rgba(139,92,246,0.25)] bg-[rgba(99,82,200,0.22)] px-3.5 py-3">
                <p className="text-[12.5px] leading-relaxed text-[var(--sd-text)]">
                  {pendingPrompt}
                </p>
              </div>
              <UserAvatar name={userName} />
            </div>
            <div className="mt-4 flex items-end gap-2">
              <AssistantAvatar />
              <div className="max-w-[85%] rounded-2xl rounded-bl-md border border-[var(--sd-border)] bg-[var(--sd-panel-raised)] px-3.5 py-3">
                <WhimsicalLoadingSpinner />
              </div>
            </div>
          </>
        )}
      </div>

      {/* Composer */}
      <div className="px-4 pb-4">
        {error && (
          <div className="mb-2 rounded-lg border border-[rgba(244,114,114,0.35)] bg-[rgba(244,114,114,0.08)] px-3 py-2 text-[11.5px] leading-snug text-[var(--sd-red,#f47272)]">
            {error}
          </div>
        )}
        <div className="rounded-xl border border-[var(--sd-border-strong)] bg-[var(--sd-input)] px-3 pt-3 pb-2.5">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Describe your client or situation..."
            rows={2}
            disabled={isGenerating}
            className="mb-1 w-full resize-none bg-transparent pb-2 text-[12.5px] leading-relaxed text-[var(--sd-text)] placeholder:text-[var(--sd-text-faint)] focus:outline-none disabled:opacity-50"
          />
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <button className="sd-ghost-btn flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px]">
                <Upload size={11} strokeWidth={2} />
                Upload Call Notes
              </button>
              <button className="sd-ghost-btn flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px]">
                <ClipboardPaste size={11} strokeWidth={2} />
                Paste Transcript
              </button>
            </div>
            <button
              onClick={submit}
              disabled={isGenerating || !draft.trim()}
              aria-label="Generate call prep document"
              className="flex h-7 w-7 items-center justify-center rounded-full text-white transition-opacity disabled:opacity-40"
              style={{ background: "var(--sd-gradient-cool)" }}
            >
              <ArrowUp size={14} strokeWidth={2.4} />
            </button>
          </div>
        </div>

        {/* Pro tip */}
        <div className="mt-2.5 flex items-start gap-2 rounded-lg border border-[var(--sd-border)] bg-[var(--sd-panel)] px-3 py-2.5">
          <Lightbulb size={13} className="mt-px shrink-0 text-[var(--sd-amber)]" />
          <p className="text-[11px] leading-snug text-[var(--sd-text-muted)]">
            Pro tip: Upload a call recording or transcript for even more tailored prep
          </p>
        </div>
      </div>
    </div>
  );
}
