import { createEmptyArtifactMap } from "@/lib/artifact-types";
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

describe("share-contract", () => {
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

        it("persists search query to sessionStorage so meta-refresh on live pages does not wipe it", () => {
            const html = buildSharedArtifactHtml({ ...basePayload, isLiveRecording: true });

            // Page must auto-refresh for live recordings
            expect(html).toContain('http-equiv="refresh"');

            // Search state must survive that refresh via sessionStorage
            expect(html).toContain("sessionStorage.getItem");
            expect(html).toContain("sessionStorage.setItem");
            expect(html).toContain("sessionStorage.removeItem");
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
            expect(html).toContain('class="transcript-block"');
            expect(html).not.toContain('class="ts-btn"');
        });

        it("falls back to plain transcript-block rendering when transcriptSegments is absent", () => {
            const html = buildSharedArtifactHtml(basePayload);
            expect(html).toContain('class="transcript-block"');
            expect(html).not.toContain('class="ts-btn"');
        });

        it("includes seek and timeupdate JS when segments present", () => {
            const html = buildSharedArtifactHtml(segmentPayload);
            expect(html).toContain("data-seek");
            expect(html).toContain("timeupdate");
            expect(html).toContain("audio.currentTime");
        });
    });
});
