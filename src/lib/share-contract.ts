import {
  createEmptyArtifactMap,
  type ArtifactMap,
} from "@/lib/artifact-types";
import { SHOW_ARTIFACTS_IN_UI } from "@/lib/feature-flags";
import type { ResolvedMemoShare } from "@/lib/share-domain";
import type { TranscriptSegment } from "@/lib/transcript";

export type ShareFormat = "html" | "md" | "json";

export type ParsedShareRef = {
  shareToken: string;
  pathFormat: ShareFormat;
};

export type SharedArtifactPayload = {
  artifactType: string;
  artifactId: string;
  shareToken: string;
  canonicalUrl: string;
  title: string;
  transcript: string;
  mediaUrl: string | null;
  createdAt: string;
  sharedAt: string | null;
  expiresAt: string | null;
  isLiveRecording?: boolean;
  transcriptStatus?: string | null;
  transcriptSegments?: TranscriptSegment[] | null;
  artifacts?: ArtifactMap | null;
};

export type SharedArtifactJson = {
  artifact: {
    type: string;
    id: string;
    shareToken: string;
    canonicalUrl: string;
    title: string;
    transcript: string;
    transcriptSegments: TranscriptSegment[] | null;
    media: {
      audioUrl: string | null;
    };
    timestamps: {
      createdAt: string;
      sharedAt: string | null;
      expiresAt: string | null;
    };
    artifacts: ArtifactMap;
  };
};

export type ShareBootPayload = {
  shareToken: string;
  canonicalUrl: string;
  isLiveRecording: boolean;
  transcriptFileName: string;
  mediaUrl: string | null;
};

const SUPPORTED_QUERY_FORMATS = new Set<string>(["html", "md", "json"]);

function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#039;");
}

type OutlinePayload = {
  items?: Array<{
    title?: string;
    summary?: string;
  }>;
};

function resolveArtifacts(payload: SharedArtifactPayload): ArtifactMap {
  return payload.artifacts ?? createEmptyArtifactMap();
}

function renderSummaryMarkdown(payload: SharedArtifactPayload): string[] {
  const summary = resolveArtifacts(payload).rolling_summary?.payload as
    | { summary?: string }
    | null;

  if (!summary?.summary) {
    return [];
  }

  return ["## Summary", "", summary.summary, ""];
}

function renderOutlineMarkdown(payload: SharedArtifactPayload): string[] {
  const outline = resolveArtifacts(payload).outline?.payload as OutlinePayload | null;
  const items = outline?.items ?? [];

  if (items.length === 0) {
    return [];
  }

  return [
    "## Outline",
    "",
    ...items.map((item) => `- **${item.title ?? "Untitled"}**: ${item.summary ?? ""}`.trim()),
    "",
  ];
}

function toSafeFileName(input: string): string {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return normalized || "shared-memo";
}

function tokenFromRef(shareRef: string): ParsedShareRef {
  if (shareRef.endsWith(".md")) {
    return { shareToken: shareRef.slice(0, -3), pathFormat: "md" };
  }
  if (shareRef.endsWith(".json")) {
    return { shareToken: shareRef.slice(0, -5), pathFormat: "json" };
  }
  return { shareToken: shareRef, pathFormat: "html" };
}

export function parseShareRef(shareRef: string): ParsedShareRef {
  const normalized = shareRef.trim();
  if (!normalized) {
    throw new Error("Missing share reference");
  }
  return tokenFromRef(normalized);
}

export function resolveShareFormat(pathFormat: ShareFormat, queryFormat: string | null): ShareFormat {
  if (!queryFormat) {
    return pathFormat;
  }

  const normalized = queryFormat.trim().toLowerCase();
  if (!SUPPORTED_QUERY_FORMATS.has(normalized)) {
    throw new Error("Unsupported format");
  }

  const resolved = normalized as ShareFormat;
  if (pathFormat !== "html" && resolved !== pathFormat) {
    throw new Error("Conflicting format selectors");
  }

  return resolved;
}

export function buildSharePageViewModel(
  memo: ResolvedMemoShare,
  canonicalUrl: string,
  artifacts: ArtifactMap
): SharedArtifactPayload {
  return {
    artifactType: "memo",
    artifactId: memo.memoId,
    shareToken: memo.shareToken,
    canonicalUrl,
    title: memo.title,
    transcript: memo.transcript,
    mediaUrl: memo.mediaUrl,
    createdAt: memo.createdAt,
    sharedAt: memo.sharedAt,
    expiresAt: memo.expiresAt,
    isLiveRecording: memo.isLiveRecording,
    transcriptStatus: memo.transcriptStatus,
    transcriptSegments: memo.transcriptSegments,
    artifacts,
  };
}

export function serializeShareBootPayload(payload: ShareBootPayload): string {
  return JSON.stringify(payload).replace(/</g, "\\u003c");
}

