"use client";

import Link from "next/link";
import { useState } from "react";

export const dynamic = "force-static";

// ─── Transcript mock data ────────────────────────────────────────────────────

const TRANSCRIPT_EXAMPLE = [
  {
    speaker: "Speaker 1",
    color: "text-orange-400",
    badge: "bg-orange-500/15 border-orange-500/30",
    text: "So what's the biggest blocker right now? Is it the API latency or something upstream?",
  },
  {
    speaker: "Speaker 2",
    color: "text-sky-400",
    badge: "bg-sky-500/15 border-sky-500/30",
    text: "Mostly the upstream service — it's timing out under load. We haven't touched the API layer yet.",
  },
  {
    speaker: "Speaker 1",
    color: "text-orange-400",
    badge: "bg-orange-500/15 border-orange-500/30",
    text: "Got it. So we should prioritize the retry logic before we do anything on our end.",
  },
  {
    speaker: "Speaker 2",
    color: "text-sky-400",
    badge: "bg-sky-500/15 border-sky-500/30",
    text: "Exactly. If we ship the retry wrapper this week, we can retest load by Friday.",
  },
];

// ─── Use-cases ───────────────────────────────────────────────────────────────

const USE_CASES = [
  {
    icon: "🎙️",
    title: "Interviews",
    description:
      "Instantly see who asked and who answered. Journalist, researcher, or hiring manager — the back-and-forth reads cleanly without manual labeling.",
  },
  {
    icon: "📞",
    title: "Customer calls",
    description:
      "Separate your voice from the customer's without any setup. Review objections, promises, and follow-ups by speaker in seconds.",
  },
  {
    icon: "🤝",
    title: "Meetings",
    description:
      "Multi-person check-ins become scannable. Identify who raised an issue, who committed to a task, and who said what — all in the final transcript.",
  },
  {
    icon: "🎧",
    title: "Podcasts & recordings",
    description:
      "Upload a two-person episode and get a labeled script back. Great for show notes, clips, and editing decisions.",
  },
  {
    icon: "💡",
    title: "Cofounder conversations",
    description:
      "Long strategic conversations are hard to parse in plain text. Speaker labels let you quickly jump to your thread or theirs.",
  },
  {
    icon: "🧑‍⚕️",
    title: "Research & discovery",
    description:
      "UX researchers, clinicians, and qualitative analysts: diarized transcripts save hours of post-processing when multiple voices are in the room.",
  },
];

// ─── Best conditions ─────────────────────────────────────────────────────────

const BEST_CONDITIONS = [
  { label: "Clear, close-mic audio", ok: true },
  { label: "Two to four distinct speakers", ok: true },
  { label: "Turn-taking conversation", ok: true },
  { label: "Minimal background noise", ok: true },
  { label: "Each speaker talks for several seconds at a time", ok: true },
  { label: "Indoor, low-echo environment", ok: true },
];

const HARD_CONDITIONS = [
  { label: "Noisy café, street, or open-plan office", ok: false },
  { label: "Multiple people talking simultaneously", ok: false },
  { label: "Very short clips (under ~30 seconds)", ok: false },
  { label: "Five or more overlapping voices", ok: false },
  { label: "Heavy accent variation with background voices", ok: false },
  { label: "Far-field or speakerphone audio", ok: false },
];

// ─── FAQ ─────────────────────────────────────────────────────────────────────

