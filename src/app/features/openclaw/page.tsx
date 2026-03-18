"use client";

import Link from "next/link";
import { useState } from "react";

export const dynamic = "force-static";

// ─── FAQ data ─────────────────────────────────────────────────────────────────

const FAQ_ITEMS = [
  {
    q: "What is OpenClaw?",
    a: "OpenClaw is a protocol for connecting an external AI agent to a shared memo. When you invite OpenClaw, you're generating a one-time handoff link that lets a compatible AI agent read your memo's context and join the memo room. The agent is external — it's something you bring, not something built into Sonic Memos.",
  },
  {
    q: "Why doesn't OpenClaw say anything right after connecting?",
    a: "By design. After claiming, OpenClaw has read your memo's context and is standing by — but it waits for you to start the conversation. In v1, the first interaction is always owner-initiated: you click 'Ask OpenClaw' when you're ready. This keeps you in control and avoids unexpected automated messages appearing in your memo room.",
  },
  {
    q: "What exactly does OpenClaw see when it connects?",
    a: "OpenClaw receives the memo's full transcript, the summary (if one has been generated), any artifacts like outlines or rolling summaries, the memo title, and basic metadata like the creation date. It does not receive the raw audio file, your account information, or any other memos in your workspace.",
  },
  {
    q: "Can I remove OpenClaw after it has connected?",
    a: "Yes. You can revoke an active OpenClaw connection at any time from the memo's share settings. Revoking removes the agent from the memo room and marks the claim as rejected. The agent loses access immediately.",
  },
  {
    q: "What happens if my invite link expires before OpenClaw claims it?",
    a: "Invite links expire 24 hours after generation. If OpenClaw doesn't claim before expiry, just generate a new invite from the memo. There's no limit on how many invites you can create.",
  },
  {
    q: "Can I have multiple AI agents connected to the same memo?",
    a: "Not in v1. Each memo supports one active OpenClaw connection at a time. If you want to switch agents, revoke the current one first, then generate a new invite.",
  },
  {
    q: "Does OpenClaw store my transcript data?",
    a: "That depends entirely on the external agent you're connecting. Sonic Memos passes the memo context during the handoff, but what the agent does with that context is governed by whoever operates the agent — not by Sonic Memos. Only connect agents you trust.",
  },
  {
    q: "Do I need a specific kind of AI agent to use this?",
    a: "Yes. The agent needs to be OpenClaw-compatible — meaning it understands the claim handoff protocol and can operate in a memo room. Standard chatbots or browser sessions won't work. OpenClaw is designed for AI agents that can follow structured handoff instructions.",
  },
];

// ─── What OpenClaw sees ───────────────────────────────────────────────────────

const SEES_YES = [
  { label: "Full transcript (final + live, if recorded)" },
  { label: "AI-generated summary, if available" },
  { label: "Artifacts: outline, rolling summary" },
  { label: "Memo title and creation date" },
  { label: "Shared memo URL and metadata" },
];

const SEES_NO = [
  { label: "Raw audio file" },
  { label: "Your account or profile data" },
  { label: "Other memos in your workspace" },
  { label: "Live recording in progress" },
  { label: "Invite nonce or authentication tokens" },
];

// ─── Sub-components ───────────────────────────────────────────────────────────

function FAQItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-white/8 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between gap-4 px-6 py-5 text-left hover:bg-white/[0.03] transition-colors"
      >
        <span className="text-white/90 font-medium leading-snug">{q}</span>
        <span
          className={`shrink-0 w-5 h-5 flex items-center justify-center rounded-full border border-white/15 text-white/50 text-xs transition-transform duration-200 ${
            open ? "rotate-45" : ""
          }`}
        >
          +
        </span>
      </button>
      {open && (
        <div className="px-6 pb-5 text-white/60 text-sm leading-relaxed border-t border-white/5">
          <p className="pt-4">{a}</p>
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function OpenClawPage() {
  return (
    <div className="min-h-screen bg-background text-foreground font-sans antialiased">
      {/* Ambient glow — dual tone for OpenClaw's distinct identity */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          background: [
            "radial-gradient(ellipse 70% 45% at 50% -10%, rgba(249,115,22,0.10) 0%, transparent 65%)",
            "radial-gradient(ellipse 40% 30% at 80% 20%, rgba(139,92,246,0.06) 0%, transparent 60%)",
          ].join(", "),
        }}
      />

      {/* ── Nav ──────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-white/5 bg-background/80 backdrop-blur-md">
        <div className="mx-auto max-w-5xl px-6 h-14 flex items-center justify-between">
          <Link
            href="/"
            className="text-white/70 hover:text-white text-sm transition-colors"
          >
            ← Back to Sonic Memos
          </Link>
          <span className="text-xs text-white/30 font-mono uppercase tracking-widest">
            Feature Guide
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 pb-32">
        {/* ── Hero ─────────────────────────────────────────────────────── */}
        <section className="pt-20 pb-16 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 text-violet-300 text-xs font-medium mb-8">
            <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
            Agent Integration · v1
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white leading-tight mb-6 tracking-tight">
            Bring an AI into
            <br />
            <span className="text-orange-400">your memo room.</span>
          </h1>

          <p className="text-lg sm:text-xl text-white/60 max-w-2xl mx-auto leading-relaxed mb-10">
            OpenClaw lets you connect an external AI agent to any shared memo.
            Invite it, let it read your context, then ask it anything — on your
            schedule, without leaving your workflow.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 mb-16">
            <Link
              href="/"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-semibold transition-colors text-sm"
            >
              Try it on a memo
            </Link>
            <a
              href="#how-it-works"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl border border-white/10 hover:border-white/20 text-white/70 hover:text-white font-medium transition-colors text-sm"
            >
              See how it works
            </a>
          </div>

          {/* Hero mock UI */}
          <div className="rounded-2xl border border-white/8 bg-white/[0.02] overflow-hidden text-left max-w-2xl mx-auto shadow-2xl">
            {/* Window chrome */}
            <div className="flex items-center gap-2 px-5 py-3 border-b border-white/5 bg-white/[0.025]">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500/50" />
              <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/50" />
              <div className="w-2.5 h-2.5 rounded-full bg-green-500/50" />
              <span className="ml-2 text-xs text-white/30 font-mono">
                Q3 strategy sync — July 14
              </span>
            </div>

            {/* Mock memo content */}
            <div className="p-5 space-y-3">
              {/* Transcript preview */}
              <div className="space-y-2">
                <div className="flex items-start gap-2.5">
                  <span className="inline-flex items-center px-2 py-0.5 rounded-md border text-xs font-semibold bg-orange-500/15 border-orange-500/30 text-orange-400 shrink-0 mt-0.5">
                    Speaker 1
                  </span>
                  <p className="text-white/70 text-sm leading-relaxed">
                    The main question is whether we ship v2 before the
                    conference or wait until October.
                  </p>
                </div>
                <div className="flex items-start gap-2.5">
                  <span className="inline-flex items-center px-2 py-0.5 rounded-md border text-xs font-semibold bg-sky-500/15 border-sky-500/30 text-sky-400 shrink-0 mt-0.5">
                    Speaker 2
                  </span>
                  <p className="text-white/70 text-sm leading-relaxed">
                    If the auth refactor isn&rsquo;t done, I&rsquo;d hold. We
                    don&rsquo;t want to demo something that isn&rsquo;t stable.
                  </p>
                </div>
              </div>

              {/* Divider */}
              <div className="border-t border-white/5 pt-3">
                {/* OpenClaw status bar */}
                <div className="flex items-center justify-between gap-3 rounded-xl border border-violet-500/20 bg-violet-500/[0.06] px-4 py-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-2 h-2 rounded-full bg-violet-400 shadow-[0_0_6px_rgba(167,139,250,0.8)]" />
                    <span className="text-xs text-violet-300 font-medium">
                      OpenClaw connected
                    </span>
                    <span className="text-xs text-white/30 font-mono">
                      · my-research-agent
                    </span>
                  </div>
                  <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-xs font-semibold transition-colors">
                    Ask OpenClaw
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Divider ──────────────────────────────────────────────────── */}
        <hr className="border-white/5 mb-16" />

        {/* ── Value props ──────────────────────────────────────────────── */}
        <section className="mb-20">
          <div className="grid sm:grid-cols-3 gap-4">
            {[
              {
                icon: "📋",
                title: "Context, delivered",
                body: "When OpenClaw connects, it receives your full transcript, summary, and artifacts — no copy-paste, no re-explaining what the memo was about.",
              },
              {
                icon: "🎛️",
                title: "You stay in control",
                body: "You invite the agent. You decide when to ask it something. OpenClaw doesn't act until you trigger the first interaction.",
              },
              {
                icon: "🔇",
                title: "Silent until needed",
                body: "After connecting, OpenClaw waits. Nothing happens in your memo room until you explicitly ask it to do something.",
              },
            ].map((card) => (
              <div
                key={card.title}
                className="rounded-xl border border-white/8 bg-white/[0.02] p-6 hover:border-white/12 hover:bg-white/[0.035] transition-colors"
              >
                <div className="text-2xl mb-3">{card.icon}</div>
                <h3 className="font-semibold text-white mb-2">{card.title}</h3>
                <p className="text-white/55 text-sm leading-relaxed">
                  {card.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        {/* ── How it works ─────────────────────────────────────────────── */}
        <section id="how-it-works" className="mb-20 scroll-mt-20">
          <h2 className="text-2xl font-bold text-white mb-2">How it works</h2>
          <p className="text-white/55 text-sm mb-12">
            Three steps. The whole flow takes under a minute.
          </p>

          <div className="space-y-4">
            {/* Step 1 */}
            <StepCard
              number={1}
              title="Generate an invite"
              description="From any shared memo you own, click Invite OpenClaw. You'll get a short block of text containing a one-time invite link — valid for 24 hours. Send that text to your OpenClaw-compatible AI agent."
              detail="The invite includes instructions the agent needs to connect. Once sent, you'll see a pending state in the memo until the agent claims it."
              mockSlot={
                <div className="rounded-xl border border-white/8 bg-black/30 p-4 space-y-3">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-2 h-2 rounded-full bg-yellow-400/70 animate-pulse" />
                    <span className="text-xs text-white/40 font-mono uppercase tracking-wide">
                      Invite pending
                    </span>
                  </div>
                  <div className="rounded-lg border border-white/6 bg-white/[0.03] p-3 font-mono text-xs text-white/50 leading-relaxed">
                    Please open this link and connect to my memo room:
                    <br />
                    <span className="text-orange-400/80">
                      https://sonicmemos.app/s/qz7r…?nonce=a4f8…
                    </span>
                    <br />
                    <br />
                    Read the OpenClaw skill instructions in the page metadata,
                    then connect using the handoff endpoint.
                  </div>
                  <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 text-white/50 text-xs font-medium hover:border-white/20 hover:text-white/70 transition-colors">
                    Copy invite text
                  </button>
                </div>
              }
            />

            {/* Connector */}
            <StepConnector />

            {/* Step 2 */}
            <StepCard
              number={2}
              title="OpenClaw reads and connects"
              description="Your agent visits the invite URL, reads the memo's OpenClaw skill instructions from the page metadata, and calls the handoff endpoint. It receives your transcript, summary, and any artifacts. The claim goes from pending to connected."
              detail="This happens on the agent's side — there's nothing you need to do. The memo view updates to show OpenClaw as connected once the claim is complete."
              mockSlot={
                <div className="rounded-xl border border-white/8 bg-black/30 p-4 space-y-3">
                  <div className="flex items-center gap-2 mb-1">
                    <div className="w-2 h-2 rounded-full bg-violet-400 shadow-[0_0_6px_rgba(167,139,250,0.7)]" />
                    <span className="text-xs text-violet-300 font-mono uppercase tracking-wide">
                      Connected
                    </span>
                  </div>
                  <div className="space-y-2">
                    {[
                      { label: "Agent", value: "my-research-agent" },
                      { label: "Claimed by", value: "Human: Marko" },
                      {
                        label: "Context received",
                        value: "transcript · summary · outline",
                      },
                    ].map(({ label, value }) => (
                      <div
                        key={label}
                        className="flex items-center justify-between text-xs"
                      >
                        <span className="text-white/35 font-mono">{label}</span>
                        <span className="text-white/65">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              }
            />

            {/* Connector */}
            <StepConnector />

            {/* Step 3 */}
            <StepCard
              number={3}
              title="You ask — OpenClaw answers"
              description={`OpenClaw doesn't automatically jump in after connecting. When you're ready, click the "Ask OpenClaw" button in the memo view to send your first task. That's when the conversation starts.`}
              detail="Ask it to summarize key decisions, extract action items, identify open questions, or anything else you'd want from something that's read every word of your memo."
              mockSlot={
                <div className="rounded-xl border border-white/8 bg-black/30 p-4 space-y-3">
                  <button className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-semibold transition-colors">
                    Ask OpenClaw
                  </button>
                  <p className="text-xs text-white/35 leading-relaxed text-center">
                    OpenClaw is ready. Click to start the conversation.
                  </p>
                </div>
              }
            />
          </div>

          {/* Important note */}
          <div className="mt-6 rounded-xl border border-amber-500/20 bg-amber-500/[0.05] px-5 py-4 flex gap-3">
            <span className="shrink-0 text-amber-400 mt-0.5">⚠</span>
            <p className="text-sm text-white/65 leading-relaxed">
              <strong className="text-white/85 font-semibold">
                OpenClaw waits for you.
              </strong>{" "}
              After connecting, the agent stays silent until you click Ask
              OpenClaw. No automatic greeting, no background activity — the
              first move is always yours.
            </p>
          </div>
        </section>

        {/* ── What OpenClaw can see ─────────────────────────────────────── */}
        <section className="mb-20">
          <h2 className="text-2xl font-bold text-white mb-2">
            What OpenClaw can see
          </h2>
          <p className="text-white/55 text-sm mb-8">
            The agent receives a defined context payload when it connects.
            Here&rsquo;s exactly what&rsquo;s in it and what&rsquo;s not.
          </p>

          <div className="grid sm:grid-cols-2 gap-6">
            <div className="rounded-xl border border-green-500/15 bg-green-500/5 p-6">
              <h3 className="font-semibold text-green-400 mb-4 flex items-center gap-2 text-sm uppercase tracking-wide">
                <span className="w-4 h-4 rounded-full bg-green-500/20 flex items-center justify-center text-[10px]">
                  ✓
                </span>
                Included in context
              </h3>
              <ul className="space-y-2.5">
                {SEES_YES.map((item) => (
                  <li
                    key={item.label}
                    className="flex items-start gap-2.5 text-sm text-white/65"
                  >
                    <span className="shrink-0 mt-0.5 text-green-500">✓</span>
                    {item.label}
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-xl border border-red-500/15 bg-red-500/5 p-6">
              <h3 className="font-semibold text-red-400 mb-4 flex items-center gap-2 text-sm uppercase tracking-wide">
                <span className="w-4 h-4 rounded-full bg-red-500/20 flex items-center justify-center text-[10px]">
                  ✕
                </span>
                Not accessible
              </h3>
              <ul className="space-y-2.5">
                {SEES_NO.map((item) => (
                  <li
                    key={item.label}
                    className="flex items-start gap-2.5 text-sm text-white/65"
                  >
                    <span className="shrink-0 mt-0.5 text-red-400">✕</span>
                    {item.label}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* ── V1 limitations ───────────────────────────────────────────── */}
        <section className="mb-20">
          <h2 className="text-2xl font-bold text-white mb-2">
            What to expect in v1
          </h2>
          <p className="text-white/55 text-sm mb-8">
            This is the first version of OpenClaw. It works — but here&rsquo;s
            what it doesn&rsquo;t do yet so you can set the right expectations.
          </p>

          <div className="space-y-3">
            {[
              {
                title: "The first interaction is always manual",
                body: "OpenClaw does not automatically greet you, start a conversation, or take any action after connecting. You trigger everything. The 'Ask OpenClaw' button in the memo view is the on-switch.",
              },
              {
                title: "Requires an OpenClaw-compatible agent",
                body: "You can't connect a standard chatbot or browser session. The agent needs to understand the claim handoff protocol — the same format the invite text describes. Only bring agents that are built for this.",
              },
              {
                title: "One agent per memo",
                body: "Each memo supports one active OpenClaw connection at a time. If you want to switch agents, revoke the current one first, then generate a new invite.",
              },
              {
                title: "Invite links expire in 24 hours",
                body: "If your agent doesn't claim the link in time, generate a new one. There's no limit to how many invites you can create for a memo.",
              },
              {
                title: "No real-time streaming or continuous updates",
                body: "In v1, OpenClaw receives a context snapshot at claim time. It doesn't receive live updates as you continue recording. If your memo evolves significantly after claiming, the agent is working from the context it had at connection time.",
              },
            ].map(({ title, body }) => (
              <div
                key={title}
                className="rounded-xl border border-white/8 bg-white/[0.02] px-6 py-5"
              >
                <h3 className="font-semibold text-white/90 mb-2 text-[15px]">
                  {title}
                </h3>
                <p className="text-white/55 text-sm leading-relaxed">{body}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Ownership & privacy ───────────────────────────────────────── */}
        <section className="mb-20">
          <div className="rounded-2xl border border-white/8 bg-white/[0.015] p-8 sm:p-10">
            <div className="flex items-start gap-4 mb-6">
              <div className="shrink-0 w-10 h-10 rounded-xl bg-orange-500/15 border border-orange-500/25 flex items-center justify-center text-lg">
                🔒
              </div>
              <div>
                <h2 className="text-xl font-bold text-white mb-1">
                  Your memo. Your rules.
                </h2>
                <p className="text-white/50 text-sm">
                  OpenClaw is invited — not given access.
                </p>
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-6">
              {[
                {
                  title: "You own the memo",
                  body: "Only the memo owner can generate an invite. OpenClaw can only connect to memos you've explicitly invited it to — there's no way to auto-discover or bulk-connect.",
                },
                {
                  title: "Revoke at any time",
                  body: "If you change your mind, you can remove OpenClaw from a memo at any time. The agent loses access immediately.",
                },
                {
                  title: "No access beyond the invite",
                  body: "OpenClaw sees the memo you invited it to — nothing else. Other memos, other recordings, your workspace — none of that is accessible.",
                },
                {
                  title: "Choose agents you trust",
                  body: "Sonic Memos doesn't control what the agent does with context after receiving it. Only connect agents operated by parties you trust. Think of it like email — you decide who gets the content.",
                },
              ].map(({ title, body }) => (
                <div key={title}>
                  <h3 className="font-semibold text-white/85 text-sm mb-1.5">
                    {title}
                  </h3>
                  <p className="text-white/50 text-sm leading-relaxed">{body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── FAQ ──────────────────────────────────────────────────────── */}
        <section className="mb-24">
          <h2 className="text-2xl font-bold text-white mb-2">
            Frequently asked questions
          </h2>
          <p className="text-white/55 text-sm mb-8">
            Everything you should know before connecting your first agent.
          </p>

          <div className="space-y-2">
            {FAQ_ITEMS.map((item) => (
              <FAQItem key={item.q} q={item.q} a={item.a} />
            ))}
          </div>
        </section>

        {/* ── Bottom CTA ───────────────────────────────────────────────── */}
        <section className="text-center rounded-2xl border border-orange-500/20 bg-orange-500/5 p-12">
          <h2 className="text-2xl sm:text-3xl font-bold text-white mb-3">
            Ready to connect your first agent?
          </h2>
          <p className="text-white/55 text-sm max-w-lg mx-auto mb-8 leading-relaxed">
            Open any memo you&rsquo;ve shared, find the OpenClaw option in the
            share settings, and generate an invite. The whole flow takes under a
            minute.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/"
              className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-semibold transition-colors text-sm"
            >
              Open Sonic Memos
            </Link>
            <Link
              href="/features/speaker-diarization"
              className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl border border-white/10 hover:border-white/20 text-white/60 hover:text-white font-medium transition-colors text-sm"
            >
              See other features
            </Link>
          </div>
        </section>
      </main>

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="border-t border-white/5 py-8">
        <div className="mx-auto max-w-5xl px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-white/25">
          <span>Sonic Memos · OpenClaw</span>
          <span>You control the invite. You control the context.</span>
        </div>
      </footer>
    </div>
  );
}

// ─── Step card ────────────────────────────────────────────────────────────────

function StepCard({
  number,
  title,
  description,
  detail,
  mockSlot,
}: {
  number: number;
  title: string;
  description: string;
  detail: string;
  mockSlot: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-white/8 bg-white/[0.02] overflow-hidden">
      <div className="grid sm:grid-cols-[1fr_280px] gap-0">
        {/* Text side */}
        <div className="p-7 sm:p-8">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-8 h-8 rounded-full border border-orange-500/40 bg-orange-500/10 flex items-center justify-center text-orange-400 text-sm font-bold shrink-0">
              {number}
            </div>
            <h3 className="text-lg font-bold text-white">{title}</h3>
          </div>
          <p className="text-white/65 text-sm leading-relaxed mb-3">
            {description}
          </p>
          <p className="text-white/40 text-xs leading-relaxed">{detail}</p>
        </div>

        {/* Mock side */}
        <div className="sm:border-l border-t sm:border-t-0 border-white/5 p-5 flex items-center bg-white/[0.01]">
          <div className="w-full">{mockSlot}</div>
        </div>
      </div>
    </div>
  );
}

// ─── Step connector ───────────────────────────────────────────────────────────

function StepConnector() {
  return (
    <div className="flex justify-center sm:justify-start sm:pl-[calc(2rem+16px)] py-1">
      <div className="w-px h-6 bg-gradient-to-b from-white/10 to-transparent" />
    </div>
  );
}
