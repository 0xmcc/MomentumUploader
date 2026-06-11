"use client";

import { useEffect, useRef, useState, type MouseEvent } from "react";
import {
  ArrowDown,
  Check,
  Copy,
  Download,
  Pencil,
  RotateCcw,
  Share2,
  Sparkles,
} from "lucide-react";
import type { SalesDoc } from "@/data/salesDocTypes";

const OUTLINE = [
  { id: "sd-brief", label: "Brief" },
  { id: "sd-diagnosis", label: "Diagnosis" },
  { id: "sd-discovery", label: "Discovery" },
  { id: "sd-pitch", label: "Pitch" },
  { id: "sd-objections", label: "Objections" },
  { id: "sd-callflow", label: "Call Flow" },
  { id: "sd-next-questions", label: "Next Questions" },
] as const;

type OutlineId = (typeof OUTLINE)[number]["id"];
type CopyTarget = "document" | OutlineId;

const COPY_RESET_MS = 1500;

const BELIEF_STATUS: Record<
  SalesDoc["beliefLadder"][number]["status"],
  { label: string; className: string }
> = {
  covered: {
    label: "Covered",
    className: "bg-[var(--sd-green-soft)] text-[var(--sd-green)]",
  },
  needs_work: {
    label: "Needs work",
    className: "bg-[rgba(251,191,36,0.12)] text-[var(--sd-amber)]",
  },
  not_covered: {
    label: "Not covered",
    className: "bg-white/[0.05] text-[var(--sd-text-muted)]",
  },
};

const DOCUMENT_STATUS_LABEL: Record<SalesDoc["documentMetadata"]["status"], string> = {
  draft: "Draft",
  generated: "AI Generated",
  reviewed: "Reviewed",
};

function joinBlocks(blocks: Array<string | null | undefined>) {
  return blocks
    .map((block) => block?.trim())
    .filter((block): block is string => Boolean(block))
    .join("\n\n");
}

