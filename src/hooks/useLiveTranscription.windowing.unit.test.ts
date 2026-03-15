import {
    buildFinalTailSnapshot,
    buildLiveSnapshot,
} from "./useLiveTranscription.windowing";
import { buildChunkRefs } from "./useLiveTranscription.test-helpers";

describe("useLiveTranscription windowing helpers", () => {
    it("builds a finalization snapshot using true chunk indices after pruning", () => {
        const refs = buildChunkRefs({ chunkCount: 40, startIndex: 10, pruneOffset: 10 });

        const snapshot = buildLiveSnapshot({
            chunks: refs.audioChunksRef.current,
            mimeType: refs.mimeTypeRef.current,
            header: refs.webmHeaderRef.current,
            pruneOffset: refs.chunkPruneOffsetRef.current,
            lockedSegments: [
                {
                    startIndex: 0,
                    endIndex: 15,
                    text: "locked segment alpha",
                },
            ],
            forceTailRefresh: false,
            tabVisibility: "visible",
            now: 1234,
        });

        expect(snapshot.willFinalize).toBe(true);
        expect(snapshot.requestStart).toBe(15);
        expect(snapshot.requestEnd).toBe(30);
        expect(snapshot.trueTotal).toBe(50);
        expect(snapshot.debugPatch).toMatchObject({
            windowMode: "segment_finalization",
            bufferedChunkCount: 50,
            snapshotWindowStartIndex: 15,
            snapshotWindowChunkCount: 15,
            snapshotAudioChunkCount: 15,
            snapshotBlobCount: 16,
            lastTickAt: 1234,
            overflowed: true,
            headerIncluded: true,
        });
        expect(snapshot.snapshot.size).toBe(
            new Blob(
                [
                    refs.webmHeaderRef.current as Blob,
                    ...refs.audioChunksRef.current.slice(5, 20),
                ],
                { type: refs.mimeTypeRef.current }
            ).size
        );
    });

    it("builds a tail-refresh snapshot from the remaining pruned window", () => {
        const refs = buildChunkRefs({ chunkCount: 40, startIndex: 10, pruneOffset: 10 });

        const snapshot = buildLiveSnapshot({
            chunks: refs.audioChunksRef.current,
            mimeType: refs.mimeTypeRef.current,
            header: refs.webmHeaderRef.current,
            pruneOffset: refs.chunkPruneOffsetRef.current,
            lockedSegments: [
                {
                    startIndex: 0,
                    endIndex: 15,
                    text: "locked segment alpha",
                },
                {
                    startIndex: 15,
                    endIndex: 30,
                    text: "locked segment beta",
                },
            ],
            forceTailRefresh: true,
            tabVisibility: "hidden",
            now: 5678,
        });

        expect(snapshot.willFinalize).toBe(false);
        expect(snapshot.requestStart).toBe(30);
        expect(snapshot.requestEnd).toBe(50);
        expect(snapshot.debugPatch).toMatchObject({
            windowMode: "tail_update",
            bufferedChunkCount: 50,
            snapshotWindowStartIndex: 30,
            snapshotWindowChunkCount: 20,
            snapshotAudioChunkCount: 20,
            snapshotBlobCount: 21,
            tabVisibility: "hidden",
            lastTickAt: 5678,
        });
        expect(snapshot.snapshot.size).toBe(
            new Blob(
                [
                    refs.webmHeaderRef.current as Blob,
                    ...refs.audioChunksRef.current.slice(20, 40),
                ],
                { type: refs.mimeTypeRef.current }
            ).size
        );
    });

    it("returns null when no final tail remains after the locked segments", () => {
        const refs = buildChunkRefs({ chunkCount: 20, startIndex: 10, pruneOffset: 10 });

        const snapshot = buildFinalTailSnapshot({
            chunks: refs.audioChunksRef.current,
            mimeType: refs.mimeTypeRef.current,
            header: refs.webmHeaderRef.current,
            pruneOffset: refs.chunkPruneOffsetRef.current,
            lockedSegments: [
                {
                    startIndex: 0,
                    endIndex: 30,
                    text: "locked transcript",
                },
            ],
        });

        expect(snapshot).toBeNull();
    });

    it("builds the final tail snapshot from the true tail after pruning", () => {
        const refs = buildChunkRefs({ chunkCount: 40, startIndex: 10, pruneOffset: 10 });

        const snapshot = buildFinalTailSnapshot({
            chunks: refs.audioChunksRef.current,
            mimeType: refs.mimeTypeRef.current,
            header: refs.webmHeaderRef.current,
            pruneOffset: refs.chunkPruneOffsetRef.current,
            lockedSegments: [
                {
                    startIndex: 0,
                    endIndex: 15,
                    text: "locked segment alpha",
                },
                {
                    startIndex: 15,
                    endIndex: 30,
                    text: "locked segment beta",
                },
            ],
        });

        expect(snapshot).not.toBeNull();
        expect(snapshot?.size).toBe(
            new Blob(
                [
                    refs.webmHeaderRef.current as Blob,
                    ...refs.audioChunksRef.current.slice(20),
                ],
                { type: refs.mimeTypeRef.current }
            ).size
        );
    });
});
