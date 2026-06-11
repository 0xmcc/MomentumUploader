"use client";

import { AlertTriangle, ArrowRight, CheckCircle2, Info, X } from "lucide-react";
import type { SalesDoc } from "@/data/salesDocTypes";

type LiveCoaching = SalesDoc["liveCoaching"];

const INSIGHT_STYLE: Record<
  LiveCoaching["insights"][number]["type"],
  { Icon: typeof CheckCircle2; iconClass: string; textClass: string }
> = {
  positive: {
    Icon: CheckCircle2,
    iconClass: "text-[var(--sd-green)]",
    textClass: "text-[var(--sd-text-secondary)]",
  },
  warning: {
    Icon: AlertTriangle,
    iconClass: "text-[var(--sd-amber)]",
    textClass: "text-[var(--sd-text-secondary)]",
  },
  suggestion: {
    Icon: Info,
    iconClass: "text-[var(--sd-blue)]",
    textClass: "text-[var(--sd-blue)]",
  },
  next_step: {
    Icon: ArrowRight,
    iconClass: "text-[var(--sd-purple)]",
    textClass: "text-[var(--sd-text-secondary)]",
  },
};

function Waveform({ bars, animated }: { bars: number[]; animated: boolean }) {
  return (
    <div className="flex h-8 items-center gap-[2.5px]">
      {bars.map((v, i) => (
        <div
          key={i}
          className={animated ? "sd-wave-bar" : ""}
          style={{
            width: 2.5,
            height: `${Math.round(8 + v * 22)}px`,
            borderRadius: 2,
            background: `linear-gradient(180deg, var(--sd-pink), var(--sd-purple))`,
            animationDelay: `${(i % 8) * 0.09}s`,
            opacity: 0.55 + v * 0.45,
          }}
        />
      ))}
    </div>
  );
}

export default function LiveCoachingPanel({
  liveCoaching,
  animated = true,
}: {
  liveCoaching: LiveCoaching;
  animated?: boolean;
}) {
  const waveform = liveCoaching.waveform ?? [];

  return (
    <aside className="flex h-full w-[240px] shrink-0 flex-col overflow-y-auto border-l border-[var(--sd-border)] bg-[var(--sd-bg)]">
      {/* Header */}
      <div className="flex items-center justify-between px-4 pt-5 pb-3">
        <div className="flex items-center gap-2">
          <span
            className={`h-1.5 w-1.5 rounded-full bg-[var(--sd-green)] ${animated ? "sd-blink" : ""}`}
          />
          <h2 className="text-[13px] font-semibold tracking-tight text-[var(--sd-text)]">
            Live Coaching
          </h2>
        </div>
        <button className="text-[var(--sd-text-faint)] transition-colors hover:text-[var(--sd-text-secondary)]">
          <X size={14} />
        </button>
      </div>

      <div className="flex flex-col gap-5 px-4 pb-5">
        {/* Listening card */}
        <div className="rounded-xl border border-[var(--sd-border)] bg-[var(--sd-panel)] px-3.5 py-3">
          <div className="text-[12px] text-[var(--sd-text-secondary)]">
            {liveCoaching.statusLabel}
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <Waveform bars={waveform} animated={animated} />
            <span className="font-mono text-[12px] tabular-nums text-[var(--sd-text-secondary)]">
              {liveCoaching.timer}
            </span>
          </div>
        </div>

        {/* Real-time insights */}
        <section>
          <h3 className="pb-2.5 text-[12.5px] font-semibold text-[var(--sd-text)]">
            Real-time Insights
          </h3>
          <div className="flex flex-col gap-3">
            {liveCoaching.insights.map((insight) => {
              const { Icon, iconClass, textClass } = INSIGHT_STYLE[insight.type];
              return (
                <div key={insight.id} className="flex items-start gap-2.5">
                  <Icon size={14} className={`mt-0.5 shrink-0 ${iconClass}`} />
                  <p className={`text-[12px] leading-snug ${textClass}`}>{insight.text}</p>
                </div>
              );
            })}
          </div>
        </section>

        {/* Belief ladder progress */}
        <section>
          <h3 className="pb-2.5 text-[12.5px] font-semibold text-[var(--sd-text)]">
            Belief Ladder Progress
          </h3>
          <div className="flex flex-col gap-1">
            {liveCoaching.beliefProgress.map((belief, i) => {
              const isActive = belief.status === "active";
              const isComplete = belief.status === "complete";
              return (
                <div
                  key={belief.beliefId}
                  className={`flex items-center justify-between rounded-lg px-2 py-[5px] ${
                    isActive
                      ? "border border-[rgba(79,141,249,0.35)] bg-[rgba(79,141,249,0.1)]"
                      : ""
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`flex h-[18px] w-[18px] items-center justify-center rounded-full text-[9.5px] font-semibold ${
                        isActive
                          ? "bg-[var(--sd-blue)] text-white"
                          : isComplete
                            ? "bg-[var(--sd-green-soft)] text-[var(--sd-green)]"
                            : "bg-white/[0.05] text-[var(--sd-text-muted)]"
                      }`}
                    >
                      {i + 1}
                    </span>
                    <span
                      className={`text-[12.5px] ${
                        isActive || isComplete
                          ? "text-[var(--sd-text)]"
                          : "text-[var(--sd-text-muted)]"
                      }`}
                    >
                      {belief.label}
                    </span>
                  </div>
                  {isComplete ? (
                    <CheckCircle2 size={14} className="text-[var(--sd-green)]" />
                  ) : isActive ? (
                    <span className="flex h-3.5 w-3.5 items-center justify-center rounded-full border-[1.5px] border-[var(--sd-blue)]">
                      <span className="h-1.5 w-1.5 rounded-full bg-[var(--sd-blue)]" />
                    </span>
                  ) : (
                    <span className="h-3.5 w-3.5 rounded-full border-[1.5px] border-[var(--sd-text-faint)] opacity-50" />
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Next best question */}
        <section>
          <h3 className="pb-2.5 text-[12.5px] font-semibold text-[var(--sd-text)]">
            Next Best Question
          </h3>
          <div className="rounded-xl border border-[var(--sd-border)] bg-[var(--sd-panel-raised)] px-3.5 py-3">
            <p className="text-[12.5px] leading-relaxed text-[var(--sd-text)]">
              {liveCoaching.nextSuggestedQuestion.question}
            </p>
          </div>
          <button className="sd-gradient-btn mt-2.5 w-full rounded-[10px] py-2 text-[12.5px] font-medium">
            Use This Question
          </button>
        </section>
      </div>
    </aside>
  );
}