function joinLines(lines: Array<string | null | undefined>) {
  return lines
    .map((line) => line?.trim())
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

function formatScriptBlock({
  title,
  script,
  coachNotes,
}: {
  title: string;
  script: string;
  coachNotes?: string[];
}) {
  return joinLines([
    title,
    `"${script}"`,
    coachNotes?.length ? "Coach notes:" : undefined,
    ...(coachNotes ?? []).map((note) => `- ${note}`),
  ]);
}

function formatDocumentHeader(doc: SalesDoc) {
  return joinLines([
    doc.documentMetadata.title,
    `Status: ${DOCUMENT_STATUS_LABEL[doc.documentMetadata.status]}`,
    `Generated: ${doc.documentMetadata.generatedAt}`,
    `Updated: ${doc.documentMetadata.updatedAt}`,
    ...doc.callBrief.keyFacts.map((fact) => `${fact.label}: ${fact.value}`),
  ]);
}

function formatSectionPlainText(doc: SalesDoc, sectionId: OutlineId) {
  switch (sectionId) {
    case "sd-brief":
      return joinBlocks([
        `Section 01\n${doc.callBrief.title}`,
        doc.callBrief.summary,
        `Call objective\n${doc.callBrief.objective}`,
      ]);
    case "sd-diagnosis":
      return joinBlocks([
        `Section 02\n${doc.salesDiagnosis.title}`,
        doc.salesDiagnosis.summary,
        joinLines(
          doc.salesDiagnosis.likelyGaps.map(
            (gap) => `- ${gap.label}: ${gap.description}`
          )
        ),
      ]);
    case "sd-discovery":
      return joinBlocks([
        "Section 03\nBelief Ladder Discovery Plan",
        ...doc.beliefLadder.map((belief, i) =>
          joinLines([
            `${i + 1}. ${belief.label} (${BELIEF_STATUS[belief.status].label})`,
            `Goal: ${belief.goal}`,
            ...belief.questions.map(
              (question) =>
                `- ${question.text}${question.reason ? ` - ${question.reason}` : ""}`
            ),
          ])
        ),
      ]);
    case "sd-pitch":
      return joinBlocks([
        "Section 04\nCustom Pitch Script",
        formatScriptBlock(doc.pitchScript.highLevelPromise),
        ...doc.pitchScript.bridgePillars.map((pillar) => formatScriptBlock(pillar)),
        formatScriptBlock(doc.pitchScript.delivery),
      ]);
    case "sd-objections":
      return joinBlocks([
        "Section 05\nObjection Prep",
        ...doc.objectionPrep.map((objection) =>
          joinLines([
            `"${objection.objection}"`,
            `Likely meaning: ${objection.likelyMeaning}`,
            `Isolate: ${objection.isolateQuestion}`,
            `Respond: ${objection.recommendedResponse}`,
          ])
        ),
      ]);
    case "sd-callflow":
      return joinBlocks([
        "Section 06\nCall Flow",
        ...doc.callFlow.map((step, i) =>
          joinLines([
            `${i + 1}. ${step.step}`,
            `Goal: ${step.goal}`,
            step.talkTrack ? `Talk track: "${step.talkTrack}"` : undefined,
          ])
        ),
      ]);
    case "sd-next-questions":
      return joinBlocks([
        "Section 07\nNext Best Questions",
        ...doc.nextBestQuestions.map((question) =>
          joinLines([`"${question.question}"`, `Why: ${question.why}`])
        ),
      ]);
  }
}

function formatDocumentPlainText(doc: SalesDoc) {
  return joinBlocks([
    formatDocumentHeader(doc),
    ...OUTLINE.map((item) => formatSectionPlainText(doc, item.id)),
    `Document ID: ${doc.documentMetadata.id}`,
  ]);
}

/** Hover-revealed per-section actions. */
function SectionActions({
  sectionTitle,
  isCopied,
  onCopy,
}: {
  sectionTitle: string;
  isCopied: boolean;
  onCopy: () => void;
}) {
  const copyLabel = isCopied
    ? `Copied ${sectionTitle} section`
    : `Copy ${sectionTitle} section`;

  return (
    <div className="sd-section-actions flex items-center gap-1">
      <button
        aria-label={`Edit ${sectionTitle} section`}
        className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--sd-text-faint)] transition-colors hover:bg-white/[0.05] hover:text-[var(--sd-text-secondary)]"
        type="button"
      >
        <Pencil size={12} strokeWidth={2} />
      </button>
      <button
        aria-label={copyLabel}
        className="flex h-6 w-[64px] items-center justify-center gap-1 rounded-md text-[10.5px] font-medium text-[var(--sd-text-faint)] transition-colors hover:bg-white/[0.05] hover:text-[var(--sd-text-secondary)]"
        onClick={onCopy}
        type="button"
      >
        {isCopied ? <Check size={12} strokeWidth={2} /> : <Copy size={12} strokeWidth={2} />}
        {isCopied ? "Copied" : "Copy"}
      </button>
      <button
        aria-label={`Regenerate ${sectionTitle} section`}
        className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--sd-text-faint)] transition-colors hover:bg-white/[0.05] hover:text-[var(--sd-text-secondary)]"
        type="button"
      >
        <RotateCcw size={12} strokeWidth={2} />
      </button>
    </div>
  );
}

function SectionHeading({
  kicker,
  title,
  isCopied,
  onCopy,
}: {
  kicker: string;
  title: string;
  isCopied: boolean;
  onCopy: () => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[var(--sd-text-faint)]">
          {kicker}
        </div>
        <h2 className="mt-1 text-[19px] font-semibold tracking-tight text-[var(--sd-text)]">
          {title}
        </h2>
      </div>
      <SectionActions sectionTitle={title} isCopied={isCopied} onCopy={onCopy} />
    </div>
  );
}

