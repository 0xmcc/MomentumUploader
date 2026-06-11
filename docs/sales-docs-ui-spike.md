# Sales Docs UI Spike

Pixel-faithful UI prototype for product direction review. **No backend, RAG, audio, or
ingestion features** — everything renders from static mock data.

## Routes

| Route | What it is |
|---|---|
| `/sales-docs-landing` | Dark marketing landing page (Memos-style hero, gradient glows, embedded live product mockup) |
| `/sales-docs` | Full app workspace: sidebar, Call Prep Assistant chat, document-style artifact canvas, live coaching rail |
| `/sales-docs-recording` | Recording workspace (mic, waveform, call list) |

All three are isolated from existing voice-memos functionality. Styles are scoped under
`.sd-root` in `src/components/sales-docs/sales-docs.css` so the app's theme system never
bleeds in.

## Data contract (the important part)

The whole `/sales-docs` page renders from a typed `SalesDoc` object — the **future AI/RAG
output contract**:

- **Contract:** `src/data/salesDocTypes.ts` (`SalesDoc`, `SalesSession`, `ChatSession`)
- **Mock data:** `src/data/mockSalesDoc.ts` (two full documents: Alex the fitness coach,
  Priya the SaaS founder)

A future generation pipeline only needs to emit a `SalesDoc` JSON object; zero component
changes are required. Proof: clicking **"SaaS Founder — Scaling"** in the Recent Sessions
sidebar swaps the entire page (chat, document, coaching rail) to the second mock object.

Component data flow:

```
SalesSession
├── chat              → ChatPanel
└── doc: SalesDoc
    ├── sourceInputs.prompt   → ChatPanel (user bubble)
    ├── (whole doc)           → ArtifactDocument
    └── liveCoaching          → LiveCoachingPanel + WorkspaceTopBar
```

No prospect-specific copy is hardcoded in components — only generic UI labels
("Export", "Copy", "Regenerate", "Share", nav items).
