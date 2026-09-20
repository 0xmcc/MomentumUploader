# What this product is meant to be

The canonical statement of what Momentum Memos is for. Written 2026-09-19, in
Marko's own words, after a 1h42m recording exposed that the app was built for
the opposite thing.

Add new versions **above** the old ones. Never rewrite a past version — the
earlier wording is the record of what we thought at the time.

The build plan that follows from this lives in [long-form-pipeline.md](./long-form-pipeline.md).

---

## In one line

**Audio capture as a first-class, programmable data source.** Hours, not
minutes. Live and shareable while it runs. Automatable during and after.

Not a web voice memo. Not a quick-snippet recorder.

---

## v1 — 2026-09-19

### Spec A: long-form capture

> I'm looking for a fundamentally different product shape than what you've built
> so far.
>
> Right now it feels optimized as a lightweight, in-browser "quick snippet"
> recorder/transcriber. What I actually need is almost the opposite: a system
> designed for long-form, high-duration audio capture and transcription.
>
> **Don't assume a browser-based/web-app primary experience.**
> A web UI can exist, but the core should behave like an always-on
> recorder/transcriber that I can trust for long sessions (think hours, not
> minutes). If browser constraints (tab focus, battery, throttling, file-size
> limits, etc.) make that unreliable, I'd strongly prefer a native or
> desktop-first solution.
>
> **Optimize for *long* recordings, not "small, fast" clips.**
> - Target recording sessions of at least 1–3 hours as a first-class use case,
>   not an edge case.
> - The system should handle large files (hundreds of MB, even multiple GB)
>   without choking, timing out, or forcing me to manually chop them up.
> - If you need to chunk internally, that should be invisible to me; I should
>   just see "one long recording."
>
> **Transcription should be robust at scale, not just low-latency for short
> audio.**
> - I care more about reliability and completeness over the entire recording
>   than about ultra-fast turnaround on 30-second clips.
> - It's fine if long files take longer to process, as long as they're processed
>   reliably and I don't have to babysit the upload or manually split them.
>
> **Recording duration should be constrained by storage, not by arbitrary time
> caps.**
> - Remove or significantly extend any hard time limits on recording length.
> - If you must have a limit (for technical or pricing reasons), make it
>   explicit and generous (e.g., "up to 2 hours per session" or "up to X GB per
>   file") so I can plan around it.
>
> **Intent:** I want to use this as a dependable tool for long-form content
> (lectures, meetings, interviews, podcasts, brainstorming sessions), where the
> primary value is "capture everything, end to end, and transcribe it
> accurately," not "quickly transcribe a short voice note."
>
> **Failure mode to avoid:** A UI that looks like it can record anything but
> silently fails, cuts off, or becomes unstable once I go beyond short clips.
> I'd rather have a product that's explicitly designed, tested, and messaged for
> long-duration recording than a "web voice memo" that struggles once sessions
> get serious.

### Spec B: live, shareable, programmable

> I'm not looking for a simple voice recorder like Apple Voice Memos. I need a
> tool that treats audio capture as a first-class, programmable data source.
>
> **Live, shareable transcription**
> - Transcription must be generated in real time, not after-the-fact only.
> - A live transcript should be viewable by others via a URL or shared session
>   while recording is in progress.
> - Multiple viewers should be able to follow along with minimal lag (ideally
>   under 1–2 seconds).
>
> **Programmable / automation-friendly**
> - I need a clear, documented API or automation hooks (e.g., webhooks,
>   callbacks, or native integration with Shortcuts/Zapier/Make).
> - Automations should be able to:
>   - Run **after** a recording completes (e.g., save transcript to a specific
>     folder, send to a CRM, trigger summary generation, create tasks from
>     action items).
>   - Optionally run **during** recording based on events in the stream (e.g.,
>     when a keyword or phrase is detected, when a speaker changes, when a
>     certain duration is reached).
> - I should be able to programmatically:
>   - Start/stop recordings
>   - Access the live transcript stream
>   - Receive structured data (timestamps, speaker labels if available,
>     confidence scores, etc.)
>
> **What I explicitly do *not* want**
> - A local-only, manual workflow where I have to tap "record," then "stop,"
>   then "share," then manually export audio to another app for processing.
> - A closed ecosystem that doesn't let me hook into the data until everything
>   is finished and packaged as a file.
>
> **Intent:** The goal is to treat recording + transcription as an automated
> pipeline, not a dead-end recording. I want to be able to build workflows on
> top of the transcript and recording events, both in real time and
> post-session, without manual intervention.

### Explicitly rejected

- **Apple Voice Memos.** Records for hours perfectly and is not the answer:
  nothing happens when you press stop. No live transcript, no share URL, no
  hook. Stated 2026-09-19, after it was proposed as the capture layer.
- **A browser tab as the trustworthy recorder.** Allowed as a viewer, not
  relied on for a three-hour session.

### What this replaces

The app as built assumed short recordings made in a browser tab, transcribed
fast. Every default follows from that assumption, and each one breaks at the
one-hour mark. That assumption is retired by this document.

---

## How we know it is met

Not an exit code and not a 200. The tests that prove this spec:

1. A three-hour recording produces a complete transcript without anyone
   babysitting it.
2. Killing the worker mid-job loses nothing — the job is reclaimed.
3. A second person opens the share URL mid-recording and sees words appear.
4. A webhook fires on completion, and the delivery is retried when the receiver
   is down.
5. A keyword spoken at minute 90 triggers its automation before the recording
   ends.

---

## Appendix: what the market does and does not sell (2026-09-19)

A survey of ~30 products and repos against the five requirements. Nothing
satisfies all five. Two findings change how this gets built.

**Requirement 3 — a shareable live transcript URL — is the one nothing sells.**
It exists as a product feature in essentially one mainstream recorder (Otter,
whose API is Enterprise-only, read-only, and fires only on completion), as an
API only in the event-captioning industry (StreamText, Wordly — delivery
layers that do not record), and in **zero** open-source projects. Every
open-source local notetaker is single-user desktop with no share URL.

So this is not a rebuild of a solved product. The pieces are commodity; the
assembly is what nobody offers. Corollary: requirement 3 is the piece that
cannot be bought later, and the during-recording half of requirement 4 is
nearly as scarce — only one vendor sells keyword-triggered events on a live
stream.

**Streaming engines have session caps that sit on top of the normal case.**
AssemblyAI and Gladia both auto-close a streaming session at exactly 3 hours;
AssemblyAI bills the full 3 hours regardless. Google caps at 5 minutes.
Speechmatics allows 48 hours. A three-hour lecture therefore lands precisely on
the cliff for two of the obvious vendors — a silent truncation, which is the
failure mode this spec exists to prevent.

Consequences for the acceptance tests above:

- Test 1 must be run against a **real 3h+ recording**, not a ten-minute stand-in.
  A short test cannot see a cap that only bites at 3:00:00.
- Test 5 (keyword at minute 90) is **not purchasable from any vendor** and has
  to be built on our own stream.

**Buy the speech engine, own the share layer.** Renting streaming transcription
costs roughly $0.12–0.40 per hour depending on vendor; at a few hours a day
that is tens of dollars a month. Hosting our own model earns nothing back.
Keep a vendor-neutral interface so the engine stays swappable and a local model
can stand in offline.
