import {
  createEmptyArtifactMap,
  type ArtifactMap,
} from "@/lib/artifact-types";
import { SHOW_ARTIFACTS_IN_UI } from "@/lib/feature-flags";
import type { ResolvedMemoShare } from "@/lib/share-domain";
import { DEFAULT_THEME, THEMES } from "@/lib/themes";
import type { TranscriptSegment } from "@/lib/transcript";

export type ShareFormat = "html" | "md" | "json";

const OPENCLAW_SKILL_VERSION = "0.1.2" as const;

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
  agent_handoff: AgentHandoffPayload;
};

export type ShareBootPayload = {
  shareToken: string;
  canonicalUrl: string;
  isLiveRecording: boolean;
  transcriptFileName: string;
  mediaUrl: string | null;
};

export type AgentHandoffPayload = {
  kind: "momentum/share-agent-handoff";
  version: "1";
  shareRef: string;
  canonicalUrl: string;
  alternates: {
    markdownUrl: string;
    jsonUrl: string;
  };
  skill: {
    manifestUrl: string;
    version: typeof OPENCLAW_SKILL_VERSION;
  };
  authentication: {
    header: "x-openclaw-api-key";
    format: "oc_acct_123:secret-xyz";
    required: true;
    registerFirstIfMissing: true;
  };
  bootstrap: {
    registrationUrl: string;
    method: "POST";
    registrationTokenField: "registration_token";
    displayNameField: "display_name";
  };
  handoff: {
    url: string;
    method: "POST";
  };
  suggestedInitialAction: {
    type: "greeting";
    instruction: string;
  };
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

export function serializeEmbeddedJson(payload: unknown): string {
  return JSON.stringify(payload).replace(/</g, "\\u003c");
}

function buildAgentHandoffPayload(payload: SharedArtifactPayload): AgentHandoffPayload {
  const canonicalUrl = new URL(payload.canonicalUrl);
  const baseUrl = canonicalUrl.origin;

  return {
    kind: "momentum/share-agent-handoff",
    version: "1",
    shareRef: payload.shareToken,
    canonicalUrl: payload.canonicalUrl,
    alternates: {
      markdownUrl: `${payload.canonicalUrl}.md`,
      jsonUrl: `${payload.canonicalUrl}.json`,
    },
    skill: {
      manifestUrl: `${baseUrl}/openclaw/memo-room/v1/skill.json`,
      version: OPENCLAW_SKILL_VERSION,
    },
    authentication: {
      header: "x-openclaw-api-key",
      format: "oc_acct_123:secret-xyz",
      required: true,
      registerFirstIfMissing: true,
    },
    bootstrap: {
      registrationUrl: `${baseUrl}/api/openclaw/register`,
      method: "POST",
      registrationTokenField: "registration_token",
      displayNameField: "display_name",
    },
    handoff: {
      url: `${baseUrl}/api/s/${payload.shareToken}/handoff`,
      method: "POST",
    },
    suggestedInitialAction: {
      type: "greeting",
      instruction: "Introduce yourself briefly in the memo room and offer help.",
    },
  };
}

export function serializeShareBootPayload(payload: ShareBootPayload): string {
  return serializeEmbeddedJson(payload);
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
    agent_handoff: buildAgentHandoffPayload(payload),
  };
}

