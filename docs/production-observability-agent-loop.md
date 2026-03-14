# Production observability → reproduce → fix → notify (design)

Design for an automated pipeline: view production logs, detect failures, reproduce with failing tests, attempt fixes, and notify (e.g. SMS) when something is being worked on.

---

## Goal

1. **Log ingestion** – Production logs (app, API, errors) in one place, queryable.
2. **Periodic analysis** – A job (cron/scheduler) that scans logs and classifies errors/patterns.
3. **Reproduce-first** – For each identified issue, the system (or an agent) adds/updates **failing tests** that reproduce the bug (matches AGENTS.md bug-fix workflow).
4. **Fix attempt** – An agent (e.g. Claude Code) runs in a sandboxed environment, gets the failing test + context, and tries to fix the code so the test passes.
5. **Notification** – When a failure is detected (and optionally when a fix is attempted or merged), you get a message (SMS, Slack, etc.) with a short summary and link to the run/PR.

---

## Components

| Layer | Options | Notes |
|-------|--------|--------|
| **Logs** | Vercel logs, Supabase logs, custom app logging → e.g. Axiom, Datadog, Better Stack, or Supabase + Postgres | Must be queryable by time, level, message, trace ID. |
| **Scheduler** | GitHub Actions (cron), Vercel Cron, Inngest, Trigger.dev | Runs "analyze logs" and "run agent" on a schedule or webhook. |
| **Agent runner** | Cursor/Claude in a sandbox, or GitHub Actions + API (e.g. Anthropic), or a small "orchestrator" service | Needs: read logs, read repo, write branch + tests + fix, run tests. |
| **Notifications** | Twilio (SMS), Slack webhook, Discord, PagerDuty, email | Triggered when "new failure" or "fix attempted" (and optionally "fix merged"). |

---

## Design choices

- **What counts as "a failure"?**  
  e.g. 5xx, unhandled exceptions, failed `job_runs`, or specific log patterns. This drives what you query and what you send to the agent.
- **Where does the agent run?**  
  In your repo (e.g. branch created by GitHub Actions) vs. a separate "agent workspace" that clones the repo. Latter isolates production from agent experiments.
- **Human-in-the-loop**  
  Notifications can be "we found this and here's a failing test + fix branch" so you review before merge, rather than auto-merging.
- **Cost / noise**  
  Log volume and "run agent on every new error" can get expensive and noisy. You'll want rules (e.g. only new error signatures, or after N occurrences in a time window).

---

## Do this first (safe path)

You've never done this before — start with **visibility and one alert**, no agent, no auto-fix. Build the habit of "I know when prod breaks" before automating repro/fix.

### Phase 1: See production errors (no new code)

Your app already uses `console.error` / `console.warn` in API routes and hooks. On Vercel, those go to **Vercel Logs** (serverless function logs and build logs).

1. Open **Vercel Dashboard** → your project (e.g. voice-memos) → **Logs** (or **Observability** if you use that).
2. Filter by **time range** (e.g. last 24h) and, if available, by level (**Error**).
3. Trigger a real error in production (e.g. hit an API that can fail) and confirm it shows up in Logs.
4. Bookmark that page. Make it a habit to skim after deploys or when something feels off.

**Outcome:** You know where production errors live and that you can see them. Zero new services, zero code changes.

### Phase 2: One notification when something breaks

Pick **one** of these; don't do both at once.

- **Option A – Sentry (recommended for "never done this before")**  
  - Add [Sentry for Next.js](https://docs.sentry.io/platforms/javascript/guides/nextjs/) (free tier).  
  - It captures unhandled errors and `console.error`-style reports from client and server.  
  - Configure one **alert**: e.g. "Email me when a new issue is created" or "Slack message on new issue."  
  - You get a ping when a new error signature appears; you can click through to stack trace and context.

- **Option B – Single webhook (minimal, no new vendor)**  
  - Create one API route (e.g. `POST /api/report-error`) that accepts `{ message, stack?, url? }` and sends **one** Slack message (or one email via Resend/SendGrid).  
  - Call it from: (1) a React Error Boundary for client errors, (2) a catch block in 1–2 critical API routes (e.g. transcribe, upload).  
  - No SDK; you control exactly what is sent and where.

**Outcome:** When something fails in production, you get a message. Still no agent, no auto-branching, no auto-fix.

### Phase 3: After you're comfortable

- Use the same pipeline for a few weeks: see errors in Vercel (and/or Sentry), get notified, fix manually.  
- When that feels routine, consider: **log aggregation** (e.g. Vercel Log Drain → Axiom/Better Stack) for querying and patterns.  
- Only then add **reproduce (failing test) + fix (agent)** and tie them to the same notification channel (e.g. "New failure → branch with failing test created → Slack with link").

---

## Next steps (later)

- Decide which piece to build first (e.g. log aggregation + one failing-test reproduction, or "notify when we have a new error").
- Implement concrete pipeline (e.g. Vercel + Supabase + GitHub Actions + one notification channel) for this repo.
