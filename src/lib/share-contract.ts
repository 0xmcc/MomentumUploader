import {
  createEmptyArtifactMap,
  type ArtifactMap,
} from "@/lib/artifact-types";
import { SHOW_ARTIFACTS_IN_UI } from "@/lib/feature-flags";
import type { ResolvedMemoShare } from "@/lib/share-domain";
import { DEFAULT_THEME, THEMES } from "@/lib/themes";
import type { TranscriptSegment } from "@/lib/transcript";

export type ShareFormat = "html" | "md" | "json";

const OPENCLAW_SKILL_VERSION = "0.1.3" as const;

type AiDestination = {
  id: "chatgpt" | "claude" | "gemini" | "grok";
  name: string;
  url: string;
  accent: string;
};

const AI_DESTINATIONS: AiDestination[] = [
  {
    id: "chatgpt",
    name: "ChatGPT",
    url: "https://chatgpt.com/",
    accent: "#10a37f",
  },
  {
    id: "claude",
    name: "Claude",
    url: "https://claude.ai/",
    accent: "#d97757",
  },
  {
    id: "gemini",
    name: "Gemini",
    url: "https://gemini.google.com/app",
    accent: "#6d7cff",
  },
  {
    id: "grok",
    name: "Grok",
    url: "https://grok.com/",
    accent: "#0f172a",
  },
];

export type ParsedShareRef = {
  shareToken: string;
  pathFormat: ShareFormat;
};