export function buildSharedArtifactMarkdown(payload: SharedArtifactPayload): string {
  const agentHandoff = buildAgentHandoffPayload(payload);
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
    `skill_manifest_url: ${agentHandoff.skill.manifestUrl}`,
    `registration_url: ${agentHandoff.bootstrap.registrationUrl}`,
    `handoff_url: ${agentHandoff.handoff.url}`,
    `handoff_auth_header: ${agentHandoff.authentication.header}`,
    `handoff_auth_format: ${agentHandoff.authentication.format}`,
    `registration_required_without_api_key: ${String(agentHandoff.authentication.registerFirstIfMissing)}`,
    `alternate_json_url: ${agentHandoff.alternates.jsonUrl}`,
    `alternate_markdown_url: ${agentHandoff.alternates.markdownUrl}`,
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

function renderTranscriptContentHtml(payload: SharedArtifactPayload): string {
  const rawTranscript = payload.transcript || "(no transcript)";
  const escapedTranscript = escapeHtml(rawTranscript)
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0)
    .map((paragraph) => `<div class="transcript-block">${paragraph}</div>`)
    .join("\n");

  if (!payload.transcriptSegments?.length) {
    return `<div class="transcript" id="transcript-content">${escapedTranscript}</div>`;
  }

  return `<div id="transcript-content" class="transcript">\n${payload.transcriptSegments
    .map((seg) => {
      const ts = formatMs(seg.startMs);
      const escaped = escapeHtml(seg.text);
      return `  <div class="transcript-segment" id="t-${seg.startMs}" data-start="${seg.startMs}" data-end="${seg.endMs}">` +
        `<button class="ts-btn" type="button" data-seek="${seg.startMs}">${ts}</button>` +
        `<span class="seg-text">${escaped}</span></div>`;
    })
    .join("\n")}\n</div>`;
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

  const transcriptContentHtml = renderTranscriptContentHtml(payload);

  const escapedAudioUrl = escapeHtml(payload.mediaUrl ?? "");
  const encodedCanonical = encodeURI(payload.canonicalUrl);
  const encodedMarkdown = `${encodedCanonical}.md`;
  const encodedJson = `${encodedCanonical}.json`;
  const transcriptFileName = `${toSafeFileName(payload.title)}-transcript.txt`;
  const agentHandoffPayload = buildAgentHandoffPayload(payload);
  const serializedThemes = JSON.stringify(
    THEMES.map((theme) => ({
      id: theme.id,
      vars: theme.vars,
    }))
  );
  const isLiveRecording = payload.isLiveRecording === true;
  const serializedBootPayload = serializeShareBootPayload({
    shareToken: payload.shareToken,
    canonicalUrl: payload.canonicalUrl,
    isLiveRecording,
    transcriptFileName,
    mediaUrl: payload.mediaUrl,
  });
  const serializedAgentHandoffPayload = serializeEmbeddedJson(agentHandoffPayload);
  const liveStatusNotice = isLiveRecording
    ? "<p class=\"live-status\">Live recording in progress. Transcript updates automatically every 3 seconds.</p>"
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
  <title>${escapedTitle} | Shared ${escapedArtifactType}</title>
  <meta name="description" content="Shared ${escapedArtifactType} from MomentumUploader" />
  <link rel="canonical" href="${escapedCanonicalUrl}" />
  <link rel="alternate" type="text/markdown" href="${encodedMarkdown}" />
  <link rel="alternate" type="application/json" href="${encodedJson}" />
  <meta name="momentum:share-agent-handoff" content="available" />
  <script id="momentum-share-agent-handoff" type="application/json">${serializedAgentHandoffPayload}</script>
  <style>
    :root {
      color-scheme: dark;
      --background: ${DEFAULT_THEME.vars.background};
      --foreground: ${DEFAULT_THEME.vars.foreground};
      --accent: ${DEFAULT_THEME.vars.accent};
      --accent-hover: ${DEFAULT_THEME.vars.accentHover};
      --surface: ${DEFAULT_THEME.vars.surface};
      --border: ${DEFAULT_THEME.vars.border};
      --theme-glow: ${DEFAULT_THEME.vars.glow};
      --theme-glass-bg: ${DEFAULT_THEME.vars.glassBg};
      --theme-neo-blur: ${DEFAULT_THEME.vars.neoBlur};
    }
    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif;
      background: var(--background);
      color: var(--foreground);
      line-height: 1.55;
      min-height: 100vh;
    }
    main {
      max-width: 860px;
      margin: 0 auto;
      padding: 2rem 1.25rem 5rem;
    }
    article {
      padding: 1.25rem;
      min-height: 80vh;
    }
    h1 { margin: 0 0 .35rem; font-size: clamp(1.5rem, 4vw, 2.15rem); }
    h2 { margin-top: 1.25rem; margin-bottom: .5rem; font-size: 1.1rem; }
    .artifact-panel {
      margin-top: 1rem;
      padding: 1rem 1.1rem;
      border-top: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
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
      color: color-mix(in srgb, var(--foreground) 82%, var(--accent) 18%);
      font-size: .92rem;
    }
    p.meta a {
      color: var(--accent);
      text-decoration: none;
    }
    p.meta a:hover { text-decoration: underline; }
    p.live-status {
      margin: 0 0 1rem;
      color: color-mix(in srgb, var(--foreground) 74%, var(--accent) 26%);
      font-size: .82rem;
      letter-spacing: .02em;
      text-transform: uppercase;
      font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    }
    .transcript-sticky-container {
      position: sticky;
      top: 0;
      z-index: 10;
      background: var(--background);
      padding: 0.5rem 0 1rem;
      border-bottom: 1px solid color-mix(in srgb, var(--border) 65%, transparent);
    }
    .transcript {
      max-width: 60ch;
      margin: 1.5rem auto 0;
      padding: 0;
      height: 60vh;
      overflow-y: auto;
      overflow-wrap: anywhere;
      word-break: break-word;
      line-height: 1.7;
    }
    .transcript-block {
      padding: 0 0 12px;
      margin-bottom: 12px;
      border-bottom: 1px solid color-mix(in srgb, var(--border) 65%, transparent);
      line-height: 1.7;
    }
    .transcript-block:last-child {
      margin-bottom: 0;
      padding-bottom: 0;
      border-bottom: 0;
    }
    .export-transcript-btn, .copy-transcript-btn {
      border: 1px solid color-mix(in srgb, var(--border) 55%, var(--accent) 45%);
      background: transparent;
      color: var(--foreground);
      border-radius: 999px;
      padding: .35rem .72rem;
      font-size: .78rem;
      font-weight: 600;
      cursor: pointer;
    }
    .export-transcript-btn:hover {
      background: color-mix(in srgb, var(--foreground) 6%, transparent);
      border-color: color-mix(in srgb, var(--border) 35%, var(--accent) 65%);
    }
    .export-transcript-btn:focus-visible, .copy-transcript-btn:focus-visible {
      outline: 2px solid color-mix(in srgb, var(--accent) 70%, white 30%);
      outline-offset: 2px;
    }
    .copy-transcript-btn {
      background: transparent;
    }
    .copy-transcript-btn:hover {
      background: color-mix(in srgb, var(--foreground) 6%, transparent);
    }
    .share-audio {
      width: 100%;
      margin: 1rem 0 .65rem;
      border-radius: 10px;
      background: color-mix(in srgb, var(--surface) 55%, transparent);
      border: 1px solid color-mix(in srgb, var(--border) 65%, transparent);
      accent-color: var(--accent);
      overflow: hidden;
    }
    .share-audio::-webkit-media-controls-enclosure {
      border-radius: 10px;
      background: color-mix(in srgb, var(--surface) 55%, transparent);
    }
    .share-audio::-webkit-media-controls-panel {
      background: color-mix(in srgb, var(--surface) 55%, transparent);
      color: var(--foreground);
      padding-inline: .45rem;
    }
    section[aria-labelledby="transcript-heading"] { margin-top: .15rem; }
    section[aria-labelledby="transcript-heading"] h2 { margin-top: 0; }
    .share-audio::-webkit-media-controls-play-button {
      border-radius: 999px;
      background-color: color-mix(in srgb, var(--foreground) 8%, transparent);
      border: 1px solid color-mix(in srgb, var(--border) 55%, var(--foreground) 45%);
      color: var(--foreground);
    }
    .share-audio::-webkit-media-controls-current-time-display,
    .share-audio::-webkit-media-controls-time-remaining-display {
      color: color-mix(in srgb, var(--foreground) 80%, var(--accent) 20%);
      text-shadow: 0 1px 1px rgba(0, 0, 0, 0.45);
    }
    .share-audio::-webkit-media-controls-timeline {
      border-radius: 999px;
      height: .42rem;
      margin-inline: .55rem;
      background: linear-gradient(
        90deg,
        var(--accent),
        color-mix(in srgb, var(--accent-hover) 75%, var(--surface) 25%)
      );
    }
    .share-audio::-webkit-media-controls-volume-slider {
      border-radius: 999px;
      background: linear-gradient(
        90deg,
        color-mix(in srgb, var(--accent) 82%, white 18%),
        color-mix(in srgb, var(--accent-hover) 75%, var(--surface) 25%)
      );
    }
    dl {
      margin: 0;
      padding: 0;
      display: grid;
      grid-template-columns: minmax(120px, 180px) 1fr;
      gap: .45rem .8rem;
      font-size: .95rem;
    }
    dt { color: color-mix(in srgb, var(--foreground) 78%, var(--accent) 22%); }
    dd { margin: 0; color: var(--foreground); overflow-wrap: anywhere; }
    dd a { color: var(--accent); text-decoration: none; }
    dd a:hover { text-decoration: underline; }
    .promo {
      position: fixed;
      right: 12px;
      bottom: 12px;
      display: flex;
      align-items: center;
      gap: .6rem;
      background: var(--theme-glass-bg);
      border: 1px solid color-mix(in srgb, var(--border) 55%, var(--accent) 45%);
      border-radius: 999px;
      padding: .42rem .42rem .42rem .72rem;
      backdrop-filter: blur(8px);
    }
    .promo small {
      color: var(--foreground);
      font-size: .75rem;
      letter-spacing: .01em;
    }
    .promo a {
      border-radius: 999px;
      padding: .35rem .7rem;
      background: var(--accent);
      color: var(--foreground);
      text-decoration: none;
      font-size: .78rem;
      font-weight: 600;
    }
    .promo a:hover { background: var(--accent-hover); }
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
      background: transparent;
      border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
      border-radius: 999px;
      padding: .32rem .8rem;
      color: var(--foreground);
      font-size: .87rem;
      outline: none;
      font-family: inherit;
    }
    .transcript-search-input::placeholder {
      color: color-mix(in srgb, var(--foreground) 38%, transparent);
    }
    .transcript-search-input:focus {
      border-color: color-mix(in srgb, var(--border) 35%, var(--accent) 65%);
      background: color-mix(in srgb, var(--foreground) 4%, transparent);
    }
    .search-match-count {
      font-size: .78rem;
      color: var(--accent);
      white-space: nowrap;
      min-width: 4ch;
      text-align: right;
    }
    .search-nav-btn {
      border: 1px solid color-mix(in srgb, var(--border) 55%, var(--accent) 45%);
      background: transparent;
      color: var(--foreground);
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
    .search-nav-btn:hover {
      background: color-mix(in srgb, var(--foreground) 6%, transparent);
    }
    .search-nav-btn:disabled { opacity: .35; cursor: default; }
    .search-nav-btn:focus-visible {
      outline: 2px solid color-mix(in srgb, var(--accent) 70%, white 30%);
      outline-offset: 2px;
    }
    mark.search-hit {
      background: color-mix(in srgb, var(--accent) 34%, transparent);
      color: var(--foreground);
      border-radius: 2px;
      padding: 0 1px;
    }
    mark.search-hit-active {
      background: color-mix(in srgb, var(--accent) 74%, black 26%);
      color: var(--foreground);
      border-radius: 2px;
      padding: 0 1px;
    }
    .transcript-segment {
      display: flex;
      gap: .65rem;
      align-items: baseline;
      padding: .6rem 0;
      border-radius: 4px;
      transition: background .15s;
    }
    .transcript-segment.active {
      background: color-mix(in srgb, var(--accent) 10%, transparent);
    }
    .ts-btn {
      flex-shrink: 0;
      font-family: ui-monospace, monospace;
      font-size: .72rem;
      color: var(--accent);
      background: transparent;
      border: 1px solid color-mix(in srgb, var(--border) 55%, var(--accent) 45%);
      border-radius: 4px;
      padding: 1px 6px;
      cursor: pointer;
      white-space: nowrap;
      line-height: 1.5;
    }
    .ts-btn:hover {
      background: color-mix(in srgb, var(--foreground) 6%, transparent);
    }
    .seg-text { flex: 1; }
    .disc-section {
      margin-top: 3rem;
      padding-top: 2rem;
      border-top: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
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
      color: color-mix(in srgb, var(--foreground) 78%, var(--accent) 22%);
      font-size: 0.95rem;
    }
    .disc-msg {
      padding: 1rem 0;
      border-bottom: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
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
    .disc-author-row {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      min-width: 0;
    }
    .disc-avatar {
      width: 1.85rem;
      height: 1.85rem;
      border-radius: 999px;
      object-fit: cover;
      flex-shrink: 0;
      border: 1px solid color-mix(in srgb, var(--border) 60%, var(--accent) 40%);
      background: color-mix(in srgb, var(--surface) 85%, var(--accent) 15%);
    }
    .disc-avatar-fallback {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 0.72rem;
      font-weight: 700;
      color: var(--foreground);
    }
    .disc-author {
      color: var(--foreground);
      font-weight: 600;
    }
    .disc-owner-mark {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 1.1rem;
      height: 1.1rem;
      border-radius: 999px;
      background: color-mix(in srgb, var(--accent) 18%, transparent);
      color: var(--accent);
      border: 1px solid color-mix(in srgb, var(--border) 45%, var(--accent) 55%);
      flex-shrink: 0;
    }
    .disc-owner-mark svg {
      width: 0.7rem;
      height: 0.7rem;
      display: block;
    }
    .disc-time {
      color: var(--accent);
    }
    .disc-content {
      margin: 0;
      color: var(--foreground);
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
      background: transparent;
      border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
      border-radius: 14px;
      padding: 0.8rem 0.9rem;
      color: var(--foreground);
      font: inherit;
    }
    .disc-form textarea:focus {
      outline: none;
      border-color: color-mix(in srgb, var(--border) 35%, var(--accent) 65%);
      background: color-mix(in srgb, var(--foreground) 4%, transparent);
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
      border: 1px solid color-mix(in srgb, var(--border) 55%, var(--accent) 45%);
      background: transparent;
      color: var(--foreground);
      border-radius: 999px;
      padding: 0.35rem 0.75rem;
      font-size: 0.78rem;
      cursor: pointer;
    }
    .disc-form button:hover,
    .ts-link:hover {
      background: color-mix(in srgb, var(--foreground) 6%, transparent);
    }
    .disc-error {
      color: #fca5a5;
      font-size: 0.78rem;
    }
    #openclaw-widget {
      margin-top: 1rem;
      display: none;
      gap: 0.8rem;
      padding: 0.9rem 0;
      border-top: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
    }
    .oc-widget {
      display: flex;
      flex-direction: column;
      gap: 0.55rem;
    }
    .oc-label,
    .oc-hint,
    .oc-status {
      margin: 0;
      font-size: 0.9rem;
      color: color-mix(in srgb, var(--foreground) 86%, var(--accent) 14%);
    }
    .oc-status {
      display: inline-flex;
      align-items: center;
      gap: 0.45rem;
      font-weight: 600;
    }
    #openclaw-widget button {
      width: fit-content;
      border: 1px solid color-mix(in srgb, var(--border) 55%, var(--accent) 45%);
      background: transparent;
      color: var(--foreground);
      border-radius: 999px;
      padding: 0.35rem 0.75rem;
      font-size: 0.78rem;
      cursor: pointer;
    }
    #openclaw-widget button:hover {
      background: color-mix(in srgb, var(--foreground) 6%, transparent);
    }
    .oc-preview {
      display: none;
      gap: 0.75rem;
      padding: 1rem;
      border-radius: 18px;
      border: 1px solid color-mix(in srgb, var(--accent) 48%, var(--border) 52%);
      background:
        linear-gradient(
          180deg,
          color-mix(in srgb, var(--foreground) 4%, transparent),
          color-mix(in srgb, var(--surface) 88%, transparent)
        );
      box-shadow: inset 0 1px 0 color-mix(in srgb, var(--foreground) 7%, transparent);
    }
    .oc-preview-title {
      margin: 0;
      font-size: 0.82rem;
      font-weight: 700;
      letter-spacing: 0.02em;
      color: color-mix(in srgb, var(--foreground) 92%, var(--accent) 8%);
    }
    .oc-preview-text {
      margin: 0;
      padding: 0.85rem 0.95rem;
      border-radius: 14px;
      border: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
      background: color-mix(in srgb, var(--surface) 92%, black 8%);
      color: color-mix(in srgb, var(--accent) 76%, var(--foreground) 24%);
      white-space: pre-wrap;
      word-break: break-word;
      font: 500 0.82rem/1.6 ui-monospace, SFMono-Regular, Menlo, Monaco, "Liberation Mono", "Courier New", monospace;
    }
    .oc-preview-steps {
      margin: 0;
      padding-left: 1.35rem;
      display: grid;
      gap: 0.38rem;
      color: color-mix(in srgb, var(--foreground) 74%, var(--accent) 26%);
      font-size: 0.86rem;
    }
    .oc-preview-steps li::marker {
      color: var(--accent);
      font-weight: 700;
    }
    #oc-reg-section {
      margin-top: 0.75rem;
      padding-top: 0.75rem;
      border-top: 1px solid color-mix(in srgb, var(--border) 40%, transparent);
      display: flex;
      flex-direction: column;
      gap: 0.45rem;
    }
    .oc-reg-hint {
      font-size: 0.75rem;
      color: color-mix(in srgb, var(--foreground) 55%, transparent);
      margin: 0;
    }
    .oc-reg-token-block {
      font-family: monospace;
      font-size: 0.78rem;
      background: color-mix(in srgb, var(--foreground) 6%, transparent);
      padding: 0.4rem 0.6rem;
      border-radius: 4px;
      word-break: break-all;
    }
    .oc-reg-warn {
      font-size: 0.72rem;
      color: color-mix(in srgb, var(--foreground) 55%, transparent);
    }
    #oc-ask-dialog {
      display: none;
      margin-top: 0.35rem;
      gap: 0.6rem;
    }
    #oc-ask-input {
      width: 100%;
      min-height: 4.2rem;
      resize: vertical;
      box-sizing: border-box;
      background: transparent;
      border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
      border-radius: 14px;
      padding: 0.8rem 0.9rem;
      color: var(--foreground);
      font: inherit;
    }
    #oc-ask-input:focus {
      outline: none;
      border-color: color-mix(in srgb, var(--border) 35%, var(--accent) 65%);
      background: color-mix(in srgb, var(--foreground) 4%, transparent);
    }
  </style>
