import { createEmptyArtifactMap } from "@/lib/artifact-types";
import { DEFAULT_THEME, THEMES } from "@/lib/themes";
import { act } from "@testing-library/react";
import type { ResolvedMemoShare } from "@/lib/share-domain";
import {
    buildSharePageViewModel,
    buildSharedArtifactHtml,
    buildSharedArtifactJson,
    buildSharedArtifactMarkdown,
    parseShareRef,
    resolveShareFormat,
    serializeShareBootPayload,
    type SharedArtifactPayload,
} from "@/lib/share-contract";

const basePayload: SharedArtifactPayload = {
    artifactType: "memo",
    artifactId: "memo-123",
    shareToken: "abc123token",
    canonicalUrl: "https://example.com/s/abc123token",
    authorName: "Marko Ivanovic",
    authorAvatarUrl: "https://example.com/avatar.png",
    title: "Standup Notes",
    transcript: "Today we finished the uploader and fixed retries.",
    mediaUrl: "https://cdn.example.com/audio.webm",
    createdAt: "2026-02-21T14:30:00.000Z",
    sharedAt: "2026-02-21T14:32:00.000Z",
    expiresAt: null,
};

const baseResolvedMemo: ResolvedMemoShare = {
    memoId: "memo-123",
    ownerUserId: "user-owner-id",
    authorName: "Marko Ivanovic",
    authorAvatarUrl: "https://example.com/avatar.png",
    shareToken: "abc123token",
    title: "Standup Notes",
    transcript: "Today we finished the uploader and fixed retries.",
    transcriptStatus: "complete",
    transcriptSegments: null,
    mediaUrl: "https://cdn.example.com/audio.webm",
    createdAt: "2026-02-21T14:30:00.000Z",
    sharedAt: "2026-02-21T14:32:00.000Z",
    expiresAt: null,
    isLiveRecording: false,
};

function extractBootPayload(html: string): { raw: string; parsed: Record<string, unknown> } {
    const match = html.match(
        /<script id="share-boot" type="application\/json">([\s\S]*?)<\/script>/
    );

    if (!match) {
        throw new Error("Missing share boot payload");
    }

    return {
        raw: match[1],
        parsed: JSON.parse(match[1]) as Record<string, unknown>,
    };
}

function extractJsonScriptPayload(
    html: string,
    scriptId: string
): { raw: string; parsed: Record<string, unknown> } {
    const pattern = new RegExp(
        `<script id="${scriptId}" type="application/json">([\\s\\S]*?)<\\/script>`
    );
    const match = html.match(pattern);

    if (!match) {
        throw new Error(`Missing ${scriptId} payload`);
    }

    return {
        raw: match[1],
        parsed: JSON.parse(match[1]) as Record<string, unknown>,
    };
}

async function loadSharePageScript(
    html: string,
    fetchMock: jest.Mock
): Promise<void> {
    const parsed = new DOMParser().parseFromString(html, "text/html");
    const inlineScripts = Array.from(parsed.querySelectorAll("script"))
        .filter((script) => script.getAttribute("type") !== "application/json")
        .map((script) => script.textContent ?? "");

    document.head.innerHTML = parsed.head.innerHTML;
    document.body.innerHTML = parsed.body.innerHTML;

    Object.defineProperty(global, "fetch", {
        configurable: true,
        writable: true,
        value: fetchMock,
    });
    Object.defineProperty(global.navigator, "clipboard", {
        configurable: true,
        value: { writeText: jest.fn().mockResolvedValue(undefined) },
    });

    await act(async () => {
        inlineScripts.forEach((script) => {
            window.eval(script);
        });
        await Promise.resolve();
        await Promise.resolve();
    });
}

const emptyDiscussionResponse = {
    ok: true,
    json: async () => ({
        messages: [],
        isOwner: false,
        isAuthenticated: false,
    }),
};

