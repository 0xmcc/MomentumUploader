/** @jest-environment node */

import Anthropic from "@anthropic-ai/sdk";
import {
    enqueueLiveSummaryJobIfNeeded,
    enqueueOutlineJobIfNeeded,
    executeFinalArtifacts,
    executeLiveSummary,
    executeOutline,
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
    user_id?: string;
    chunk_index: number;
    start_ms?: number;
    end_ms?: number;
    text: string;
};

function createAwaitableUpdate(error: unknown = null) {
    const query: {
        eq: jest.Mock;
        then: PromiseLike<{ error: unknown }>["then"];
    } = {
        eq: jest.fn(() => query),
        then: (onfulfilled) => Promise.resolve({ error }).then(onfulfilled),
    };

    return query;
}

function createChunkSelect(chunks: ChunkRow[]) {
    const order = jest.fn().mockResolvedValue({
        data: chunks.map((chunk) => ({
            user_id: chunk.user_id ?? "user-1",
            start_ms: chunk.start_ms ?? chunk.chunk_index * 1000,
            end_ms: chunk.end_ms ?? (chunk.chunk_index + 1) * 1000,
            ...chunk,
        })),
        error: null,
    });
    const eqStatus = jest.fn(() => ({ order }));
    const eqSource = jest.fn(() => ({ eq: eqStatus }));
    const eqMemo = jest.fn(() => ({ eq: eqSource }));
    return jest.fn(() => ({ eq: eqMemo }));
}

function createLatestArtifactSelect(data: { based_on_chunk_end?: number | null } | null) {
    const maybeSingle = jest.fn().mockResolvedValue({ data, error: null });
    const eqStatus = jest.fn(() => ({ maybeSingle }));
    const eqType = jest.fn(() => ({ eq: eqStatus }));
    const eqSource = jest.fn(() => ({ eq: eqType }));
    const eqMemo = jest.fn(() => ({ eq: eqSource }));
    return jest.fn(() => ({ eq: eqMemo }));
}

