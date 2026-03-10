import {
    buildSharedArtifactHtml,
    buildSharedArtifactJson,
    buildSharedArtifactMarkdown,
    parseShareRef,
    resolveShareFormat,
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
    });

    it("renders transcript export controls in the shared html page", () => {
        const html = buildSharedArtifactHtml(basePayload);

        expect(html).toContain('id="export-transcript-btn"');
        expect(html).toContain('id="transcript-content"');
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
