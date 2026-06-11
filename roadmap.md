# Sales Docs — Roadmap

Status as of 2026-06-11, branch `sales-docs-ui-pixel-spike`.

**Done:** Pixel spike shipped — `/sales-docs-landing`, `/sales-docs`,
`/sales-docs-recording`, all rendering from the typed `SalesDoc` mock contract
(`src/data/salesDocTypes.ts`). Lint/types/tests green, existing app untouched.
See `docs/sales-docs-ui-spike.md`.

## MVP cut — what actually blocks shipping

Everything below the line is the full backlog; this is the minimum to put
real users in front of `/sales-docs`. The MVP is: **type a prompt (or paste
call notes) → get a real generated SalesDoc → it persists and reloads.**
Live coaching, the recording route, and pixel-diff polish are all post-MVP.

1. [x] **Generation endpoint** — `POST /api/sales-docs/generate` emits a
       `SalesDoc` (`src/lib/sales-doc-generation.ts`). E2E verified in the
       browser 2026-06-11: prompt → real doc rendered in ~90s. Note: the
       contract exceeds Anthropic's structured-outputs grammar limit, so the
       schema rides in the system prompt and `assertPayloadShape` enforces it
       at runtime (one corrective retry).
2. [x] **Wire the chat composer** — composer submits, loading bubble while
       generating, error banner on failure, new session prepends + activates.
3. [ ] **Persistence** — save sessions (Supabase), Recent Sessions lists real
       data, doc survives reload (§4).
4. [~] **Auth-gate** `/sales-docs` deferred; landing CTAs ("Generate a call
       prep doc", "Get started", "Sign in") now route to `/sales-docs` (§5).
5. [ ] **Minimum interaction credibility** — working copy-to-clipboard, outline
       anchor scroll (§2). Skip animations and Call Brief tab.
6. [ ] **Responsive floor** — don't break below ~1280px; a usable single-column
       fallback is enough (§1).
7. [x] **Contract regression test** — generated-payload fixture renders through
       ArtifactDocument + LiveCoachingPanel (`ArtifactDocument.test.tsx`) (§5).

Explicitly **not** MVP: live coaching audio (rail can show a "demo" badge or be
hidden), `/sales-docs-recording` completion, avatar imagery, pixel overlay-diff,
separate-product decision (ship inside the current app, decide later).

---

## 1. Pixel-perfection pass (visual polish)

- [ ] Overlay-diff against the reference screenshots at exactly 1536px; tune
      headline size/weight/letter-spacing on the landing hero
- [ ] Real avatar imagery (prospect photo in doc header, user avatar) instead of
      gradient initials
- [ ] Tighten Live Coaching pill, pause/stop button metrics against the Lovable
      reference top bar
- [ ] Landing glow composition: compare saturation/position side-by-side with
      Screenshot A at the fold
- [ ] Basic responsive fallback below ~1280px (panels currently fixed-width;
      landing mockup crops)

## 2. Interaction polish (still static data)

- [ ] Outline rail active-state driven by scroll position (IntersectionObserver)
- [ ] Animate chat checklist items appearing sequentially (framer-motion is
      already a dependency)
- [ ] Smooth-scroll outline anchor clicks
- [ ] "Call Brief" tab renders a condensed one-page brief view
- [ ] Hover states for objection rows / belief sections; working copy-to-clipboard
      on Copy buttons
- [ ] Live coaching demo mode: timer ticks, insights appear over time (scripted,
      no real audio)

## 3. Recording route completion (Screenshot C was never supplied)

- [ ] Get the actual Memos recording-workspace screenshot and add the missing
      panes: speakers, transcript, AI notes
- [ ] Recording → generates a SalesDoc (fake transition into `/sales-docs`)

## 4. Real data pipeline (replaces mocks — the actual product)

- [ ] AI generation endpoint that emits a `SalesDoc` JSON conforming to
      `salesDocTypes.ts` (prompt → doc); UI requires zero changes by design
- [ ] Transcript/call-notes ingestion feeding `sourceInputs`
- [ ] Wire chat composer to the generation pipeline (streaming doc sections in)
- [ ] Persist sessions (Supabase) and populate Recent Sessions for real
- [ ] Real live coaching: audio capture → realtime insights/belief progress
      (the rail already renders entirely from `salesDoc.liveCoaching`)

## 5. Productization (only if direction review passes)

- [ ] Decide: separate product vs. mode inside Sonic Memos
- [ ] Auth-gate the workspace routes; landing stays public
- [ ] Hook up CTA → onboarding flow
- [ ] Component tests for SalesDoc rendering (contract regression safety)

## Housekeeping

- [ ] gstack upgrade available (0.11.10.0 → 1.57.10.0) — browse daemon needed
      manual fixes this session; upgrade likely resolves them permanently
