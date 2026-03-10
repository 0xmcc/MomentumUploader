/** @jest-environment node */

import Anthropic from "@anthropic-ai/sdk";
import {
    generateLiveRollingSummary,
    generateFinalArtifacts,
} from "./memo-artifacts";

jest.mock("@anthropic-ai/sdk", () => {
    return jest.fn().mockImplementation(() => ({
        messages: {
            create: jest.fn().mockResolvedValue({
                content: [{ type: "text", text: "Concise rolling summary." }],
            }),
        },
    }));
});

type ChunkRow = {
    chunk_index: number;
    text: string;
};

function createChunkSelect(chunks: ChunkRow[]) {
    const order = jest.fn().mockResolvedValue({ data: chunks, error: null });
    const eqStatus = jest.fn(() => ({ order }));
    const eqSource = jest.fn(() => ({ eq: eqStatus }));
    const eqMemo = jest.fn(() => ({ eq: eqSource }));
    return jest.fn(() => ({ eq: eqMemo }));
}

describe("generateLiveRollingSummary", () => {
    const env = process.env;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env = { ...env, ANTHROPIC_API_KEY: "test-key" };
    });

    afterAll(() => {
        process.env = env;
    });

    it("creates the first live rolling summary from chunk 0", async () => {
        const jobInsertSelectSingle = jest.fn().mockResolvedValue({
            data: { id: 41 },
            error: null,
        });
        const jobInsertSelect = jest.fn(() => ({ single: jobInsertSelectSingle }));
        const jobInsert = jest.fn(() => ({ select: jobInsertSelect }));

        const statusUpdateEqStatus = jest.fn().mockResolvedValue({ data: null, error: null });
        const statusUpdateEqType = jest.fn(() => ({ eq: statusUpdateEqStatus }));
        const statusUpdateEqSource = jest.fn(() => ({ eq: statusUpdateEqType }));
        const statusUpdateEqMemo = jest.fn(() => ({ eq: statusUpdateEqSource }));
        const artifactUpdate = jest.fn(() => ({ eq: statusUpdateEqMemo }));

        const artifactInsert = jest.fn().mockResolvedValue({ data: null, error: null });
        const runningSingle = jest.fn().mockResolvedValue({ data: null, error: null });
        const runningEqStatus = jest.fn(() => ({ single: runningSingle }));
        const runningEqEntity = jest.fn(() => ({ eq: runningEqStatus }));
        const runningEqType = jest.fn(() => ({ eq: runningEqEntity }));
        const runningSelect = jest.fn(() => ({ eq: runningEqType }));

        const readyArtifactMaybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
        const readyArtifactEqStatus = jest.fn(() => ({ maybeSingle: readyArtifactMaybeSingle }));
        const readyArtifactEqType = jest.fn(() => ({ eq: readyArtifactEqStatus }));
        const readyArtifactEqSource = jest.fn(() => ({ eq: readyArtifactEqType }));
        const readyArtifactEqMemo = jest.fn(() => ({ eq: readyArtifactEqSource }));
        const readyArtifactSelect = jest.fn(() => ({ eq: readyArtifactEqMemo }));

        const jobUpdateEqId = jest.fn().mockResolvedValue({ data: null, error: null });
        const jobUpdate = jest.fn(() => ({ eq: jobUpdateEqId }));

        const supabase = {
            from: jest.fn((table: string) => {
                if (table === "memo_transcript_chunks") {
                    return { select: createChunkSelect([{ chunk_index: 0, text: "first chunk" }]) };
                }
                if (table === "job_runs") {
                    return {
                        select: runningSelect,
                        insert: jobInsert,
                        update: jobUpdate,
                    };
                }
                if (table === "memo_artifacts") {
                    return {
                        select: readyArtifactSelect,
                        update: artifactUpdate,
                        insert: artifactInsert,
                    };
                }
                throw new Error(`Unexpected table: ${table}`);
            }),
        };

        await generateLiveRollingSummary("memo-1", "user-1", supabase as never);

        expect(Anthropic).toHaveBeenCalled();
        expect(artifactInsert).toHaveBeenCalledWith(
            expect.objectContaining({
                memo_id: "memo-1",
                user_id: "user-1",
                source: "live",
                artifact_type: "rolling_summary",
                status: "ready",
                based_on_chunk_start: 0,
                based_on_chunk_end: 0,
                payload: expect.objectContaining({
                    summary: "Concise rolling summary.",
                    wordCount: 3,
                }),
            })
        );
    });

    it("skips regeneration when only one new chunk has arrived since the last summary", async () => {
        const runningSingle = jest.fn().mockResolvedValue({ data: null, error: null });
        const runningEqStatus = jest.fn(() => ({ single: runningSingle }));
        const runningEqEntity = jest.fn(() => ({ eq: runningEqStatus }));
        const runningEqType = jest.fn(() => ({ eq: runningEqEntity }));
        const runningSelect = jest.fn(() => ({ eq: runningEqType }));

        const readyArtifactMaybeSingle = jest.fn().mockResolvedValue({
            data: { based_on_chunk_end: 0 },
            error: null,
        });
        const readyArtifactEqStatus = jest.fn(() => ({ maybeSingle: readyArtifactMaybeSingle }));
        const readyArtifactEqType = jest.fn(() => ({ eq: readyArtifactEqStatus }));
        const readyArtifactEqSource = jest.fn(() => ({ eq: readyArtifactEqType }));
        const readyArtifactEqMemo = jest.fn(() => ({ eq: readyArtifactEqSource }));
        const readyArtifactSelect = jest.fn(() => ({ eq: readyArtifactEqMemo }));

        const artifactInsert = jest.fn();

        const supabase = {
            from: jest.fn((table: string) => {
                if (table === "memo_transcript_chunks") {
                    return {
                        select: createChunkSelect([
                            { chunk_index: 0, text: "first chunk" },
                            { chunk_index: 1, text: "second chunk" },
                        ]),
                    };
                }
                if (table === "job_runs") {
                    return {
                        select: runningSelect,
                        insert: jest.fn(),
                        update: jest.fn(),
                    };
                }
                if (table === "memo_artifacts") {
                    return {
                        select: readyArtifactSelect,
                        update: jest.fn(),
                        insert: artifactInsert,
                    };
                }
                throw new Error(`Unexpected table: ${table}`);
            }),
        };

        await generateLiveRollingSummary("memo-1", "user-1", supabase as never);

        expect(artifactInsert).not.toHaveBeenCalled();
    });

    it("skips when another live summary job is already running for the memo", async () => {
        const runningSingle = jest.fn().mockResolvedValue({
            data: { id: 99 },
            error: null,
        });
        const runningEqStatus = jest.fn(() => ({ single: runningSingle }));
        const runningEqEntity = jest.fn(() => ({ eq: runningEqStatus }));
        const runningEqType = jest.fn(() => ({ eq: runningEqEntity }));
        const runningSelect = jest.fn(() => ({ eq: runningEqType }));

        const readyArtifactMaybeSingle = jest.fn().mockResolvedValue({ data: null, error: null });
        const readyArtifactEqStatus = jest.fn(() => ({ maybeSingle: readyArtifactMaybeSingle }));
        const readyArtifactEqType = jest.fn(() => ({ eq: readyArtifactEqStatus }));
        const readyArtifactEqSource = jest.fn(() => ({ eq: readyArtifactEqType }));
        const readyArtifactEqMemo = jest.fn(() => ({ eq: readyArtifactEqSource }));
        const readyArtifactSelect = jest.fn(() => ({ eq: readyArtifactEqMemo }));

        const artifactInsert = jest.fn();

        const supabase = {
            from: jest.fn((table: string) => {
                if (table === "memo_transcript_chunks") {
                    return { select: createChunkSelect([{ chunk_index: 0, text: "first chunk" }]) };
                }
                if (table === "job_runs") {
                    return {
                        select: runningSelect,
                        insert: jest.fn(),
                        update: jest.fn(),
                    };
                }
                if (table === "memo_artifacts") {
                    return {
                        select: readyArtifactSelect,
                        update: jest.fn(),
                        insert: artifactInsert,
                    };
                }
                throw new Error(`Unexpected table: ${table}`);
            }),
        };

        await generateLiveRollingSummary("memo-1", "user-1", supabase as never);

        expect(artifactInsert).not.toHaveBeenCalled();
    });
});