const FAQ_ITEMS = [
  {
    q: "What is speaker diarization?",
    a: "Diarization is the process of splitting an audio recording into segments and tagging each segment with the speaker who produced it. The word comes from the Latin for 'diary' — keeping a log of who said what. The output is a transcript where every block of speech is labeled with an anonymous speaker ID rather than presented as one undivided wall of text.",
  },
  {
    q: "Does it work during live recording?",
    a: "No. Speaker diarization is applied only to final transcripts — after you stop recording and the full audio has been processed. Live transcription shows a real-time stream of speech as you record, but that pipeline does not include diarization. Speaker labels appear when you open the completed memo, not while you are still speaking.",
  },
  {
    q: "Does the app know who each person actually is?",
    a: 'No. The labels are anonymous speaker buckets: "Speaker 1", "Speaker 2", and so on. The system groups speech by voice characteristics it detects in your audio, but it has no way to match those groups to real identities, names, or any profile data. It does not use voice biometrics or any stored voice signature. You are Speaker 1 — or Speaker 2 — depending on who spoke first. That\'s all the system knows.',
  },
  {
    q: "What happens in a noisy room?",
    a: "Background noise degrades accuracy in two ways. First, it can cause the model to confuse noise bursts with speech, generating spurious speaker segments. Second, it masks the acoustic characteristics that separate one voice from another, making boundaries between speakers fuzzier. In a very noisy environment, the system may produce unstable labels that shift mid-sentence or collapse all speech into a single speaker. The transcript text will still be there — diarization is a best-effort layer on top of it.",
  },
  {
    q: "What happens when several people talk at the same time?",
    a: "Overlapping speech is the hardest case for any diarization system. When two voices are mixed in the audio at the same time, the model must assign a single dominant speaker to that segment. It does this by word-level majority vote — the speaker whose voice dominates the most words in a segment wins the label. Some speech may be attributed to the wrong speaker, or the segment may receive no label if the overlap is dense enough that no voice dominates.",
  },
  {
    q: "What happens if the system cannot confidently separate speakers?",
    a: "There are two fallback behaviors. First, if the audio processing returns no word-level data at all — which can happen with very short or near-silent clips — the system falls back to its standard segmentation logic and produces an unlabeled transcript. No crash, no lost text, just no speaker tags. Second, individual segments with ambiguous or unassigned speaker data are rendered without a label rather than assigned a potentially wrong one. You will never see a label that was manufactured from nothing.",
  },
  {
    q: "Will this work for solo recordings?",
    a: "Yes, but the labels will be less interesting. A single-speaker recording will produce segments labeled 'Speaker 1' throughout. That is technically correct — diarization detected one speaker and tagged all segments accordingly — but it adds no new information over an unlabeled transcript. Diarization is most valuable when there are two or more distinct voices in the audio.",
  },
  {
    q: "Is this useful for meetings, interviews, podcasts, or customer calls?",
    a: "Yes — these are the primary use cases this feature was designed for. Clean two-person or small-group recordings with clear turn-taking are exactly where diarization produces reliable, readable output. A one-hour customer call becomes a structured conversation. An interview becomes a proper Q&A. A podcast episode becomes a labeled script. The value scales with how many distinct speaker turns are in the recording.",
  },
];

