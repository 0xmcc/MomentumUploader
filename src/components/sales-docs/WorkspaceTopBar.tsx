"use client";

import {
  AudioLines,
  ChevronDown,
  ClipboardList,
  FileText,
  Menu,
  PanelRight,
  Pause,
  Square,
} from "lucide-react";
import type { SalesDoc } from "@/data/salesDocTypes";

export default function WorkspaceTopBar({
  liveCoaching,
  animated = true,
  onOpenSidebar,
  onOpenLiveCoaching,
}: {
  liveCoaching: SalesDoc["liveCoaching"];
  animated?: boolean;
  onOpenSidebar?: () => void;
  onOpenLiveCoaching?: () => void;
}) {
  return (
    <div className="flex h-[52px] shrink-0 items-center justify-between gap-2 border-b border-[var(--sd-border)] bg-[var(--sd-bg)] px-3 xl:px-4">
      {/* Tabs */}
      <div className="flex h-full min-w-0 items-center gap-1">
        <button
          aria-label="Open navigation"
          className="sd-ghost-btn flex h-8 w-8 shrink-0 items-center justify-center rounded-full lg:hidden"
          onClick={onOpenSidebar}
          type="button"
        >
          <Menu size={15} strokeWidth={2.2} />
        </button>
        <div className="flex h-full min-w-0 items-end gap-1">
          <button className="relative flex items-center gap-2 px-3 pb-3.5 text-[13px] font-medium text-[var(--sd-text)]">
            <FileText size={14} strokeWidth={2} className="text-[var(--sd-purple)]" />
            Artifacts
            <span
              className="absolute inset-x-2 bottom-0 h-[2px] rounded-full"
              style={{ background: "var(--sd-gradient-cool)" }}
            />
          </button>
          <button className="hidden items-center gap-2 px-3 pb-3.5 text-[13px] text-[var(--sd-text-muted)] transition-colors hover:text-[var(--sd-text-secondary)] sm:flex">
            <ClipboardList size={14} strokeWidth={2} />
            Call Brief
          </button>
        </div>
      </div>

      {/* Live coaching status + controls */}
      <div className="flex shrink-0 items-center gap-1.5 sm:gap-2.5">
        <button
          aria-label="Open live coaching"
          className="sd-ghost-btn flex h-8 w-8 shrink-0 items-center justify-center rounded-full xl:hidden"
          onClick={onOpenLiveCoaching}
          type="button"
        >
          <PanelRight size={15} strokeWidth={2.2} />
        </button>
        <div className="hidden items-center gap-2 rounded-full border border-[var(--sd-border-strong)] bg-[var(--sd-panel-raised)] py-1.5 pl-3 pr-3.5 sm:flex">
          <AudioLines
            size={14}
            className={`text-[var(--sd-green)] ${animated ? "sd-blink" : ""}`}
          />
          <span className="text-[12px] font-medium text-[var(--sd-text)]">Live Coaching</span>
          <span className="font-mono text-[12px] tabular-nums text-[var(--sd-text-secondary)]">
            {liveCoaching.timer}
          </span>
        </div>
        <button className="sd-ghost-btn hidden h-8 w-8 items-center justify-center rounded-full sm:flex">
          <Pause size={13} strokeWidth={2.2} />
        </button>
        <button className="hidden h-8 w-8 items-center justify-center rounded-full bg-[var(--sd-red)] text-white transition-[filter] hover:brightness-110 sm:flex">
          <Square size={11} fill="currentColor" />
        </button>
        <button className="hidden items-center gap-1 sm:flex">
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[#4a5878] to-[#2a3148] text-[11px] font-semibold text-[var(--sd-text-secondary)]">
            M
          </span>
          <ChevronDown size={13} className="text-[var(--sd-text-muted)]" />
        </button>
      </div>
    </div>
  );
}