export function buildSharedArtifactJson(payload: SharedArtifactPayload): SharedArtifactJson {
  const artifacts = resolveArtifacts(payload);
  return {
    artifact: {
      type: payload.artifactType,
      id: payload.artifactId,
      shareToken: payload.shareToken,
      canonicalUrl: payload.canonicalUrl,
      title: payload.title,
      transcript: payload.transcript,
      transcriptSegments: payload.transcriptSegments ?? null,
      media: {
        audioUrl: payload.mediaUrl,
      },
      timestamps: {
        createdAt: payload.createdAt,
        sharedAt: payload.sharedAt,
        expiresAt: payload.expiresAt,
      },
      artifacts,
    },
  };
}

export function buildSharedArtifactMarkdown(payload: SharedArtifactPayload): string {
  const lines = [
    "---",
    `artifact_type: ${payload.artifactType}`,
    `artifact_id: ${payload.artifactId}`,
    `share_token: ${payload.shareToken}`,
    `canonical_url: ${payload.canonicalUrl}`,
    `created_at: ${payload.createdAt}`,
    `shared_at: ${payload.sharedAt ?? "null"}`,
    `expires_at: ${payload.expiresAt ?? "null"}`,
    `media_url: ${payload.mediaUrl ?? "null"}`,
    "---",
    "",
    `# ${payload.title}`,
    "",
    ...renderSummaryMarkdown(payload),
    ...renderOutlineMarkdown(payload),
    "## Transcript",
    "",
    payload.transcript || "*(no transcript)*",
    "",
    "## Metadata",
    "",
    `- Artifact type: ${payload.artifactType}`,
    `- Artifact id: ${payload.artifactId}`,
    `- Canonical URL: ${payload.canonicalUrl}`,
    `- Created at: ${payload.createdAt}`,
    `- Shared at: ${payload.sharedAt ?? "n/a"}`,
    `- Expires at: ${payload.expiresAt ?? "n/a"}`,
    `- Audio URL: ${payload.mediaUrl ?? "n/a"}`,
    "",
  ];

  return lines.join("\n");
}

