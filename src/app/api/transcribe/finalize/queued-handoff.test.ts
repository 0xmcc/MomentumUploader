/** @jest-environment node */

/**
 * The seam: what finalize writes into the job, and what the worker reads out.
 *
 * Both sides are covered by their own tests, and both would still pass if the
 * two disagreed about a key name — finalize would queue happily, the worker
 * would claim the job and find no chunks, and every recording would fail at
 * the one step nothing else looks at. So this test takes the params finalize
 * actually passed and hands them to the real worker job.
 *
 * Only the transcription engine is a stub. No network, no NVIDIA, no Supabase.
 */
import { NextRequest } from "next/server";
import { POST } from "./route";
import { resolveMemoUserId } from "@/lib/memo-api-auth";
import { supabaseAdmin } from "@/lib/supabase";
import { enqueueTranscriptionJob } from "@/lib/transcription-queue";
import { persistMemoProvisional } from "../workflow";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { processTranscribeJob } = require("../../../../../agent-worker/src/transcribe");

function makeResponse(body: unknown, init?: { status?: number }) {
    return {
        status: init?.status ?? 200,
        headers: { set: jest.fn() },
        json: async () => body,
    };
}

jest.mock("next/server", () => ({
    NextRequest: jest.fn(),
    NextResponse: Object.assign(
        jest.fn().mockImplementation((_body, init) => makeResponse(null, init)),
        { json: jest.fn((body, init) => makeResponse(body, init)) }
    ),
}));

jest.mock("@/lib/memo-api-auth", () => ({ resolveMemoUserId: jest.fn() }));

jest.mock("@/lib/supabase", () => ({
    uploadAudio: jest.fn(),
    supabase: { storage: { from: jest.fn() } },
    supabaseAdmin: { storage: { from: jest.fn() } },
}));

jest.mock("@/lib/transcription-queue", () => {
    const actual = jest.requireActual("@/lib/transcription-queue");
    return { ...actual, enqueueTranscriptionJob: jest.fn() };
});

jest.mock("../workflow", () => ({
    ERR: jest.fn(),
    LOG: jest.fn(),
    persistMemoProvisional: jest.fn(),
    promoteLiveSegmentsToFinal: jest.fn(),
    transcribeUploadedAudio: jest.fn(),
    updateMemoFailed: jest.fn(),
    updateMemoFinal: jest.fn(),
}));

const CHUNKS = [
    { name: "0000000-0000015.webm", metadata: { size: 40 * 1024 * 1024 } },
    { name: "0000015-0000030.webm", metadata: { size: 40 * 1024 * 1024 } },
];

/** A Supabase double good enough for the worker's writes and downloads. */
function workerSupabase(downloaded: string[]) {
    const memoUpdates: Array<Record<string, unknown>> = [];

    const table = (name: string) => ({
        select: () => ({
            eq: function eq() {
                return this;
            },
            maybeSingle: async () => ({
                data: { id: "memo-1", user_id: "user-1", audio_url: null },
                error: null,
            }),
        }),
        update(patch: Record<string, unknown>) {
            if (name === "memos") memoUpdates.push(patch);
            const chain = {
                eq: () => Object.assign(Promise.resolve({ error: null }), chain),
            };
            return chain;
        },
        delete() {
            const chain = {
                eq: () => Object.assign(Promise.resolve({ error: null }), chain),
            };
            return chain;
        },
        insert: async () => ({ error: null }),
    });

    return {
        memoUpdates,
        client: {
            from: table,
            rpc: async () => ({ data: null, error: null }),
            storage: {
                from: () => ({
                    async download(path: string) {
                        downloaded.push(path);
                        return {
                            data: {
                                arrayBuffer: async () =>
                                    Uint8Array.from(Buffer.from("audio")).buffer,
                            },
                            error: null,
                        };
                    },
                    async upload() {
                        return { data: null, error: null };
                    },
                    getPublicUrl: (path: string) => ({
                        data: { publicUrl: `https://cdn.example.com/${path}` },
                    }),
                    async remove() {
                        return { error: null };
                    },
                }),
            },
        } as never,
    };
}

describe("finalize hands the worker something it can actually use", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (resolveMemoUserId as jest.Mock).mockResolvedValue("user-1");
        (supabaseAdmin.storage.from as jest.Mock).mockReturnValue({
            list: jest.fn().mockResolvedValue({ data: CHUNKS, error: null }),
            download: jest.fn(),
            remove: jest.fn(),
        });
        (persistMemoProvisional as jest.Mock).mockResolvedValue({
            ok: true,
            data: { memoId: "memo-1" },
        });
        (enqueueTranscriptionJob as jest.Mock).mockResolvedValue(undefined);
    });

    it("the worker finds the audio from the params finalize wrote", async () => {
        await POST({
            json: async () => ({
                memoId: "memo-1",
                totalChunks: 30,
                durationSeconds: 6117,
                uploadContentType: "audio/mpeg",
                uploadFileExtension: "mp3",
            }),
        } as unknown as NextRequest);

        const [, , , params] = (enqueueTranscriptionJob as jest.Mock).mock.calls[0];

        // Exactly the row the queue would have written, claimed by a worker.
        const job = {
            id: "job-1",
            user_id: "user-1",
            job_type: "memo_transcribe",
            entity_type: "memo",
            entity_id: "memo-1",
            status: "running",
            params,
        };

        const downloaded: string[] = [];
        const db = workerSupabase(downloaded);

        const result = await processTranscribeJob(job, db.client, {
            transcribe: async (_audio: Buffer, contentType: string) => ({
                transcript: `transcribed ${contentType}`,
                segments: [],
            }),
            deliverWebhook: async () => ({ delivered: false, attempts: 0 }),
            startHeartbeat: () => () => {},
        });

        expect(result.ok).toBe(true);
        expect(downloaded).toEqual([
            "audio/chunks/memo-1/0000000-0000015.webm",
            "audio/chunks/memo-1/0000015-0000030.webm",
        ]);

        const completed = db.memoUpdates.find(
            (patch) => patch.transcript_status === "complete"
        );
        expect(completed).toBeDefined();
        // The content type survived the handoff too — an mp3 sent as webm is
        // a transcription that fails at the engine.
        expect(completed!.transcript).toBe("transcribed audio/mpeg");
    });
});
