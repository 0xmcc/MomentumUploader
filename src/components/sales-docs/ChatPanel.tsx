"use client";

import { ArrowUp, CheckCircle2, ClipboardPaste, FileText, Lightbulb, Upload } from "lucide-react";
import type { ChatSession } from "@/data/salesDocTypes";

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
}: {
  prompt: string;
  chat: ChatSession;
  userName?: string;
}) {
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
      <div className="flex-1 overflow-y-auto px-4 py-2">
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
      </div>

      {/* Composer */}
      <div className="px-4 pb-4">
        <div className="rounded-xl border border-[var(--sd-border-strong)] bg-[var(--sd-input)] px-3 pt-3 pb-2.5">
          <div className="pb-3 text-[12.5px] text-[var(--sd-text-faint)]">
            Describe your client or situation...
          </div>
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
              className="flex h-7 w-7 items-center justify-center rounded-full text-white"
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
