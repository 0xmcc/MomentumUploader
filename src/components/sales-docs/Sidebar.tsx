"use client";

import Link from "next/link";
import {
  BarChart3,
  FileText,
  HelpCircle,
  History,
  LayoutDashboard,
  LayoutTemplate,
  MessageCircleQuestion,
  Phone,
  Plus,
  ScrollText,
  Settings,
  ShieldAlert,
} from "lucide-react";

type SidebarSessionItem = {
  id: string | null;
  label: string;
  lastActive: string;
};

const NAV_ITEMS = [
  { label: "Dashboard", icon: LayoutDashboard, active: false },
  { label: "Call Prep", icon: Phone, active: true },
  { label: "Recent Calls", icon: History, active: false },
  { label: "Templates", icon: LayoutTemplate, active: false },
  { label: "Scripts", icon: ScrollText, active: false },
  { label: "Questions", icon: MessageCircleQuestion, active: false },
  { label: "Objection Library", icon: ShieldAlert, active: false },
  { label: "Analytics", icon: BarChart3, active: false },
];

export default function Sidebar({
  sessions,
  activeSessionId,
  onSelectSession,
}: {
  sessions: SidebarSessionItem[];
  activeSessionId: string;
  onSelectSession: (id: string) => void;
}) {
  return (
    <aside className="flex h-full w-[236px] shrink-0 flex-col border-r border-[var(--sd-border)] bg-[var(--sd-bg)]">
      {/* Logo row */}
      <Link href="/sales-docs-landing" className="flex items-center gap-2.5 px-4 pt-5 pb-4 transition-opacity hover:opacity-80">
        <div
          className="flex h-7 w-7 items-center justify-center rounded-lg text-white"
          style={{ background: "var(--sd-gradient-btn)" }}
        >
          <FileText size={15} strokeWidth={2.2} />
        </div>
        <span className="text-[15px] font-semibold tracking-tight text-[var(--sd-text)]">
          Sales Docs
        </span>
        <span className="rounded-md border border-[var(--sd-border-strong)] bg-[var(--sd-panel-raised)] px-1.5 py-px text-[10px] font-medium text-[var(--sd-text-secondary)]">
          Pro
        </span>
      </Link>

      {/* New Session */}
      <div className="px-3 pb-4">
        <button className="sd-gradient-btn flex w-full items-center justify-center gap-2 rounded-[10px] py-2 text-[13px] font-medium">
          <Plus size={15} strokeWidth={2.4} />
          New Session
        </button>
      </div>

      {/* Nav */}
      <nav className="flex flex-col gap-0.5 px-2">
        {NAV_ITEMS.map(({ label, icon: Icon, active }) => (
          <button
            key={label}
            className={`flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-left text-[13px] transition-colors ${
              active
                ? "bg-[var(--sd-purple-soft)] font-medium text-[var(--sd-text)]"
                : "text-[var(--sd-text-muted)] hover:bg-white/[0.03] hover:text-[var(--sd-text-secondary)]"
            }`}
          >
            <Icon
              size={15}
              strokeWidth={2}
              className={active ? "text-[var(--sd-purple)]" : ""}
            />
            {label}
          </button>
        ))}
      </nav>

      {/* Recent sessions */}
      <div className="mt-6 flex-1 overflow-y-auto px-2">
        <div className="px-2.5 pb-2 text-[11px] font-medium text-[var(--sd-text-faint)]">
          Recent Sessions
        </div>
        <div className="flex flex-col gap-0.5">
          {sessions.map((s) => {
            const selectable = s.id !== null;
            const active = selectable && s.id === activeSessionId;
            return (
              <button
                key={s.label}
                onClick={selectable ? () => onSelectSession(s.id as string) : undefined}
                className={`flex items-center justify-between rounded-lg px-2.5 py-[7px] text-left text-[12.5px] transition-colors ${
                  active
                    ? "bg-white/[0.04] text-[var(--sd-text)]"
                    : "text-[var(--sd-text-muted)] hover:bg-white/[0.03] hover:text-[var(--sd-text-secondary)]"
                } ${selectable ? "cursor-pointer" : "cursor-default"}`}
              >
                <span className="truncate">{s.label}</span>
                <span className="ml-2 shrink-0 text-[11px] text-[var(--sd-text-faint)]">
                  {s.lastActive}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Bottom */}
      <div className="flex flex-col gap-0.5 border-t border-[var(--sd-border)] px-2 py-3">
        <button className="flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-left text-[13px] text-[var(--sd-text-muted)] transition-colors hover:bg-white/[0.03] hover:text-[var(--sd-text-secondary)]">
          <Settings size={15} strokeWidth={2} />
          Settings
        </button>
        <button className="flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-left text-[13px] text-[var(--sd-text-muted)] transition-colors hover:bg-white/[0.03] hover:text-[var(--sd-text-secondary)]">
          <HelpCircle size={15} strokeWidth={2} />
          Help & Docs
        </button>
      </div>
    </aside>
  );
}