function formatMs(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export type BuildSharedArtifactHtmlOptions = {
  /** When true, include Summary and Outline panels in HTML. When false (default), omit them (they remain in markdown/JSON for agents). */
  showArtifactsInUi?: boolean;
};

export function buildSharedArtifactHtml(
  payload: SharedArtifactPayload,
  options?: BuildSharedArtifactHtmlOptions
): string {
  const showArtifacts = options?.showArtifactsInUi ?? SHOW_ARTIFACTS_IN_UI;
  const escapedTitle = escapeHtml(payload.title);
  const escapedCanonicalUrl = escapeHtml(payload.canonicalUrl);
  const escapedArtifactType = escapeHtml(payload.artifactType);
  const artifacts = resolveArtifacts(payload);
  const summaryPayload = artifacts.rolling_summary?.payload as
    | { summary?: string }
    | null;
  const outlinePayload = artifacts.outline?.payload as OutlinePayload | null;
  const outlineItems = outlinePayload?.items ?? [];

  // Process transcript: default text if empty, escape HTML, then wrap \n\n blocks in <p> tags
  const rawTranscript = payload.transcript || "(no transcript)";
  const escapedTranscript = escapeHtml(rawTranscript)
    .split(/\n\s*\n/) // split by double newlines or double newlines with whitespace
    .map(paragraph => paragraph.trim())
    .filter(paragraph => paragraph.length > 0)
    .map(paragraph => `<div class="transcript-block">${paragraph}</div>`)
    .join("\n");

  // Build timestamp-anchored segment list if available; otherwise fall back to plain text.
  const transcriptContentHtml = payload.transcriptSegments?.length
    ? `<div id="transcript-content" class="transcript">\n${payload.transcriptSegments.map(seg => {
        const ts = formatMs(seg.startMs);
        const escaped = escapeHtml(seg.text);
        return `  <div class="transcript-segment" id="t-${seg.startMs}" data-start="${seg.startMs}" data-end="${seg.endMs}">` +
          `<button class="ts-btn" type="button" data-seek="${seg.startMs}">${ts}</button>` +
          `<span class="seg-text">${escaped}</span></div>`;
      }).join("\n")}\n</div>`
    : `<div class="transcript" id="transcript-content">${escapedTranscript}</div>`;

  const escapedAudioUrl = escapeHtml(payload.mediaUrl ?? "");
  const encodedCanonical = encodeURI(payload.canonicalUrl);
  const encodedMarkdown = `${encodedCanonical}.md`;
  const encodedJson = `${encodedCanonical}.json`;
  const transcriptFileName = `${toSafeFileName(payload.title)}-transcript.txt`;
  const isLiveRecording = payload.isLiveRecording === true;
  const serializedBootPayload = serializeShareBootPayload({
    shareToken: payload.shareToken,
    canonicalUrl: payload.canonicalUrl,
    isLiveRecording,
    transcriptFileName,
    mediaUrl: payload.mediaUrl,
  });
  const liveRefreshMeta = isLiveRecording
    ? "<meta http-equiv=\"refresh\" content=\"3\" />"
    : "";
  const liveStatusNotice = isLiveRecording
    ? "<p class=\"live-status\">Live recording in progress. This page refreshes every 3 seconds.</p>"
    : "";
  const summaryHtml =
    showArtifacts && summaryPayload?.summary
      ? `<section class="artifact-panel"><h2>Summary</h2><p>${escapeHtml(summaryPayload.summary)}</p></section>`
      : "";
  const outlineHtml =
    showArtifacts && outlineItems.length > 0
      ? `<section class="artifact-panel"><h2>Outline</h2><ol>${outlineItems
          .map((item) =>
            `<li><strong>${escapeHtml(item.title ?? "Untitled")}</strong><p>${escapeHtml(
              item.summary ?? ""
            )}</p></li>`
          )
          .join("")}</ol></section>`
      : "";

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  ${liveRefreshMeta}
  <title>${escapedTitle} | Shared ${escapedArtifactType}</title>
  <meta name="description" content="Shared ${escapedArtifactType} from MomentumUploader" />
  <link rel="canonical" href="${escapedCanonicalUrl}" />
  <link rel="alternate" type="text/markdown" href="${encodedMarkdown}" />
  <link rel="alternate" type="application/json" href="${encodedJson}" />
  <style>
    :root { color-scheme: dark; }
    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
      background: radial-gradient(circle at 30% 0%, #2a1a06 0%, #0f0902 55%, #0a0601 100%);
      color: #fff7ed;
      line-height: 1.55;
      min-height: 100vh;
    }
    main {
      max-width: 860px;
      margin: 0 auto;
      padding: 2rem 1.25rem 5rem;
    }
    article {
      background: rgba(30, 16, 5, 0.7);
      border: 1px solid rgba(251, 146, 60, 0.25);
      border-radius: 18px;
      padding: 1.25rem;
      box-shadow: 0 22px 44px rgba(0, 0, 0, 0.34);
      min-height: 80vh;
    }
    h1 { margin: 0 0 .35rem; font-size: clamp(1.5rem, 4vw, 2.15rem); }
    h2 { margin-top: 1.25rem; margin-bottom: .5rem; font-size: 1.1rem; }
    .artifact-panel {
      margin-top: 1rem;
      padding: 1rem 1.1rem;
      border-radius: 14px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(251, 146, 60, 0.14);
    }
    .artifact-panel ol {
      margin: 0;
      padding-left: 1.1rem;
    }
    .artifact-panel li + li {
      margin-top: .9rem;
    }
    .artifact-panel p {
      margin: .3rem 0 0;
    }
    .transcript-header {
      margin-top: 1.25rem;
      margin-bottom: .5rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: .75rem;
    }
    .transcript-header-actions {
      display: flex;
      align-items: center;
      gap: .5rem;
    }
    .transcript-header h2 { margin: 0; }
    p.meta {
      margin: 0 0 1rem;
      color: #fdba74;
      font-size: .92rem;
    }
    p.live-status {
      margin: 0 0 1rem;
      color: #fde68a;
      font-size: .82rem;
      letter-spacing: .02em;
      text-transform: uppercase;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .transcript-sticky-container {
      position: sticky;
      top: 0;
      z-index: 10;
      background: #190e05; /* matches article background to avoid transparency clash */
      margin: 0 -1.25rem;
      padding: 0.5rem 1.25rem 1rem;
      border-bottom: 1px solid rgba(251, 146, 60, 0.15);
      border-radius: 18px 18px 0 0; /* Match article border radius when it sticks */
    }
    .transcript {
      max-width: 65ch;
      margin: 1.5rem auto 0;
      background: rgba(0, 0, 0, 0.2);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      padding: 1rem 1.75rem;
      height: 60vh;
      overflow-y: auto;
      overflow-wrap: anywhere;
      word-break: break-word;
      line-height: 1.7;
    }
    .transcript-block {
      padding: 12px 16px;
      margin-bottom: 10px;
      background: rgba(255, 255, 255, 0.04);
      border: 1px solid rgba(251, 146, 60, 0.14);
      border-radius: 8px;
      line-height: 1.7;
    }
    .transcript-block:last-child {
      margin-bottom: 0;
    }
    .export-transcript-btn, .copy-transcript-btn {
      border: 1px solid rgba(251, 191, 126, 0.35);
      background: rgba(234, 88, 12, 0.18);
      color: #ffedd5;
      border-radius: 999px;
      padding: .35rem .72rem;
      font-size: .78rem;
      font-weight: 600;
      cursor: pointer;
    }
    .export-transcript-btn:hover {
      background: rgba(234, 88, 12, 0.34);
      border-color: rgba(251, 191, 126, 0.55);
    }
    .export-transcript-btn:focus-visible, .copy-transcript-btn:focus-visible {
      outline: 2px solid rgba(251, 191, 126, 0.7);
      outline-offset: 2px;
    }
    .copy-transcript-btn {
      background: rgba(251, 146, 60, 0.18);
    }
    .copy-transcript-btn:hover {
      background: rgba(251, 146, 60, 0.34);
    }
    .share-audio {
      width: 100%;
      margin: 1rem 0 .65rem;
      border-radius: 14px;
      background:
        linear-gradient(180deg, rgba(83, 48, 21, 0.36), rgba(39, 24, 12, 0.72)),
        rgba(26, 16, 8, 0.72);
      box-shadow:
        inset 0 1px 0 rgba(255, 213, 167, 0.1),
        inset 0 -1px 0 rgba(0, 0, 0, 0.24),
        0 10px 22px rgba(0, 0, 0, 0.24);
      border: 1px solid rgba(251, 191, 126, 0.18);
      accent-color: #e5924f;
      overflow: hidden;
    }
    .share-audio::-webkit-media-controls-enclosure {
      border-radius: 14px;
      background:
        linear-gradient(180deg, rgba(84, 49, 24, 0.34), rgba(31, 20, 10, 0.78)),
        rgba(23, 15, 8, 0.72);
    }
    .share-audio::-webkit-media-controls-panel {
      background:
        radial-gradient(circle at 14% 50%, rgba(255, 169, 92, 0.1), transparent 48%),
        linear-gradient(180deg, rgba(87, 53, 27, 0.3), rgba(30, 20, 11, 0.82));
      color: #ffe8d1;
      padding-inline: .45rem;
    }
    section[aria-labelledby="transcript-heading"] { margin-top: .15rem; }
    section[aria-labelledby="transcript-heading"] h2 { margin-top: 0; }
    .share-audio::-webkit-media-controls-play-button {
      border-radius: 999px;
      background-color: rgba(96, 57, 28, 0.72);
      border: 1px solid rgba(255, 205, 161, 0.24);
      color: #ffe6ce;
      box-shadow:
        inset 0 1px 0 rgba(255, 227, 198, 0.22),
        inset 0 -1px 0 rgba(0, 0, 0, 0.34),
        0 1px 2px rgba(0, 0, 0, 0.35);
    }
    .share-audio::-webkit-media-controls-current-time-display,
    .share-audio::-webkit-media-controls-time-remaining-display {
      color: #ffd7b2;
      text-shadow: 0 1px 1px rgba(0, 0, 0, 0.45);
    }
    .share-audio::-webkit-media-controls-timeline {
      border-radius: 999px;
      height: .42rem;
      margin-inline: .55rem;
      background:
        linear-gradient(90deg, rgba(241, 154, 84, 0.92), rgba(211, 116, 51, 0.85) 45%, rgba(141, 72, 33, 0.64));
      box-shadow:
        inset 0 0 0 1px rgba(255, 211, 167, 0.2),
        inset 0 0 7px rgba(255, 176, 112, 0.35),
        0 0 0 1px rgba(0, 0, 0, 0.26);
    }
    .share-audio::-webkit-media-controls-volume-slider {
      border-radius: 999px;
      background: linear-gradient(90deg, rgba(217, 129, 63, 0.78), rgba(122, 68, 34, 0.6));
    }
    dl {
      margin: 0;
      padding: 0;
      display: grid;
      grid-template-columns: minmax(120px, 180px) 1fr;
      gap: .45rem .8rem;
      font-size: .95rem;
    }
    dt { color: #fed7aa; }
    dd { margin: 0; color: #ffedd5; overflow-wrap: anywhere; }
    dd a { color: #fdba74; text-decoration: none; }
    dd a:hover { text-decoration: underline; }
    .promo {
      position: fixed;
      right: 12px;
      bottom: 12px;
      display: flex;
      align-items: center;
      gap: .6rem;
      background: rgba(17, 17, 17, 0.88);
      border: 1px solid rgba(251, 146, 60, 0.28);
      border-radius: 999px;
      padding: .42rem .42rem .42rem .72rem;
      backdrop-filter: blur(8px);
    }
    .promo small {
      color: #ffedd5;
      font-size: .75rem;
      letter-spacing: .01em;
    }
    .promo a {
      border-radius: 999px;
      padding: .35rem .7rem;
      background: #ea580c;
      color: #fff;
      text-decoration: none;
      font-size: .78rem;
      font-weight: 600;
    }
    .promo a:hover { background: #c2410c; }
    .transcript-search-row {
      display: flex;
      align-items: center;
      gap: .45rem;
      margin: .6rem 0 .45rem;
      flex-wrap: wrap;
    }
    .transcript-search-input {
      flex: 1;
      min-width: 0;
      background: rgba(0, 0, 0, 0.25);
      border: 1px solid rgba(251, 191, 126, 0.28);
      border-radius: 999px;
      padding: .32rem .8rem;
      color: #ffedd5;
      font-size: .87rem;
      outline: none;
      font-family: inherit;
    }
    .transcript-search-input::placeholder { color: rgba(255, 237, 213, 0.38); }
    .transcript-search-input:focus {
      border-color: rgba(251, 191, 126, 0.6);
      background: rgba(0, 0, 0, 0.35);
    }
    .search-match-count {
      font-size: .78rem;
      color: #fdba74;
      white-space: nowrap;
      min-width: 4ch;
      text-align: right;
    }
    .search-nav-btn {
      border: 1px solid rgba(251, 191, 126, 0.3);
      background: rgba(234, 88, 12, 0.14);
      color: #ffedd5;
      border-radius: 999px;
      width: 1.7rem;
      height: 1.7rem;
      font-size: .82rem;
      cursor: pointer;
      line-height: 1;
      padding: 0;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .search-nav-btn:hover { background: rgba(234, 88, 12, 0.3); }
    .search-nav-btn:disabled { opacity: .35; cursor: default; }
    .search-nav-btn:focus-visible {
      outline: 2px solid rgba(251, 191, 126, 0.7);
      outline-offset: 2px;
    }
    mark.search-hit {
      background: rgba(253, 186, 116, 0.38);
      color: #fff7ed;
      border-radius: 2px;
      padding: 0 1px;
    }
    mark.search-hit-active {
      background: rgba(234, 88, 12, 0.72);
      color: #fff;
      border-radius: 2px;
      padding: 0 1px;
    }
    .transcript-segment {
      display: flex;
      gap: .65rem;
      align-items: baseline;
      padding: .3rem 0;
      border-radius: 4px;
      transition: background .15s;
    }
    .transcript-segment.active {
      background: rgba(234, 88, 12, 0.12);
    }
    .ts-btn {
      flex-shrink: 0;
      font-family: ui-monospace, monospace;
      font-size: .72rem;
      color: #fdba74;
      background: rgba(234, 88, 12, 0.14);
      border: 1px solid rgba(251, 191, 126, 0.25);
      border-radius: 4px;
      padding: 1px 6px;
      cursor: pointer;
      white-space: nowrap;
      line-height: 1.5;
    }
    .ts-btn:hover { background: rgba(234, 88, 12, 0.3); }
    .seg-text { flex: 1; }
    .disc-section {
      margin-top: 3rem;
      padding-top: 2rem;
      border-top: 1px solid rgba(251, 191, 126, 0.15);
    }
    .disc-heading {
      margin: 0 0 1rem;
      font-size: 0.7rem;
      text-transform: uppercase;
      letter-spacing: 0.1em;
      opacity: 0.5;
    }
    .disc-loading,
    .disc-empty {
      margin: 0;
      color: #fed7aa;
      font-size: 0.95rem;
    }
    .disc-msg {
      padding: 1rem 0;
      border-bottom: 1px solid rgba(251, 191, 126, 0.14);
    }
    .disc-msg:last-child {
      border-bottom: 0;
      padding-bottom: 0;
    }
    .disc-meta {
      display: flex;
      align-items: center;
      gap: 0.6rem;
      flex-wrap: wrap;
      margin-bottom: 0.45rem;
      font-size: 0.85rem;
    }
    .disc-author {
      color: #fff7ed;
      font-weight: 600;
    }
    .disc-time {
      color: #fdba74;
    }
    .disc-content {
      margin: 0;
      color: #ffedd5;
      white-space: pre-wrap;
    }
    .disc-form {
      margin-top: 1.25rem;
    }
    .disc-form textarea {
      width: 100%;
      min-height: 5.5rem;
      resize: vertical;
      box-sizing: border-box;
      background: rgba(0, 0, 0, 0.25);
      border: 1px solid rgba(251, 191, 126, 0.28);
      border-radius: 14px;
      padding: 0.8rem 0.9rem;
      color: #ffedd5;
      font: inherit;
    }
    .disc-form textarea:focus {
      outline: none;
      border-color: rgba(251, 191, 126, 0.6);
      background: rgba(0, 0, 0, 0.35);
    }
    .disc-form-row {
      margin-top: 0.75rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
    }
    .disc-form button,
    .ts-link {
      border: 1px solid rgba(251, 191, 126, 0.3);
      background: rgba(234, 88, 12, 0.16);
      color: #ffedd5;
      border-radius: 999px;
      padding: 0.35rem 0.75rem;
      font-size: 0.78rem;
      cursor: pointer;
    }
    .disc-form button:hover,
    .ts-link:hover {
      background: rgba(234, 88, 12, 0.3);
    }
    .disc-error {
      color: #fca5a5;
      font-size: 0.78rem;
    }
  </style>
</head>
<body>
  <main>
    <article>
      <h1>${escapedTitle}</h1>
      <p class="meta">Shared ${escapedArtifactType} • canonical URL: <a href="${escapedCanonicalUrl}" style="color:#fdba74">${escapedCanonicalUrl}</a></p>
      ${liveStatusNotice}
      ${summaryHtml}
      ${outlineHtml}
      
      <div class="transcript-sticky-container">
        ${payload.mediaUrl ? `<audio class="share-audio" controls preload="metadata" src="${escapedAudioUrl}"></audio>` : ""}
        <section aria-labelledby="transcript-heading">
          <div class="transcript-header">
            <h2 id="transcript-heading">Transcript</h2>
            <div class="transcript-header-actions">
              <button type="button" id="copy-transcript-btn" class="copy-transcript-btn">Copy</button>
              <button type="button" id="export-transcript-btn" class="export-transcript-btn">Export</button>
            </div>
          </div>
          <div class="transcript-search-row">
            <input type="text" id="transcript-search" class="transcript-search-input" placeholder="Search transcript…" aria-label="Search transcript" autocomplete="off" />
            <span id="search-match-count" class="search-match-count" aria-live="polite" aria-atomic="true"></span>
            <button id="search-prev" class="search-nav-btn" aria-label="Previous match" disabled>↑</button>
            <button id="search-next" class="search-nav-btn" aria-label="Next match" disabled>↓</button>
          </div>
        </section>
      </div>
      
      ${transcriptContentHtml}
      <section id="comments-root">
        <section id="discussion" class="disc-section">
          <h2 class="disc-heading">Discussion</h2>
          <div id="disc-list" aria-live="polite">
            <p class="disc-loading">Loading...</p>
          </div>
          <form id="disc-form" class="disc-form" style="display:none" novalidate>
            <textarea id="disc-input" placeholder="Add a note..." rows="3" required></textarea>
            <div class="disc-form-row">
              <span id="disc-error" class="disc-error" role="alert" style="display:none"></span>
              <button type="submit" id="disc-submit">Post</button>
            </div>
          </form>
          <p id="disc-signin" style="display:none">Sign in to add a note.</p>
          <p id="disc-owner-only" style="display:none">Only the memo owner can post.</p>
        </section>
      </section>
      
    </article>
  </main>
  <header class="promo" aria-label="MomentumUploader app call to action">
    <small>MomentumUploader</small>
    <a href="/" rel="noopener">Use App</a>
  </header>
  <script id="share-boot" type="application/json">${serializedBootPayload}</script>
  <script>
    const shareBoot = (() => {
      const shareBootEl = document.getElementById("share-boot");
      if (!shareBootEl || !shareBootEl.textContent) return null;

      try {
        return JSON.parse(shareBootEl.textContent);
      } catch (_error) {
        return null;
      }
    })();

    (() => {
      const exportButton = document.getElementById("export-transcript-btn");
      const copyButton = document.getElementById("copy-transcript-btn");
      const transcriptContent = document.getElementById("transcript-content");
      
      if (!transcriptContent) return;

      if (exportButton) {
        exportButton.addEventListener("click", () => {
          const transcript = transcriptContent.textContent || "";
          const fileName =
            shareBoot && typeof shareBoot.transcriptFileName === "string"
              ? shareBoot.transcriptFileName
              : "shared-transcript.txt";
          const blob = new Blob([transcript], { type: "text/plain;charset=utf-8" });
          const downloadUrl = URL.createObjectURL(blob);
          const downloadLink = document.createElement("a");
          downloadLink.href = downloadUrl;
          downloadLink.download = fileName;
          document.body.appendChild(downloadLink);
          downloadLink.click();
          downloadLink.remove();
          URL.revokeObjectURL(downloadUrl);
        });
      }

      if (copyButton) {
        copyButton.addEventListener("click", () => {
          // Extract text cleanly — works for both segment cards and plain-text blocks
          const paragraphs = transcriptContent.querySelectorAll(".transcript-block, .seg-text");
          let textToCopy = "";
          
          if (paragraphs.length > 0) {
            textToCopy = Array.from(paragraphs).map(p => p.textContent).join("\\n\\n");
          } else {
            textToCopy = transcriptContent.textContent || "";
          }

          navigator.clipboard.writeText(textToCopy).then(() => {
            const originalText = copyButton.textContent;
            copyButton.textContent = "Copied!";
            setTimeout(() => {
              copyButton.textContent = originalText;
            }, 2000);
          }).catch(err => {
            console.error("Failed to copy text: ", err);
            copyButton.textContent = "Error";
          });
        });
      }
    })();

    (() => {
      if (!shareBoot) return;

      const discussionList = document.getElementById("disc-list");
      const form = document.getElementById("disc-form");
      const discussionInput = document.getElementById("disc-input");
      const discussionError = document.getElementById("disc-error");
      const discussionSubmit = document.getElementById("disc-submit");
      const signInHint = document.getElementById("disc-signin");
      const ownerOnlyHint = document.getElementById("disc-owner-only");

      if (
        !discussionList ||
        !form ||
        !discussionInput ||
        !discussionError ||
        !discussionSubmit ||
        !signInHint ||
        !ownerOnlyHint
      ) {
        return;
      }

      const shareRef = shareBoot.shareToken;

      function escHtml(s) {
        return String(s)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#039;");
      }

      function fmtRelative(iso) {
        const date = new Date(iso);
        if (Number.isNaN(date.getTime())) {
          return "";
        }

        const diffSeconds = Math.round((date.getTime() - Date.now()) / 1000);
        const absSeconds = Math.abs(diffSeconds);
        if (typeof Intl === "undefined" || typeof Intl.RelativeTimeFormat !== "function") {
          return date.toLocaleString();
        }

        const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
        if (absSeconds < 60) {
          return rtf.format(diffSeconds, "second");
        }

        const diffMinutes = Math.round(diffSeconds / 60);
        if (Math.abs(diffMinutes) < 60) {
          return rtf.format(diffMinutes, "minute");
        }

        const diffHours = Math.round(diffSeconds / 3600);
        if (Math.abs(diffHours) < 24) {
          return rtf.format(diffHours, "hour");
        }

        const diffDays = Math.round(diffSeconds / 86400);
        return rtf.format(diffDays, "day");
      }

      function fmtMs(ms) {
        const totalSec = Math.floor(ms / 1000);
        const minutes = Math.floor(totalSec / 60);
        const seconds = totalSec % 60;
        return minutes + ":" + String(seconds).padStart(2, "0");
      }

      async function loadDiscussion() {
        form.style.display = "none";
        signInHint.style.display = "none";
        ownerOnlyHint.style.display = "none";

        try {
          const res = await fetch("/api/s/" + shareRef + "/discussion");
          if (!res.ok) {
            throw new Error("Failed to load discussion");
          }

          const { messages, isOwner, isAuthenticated } = await res.json();
          discussionList.innerHTML = messages.length === 0
            ? '<p class="disc-empty">No notes yet.</p>'
            : messages.map((message) => {
                return '<div class="disc-msg">' +
                  '<div class="disc-meta">' +
                    '<span class="disc-author">' + escHtml(message.authorName) + '</span>' +
                    '<span class="disc-time">' + escHtml(fmtRelative(message.createdAt)) + '</span>' +
                    (message.anchorStartMs != null
                      ? '<button class="disc-anchor ts-link" data-t="' + message.anchorStartMs + '">▶ ' + fmtMs(message.anchorStartMs) + '</button>'
                      : "") +
                  "</div>" +
                  '<p class="disc-content">' + escHtml(message.content) + "</p>" +
                "</div>";
              }).join("");

          const audio = document.querySelector("audio.share-audio");
          discussionList.querySelectorAll(".disc-anchor").forEach((btn) =>
            btn.addEventListener("click", () => {
              if (!audio) return;
              audio.currentTime = +btn.dataset.t / 1000;
              audio.play().catch(function() {});
            })
          );

          if (isOwner) {
            form.style.display = "";
            if (!form._listenerAttached) {
              form._listenerAttached = true;
              form.addEventListener("submit", async (event) => {
                event.preventDefault();
                const content = discussionInput.value.trim();
                if (!content) return;

                discussionSubmit.disabled = true;
                discussionError.style.display = "none";

                try {
                  const response = await fetch("/api/s/" + shareRef + "/discussion", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ content }),
                    credentials: "include",
                  });

                  if (!response.ok) {
                    let message = "Post failed";
                    try {
                      const payload = await response.json();
                      if (payload && typeof payload.error === "string") {
                        message = payload.error;
                      }
                    } catch (_error) {
                      // Fall back to the generic message.
                    }

                    throw new Error(message);
                  }

                  discussionInput.value = "";
                  await loadDiscussion();
                } catch (error) {
                  discussionError.textContent = error instanceof Error ? error.message : "Post failed";
                  discussionError.style.display = "";
                } finally {
                  discussionSubmit.disabled = false;
                }
              });
            }
          } else if (isAuthenticated) {
            ownerOnlyHint.style.display = "";
          } else {
            signInHint.style.display = "";
          }
        } catch (_error) {
          discussionList.innerHTML = '<p class="disc-error">Could not load discussion.</p>';
        }
      }

      loadDiscussion();
    })();

    (() => {
      const searchInput = document.getElementById("transcript-search");
      const matchCountEl = document.getElementById("search-match-count");
      const prevBtn = document.getElementById("search-prev");
      const nextBtn = document.getElementById("search-next");
      const transcriptEl = document.getElementById("transcript-content");
      if (!searchInput || !matchCountEl || !prevBtn || !nextBtn || !transcriptEl) return;

      const blocks = Array.from(transcriptEl.querySelectorAll(".transcript-block, .seg-text"));
      const blockTexts = blocks.map(function(b) { return b.textContent || ""; });
      const originalText = blockTexts.join("\\n\\n");
      const SEARCH_KEY = "transcript-search-query";
      let currentIndex = -1;

      function escHtml(s) {
        return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      }

      function escRegExp(s) {
        return s.replace(/[-\\/\\\\^$*+?.()|[\\]{}]/g, "\\\\$&");
      }

      function applySearch(query) {
        if (!query) {
          blocks.forEach(function(b, i) { b.innerHTML = escHtml(blockTexts[i]); });
          matchCountEl.textContent = "";
          prevBtn.disabled = true;
          nextBtn.disabled = true;
          currentIndex = -1;
          return;
        }

        let totalCount = 0;
        blocks.forEach(function(b, i) {
          var html = "", last = 0;
          var localRegex = new RegExp(escRegExp(query), "gi");
          var m;
          while ((m = localRegex.exec(blockTexts[i])) !== null) {
            html += escHtml(blockTexts[i].slice(last, m.index));
            html += '<mark class="search-hit">' + escHtml(m[0]) + "</mark>";
            last = localRegex.lastIndex;
            totalCount++;
            if (localRegex.lastIndex === m.index) { localRegex.lastIndex++; }
          }
          html += escHtml(blockTexts[i].slice(last));
          b.innerHTML = html;
        });
        var count = totalCount;

        const hasMatches = count > 0;
        matchCountEl.textContent = hasMatches ? "1 / " + count : "0 matches";
        prevBtn.disabled = !hasMatches;
        nextBtn.disabled = !hasMatches;
        currentIndex = hasMatches ? 0 : -1;
        updateActive();
      }

      function updateActive() {
        const marks = transcriptEl.querySelectorAll("mark.search-hit");
        marks.forEach(function(mark, i) {
          if (i === currentIndex) {
            mark.classList.add("search-hit-active");
            mark.scrollIntoView({ block: "nearest" });
          } else {
            mark.classList.remove("search-hit-active");
          }
        });
        if (marks.length > 0 && currentIndex >= 0) {
          matchCountEl.textContent = (currentIndex + 1) + " / " + marks.length;
        }
      }

      const saved = sessionStorage.getItem(SEARCH_KEY);
      if (saved) {
        searchInput.value = saved;
        applySearch(saved);
      }

      searchInput.addEventListener("input", function() {
        const q = searchInput.value.trim();
        if (q) { sessionStorage.setItem(SEARCH_KEY, q); }
        else { sessionStorage.removeItem(SEARCH_KEY); }
        currentIndex = 0;
        applySearch(q);
      });

      nextBtn.addEventListener("click", function() {
        const marks = transcriptEl.querySelectorAll("mark.search-hit");
        if (!marks.length) return;
        currentIndex = (currentIndex + 1) % marks.length;
        updateActive();
      });

      prevBtn.addEventListener("click", function() {
        const marks = transcriptEl.querySelectorAll("mark.search-hit");
        if (!marks.length) return;
        currentIndex = (currentIndex - 1 + marks.length) % marks.length;
        updateActive();
      });

      searchInput.addEventListener("keydown", function(e) {
        const marks = transcriptEl.querySelectorAll("mark.search-hit");
        if (e.key !== "Enter" || !marks.length) return;
        if (e.shiftKey) {
          currentIndex = (currentIndex - 1 + marks.length) % marks.length;
        } else {
          currentIndex = (currentIndex + 1) % marks.length;
        }
        updateActive();
        e.preventDefault();
      });
    })();

    (() => {
      // Timestamp anchor: seek audio and highlight the active segment.
      const audio = document.querySelector("audio.share-audio");
      const transcriptEl = document.getElementById("transcript-content");
      if (!transcriptEl) return;

      const segments = Array.from(transcriptEl.querySelectorAll(".transcript-segment[data-start]"));
      if (!segments.length) return;

      // Seek audio on timestamp button click
      transcriptEl.addEventListener("click", function(e) {
        const btn = e.target.closest(".ts-btn[data-seek]");
        if (!btn || !audio) return;
        const ms = Number(btn.getAttribute("data-seek"));
        audio.currentTime = ms / 1000;
        audio.play().catch(function() {});
      });

      // Highlight active segment during playback
      if (audio) {
        audio.addEventListener("timeupdate", function() {
          const nowMs = audio.currentTime * 1000;
          segments.forEach(function(seg) {
            const start = Number(seg.getAttribute("data-start"));
            const end = Number(seg.getAttribute("data-end"));
            if (nowMs >= start && nowMs < end) {
              seg.classList.add("active");
            } else {
              seg.classList.remove("active");
            }
          });
        });
      }

      // Deep-link: /s/token#t-45000 seeks to 45 seconds and scrolls to segment
      const hash = location.hash;
      const hashMatch = hash.match(/^#t-(\\d+)$/);
      if (hashMatch) {
        const targetMs = Number(hashMatch[1]);
        if (audio) {
          audio.currentTime = targetMs / 1000;
        }
        const target = document.getElementById("t-" + targetMs);
        if (target) {
          target.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }
    })();
  </script>
</body>
</html>`;
}

export function buildShareErrorMarkdown(message: string): string {
  return `# Share Unavailable\n\n${message}\n`;
}

export function buildShareErrorHtml(message: string): string {
  const safeMessage = escapeHtml(message);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Share Unavailable</title>
  <style>
    body {
      margin: 0;
      background: #0f0902;
      color: #fff7ed;
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
      display: grid;
      place-items: center;
      min-height: 100vh;
      padding: 1rem;
    }
    section {
      width: min(560px, 100%);
      background: rgba(30, 16, 5, 0.8);
      border: 1px solid rgba(251, 146, 60, 0.3);
      border-radius: 16px;
      padding: 1.2rem;
    }
    h1 { margin-top: 0; margin-bottom: .6rem; font-size: 1.35rem; }
    p { margin: 0; color: #fed7aa; }
  </style>
</head>
<body>
  <section>
    <h1>Share unavailable</h1>
    <p>${safeMessage}</p>
  </section>
</body>
</html>`;
}
