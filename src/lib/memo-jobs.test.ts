/** @jest-environment node */

import { runPendingMemoJobs } from "./memo-jobs";
import { compactLiveChunks } from "@/lib/memo-chunks";
import {
    enqueueLiveSummaryJobIfNeeded,
    enqueueOutlineJobIfNeeded,
    executeFinalArtifacts,
    executeLiveSummary,
    executeOutline,
} from "@/lib/memo-artifacts";

jest.mock("@/lib/memo-chunks", () => ({
    compactLiveChunks: jest.fn(),
}));

jest.mock("@/lib/memo-artifacts", () => ({
    enqueueLiveSummaryJobIfNeeded: jest.fn(),
    enqueueOutlineJobIfNeeded: jest.fn(),
    executeLiveSummary: jest.fn(),
    executeOutline: jest.fn(),
    executeFinalArtifacts: jest.fn(),
}));

function createUpdateChain() {
    return {
        eq: jest.fn().mockResolvedValue({ data: null, error: null }),
    };
}

describe("runPendingMemoJobs", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (compactLiveChunks as jest.Mock).mockResolvedValue({
            chunkCount: 1,
            latestChunkIndex: 1,
        });
        (enqueueLiveSummaryJobIfNeeded as jest.Mock).mockResolvedValue({ enqueued: true });
        (enqueueOutlineJobIfNeeded as jest.Mock).mockResolvedValue({ enqueued: true });
        (executeLiveSummary as jest.Mock).mockResolvedValue(undefined);
        (executeOutline as jest.Mock).mockResolvedValue(undefined);
        (executeFinalArtifacts as jest.Mock).mockResolvedValue(undefined);
    });

    it("runs compact jobs and enqueues downstream live artifacts", async () => {
        const rpc = jest
            .fn()
            .mockResolvedValueOnce({
                data: {
                    id: 1,
                    user_id: "user-1",
                    entity_id: "memo-1",
                    job_type: "memo_chunk_compact_live",
                },
                error: null,
            })
            .mockResolvedValueOnce({ data: null, error: null });
        const update = jest.fn(() => createUpdateChain());
        const supabase = {
            rpc,
            from: jest.fn(() => ({ update })),
        };

        await runPendingMemoJobs("memo-1", supabase as never);

        expect(compactLiveChunks).toHaveBeenCalledWith("memo-1", "user-1", supabase);
        expect(enqueueLiveSummaryJobIfNeeded).toHaveBeenCalledWith("memo-1", "user-1", supabase);
        expect(enqueueOutlineJobIfNeeded).toHaveBeenCalledWith("memo-1", "user-1", supabase);
    });

    it("dispatches summary and final artifact jobs", async () => {
        const rpc = jest
            .fn()
            .mockResolvedValueOnce({
                data: {
                    id: 1,
                    user_id: "user-1",
                    entity_id: "memo-1",
                    job_type: "memo_summary_live",
                },
                error: null,
            })
            .mockResolvedValueOnce({
                data: {
                    id: 2,
                    user_id: "user-1",
                    entity_id: "memo-1",
                    job_type: "memo_artifact_final",
                },
                error: null,
            })
            .mockResolvedValueOnce({ data: null, error: null });
        const update = jest.fn(() => createUpdateChain());
        const supabase = {
            rpc,
            from: jest.fn(() => ({ update })),
        };

        await runPendingMemoJobs("memo-1", supabase as never);

        expect(executeLiveSummary).toHaveBeenCalledWith("memo-1", "user-1", supabase);
        expect(executeFinalArtifacts).toHaveBeenCalledWith("memo-1", "user-1", supabase);
    });

    it("marks unknown job types as failed without throwing", async () => {
        const rpc = jest
            .fn()
            .mockResolvedValueOnce({
                data: {
                    id: 3,
                    user_id: "user-1",
                    entity_id: "memo-1",
                    job_type: "unknown_job",
                },
                error: null,
            })
            .mockResolvedValueOnce({ data: null, error: null });
        const updateEq = jest.fn().mockResolvedValue({ data: null, error: null });
        const update = jest.fn(() => ({ eq: updateEq }));
        const supabase = {
            rpc,
            from: jest.fn(() => ({ update })),
        };

        await expect(runPendingMemoJobs("memo-1", supabase as never)).resolves.toBeUndefined();
        expect(update).toHaveBeenCalledWith(
            expect.objectContaining({
                status: "failed",
                error: expect.stringMatching(/unsupported memo job type/i),
            })
        );
    });

    it("marks the job failed when execution throws", async () => {
        const rpc = jest
            .fn()
            .mockResolvedValueOnce({
                data: {
                    id: 4,
                    user_id: "user-1",
                    entity_id: "memo-1",
                    job_type: "memo_outline_live",
                },
                error: null,
            })
            .mockResolvedValueOnce({ data: null, error: null });
        const update = jest.fn(() => createUpdateChain());
        const supabase = {
            rpc,
            from: jest.fn(() => ({ update })),
        };
        (executeOutline as jest.Mock).mockRejectedValueOnce(new Error("outline failed"));

        await runPendingMemoJobs("memo-1", supabase as never);

        expect(update).toHaveBeenCalledWith(
            expect.objectContaining({
                status: "failed",
                error: "outline failed",
            })
        );
    });

    it("drains all pending jobs before returning", async () => {
        const rpc = jest
            .fn()
            .mockResolvedValueOnce({
                data: {
                    id: 1,
                    user_id: "user-1",
                    entity_id: "memo-1",
                    job_type: "memo_chunk_compact_live",
                },
                error: null,
            })
            .mockResolvedValueOnce({
                data: {
                    id: 2,
                    user_id: "user-1",
                    entity_id: "memo-1",
                    job_type: "memo_summary_live",
                },
                error: null,
            })
            .mockResolvedValueOnce({
                data: {
                    id: 3,
                    user_id: "user-1",
                    entity_id: "memo-1",
                    job_type: "memo_outline_live",
                },
                error: null,
            })
            .mockResolvedValueOnce({ data: null, error: null });
        const update = jest.fn(() => createUpdateChain());
        const supabase = {
            rpc,
            from: jest.fn(() => ({ update })),
        };

        await runPendingMemoJobs("memo-1", supabase as never);

        expect(rpc).toHaveBeenCalledTimes(4);
        expect(compactLiveChunks).toHaveBeenCalledTimes(1);
        expect(executeLiveSummary).toHaveBeenCalledTimes(1);
        expect(executeOutline).toHaveBeenCalledTimes(1);
    });
});