</head>
<body>
  <main>
    <article>
      <h1>${escapedTitle}</h1>
      <p class="meta">Shared ${escapedArtifactType} • canonical URL: <a href="${escapedCanonicalUrl}">${escapedCanonicalUrl}</a></p>
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
          <div id="openclaw-widget">
            <div id="oc-invite" class="oc-widget">
              <p class="oc-label">Connect your OpenClaw to this memo</p>
              <button id="oc-invite-btn" type="button">Invite OpenClaw</button>
              <p id="oc-copied" class="oc-hint" role="status" aria-live="polite" style="display:none">Copied. Send this to OpenClaw.</p>
              <div id="oc-preview" class="oc-preview" style="display:none">
                <p class="oc-preview-title">Send This To OpenClaw</p>
                <pre id="oc-preview-text" class="oc-preview-text"></pre>
                <ol class="oc-preview-steps">
                  <li>Paste this exact block into your OpenClaw chat or command window.</li>
                  <li>OpenClaw will read the memo share and follow the handoff instructions.</li>
                  <li>Come back here when it shows up as pending or connected.</li>
                </ol>
              </div>
              <div id="oc-reg-section" style="display:none">
                <p class="oc-reg-hint">If OpenClaw says it isn't registered yet, generate a one-time registration token.</p>
                <button id="oc-reg-btn" type="button">Generate registration token</button>
                <div id="oc-reg-result" style="display:none"></div>
              </div>
            </div>
            <div id="oc-pending" class="oc-widget" style="display:none">
              <p class="oc-label">OpenClaw is waiting to be connected</p>
              <button id="oc-claim-btn" type="button">Claim OpenClaw</button>
            </div>
            <div id="oc-claimed" class="oc-widget" style="display:none">
              <span class="oc-status">● OpenClaw connected</span>
              <button id="oc-ask-btn" type="button">Ask OpenClaw</button>
            </div>
            <div id="oc-ask-dialog">
              <textarea id="oc-ask-input" placeholder="What do you want to ask OpenClaw?" rows="3"></textarea>
              <button id="oc-ask-submit" type="button">Send</button>
            </div>
          </div>
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
      const shareThemes = new Map(${serializedThemes}.map((theme) => [theme.id, theme]));
      const defaultThemeId = ${JSON.stringify(DEFAULT_THEME.id)};
      const themeStorageKey = "sonic-theme";

      function applyShareTheme(themeId) {
        const theme = shareThemes.get(themeId) || shareThemes.get(defaultThemeId);
        if (!theme) return defaultThemeId;

        const root = document.documentElement;
        root.dataset.shareTheme = theme.id;
        root.style.setProperty("--background", theme.vars.background);
        root.style.setProperty("--foreground", theme.vars.foreground);
        root.style.setProperty("--accent", theme.vars.accent);
        root.style.setProperty("--accent-hover", theme.vars.accentHover);
        root.style.setProperty("--surface", theme.vars.surface);
        root.style.setProperty("--border", theme.vars.border);
        root.style.setProperty("--theme-glow", theme.vars.glow);
        root.style.setProperty("--theme-glass-bg", theme.vars.glassBg);
        root.style.setProperty("--theme-neo-blur", theme.vars.neoBlur);

        return theme.id;
      }

      function resolveInitialThemeId() {
        try {
          const urlTheme = new URL(window.location.href).searchParams.get("theme");
          if (urlTheme && shareThemes.has(urlTheme)) {
            return urlTheme;
          }
        } catch (_error) {
          // Ignore malformed URLs in non-browser contexts.
        }

        try {
          const savedTheme = window.localStorage.getItem(themeStorageKey);
          if (savedTheme && shareThemes.has(savedTheme)) {
            return savedTheme;
          }
        } catch (_error) {
          // Ignore storage access failures.
        }

        return defaultThemeId;
      }

      applyShareTheme(resolveInitialThemeId());
    })();

    (() => {
      if (!shareBoot) return;

      function escHtml(s) {
        return String(s)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#039;");
      }

      function fmtMs(ms) {
        const totalSec = Math.floor(ms / 1000);
        const minutes = Math.floor(totalSec / 60);
        const seconds = totalSec % 60;
        return minutes + ":" + String(seconds).padStart(2, "0");
      }

      function renderTranscriptMarkup(artifact) {
        const transcript = typeof artifact?.transcript === "string" && artifact.transcript
          ? artifact.transcript
          : "(no transcript)";
        const segments = Array.isArray(artifact?.transcriptSegments)
          ? artifact.transcriptSegments
          : [];

        if (segments.length > 0) {
          return '<div id="transcript-content" class="transcript">\\n' + segments.map(function(seg) {
            return '  <div class="transcript-segment" id="t-' + seg.startMs + '" data-start="' + seg.startMs + '" data-end="' + seg.endMs + '">' +
              '<button class="ts-btn" type="button" data-seek="' + seg.startMs + '">' + fmtMs(seg.startMs) + "</button>" +
              '<span class="seg-text">' + escHtml(seg.text || "") + "</span></div>";
          }).join("\\n") + "\\n</div>";
        }

        const escapedTranscript = escHtml(transcript)
          .split(/\\n\\s*\\n/)
          .map(function(paragraph) { return paragraph.trim(); })
          .filter(function(paragraph) { return paragraph.length > 0; })
          .map(function(paragraph) { return '<div class="transcript-block">' + paragraph + "</div>"; })
          .join("\\n");

        return '<div class="transcript" id="transcript-content">' + escapedTranscript + "</div>";
      }

      function replaceTranscript(artifact) {
        const current = document.getElementById("transcript-content");
        if (!current) return;
        const nextMarkup = renderTranscriptMarkup(artifact);
        if (current.outerHTML === nextMarkup) return;
        current.outerHTML = nextMarkup;
        document.dispatchEvent(new CustomEvent("share:transcript-updated"));
      }

      if (!shareBoot.isLiveRecording) return;

      const transcriptUrl = shareBoot.canonicalUrl + ".json";
      let pollingStopped = false;

      async function pollTranscript() {
        if (pollingStopped) return;

        try {
          const response = await fetch(transcriptUrl, { cache: "no-store" });
          if (!response.ok) {
            throw new Error("Failed to load live transcript");
          }

          const json = await response.json();
          const artifact = json && json.artifact ? json.artifact : null;
          if (!artifact) return;

          replaceTranscript(artifact);

          if (artifact.isLiveRecording === false || artifact.transcriptStatus === "complete" || artifact.transcriptStatus === "failed") {
            pollingStopped = true;
            clearInterval(intervalId);
          }
        } catch (_error) {
          // Leave the current transcript in place and retry on the next tick.
        }
      }

      const intervalId = setInterval(function() {
        void pollTranscript();
      }, 3000);
    })();

    (() => {
      const exportButton = document.getElementById("export-transcript-btn");
      const copyButton = document.getElementById("copy-transcript-btn");
      
      function getTranscriptContent() {
        return document.getElementById("transcript-content");
      }

      if (exportButton) {
        exportButton.addEventListener("click", () => {
          const transcriptContent = getTranscriptContent();
          if (!transcriptContent) return;
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
          const transcriptContent = getTranscriptContent();
          if (!transcriptContent) return;
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
      const openClawWidget = document.getElementById("openclaw-widget");
      const openClawInvite = document.getElementById("oc-invite");
      const openClawPending = document.getElementById("oc-pending");
      const openClawClaimed = document.getElementById("oc-claimed");
      const openClawInviteButton = document.getElementById("oc-invite-btn");
      const openClawClaimButton = document.getElementById("oc-claim-btn");
      const openClawAskButton = document.getElementById("oc-ask-btn");
      const openClawCopied = document.getElementById("oc-copied");
      const openClawPreview = document.getElementById("oc-preview");
      const openClawPreviewText = document.getElementById("oc-preview-text");
      const openClawRegSection = document.getElementById("oc-reg-section");
      const openClawRegButton = document.getElementById("oc-reg-btn");
      const openClawRegResult = document.getElementById("oc-reg-result");
      const openClawAskDialog = document.getElementById("oc-ask-dialog");
      const openClawAskInput = document.getElementById("oc-ask-input");
      const openClawAskSubmit = document.getElementById("oc-ask-submit");

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

      function initialForName(name) {
        const trimmed = (name || "").trim();
        return trimmed ? trimmed.charAt(0).toUpperCase() : "?";
      }

      function renderDiscussionAvatar(message) {
        if (message.authorAvatarUrl) {
          return '<img class="disc-avatar" src="' + escHtml(message.authorAvatarUrl) + '" alt="" loading="lazy" referrerpolicy="no-referrer" />';
        }

        return '<span class="disc-avatar disc-avatar-fallback" aria-hidden="true">' + escHtml(initialForName(message.authorName)) + '</span>';
      }

      function renderOwnerMark(message) {
        if (!message.authorIsOwner) {
          return "";
        }

        return '<span class="disc-owner-mark" aria-label="Memo owner" title="Memo owner">' +
          '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
            '<path d="M3 18h18l-2-9-5 4-2-6-2 6-5-4-2 9Z"></path>' +
          "</svg>" +
        "</span>";
      }

      function renderDiscussionMessage(message) {
        return '<div class="disc-msg">' +
          '<div class="disc-meta">' +
            '<span class="disc-author-row">' +
              renderDiscussionAvatar(message) +
              '<span class="disc-author">' + escHtml(message.authorName) + '</span>' +
              renderOwnerMark(message) +
            "</span>" +
            '<span class="disc-time">' + escHtml(fmtRelative(message.createdAt)) + '</span>' +
            (message.anchorStartMs != null
              ? '<button class="disc-anchor ts-link" data-t="' + message.anchorStartMs + '">▶ ' + fmtMs(message.anchorStartMs) + '</button>'
              : "") +
          "</div>" +
          '<p class="disc-content">' + escHtml(message.content) + "</p>" +
        "</div>";
      }

      function bindDiscussionAnchors(scope) {
        const audio = document.querySelector("audio.share-audio");
        scope.querySelectorAll(".disc-anchor").forEach((btn) =>
          btn.addEventListener("click", () => {
            if (!audio) return;
            audio.currentTime = +btn.dataset.t / 1000;
            audio.play().catch(function() {});
          })
        );
      }

      function renderDiscussion(messages) {
        discussionList.innerHTML = messages.length === 0
          ? '<p class="disc-empty">No notes yet.</p>'
          : messages.map((message) => renderDiscussionMessage(message)).join("");

        bindDiscussionAnchors(discussionList);
      }

      function appendDiscussionMessage(message) {
        const emptyState = discussionList.querySelector(".disc-empty");
        if (emptyState) {
          discussionList.innerHTML = "";
        }

        discussionList.insertAdjacentHTML("beforeend", renderDiscussionMessage(message));
        const appendedMessage = discussionList.lastElementChild;
        if (appendedMessage) {
          bindDiscussionAnchors(appendedMessage);
        }
      }

      const openClawState = {
        state: "none",
        agentId: null,
        roomId: null,
        pollId: null,
      };

      function stopOpenClawPolling() {
        if (openClawState.pollId != null) {
          clearInterval(openClawState.pollId);
          openClawState.pollId = null;
        }
      }

      function renderOpenClawState(isOwner) {
        if (
          !openClawWidget ||
          !openClawInvite ||
          !openClawPending ||
          !openClawClaimed ||
          !openClawAskDialog
        ) {
          return;
        }

        if (!isOwner) {
          openClawWidget.style.display = "none";
          openClawInvite.style.display = "none";
          openClawPending.style.display = "none";
          openClawClaimed.style.display = "none";
          openClawAskDialog.style.display = "none";
          return;
        }

        openClawWidget.style.display = "grid";
        openClawInvite.style.display = openClawState.state === "none" ? "" : "none";
        openClawPending.style.display = openClawState.state === "pending_claim" ? "" : "none";
        openClawClaimed.style.display = openClawState.state === "claimed" ? "" : "none";
        openClawAskDialog.style.display =
          openClawState.state === "claimed" &&
          openClawAskDialog.dataset.open === "true"
            ? "grid"
            : "none";
      }

      async function loadOpenClawStatus() {
        try {
          const res = await fetch("/api/s/" + shareRef + "/openclaw-status", {
            credentials: "include",
          });
          if (!res.ok) {
            throw new Error("Failed to load OpenClaw status");
          }

          const payload = await res.json();
          if (!payload || typeof payload.state !== "string") {
            return;
          }

          openClawState.state = payload.state;
          openClawState.agentId =
            typeof payload.agentId === "string" ? payload.agentId : null;
          openClawState.roomId =
            typeof payload.roomId === "string" ? payload.roomId : null;

          if (openClawState.state !== "pending_claim") {
            stopOpenClawPolling();
          }

          renderOpenClawState(true);
        } catch (_error) {
          // Leave the current owner widget state in place.
        }
      }

      function startOpenClawPolling() {
        stopOpenClawPolling();
        openClawState.pollId = setInterval(function() {
          void loadOpenClawStatus();
        }, 3000);
      }

      function renderOpenClawInvitePreview(inviteText) {
        if (openClawPreview && openClawPreviewText) {
          openClawPreviewText.textContent = inviteText || "";
          openClawPreview.style.display = inviteText ? "grid" : "none";
        }

        if (openClawRegSection) {
          openClawRegSection.style.display = inviteText ? "" : "none";
        }
      }

      async function readOpenClawError(response, fallbackMessage) {
        try {
          const payload = await response.json();
          if (payload && typeof payload.error === "string") {
            return payload.error;
          }
        } catch (_error) {
          // Fall back to the generic message when the response body is not JSON.
        }

        return fallbackMessage;
      }

      function renderDiscussionAccess(isOwner, isAuthenticated) {
        signInHint.style.display = "none";
        ownerOnlyHint.style.display = "none";
        form.style.display = isOwner ? "" : "none";
        renderOpenClawState(isOwner);

        if (isOwner) {
          void loadOpenClawStatus();
          return;
        }

        stopOpenClawPolling();
        if (isAuthenticated) {
          ownerOnlyHint.style.display = "";
        } else {
          signInHint.style.display = "";
        }
      }

      async function loadDiscussion() {
        try {
          const res = await fetch("/api/s/" + shareRef + "/discussion");
          if (!res.ok) {
            throw new Error("Failed to load discussion");
          }

          const { messages, isOwner, isAuthenticated } = await res.json();
          renderDiscussion(messages);
          renderDiscussionAccess(isOwner, isAuthenticated);

        } catch (_error) {
          discussionList.innerHTML = '<p class="disc-error">Could not load discussion.</p>';
        }
      }

      if (openClawInviteButton && openClawCopied) {
        openClawInviteButton.addEventListener("click", async () => {
          openClawCopied.style.display = "none";

          try {
            const response = await fetch("/api/s/" + shareRef + "/invite", {
              method: "POST",
              credentials: "include",
            });
            if (!response.ok) {
              throw new Error("Invite failed");
            }

            const payload = await response.json();
            const inviteText =
              payload && typeof payload.inviteText === "string"
                ? payload.inviteText
                : "";
            if (!inviteText) {
              throw new Error("Invite failed");
            }

            renderOpenClawInvitePreview(inviteText);
            startOpenClawPolling();

            try {
              await navigator.clipboard.writeText(inviteText);
              openClawCopied.textContent = "Copied. Send this to OpenClaw.";
            } catch (_clipboardError) {
              openClawCopied.textContent = "Copy failed here. Send the block below to OpenClaw.";
            }

            openClawCopied.style.display = "";
          } catch (_error) {
            openClawCopied.style.display = "none";
          }
        });
      }

      if (openClawClaimButton) {
        openClawClaimButton.addEventListener("click", async () => {
          try {
            const response = await fetch("/api/s/" + shareRef + "/claim", {
              method: "POST",
              credentials: "include",
            });
            if (!response.ok) {
              throw new Error("Claim failed");
            }

            const payload = await response.json();
            openClawState.state = "claimed";
            openClawState.agentId =
              payload && typeof payload.agentId === "string"
                ? payload.agentId
                : openClawState.agentId;
            stopOpenClawPolling();
            await loadOpenClawStatus();
          } catch (_error) {
            // Keep the pending state visible until the owner retries.
          }
        });
      }

      if (openClawRegButton && openClawRegResult) {
        openClawRegButton.addEventListener("click", async () => {
          openClawRegButton.disabled = true;
          openClawRegResult.style.display = "none";
          try {
            const res = await fetch("/api/openclaw/registration-token", {
              method: "POST",
              credentials: "include",
            });
            if (res.ok) {
              const { registration_token, expires_at } = await res.json();
              openClawRegResult.innerHTML =
                '<p class="oc-reg-warn">Shown once · Expires ' + escHtml(fmtRelative(expires_at)) + " · Send only to your OpenClaw runtime.</p>" +
                '<code class="oc-reg-token-block">' + escHtml(registration_token) + "</code>" +
                '<button id="oc-reg-copy" type="button">Copy token</button>';
              openClawRegResult.style.display = "";
              const copyBtn = document.getElementById("oc-reg-copy");
              if (copyBtn) {
                copyBtn.addEventListener("click", async () => {
                  try {
                    await navigator.clipboard.writeText(registration_token);
                    copyBtn.textContent = "Copied";
                  } catch (_error) {
                    copyBtn.textContent = "Copy failed";
                  }
                });
              }
            } else if (res.status === 409) {
              const { expires_at } = await res.json();
              openClawRegResult.innerHTML =
                '<p class="oc-reg-warn">You already have an active registration token' +
                (expires_at ? " expiring " + escHtml(fmtRelative(expires_at)) : "") + '.</p>' +
                '<button id="oc-reg-replace" type="button">Replace token</button>';
              openClawRegResult.style.display = "";
              const replaceBtn = document.getElementById("oc-reg-replace");
              if (replaceBtn) {
                replaceBtn.addEventListener("click", async () => {
                  replaceBtn.disabled = true;
                  try {
                    const r2 = await fetch("/api/openclaw/registration-token", {
                      method: "POST",
                      credentials: "include",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ force: true }),
                    });
                    if (r2.ok) {
                      const { registration_token: tok2, expires_at: expiresAt2 } = await r2.json();
                      openClawRegResult.innerHTML =
                        '<p class="oc-reg-warn">Shown once · Expires ' + escHtml(fmtRelative(expiresAt2)) + " · Send only to your OpenClaw runtime.</p>" +
                        '<code class="oc-reg-token-block">' + escHtml(tok2) + "</code>" +
                        '<button id="oc-reg-copy2" type="button">Copy token</button>';
                      openClawRegResult.style.display = "";
                      const copyBtn2 = document.getElementById("oc-reg-copy2");
                      if (copyBtn2) {
                        copyBtn2.addEventListener("click", async () => {
                          try {
                            await navigator.clipboard.writeText(tok2);
                            copyBtn2.textContent = "Copied";
                          } catch (_error) {
                            copyBtn2.textContent = "Copy failed";
                          }
                        });
                      }
                    } else {
                      const errorMessage = await readOpenClawError(
                        r2,
                        "Failed to replace token. Try again."
                      );
                      openClawRegResult.innerHTML =
                        '<p class="oc-reg-warn">' + escHtml(errorMessage) + "</p>";
                      openClawRegResult.style.display = "";
                    }
                  } catch (_error) {
                    openClawRegResult.innerHTML = '<p class="oc-reg-warn">Failed to replace token. Try again.</p>';
                    openClawRegResult.style.display = "";
                  } finally {
                    replaceBtn.disabled = false;
                  }
                });
              }
            } else {
              const errorMessage = await readOpenClawError(
                res,
                "Failed to generate token. Try again."
              );
              openClawRegResult.innerHTML =
                '<p class="oc-reg-warn">' + escHtml(errorMessage) + "</p>";
              openClawRegResult.style.display = "";
            }
          } catch (_error) {
            openClawRegResult.innerHTML = '<p class="oc-reg-warn">Failed to generate token. Try again.</p>';
            openClawRegResult.style.display = "";
          } finally {
            openClawRegButton.disabled = false;
          }
        });
      }

      if (openClawAskButton && openClawAskDialog) {
        openClawAskButton.addEventListener("click", () => {
          openClawAskDialog.dataset.open =
            openClawAskDialog.dataset.open === "true" ? "false" : "true";
          renderOpenClawState(true);
        });
      }

      if (openClawAskSubmit && openClawAskInput && openClawAskDialog) {
        openClawAskSubmit.addEventListener("click", async () => {
          const content = openClawAskInput.value.trim();
          if (!content || !openClawState.roomId || !openClawState.agentId) {
            return;
          }

          openClawAskSubmit.disabled = true;
          try {
            const response = await fetch("/api/memo-rooms/" + openClawState.roomId + "/invocations", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                agentId: openClawState.agentId,
                content,
              }),
              credentials: "include",
            });
            if (!response.ok) {
              throw new Error("Invocation failed");
            }

            openClawAskInput.value = "";
            openClawAskDialog.dataset.open = "false";
            renderOpenClawState(true);
          } catch (_error) {
            // Leave the dialog open so the owner can retry.
          } finally {
            openClawAskSubmit.disabled = false;
          }
        });
      }

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

            const payload = await response.json();
            if (payload && payload.message) {
              appendDiscussionMessage(payload.message);
            }

            discussionInput.value = "";
          } catch (error) {
            discussionError.textContent = error instanceof Error ? error.message : "Post failed";
            discussionError.style.display = "";
          } finally {
            discussionSubmit.disabled = false;
          }
        });
      }

      loadDiscussion();
    })();

    (() => {
      const searchInput = document.getElementById("transcript-search");
      const matchCountEl = document.getElementById("search-match-count");
      const prevBtn = document.getElementById("search-prev");
      const nextBtn = document.getElementById("search-next");
      if (!searchInput || !matchCountEl || !prevBtn || !nextBtn) return;
      const SEARCH_KEY = "transcript-search-query";
      let currentIndex = -1;

      function getTranscriptEl() {
        return document.getElementById("transcript-content");
      }

      function getBlocks() {
        const transcriptEl = getTranscriptEl();
        return transcriptEl
          ? Array.from(transcriptEl.querySelectorAll(".transcript-block, .seg-text"))
          : [];
      }

      function escHtml(s) {
        return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      }

      function escRegExp(s) {
        return s.replace(/[-\\/\\\\^$*+?.()|[\\]{}]/g, "\\\\$&");
      }

      function applySearch(query) {
        const blocks = getBlocks();
        const blockTexts = blocks.map(function(b) { return b.textContent || ""; });

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
        const transcriptEl = getTranscriptEl();
        if (!transcriptEl) {
          matchCountEl.textContent = "";
          return;
        }
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
        const transcriptEl = getTranscriptEl();
        if (!transcriptEl) return;
        const marks = transcriptEl.querySelectorAll("mark.search-hit");
        if (!marks.length) return;
        currentIndex = (currentIndex + 1) % marks.length;
        updateActive();
      });

      prevBtn.addEventListener("click", function() {
        const transcriptEl = getTranscriptEl();
        if (!transcriptEl) return;
        const marks = transcriptEl.querySelectorAll("mark.search-hit");
        if (!marks.length) return;
        currentIndex = (currentIndex - 1 + marks.length) % marks.length;
        updateActive();
      });

      searchInput.addEventListener("keydown", function(e) {
        const transcriptEl = getTranscriptEl();
        if (!transcriptEl) return;
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

      document.addEventListener("share:transcript-updated", function() {
        applySearch(searchInput.value.trim());
      });
    })();

    (() => {
      // Timestamp anchor: seek audio and highlight the active segment.
      const audio = document.querySelector("audio.share-audio");
      document.addEventListener("click", function(e) {
        const target = e.target;
        if (!(target instanceof Element)) return;
        const btn = target.closest("#transcript-content .ts-btn[data-seek]");
        if (!btn || !audio) return;
        const ms = Number(btn.getAttribute("data-seek"));
        audio.currentTime = ms / 1000;
        audio.play().catch(function() {});
      });

      // Highlight active segment during playback
      if (audio) {
        audio.addEventListener("timeupdate", function() {
          const transcriptEl = document.getElementById("transcript-content");
          if (!transcriptEl) return;
          const segments = Array.from(transcriptEl.querySelectorAll(".transcript-segment[data-start]"));
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
