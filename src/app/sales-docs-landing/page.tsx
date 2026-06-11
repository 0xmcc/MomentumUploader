import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, FileText, Heart, ListChecks, Mic } from "lucide-react";
import "@/components/sales-docs/sales-docs.css";
import SalesDocsWorkspace from "@/components/sales-docs/SalesDocsWorkspace";
import { mockSessions, staticRecentSessions } from "@/data/mockSalesDoc";

export const metadata: Metadata = {
  title: "Sales Docs — Never enter a sales call unprepared again",
  description:
    "Paste a transcript, describe the prospect, or record live. Sales Docs turns your sales frameworks into tailored call briefs, discovery questions, pitch scripts, objection prep, and real-time coaching.",
};

const NAV_LINKS = ["Features", "Pricing", "Changelog"];

const FEATURES = [
  {
    icon: FileText,
    title: "Tailored call briefs",
    subtitle: "Built from your frameworks",
  },
  {
    icon: ListChecks,
    title: "Belief Ladder questions",
    subtitle: "Discovery that converts",
  },
  {
    icon: Mic,
    title: "Live coaching",
    subtitle: "Real-time on every call",
  },
];

// Native size the workspace mockup renders at before being scaled into the hero frame.
const MOCKUP_NATIVE_WIDTH = 1512;
const MOCKUP_NATIVE_HEIGHT = 940;
const MOCKUP_DISPLAY_WIDTH = 1160;
const MOCKUP_SCALE = MOCKUP_DISPLAY_WIDTH / MOCKUP_NATIVE_WIDTH;

export default function SalesDocsLandingPage() {
  return (
    <main className="sd-root relative min-h-screen w-full overflow-hidden bg-[var(--sd-bg-deep)]">
      {/* Glow composition: pink left, blue right, dark center */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background: [
            "radial-gradient(1000px 800px at -10% 58%, rgba(236, 72, 153, 0.38), transparent 65%)",
            "radial-gradient(1000px 800px at 110% 62%, rgba(79, 110, 249, 0.36), transparent 65%)",
            "radial-gradient(700px 500px at 50% 115%, rgba(139, 92, 246, 0.2), transparent 70%)",
          ].join(", "),
        }}
      />

      <div className="relative mx-auto max-w-[1200px] px-6">
        {/* Header */}
        <header className="flex h-[72px] items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div
              className="flex h-9 w-9 items-center justify-center rounded-[10px] text-white"
              style={{ background: "var(--sd-gradient-btn)" }}
            >
              <FileText size={17} strokeWidth={2.2} />
            </div>
            <span className="text-[17px] font-semibold tracking-tight">Sales Docs</span>
          </div>

          <div className="flex items-center gap-7">
            <nav className="flex items-center gap-7 text-[13.5px] text-[var(--sd-text-secondary)]">
              {NAV_LINKS.map((link) => (
                <a key={link} href="#" className="transition-colors hover:text-[var(--sd-text)]">
                  {link}
                </a>
              ))}
              <a
                href="#"
                className="flex items-center gap-1 transition-colors hover:text-[var(--sd-text)]"
              >
                API Docs
                <ArrowUpRight size={13} />
              </a>
            </nav>
            <div className="flex items-center gap-2.5">
              <Link
                href="/sales-docs"
                className="rounded-[10px] border border-[var(--sd-border-strong)] bg-[var(--sd-panel-raised)] px-4 py-2 text-[13.5px] font-medium text-[var(--sd-text)] transition-colors hover:border-white/20"
              >
                Sign in
              </Link>
              <Link
                href="/sales-docs"
                className="sd-gradient-btn rounded-[10px] px-4 py-2 text-[13.5px] font-medium"
              >
                Get started
              </Link>
            </div>
          </div>
        </header>

        {/* Hero */}
        <section className="flex flex-col items-center pt-24 text-center">
          <div className="flex items-center gap-2 rounded-full border border-[var(--sd-border-strong)] bg-[rgba(17,17,24,0.7)] px-4 py-1.5">
            <Heart size={13} className="fill-[var(--sd-pink)] text-[var(--sd-pink)]" />
            <span className="text-[12.5px] text-[var(--sd-text-secondary)]">
              Built for closers who prepare like pros
            </span>
          </div>

          <h1 className="mt-8 max-w-[900px] text-[76px] font-semibold leading-[1.04] tracking-[-0.03em] text-[var(--sd-text)]">
            Never enter a sales call <span className="sd-gradient-text">unprepared again.</span>
          </h1>

          <p className="mt-7 max-w-[640px] text-[18px] leading-[1.6] text-[var(--sd-text-muted)]">
            Paste a transcript, describe the prospect, or record live. Sales Docs turns your
            sales frameworks into tailored call briefs, discovery questions, pitch scripts,
            objection prep, and real-time coaching.
          </p>

          <Link
            href="/sales-docs"
            className="sd-gradient-btn mt-9 flex items-center gap-2.5 rounded-full px-7 py-3.5 text-[15.5px] font-medium"
          >
            Generate a call prep doc
            <ArrowRight size={16} strokeWidth={2.2} />
          </Link>

          {/* Feature row */}
          <div className="mt-14 flex items-center gap-12">
            {FEATURES.map(({ icon: Icon, title, subtitle }) => (
              <div key={title} className="flex items-center gap-3.5">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--sd-border)] bg-[rgba(17,17,24,0.7)]">
                  <Icon size={17} strokeWidth={2} className="text-[var(--sd-text-secondary)]" />
                </div>
                <div className="text-left">
                  <div className="text-[13.5px] font-medium text-[var(--sd-text)]">{title}</div>
                  <div className="text-[12.5px] text-[var(--sd-text-muted)]">{subtitle}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Product mockup — the real /sales-docs workspace, scaled down */}
      <section className="relative mx-auto mt-20 max-w-[1200px] px-6 pb-24">
        <div
          aria-hidden
          className="pointer-events-none mx-auto select-none overflow-hidden rounded-2xl border border-[rgba(139,92,246,0.3)]"
          style={{
            width: MOCKUP_DISPLAY_WIDTH,
            height: Math.round(MOCKUP_NATIVE_HEIGHT * MOCKUP_SCALE),
            boxShadow:
              "0 0 80px rgba(139, 92, 246, 0.22), 0 0 120px rgba(236, 72, 153, 0.12), 0 30px 80px rgba(0, 0, 0, 0.6)",
          }}
        >
          <div
            style={{
              width: MOCKUP_NATIVE_WIDTH,
              height: MOCKUP_NATIVE_HEIGHT,
              transform: `scale(${MOCKUP_SCALE})`,
              transformOrigin: "top left",
            }}
          >
            <SalesDocsWorkspace
              sessions={mockSessions}
              staticSessions={staticRecentSessions}
              animated={false}
            />
          </div>
        </div>
      </section>
    </main>
  );
}
