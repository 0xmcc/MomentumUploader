import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import {
  ArrowUpRight,
  FileText,
  MessageSquare,
  Mic,
  PanelLeft,
  Plus,
  Search,
  Sun,
  Upload,
} from "lucide-react";
import { redirect } from "next/navigation";
import "@/components/sales-docs/sales-docs.css";

export const metadata: Metadata = {
  title: "Sales Docs — Record a Call",
  description: "Record or upload a sales call to generate a call prep doc.",
};

const RECORDINGS = [
  { name: "Gardner", when: "Jun 8, 11:06 AM", meta: "61:30  ·  $18.45" },
  { name: "Closer Support Call", when: "Jun 8, 9:39 AM", meta: "30:28  ·  $9.14" },
  { name: "DeShawn", when: "Jun 6, 12:45 PM", meta: "101:23  ·  $30.42" },
  { name: "Impromptu Zoom Meeting", when: "Jun 5, 2:41 PM", meta: "36:24  ·  $10.92" },
  { name: "Impromptu Google Meet", when: "Jun 5, 1:05 PM", meta: "54:29  ·  $16.35" },
];

// Idle waveform silhouette flanking the mic button.
const IDLE_WAVE = [
  10, 18, 26, 14, 22, 30, 12, 24, 34, 16, 28, 20, 12, 26, 18, 32, 14, 22, 28, 16,
  24, 12, 30, 20, 14, 26, 22, 16, 28, 12,
];

function IdleWaveform() {
  return (
    <div className="flex items-center gap-[3px]">
      {IDLE_WAVE.map((h, i) => (
        <span
          key={i}
          className="w-[2px] rounded-full bg-white/20"
          style={{ height: h }}
        />
      ))}
    </div>
  );
}

export default async function SalesDocsRecordingPage() {
  const { userId } = await auth();

  if (!userId) {
    redirect(
      `/sign-in?redirect_url=${encodeURIComponent("/sales-docs-recording")}`
    );
  }

  return (
    <main className="sd-root fixed inset-0 z-50 flex h-dvh w-screen bg-[var(--sd-bg)]">
      {/* Sidebar */}
      <aside className="flex w-[256px] shrink-0 flex-col border-r border-[var(--sd-border)] bg-[var(--sd-bg)]">
        <div className="flex items-center justify-between px-4 pt-5 pb-4">
          <div className="flex items-center gap-2.5">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-[9px] text-white"
              style={{ background: "var(--sd-gradient-btn)" }}
            >
              <FileText size={15} strokeWidth={2.2} />
            </div>
            <span className="text-[15px] font-semibold tracking-tight">Sales Docs</span>
          </div>
          <div className="flex items-center gap-1 text-[var(--sd-text-muted)]">
            <button className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-white/[0.04] hover:text-[var(--sd-text-secondary)]">
              <PanelLeft size={15} />
            </button>
            <button className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-white/[0.04] hover:text-[var(--sd-text-secondary)]">
              <Plus size={16} />
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="px-3 pb-3">
          <div className="flex items-center gap-2 rounded-lg border border-[var(--sd-border)] bg-[var(--sd-input)] px-3 py-2">
            <Search size={13} className="text-[var(--sd-text-faint)]" />
            <span className="text-[12.5px] text-[var(--sd-text-faint)]">
              Search transcripts...
            </span>
          </div>
        </div>

        {/* Mode nav */}
        <nav className="flex flex-col gap-0.5 border-b border-[var(--sd-border)] px-3 pb-3">
          <button className="flex items-center gap-2.5 rounded-lg bg-white/[0.05] px-3 py-2 text-left text-[11.5px] font-semibold tracking-[0.08em] text-[var(--sd-text)]">
            <Mic size={13} strokeWidth={2.2} />
            RECORD
          </button>
          <button className="flex items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[11.5px] font-semibold tracking-[0.08em] text-[var(--sd-text-muted)] transition-colors hover:bg-white/[0.03] hover:text-[var(--sd-text-secondary)]">
            <MessageSquare size={13} strokeWidth={2.2} />
            FEED
          </button>
        </nav>

        {/* Recordings list */}
        <div className="flex-1 overflow-y-auto py-2">
          {RECORDINGS.map((rec) => (
            <button
              key={rec.name}
              className="flex w-full flex-col gap-0.5 border-b border-[var(--sd-border)] px-4 py-3 text-left transition-colors hover:bg-white/[0.02]"
            >
              <span className="text-[13px] font-medium text-[var(--sd-text)]">{rec.name}</span>
              <span className="flex items-center justify-between text-[11.5px] text-[var(--sd-text-faint)]">
                <span>{rec.when}</span>
                <span className="whitespace-pre">{rec.meta}</span>
              </span>
            </button>
          ))}
        </div>
      </aside>

      {/* Main recording area */}
      <section className="relative flex min-w-0 flex-1 flex-col bg-[var(--sd-bg-deep)]">
        {/* Top-right utilities */}
        <div className="flex items-center justify-end gap-4 px-6 pt-5">
          <a
            href="#"
            className="flex items-center gap-1 text-[12.5px] text-[var(--sd-text-muted)] transition-colors hover:text-[var(--sd-text-secondary)]"
          >
            API Docs
            <ArrowUpRight size={12} />
          </a>
          <button className="text-[var(--sd-text-muted)] transition-colors hover:text-[var(--sd-text-secondary)]">
            <Sun size={15} />
          </button>
          <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-[#4a5878] to-[#2a3148] text-[11px] font-semibold text-[var(--sd-text-secondary)]">
            M
          </span>
        </div>

        {/* Heading */}
        <div className="px-10 pt-2">
          <h1 className="text-[22px] font-semibold tracking-tight text-[var(--sd-text)]">
            New Recording
          </h1>
          <div className="mt-2 flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-[var(--sd-pink)]" />
            <span className="text-[10.5px] font-semibold tracking-[0.14em] text-[var(--sd-text-muted)]">
              READY TO RECORD
            </span>
          </div>
        </div>

        {/* Center stage */}
        <div className="flex flex-1 flex-col items-center justify-center gap-10 pb-16">
          <div className="flex items-center gap-8">
            <IdleWaveform />
            <div
              className="flex h-[120px] w-[120px] items-center justify-center rounded-full p-[3px]"
              style={{
                background: "var(--sd-gradient)",
                boxShadow: "0 0 50px rgba(168, 85, 247, 0.35)",
              }}
            >
              <button className="flex h-full w-full items-center justify-center rounded-full bg-[var(--sd-bg-deep)] text-white transition-colors hover:bg-[#0c0c12]">
                <Mic size={34} strokeWidth={1.8} />
              </button>
            </div>
            <IdleWaveform />
          </div>

          <p className="text-[14.5px] text-[var(--sd-text-secondary)]">
            Tap the button below to start recording
          </p>

          <button className="sd-ghost-btn flex items-center gap-2.5 rounded-xl px-5 py-3 text-[13.5px] font-medium">
            <Upload size={15} strokeWidth={2} />
            Upload MP3 / M4A
          </button>
        </div>
      </section>
    </main>
  );
}