describe("memo-artifacts", () => {
    const env = process.env;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env = { ...env, ANTHROPIC_API_KEY: "test-key" };
    });

    afterAll(() => {
        process.env = env;
    });

    describe("enqueueLiveSummaryJobIfNeeded", () => {
        it("returns no_chunks when no ready chunks exist", async () => {
            const jobInsert = jest.fn();
            const supabase = {
                from: jest.fn((table: string) => {
                    if (table === "memo_transcript_chunks") {
                        return { select: createChunkSelect([]) };
                    }
                    if (table === "job_runs") {
                        return { insert: jobInsert };
                    }
                    if (table === "memo_artifacts") {
                        return { select: createLatestArtifactSelect(null) };
                    }
                    throw new Error(`Unexpected table: ${table}`);
                }),
            };

            await expect(
                enqueueLiveSummaryJobIfNeeded("memo-1", "user-1", supabase as never)
            ).resolves.toEqual({ enqueued: false, reason: "no_chunks" });
            expect(jobInsert).not.toHaveBeenCalled();
        });

        it("returns threshold when fewer than two new chunks exist", async () => {
            const jobInsert = jest.fn();
            const supabase = {
                from: jest.fn((table: string) => {
                    if (table === "memo_transcript_chunks") {
                        return {
                            select: createChunkSelect([
                                { chunk_index: 0, text: "first" },
                                { chunk_index: 1, text: "second" },
                            ]),
                        };
                    }
                    if (table === "memo_artifacts") {
                        return { select: createLatestArtifactSelect({ based_on_chunk_end: 0 }) };
                    }
                    if (table === "job_runs") {
                        return { insert: jobInsert };
                    }
                    throw new Error(`Unexpected table: ${table}`);
                }),
            };

            await expect(
                enqueueLiveSummaryJobIfNeeded("memo-1", "user-1", supabase as never)
            ).resolves.toEqual({ enqueued: false, reason: "threshold" });
            expect(jobInsert).not.toHaveBeenCalled();
        });

        it("enqueues a pending summary job when two or more new chunks exist", async () => {
            const jobInsert = jest.fn().mockResolvedValue({ data: null, error: null });
            const supabase = {
                from: jest.fn((table: string) => {
                    if (table === "memo_transcript_chunks") {
                        return {
                            select: createChunkSelect([
                                { chunk_index: 0, text: "first" },
                                { chunk_index: 1, text: "second" },
                            ]),
                        };
                    }
                    if (table === "memo_artifacts") {
                        return { select: createLatestArtifactSelect(null) };
                    }
                    if (table === "job_runs") {
                        return { insert: jobInsert };
                    }
                    throw new Error(`Unexpected table: ${table}`);
                }),
            };

            await expect(
                enqueueLiveSummaryJobIfNeeded("memo-1", "user-1", supabase as never)
            ).resolves.toEqual({ enqueued: true });
            expect(jobInsert).toHaveBeenCalledWith({
                user_id: "user-1",
                job_type: "memo_summary_live",
                entity_type: "memo",
                entity_id: "memo-1",
                status: "pending",
            });
        });

        it("propagates duplicate enqueue errors from the database", async () => {
            const duplicateError = { code: "23505", message: "duplicate key" };
            const jobInsert = jest.fn().mockResolvedValue({ data: null, error: duplicateError });
            const supabase = {
                from: jest.fn((table: string) => {
                    if (table === "memo_transcript_chunks") {
                        return {
                            select: createChunkSelect([
                                { chunk_index: 0, text: "first" },
                                { chunk_index: 1, text: "second" },
                            ]),
                        };
                    }
                    if (table === "memo_artifacts") {
                        return { select: createLatestArtifactSelect(null) };
                    }
                    if (table === "job_runs") {
                        return { insert: jobInsert };
                    }
                    throw new Error(`Unexpected table: ${table}`);
                }),
            };

            await expect(
                enqueueLiveSummaryJobIfNeeded("memo-1", "user-1", supabase as never)
            ).rejects.toEqual(duplicateError);
        });
    });

    describe("executeLiveSummary", () => {
        it("supersedes the previous summary and inserts a new ready artifact", async () => {
            const artifactUpdate = jest.fn(() => createAwaitableUpdate());
            const artifactInsert = jest.fn().mockResolvedValue({ data: null, error: null });
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
                    if (table === "memo_artifacts") {
                        return { update: artifactUpdate, insert: artifactInsert };
                    }
                    throw new Error(`Unexpected table: ${table}`);
                }),
            };

            await executeLiveSummary("memo-1", "user-1", supabase as never);

            expect(Anthropic).toHaveBeenCalled();
            expect(artifactInsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    memo_id: "memo-1",
                    user_id: "user-1",
                    source: "live",
                    artifact_type: "rolling_summary",
                    based_on_chunk_start: 0,
                    based_on_chunk_end: 1,
                    payload: expect.objectContaining({
                        summary: "Concise rolling summary.",
                    }),
                })
            );
        });

        it("falls back to deterministic summary text when the API key is missing", async () => {
            process.env = { ...env };
            delete process.env.ANTHROPIC_API_KEY;
            const artifactUpdate = jest.fn(() => createAwaitableUpdate());
            const artifactInsert = jest.fn().mockResolvedValue({ data: null, error: null });
            const supabase = {
                from: jest.fn((table: string) => {
                    if (table === "memo_transcript_chunks") {
                        return {
                            select: createChunkSelect([
                                {
                                    chunk_index: 0,
                                    text: "First sentence. Second sentence. Third sentence.",
                                },
                            ]),
                        };
                    }
                    if (table === "memo_artifacts") {
                        return { update: artifactUpdate, insert: artifactInsert };
                    }
                    throw new Error(`Unexpected table: ${table}`);
                }),
            };

            await executeLiveSummary("memo-1", "user-1", supabase as never);

            expect(Anthropic).not.toHaveBeenCalled();
            expect(artifactInsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    payload: expect.objectContaining({
                        summary: "First sentence. Second sentence.",
                    }),
                })
            );
        });

        it("throws when the summary supersede succeeds but insert fails", async () => {
            const insertError = new Error("insert failed");
            const artifactUpdate = jest.fn(() => createAwaitableUpdate());
            const artifactInsert = jest.fn().mockResolvedValue({ data: null, error: insertError });
            const supabase = {
                from: jest.fn((table: string) => {
                    if (table === "memo_transcript_chunks") {
                        return {
                            select: createChunkSelect([
                                { chunk_index: 0, text: "first" },
                                { chunk_index: 1, text: "second" },
                            ]),
                        };
                    }
                    if (table === "memo_artifacts") {
                        return { update: artifactUpdate, insert: artifactInsert };
                    }
                    throw new Error(`Unexpected table: ${table}`);
                }),
            };

            await expect(
                executeLiveSummary("memo-1", "user-1", supabase as never)
            ).rejects.toBe(insertError);
        });
    });

    describe("executeFinalArtifacts", () => {
        it("supersedes all live artifacts and inserts final summary plus outline", async () => {
            const artifactUpdate = jest.fn(() => createAwaitableUpdate());
            const artifactInsert = jest
                .fn()
                .mockResolvedValueOnce({ data: null, error: null })
                .mockResolvedValueOnce({ data: null, error: null });
            const createMessage = jest
                .fn()
                .mockResolvedValueOnce({
                    content: [{ type: "text", text: "Concise rolling summary." }],
                })
                .mockResolvedValueOnce({
                    content: [
                        {
                            type: "text",
                            text: JSON.stringify({
                                items: [
                                    {
                                        chunkStart: 0,
                                        chunkEnd: 1,
                                        title: "Opening",
                                        summary: "The memo sets context.",
                                    },
                                ],
                            }),
                        },
                    ],
                });
            (Anthropic as unknown as jest.Mock).mockImplementation(() => ({
                messages: {
                    create: createMessage,
                },
            }));

            const supabase = {
                from: jest.fn((table: string) => {
                    if (table === "memo_transcript_chunks") {
                        return {
                            select: createChunkSelect([
                                { chunk_index: 0, text: "first", start_ms: 0, end_ms: 1000 },
                                { chunk_index: 1, text: "second", start_ms: 1000, end_ms: 2000 },
                            ]),
                        };
                    }
                    if (table === "memo_artifacts") {
                        return { update: artifactUpdate, insert: artifactInsert };
                    }
                    throw new Error(`Unexpected table: ${table}`);
                }),
            };

            await executeFinalArtifacts("memo-1", "user-1", supabase as never);

            expect(artifactInsert).toHaveBeenNthCalledWith(
                1,
                expect.objectContaining({
                    source: "final",
                    artifact_type: "rolling_summary",
                })
            );
            expect(artifactInsert).toHaveBeenNthCalledWith(
                2,
                expect.objectContaining({
                    source: "final",
                    artifact_type: "outline",
                    payload: {
                        items: [
                            expect.objectContaining({
                                startMs: 0,
                                endMs: 2000,
                                chunkStart: 0,
                                chunkEnd: 1,
                            }),
                        ],
                    },
                })
            );
        });

        it("returns early when no final chunks exist", async () => {
            const artifactUpdate = jest.fn();
            const artifactInsert = jest.fn();
            const supabase = {
                from: jest.fn((table: string) => {
                    if (table === "memo_transcript_chunks") {
                        return { select: createChunkSelect([]) };
                    }
                    if (table === "memo_artifacts") {
                        return { update: artifactUpdate, insert: artifactInsert };
                    }
                    throw new Error(`Unexpected table: ${table}`);
                }),
            };

            await executeFinalArtifacts("memo-1", "user-1", supabase as never);

            expect(artifactUpdate).not.toHaveBeenCalled();
            expect(artifactInsert).not.toHaveBeenCalled();
        });
    });

    describe("enqueueOutlineJobIfNeeded", () => {
        it("enqueues a pending outline job when threshold is met", async () => {
            const jobInsert = jest.fn().mockResolvedValue({ data: null, error: null });
            const supabase = {
                from: jest.fn((table: string) => {
                    if (table === "memo_transcript_chunks") {
                        return {
                            select: createChunkSelect([
                                { chunk_index: 0, text: "first" },
                                { chunk_index: 1, text: "second" },
                            ]),
                        };
                    }
                    if (table === "memo_artifacts") {
                        return { select: createLatestArtifactSelect(null) };
                    }
                    if (table === "job_runs") {
                        return { insert: jobInsert };
                    }
                    throw new Error(`Unexpected table: ${table}`);
                }),
            };

            await expect(
                enqueueOutlineJobIfNeeded("memo-1", "user-1", supabase as never)
            ).resolves.toEqual({ enqueued: true });
            expect(jobInsert).toHaveBeenCalledWith({
                user_id: "user-1",
                job_type: "memo_outline_live",
                entity_type: "memo",
                entity_id: "memo-1",
                status: "pending",
            });
        });
    });

    describe("executeOutline", () => {
        it("inserts an outline artifact with timestamps derived from chunk timing", async () => {
            const artifactUpdate = jest.fn(() => createAwaitableUpdate());
            const artifactInsert = jest.fn().mockResolvedValue({ data: null, error: null });
            (Anthropic as unknown as jest.Mock).mockImplementation(() => ({
                messages: {
                    create: jest.fn().mockResolvedValue({
                        content: [
                            {
                                type: "text",
                                text: JSON.stringify({
                                    items: [
                                        {
                                            chunkStart: 0,
                                            chunkEnd: 1,
                                            title: "Opening",
                                            summary: "Covers the first two chunks.",
                                        },
                                    ],
                                }),
                            },
                        ],
                    }),
                },
            }));

            const supabase = {
                from: jest.fn((table: string) => {
                    if (table === "memo_transcript_chunks") {
                        return {
                            select: createChunkSelect([
                                { chunk_index: 0, text: "first", start_ms: 0, end_ms: 1000 },
                                { chunk_index: 1, text: "second", start_ms: 1000, end_ms: 2200 },
                            ]),
                        };
                    }
                    if (table === "memo_artifacts") {
                        return { update: artifactUpdate, insert: artifactInsert };
                    }
                    throw new Error(`Unexpected table: ${table}`);
                }),
            };

            await executeOutline("memo-1", "live", supabase as never);

            expect(artifactInsert).toHaveBeenCalledWith(
                expect.objectContaining({
                    artifact_type: "outline",
                    payload: {
                        items: [
                            {
                                chunkStart: 0,
                                chunkEnd: 1,
                                title: "Opening",
                                summary: "Covers the first two chunks.",
                                startMs: 0,
                                endMs: 2200,
                            },
                        ],
                    },
                })
            );
        });

        it("fails fast when the model returns overlapping ranges", async () => {
            const artifactUpdate = jest.fn(() => createAwaitableUpdate());
            const artifactInsert = jest.fn().mockResolvedValue({ data: null, error: null });
            (Anthropic as unknown as jest.Mock).mockImplementation(() => ({
                messages: {
                    create: jest.fn().mockResolvedValue({
                        content: [
                            {
                                type: "text",
                                text: JSON.stringify({
                                    items: [
                                        {
                                            chunkStart: 0,
                                            chunkEnd: 1,
                                            title: "One",
                                            summary: "First section",
                                        },
                                        {
                                            chunkStart: 1,
                                            chunkEnd: 2,
                                            title: "Two",
                                            summary: "Second section",
                                        },
                                    ],
                                }),
                            },
                        ],
                    }),
                },
            }));

            const supabase = {
                from: jest.fn((table: string) => {
                    if (table === "memo_transcript_chunks") {
                        return {
                            select: createChunkSelect([
                                { chunk_index: 0, text: "first" },
                                { chunk_index: 1, text: "second" },
                                { chunk_index: 2, text: "third" },
                            ]),
                        };
                    }
                    if (table === "memo_artifacts") {
                        return { update: artifactUpdate, insert: artifactInsert };
                    }
                    throw new Error(`Unexpected table: ${table}`);
                }),
            };

            await expect(
                executeOutline("memo-1", "live", supabase as never)
            ).rejects.toThrow(/must not overlap/i);
            expect(artifactInsert).not.toHaveBeenCalled();
        });
    });
});
