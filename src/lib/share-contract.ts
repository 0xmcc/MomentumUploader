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
};

export type SharedArtifactJson = {
    artifact: {
        type: string;
        id: string;
        shareToken: string;
        canonicalUrl: string;
        title: string;
        transcript: string;
        media: {
            audioUrl: string | null;
        };
        timestamps: {
            createdAt: string;
            sharedAt: string | null;
            expiresAt: string | null;
        };
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

export function isValidShareToken(token: string): boolean {
    return /^[A-Za-z0-9_-]{8,128}$/.test(token);
}

export function buildSharedArtifactJson(payload: SharedArtifactPayload): SharedArtifactJson {
    return {
        artifact: {
            type: payload.artifactType,
            id: payload.artifactId,
            shareToken: payload.shareToken,
            canonicalUrl: payload.canonicalUrl,
            title: payload.title,
            transcript: payload.transcript,
            media: {
                audioUrl: payload.mediaUrl,
            },
            timestamps: {
                createdAt: payload.createdAt,
                sharedAt: payload.sharedAt,
                expiresAt: payload.expiresAt,
            },
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

export function buildSharedArtifactHtml(payload: SharedArtifactPayload): string {
    const escapedTitle = escapeHtml(payload.title);
    const escapedTranscript = escapeHtml(payload.transcript || "(no transcript)");
    const escapedCanonicalUrl = escapeHtml(payload.canonicalUrl);
    const escapedArtifactType = escapeHtml(payload.artifactType);
    const escapedArtifactId = escapeHtml(payload.artifactId);
    const escapedCreatedAt = escapeHtml(payload.createdAt);
    const escapedSharedAt = escapeHtml(payload.sharedAt ?? "n/a");
    const escapedExpiresAt = escapeHtml(payload.expiresAt ?? "n/a");
    const escapedAudioUrl = escapeHtml(payload.mediaUrl ?? "");
    const encodedCanonical = encodeURI(payload.canonicalUrl);
    const encodedMarkdown = `${encodedCanonical}.md`;
    const encodedJson = `${encodedCanonical}.json`;
    const isLiveRecording = payload.isLiveRecording === true;
    const liveRefreshMeta = isLiveRecording
        ? "<meta http-equiv=\"refresh\" content=\"3\" />"
        : "";
    const liveStatusNotice = isLiveRecording
        ? "<p class=\"live-status\">Live recording in progress. This page refreshes every 3 seconds.</p>"
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
    .transcript {
      white-space: pre-wrap;
      background: rgba(0, 0, 0, 0.2);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      padding: 1rem;
      min-height: 40vh;
      overflow-y: auto;
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
  </style>
</head>
<body>
  <main>
    <article>
      <h1>${escapedTitle}</h1>
      <p class="meta">Shared ${escapedArtifactType} • canonical URL: <a href="${escapedCanonicalUrl}" style="color:#fdba74">${escapedCanonicalUrl}</a></p>
      ${liveStatusNotice}
      ${payload.mediaUrl ? `<audio class="share-audio" controls preload="metadata" src="${escapedAudioUrl}"></audio>` : ""}
      <section aria-labelledby="transcript-heading">
        <h2 id="transcript-heading">Transcript</h2>
        <div class="transcript">${escapedTranscript}</div>
      </section>
      
    </article>
  </main>
  <header class="promo" aria-label="MomentumUploader app call to action">
    <small>MomentumUploader</small>
    <a href="/" rel="noopener">Use App</a>
  </header>
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