// ─── Component ───────────────────────────────────────────────────────────────

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
          className={`shrink-0 w-5 h-5 flex items-center justify-center rounded-full border border-white/15 text-white/50 text-xs transition-transform ${
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

export default function SpeakerDiarizationPage() {
  return (
    <div className="min-h-screen bg-background text-foreground font-sans antialiased">
      {/* Ambient glow */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 -z-10"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% -20%, rgba(249,115,22,0.12) 0%, transparent 70%)",
        }}
      />

      {/* ── Nav ─────────────────────────────────────────────────────────── */}
      <header className="sticky top-0 z-30 border-b border-white/5 bg-background/80 backdrop-blur-md">
        <div className="mx-auto max-w-5xl px-6 h-14 flex items-center justify-between">
          <Link href="/" className="text-white/70 hover:text-white text-sm transition-colors">
            ← Back to Sonic Memos
          </Link>
          <span className="text-xs text-white/30 font-mono uppercase tracking-widest">
            Feature Guide
          </span>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 pb-32">
        {/* ── Hero ──────────────────────────────────────────────────────── */}
        <section className="pt-20 pb-16 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full border border-orange-500/30 bg-orange-500/10 text-orange-400 text-xs font-medium mb-8">
            <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" />
            Final Transcripts · Speaker Labels
          </div>

          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold text-white leading-tight mb-6 tracking-tight">
            Know who said what,
            <br />
            <span className="text-orange-400">every time.</span>
          </h1>

          <p className="text-lg sm:text-xl text-white/60 max-w-2xl mx-auto leading-relaxed mb-10">
            Speaker diarization automatically labels each voice in your completed recording.
            No setup, no training, no naming — just a clean, attributed transcript the moment
            processing finishes.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-semibold transition-colors text-sm"
            >
              Try it on a recording
            </Link>
            <a
              href="#what-you-get"
              className="inline-flex items-center gap-2 px-6 py-3 rounded-xl border border-white/10 hover:border-white/20 text-white/70 hover:text-white font-medium transition-colors text-sm"
            >
              See the output first
            </a>
          </div>
        </section>

        {/* ── Divider ───────────────────────────────────────────────────── */}
        <hr className="border-white/5 mb-16" />

        {/* ── What it is ────────────────────────────────────────────────── */}
        <section className="mb-20">
          <h2 className="text-2xl font-bold text-white mb-4">What is speaker diarization?</h2>
          <div className="grid sm:grid-cols-2 gap-6 text-white/65 leading-relaxed text-[15px]">
            <p>
              Diarization is the process of listening to a recording and deciding:{" "}
              <em className="text-white/80 not-italic font-medium">
                &ldquo;these words came from Speaker A, those words came from Speaker B.&rdquo;
              </em>{" "}
              The result is a transcript that&rsquo;s broken into labeled speaker turns rather than
              one continuous block of text.
            </p>
            <p>
              In Sonic Memos, diarization runs on your{" "}
              <strong className="text-white/85 font-semibold">final transcript</strong> — after
              you stop recording and the audio has been fully processed. It adds anonymous labels
              like{" "}
              <span className="font-mono text-xs bg-white/8 px-1.5 py-0.5 rounded text-orange-300">
                Speaker 1
              </span>{" "}
              and{" "}
              <span className="font-mono text-xs bg-white/8 px-1.5 py-0.5 rounded text-sky-300">
                Speaker 2
              </span>{" "}
              to each segment. It does{" "}
              <strong className="text-white/85 font-semibold">not</strong> identify who you are,
              and it does <strong className="text-white/85 font-semibold">not</strong> run during
              live transcription.
            </p>
          </div>
        </section>

        {/* ── What you'll get ───────────────────────────────────────────── */}
        <section id="what-you-get" className="mb-20 scroll-mt-20">
          <h2 className="text-2xl font-bold text-white mb-2">What you&rsquo;ll actually get</h2>
          <p className="text-white/55 text-sm mb-8">
            This is what a diarized final transcript looks like inside the memo view.
          </p>

          {/* Transcript mock */}
          <div className="rounded-2xl border border-white/8 bg-white/[0.02] overflow-hidden mb-6">
            {/* Mock header */}
            <div className="flex items-center gap-2 px-5 py-3 border-b border-white/5 bg-white/[0.02]">
              <div className="w-2.5 h-2.5 rounded-full bg-red-500/60" />
              <div className="w-2.5 h-2.5 rounded-full bg-yellow-500/60" />
              <div className="w-2.5 h-2.5 rounded-full bg-green-500/60" />
              <span className="ml-2 text-xs text-white/30 font-mono">
                Engineering sync — March 14 · Final transcript
              </span>
            </div>

            <div className="p-2">
              {TRANSCRIPT_EXAMPLE.map((seg, i) => (
                <div
                  key={i}
                  className="px-4 py-3.5 rounded-xl mb-1 last:mb-0 border border-transparent hover:border-white/5 hover:bg-white/[0.025] transition-colors cursor-default"
                >
                  <span
                    className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md border text-xs font-semibold mb-2 ${seg.badge} ${seg.color}`}
                  >
                    {seg.speaker}
                  </span>
                  <p className="text-white/80 text-sm leading-relaxed">{seg.text}</p>
                </div>
              ))}
            </div>
          </div>

          <p className="text-white/45 text-xs leading-relaxed max-w-2xl">
            Speaker labels appear above each transcript segment. Labels are assigned in order of
            first appearance. Clicking a segment still works the same way — it anchors playback to
            that moment in the audio.
          </p>
        </section>

        {/* ── Why it's useful ───────────────────────────────────────────── */}
        <section className="mb-20">
          <h2 className="text-2xl font-bold text-white mb-2">Where this actually helps</h2>
          <p className="text-white/55 text-sm mb-8">
            Diarization is most useful when a recording has two or more distinct speakers with
            natural turn-taking. Here are the use cases it was designed for.
          </p>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {USE_CASES.map((uc) => (
              <div
                key={uc.title}
                className="rounded-xl border border-white/8 bg-white/[0.02] p-5 hover:border-white/12 hover:bg-white/[0.035] transition-colors"
              >
                <div className="text-2xl mb-3">{uc.icon}</div>
                <h3 className="font-semibold text-white mb-1.5">{uc.title}</h3>
                <p className="text-white/55 text-sm leading-relaxed">{uc.description}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── When it works best / doesn't ─────────────────────────────── */}
        <section className="mb-20">
          <h2 className="text-2xl font-bold text-white mb-2">When it works best</h2>
          <p className="text-white/55 text-sm mb-8">
            Use this section to decide whether your recording is a good candidate before you rely
            on the output.
          </p>

          <div className="grid sm:grid-cols-2 gap-6">
            {/* Good conditions */}
            <div className="rounded-xl border border-green-500/15 bg-green-500/5 p-6">
              <h3 className="font-semibold text-green-400 mb-4 flex items-center gap-2 text-sm uppercase tracking-wide">
                <span className="w-4 h-4 rounded-full bg-green-500/20 flex items-center justify-center text-[10px]">
                  ✓
                </span>
                Good conditions
              </h3>
              <ul className="space-y-2.5">
                {BEST_CONDITIONS.map((c) => (
                  <li key={c.label} className="flex items-start gap-2.5 text-sm text-white/65">
                    <span className="shrink-0 mt-0.5 text-green-500">✓</span>
                    {c.label}
                  </li>
                ))}
              </ul>
            </div>

            {/* Hard conditions */}
            <div className="rounded-xl border border-red-500/15 bg-red-500/5 p-6">
              <h3 className="font-semibold text-red-400 mb-4 flex items-center gap-2 text-sm uppercase tracking-wide">
                <span className="w-4 h-4 rounded-full bg-red-500/20 flex items-center justify-center text-[10px]">
                  ✕
                </span>
                Reduces accuracy
              </h3>
              <ul className="space-y-2.5">
                {HARD_CONDITIONS.map((c) => (
                  <li key={c.label} className="flex items-start gap-2.5 text-sm text-white/65">
                    <span className="shrink-0 mt-0.5 text-red-400">✕</span>
                    {c.label}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* ── Limitations / trust note ──────────────────────────────────── */}
        <section className="mb-20">
          <h2 className="text-2xl font-bold text-white mb-2">Honest limitations</h2>
          <p className="text-white/55 text-sm mb-8">
            Diarization is a best-effort feature. Here is exactly what it can and cannot do, so
            you can use it with the right expectations.
          </p>

          <div className="space-y-4">
            <LimitationCard
              title="Labels are anonymous — not identities"
              body={`The system does not know your name, your voice profile, or anything about you. "Speaker 1" is just the first voice it detected in this recording. It could be you, it could be the other person — it depends entirely on who spoke first. There is no way to configure named speakers, and no stored voice data is used or created.`}
            />
            <LimitationCard
              title="Overlapping speech blurs boundaries"
              body="When two people talk at the same time, the system picks the dominant voice per word. The result is usually correct when one voice clearly dominates, but heavily overlapping sections may be attributed to the wrong speaker or receive no label at all."
            />
            <LimitationCard
              title="Background voices create noise"
              body="If a TV, another conversation, or ambient speech is present in your recording, the diarization model may interpret it as an additional speaker. This can produce unexpected labels or unstable speaker assignments in parts of the transcript."
            />
            <LimitationCard
              title="Short or silent clips may produce no labels"
              body="Diarization requires enough acoustic data to distinguish speakers. Very short clips, near-silent recordings, or audio where the model returns no word-level data fall back to standard unlabeled segments. You will always get a transcript — the labels are the optional layer on top."
            />
            <LimitationCard
              title="This runs after recording — not live"
              body="Speaker labels do not appear during live transcription. They appear in the final transcript after your memo finishes processing. If you open a memo that is still being transcribed, you will not see labels yet."
            />
          </div>
        </section>

        {/* ── Inline Q&A block ─────────────────────────────────────────── */}
        <section className="mb-20 rounded-2xl border border-white/8 bg-white/[0.02] p-8">
          <h2 className="text-lg font-semibold text-white mb-1">Quick answers</h2>
          <p className="text-white/45 text-sm mb-6">Before you try it</p>

          <dl className="grid sm:grid-cols-2 gap-x-10 gap-y-6">
            {[
              {
                q: "Will this work on my recordings?",
                a: "If your recording has two or more people speaking in turns with reasonably clear audio, yes. Solo recordings still get labels, but they won't tell you anything new.",
              },
              {
                q: "What happens in a noisy room?",
                a: "Accuracy drops. Background noise makes it harder to separate voices, and the model may misattribute or skip labeling some segments.",
              },
              {
                q: "What if multiple people are talking?",
                a: "Overlapping speech is handled on a word-by-word basis. The dominant voice wins. Dense cross-talk may produce merged or missing labels.",
              },
              {
                q: "Does it know who I am vs who someone else is?",
                a: "No. It has no identity information. It groups voices by acoustic similarity within this recording only.",
              },
              {
                q: "Does it work live?",
                a: "No. Speaker labels are only added to final transcripts after the full recording has been processed.",
              },
              {
                q: "What if it can't tell speakers apart?",
                a: "It falls back gracefully — segments get no label rather than a wrong one. The transcript text is always preserved.",
              },
            ].map(({ q, a }) => (
              <div key={q}>
                <dt className="text-white/85 font-medium text-sm mb-1">{q}</dt>
                <dd className="text-white/50 text-sm leading-relaxed">{a}</dd>
              </div>
            ))}
          </dl>
        </section>

        {/* ── FAQ ───────────────────────────────────────────────────────── */}
        <section className="mb-24">
          <h2 className="text-2xl font-bold text-white mb-2">Frequently asked questions</h2>
          <p className="text-white/55 text-sm mb-8">
            Everything you should know before relying on speaker labels in production work.
          </p>

          <div className="space-y-2">
            {FAQ_ITEMS.map((item) => (
              <FAQItem key={item.q} q={item.q} a={item.a} />
            ))}
          </div>
        </section>

        {/* ── Bottom CTA ────────────────────────────────────────────────── */}
        <section className="text-center rounded-2xl border border-orange-500/20 bg-orange-500/5 p-12">
          <h2 className="text-2xl sm:text-3xl font-bold text-white mb-3">
            Ready to see it on your recordings?
          </h2>
          <p className="text-white/55 text-sm max-w-lg mx-auto mb-8 leading-relaxed">
            Open any completed memo and check the final transcript — speaker labels will appear
            automatically if the audio contained multiple distinct voices. Or record a two-person
            conversation now and see the output when it finishes.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/"
              className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white font-semibold transition-colors text-sm"
            >
              Open Sonic Memos
            </Link>
            <Link
              href="/portfolio"
              className="inline-flex items-center gap-2 px-7 py-3.5 rounded-xl border border-white/10 hover:border-white/20 text-white/60 hover:text-white font-medium transition-colors text-sm"
            >
              See more features
            </Link>
          </div>
        </section>
      </main>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className="border-t border-white/5 py-8">
        <div className="mx-auto max-w-5xl px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-white/25">
          <span>Sonic Memos · Speaker Diarization</span>
          <span>Labels are anonymous. No voice data is stored.</span>
        </div>
      </footer>
    </div>
  );
}

// ─── Limitation card sub-component ───────────────────────────────────────────

function LimitationCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.02] px-6 py-5">
      <h3 className="font-semibold text-white/90 mb-2 text-[15px]">{title}</h3>
      <p className="text-white/55 text-sm leading-relaxed">{body}</p>
    </div>
  );
}