export type SharedArtifactPayload = {
  artifactType: string;
  artifactId: string;
  shareToken: string;
  authorName: string;
  authorAvatarUrl: string | null;
  canonicalUrl: string;
  title: string;
  transcript: string;
  mediaUrl: string | null;
  createdAt: string;
  sharedAt: string | null;
  expiresAt: string | null;
  bookmarkCount?: number;
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

export type ShareViewerState = {
  isAuthenticated: boolean;
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

function renderAiDestinationIcon(id: AiDestination["id"]): string {
  switch (id) {
    case "chatgpt":
      return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M11.95 2.6c1.85 0 3.42.9 4.32 2.46a4.76 4.76 0 0 1 4.11 6.7 4.77 4.77 0 0 1-1.86 6.4 4.76 4.76 0 0 1-6.67 2.3 4.76 4.76 0 0 1-6.63-2.4A4.76 4.76 0 0 1 3.6 11.7a4.77 4.77 0 0 1 2.03-6.53A4.76 4.76 0 0 1 11.95 2.6Z" fill="none" stroke="currentColor" stroke-width="1.6"/>
        <path d="M9.45 6.35 14.8 9.4v5.2l-5.35 3.05-3.1-5.45 3.1-5.85Zm5.1.25 3.1 5.4-3.1 5.4h-6.2l-3.1-5.4 3.1-5.4h6.2Z" fill="none" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"/>
      </svg>`;
    case "claude":
      return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="m12 2 1.75 4.7L18.5 4.5l-2.2 4.75L21 11l-4.7 1.75L18.5 17.5l-4.75-2.2L12 20l-1.75-4.7L5.5 17.5l2.2-4.75L3 11l4.7-1.75L5.5 4.5l4.75 2.2L12 2Z" fill="currentColor"/>
      </svg>`;
    case "gemini":
      return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <defs>
          <linearGradient id="gemini-icon-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#4f8cff"></stop>
            <stop offset="100%" stop-color="#8b5cf6"></stop>
          </linearGradient>
        </defs>
        <path d="M12 2.5 14.65 9.35 21.5 12l-6.85 2.65L12 21.5l-2.65-6.85L2.5 12l6.85-2.65L12 2.5Z" fill="url(#gemini-icon-gradient)"/>
      </svg>`;
    case "grok":
      return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="10" fill="currentColor"/>
        <path d="M8 7h8l-3.4 4.25L16.75 17h-2.9L10.45 12.7 8 15.8V7Z" fill="#ffffff"/>
      </svg>`;
  }
}

function renderAiDestinationLink(destination: AiDestination): string {
  const appName = escapeHtml(destination.name);
  const appUrl = escapeHtml(destination.url);

  return `<a
      id="send-to-${destination.id}-link"
      class="ai-app-link ai-app-link-${destination.id}"
      href="${appUrl}"
      target="_blank"
      rel="noreferrer noopener"
      style="--ai-accent:${destination.accent}"
      aria-label="Open ${appName}"
    >
      <span class="ai-app-icon">${renderAiDestinationIcon(destination.id)}</span>
      <span class="ai-app-name">${appName}</span>
    </a>`;
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
    .replace(/\s+/g, "-")
    .replace(/[^A-Za-z0-9_-]+/g, "")
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
  artifacts: ArtifactMap,
  options?: { bookmarkCount?: number }
): SharedArtifactPayload {
  return {
    artifactType: "memo",
    artifactId: memo.memoId,
    shareToken: memo.shareToken,
    authorName: memo.authorName,
    authorAvatarUrl: memo.authorAvatarUrl,
    canonicalUrl,
    title: memo.title,
    transcript: memo.transcript,
    mediaUrl: memo.mediaUrl,
    createdAt: memo.createdAt,
    sharedAt: memo.sharedAt,
    expiresAt: memo.expiresAt,
    ...(typeof options?.bookmarkCount === "number"
      ? { bookmarkCount: options.bookmarkCount }
      : {}),
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
  viewer?: ShareViewerState;
};

export function buildSharedArtifactHtml(
  payload: SharedArtifactPayload,
  options?: BuildSharedArtifactHtmlOptions
): string {
  const showArtifacts = options?.showArtifactsInUi ?? SHOW_ARTIFACTS_IN_UI;
  const viewerIsAuthenticated = options?.viewer?.isAuthenticated === true;
  const escapedTitle = escapeHtml(payload.title);
  const escapedCanonicalUrl = escapeHtml(payload.canonicalUrl);
  const escapedArtifactType = escapeHtml(payload.artifactType);
  const artifacts = resolveArtifacts(payload);
  const hasAudio = typeof payload.mediaUrl === "string" && payload.mediaUrl.trim().length > 0;
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
  const transcriptFileName = `${toSafeFileName(payload.title)}.md`;
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
  
  const dateObj = new Date(payload.createdAt);
  const formattedDate = !Number.isNaN(dateObj.getTime())
    ? dateObj.toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" })
    : "";

  const liveStatusNotice = isLiveRecording
    ? "<p class=\"live-status\">Live recording in progress. Transcript updates automatically every 3 seconds.</p>"
    : "";
  const bookmarkCount = Math.max(0, payload.bookmarkCount ?? 0);
  const navbarRightHtml = viewerIsAuthenticated
    ? `<a href="/" class="share-navbar-signup">Record</a>`
    : `<a href="/sign-in" class="share-navbar-signin">Sign in</a>
      <a href="/sign-up" class="share-navbar-signup">Subscribe</a>`;
  const footerPrimaryHref = viewerIsAuthenticated ? "/" : "/sign-up";
  const footerPrimaryLabel = viewerIsAuthenticated ? "Record" : "Create your free account";
  const bookmarkSignInHtml = viewerIsAuthenticated
    ? ""
    : `<a href="/sign-in" id="bookmark-share-signin" class="engagement-btn bookmark-auth-cta">
        <span class="engagement-main">
          <svg class="bookmark-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"></path></svg>
          <span class="engagement-label">Sign in to save</span>
        </span>
        <span class="engagement-count-badge">${bookmarkCount}</span>
      </a>`;
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
  const sendToAiAppsHtml = AI_DESTINATIONS.map(renderAiDestinationLink).join("");

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
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--background);
      color: var(--foreground);
      line-height: 1.6;
      min-height: 100vh;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }
    main {
      max-width: 640px;
      margin: 0 auto;
      padding: 4rem 1.5rem 6rem;
    }
    article {
      padding: 0;
      min-height: 80vh;
    }
    h1 {
      margin: 0 0 1.5rem;
      font-size: clamp(2rem, 6vw, 2.75rem);
      font-weight: 800;
      letter-spacing: -0.03em;
      line-height: 1.15;
    }
    .hero-header {
      margin-bottom: 2rem;
    }
    .byline-row {
      display: flex;
      align-items: center;
      gap: 1rem;
    }
    .byline-avatar {
      width: 2.75rem;
      height: 2.75rem;
      border-radius: 999px;
      background: color-mix(in srgb, var(--surface) 85%, var(--accent) 15%);
      border: 1px solid color-mix(in srgb, var(--border) 60%, var(--accent) 40%);
      display: flex;
      align-items: center;
      justify-content: center;
      color: var(--foreground);
      font-weight: 700;
      font-size: 1.1rem;
      flex-shrink: 0;
    }
    .byline-info {
      display: flex;
      flex-direction: column;
      justify-content: center;
      flex-grow: 1;
    }
    .byline-author {
      font-weight: 600;
      font-size: 0.95rem;
      color: var(--foreground);
      line-height: 1.4;
      text-transform: uppercase;
      letter-spacing: 0.02em;
    }
    .byline-date {
      font-size: 0.85rem;
      color: color-mix(in srgb, var(--foreground) 60%, transparent);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-top: 0.15rem;
    }
    .byline-actions {
      display: flex;
      align-items: center;
      flex-shrink: 0;
    }
    .copy-link-btn {
      display: flex;
      align-items: center;
      gap: 0.4rem;
      background: transparent;
      border: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
      color: var(--foreground);
      border-radius: 999px;
      padding: 0.4rem 0.8rem;
      font-size: 0.8rem;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.2s;
    }
    .copy-link-btn:hover {
      background: color-mix(in srgb, var(--foreground) 8%, transparent);
    }
    .copy-link-btn svg {
      color: color-mix(in srgb, var(--foreground) 70%, transparent);
    }
    .hero-divider {
      border: 0;
      height: 1px;
      background: color-mix(in srgb, var(--border) 60%, transparent);
      margin: 1.5rem 0 2rem;
      width: 100%;
    }
    .share-navbar {
      position: sticky;
      top: 0;
      z-index: 100;
      background: color-mix(in srgb, var(--background) 95%, transparent);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border-bottom: 1px solid color-mix(in srgb, var(--border) 40%, transparent);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0.75rem 1rem;
      height: 60px;
      box-sizing: border-box;
      gap: 0.5rem;
    }
    @media (min-width: 600px) {
      .share-navbar {
        padding: 0.75rem 1.5rem;
        gap: 1rem;
      }
    }
    .share-navbar-logo {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      color: var(--foreground);
      text-decoration: none;
      font-weight: 700;
      font-size: 1.1rem;
      letter-spacing: -0.02em;
      white-space: nowrap;
      overflow: hidden;
    }
    .share-navbar-logo span {
      display: none;
    }
    @media (min-width: 400px) {
      .share-navbar-logo span {
        display: inline;
        overflow: hidden;
        text-overflow: ellipsis;
      }
    }
    .share-navbar-logo svg {
      color: var(--accent);
      flex-shrink: 0;
    }
    .share-navbar-right {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      flex-shrink: 0;
    }
    @media (min-width: 600px) {
      .share-navbar-right {
        gap: 1.25rem;
      }
    }
    .share-navbar-signin {
      color: color-mix(in srgb, var(--foreground) 80%, transparent);
      text-decoration: none;
      font-size: 0.95rem;
      font-weight: 500;
      transition: color 0.2s;
      white-space: nowrap;
    }
    .share-navbar-signin:hover {
      color: var(--foreground);
    }
    .share-navbar-signup {
      background: var(--accent);
      color: var(--background);
      text-decoration: none;
      padding: 0.4rem 0.85rem;
      border-radius: 999px;
      font-size: 0.9rem;
      font-weight: 600;
      transition: background 0.2s, transform 0.1s;
      white-space: nowrap;
    }
    @media (min-width: 600px) {
      .share-navbar-signup {
        padding: 0.45rem 1rem;
        font-size: 0.95rem;
      }
    }
    .share-navbar-signup:hover {
      background: var(--accent-hover);
      transform: translateY(-1px);
    }
    .engagement-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
      flex-wrap: wrap;
      margin-top: 1.5rem;
      padding: 1rem 0;
      border-top: 1px solid color-mix(in srgb, var(--border) 30%, transparent);
      border-bottom: 1px solid color-mix(in srgb, var(--border) 30%, transparent);
    }
    .engagement-actions {
      display: inline-flex;
      align-items: center;
      gap: 1rem;
      min-width: 0;
    }
    .engagement-actions-left {
      justify-content: flex-start;
      flex-wrap: wrap;
    }
    .engagement-actions-right {
      margin-left: auto;
      justify-content: flex-end;
    }
    .engagement-btn {
      display: inline-flex;
      align-items: center;
      justify-content: space-between;
      gap: 0.75rem;
      flex: 0 0 auto;
      min-height: 2.75rem;
      box-sizing: border-box;
      background: color-mix(in srgb, var(--surface) 72%, transparent);
      border: 1px solid color-mix(in srgb, var(--border) 72%, transparent);
      color: color-mix(in srgb, var(--foreground) 82%, transparent);
      font-size: 0.9rem;
      font-weight: 500;
      font-family: inherit;
      cursor: pointer;
      padding: 0.6rem 0.9rem;
      border-radius: 999px;
      transition: transform 0.2s, background 0.2s, border-color 0.2s, color 0.2s, box-shadow 0.2s;
      text-decoration: none;
    }
    .engagement-btn:hover {
      background: color-mix(in srgb, var(--surface) 55%, var(--foreground) 10%);
      border-color: color-mix(in srgb, var(--accent) 35%, var(--border) 65%);
      color: var(--foreground);
      transform: translateY(-1px);
      box-shadow: 0 16px 28px color-mix(in srgb, black 14%, transparent);
    }
    .engagement-btn svg {
      width: 18px;
      height: 18px;
      flex-shrink: 0;
    }
    .engagement-btn:disabled {
      cursor: default;
      transform: none;
      opacity: 0.72;
      box-shadow: none;
    }
    .engagement-main {
      display: inline-flex;
      align-items: center;
      gap: 0.65rem;
      min-width: 0;
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }
    .engagement-label {
      white-space: nowrap;
    }
    .engagement-count-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 1.75rem;
      height: 1.75rem;
      padding: 0 0.5rem;
      border-radius: 999px;
      background: color-mix(in srgb, var(--foreground) 8%, transparent);
      color: color-mix(in srgb, var(--foreground) 92%, transparent);
      font-size: 0.82rem;
      font-weight: 700;
      letter-spacing: 0.01em;
    }
    .compact-metric-btn {
      min-height: 2.5rem;
      padding: 0.2rem 0;
      border: 0;
      border-radius: 0;
      background: transparent;
      box-shadow: none;
      color: color-mix(in srgb, var(--foreground) 74%, transparent);
      position: relative;
    }
    .compact-metric-btn .engagement-main {
      gap: 0.45rem;
    }
    .compact-metric-btn .engagement-count-badge {
      min-width: 0;
      height: auto;
      padding: 0;
      border-radius: 0;
      background: transparent;
      font-size: 1.05rem;
      font-weight: 500;
      color: inherit;
    }
    .compact-metric-btn:hover {
      background: transparent;
      border-color: transparent;
      box-shadow: none;
      color: var(--foreground);
      transform: none;
    }
    .engagement-btn.bookmark-btn[data-bookmarked="true"] {
      color: var(--foreground);
    }
    .engagement-btn.bookmark-btn[data-bookmarked="true"] .bookmark-icon {
      fill: currentColor;
    }
    .engagement-btn.bookmark-auth-cta {
      color: color-mix(in srgb, var(--foreground) 78%, transparent);
    }
    .engagement-btn.share-btn {
      flex: 0 0 auto;
      min-height: 2.5rem;
      padding: 0.5rem 0.95rem;
      font-size: 0.88rem;
    }
    @media (max-width: 560px) {
      .engagement-row {
        gap: 0.75rem;
      }
      .engagement-actions {
        gap: 0.85rem;
      }
      .engagement-actions-right {
        margin-left: 0;
        width: 100%;
        justify-content: flex-start;
      }
    }
    h2 { 
      margin-top: 2.5rem; 
      margin-bottom: 1.25rem; 
      font-size: 1.35rem; 
      font-weight: 700;
      letter-spacing: -0.01em;
    }
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
      margin-top: 2.5rem;
      margin-bottom: 1rem;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 1rem;
    }
    .transcript-header-actions {
      display: flex;
      align-items: center;
      gap: 0.6rem;
    }
    .transcript-header h2 { margin: 0; }
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
      background: color-mix(in srgb, var(--background) 90%, transparent);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      padding: 1rem 0 1.5rem;
      border-bottom: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
      margin-bottom: 2rem;
    }
    .transcript {
      max-width: 100%;
      margin: 0;
      padding: 0;
      height: auto;
      max-height: 65vh;
      overflow-y: auto;
      overflow-wrap: anywhere;
      word-break: break-word;
      line-height: 1.75;
      font-size: 1.05rem;
      color: color-mix(in srgb, var(--foreground) 95%, transparent);
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
    .export-transcript-btn,
    .copy-transcript-btn {
      border: 1px solid color-mix(in srgb, var(--border) 55%, transparent);
      background: color-mix(in srgb, var(--surface) 50%, transparent);
      color: var(--foreground);
      border-radius: 999px;
      padding: .4rem .85rem;
      font-size: .8rem;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s ease;
    }
    .export-transcript-btn:hover,
    .copy-transcript-btn:hover {
      background: color-mix(in srgb, var(--foreground) 8%, transparent);
      border-color: color-mix(in srgb, var(--border) 80%, transparent);
    }
    .export-transcript-btn:focus-visible,
    .copy-transcript-btn:focus-visible {
      outline: 2px solid color-mix(in srgb, var(--accent) 70%, white 30%);
      outline-offset: 2px;
    }
    .send-to-ai-btn {
      border-color: color-mix(in srgb, var(--accent) 45%, var(--border) 55%);
      background:
        linear-gradient(135deg, color-mix(in srgb, var(--accent) 18%, transparent), transparent 55%),
        color-mix(in srgb, var(--surface) 78%, transparent);
    }
    .send-to-ai-btn:hover {
      border-color: color-mix(in srgb, var(--accent) 62%, var(--border) 38%);
    }
    section[aria-labelledby="transcript-heading"] { margin-top: .15rem; }
    section[aria-labelledby="transcript-heading"] h2 { margin-top: 0; }
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
    .app-cta-footer {
      margin: 3rem 1rem 2rem;
      padding: 1.5rem;
      max-width: 640px;
      border-radius: 16px;
      background: var(--surface);
      border: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
      display: flex;
      flex-direction: column;
      align-items: center;
      text-align: center;
      gap: 1.25rem;
      box-shadow: 0 8px 24px color-mix(in srgb, black 10%, transparent);
    }
    @media (min-width: 600px) {
      .app-cta-footer {
        margin: 4rem auto 2rem;
        flex-direction: row;
        text-align: left;
        justify-content: space-between;
        padding: 2.5rem 3rem;
        border-radius: 20px;
      }
    }
    .cta-content h3 {
      margin: 0 0 0.25rem;
      font-size: 1.35rem;
      font-weight: 700;
      color: var(--foreground);
    }
    .cta-content p {
      margin: 0;
      font-size: 1rem;
      line-height: 1.5;
      color: color-mix(in srgb, var(--foreground) 70%, transparent);
    }
    .primary-cta-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 1rem 2rem;
      border-radius: 12px;
      background: var(--foreground);
      color: var(--background);
      font-weight: 600;
      font-size: 1.05rem;
      text-decoration: none;
      transition: transform 0.2s, box-shadow 0.2s, opacity 0.2s;
      white-space: nowrap;
    }
    .primary-cta-btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 20px color-mix(in srgb, var(--foreground) 25%, transparent);
      opacity: 0.95;
    }
    .primary-cta-btn:active {
      transform: translateY(0);
    }
    .waveform-player {
      position: relative;
      width: 100%;
      height: 70px;
      margin-bottom: 2rem;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      user-select: none;
    }
    .waveform-player.is-unavailable {
      opacity: 0.78;
    }
    .waveform-bars {
      display: flex;
      align-items: center;
      gap: 2px;
      width: 100%;
      height: 100%;
      position: absolute;
      inset: 0;
    }
    .waveform-bar {
      flex: 1;
      background: color-mix(in srgb, var(--foreground) 30%, transparent);
      border-radius: 2px;
      transition: background 0.1s;
    }
    .waveform-bar.played {
      background: color-mix(in srgb, var(--foreground) 70%, transparent);
    }
    .waveform-center-line {
      position: absolute;
      left: 0;
      right: 0;
      top: 50%;
      height: 1px;
      background: color-mix(in srgb, var(--foreground) 10%, transparent);
      z-index: 1;
      pointer-events: none;
    }
    .waveform-play-btn {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 3.5rem;
      height: 3.5rem;
      border-radius: 50%;
      background: color-mix(in srgb, var(--foreground) 90%, transparent);
      color: var(--background);
      border: none;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      z-index: 10;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
      transition: transform 0.2s;
    }
    .waveform-play-btn:hover {
      transform: translate(-50%, -50%) scale(1.05);
    }
    .waveform-time {
      position: absolute;
      bottom: -1.25rem;
      right: 0;
      font-size: 0.7rem;
      color: color-mix(in srgb, var(--foreground) 50%, transparent);
      font-family: var(--font-mono);
      pointer-events: none;
    }
    #native-audio { display: none; }
    .audio-dialog-backdrop {
      position: fixed;
      inset: 0;
      display: none;
      place-items: center;
      padding: 1.5rem;
      box-sizing: border-box;
      background: rgba(15, 23, 42, 0.35);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      z-index: 250;
    }
    .audio-dialog {
      width: min(100%, 24rem);
      border-radius: 20px;
      border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
      background: color-mix(in srgb, var(--background) 92%, white 8%);
      box-shadow: 0 24px 70px rgba(15, 23, 42, 0.18);
      padding: 1.15rem 1.15rem 1rem;
    }
    .audio-dialog h3 {
      margin: 0 0 0.35rem;
      font-size: 1rem;
      font-weight: 700;
      letter-spacing: -0.01em;
    }
    .audio-dialog p {
      margin: 0;
      color: color-mix(in srgb, var(--foreground) 72%, transparent);
      font-size: 0.95rem;
      line-height: 1.5;
    }
    .audio-dialog-actions {
      display: flex;
      justify-content: flex-end;
      margin-top: 1rem;
    }
    .audio-dialog-actions button {
      border: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
      background: color-mix(in srgb, var(--surface) 55%, transparent);
      color: var(--foreground);
      border-radius: 999px;
      padding: 0.45rem 0.9rem;
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
    }
    .audio-dialog-actions button:hover {
      background: color-mix(in srgb, var(--foreground) 8%, transparent);
    }
    .send-to-ai-dialog {
      width: min(100%, 32rem);
      padding: 1.2rem;
      background:
        radial-gradient(circle at top right, color-mix(in srgb, var(--accent) 18%, transparent), transparent 34%),
        color-mix(in srgb, var(--background) 94%, white 6%);
    }
    .send-to-ai-dialog-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 1rem;
      margin-bottom: 1rem;
    }
    .send-to-ai-dialog-header p {
      margin-top: 0.35rem;
    }
    .send-to-ai-close {
      border: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
      background: color-mix(in srgb, var(--surface) 58%, transparent);
      color: var(--foreground);
      border-radius: 999px;
      padding: 0.45rem 0.8rem;
      font-size: 0.8rem;
      font-weight: 600;
      cursor: pointer;
      flex-shrink: 0;
    }
    .send-to-ai-steps {
      display: grid;
      gap: 0.85rem;
    }
    .send-to-ai-step {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 0.85rem;
      align-items: start;
      padding: 0.95rem 1rem;
      border-radius: 18px;
      border: 1px solid color-mix(in srgb, var(--border) 60%, transparent);
      background: color-mix(in srgb, var(--surface) 70%, transparent);
    }
    .send-to-ai-step-number {
      width: 1.85rem;
      height: 1.85rem;
      border-radius: 999px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: color-mix(in srgb, var(--accent) 16%, transparent);
      color: var(--foreground);
      font-size: 0.82rem;
      font-weight: 700;
    }
    .send-to-ai-step h4 {
      margin: 0;
      font-size: 0.98rem;
      letter-spacing: -0.01em;
    }
    .send-to-ai-step p {
      margin: 0.3rem 0 0;
      color: color-mix(in srgb, var(--foreground) 72%, transparent);
      font-size: 0.92rem;
    }
    .send-to-ai-copy-btn {
      margin-top: 0.7rem;
      min-height: 2.75rem;
      width: 100%;
      justify-content: center;
      border-color: color-mix(in srgb, var(--accent) 48%, var(--border) 52%);
      background: color-mix(in srgb, var(--accent) 14%, var(--surface) 86%);
    }
    .send-to-ai-app-grid {
      margin-top: 0.8rem;
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 0.75rem;
    }
    .ai-app-link {
      display: inline-flex;
      align-items: center;
      gap: 0.75rem;
      min-height: 3.35rem;
      padding: 0.85rem 0.95rem;
      border-radius: 16px;
      border: 1px solid color-mix(in srgb, var(--border) 64%, transparent);
      background:
        linear-gradient(135deg, color-mix(in srgb, var(--ai-accent) 16%, transparent), transparent 60%),
        color-mix(in srgb, var(--surface) 75%, transparent);
      color: var(--foreground);
      text-decoration: none;
      transition: transform 0.18s ease, border-color 0.18s ease, background 0.18s ease;
    }
    .ai-app-link:hover {
      transform: translateY(-1px);
      border-color: color-mix(in srgb, var(--ai-accent) 55%, var(--border) 45%);
      background:
        linear-gradient(135deg, color-mix(in srgb, var(--ai-accent) 22%, transparent), transparent 55%),
        color-mix(in srgb, var(--surface) 70%, transparent);
    }
    .ai-app-icon {
      width: 2.35rem;
      height: 2.35rem;
      border-radius: 14px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: color-mix(in srgb, var(--foreground) 9%, transparent);
      color: var(--ai-accent);
      box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--foreground) 10%, transparent);
      flex-shrink: 0;
    }
    .ai-app-icon svg {
      width: 1.3rem;
      height: 1.3rem;
    }
    .ai-app-name {
      font-size: 0.96rem;
      font-weight: 600;
      letter-spacing: -0.01em;
    }
    @media (max-width: 560px) {
      .send-to-ai-app-grid {
        grid-template-columns: 1fr;
      }
    }

    
    .transcript-segment {
      display: flex;
      gap: 1rem;
      align-items: flex-start;
      padding: .75rem 0.5rem;
      border-radius: 8px;
      transition: background .15s;
    }
    .transcript-segment.active {
      background: color-mix(in srgb, var(--accent) 10%, transparent);
    }
    .ts-btn {
      flex-shrink: 0;
      font-family: ui-monospace, monospace;
      font-size: .75rem;
      color: var(--accent);
      background: color-mix(in srgb, var(--accent) 10%, transparent);
      border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
      border-radius: 6px;
      padding: 4px 8px;
      cursor: pointer;
      white-space: nowrap;
      line-height: 1.5;
      transition: all 0.2s ease;
    }
    .ts-btn:hover {
      background: color-mix(in srgb, var(--accent) 15%, transparent);
      border-color: color-mix(in srgb, var(--accent) 45%, transparent);
    }
    .seg-text { flex: 1; line-height: 1.6; font-size: 1.05rem; }
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
    .disc-section {
      scroll-margin-top: clamp(8rem, 22vh, 14rem);
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
      display: none !important;
    }
    .oc-widget {
      display: flex;
      flex-direction: column;
      gap: 0.55rem;
    }
    .oc-claimed-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 0.6rem;
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
  <nav class="share-navbar">
    <a href="/" class="share-navbar-logo" aria-label="MomentumUploader home">
      <svg viewBox="0 0 24 24" width="22" height="22" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>
      <span>MomentumUploader</span>
    </a>
    <div class="share-navbar-right">
      <button type="button" id="theme-toggle-btn" class="engagement-btn" aria-label="Toggle light/dark mode" style="padding: 0.45rem; border-radius: 999px;">
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="theme-icon-light"><circle cx="12" cy="12" r="5"></circle><line x1="12" y1="1" x2="12" y2="3"></line><line x1="12" y1="21" x2="12" y2="23"></line><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line><line x1="1" y1="12" x2="3" y2="12"></line><line x1="21" y1="12" x2="23" y2="12"></line><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line></svg>
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="theme-icon-dark" style="display:none;"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path></svg>
      </button>
      ${navbarRightHtml}
    </div>
  </nav>
  <main>
    <article>
      <header class="hero-header">
        <h1>${escapedTitle}</h1>
        <div class="byline-row">
          <div class="byline-avatar">
            ${payload.authorAvatarUrl
              ? `<img src="${escapeHtml(payload.authorAvatarUrl)}" alt="" style="width:100%;height:100%;border-radius:999px;object-fit:cover;" />`
              : `<span class="disc-avatar-fallback" aria-hidden="true">${escapeHtml(payload.authorName.charAt(0).toUpperCase())}</span>`
            }
          </div>
          <div class="byline-info">
            <div class="byline-author">${escapeHtml(payload.authorName)}</div>
            <div class="byline-date">${formattedDate}</div>
          </div>
        </div>
        <div class="engagement-row">
          <div class="engagement-actions engagement-actions-left">
            <a href="#discussion" class="engagement-btn compact-metric-btn comment-btn" aria-label="Go to discussion">
              <span class="engagement-main">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
                <span id="engagement-comment-count" class="engagement-count-badge">0</span>
              </span>
            </a>
            <button type="button" id="bookmark-share-btn" class="engagement-btn compact-metric-btn bookmark-btn" aria-label="Save memo" data-viewer-authenticated="${viewerIsAuthenticated ? "true" : "false"}" data-bookmark-count="${bookmarkCount}" data-bookmarked="false" style="${viewerIsAuthenticated ? "" : "display:none"}">
              <span class="engagement-main">
                <svg class="bookmark-icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"></path></svg>
                <span id="bookmark-share-count" class="engagement-count-badge">${bookmarkCount}</span>
              </span>
              <span id="bookmark-share-label" class="sr-only">Save</span>
            </button>
            ${bookmarkSignInHtml}
          </div>
          <div class="engagement-actions engagement-actions-right">
            <button type="button" class="engagement-btn share-btn copy-link-btn" aria-label="Copy canonical URL" data-url="${escapedCanonicalUrl}">
              <span class="engagement-main">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"></circle><circle cx="6" cy="12" r="3"></circle><circle cx="18" cy="19" r="3"></circle><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line></svg>
                <span class="engagement-label">Share</span>
              </span>
            </button>
          </div>
        </div>
      </header>
      ${liveStatusNotice}
      ${summaryHtml}
      ${outlineHtml}
      
      <div class="transcript-sticky-container">
        <div class="waveform-player${hasAudio ? "" : " is-unavailable"}" id="waveform-player" data-audio-available="${hasAudio ? "true" : "false"}">
          <audio id="native-audio" data-audio-available="${hasAudio ? "true" : "false"}"${hasAudio ? ` src="${escapedAudioUrl}" preload="metadata"` : ""}></audio>
          <div class="waveform-bars" id="waveform-bars"></div>
          <div class="waveform-center-line"></div>
          <button id="play-btn" class="waveform-play-btn" aria-label="Play">
            <svg id="play-icon-svg" xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="transform: translateX(2px);"><polygon points="6 3 20 12 6 21 6 3"/></svg>
          </button>
          <div class="waveform-time">
            <span id="time-current">0:00</span> / <span id="time-duration">${hasAudio ? "--:--" : " "}</span>
          </div>
        </div>
        <hr class="hero-divider" />
        <section aria-labelledby="transcript-heading">
          <div class="transcript-header">
            <h2 id="transcript-heading">Transcript</h2>
            <div class="transcript-header-actions">
              <button type="button" id="export-transcript-btn" class="export-transcript-btn" data-filename="${escapeHtml(transcriptFileName)}">Export</button>
              <button type="button" id="copy-transcript-btn" class="copy-transcript-btn">Copy</button>
              <button type="button" id="send-to-ai-btn" class="copy-transcript-btn send-to-ai-btn">Send to AI</button>
            </div>
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
              <div class="oc-claimed-actions">
                <button id="oc-ask-btn" type="button">Ask OpenClaw</button>
                <button id="oc-disconnect-btn" type="button">Disconnect OpenClaw</button>
              </div>
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
  <footer class="app-cta-footer" aria-label="MomentumUploader app call to action">
    <div class="cta-content">
      <h3>MomentumUploader</h3>
      <p>Record, transcribe, and remember everything.</p>
    </div>
    <a href="${footerPrimaryHref}" class="primary-cta-btn">${footerPrimaryLabel}</a>
  </footer>
  <div id="audio-unavailable-dialog" class="audio-dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="audio-unavailable-title" style="display:none">
    <div class="audio-dialog">
      <h3 id="audio-unavailable-title">Audio unavailable</h3>
      <p>This audio is not available.</p>
      <div class="audio-dialog-actions">
        <button type="button" id="audio-unavailable-close">OK</button>
      </div>
    </div>
  </div>
  <div id="send-to-ai-dialog" class="audio-dialog-backdrop" role="dialog" aria-modal="true" aria-labelledby="send-to-ai-title" style="display:none">
    <div class="audio-dialog send-to-ai-dialog">
      <div class="send-to-ai-dialog-header">
        <div>
          <h3 id="send-to-ai-title">Send to AI</h3>
          <p>Three steps. Copy the transcript, paste it, and jump straight into your favorite AI app.</p>
        </div>
        <button type="button" id="send-to-ai-close" class="send-to-ai-close">Close</button>
      </div>
      <div class="send-to-ai-steps">
        <section class="send-to-ai-step" aria-labelledby="send-to-ai-step-copy">
          <span class="send-to-ai-step-number" aria-hidden="true">1</span>
          <div>
            <h4 id="send-to-ai-step-copy">Copy transcript</h4>
            <p>Grab the full transcript so you can drop it into any AI chat.</p>
            <button type="button" id="send-to-ai-copy-btn" class="engagement-btn send-to-ai-copy-btn">Copy transcript</button>
          </div>
        </section>
        <section class="send-to-ai-step" aria-labelledby="send-to-ai-step-paste">
          <span class="send-to-ai-step-number" aria-hidden="true">2</span>
          <div>
            <h4 id="send-to-ai-step-paste">Paste it</h4>
            <p>Paste the transcript into a fresh chat and add the prompt you want.</p>
          </div>
        </section>
        <section class="send-to-ai-step" aria-labelledby="send-to-ai-step-open">
          <span class="send-to-ai-step-number" aria-hidden="true">3</span>
          <div>
            <h4 id="send-to-ai-step-open">Now open your AI app</h4>
            <p>Pick the assistant you want to use next.</p>
            <div class="send-to-ai-app-grid">
              ${sendToAiAppsHtml}
            </div>
          </div>
        </section>
      </div>
    </div>
  </div>
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
      const audioUnavailableDialog = document.getElementById("audio-unavailable-dialog");
      const audioUnavailableClose = document.getElementById("audio-unavailable-close");

      window.__momentumShowAudioUnavailableDialog = function() {
        if (audioUnavailableDialog) {
          audioUnavailableDialog.style.display = "grid";
        }
      };

      window.__momentumHideAudioUnavailableDialog = function() {
        if (audioUnavailableDialog) {
          audioUnavailableDialog.style.display = "none";
        }
      };

      if (audioUnavailableClose) {
        audioUnavailableClose.addEventListener("click", function() {
          window.__momentumHideAudioUnavailableDialog();
        });
      }

      if (audioUnavailableDialog) {
        audioUnavailableDialog.addEventListener("click", function(event) {
          if (event.target === audioUnavailableDialog) {
            window.__momentumHideAudioUnavailableDialog();
          }
        });
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

        const isLight = theme.id === "light";
        const iconLight = document.querySelector(".theme-icon-light");
        const iconDark = document.querySelector(".theme-icon-dark");
        if (iconLight && iconDark) {
          iconLight.style.display = isLight ? "none" : "block";
          iconDark.style.display = isLight ? "block" : "none";
        }

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

      const themeToggleBtn = document.getElementById("theme-toggle-btn");
      if (themeToggleBtn) {
        themeToggleBtn.addEventListener("click", () => {
          const root = document.documentElement;
          const currentTheme = root.dataset.shareTheme;
          const nextTheme = currentTheme === "light" ? defaultThemeId : "light";
          applyShareTheme(nextTheme);
          try {
            window.localStorage.setItem(themeStorageKey, nextTheme);
          } catch (_error) {
            // Ignore storage errors
          }
        });
      }
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

      function hasActiveTranscriptSelection(transcriptEl) {
        const selection = typeof window.getSelection === "function" ? window.getSelection() : null;
        if (!selection || selection.rangeCount === 0 || selection.isCollapsed) {
          return false;
        }

        const anchorNode = selection.anchorNode;
        const focusNode = selection.focusNode;
        return !!(
          (anchorNode && transcriptEl.contains(anchorNode)) ||
          (focusNode && transcriptEl.contains(focusNode))
        );
      }

      function replaceTranscript(artifact) {
        const current = document.getElementById("transcript-content");
        if (!current) return;
        if (hasActiveTranscriptSelection(current)) return;
        const nextMarkup = renderTranscriptMarkup(artifact);
        if (current.outerHTML === nextMarkup) return;
        const previousScrollTop = current.scrollTop;
        const wasNearBottom =
          current.scrollHeight - current.clientHeight - current.scrollTop <= 24;
        current.outerHTML = nextMarkup;
        const next = document.getElementById("transcript-content");
        if (next) {
          next.scrollTop = wasNearBottom
            ? Math.max(0, next.scrollHeight - next.clientHeight)
            : previousScrollTop;
        }
        document.dispatchEvent(new CustomEvent("share:transcript-updated"));
      }

      if (!shareBoot.isLiveRecording) return;

      const transcriptUrl = shareBoot.canonicalUrl + ".json";
      let pollingStopped = false;
      let pendingArtifact = null;

      function isTerminalTranscriptState(artifact) {
        return artifact &&
          (artifact.isLiveRecording === false ||
            artifact.transcriptStatus === "complete" ||
            artifact.transcriptStatus === "failed");
      }

      function flushPendingTranscript() {
        if (!pendingArtifact) return;
        const current = document.getElementById("transcript-content");
        if (!current || hasActiveTranscriptSelection(current)) return;

        const artifact = pendingArtifact;
        pendingArtifact = null;
        replaceTranscript(artifact);
        if (isTerminalTranscriptState(artifact)) {
          pollingStopped = true;
          clearInterval(intervalId);
        }
      }

      document.addEventListener("selectionchange", flushPendingTranscript);

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

          const current = document.getElementById("transcript-content");
          if (current && hasActiveTranscriptSelection(current)) {
            pendingArtifact = artifact;
            return;
          }

          pendingArtifact = null;
          replaceTranscript(artifact);

          if (isTerminalTranscriptState(artifact)) {
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
      const copyLinkBtn = document.querySelector(".copy-link-btn");
      if (copyLinkBtn) {
        copyLinkBtn.addEventListener("click", () => {
          const url = copyLinkBtn.getAttribute("data-url");
          if (!url) return;
          const textSpan = copyLinkBtn.querySelector("span");

          navigator.clipboard.writeText(url).then(() => {
            if (textSpan) {
              const originalText = textSpan.textContent;
              textSpan.textContent = "Copied!";
              setTimeout(() => {
                textSpan.textContent = originalText;
              }, 2000);
            }
          }).catch((err) => {
            console.error("Failed to copy link: ", err);
          });
        });
      }

      const exportButton = document.getElementById("export-transcript-btn");
      const copyButton = document.getElementById("copy-transcript-btn");
      const sendToAiButton = document.getElementById("send-to-ai-btn");
      const sendToAiDialog = document.getElementById("send-to-ai-dialog");
      const sendToAiClose = document.getElementById("send-to-ai-close");
      const sendToAiCopyButton = document.getElementById("send-to-ai-copy-btn");

      function getTranscriptContent() {
        return document.getElementById("transcript-content");
      }

      function getTranscriptText() {
        const transcriptContent = getTranscriptContent();
        if (!transcriptContent) return "";

        // Extract text cleanly for both paragraph blocks and timestamped segments.
        const paragraphs = transcriptContent.querySelectorAll(".transcript-block, .seg-text");
        if (paragraphs.length > 0) {
          return Array.from(paragraphs).map((p) => p.textContent || "").join("\\n\\n");
        }

        return transcriptContent.textContent || "";
      }

      function copyTranscript(button) {
        const textToCopy = getTranscriptText();
        if (!textToCopy) return;

        navigator.clipboard.writeText(textToCopy).then(() => {
          if (!button) return;
          const originalText = button.textContent;
          button.textContent = "Copied!";
          setTimeout(() => {
            button.textContent = originalText;
          }, 2000);
        }).catch((err) => {
          console.error("Failed to copy text: ", err);
          if (!button) return;
          const originalText = button.textContent;
          button.textContent = "Copy failed";
          setTimeout(() => {
            button.textContent = originalText;
          }, 2000);
        });
      }

      if (exportButton) {
        exportButton.addEventListener("click", () => {
          const transcript = getTranscriptText();
          const title = document.querySelector("h1")?.textContent?.trim() || "Shared Memo";
          const fileName =
            exportButton.getAttribute("data-filename") ||
            (shareBoot && typeof shareBoot.transcriptFileName === "string"
              ? shareBoot.transcriptFileName
              : "shared-memo.md");
          const markdown = [
            "# " + title,
            "",
            "## Transcript",
            "",
            transcript || "*(no transcript)*",
            "",
          ].join("\\n");
          const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
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

      function openSendToAiDialog() {
        if (!sendToAiDialog) return;
        sendToAiDialog.style.display = "grid";
      }

      function closeSendToAiDialog() {
        if (!sendToAiDialog) return;
        sendToAiDialog.style.display = "none";
      }

      if (copyButton) {
        copyButton.addEventListener("click", () => {
          copyTranscript(copyButton);
        });
      }

      if (sendToAiButton) {
        sendToAiButton.addEventListener("click", openSendToAiDialog);
      }

      if (sendToAiClose) {
        sendToAiClose.addEventListener("click", closeSendToAiDialog);
      }

      if (sendToAiDialog) {
        sendToAiDialog.addEventListener("click", (event) => {
          if (event.target === sendToAiDialog) {
            closeSendToAiDialog();
          }
        });
      }

      if (sendToAiCopyButton) {
        sendToAiCopyButton.addEventListener("click", () => {
          copyTranscript(sendToAiCopyButton);
        });
      }

      document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && sendToAiDialog?.style.display === "grid") {
          closeSendToAiDialog();
        }
      });
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
      const bookmarkButton = document.getElementById("bookmark-share-btn");
      const bookmarkLabel = document.getElementById("bookmark-share-label");
      const bookmarkCountLabel = document.getElementById("bookmark-share-count");
      const bookmarkSignIn = document.getElementById("bookmark-share-signin");
      const openClawWidget = document.getElementById("openclaw-widget");
      const openClawInvite = document.getElementById("oc-invite");
      const openClawPending = document.getElementById("oc-pending");
      const openClawClaimed = document.getElementById("oc-claimed");
      const openClawInviteButton = document.getElementById("oc-invite-btn");
      const openClawClaimButton = document.getElementById("oc-claim-btn");
      const openClawAskButton = document.getElementById("oc-ask-btn");
      const openClawDisconnectButton = document.getElementById("oc-disconnect-btn");
      const openClawCopied = document.getElementById("oc-copied");
      const openClawPreview = document.getElementById("oc-preview");
      const openClawPreviewText = document.getElementById("oc-preview-text");
      const openClawRegSection = document.getElementById("oc-reg-section");
      const openClawRegButton = document.getElementById("oc-reg-btn");
      const openClawRegResult = document.getElementById("oc-reg-result");
      const openClawAskDialog = document.getElementById("oc-ask-dialog");
      const openClawAskInput = document.getElementById("oc-ask-input");
      const openClawAskSubmit = document.getElementById("oc-ask-submit");
      const shareRef = shareBoot.shareToken;
      const bookmarkState = {
        isAuthenticated:
          bookmarkButton?.dataset.viewerAuthenticated === "true",
        isBookmarked: false,
        count: Math.max(
          0,
          Number(
            bookmarkButton?.dataset.bookmarkCount ??
            bookmarkCountLabel?.textContent ??
            "0"
          ) || 0
        ),
        inFlight: false,
      };

      function renderBookmarkState() {
        if (!bookmarkButton || !bookmarkLabel || !bookmarkCountLabel) {
          return;
        }

        if (!bookmarkState.isAuthenticated) {
          bookmarkButton.style.display = "none";
          if (bookmarkSignIn) {
            bookmarkSignIn.style.display = "";
          }
          return;
        }

        if (bookmarkSignIn) {
          bookmarkSignIn.style.display = "none";
        }
        bookmarkButton.style.display = "";
        bookmarkButton.disabled = bookmarkState.inFlight;
        bookmarkButton.dataset.bookmarked = bookmarkState.isBookmarked ? "true" : "false";
        bookmarkButton.dataset.bookmarkCount = String(bookmarkState.count);
        bookmarkLabel.textContent = bookmarkState.isBookmarked ? "Saved" : "Save";
        bookmarkButton.setAttribute(
          "aria-label",
          bookmarkState.isBookmarked ? "Saved memo" : "Save memo"
        );
        bookmarkCountLabel.textContent = String(bookmarkState.count);
      }

      async function loadBookmarkState() {
        if (!bookmarkButton || !bookmarkLabel || !bookmarkCountLabel) {
          return;
        }

        try {
          const response = await fetch("/api/s/" + shareRef + "/bookmark", {
            credentials: "include",
          });
          if (!response.ok) {
            throw new Error("Failed to load bookmark state");
          }

          const payload = await response.json();
          bookmarkState.isAuthenticated = Boolean(payload.isAuthenticated);
          bookmarkState.isBookmarked = Boolean(payload.isBookmarked);
          if (typeof payload.bookmarkCount === "number" && Number.isFinite(payload.bookmarkCount)) {
            bookmarkState.count = Math.max(0, Math.round(payload.bookmarkCount));
          }
          renderBookmarkState();
        } catch (_error) {
          bookmarkState.isBookmarked = false;
          renderBookmarkState();
        }
      }

      if (bookmarkButton) {
        bookmarkButton.addEventListener("click", async () => {
          if (bookmarkState.inFlight || !bookmarkState.isAuthenticated) {
            return;
          }

          bookmarkState.inFlight = true;
          renderBookmarkState();

          try {
            const response = await fetch("/api/s/" + shareRef + "/bookmark", {
              method: bookmarkState.isBookmarked ? "DELETE" : "POST",
              credentials: "include",
            });
            if (!response.ok) {
              throw new Error("Bookmark request failed");
            }

            const nextIsBookmarked = !bookmarkState.isBookmarked;
            bookmarkState.isBookmarked = nextIsBookmarked;
            bookmarkState.count = Math.max(
              0,
              bookmarkState.count + (nextIsBookmarked ? 1 : -1)
            );
          } catch (_error) {
            // Preserve the previous state and let the user retry.
          } finally {
            bookmarkState.inFlight = false;
            renderBookmarkState();
          }
        });
      }

      void loadBookmarkState();

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
        const audio = document.querySelector("#native-audio");
        const hasAudio = audio?.dataset.audioAvailable === "true";
        scope.querySelectorAll(".disc-anchor").forEach((btn) =>
          btn.addEventListener("click", () => {
            if (!audio || !hasAudio) {
              if (typeof window.__momentumShowAudioUnavailableDialog === "function") {
                window.__momentumShowAudioUnavailableDialog();
              }
              return;
            }
            audio.currentTime = +btn.dataset.t / 1000;
            audio.play().catch(function() {});
          })
        );
      }

      function updateCommentCount(count) {
        const countSpan = document.getElementById("engagement-comment-count");
        if (countSpan) {
          countSpan.textContent = String(count);
        }
      }

      function renderDiscussion(messages) {
        discussionList.innerHTML = messages.length === 0
          ? '<p class="disc-empty">No notes yet.</p>'
          : messages.map((message) => renderDiscussionMessage(message)).join("");

        bindDiscussionAnchors(discussionList);
        updateCommentCount(messages.length);
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
        
        const countSpan = document.getElementById("engagement-comment-count");
        if (countSpan) {
          const currentCount = parseInt(countSpan.textContent || "0", 10);
          countSpan.textContent = String(currentCount + 1);
        }
      }

      const openClawState = {
        state: "none",
        agentId: null,
        roomId: null,
        pollId: null,
      };
      const discussionState = {
        pollId: null,
        loadInFlight: null,
      };
      const sharePagePollingState =
        window.__momentumSharePagePolling ||
        (window.__momentumSharePagePolling = {
          instanceId: 0,
          discussionPollId: null,
          openClawPollId: null,
        });
      sharePagePollingState.instanceId += 1;
      const sharePageInstanceId = sharePagePollingState.instanceId;

      function stopOpenClawPolling() {
        if (openClawState.pollId != null) {
          clearInterval(openClawState.pollId);
          openClawState.pollId = null;
          sharePagePollingState.openClawPollId = null;
        }
      }

      function stopDiscussionPolling() {
        if (discussionState.pollId != null) {
          clearInterval(discussionState.pollId);
          discussionState.pollId = null;
          sharePagePollingState.discussionPollId = null;
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

          if (
            openClawState.state === "pending_claim" ||
            openClawState.state === "claimed"
          ) {
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
          if (sharePagePollingState.instanceId !== sharePageInstanceId) {
            return;
          }
          void loadOpenClawStatus();
        }, 3000);
        sharePagePollingState.openClawPollId = openClawState.pollId;
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

      function resetOpenClawWidgetToInviteState() {
        openClawState.state = "none";
        openClawState.agentId = null;
        openClawState.roomId = null;

        if (openClawCopied) {
          openClawCopied.style.display = "none";
        }

        renderOpenClawInvitePreview("");

        if (openClawRegResult) {
          openClawRegResult.style.display = "none";
          openClawRegResult.innerHTML = "";
        }

        if (openClawAskInput) {
          openClawAskInput.value = "";
        }

        if (openClawAskDialog) {
          openClawAskDialog.dataset.open = "false";
        }

        renderOpenClawState(true);
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

      async function loadDiscussion(showError = true) {
        if (discussionState.loadInFlight) {
          return discussionState.loadInFlight;
        }

        const loadPromise = (async () => {
          try {
            const res = await fetch("/api/s/" + shareRef + "/discussion");
            if (!res.ok) {
              throw new Error("Failed to load discussion");
            }

            const { messages, isOwner, isAuthenticated } = await res.json();
            renderDiscussion(messages);
            renderDiscussionAccess(isOwner, isAuthenticated);
          } catch (_error) {
            if (showError) {
              discussionList.innerHTML = '<p class="disc-error">Could not load discussion.</p>';
            }
          }
        })();

        discussionState.loadInFlight = loadPromise;

        try {
          await loadPromise;
        } finally {
          if (discussionState.loadInFlight === loadPromise) {
            discussionState.loadInFlight = null;
          }
        }
      }

      function startDiscussionPolling() {
        if (discussionState.pollId != null) {
          return;
        }

        discussionState.pollId = setInterval(function() {
          if (sharePagePollingState.instanceId !== sharePageInstanceId) {
            return;
          }
          void loadDiscussion(false);
        }, 3000);
        sharePagePollingState.discussionPollId = discussionState.pollId;
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

      if (openClawDisconnectButton) {
        openClawDisconnectButton.addEventListener("click", async () => {
          openClawDisconnectButton.disabled = true;
          try {
            const response = await fetch("/api/s/" + shareRef + "/claim", {
              method: "DELETE",
              credentials: "include",
            });
            if (!response.ok) {
              throw new Error("Disconnect failed");
            }

            stopOpenClawPolling();
            resetOpenClawWidgetToInviteState();
          } catch (_error) {
            // Keep the claimed state visible until the owner retries.
          } finally {
            openClawDisconnectButton.disabled = false;
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

      void loadDiscussion();
      startDiscussionPolling();
    })();

    
    (() => {
      // Timestamp anchor: seek audio and highlight the active segment.
      const audio = document.querySelector("#native-audio");
      const hasAudio = audio?.dataset.audioAvailable === "true";
      document.addEventListener("click", function(e) {
        const target = e.target;
        if (!(target instanceof Element)) return;
        const btn = target.closest("#transcript-content .ts-btn[data-seek]");
        if (!btn) return;
        if (!audio || !hasAudio) {
          if (typeof window.__momentumShowAudioUnavailableDialog === "function") {
            window.__momentumShowAudioUnavailableDialog();
          }
          return;
        }
        const ms = Number(btn.getAttribute("data-seek"));
        audio.currentTime = ms / 1000;
        audio.play().catch(function() {});
      });

      // Highlight active segment during playback
      if (audio && hasAudio) {
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
        if (audio && hasAudio) {
          audio.currentTime = targetMs / 1000;
        }
        const target = document.getElementById("t-" + targetMs);
        if (target) {
          target.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }

      // Custom Audio Player Logic
      const playBtn = document.getElementById('play-btn');
      const playIconSvg = document.getElementById('play-icon-svg');
      const timeCurrent = document.getElementById('time-current');
      const timeDuration = document.getElementById('time-duration');
      const waveformBarsContainer = document.getElementById('waveform-bars');
      const waveformPlayer = document.getElementById('waveform-player');
      
      const playIcon = '<polygon points="6 3 20 12 6 21 6 3"/>';
      const pauseIcon = '<rect x="14" y="4" width="4" height="16"/><rect x="6" y="4" width="4" height="16"/>';

      const numBars = 120;
      const bars = [];
      if (waveformBarsContainer) {
        for (let i = 0; i < numBars; i++) {
          const bar = document.createElement('div');
          bar.className = 'waveform-bar';
          let h = Math.abs(Math.sin(i * 0.1) * Math.cos(i * 0.03) * 80) + 20;
          h += Math.random() * 15 - 7.5;
          if (h > 100) h = 100;
          if (h < 5) h = 5;
          bar.style.height = h + '%';
          waveformBarsContainer.appendChild(bar);
          bars.push(bar);
        }
      }

      function showAudioUnavailable() {
        if (typeof window.__momentumShowAudioUnavailableDialog === "function") {
          window.__momentumShowAudioUnavailableDialog();
        }
      }

      if (audio && hasAudio) {

        function formatTime(sec) {
          if (Number.isNaN(sec) || !isFinite(sec)) return '--:--';
          const m = Math.floor(sec / 60);
          const s = Math.floor(sec % 60);
          return m + ':' + (s < 10 ? '0' : '') + s;
        }

        audio.addEventListener('loadedmetadata', function() {
          if (timeDuration) timeDuration.textContent = formatTime(audio.duration);
        });

        audio.addEventListener('timeupdate', function() {
          if (timeCurrent) timeCurrent.textContent = formatTime(audio.currentTime);
          if (isFinite(audio.duration) && audio.duration > 0) {
            const percent = (audio.currentTime / audio.duration);
            const activeBars = Math.floor(percent * numBars);
            bars.forEach(function(bar, idx) {
              if (idx <= activeBars) {
                bar.classList.add('played');
              } else {
                bar.classList.remove('played');
              }
            });
          }
        });

        if (playBtn) {
          playBtn.addEventListener('click', function(e) {
            e.stopPropagation();
            if (audio.paused) {
              audio.play().catch(function() {});
            } else {
              audio.pause();
            }
          });
        }

        audio.addEventListener('play', function() {
          if (playIconSvg) {
            playIconSvg.innerHTML = pauseIcon;
            playIconSvg.style.transform = 'translateX(0)';
          }
        });

        audio.addEventListener('pause', function() {
          if (playIconSvg) {
            playIconSvg.innerHTML = playIcon;
            playIconSvg.style.transform = 'translateX(2px)';
          }
        });

        if (waveformPlayer) {
          let isDragging = false;

          function updateAudioPosition(e) {
            const rect = waveformPlayer.getBoundingClientRect();
            let pos = (e.clientX - rect.left) / rect.width;
            pos = Math.max(0, Math.min(1, pos));
            if (isFinite(audio.duration) && audio.duration > 0) {
              audio.currentTime = pos * audio.duration;
            }
          }

          waveformPlayer.addEventListener('pointerdown', function(e) {
            isDragging = true;
            if (waveformPlayer.setPointerCapture && e.pointerId !== undefined) {
              try { waveformPlayer.setPointerCapture(e.pointerId); } catch(err) {}
            }
            updateAudioPosition(e);
          });

          window.addEventListener('pointermove', function(e) {
            if (isDragging) {
              updateAudioPosition(e);
            }
          });

          window.addEventListener('pointerup', function(e) {
            if (isDragging) {
              isDragging = false;
              if (waveformPlayer.releasePointerCapture && e.pointerId !== undefined) {
                try { waveformPlayer.releasePointerCapture(e.pointerId); } catch(err) {}
              }
            }
          });
        }
      } else {
        if (playBtn) {
          playBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            showAudioUnavailable();
          });
        }

        if (waveformPlayer) {
          waveformPlayer.addEventListener('pointerdown', function(e) {
            e.preventDefault();
            showAudioUnavailable();
          });
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
