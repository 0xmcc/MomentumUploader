"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Download, Loader2, RotateCcw, Share2, Sparkles } from "lucide-react";
import { OUTLINE } from "./ArtifactDocument";

const STATUS_MESSAGES = [
  "Summarizing the brief…",
  "Diagnosing the call…",
  "Drafting discovery questions…",
  "Writing your pitch script…",
  "Prepping objection responses…",
  "Sequencing the call flow…",
  "Picking next best questions…",
] as const;

const SKELETON_DELAYS = [
  "0s",
  "0.1s",
  "0.2s",
  "0.3s",
  "0.4s",
  "0.5s",
  "0.6s",
  "0.7s",
  "0.8s",
  "0.9s",
  "1s",
] as const;

function SkeletonLine({
  className,
  delay,
}: {
  className: string;
  delay: (typeof SKELETON_DELAYS)[number];
}) {
  return <div className={`sd-skeleton ${className}`} style={{ animationDelay: delay }} />;
}

export default function GeneratingDocument({ animated = true }: { animated?: boolean }) {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    if (!animated) return;

    // Clamped, not looped: the checklist holds on the last section until the
    // real document arrives and this component unmounts.
    const intervalId = setInterval(() => {
      setStage((current) => Math.min(current + 1, OUTLINE.length - 1));
    }, 7000);

    return () => clearInterval(intervalId);
  }, [animated]);

  return (
    <div
      aria-busy="true"
      data-testid="sales-docs-generating-canvas"
      className="flex h-full min-w-0 flex-1 flex-col bg-[var(--sd-bg-deep)]"
    >
      {/* Document toolbar */}
      <div className="sd-glass z-10 flex shrink-0 items-center justify-between border-b border-[var(--sd-border)] px-6 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--sd-purple)] ${
              animated ? "sd-blink" : ""
            }`}
          />
          <span className="truncate text-[13px] font-medium text-[var(--sd-text-secondary)]">
            Generating your call prep…
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button
            className="sd-ghost-btn flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11.5px] opacity-40"
            disabled
            type="button"
          >
            <Download size={12} strokeWidth={2} />
            Export
          </button>
          <button
            className="sd-ghost-btn flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11.5px] opacity-40"
            disabled
            type="button"
          >
            <Copy size={12} strokeWidth={2} />
            Copy
          </button>
          <button
            className="sd-ghost-btn flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11.5px] opacity-40"
            disabled
            type="button"
          >
            <RotateCcw size={12} strokeWidth={2} />
            Regenerate
          </button>
          <button
            className="sd-gradient-btn flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11.5px] font-medium opacity-40"
            disabled
            type="button"
          >
            <Share2 size={12} strokeWidth={2} />
            Share
          </button>
        </div>
      </div>

      {/* Scrollable document area */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-[1060px] gap-8 px-8 py-8">
          {/* Outline rail */}
          <nav className="sticky top-8 hidden h-fit w-[136px] shrink-0 flex-col gap-0.5 self-start xl:flex">
            <div className="pb-2 pl-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--sd-text-faint)]">
              Outline
            </div>
            {OUTLINE.map((item, index) => {
              const isDone = index < stage;
              const isActive = index === stage;
              return (
                <div
                  key={item.id}
                  className="flex items-center gap-2 rounded-md px-2.5 py-[5px] text-[12px]"
                >
                  <span className="flex h-3 w-3 shrink-0 items-center justify-center">
                    {isDone ? (
                      <Check size={11} className="text-[var(--sd-purple)]" />
                    ) : (
                      <span
                        className={`rounded-full ${
                          isActive
                            ? `h-1.5 w-1.5 bg-[var(--sd-purple)] ${
                                animated ? "sd-blink" : ""
                              }`
                            : "h-[5px] w-[5px] bg-white/10"
                        }`}
                      />
                    )}
                  </span>
                  <span
                    className={
                      isDone
                        ? "text-[var(--sd-text-secondary)]"
                        : isActive
                          ? "text-[var(--sd-text)]"
                          : "text-[var(--sd-text-faint)]"
                    }
                  >
                    {item.label}
                  </span>
                </div>
              );
            })}
          </nav>

          {/* Document canvas */}
          <article
            className="min-w-0 flex-1 rounded-2xl border border-[var(--sd-border)] bg-[var(--sd-paper)] px-12 py-12"
            style={{ boxShadow: "var(--sd-shadow-panel)" }}
          >
            <header>
              <span
                className={`inline-flex items-center gap-1.5 rounded-full bg-[var(--sd-purple-soft)] px-2.5 py-1 text-[10.5px] font-medium text-[var(--sd-purple)] ${
                  animated ? "sd-blink" : ""
                }`}
              >
                <Sparkles size={10.5} />
                AI Generating…
              </span>
              <SkeletonLine className="mt-4 h-7 w-3/5" delay={SKELETON_DELAYS[0]} />

              <div className="mt-6 flex flex-wrap gap-x-8 gap-y-4 border-y border-[var(--sd-border)] py-4">
                {SKELETON_DELAYS.slice(1, 5).map((delay) => (
                  <div key={delay}>
                    <SkeletonLine className="h-2 w-10" delay={delay} />
                    <SkeletonLine className="mt-2 h-2.5 w-16" delay={delay} />
                  </div>
                ))}
              </div>
            </header>

            <section className="pt-10">
              <SkeletonLine className="h-2 w-16" delay={SKELETON_DELAYS[5]} />
              <SkeletonLine className="mt-2 h-4 w-2/5" delay={SKELETON_DELAYS[6]} />
              <SkeletonLine className="mt-3 h-2.5 w-full" delay={SKELETON_DELAYS[7]} />
              <SkeletonLine className="mt-2 h-2.5 w-[96%]" delay={SKELETON_DELAYS[8]} />
              <SkeletonLine className="mt-2 h-2.5 w-3/5" delay={SKELETON_DELAYS[9]} />
            </section>

            <section className="pt-12 opacity-55">
              <SkeletonLine className="h-2 w-16" delay={SKELETON_DELAYS[7]} />
              <SkeletonLine className="mt-2 h-4 w-2/5" delay={SKELETON_DELAYS[8]} />
              <SkeletonLine className="mt-3 h-2.5 w-full" delay={SKELETON_DELAYS[9]} />
              <SkeletonLine className="mt-2 h-2.5 w-[96%]" delay={SKELETON_DELAYS[10]} />
            </section>

            <div className="mt-8 flex items-center gap-2">
              <Loader2
                size={13}
                className={`text-[var(--sd-text-muted)] ${animated ? "animate-spin" : ""}`}
              />
              <span className="text-[12px] text-[var(--sd-text-muted)]">
                {STATUS_MESSAGES[stage]}
              </span>
            </div>
          </article>
        </div>
      </div>
    </div>
  );
}