describe("share-contract", () => {
    afterEach(() => {
        window.localStorage.clear();
        window.history.replaceState({}, "", "/");
        document.documentElement.removeAttribute("data-share-theme");
        document.documentElement.removeAttribute("style");
    });

    it("parses canonical and machine share refs deterministically", () => {
        expect(parseShareRef("abc123token")).toEqual({ shareToken: "abc123token", pathFormat: "html" });
        expect(parseShareRef("abc123token.md")).toEqual({ shareToken: "abc123token", pathFormat: "md" });
        expect(parseShareRef("abc123token.json")).toEqual({ shareToken: "abc123token", pathFormat: "json" });
    });

    it("resolves query format while preserving deterministic path format", () => {
        expect(resolveShareFormat("html", "json")).toBe("json");
        expect(resolveShareFormat("md", null)).toBe("md");
        expect(() => resolveShareFormat("json", "md")).toThrow("Conflicting format selectors");
        expect(() => resolveShareFormat("html", "xml")).toThrow("Unsupported format");
    });

    it("builds the share page view model from memo domain data and route-derived canonicalUrl", () => {
        const artifacts = createEmptyArtifactMap();
        const viewModel = buildSharePageViewModel(
            baseResolvedMemo,
            "https://example.com/s/route-derived-token",
            artifacts
        );

        expect(viewModel).toEqual({
            artifactType: "memo",
            artifactId: "memo-123",
            shareToken: "abc123token",
            authorName: "Marko Ivanovic",
            authorAvatarUrl: "https://example.com/avatar.png",
            canonicalUrl: "https://example.com/s/route-derived-token",
            title: "Standup Notes",
            transcript: "Today we finished the uploader and fixed retries.",
            mediaUrl: "https://cdn.example.com/audio.webm",
            createdAt: "2026-02-21T14:30:00.000Z",
            sharedAt: "2026-02-21T14:32:00.000Z",
            expiresAt: null,
            isLiveRecording: false,
            transcriptStatus: "complete",
            transcriptSegments: null,
            artifacts,
        });
    });

    it("serializes the share boot payload without literal angle brackets", () => {
        const serialized = serializeShareBootPayload({
            shareToken: "abc123token",
            canonicalUrl: "https://example.com/s/abc123token",
            isLiveRecording: false,
            transcriptFileName: "shared-transcript.txt",
            mediaUrl: "https://cdn.example.com/audio?<script>",
        });

        expect(serialized).not.toContain("<");
        expect(JSON.parse(serialized)).toMatchObject({
            mediaUrl: "https://cdn.example.com/audio?<script>",
        });
    });

    it("emits markdown and json with equivalent core artifact identity and content", () => {
        const markdown = buildSharedArtifactMarkdown(basePayload);
        const json = buildSharedArtifactJson(basePayload);

        expect(markdown).toContain("artifact_type: memo");
        expect(markdown).toContain("artifact_id: memo-123");
        expect(markdown).toContain("canonical_url: https://example.com/s/abc123token");
        expect(markdown).toContain("Today we finished the uploader and fixed retries.");

        expect(json.artifact.type).toBe("memo");
        expect(json.artifact.id).toBe("memo-123");
        expect(json.artifact.shareToken).toBe("abc123token");
        expect(json.artifact.canonicalUrl).toBe("https://example.com/s/abc123token");
        expect(json.artifact.transcript).toBe("Today we finished the uploader and fixed retries.");
        expect(json.artifact.artifacts.rolling_summary).toBeNull();
    });

    it("renders summary and outline in markdown for agents when artifacts are present", () => {
        const payload: SharedArtifactPayload = {
            ...basePayload,
            artifacts: {
                rolling_summary: {
                    payload: { summary: "Short summary" },
                    basedOnChunkStart: 0,
                    basedOnChunkEnd: 2,
                    version: 1,
                    updatedAt: "2026-03-15T10:00:00.000Z",
                },
                outline: {
                    payload: {
                        items: [{ title: "Intro", summary: "Starts the memo." }],
                    },
                    basedOnChunkStart: 0,
                    basedOnChunkEnd: 2,
                    version: 1,
                    updatedAt: "2026-03-15T10:00:00.000Z",
                },
                title_candidates: null,
                title: null,
                key_topics: null,
                action_items: null,
            },
        };

        const markdown = buildSharedArtifactMarkdown(payload);

        expect(markdown.indexOf("## Summary")).toBeLessThan(markdown.indexOf("## Transcript"));
        expect(markdown.indexOf("## Outline")).toBeLessThan(markdown.indexOf("## Transcript"));
    });

    it("omits summary and outline from HTML by default (hidden from human-facing share UI)", () => {
        const payload: SharedArtifactPayload = {
            ...basePayload,
            artifacts: {
                rolling_summary: {
                    payload: { summary: "Short summary" },
                    basedOnChunkStart: 0,
                    basedOnChunkEnd: 2,
                    version: 1,
                    updatedAt: "2026-03-15T10:00:00.000Z",
                },
                outline: {
                    payload: {
                        items: [{ title: "Intro", summary: "Starts the memo." }],
                    },
                    basedOnChunkStart: 0,
                    basedOnChunkEnd: 2,
                    version: 1,
                    updatedAt: "2026-03-15T10:00:00.000Z",
                },
                title_candidates: null,
                title: null,
                key_topics: null,
                action_items: null,
            },
        };

        const html = buildSharedArtifactHtml(payload);

        expect(html).not.toContain("<h2>Summary</h2>");
        expect(html).not.toContain("<h2>Outline</h2>");
    });

    it("includes summary and outline in HTML when showArtifactsInUi is true", () => {
        const payload: SharedArtifactPayload = {
            ...basePayload,
            artifacts: {
                rolling_summary: {
                    payload: { summary: "Short summary" },
                    basedOnChunkStart: 0,
                    basedOnChunkEnd: 2,
                    version: 1,
                    updatedAt: "2026-03-15T10:00:00.000Z",
                },
                outline: {
                    payload: {
                        items: [{ title: "Intro", summary: "Starts the memo." }],
                    },
                    basedOnChunkStart: 0,
                    basedOnChunkEnd: 2,
                    version: 1,
                    updatedAt: "2026-03-15T10:00:00.000Z",
                },
                title_candidates: null,
                title: null,
                key_topics: null,
                action_items: null,
            },
        };

        const html = buildSharedArtifactHtml(payload, { showArtifactsInUi: true });

        expect(html).toContain("<h2>Summary</h2>");
        expect(html).toContain("<h2>Outline</h2>");
    });

    it("renders transcript generate and overflow controls in the shared html page", () => {
        const html = buildSharedArtifactHtml(basePayload);

        expect(html).toContain('id="generate-toggle-btn"');
        expect(html).toContain('id="transcript-actions-toggle-btn"');
        expect(html).toContain('id="transcript-actions-menu"');
        expect(html).toContain("Generate");
        expect(html).toContain("Generate from this memo");
        expect(html).toContain("Copy transcript");
        expect(html).toContain('href="https://chatgpt.com/"');
        expect(html).toContain('href="https://claude.ai/"');
        expect(html).toContain('href="https://gemini.google.com/app"');
        expect(html).toContain('href="https://grok.com/"');
        expect(html).toContain('id="transcript-content"');
    });

    it("renders the generate toggle and overflow actions above the transcript while keeping the top waveform available when enabled", () => {
        const html = buildSharedArtifactHtml(basePayload, { showEngagementRow: true } as never);
        const parsed = new DOMParser().parseFromString(html, "text/html");
        const waveform = parsed.querySelector('[data-waveform-position="top"]');
        const transcriptHeading = parsed.getElementById("transcript-heading");
        const generateToggle = parsed.getElementById("generate-toggle-btn");
        const generatePanel = parsed.getElementById("generate-panel");
        const actionsToggle = parsed.getElementById("transcript-actions-toggle-btn");
        const actionsMenu = parsed.getElementById("transcript-actions-menu");
        const legacySendToAiButton = parsed.getElementById("send-to-ai-btn");

        expect(waveform).not.toBeNull();
        expect(transcriptHeading).not.toBeNull();
        expect(generateToggle).not.toBeNull();
        expect(generateToggle?.textContent).toContain("Generate");
        expect(generatePanel).not.toBeNull();
        expect(generatePanel?.textContent).toContain("Generate from this memo");
        expect(actionsToggle).not.toBeNull();
        expect(actionsMenu).not.toBeNull();
        expect(actionsMenu?.querySelector("#export-transcript-btn")).not.toBeNull();
        expect(actionsMenu?.querySelector("#copy-transcript-btn")).not.toBeNull();
        expect(legacySendToAiButton).toBeNull();
        expect(
            waveform?.compareDocumentPosition(transcriptHeading as Node) &
                Node.DOCUMENT_POSITION_FOLLOWING
        ).toBeTruthy();
    });

    it("embeds a safe share boot payload that parses as JSON with the expected keys", () => {
        const html = buildSharedArtifactHtml({
            ...basePayload,
            mediaUrl: "https://cdn.example.com/audio?<unsafe>",
        });
        const boot = extractBootPayload(html);

        expect(boot.raw).not.toContain("<");
        expect(boot.parsed).toEqual({
            shareToken: "abc123token",
            canonicalUrl: "https://example.com/s/abc123token",
            isLiveRecording: false,
            transcriptFileName: "Standup-Notes.md",
            mediaUrl: "https://cdn.example.com/audio?<unsafe>",
        });
    });

    it("renders the comments root inside the article shell", () => {
        const html = buildSharedArtifactHtml(basePayload);
        const commentsRootIndex = html.indexOf('<section id="comments-root">');
        const articleCloseIndex = html.indexOf("</article>");

        expect(commentsRootIndex).toBeGreaterThan(-1);
        expect(commentsRootIndex).toBeLessThan(articleCloseIndex);
    });

    it("styles the canonical url link from the active theme instead of a hardcoded share color", () => {
        const html = buildSharedArtifactHtml(basePayload);

        expect(html).not.toContain("p.meta a {");
        expect(html).toContain(".copy-link-btn");
        expect(html).toContain(
            `data-url="${basePayload.canonicalUrl}"`
        );
        expect(html).not.toContain(`style="color:#fdba74"`);
    });

    it("renders the sticky top navbar with acquisition CTAs", () => {
        const html = buildSharedArtifactHtml(basePayload);
        
        expect(html).toContain('class="share-navbar"');
        expect(html).toContain("MomentumUploader");
        expect(html).toContain('href="/sign-in"');
        expect(html).toContain('href="/sign-up"');
    });

    it('renders "Record" instead of "Open app" for authenticated viewer CTAs', () => {
        const html = buildSharedArtifactHtml(
            basePayload,
            { viewer: { isAuthenticated: true } } as never
        );

        expect(html).toContain(">Record<");
        expect(html).not.toContain(">Open app<");
    });

    it("renders the author name and avatar instead of generic placeholders", () => {
        const html = buildSharedArtifactHtml(basePayload);
        
        expect(html).toContain("Marko Ivanovic");
        expect(html).toContain('src="https://example.com/avatar.png"');
        expect(html).not.toContain("MomentumUploader User");
    });

    it("hides the engagement row by default while keeping the share call to action", () => {
        const html = buildSharedArtifactHtml(basePayload);

        expect(html).not.toContain('class="engagement-row"');
        expect(html).not.toContain('class="engagement-btn compact-metric-btn comment-btn"');
        expect(html).toContain('id="share-memo-btn"');
        expect(html).toContain("Share Memo");
    });

    it("renders the engagement row with comment count and share actions when enabled", () => {
        const html = buildSharedArtifactHtml({
            ...basePayload,
            bookmarkCount: 7,
        } as SharedArtifactPayload, { showEngagementRow: true } as never);
        
        expect(html).toContain('class="engagement-row"');
        expect(html).toContain('class="engagement-btn compact-metric-btn comment-btn"');
        expect(html).toContain('id="share-memo-btn"');
        expect(html).toContain("Share Memo");
        expect(html).toContain('id="bookmark-share-btn"');
        expect(html).toContain('id="bookmark-share-count"');
        expect(html).toContain(">7<");
        expect(html).toContain('id="bookmark-share-signin"');
    });

    it("hides the top waveform by default while keeping the bottom player", () => {
        const html = buildSharedArtifactHtml(basePayload);
        const parsed = new DOMParser().parseFromString(html, "text/html");
        const topWaveform = parsed.querySelector('[data-waveform-position="top"]');
        const bottomWaveform = parsed.querySelector('[data-waveform-position="bottom"]');
        const shareButton = parsed.getElementById("share-memo-btn");
        const transcriptHeading = parsed.getElementById("transcript-heading");

        expect(topWaveform).toBeNull();
        expect(bottomWaveform).not.toBeNull();
        expect(shareButton).not.toBeNull();
        expect(transcriptHeading).not.toBeNull();
        expect(
            shareButton?.compareDocumentPosition(transcriptHeading as Node) &
                Node.DOCUMENT_POSITION_FOLLOWING
        ).toBeTruthy();
        expect(
            transcriptHeading?.compareDocumentPosition(bottomWaveform as Node) &
                Node.DOCUMENT_POSITION_FOLLOWING
        ).toBeTruthy();
    });

    it("renders the top waveform directly before the share memo call to action when enabled", () => {
        const html = buildSharedArtifactHtml(basePayload, { showEngagementRow: true } as never);
        const waveformIndex = html.indexOf('data-waveform-position="top"');
        const shareButtonIndex = html.indexOf('id="share-memo-btn"');
        const transcriptHeadingIndex = html.indexOf('id="transcript-heading"');

        expect(waveformIndex).toBeGreaterThan(-1);
        expect(shareButtonIndex).toBeGreaterThan(-1);
        expect(transcriptHeadingIndex).toBeGreaterThan(-1);
        expect(waveformIndex).toBeLessThan(shareButtonIndex);
        expect(shareButtonIndex).toBeLessThan(transcriptHeadingIndex);
    });

    it("renders the bottom waveform below the transcript by default", () => {
        const html = buildSharedArtifactHtml(basePayload);
        const parsed = new DOMParser().parseFromString(html, "text/html");
        const waveformPlayers = parsed.querySelectorAll(".waveform-player");
        const transcriptContent = parsed.getElementById("transcript-content");
        const bottomWaveform = parsed.querySelector('[data-waveform-position="bottom"]');

        expect(waveformPlayers).toHaveLength(1);
        expect(bottomWaveform).not.toBeNull();
        expect(transcriptContent).not.toBeNull();
        expect(
            transcriptContent?.compareDocumentPosition(bottomWaveform as Node) &
                Node.DOCUMENT_POSITION_FOLLOWING
        ).toBeTruthy();
    });

    it("renders both waveform players when the engagement toggle is enabled", () => {
        const html = buildSharedArtifactHtml(basePayload, { showEngagementRow: true } as never);
        const parsed = new DOMParser().parseFromString(html, "text/html");

        expect(parsed.querySelectorAll(".waveform-player")).toHaveLength(2);
        expect(parsed.querySelector('[data-waveform-position="top"]')).not.toBeNull();
        expect(parsed.querySelector('[data-waveform-position="bottom"]')).not.toBeNull();
    });

    it("styles the bottom waveform as a boxed player with a left-aligned play button", () => {
        const html = buildSharedArtifactHtml(basePayload);

        expect(html).toContain('.waveform-player[data-waveform-position="bottom"] {\n      width: min(100%, 28rem);');
        expect(html).toContain("border-radius: 18px;");
        expect(html).toContain("box-shadow: 0 14px 30px rgba(15, 23, 42, 0.14);");
        expect(html).toContain('.waveform-player[data-waveform-position="bottom"] .waveform-play-btn {\n      left: 1rem;');
        expect(html).toContain("transform: translateY(-50%);");
        expect(html).toContain('.waveform-player[data-waveform-position="bottom"] .waveform-bars {\n      left: 5.25rem;');
        expect(html).not.toContain('.waveform-player[data-waveform-position="bottom"] {\n      width: 100%;');
    });

    it("renders compact engagement controls with icon-only comment and save actions", () => {
        const html = buildSharedArtifactHtml(
            {
                ...basePayload,
                bookmarkCount: 7,
            } as SharedArtifactPayload,
            { showEngagementRow: true, viewer: { isAuthenticated: true } } as never
        );

        expect(html).toContain('class="engagement-actions engagement-actions-left"');
        expect(html).toContain('class="engagement-btn compact-metric-btn comment-btn"');
        expect(html).toContain('class="engagement-btn compact-metric-btn bookmark-btn"');
        expect(html).toContain('id="bookmark-share-label" class="sr-only"');
        expect(html).not.toContain(">Notes<");
        expect(html).toContain(".engagement-btn.hero-share-btn {\n      width: 100%;");
        expect(html).toContain("justify-content: center;");
        expect(html).toContain("border: none;");
        expect(html).toContain("background: #2563eb;");
        expect(html).not.toContain("box-shadow: 0 20px 36px");
        expect(html).toContain(".engagement-btn.hero-share-btn:hover {");
        expect(html).toContain(".hero-share-label {\n      display: block;");
        expect(html).toContain("text-align: center;");
        expect(html).toContain(".compact-metric-btn {\n      min-height: 2.5rem;");
    });

    it("anchors the Notes control to the discussion heading with enough scroll offset", () => {
        const html = buildSharedArtifactHtml(basePayload, { showEngagementRow: true } as never);

        expect(html).toContain('href="#discussion"');
        expect(html).toContain('aria-label="Go to discussion"');
        expect(html).toContain('<section id="discussion" class="disc-section">');
        expect(html).toContain(".disc-section {\n      scroll-margin-top:");
        expect(html).not.toContain('href="#comments-root"');
        expect(html).not.toContain('aria-label="View comments"');
    });

    it("renders the top waveform above the transcript divider when enabled", () => {
        const html = buildSharedArtifactHtml(basePayload, { showEngagementRow: true } as never);
        const waveformIndex = html.indexOf('data-waveform-position="top"');
        const dividerIndex = html.indexOf('class="hero-divider"');
        const transcriptHeadingIndex = html.indexOf('id="transcript-heading"');

        expect(waveformIndex).toBeGreaterThan(-1);
        expect(dividerIndex).toBeGreaterThan(-1);
        expect(transcriptHeadingIndex).toBeGreaterThan(-1);
        expect(waveformIndex).toBeLessThan(dividerIndex);
        expect(dividerIndex).toBeLessThan(transcriptHeadingIndex);
    });

    it("applies the saved memo theme from localStorage to the share page", async () => {
        const blueTheme = THEMES.find((theme) => theme.id === "blue");
        const html = buildSharedArtifactHtml(basePayload);
        const fetchMock = jest.fn().mockResolvedValue(emptyDiscussionResponse);

        expect(blueTheme).toBeDefined();
        window.localStorage.setItem("sonic-theme", "blue");

        await loadSharePageScript(html, fetchMock);

        expect(document.documentElement.dataset.shareTheme).toBe("blue");
        expect(document.documentElement.style.getPropertyValue("--background")).toBe(
            blueTheme?.vars.background
        );
        expect(document.documentElement.style.getPropertyValue("--accent")).toBe(
            blueTheme?.vars.accent
        );
    });

    it("does not persist a theme into app storage when the share page falls back to the default theme", async () => {
        const html = buildSharedArtifactHtml(basePayload);
        const fetchMock = jest.fn().mockResolvedValue(emptyDiscussionResponse);

        await loadSharePageScript(html, fetchMock);

        expect(document.documentElement.dataset.shareTheme).toBe(DEFAULT_THEME.id);
        expect(window.localStorage.getItem("sonic-theme")).toBeNull();
    });

    it("lets a theme query override share-page presentation without overwriting the saved app theme", async () => {
        const emeraldTheme = THEMES.find((theme) => theme.id === "emerald");
        const html = buildSharedArtifactHtml(basePayload);
        const fetchMock = jest.fn().mockResolvedValue(emptyDiscussionResponse);

        expect(emeraldTheme).toBeDefined();
        window.localStorage.setItem("sonic-theme", DEFAULT_THEME.id);
        window.history.replaceState({}, "", "/s/abc123token?theme=emerald");

        await loadSharePageScript(html, fetchMock);

        expect(document.documentElement.dataset.shareTheme).toBe("emerald");
        expect(document.documentElement.style.getPropertyValue("--background")).toBe(
            emeraldTheme?.vars.background
        );
        expect(window.localStorage.getItem("sonic-theme")).toBe(DEFAULT_THEME.id);
    });

    it("renders the discussion scaffold with separate unauthenticated and owner-only hints", () => {
        const html = buildSharedArtifactHtml(basePayload);

        expect(html).toContain('<section id="discussion" class="disc-section">');
        expect(html).toContain('id="disc-form"');
        expect(html).toContain('id="disc-signin"');
        expect(html).toContain("Sign in to add a note.");
        expect(html).toContain('id="disc-owner-only"');
        expect(html).toContain("Only the memo owner can post.");
    });

    it("publishes public-safe OpenClaw handoff metadata across html, markdown, and json exports", () => {
        const html = buildSharedArtifactHtml(basePayload);
        const markdown = buildSharedArtifactMarkdown(basePayload);
        const json = buildSharedArtifactJson(basePayload) as Record<string, unknown>;
        const embedded = extractJsonScriptPayload(html, "momentum-share-agent-handoff");

        expect(html).toContain('<meta name="momentum:share-agent-handoff" content="available"');
        expect(html).toContain('id="momentum-share-agent-handoff"');
        expect(html).toContain('"kind":"momentum/share-agent-handoff"');
        expect(html).toContain('"shareRef":"abc123token"');
        expect(html).toContain('"manifestUrl":"https://example.com/openclaw/memo-room/v1/skill.json"');
        expect(html).toContain('"url":"https://example.com/api/s/abc123token/handoff"');
        expect(html).not.toContain('"roomId"');
        expect(embedded.raw).not.toContain("<");
        expect(embedded.parsed).toMatchObject({
            kind: "momentum/share-agent-handoff",
            shareRef: "abc123token",
        });

        expect(markdown).toContain("skill_manifest_url: https://example.com/openclaw/memo-room/v1/skill.json");
        expect(markdown).toContain("handoff_url: https://example.com/api/s/abc123token/handoff");
        expect(markdown).toContain("registration_url: https://example.com/api/openclaw/register");
        expect(markdown).toContain("handoff_auth_header: x-openclaw-api-key");
        expect(markdown).toContain("handoff_auth_format: oc_acct_123:secret-xyz");
        expect(markdown).toContain("registration_required_without_api_key: true");
        expect(markdown).toContain("alternate_json_url: https://example.com/s/abc123token.json");
        expect(markdown).toContain("alternate_markdown_url: https://example.com/s/abc123token.md");

        expect(json).toMatchObject({
            agent_handoff: {
                kind: "momentum/share-agent-handoff",
                version: "1",
                shareRef: "abc123token",
                canonicalUrl: "https://example.com/s/abc123token",
                alternates: {
                    markdownUrl: "https://example.com/s/abc123token.md",
                    jsonUrl: "https://example.com/s/abc123token.json",
                },
                skill: {
                    manifestUrl: "https://example.com/openclaw/memo-room/v1/skill.json",
                    version: "0.1.3",
                },
                authentication: {
                    header: "x-openclaw-api-key",
                    format: "oc_acct_123:secret-xyz",
                    required: true,
                    registerFirstIfMissing: true,
                },
                bootstrap: {
                    registrationUrl: "https://example.com/api/openclaw/register",
                    method: "POST",
                    registrationTokenField: "registration_token",
                    displayNameField: "display_name",
                },
                handoff: {
                    url: "https://example.com/api/s/abc123token/handoff",
                    method: "POST",
                },
                suggestedInitialAction: {
                    type: "greeting",
                },
            },
        });
        expect(JSON.stringify(json)).not.toContain('"roomId"');
    });

    it("renders the owner-only OpenClaw invite, claim, and ask widget scaffold", () => {
        const html = buildSharedArtifactHtml(basePayload);

        expect(html).toContain('id="openclaw-widget"');
        expect(html).toContain('id="oc-invite"');
        expect(html).toContain('id="oc-invite-btn"');
        expect(html).toContain('id="oc-preview"');
        expect(html).toContain('id="oc-preview-text"');
        expect(html).toContain('id="oc-reg-section"');
        expect(html).toContain('id="oc-reg-btn"');
        expect(html).toContain('id="oc-reg-result"');
        expect(html).toContain('id="oc-pending"');
        expect(html).toContain('id="oc-claim-btn"');
        expect(html).toContain('id="oc-claimed"');
        expect(html).toContain('id="oc-ask-btn"');
        expect(html).toContain('id="oc-disconnect-btn"');
        expect(html).toContain('id="oc-ask-dialog"');
        expect(html).toContain('id="oc-ask-submit"');
        expect(html).toContain("Send This To OpenClaw");
        expect(html).toContain("Paste this exact block into your OpenClaw chat or command window.");
        expect(html).toContain("Generate registration token");
        expect(html).toContain("If OpenClaw says it isn't registered yet, generate a one-time registration token.");
        expect(html).toContain("#oc-reg-section {");
        expect(html).toContain(".oc-reg-token-block {");
        expect(html).toContain(".oc-reg-warn {");
    });

    it("wires the owner widget to the OpenClaw share endpoints and memo-room invocations", () => {
        const html = buildSharedArtifactHtml(basePayload);

        expect(html).toContain('fetch("/api/s/" + shareRef + "/openclaw-status"');
        expect(html).toContain('fetch("/api/s/" + shareRef + "/invite"');
        expect(html).toContain('fetch("/api/s/" + shareRef + "/claim"');
        expect(html).toContain('method: "DELETE"');
        expect(html).toContain('fetch("/api/openclaw/registration-token"');
        expect(html).toContain('fetch("/api/memo-rooms/" + openClawState.roomId + "/invocations"');
        expect(html).toContain("navigator.clipboard.writeText(inviteText)");
        expect(html).toContain("navigator.clipboard.writeText(registration_token)");
        expect(html).toContain('body: JSON.stringify({ force: true })');
        expect(html).toContain("openClawPreviewText.textContent = inviteText || \"\";");
        expect(html).toContain("openClawPreview.style.display = inviteText ? \"grid\" : \"none\";");
        expect(html).toContain('openClawRegSection.style.display = inviteText ? "" : "none";');
        expect(html).toContain("Copy failed here. Send the block below to OpenClaw.");
        expect(html).toContain("setInterval(function() {");
        expect(html).not.toContain('"/api/s/" + shareRef + "/handoff"');
    });

    it("reveals the OpenClaw registration helper after invite and supports generate, replace, and copy", async () => {
        const html = buildSharedArtifactHtml(basePayload);
        const writeText = jest.fn().mockResolvedValue(undefined);
        const setIntervalSpy = jest
            .spyOn(global, "setInterval")
            .mockReturnValue(123 as unknown as ReturnType<typeof setInterval>);
        const clearIntervalSpy = jest
            .spyOn(global, "clearInterval")
            .mockImplementation(() => undefined);
        let tokenRequestCount = 0;
        const fetchMock = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);

            if (url === "/api/s/abc123token/discussion") {
                return Promise.resolve({
                    ok: true,
                    json: async () => ({
                        messages: [],
                        isOwner: true,
                        isAuthenticated: true,
                    }),
                });
            }

            if (url === "/api/s/abc123token/openclaw-status") {
                return Promise.resolve({
                    ok: true,
                    json: async () => ({
                        state: "none",
                    }),
                });
            }

            if (url === "/api/s/abc123token/invite") {
                return Promise.resolve({
                    ok: true,
                    json: async () => ({
                        inviteText: "invite-block",
                    }),
                });
            }

            if (url === "/api/openclaw/registration-token") {
                tokenRequestCount += 1;
                if (init?.body) {
                    return Promise.resolve({
                        ok: true,
                        json: async () => ({
                            registration_token: "reg-token-2",
                            expires_at: "2026-03-25T14:30:00.000Z",
                        }),
                    });
                }

                if (tokenRequestCount === 1) {
                    return Promise.resolve({
                        ok: true,
                        json: async () => ({
                            registration_token: "reg-token-1",
                            expires_at: "2026-03-25T14:00:00.000Z",
                        }),
                    });
                }

                return Promise.resolve({
                    ok: false,
                    status: 409,
                    json: async () => ({
                        expires_at: "2026-03-25T14:00:00.000Z",
                    }),
                });
            }

            throw new Error(`Unexpected fetch URL: ${url}`);
        });
        try {
            await loadSharePageScript(html, fetchMock);

            Object.defineProperty(global.navigator, "clipboard", {
                configurable: true,
                value: { writeText },
            });

            const inviteButton = document.getElementById("oc-invite-btn") as HTMLButtonElement;
            const regSection = document.getElementById("oc-reg-section") as HTMLElement;
            const regButton = document.getElementById("oc-reg-btn") as HTMLButtonElement;
            const regResult = document.getElementById("oc-reg-result") as HTMLElement;

            expect(regSection.style.display).toBe("none");
            expect(regResult.style.display).toBe("none");

            await act(async () => {
                inviteButton.dispatchEvent(
                    new MouseEvent("click", { bubbles: true, cancelable: true })
                );
                await Promise.resolve();
                await Promise.resolve();
            });

            expect((document.getElementById("openclaw-widget") as HTMLElement).style.display).toBe("grid");
            expect((document.getElementById("oc-preview") as HTMLElement).style.display).toBe("grid");
            expect(regSection.style.display).toBe("");

            await act(async () => {
                regButton.dispatchEvent(
                    new MouseEvent("click", { bubbles: true, cancelable: true })
                );
                await Promise.resolve();
                await Promise.resolve();
            });

            expect(regResult.style.display).toBe("");
            expect(regResult).toHaveTextContent("Shown once");
            expect(regResult).toHaveTextContent("reg-token-1");

            const copyButton = document.getElementById("oc-reg-copy") as HTMLButtonElement;
            expect(copyButton).not.toBeNull();

            await act(async () => {
                copyButton.dispatchEvent(
                    new MouseEvent("click", { bubbles: true, cancelable: true })
                );
                await Promise.resolve();
            });

            expect(writeText).toHaveBeenCalledWith("reg-token-1");
            expect(copyButton.textContent).toBe("Copied");

            await act(async () => {
                regButton.dispatchEvent(
                    new MouseEvent("click", { bubbles: true, cancelable: true })
                );
                await Promise.resolve();
                await Promise.resolve();
            });

            expect(regResult).toHaveTextContent("You already have an active registration token");

            const replaceButton = document.getElementById("oc-reg-replace") as HTMLButtonElement;
            expect(replaceButton).not.toBeNull();

            await act(async () => {
                replaceButton.dispatchEvent(
                    new MouseEvent("click", { bubbles: true, cancelable: true })
                );
                await Promise.resolve();
                await Promise.resolve();
            });

            expect(regResult).toHaveTextContent("reg-token-2");

            const copyButton2 = document.getElementById("oc-reg-copy2") as HTMLButtonElement;
            expect(copyButton2).not.toBeNull();

            await act(async () => {
                copyButton2.dispatchEvent(
                    new MouseEvent("click", { bubbles: true, cancelable: true })
                );
                await Promise.resolve();
            });

            expect(writeText).toHaveBeenLastCalledWith("reg-token-2");
            expect(fetchMock).toHaveBeenCalledWith(
                "/api/openclaw/registration-token",
                expect.objectContaining({
                    method: "POST",
                    credentials: "include",
                })
            );
            expect(fetchMock).toHaveBeenCalledWith(
                "/api/openclaw/registration-token",
                expect.objectContaining({
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ force: true }),
                })
            );
        } finally {
            setIntervalSpy.mockRestore();
            clearIntervalSpy.mockRestore();
        }
    });

    it("keeps polling after invite while the OpenClaw is still awaiting first handoff", async () => {
        const html = buildSharedArtifactHtml(basePayload);
        let pollStatus: (() => void | Promise<void>) | null = null;
        const setIntervalSpy = jest
            .spyOn(global, "setInterval")
            .mockImplementation((callback: TimerHandler) => {
                pollStatus = callback as () => void | Promise<void>;
                return 123 as unknown as ReturnType<typeof setInterval>;
            });
        const clearIntervalSpy = jest
            .spyOn(global, "clearInterval")
            .mockImplementation(() => undefined);
        let openClawStatusRequestCount = 0;
        const fetchMock = jest.fn((input: RequestInfo | URL) => {
            const url = String(input);

            if (url === "/api/s/abc123token/discussion") {
                return Promise.resolve({
                    ok: true,
                    json: async () => ({
                        messages: [],
                        isOwner: true,
                        isAuthenticated: true,
                    }),
                });
            }

            if (url === "/api/s/abc123token/openclaw-status") {
                openClawStatusRequestCount += 1;
                return Promise.resolve({
                    ok: true,
                    json: async () => ({
                        state:
                            openClawStatusRequestCount >= 3
                                ? "pending_claim"
                                : "none",
                        requestCount: openClawStatusRequestCount,
                    }),
                });
            }

            if (url === "/api/s/abc123token/invite") {
                return Promise.resolve({
                    ok: true,
                    json: async () => ({
                        inviteText: "invite-block",
                    }),
                });
            }

            throw new Error(`Unexpected fetch URL: ${url}`);
        });

        try {
            await loadSharePageScript(html, fetchMock);

            const inviteButton = document.getElementById("oc-invite-btn") as HTMLButtonElement;
            expect(inviteButton).not.toBeNull();

            await act(async () => {
                inviteButton.dispatchEvent(
                    new MouseEvent("click", { bubbles: true, cancelable: true })
                );
                await Promise.resolve();
                await Promise.resolve();
            });

            expect(pollStatus).not.toBeNull();
            expect(clearIntervalSpy).not.toHaveBeenCalled();

            await act(async () => {
                await pollStatus?.();
                await Promise.resolve();
                await Promise.resolve();
            });

            expect(openClawStatusRequestCount).toBe(2);
            expect(clearIntervalSpy).not.toHaveBeenCalled();

            await act(async () => {
                await pollStatus?.();
                await Promise.resolve();
                await Promise.resolve();
            });

            expect(openClawStatusRequestCount).toBe(3);
            expect((document.getElementById("oc-pending") as HTMLElement).style.display).toBe("");
            expect((document.getElementById("oc-invite") as HTMLElement).style.display).toBe("none");
            expect(clearIntervalSpy).toHaveBeenCalledWith(123);
        } finally {
            setIntervalSpy.mockRestore();
            clearIntervalSpy.mockRestore();
        }
    });

    it("lets the owner disconnect a claimed OpenClaw and returns the widget to invite state", async () => {
        const html = buildSharedArtifactHtml(basePayload);
        const fetchMock = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);

            if (url === "/api/s/abc123token/discussion") {
                return Promise.resolve({
                    ok: true,
                    json: async () => ({
                        messages: [],
                        isOwner: true,
                        isAuthenticated: true,
                    }),
                });
            }

            if (url === "/api/s/abc123token/openclaw-status") {
                return Promise.resolve({
                    ok: true,
                    json: async () => ({
                        state: "claimed",
                        agentId: "agent-1",
                        roomId: "room-1",
                    }),
                });
            }

            if (url === "/api/s/abc123token/claim" && init?.method === "DELETE") {
                return Promise.resolve({
                    ok: true,
                    status: 204,
                    json: async () => ({}),
                });
            }

            throw new Error(`Unexpected fetch URL: ${url}`);
        });

        await loadSharePageScript(html, fetchMock);

        const inviteWidget = document.getElementById("oc-invite") as HTMLElement;
        const claimedWidget = document.getElementById("oc-claimed") as HTMLElement;
        const disconnectButton = document.getElementById("oc-disconnect-btn") as HTMLButtonElement;

        expect(claimedWidget.style.display).toBe("");
        expect(inviteWidget.style.display).toBe("none");
        expect(disconnectButton).not.toBeNull();

        await act(async () => {
            disconnectButton.dispatchEvent(
                new MouseEvent("click", { bubbles: true, cancelable: true })
            );
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(fetchMock).toHaveBeenCalledWith(
            "/api/s/abc123token/claim",
            expect.objectContaining({
                method: "DELETE",
                credentials: "include",
            })
        );
        expect(claimedWidget.style.display).toBe("none");
        expect(inviteWidget.style.display).toBe("");
    });

    it("shows the server-provided registration-token error when generation is unavailable", async () => {
        const html = buildSharedArtifactHtml(basePayload);
        const setIntervalSpy = jest
            .spyOn(global, "setInterval")
            .mockReturnValue(123 as unknown as ReturnType<typeof setInterval>);
        const clearIntervalSpy = jest
            .spyOn(global, "clearInterval")
            .mockImplementation(() => undefined);
        const fetchMock = jest.fn((input: RequestInfo | URL) => {
            const url = String(input);

            if (url === "/api/s/abc123token/discussion") {
                return Promise.resolve({
                    ok: true,
                    json: async () => ({
                        messages: [],
                        isOwner: true,
                        isAuthenticated: true,
                    }),
                });
            }

            if (url === "/api/s/abc123token/openclaw-status") {
                return Promise.resolve({
                    ok: true,
                    json: async () => ({
                        state: "none",
                    }),
                });
            }

            if (url === "/api/s/abc123token/invite") {
                return Promise.resolve({
                    ok: true,
                    json: async () => ({
                        inviteText: "invite-block",
                    }),
                });
            }

            if (url === "/api/openclaw/registration-token") {
                return Promise.resolve({
                    ok: false,
                    status: 503,
                    json: async () => ({
                        error: "OpenClaw registration tokens are unavailable until the latest database migration is applied.",
                    }),
                });
            }

            throw new Error(`Unexpected fetch URL: ${url}`);
        });

        try {
            await loadSharePageScript(html, fetchMock);

            const inviteButton = document.getElementById("oc-invite-btn") as HTMLButtonElement;
            const regButton = document.getElementById("oc-reg-btn") as HTMLButtonElement;
            const regResult = document.getElementById("oc-reg-result") as HTMLElement;

            await act(async () => {
                inviteButton.dispatchEvent(
                    new MouseEvent("click", { bubbles: true, cancelable: true })
                );
                await Promise.resolve();
                await Promise.resolve();
            });

            await act(async () => {
                regButton.dispatchEvent(
                    new MouseEvent("click", { bubbles: true, cancelable: true })
                );
                await Promise.resolve();
                await Promise.resolve();
            });

            expect(regResult.style.display).toBe("");
            expect(regResult).toHaveTextContent(
                "OpenClaw registration tokens are unavailable until the latest database migration is applied."
            );
        } finally {
            setIntervalSpy.mockRestore();
            clearIntervalSpy.mockRestore();
        }
    });

    it("uses direct audio seeking for discussion anchors and guards the owner form listener from duplicates", () => {
        const html = buildSharedArtifactHtml(basePayload);

        expect(html).toContain("audio.currentTime = +btn.dataset.t / 1000;");
        expect(html).not.toContain("seekTo(");
        expect(html).toContain("if (!form._listenerAttached)");
        expect(html).toContain("const { messages, isOwner, isAuthenticated } = await res.json();");
    });

    it("drives transcript export from the embedded boot payload", async () => {
        const clickedDownloads: string[] = [];
        const html = buildSharedArtifactHtml(basePayload);
        const parsed = new DOMParser().parseFromString(html, "text/html");
        const inlineScript = parsed.querySelector('script:not([type="application/json"])');

        const createObjectURL = jest.fn(() => "blob:mock-export");
        const revokeObjectURL = jest.fn();
        Object.defineProperty(global.URL, "createObjectURL", {
            configurable: true,
            value: createObjectURL,
        });
        Object.defineProperty(global.URL, "revokeObjectURL", {
            configurable: true,
            value: revokeObjectURL,
        });
        Object.defineProperty(global.navigator, "clipboard", {
            configurable: true,
            value: { writeText: jest.fn().mockResolvedValue(undefined) },
        });
        Object.defineProperty(global.HTMLAnchorElement.prototype, "click", {
            configurable: true,
            value: function click(this: HTMLAnchorElement) {
                clickedDownloads.push(this.download);
            },
        });

        document.head.innerHTML = parsed.head.innerHTML;
        document.body.innerHTML = parsed.body.innerHTML;

        expect(inlineScript?.textContent).toBeTruthy();
        window.eval(inlineScript?.textContent ?? "");

        const exportButton = document.getElementById("export-transcript-btn");
        expect(exportButton).not.toBeNull();
        expect(exportButton?.getAttribute("data-filename")).toBe("Standup-Notes.md");

        exportButton?.dispatchEvent(
            new MouseEvent("click", { bubbles: true, cancelable: true })
        );

        expect(clickedDownloads).toEqual(["Standup-Notes.md"]);
        expect(createObjectURL).toHaveBeenCalledTimes(1);
        expect(createObjectURL.mock.calls[0]?.[0]).toMatchObject({
            type: "text/markdown;charset=utf-8",
        });
        expect(revokeObjectURL).toHaveBeenCalledWith("blob:mock-export");
    });

    it("copies the transcript text from the share page instead of the canonical url", async () => {
        const writeText = jest.fn().mockResolvedValue(undefined);
        const html = buildSharedArtifactHtml(basePayload);
        const fetchMock = jest.fn().mockResolvedValue(emptyDiscussionResponse);

        await loadSharePageScript(html, fetchMock);

        Object.defineProperty(global.navigator, "clipboard", {
            configurable: true,
            value: { writeText },
        });

        const copyButton = document.getElementById("copy-transcript-btn");
        expect(copyButton).not.toBeNull();

        copyButton?.dispatchEvent(
            new MouseEvent("click", { bubbles: true, cancelable: true })
        );

        await act(async () => {
            await Promise.resolve();
        });

        expect(writeText).toHaveBeenCalledWith(basePayload.transcript);
        expect(writeText).not.toHaveBeenCalledWith(basePayload.canonicalUrl);
    });

    it("expands the Generate panel and copies the transcript from the inline action", async () => {
        const writeText = jest.fn().mockResolvedValue(undefined);
        const html = buildSharedArtifactHtml(basePayload);
        const fetchMock = jest.fn().mockResolvedValue(emptyDiscussionResponse);

        await loadSharePageScript(html, fetchMock);

        Object.defineProperty(global.navigator, "clipboard", {
            configurable: true,
            value: { writeText },
        });

        const openButton = document.getElementById("generate-toggle-btn") as HTMLButtonElement;
        const panel = document.getElementById("generate-panel") as HTMLElement;
        const popupCopyButton = document.getElementById("send-to-ai-copy-btn") as HTMLButtonElement;
        const chatGptLink = document.getElementById("send-to-chatgpt-link") as HTMLAnchorElement;
        const claudeLink = document.getElementById("send-to-claude-link") as HTMLAnchorElement;
        const geminiLink = document.getElementById("send-to-gemini-link") as HTMLAnchorElement;
        const grokLink = document.getElementById("send-to-grok-link") as HTMLAnchorElement;

        expect(openButton).not.toBeNull();
        expect(panel).not.toBeNull();
        expect(popupCopyButton).not.toBeNull();
        expect(panel.hidden).toBe(true);

        openButton.click();

        expect(panel.hidden).toBe(false);
        expect(panel).toHaveTextContent("Generate from this memo");
        expect(panel).toHaveTextContent("Copy transcript");
        expect(chatGptLink.href).toBe("https://chatgpt.com/");
        expect(claudeLink.href).toBe("https://claude.ai/");
        expect(geminiLink.href).toBe("https://gemini.google.com/app");
        expect(grokLink.href).toBe("https://grok.com/");

        popupCopyButton.click();

        await act(async () => {
            await Promise.resolve();
        });

        expect(writeText).toHaveBeenCalledWith(basePayload.transcript);
    });

    it("opens the transcript actions menu on hover and closes it when the pointer leaves", async () => {
        const html = buildSharedArtifactHtml(basePayload);
        const fetchMock = jest.fn().mockResolvedValue(emptyDiscussionResponse);

        await loadSharePageScript(html, fetchMock);

        const actionsShell = document.querySelector(".transcript-actions-menu-shell") as HTMLElement;
        const actionsMenu = document.getElementById("transcript-actions-menu") as HTMLElement;
        const actionsToggle = document.getElementById(
            "transcript-actions-toggle-btn"
        ) as HTMLButtonElement;

        expect(actionsShell).not.toBeNull();
        expect(actionsMenu).not.toBeNull();
        expect(actionsToggle).not.toBeNull();
        expect(actionsMenu.hidden).toBe(true);
        expect(actionsToggle.getAttribute("aria-expanded")).toBe("false");

        actionsShell.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));

        expect(actionsMenu.hidden).toBe(false);
        expect(actionsToggle.getAttribute("aria-expanded")).toBe("true");

        actionsShell.dispatchEvent(new MouseEvent("mouseleave", { bubbles: true }));

        expect(actionsMenu.hidden).toBe(true);
        expect(actionsToggle.getAttribute("aria-expanded")).toBe("false");
    });

    it("shows the sign-in hint for unauthenticated non-owners after discussion loads", async () => {
        const html = buildSharedArtifactHtml(basePayload);
        const fetchMock = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                messages: [],
                isOwner: false,
                isAuthenticated: false,
            }),
        });

        await loadSharePageScript(html, fetchMock);

        expect(document.getElementById("disc-list")).toHaveTextContent("No notes yet.");
        expect((document.getElementById("disc-signin") as HTMLElement).style.display).toBe("");
        expect((document.getElementById("disc-owner-only") as HTMLElement).style.display).toBe(
            "none"
        );
    });

    it("keeps the authenticated bookmark shell visible when bookmark state refresh fails", async () => {
        const html = buildSharedArtifactHtml(
            basePayload,
            { showEngagementRow: true, viewer: { isAuthenticated: true } } as never
        );
        const fetchMock = jest.fn((input: RequestInfo | URL) => {
            const url = String(input);

            if (url === "/api/s/abc123token/bookmark") {
                return Promise.reject(new Error("bookmark lookup failed"));
            }

            if (url === "/api/s/abc123token/discussion") {
                return Promise.resolve({
                    ok: true,
                    json: async () => ({
                        messages: [],
                        isOwner: false,
                        isAuthenticated: true,
                    }),
                });
            }

            throw new Error(`Unexpected fetch URL: ${url}`);
        });

        await loadSharePageScript(html, fetchMock);

        expect((document.getElementById("bookmark-share-btn") as HTMLElement).style.display).toBe(
            ""
        );
        expect(document.getElementById("bookmark-share-signin")).toBeNull();
    });

    it("loads bookmark state even when the discussion scaffold is absent", async () => {
        const html = buildSharedArtifactHtml(
            {
                ...basePayload,
                bookmarkCount: 7,
            } as SharedArtifactPayload,
            { showEngagementRow: true, viewer: { isAuthenticated: true } } as never
        ).replace(/<section id="comments-root">[\s\S]*?<\/section>\s*<\/article>/, "</article>");
        const fetchMock = jest.fn((input: RequestInfo | URL) => {
            const url = String(input);

            if (url === "/api/s/abc123token/bookmark") {
                return Promise.resolve({
                    ok: true,
                    json: async () => ({
                        isAuthenticated: true,
                        isBookmarked: true,
                        bookmarkCount: 8,
                    }),
                });
            }

            throw new Error(`Unexpected fetch URL: ${url}`);
        });

        await loadSharePageScript(html, fetchMock);

        expect(fetchMock).toHaveBeenCalledWith(
            "/api/s/abc123token/bookmark",
            expect.objectContaining({ credentials: "include" })
        );
        expect(document.getElementById("bookmark-share-label")).toHaveTextContent("Saved");
        expect(document.getElementById("bookmark-share-count")).toHaveTextContent("8");
    });

    it("keeps bookmark toggling wired even when the discussion scaffold is absent", async () => {
        const html = buildSharedArtifactHtml(
            {
                ...basePayload,
                bookmarkCount: 7,
            } as SharedArtifactPayload,
            { showEngagementRow: true, viewer: { isAuthenticated: true } } as never
        ).replace(/<section id="comments-root">[\s\S]*?<\/section>\s*<\/article>/, "</article>");
        const fetchMock = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);

            if (url !== "/api/s/abc123token/bookmark") {
                throw new Error(`Unexpected fetch URL: ${url}`);
            }

            if (!init?.method || init.method === "GET") {
                return Promise.resolve({
                    ok: true,
                    json: async () => ({
                        isAuthenticated: true,
                        isBookmarked: false,
                        bookmarkCount: 7,
                    }),
                });
            }

            if (init.method === "POST") {
                return Promise.resolve({
                    ok: true,
                    json: async () => ({}),
                });
            }

            throw new Error(`Unexpected bookmark method: ${String(init.method)}`);
        });

        await loadSharePageScript(html, fetchMock);

        const button = document.getElementById("bookmark-share-btn") as HTMLButtonElement;

        await act(async () => {
            button.click();
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(fetchMock).toHaveBeenCalledWith(
            "/api/s/abc123token/bookmark",
            expect.objectContaining({
                method: "POST",
                credentials: "include",
            })
        );
        expect(document.getElementById("bookmark-share-label")).toHaveTextContent("Saved");
        expect(document.getElementById("bookmark-share-count")).toHaveTextContent("8");
    });

    it("shows the owner-only hint for signed-in non-owners after discussion loads", async () => {
        const html = buildSharedArtifactHtml(basePayload);
        const fetchMock = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                messages: [],
                isOwner: false,
                isAuthenticated: true,
            }),
        });

        await loadSharePageScript(html, fetchMock);

        expect(document.getElementById("disc-list")).toHaveTextContent("No notes yet.");
        expect((document.getElementById("disc-owner-only") as HTMLElement).style.display).toBe(
            ""
        );
        expect((document.getElementById("disc-signin") as HTMLElement).style.display).toBe(
            "none"
        );
    });

    it("renders owner notes with the owner's profile name, avatar, and icon instead of the Owner label", async () => {
        const html = buildSharedArtifactHtml(basePayload);
        const fetchMock = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                messages: [
                    {
                        id: "message-1",
                        authorName: "Marko Ivanovic",
                        authorAvatarUrl: "https://img.example.com/marko.png",
                        authorIsOwner: true,
                        createdAt: "2026-03-16T12:00:00.000Z",
                        content: "Checking the shared note styling.",
                        anchorStartMs: null,
                    },
                ],
                isOwner: false,
                isAuthenticated: true,
            }),
        });

        await loadSharePageScript(html, fetchMock);

        const avatar = document.querySelector(".disc-avatar") as HTMLImageElement;
        const ownerMark = document.querySelector(".disc-owner-mark") as HTMLElement;
        const author = document.querySelector(".disc-author") as HTMLElement;

        expect(author.textContent).toContain("Marko Ivanovic");
        expect(author.textContent).not.toContain("Owner");
        expect(avatar).not.toBeNull();
        expect(avatar.src).toBe("https://img.example.com/marko.png");
        expect(ownerMark).not.toBeNull();
        expect(ownerMark.getAttribute("aria-label")).toBe("Memo owner");
    });

    it("renders discussion anchors that seek the share audio directly and play it", async () => {
        const html = buildSharedArtifactHtml(basePayload);
        const fetchMock = jest.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                messages: [
                    {
                        id: "message-1",
                        authorName: "Marko Ivanovic",
                        authorAvatarUrl: "https://img.example.com/marko.png",
                        authorIsOwner: true,
                        createdAt: "2026-03-16T12:00:00.000Z",
                        content: "Check this section.",
                        anchorStartMs: 12000,
                    },
                ],
                isOwner: true,
                isAuthenticated: true,
            }),
        });

        await loadSharePageScript(html, fetchMock);

        const audio = document.querySelector("#native-audio") as HTMLAudioElement;
        const play = jest.fn().mockResolvedValue(undefined);
        Object.defineProperty(audio, "play", {
            configurable: true,
            value: play,
        });

        const anchorButton = document.querySelector(".disc-anchor") as HTMLButtonElement;
        expect(anchorButton).toHaveTextContent("0:12");

        anchorButton.click();

        expect(audio.currentTime).toBe(12);
        expect(play).toHaveBeenCalledTimes(1);
        expect((document.getElementById("disc-form") as HTMLElement).style.display).toBe("");
    });

    it("keeps the composer mounted and shows the posted note immediately after submit", async () => {
        const html = buildSharedArtifactHtml(basePayload);
        let discussionReloadRequested = false;
        let discussionGetCount = 0;
        let resolveReload: ((value: { ok: true; json: () => Promise<{
            messages: [];
            isOwner: true;
            isAuthenticated: true;
        }>; }) => void) | null = null;
        const reloadResponse = new Promise<{
            ok: true;
            json: () => Promise<{ messages: []; isOwner: true; isAuthenticated: true }>;
        }>((resolve) => {
            resolveReload = resolve;
        });
        const fetchMock = jest.fn((input: RequestInfo | URL, init?: RequestInit) => {
            const url = String(input);

            if (url !== "/api/s/abc123token/discussion") {
                throw new Error(`Unexpected fetch URL: ${url}`);
            }

            if (!init?.method || init.method === "GET") {
                discussionGetCount += 1;
                if (discussionGetCount === 1) {
                    return Promise.resolve({
                        ok: true,
                        json: async () => ({
                            messages: [],
                            isOwner: true,
                            isAuthenticated: true,
                        }),
                    });
                }

                discussionReloadRequested = true;
                return reloadResponse;
            }

            return Promise.resolve({
                ok: true,
                json: async () => ({
                    message: {
                        id: "message-1",
                        memoId: "memo-123",
                        authorName: "Marko Ivanovic",
                        authorAvatarUrl: "https://img.example.com/marko.png",
                        authorIsOwner: true,
                        content: "This should stay visible.",
                        anchorStartMs: null,
                        createdAt: "2026-03-17T10:00:00.000Z",
                    },
                }),
            });
        });

        await loadSharePageScript(html, fetchMock);

        const form = document.getElementById("disc-form") as HTMLFormElement;
        const input = document.getElementById("disc-input") as HTMLTextAreaElement;
        const submitButton = document.getElementById("disc-submit") as HTMLButtonElement;
        const discussionList = document.getElementById("disc-list") as HTMLElement;

        input.value = "This should stay visible.";

        await act(async () => {
            form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
            await Promise.resolve();
            await Promise.resolve();
        });

        expect(discussionReloadRequested).toBe(false);
        expect(form.style.display).toBe("");
        expect(submitButton.disabled).toBe(false);
        expect(discussionList).toHaveTextContent("This should stay visible.");

        resolveReload?.({
            ok: true,
            json: async () => ({
                messages: [],
                isOwner: true,
                isAuthenticated: true,
            }),
        });
    });

    it("refreshes discussion for the owner so newly posted notes appear without a full page reload", async () => {
        jest.useFakeTimers();
        const html = buildSharedArtifactHtml(basePayload);
        const discussionFetchUrl = "/api/s/abc123token/discussion";
        let discussionFetchCount = 0;
        const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
            const url = String(input);
            if (url !== discussionFetchUrl) {
                throw new Error(`Unexpected fetch URL: ${url}`);
            }

            discussionFetchCount += 1;

            return {
                ok: true,
                json: async () => ({
                    messages:
                        discussionFetchCount === 1
                            ? [
                                  {
                                      id: "message-1",
                                      authorName: "Marko Ivanovic",
                                      authorAvatarUrl: "https://img.example.com/marko.png",
                                      authorIsOwner: true,
                                      content: "First note.",
                                      anchorStartMs: null,
                                      createdAt: "2026-03-17T10:00:00.000Z",
                                  },
                              ]
                            : [
                                  {
                                      id: "message-1",
                                      authorName: "Marko Ivanovic",
                                      authorAvatarUrl: "https://img.example.com/marko.png",
                                      authorIsOwner: true,
                                      content: "First note.",
                                      anchorStartMs: null,
                                      createdAt: "2026-03-17T10:00:00.000Z",
                                  },
                                  {
                                      id: "message-2",
                                      authorName: "Taylor",
                                      authorAvatarUrl: null,
                                      authorIsOwner: false,
                                      content: "Second note without refresh.",
                                      anchorStartMs: null,
                                      createdAt: "2026-03-17T10:00:05.000Z",
                                  },
                              ],
                    isOwner: true,
                    isAuthenticated: true,
                }),
            };
        });

        try {
            await loadSharePageScript(html, fetchMock);

            expect(document.getElementById("disc-list")?.textContent).toContain("First note.");
            expect(document.getElementById("disc-list")?.textContent).not.toContain(
                "Second note without refresh."
            );

            await act(async () => {
                jest.advanceTimersByTime(3000);
                await Promise.resolve();
                await Promise.resolve();
            });

            expect(document.getElementById("disc-list")?.textContent).toContain(
                "Second note without refresh."
            );
            expect(fetchMock.mock.calls.filter(([url]) => String(url) === discussionFetchUrl)).toHaveLength(2);
        } finally {
            jest.useRealTimers();
        }
    });

    describe.skip("transcript keyword search", () => {
        it("renders search input as type=text not type=search to prevent browser clear-button from wiping the query", () => {
            const html = buildSharedArtifactHtml(basePayload);

            expect(html).toContain('type="text"');
            expect(html).not.toContain('type="search"');
        });

        it("renders all search UI controls", () => {
            const html = buildSharedArtifactHtml(basePayload);

            expect(html).toContain('id="transcript-search"');
            expect(html).toContain('id="search-match-count"');
            expect(html).toContain('id="search-prev"');
            expect(html).toContain('id="search-next"');
        });

        it("persists search query to sessionStorage so live transcript refreshes can restore it", () => {
            const html = buildSharedArtifactHtml({ ...basePayload, isLiveRecording: true });

            expect(html).toContain("sessionStorage.getItem");
            expect(html).toContain("sessionStorage.setItem");
            expect(html).toContain("sessionStorage.removeItem");
        });

        it("keeps discussion mounted while live polling refreshes transcript and discussion independently", async () => {
            jest.useFakeTimers();
            const html = buildSharedArtifactHtml({
                ...basePayload,
                isLiveRecording: true,
                transcript: "Initial live transcript.",
            });
            const discussionFetchUrl = "/api/s/abc123token/discussion";
            const transcriptFetchUrl = "https://example.com/s/abc123token.json";
            let transcriptPollCount = 0;
            const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
                const url = String(input);
                if (url === discussionFetchUrl) {
                    return {
                        ok: true,
                        json: async () => ({
                            messages: [
                                {
                                    id: "message-1",
                                    authorName: "Marko Ivanovic",
                                    authorAvatarUrl: "https://img.example.com/marko.png",
                                    authorIsOwner: true,
                                    content: "Keep this note mounted.",
                                    anchorStartMs: null,
                                    createdAt: "2026-03-17T10:00:00.000Z",
                                },
                            ],
                            isOwner: false,
                            isAuthenticated: true,
                        }),
                    };
                }

                if (url === transcriptFetchUrl) {
                    transcriptPollCount += 1;
                    return {
                        ok: true,
                        json: async () => ({
                            artifact: {
                                ...buildSharedArtifactJson(basePayload).artifact,
                                transcript:
                                    transcriptPollCount === 1
                                        ? "Updated live transcript."
                                        : "Updated live transcript.",
                                transcriptSegments: null,
                            },
                        }),
                    };
                }

                throw new Error(`Unexpected fetch URL: ${url}`);
            });

            try {
                await loadSharePageScript(html, fetchMock);

                expect(document.getElementById("transcript-content")?.textContent).toContain(
                    "Initial live transcript."
                );
                expect(document.getElementById("disc-list")?.textContent).toContain(
                    "Keep this note mounted."
                );

                await act(async () => {
                    jest.advanceTimersByTime(3000);
                    await Promise.resolve();
                    await Promise.resolve();
                });

                expect(document.getElementById("transcript-content")?.textContent).toContain(
                    "Updated live transcript."
                );
                expect(document.getElementById("disc-list")?.textContent).toContain(
                    "Keep this note mounted."
                );
                expect(fetchMock.mock.calls.filter(([url]) => String(url) === discussionFetchUrl)).toHaveLength(2);
                expect(fetchMock.mock.calls.filter(([url]) => String(url) === transcriptFetchUrl)).toHaveLength(1);
            } finally {
                jest.useRealTimers();
            }
        });

        it("does not replace the transcript while the user is selecting text from a live share", async () => {
            jest.useFakeTimers();
            const initialTranscript = "Initial live transcript with text the user is copying.";
            const updatedTranscript = "Updated live transcript that should wait until selection ends.";
            const html = buildSharedArtifactHtml({
                ...basePayload,
                isLiveRecording: true,
                transcript: initialTranscript,
            });
            const transcriptFetchUrl = "https://example.com/s/abc123token.json";
            const discussionFetchUrl = "/api/s/abc123token/discussion";
            const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
                const url = String(input);
                if (url === discussionFetchUrl) {
                    return emptyDiscussionResponse;
                }

                if (url === transcriptFetchUrl) {
                    return {
                        ok: true,
                        json: async () => ({
                            artifact: {
                                ...buildSharedArtifactJson(basePayload).artifact,
                                transcript: updatedTranscript,
                                transcriptSegments: null,
                            },
                        }),
                    };
                }

                throw new Error(`Unexpected fetch URL: ${url}`);
            });

            try {
                await loadSharePageScript(html, fetchMock);

                const transcriptBlock = document.querySelector(
                    "#transcript-content .transcript-block"
                );
                expect(transcriptBlock?.textContent).toContain(initialTranscript);

                const selection = window.getSelection();
                const range = document.createRange();
                range.selectNodeContents(transcriptBlock as Node);
                selection?.removeAllRanges();
                selection?.addRange(range);
                expect(selection?.isCollapsed).toBe(false);

                await act(async () => {
                    jest.advanceTimersByTime(3000);
                    await Promise.resolve();
                    await Promise.resolve();
                });

                expect(document.getElementById("transcript-content")?.textContent).toContain(
                    initialTranscript
                );
                expect(document.getElementById("transcript-content")?.textContent).not.toContain(
                    updatedTranscript
                );

                selection?.removeAllRanges();

                await act(async () => {
                    jest.advanceTimersByTime(3000);
                    await Promise.resolve();
                    await Promise.resolve();
                });

                expect(document.getElementById("transcript-content")?.textContent).toContain(
                    updatedTranscript
                );
            } finally {
                window.getSelection()?.removeAllRanges();
                jest.useRealTimers();
            }
        });

        it("preserves transcript scroll position when live polling updates the transcript", async () => {
            jest.useFakeTimers();
            const initialTranscript = "Initial transcript.";
            const updatedTranscript = "Updated transcript after polling.";
            const html = buildSharedArtifactHtml({
                ...basePayload,
                isLiveRecording: true,
                transcript: initialTranscript,
            });
            const transcriptFetchUrl = "https://example.com/s/abc123token.json";
            const discussionFetchUrl = "/api/s/abc123token/discussion";
            const fetchMock = jest.fn(async (input: RequestInfo | URL) => {
                const url = String(input);
                if (url === discussionFetchUrl) {
                    return emptyDiscussionResponse;
                }

                if (url === transcriptFetchUrl) {
                    return {
                        ok: true,
                        json: async () => ({
                            artifact: {
                                ...buildSharedArtifactJson(basePayload).artifact,
                                transcript: updatedTranscript,
                                transcriptSegments: null,
                            },
                        }),
                    };
                }

                throw new Error(`Unexpected fetch URL: ${url}`);
            });

            try {
                await loadSharePageScript(html, fetchMock);

                const transcriptEl = document.getElementById("transcript-content") as HTMLDivElement;
                Object.defineProperty(transcriptEl, "scrollHeight", {
                    configurable: true,
                    value: 500,
                });
                Object.defineProperty(transcriptEl, "clientHeight", {
                    configurable: true,
                    value: 200,
                });
                transcriptEl.scrollTop = 120;

                await act(async () => {
                    jest.advanceTimersByTime(3000);
                    await Promise.resolve();
                    await Promise.resolve();
                });

                expect(document.getElementById("transcript-content")?.textContent).toContain(
                    updatedTranscript
                );
                expect(
                    (document.getElementById("transcript-content") as HTMLDivElement).scrollTop
                ).toBe(120);
            } finally {
                jest.useRealTimers();
            }
        });

        it("restores saved query on page load by reading sessionStorage before attaching listeners", () => {
            const html = buildSharedArtifactHtml(basePayload);
            const script = html.slice(html.indexOf("<script>"));

            const getIdx = script.indexOf("sessionStorage.getItem");
            const inputListenerIdx = script.indexOf('addEventListener("input"');

            // getItem must appear before the input listener so the value is
            // restored on initial page load, not only after user interaction
            expect(getIdx).toBeGreaterThan(-1);
            expect(getIdx).toBeLessThan(inputListenerIdx);
        });
    });

    it("keeps the transcript container fixed-height and scrollable on overflow", () => {
        const html = buildSharedArtifactHtml({
            ...basePayload,
            transcript: "Sentence one is here. Sentence two keeps the idea moving. Sentence three starts another thought. Sentence four closes it cleanly.",
        });

        expect(html).toContain("max-height: 65vh;");
        expect(html).toContain("overflow-y: auto;");
        expect(html).toContain("overflow-wrap: anywhere;");
        expect(html).toContain('<div class="transcript-block">Sentence one is here. Sentence two keeps the idea moving. Sentence three starts another thought. Sentence four closes it cleanly.</div>');
    });

    it("wraps double newline chunks in transcript-block divs for better typography", () => {
        const html = buildSharedArtifactHtml({
            ...basePayload,
            transcript: "First paragraph here.\n\nSecond paragraph here with some whitespaces.\n  \nThird paragraph.",
        });

        expect(html).toContain('<div class="transcript-block">First paragraph here.</div>');
        expect(html).toContain('<div class="transcript-block">Second paragraph here with some whitespaces.</div>');
        expect(html).toContain('<div class="transcript-block">Third paragraph.</div>');
    });

    describe("transcriptSegments — timestamp anchors", () => {
        const segmentPayload: SharedArtifactPayload = {
            ...basePayload,
            transcriptSegments: [
                { id: "0", startMs: 0, endMs: 4500, text: "Hello world" },
                { id: "1", startMs: 4500, endMs: 12000, text: "How are you today" },
            ],
        };

        it("includes transcriptSegments array in JSON output", () => {
            const json = buildSharedArtifactJson(segmentPayload);
            expect(json.artifact.transcriptSegments).toHaveLength(2);
            expect(json.artifact.transcriptSegments![0]).toMatchObject({ id: "0", startMs: 0, endMs: 4500, text: "Hello world" });
        });

        it("includes null for transcriptSegments in JSON when not provided", () => {
            const json = buildSharedArtifactJson(basePayload);
            expect(json.artifact.transcriptSegments).toBeNull();
        });

        it("renders timestamp buttons with correct data-seek values when segments present", () => {
            const html = buildSharedArtifactHtml(segmentPayload);
            expect(html).toContain('class="ts-btn"');
            expect(html).toContain('data-seek="0"');
            expect(html).toContain('data-seek="4500"');
            // 0ms → 0:00, 4500ms → 0:04 (4 seconds)
            expect(html).toContain('>0:00<');
            expect(html).toContain('>0:04<');
        });

        it("renders each segment with an anchor id matching its startMs", () => {
            const html = buildSharedArtifactHtml(segmentPayload);
            expect(html).toContain('id="t-0"');
            expect(html).toContain('id="t-4500"');
        });

        it("omits transcript segments whose text is empty or whitespace", () => {
            const html = buildSharedArtifactHtml({
                ...segmentPayload,
                transcriptSegments: [
                    { id: "0", startMs: 0, endMs: 4500, text: "Hello world" },
                    { id: "1", startMs: 4500, endMs: 12000, text: "   " },
                    { id: "2", startMs: 12000, endMs: 18000, text: "" },
                    { id: "3", startMs: 18000, endMs: 24000, text: "How are you today" },
                ],
            });
            const parsed = new DOMParser().parseFromString(html, "text/html");
            const transcript = parsed.getElementById("transcript-content");
            const buttons = transcript?.querySelectorAll(".ts-btn");
            const segmentTexts = Array.from(transcript?.querySelectorAll(".seg-text") ?? []).map((el) =>
                el.textContent?.trim()
            );

            expect(buttons).toHaveLength(2);
            expect(transcript?.querySelector('[data-seek="4500"]')).toBeNull();
            expect(transcript?.querySelector('[data-seek="12000"]')).toBeNull();
            expect(segmentTexts).toEqual(["Hello world", "How are you today"]);
        });

        it("falls back to plain transcript-block rendering when transcriptSegments is null", () => {
            const html = buildSharedArtifactHtml({ ...basePayload, transcriptSegments: null });
            const parsed = new DOMParser().parseFromString(html, "text/html");
            const transcript = parsed.getElementById("transcript-content");
            expect(transcript?.querySelector(".transcript-block")).not.toBeNull();
            expect(transcript?.querySelector(".ts-btn")).toBeNull();
        });

        it("falls back to plain transcript-block rendering when transcriptSegments is absent", () => {
            const html = buildSharedArtifactHtml(basePayload);
            const parsed = new DOMParser().parseFromString(html, "text/html");
            const transcript = parsed.getElementById("transcript-content");
            expect(transcript?.querySelector(".transcript-block")).not.toBeNull();
            expect(transcript?.querySelector(".ts-btn")).toBeNull();
        });

        it("includes seek and timeupdate JS when segments present", () => {
            const html = buildSharedArtifactHtml(segmentPayload);
            expect(html).toContain("data-seek");
            expect(html).toContain("timeupdate");
            expect(html).toContain("audio.currentTime");
        });
    });

    describe("waveform interactions", () => {
        it("still renders the bottom waveform shell when shared audio is unavailable", () => {
            const html = buildSharedArtifactHtml({
                ...basePayload,
                mediaUrl: null,
            });
            const parsed = new DOMParser().parseFromString(html, "text/html");

            expect(parsed.querySelectorAll(".waveform-player")).toHaveLength(1);
            expect(parsed.querySelectorAll(".waveform-play-btn")).toHaveLength(1);
            expect(html).toContain('id="audio-unavailable-dialog"');
        });

        it("shows a clean popup when the viewer tries to play a share with no audio", async () => {
            const html = buildSharedArtifactHtml({
                ...basePayload,
                mediaUrl: null,
            });
            const fetchMock = jest.fn().mockResolvedValue(emptyDiscussionResponse);

            await loadSharePageScript(html, fetchMock);

            const playButton = document.querySelector(".waveform-play-btn") as HTMLButtonElement;
            const dialog = document.getElementById("audio-unavailable-dialog") as HTMLElement;

            expect(playButton).not.toBeNull();
            expect(dialog).not.toBeNull();
            expect(dialog.style.display).toBe("none");

            playButton.click();

            expect(dialog.style.display).toBe("grid");
            expect(dialog.textContent).toContain("This audio is not available.");
        });

        it("allows scrubbing the waveform to seek audio", async () => {
            const html = buildSharedArtifactHtml(basePayload);
            const fetchMock = jest.fn().mockResolvedValue(emptyDiscussionResponse);

            await loadSharePageScript(html, fetchMock);

            const waveformPlayer = document.querySelector(
                '[data-waveform-position="bottom"]'
            ) as HTMLElement;
            const audio = document.getElementById("native-audio") as HTMLAudioElement;

            Object.defineProperty(audio, "duration", {
                configurable: true,
                value: 100,
            });

            // Mock getBoundingClientRect
            waveformPlayer.getBoundingClientRect = () => ({
                left: 0,
                right: 1000,
                top: 0,
                bottom: 50,
                width: 1000,
                height: 50,
                x: 0,
                y: 0,
                toJSON: () => {}
            });

            expect(audio.currentTime).toBe(0);

            // Pointer down at 10%
            await act(async () => {
                waveformPlayer.dispatchEvent(
                    new MouseEvent("pointerdown", { bubbles: true, cancelable: true, clientX: 100 })
                );
                await Promise.resolve();
            });

            // Pointer move to 50%
            await act(async () => {
                window.dispatchEvent(
                    new MouseEvent("pointermove", { bubbles: true, cancelable: true, clientX: 500 })
                );
                await Promise.resolve();
            });

            // Expect audio currentTime to be scrubbed (50 seconds)
            expect(audio.currentTime).toBe(50);

            // Pointer up
            await act(async () => {
                window.dispatchEvent(
                    new MouseEvent("pointerup", { bubbles: true, cancelable: true })
                );
                await Promise.resolve();
            });
        });
    });
});
