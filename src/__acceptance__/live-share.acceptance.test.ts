/** @jest-environment node */
/**
 * ACCEPTANCE — docs/PRODUCT-SPEC.md criterion 3:
 *
 *     "A second person opens the share URL mid-recording and sees words appear."
 *
 * Two separate claims, and both have to hold:
 *
 *   1. Mid-recording, the share URL already carries the words spoken so far.
 *      Not "the page exists", not "it says a recording is in progress" — the
 *      actual words.
 *   2. They keep arriving. A viewer who looks again a few seconds later has
 *      more than they had before.
 *
 * This runs through the real `resolveMemoShare`, which is what the public
 * share route serves from. Only the database and Clerk are doubled: there is
 * no HTTP, no browser and no network here.
 *
 * Spec B puts a number on the lag: "Multiple viewers should be able to follow
 * along with minimal lag (ideally under 1-2 seconds)". The last test in this
 * file reads the poll interval out of the page the viewer is actually served,
 * because a 3-second poll cannot deliver a 1-2 second lag however good the
 * data behind it is.
 */
import { resolveMemoShare } from "@/lib/memo-share";
import {
    buildSharePageViewModel,
    buildSharedArtifactHtml,
} from "@/lib/share-contract";
import { supabaseAdmin } from "@/lib/supabase";
import { LIVE_MEMO_TITLE } from "@/lib/live-memo";
import { createEmptyArtifactMap } from "@/lib/artifact-types";

jest.mock("@/lib/supabase", () => ({
    supabaseAdmin: { from: jest.fn() },
}));

jest.mock("@/lib/user-identity", () => ({
    resolveOwnerIdentity: jest.fn().mockResolvedValue({
        displayName: "Marko",
        avatarUrl: null,
    }),
}));

const SHARE_TOKEN = "live-share-token-123";
const MEMO_ID = "memo-live-1";

type SegmentRow = {
    segment_index: number;
    start_ms: number;
    end_ms: number;
    text: string;
    source: "live" | "final";
};

/**
 * The rows as they exist WHILE a recording is running:
 *  - the memo row was created up front by POST /api/memos/live, so its
 *    transcript column is still empty and its status is "processing";
 *  - the locked live segments land in memo_transcript_segments with
 *    source = "live" as the recorder produces them.
 */
function recordingInProgress() {
    const segments: SegmentRow[] = [];

    const memoRow: Record<string, unknown> = {
        id: MEMO_ID,
        user_id: "user_acceptance",
        title: LIVE_MEMO_TITLE,
        transcript: "",
        transcript_status: "processing",
        audio_url: "",
        duration: null,
        created_at: "2026-09-19T10:00:00.000Z",
        share_token: SHARE_TOKEN,
        shared_at: "2026-09-19T10:00:05.000Z",
        share_expires_at: null,
        expires_at: null,
        revoked_at: null,
        is_shareable: true,
    };

    function speak(text: string) {
        const index = segments.length;
        segments.push({
            segment_index: index,
            start_ms: index * 15_000,
            end_ms: (index + 1) * 15_000,
            text,
            source: "live",
        });
    }

    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
        if (table === "memos") {
            return {
                select: () => ({
                    eq: (_column: string, value: unknown) => ({
                        maybeSingle: async () => ({
                            data: value === SHARE_TOKEN ? memoRow : null,
                            error: null,
                        }),
                    }),
                }),
            };
        }

        if (table === "memo_transcript_segments") {
            const filters: Record<string, unknown> = {};
            const query = {
                select: () => query,
                eq: (column: string, value: unknown) => {
                    filters[column] = value;
                    return query;
                },
                order: async () => ({
                    data: segments.filter((segment) =>
                        Object.entries(filters).every(([column, value]) => {
                            if (column === "memo_id") return value === MEMO_ID;
                            if (column === "source") return segment.source === value;
                            return true;
                        })
                    ),
                    error: null,
                }),
            };
            return query;
        }

        throw new Error(`unexpected table ${table}`);
    });

    return { memoRow, segments, speak };
}

function wordsVisibleTo(memo: {
    transcript: string;
    transcriptSegments: Array<{ text: string }> | null;
}): string {
    const fromSegments = (memo.transcriptSegments ?? [])
        .map((segment) => segment.text)
        .join(" ");
    return `${memo.transcript} ${fromSegments}`.trim();
}

describe("Criterion 3: a second person opens the share URL mid-recording", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("sees the words spoken so far, while the recording is still running", async () => {
        const recording = recordingInProgress();
        recording.speak("welcome everyone, thanks for joining");
        recording.speak("first item is the pipeline rewrite");

        const state = await resolveMemoShare(SHARE_TOKEN);
        expect(state.status).toBe("ok");
        if (state.status !== "ok") return;

        expect(state.memo.isLiveRecording).toBe(true);

        const visible = wordsVisibleTo(state.memo);
        expect(visible).toContain("welcome everyone");
        expect(visible).toContain("pipeline rewrite");
    });

    it("sees new words appear when they look again", async () => {
        const recording = recordingInProgress();
        recording.speak("welcome everyone, thanks for joining");

        const first = await resolveMemoShare(SHARE_TOKEN);
        expect(first.status).toBe("ok");
        if (first.status !== "ok") return;
        const before = wordsVisibleTo(first.memo);

        // The recording carries on.
        recording.speak("second item, the keyword automations");

        const second = await resolveMemoShare(SHARE_TOKEN);
        expect(second.status).toBe("ok");
        if (second.status !== "ok") return;
        const after = wordsVisibleTo(second.memo);

        expect(after).toContain("keyword automations");
        expect(after.length).toBeGreaterThan(before.length);
    });

    it("does not make the viewer wait for the recording to stop", async () => {
        // The failure this guards: a share page that is technically live but
        // shows nothing until finalize writes memos.transcript at the end.
        const recording = recordingInProgress();
        recording.speak("this sentence was spoken at minute three");

        const state = await resolveMemoShare(SHARE_TOKEN);
        expect(state.status).toBe("ok");
        if (state.status !== "ok") return;

        expect(state.memo.transcriptStatus).toBe("processing");
        expect(wordsVisibleTo(state.memo)).not.toBe("");
    });

    it("refreshes inside the 1-2 second lag the spec asks for", async () => {
        const recording = recordingInProgress();
        recording.speak("live words");

        const state = await resolveMemoShare(SHARE_TOKEN);
        expect(state.status).toBe("ok");
        if (state.status !== "ok") return;

        const payload = buildSharePageViewModel(
            state.memo,
            `https://momentum.example/s/${SHARE_TOKEN}`,
            createEmptyArtifactMap()
        );
        const html = buildSharedArtifactHtml(payload);
        const intervals = [...html.matchAll(/setInterval\([\s\S]{0,400}?,\s*(\d{3,6})\s*\)/g)]
            .map((match) => Number(match[1]))
            .filter((ms) => Number.isFinite(ms));

        expect(intervals.length).toBeGreaterThan(0);
        // Spec B: "minimal lag (ideally under 1-2 seconds)".
        expect(Math.min(...intervals)).toBeLessThanOrEqual(2000);
    });
});