/** Script block with coach notes rendered in the right margin. */
function ScriptBlock({
  title,
  script,
  coachNotes,
}: {
  title: string;
  script: string;
  coachNotes?: string[];
}) {
  return (
    <div className="flex gap-5">
      <div className="min-w-0 flex-1">
        <div className="text-[12.5px] font-semibold text-[var(--sd-purple)]">{title}</div>
        <div
          className="mt-2 rounded-r-lg border-l-2 py-1 pl-4"
          style={{ borderImage: "var(--sd-gradient) 1" }}
        >
          <p className="text-[14px] leading-[1.75] text-[var(--sd-text-secondary)]">
            &ldquo;{script}&rdquo;
          </p>
        </div>
      </div>
      <div className="w-[140px] shrink-0 pt-7">
        {coachNotes?.map((note, i) => (
          <div key={i} className="mb-3 border-l border-[var(--sd-border)] pl-2.5">
            <div className="text-[9.5px] font-semibold uppercase tracking-wide text-[var(--sd-text-faint)]">
              Coach note
            </div>
            <p className="mt-0.5 text-[11px] italic leading-snug text-[var(--sd-text-muted)]">
              {note}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ArtifactDocument({ doc }: { doc: SalesDoc }) {
  const [activeOutlineId, setActiveOutlineId] = useState<OutlineId>("sd-brief");
  const [copiedTarget, setCopiedTarget] = useState<CopyTarget | null>(null);
  const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sectionRefs = useRef<Record<OutlineId, HTMLElement | null>>({
    "sd-brief": null,
    "sd-diagnosis": null,
    "sd-discovery": null,
    "sd-pitch": null,
    "sd-objections": null,
    "sd-callflow": null,
    "sd-next-questions": null,
  });

  useEffect(() => {
    return () => {
      if (copyResetTimerRef.current) {
        clearTimeout(copyResetTimerRef.current);
      }
    };
  }, []);

  function resetCopiedTarget() {
    if (copyResetTimerRef.current) {
      clearTimeout(copyResetTimerRef.current);
    }
    setCopiedTarget(null);
  }

  async function copyText(target: CopyTarget, text: string) {
    const clipboard = navigator.clipboard;

    if (!clipboard?.writeText) {
      resetCopiedTarget();
      return;
    }

    try {
      await clipboard.writeText(text);
      setCopiedTarget(target);

      if (copyResetTimerRef.current) {
        clearTimeout(copyResetTimerRef.current);
      }

      copyResetTimerRef.current = setTimeout(() => {
        setCopiedTarget(null);
        copyResetTimerRef.current = null;
      }, COPY_RESET_MS);
    } catch {
      resetCopiedTarget();
    }
  }

  function copySection(sectionId: OutlineId) {
    void copyText(sectionId, formatSectionPlainText(doc, sectionId));
  }

  function handleOutlineClick(event: MouseEvent<HTMLAnchorElement>, sectionId: OutlineId) {
    event.preventDefault();
    setActiveOutlineId(sectionId);
    sectionRefs.current[sectionId]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-[var(--sd-bg-deep)]">
      {/* Document toolbar */}
      <div className="sd-glass z-10 flex shrink-0 items-center justify-between border-b border-[var(--sd-border)] px-6 py-2.5">
        <div className="flex min-w-0 items-center gap-3">
          <span className="truncate text-[13px] font-medium text-[var(--sd-text)]">
            {doc.documentMetadata.title}
          </span>
          <span className="shrink-0 text-[11.5px] text-[var(--sd-text-faint)]">
            Generated {doc.documentMetadata.generatedAt}
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <button className="sd-ghost-btn flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11.5px]">
            <Download size={12} strokeWidth={2} />
            Export
          </button>
          <button
            aria-label={copiedTarget === "document" ? "Copied document" : "Copy document"}
            className="sd-ghost-btn flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11.5px]"
            onClick={() => void copyText("document", formatDocumentPlainText(doc))}
            type="button"
          >
            {copiedTarget === "document" ? (
              <Check size={12} strokeWidth={2} />
            ) : (
              <Copy size={12} strokeWidth={2} />
            )}
            {copiedTarget === "document" ? "Copied" : "Copy"}
          </button>
          <button className="sd-ghost-btn flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11.5px]">
            <RotateCcw size={12} strokeWidth={2} />
            Regenerate
          </button>
          <button className="sd-gradient-btn flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11.5px] font-medium">
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
            {OUTLINE.map((item) => (
              <a
                key={item.id}
                href={`#${item.id}`}
                onClick={(event) => handleOutlineClick(event, item.id)}
                className={`rounded-md px-2.5 py-[5px] text-[12px] transition-colors ${
                  item.id === activeOutlineId
                    ? "bg-white/[0.04] text-[var(--sd-text)]"
                    : "text-[var(--sd-text-muted)] hover:bg-white/[0.03] hover:text-[var(--sd-text-secondary)]"
                }`}
              >
                {item.label}
              </a>
            ))}
          </nav>

          {/* Document canvas */}
          <article
            className="min-w-0 flex-1 rounded-2xl border border-[var(--sd-border)] bg-[var(--sd-paper)] px-12 py-12"
            style={{ boxShadow: "var(--sd-shadow-panel)" }}
          >
            {/* Doc header */}
            <header>
              <div className="flex items-center gap-2">
                <span className="flex items-center gap-1.5 rounded-full bg-[var(--sd-purple-soft)] px-2.5 py-1 text-[10.5px] font-medium text-[var(--sd-purple)]">
                  <Sparkles size={10.5} />
                  {DOCUMENT_STATUS_LABEL[doc.documentMetadata.status]}
                </span>
                <span className="text-[11px] text-[var(--sd-text-faint)]">
                  Updated {doc.documentMetadata.updatedAt}
                </span>
              </div>
              <h1 className="mt-4 text-[28px] font-semibold leading-tight tracking-tight text-[var(--sd-text)]">
                {doc.documentMetadata.title}
              </h1>

              {/* Prospect metadata row */}
              <div className="mt-6 flex flex-wrap gap-x-8 gap-y-4 border-y border-[var(--sd-border)] py-4">
                {doc.callBrief.keyFacts.map((fact) => (
                  <div key={fact.label}>
                    <div className="text-[10.5px] font-medium uppercase tracking-wide text-[var(--sd-text-faint)]">
                      {fact.label}
                    </div>
                    <div className="mt-1 text-[13px] font-medium text-[var(--sd-text-secondary)]">
                      {fact.value}
                    </div>
                  </div>
                ))}
              </div>
            </header>

            {/* 1 — Executive Call Brief */}
            <section
              id="sd-brief"
              ref={(node) => {
                sectionRefs.current["sd-brief"] = node;
              }}
              className="sd-doc-section scroll-mt-6 pt-10"
            >
              <SectionHeading
                kicker="Section 01"
                title={doc.callBrief.title}
                isCopied={copiedTarget === "sd-brief"}
                onCopy={() => copySection("sd-brief")}
              />
              <p className="mt-4 text-[14px] leading-[1.8] text-[var(--sd-text-secondary)]">
                {doc.callBrief.summary}
              </p>
              <div className="mt-4 rounded-lg border border-[rgba(139,92,246,0.22)] bg-[var(--sd-purple-soft)] px-4 py-3">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--sd-purple)]">
                  Call objective
                </span>
                <p className="mt-1 text-[13px] leading-relaxed text-[var(--sd-text-secondary)]">
                  {doc.callBrief.objective}
                </p>
              </div>
            </section>

            {/* 2 — Sales Diagnosis */}
            <section
              id="sd-diagnosis"
              ref={(node) => {
                sectionRefs.current["sd-diagnosis"] = node;
              }}
              className="sd-doc-section scroll-mt-6 pt-12"
            >
              <SectionHeading
                kicker="Section 02"
                title={doc.salesDiagnosis.title}
                isCopied={copiedTarget === "sd-diagnosis"}
                onCopy={() => copySection("sd-diagnosis")}
              />
              <p className="mt-4 text-[14px] leading-[1.8] text-[var(--sd-text-secondary)]">
                {doc.salesDiagnosis.summary}
              </p>
              <div className="mt-5 flex flex-col gap-3.5">
                {doc.salesDiagnosis.likelyGaps.map((gap) => (
                  <div key={gap.label} className="flex gap-3">
                    <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--sd-pink)]" />
                    <p className="text-[13.5px] leading-relaxed text-[var(--sd-text-muted)]">
                      <span className="font-medium text-[var(--sd-text-secondary)]">
                        {gap.label}.
                      </span>{" "}
                      {gap.description}
                    </p>
                  </div>
                ))}
              </div>
            </section>

            {/* 3 — Belief Ladder Discovery Plan */}
            <section
              id="sd-discovery"
              ref={(node) => {
                sectionRefs.current["sd-discovery"] = node;
              }}
              className="sd-doc-section scroll-mt-6 pt-12"
            >
              <SectionHeading
                kicker="Section 03"
                title="Belief Ladder Discovery Plan"
                isCopied={copiedTarget === "sd-discovery"}
                onCopy={() => copySection("sd-discovery")}
              />
              <div className="mt-2 divide-y divide-[var(--sd-border)]">
                {doc.beliefLadder.map((belief, i) => {
                  const status = BELIEF_STATUS[belief.status];
                  return (
                    <div key={belief.id} className="py-5">
                      <div className="flex items-center gap-3">
                        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/[0.05] text-[11px] font-semibold text-[var(--sd-text-secondary)]">
                          {i + 1}
                        </span>
                        <h3 className="text-[15px] font-semibold text-[var(--sd-text)]">
                          {belief.label}
                        </h3>
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${status.className}`}
                        >
                          {status.label}
                        </span>
                      </div>
                      <p className="mt-2 pl-9 text-[12.5px] italic leading-relaxed text-[var(--sd-text-muted)]">
                        Goal: {belief.goal}
                      </p>
                      <div className="mt-3 flex flex-col gap-2 pl-9">
                        {belief.questions.map((q) => (
                          <div key={q.id} className="flex items-start gap-2.5">
                            <span
                              className={`mt-[7px] h-1 w-1 shrink-0 rounded-full ${
                                q.priority === "high"
                                  ? "bg-[var(--sd-purple)]"
                                  : "bg-[var(--sd-text-faint)]"
                              }`}
                            />
                            <p className="text-[13.5px] leading-relaxed text-[var(--sd-text-secondary)]">
                              {q.text}
                              {q.reason && (
                                <span className="text-[var(--sd-text-faint)]">
                                  {" "}
                                  — {q.reason}
                                </span>
                              )}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* 4 — Custom Pitch Script */}
            <section
              id="sd-pitch"
              ref={(node) => {
                sectionRefs.current["sd-pitch"] = node;
              }}
              className="sd-doc-section scroll-mt-6 pt-12"
            >
              <SectionHeading
                kicker="Section 04"
                title="Custom Pitch Script"
                isCopied={copiedTarget === "sd-pitch"}
                onCopy={() => copySection("sd-pitch")}
              />
              <div className="mt-6 flex flex-col gap-8">
                <ScriptBlock
                  title={doc.pitchScript.highLevelPromise.title}
                  script={doc.pitchScript.highLevelPromise.script}
                  coachNotes={doc.pitchScript.highLevelPromise.coachNotes}
                />
                {doc.pitchScript.bridgePillars.map((pillar) => (
                  <ScriptBlock
                    key={pillar.id}
                    title={pillar.title}
                    script={pillar.script}
                    coachNotes={pillar.coachNotes}
                  />
                ))}
                <ScriptBlock
                  title={doc.pitchScript.delivery.title}
                  script={doc.pitchScript.delivery.script}
                  coachNotes={doc.pitchScript.delivery.coachNotes}
                />
              </div>
            </section>

            {/* 5 — Objection Prep */}
            <section
              id="sd-objections"
              ref={(node) => {
                sectionRefs.current["sd-objections"] = node;
              }}
              className="sd-doc-section scroll-mt-6 pt-12"
            >
              <SectionHeading
                kicker="Section 05"
                title="Objection Prep"
                isCopied={copiedTarget === "sd-objections"}
                onCopy={() => copySection("sd-objections")}
              />
              <div className="mt-2 divide-y divide-[var(--sd-border)]">
                {doc.objectionPrep.map((objection) => (
                  <div key={objection.id} className="py-5">
                    <h3 className="text-[14.5px] font-semibold text-[var(--sd-text)]">
                      &ldquo;{objection.objection}&rdquo;
                    </h3>
                    <div className="mt-3 flex flex-col gap-2.5">
                      <div className="grid grid-cols-[130px_1fr] gap-3">
                        <span className="text-[11.5px] font-medium uppercase tracking-wide text-[var(--sd-text-faint)]">
                          Likely meaning
                        </span>
                        <p className="text-[13px] leading-relaxed text-[var(--sd-text-muted)]">
                          {objection.likelyMeaning}
                        </p>
                      </div>
                      <div className="grid grid-cols-[130px_1fr] gap-3">
                        <span className="text-[11.5px] font-medium uppercase tracking-wide text-[var(--sd-text-faint)]">
                          Isolate
                        </span>
                        <p className="text-[13px] leading-relaxed text-[var(--sd-text-secondary)]">
                          {objection.isolateQuestion}
                        </p>
                      </div>
                      <div className="grid grid-cols-[130px_1fr] gap-3">
                        <span className="text-[11.5px] font-medium uppercase tracking-wide text-[var(--sd-text-faint)]">
                          Respond
                        </span>
                        <p className="text-[13px] leading-relaxed text-[var(--sd-text-secondary)]">
                          {objection.recommendedResponse}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* 6 — Call Flow */}
            <section
              id="sd-callflow"
              ref={(node) => {
                sectionRefs.current["sd-callflow"] = node;
              }}
              className="sd-doc-section scroll-mt-6 pt-12"
            >
              <SectionHeading
                kicker="Section 06"
                title="Call Flow"
                isCopied={copiedTarget === "sd-callflow"}
                onCopy={() => copySection("sd-callflow")}
              />
              <div className="mt-6 flex flex-col">
                {doc.callFlow.map((step, i) => {
                  const isLast = i === doc.callFlow.length - 1;
                  return (
                    <div key={step.id} className="flex gap-4">
                      {/* Timeline gutter */}
                      <div className="flex w-6 flex-col items-center">
                        <span
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold text-white"
                          style={{ background: "var(--sd-gradient-cool)" }}
                        >
                          {i + 1}
                        </span>
                        {!isLast && <span className="w-px flex-1 bg-[var(--sd-border)]" />}
                      </div>
                      <div className={isLast ? "pb-1" : "pb-6"}>
                        <div className="flex items-center gap-2 pt-0.5">
                          <h3 className="text-[13.5px] font-semibold text-[var(--sd-text)]">
                            {step.step}
                          </h3>
                          {!isLast && (
                            <ArrowDown size={11} className="text-[var(--sd-text-faint)]" />
                          )}
                        </div>
                        <p className="mt-1 text-[12.5px] leading-relaxed text-[var(--sd-text-muted)]">
                          {step.goal}
                        </p>
                        {step.talkTrack && (
                          <p className="mt-1.5 text-[12.5px] italic leading-relaxed text-[var(--sd-purple)]">
                            &ldquo;{step.talkTrack}&rdquo;
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* 7 — Next Best Questions */}
            <section
              id="sd-next-questions"
              ref={(node) => {
                sectionRefs.current["sd-next-questions"] = node;
              }}
              className="sd-doc-section scroll-mt-6 pt-12"
            >
              <SectionHeading
                kicker="Section 07"
                title="Next Best Questions"
                isCopied={copiedTarget === "sd-next-questions"}
                onCopy={() => copySection("sd-next-questions")}
              />
              <div className="mt-5 flex flex-col gap-3.5">
                {doc.nextBestQuestions.map((nbq) => (
                  <div
                    key={nbq.id}
                    className="rounded-xl border border-[var(--sd-border)] bg-[var(--sd-panel-raised)] px-5 py-4"
                  >
                    <p className="text-[15px] font-medium leading-relaxed text-[var(--sd-text)]">
                      &ldquo;{nbq.question}&rdquo;
                    </p>
                    <p className="mt-1.5 text-[12px] leading-relaxed text-[var(--sd-text-muted)]">
                      <span className="font-medium uppercase tracking-wide text-[var(--sd-text-faint)]">
                        Why ·
                      </span>{" "}
                      {nbq.why}
                    </p>
                  </div>
                ))}
              </div>
            </section>

            <footer className="mt-12 border-t border-[var(--sd-border)] pt-5 text-[11px] text-[var(--sd-text-faint)]">
              Generated by Sales Docs · Belief Ladder framework · {doc.documentMetadata.id}
            </footer>
          </article>
        </div>
      </div>
    </div>
  );
}