describe("generateFinalArtifacts", () => {
    const env = process.env;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env = { ...env, ANTHROPIC_API_KEY: "test-key" };
    });

    afterAll(() => {
        process.env = env;
    });

    it("supersedes the current ready final summary before inserting the next ready final summary", async () => {
        const statusUpdateEqStatus = jest.fn().mockResolvedValue({ data: null, error: null });
        const statusUpdateEqType = jest.fn(() => ({ eq: statusUpdateEqStatus }));
        const statusUpdateEqSource = jest.fn(() => ({ eq: statusUpdateEqType }));
        const statusUpdateEqMemo = jest.fn(() => ({ eq: statusUpdateEqSource }));
        const artifactUpdate = jest.fn(() => ({ eq: statusUpdateEqMemo }));
        const artifactInsert = jest.fn().mockResolvedValue({ data: null, error: null });

        const supabase = {
            from: jest.fn((table: string) => {
                if (table === "memo_transcript_chunks") {
                    return { select: createChunkSelect([{ chunk_index: 0, text: "final chunk" }]) };
                }
                if (table === "memo_artifacts") {
                    return {
                        update: artifactUpdate,
                        insert: artifactInsert,
                    };
                }
                throw new Error(`Unexpected table: ${table}`);
            }),
        };

        await generateFinalArtifacts("memo-1", "user-1", supabase as never);

        expect(artifactUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                status: "superseded",
            })
        );
        expect(artifactInsert).toHaveBeenCalledWith(
            expect.objectContaining({
                memo_id: "memo-1",
                user_id: "user-1",
                source: "final",
                artifact_type: "rolling_summary",
                status: "ready",
            })
        );
    });
});
