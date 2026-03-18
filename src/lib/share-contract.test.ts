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

    it("renders transcript export controls in the shared html page", () => {
        const html = buildSharedArtifactHtml(basePayload);

        expect(html).toContain('id="export-transcript-btn"');
        expect(html).toContain('id="transcript-content"');
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
            transcriptFileName: "standup-notes-transcript.txt",
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

        expect(html).toContain("p.meta a {");
        expect(html).toContain("color: var(--accent);");
        expect(html).toContain(
            `<a href="${basePayload.canonicalUrl}">${basePayload.canonicalUrl}</a>`
        );
        expect(html).not.toContain(`style="color:#fdba74"`);
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
                    version: "0.1.1",
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
        expect(html).toContain('id="oc-pending"');
        expect(html).toContain('id="oc-claim-btn"');
        expect(html).toContain('id="oc-claimed"');
        expect(html).toContain('id="oc-ask-btn"');
        expect(html).toContain('id="oc-ask-dialog"');
        expect(html).toContain('id="oc-ask-submit"');
        expect(html).toContain("Send This To OpenClaw");
        expect(html).toContain("Paste this exact block into your OpenClaw chat or command window.");
    });

    it("wires the owner widget to the OpenClaw share endpoints and memo-room invocations", () => {
        const html = buildSharedArtifactHtml(basePayload);

        expect(html).toContain('fetch("/api/s/" + shareRef + "/openclaw-status"');
        expect(html).toContain('fetch("/api/s/" + shareRef + "/invite"');
        expect(html).toContain('fetch("/api/s/" + shareRef + "/claim"');
        expect(html).toContain('fetch("/api/memo-rooms/" + openClawState.roomId + "/invocations"');
        expect(html).toContain("navigator.clipboard.writeText(inviteText)");
        expect(html).toContain("openClawPreviewText.textContent = inviteText || \"\";");
        expect(html).toContain("openClawPreview.style.display = inviteText ? \"grid\" : \"none\";");
        expect(html).toContain("Copy failed here. Send the block below to OpenClaw.");
        expect(html).toContain("setInterval(function() {");
        expect(html).not.toContain('"/api/s/" + shareRef + "/handoff"');
    });

    it("uses direct audio seeking for discussion anchors and guards the owner form listener from duplicates", () => {
        const html = buildSharedArtifactHtml(basePayload);

        expect(html).toContain("audio.currentTime = +btn.dataset.t / 1000;");
        expect(html).not.toContain("seekTo(");
        expect(html).toContain("if (!form._listenerAttached)");
        expect(html).toContain("const { messages, isOwner, isAuthenticated } = await res.json();");
    });

    it("drives transcript export from the embedded boot payload", () => {
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
        expect(exportButton?.getAttribute("data-filename")).toBeNull();

        exportButton?.dispatchEvent(
            new MouseEvent("click", { bubbles: true, cancelable: true })
        );

        expect(clickedDownloads).toEqual(["standup-notes-transcript.txt"]);
        expect(createObjectURL).toHaveBeenCalledTimes(1);
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

        const audio = document.querySelector("audio.share-audio") as HTMLAudioElement;
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

    describe("transcript keyword search", () => {
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

        it("keeps discussion mounted while live polling replaces only the transcript", async () => {
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
                expect(fetchMock.mock.calls.filter(([url]) => String(url) === discussionFetchUrl)).toHaveLength(1);
                expect(fetchMock.mock.calls.filter(([url]) => String(url) === transcriptFetchUrl)).toHaveLength(1);
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

        expect(html).toContain("height: 60vh;");
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
});
