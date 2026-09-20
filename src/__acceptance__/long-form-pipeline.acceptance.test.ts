/** @jest-environment node */
/**
 * ACCEPTANCE — docs/PRODUCT-SPEC.md, "How we know it is met".
 *
 * These are not unit tests. Each `describe` below is one of the five acceptance
 * criteria in the spec, written so that it can only pass when the product does
 * the thing Marko asked for. They are deliberately written against real module
 * boundaries: only the database, the transcription engine and the clock are
 * doubled. See src/__acceptance__/README.md for the contract they assume.
 *
 * The rule these are held to, from docs/long-form-pipeline.md:
 *
 *     `done` means the transcript exists. Never an exit code, never a 200.
 *
 * So nothing here asserts on a return value, a status code, or "the job exited
 * cleanly". Every assertion reads the stored rows back and checks that the
 * transcript is there and was written after the job was claimed. The scenario
 * that matters most is the LIE: an engine that resolves successfully having
 * produced nothing. A 1h42m upload once sat on "Transcribing…" forever because
 * success was inferred from a process finishing.
 *
 * Criteria covered here: 1 (three-hour recording), 2 (worker killed mid-job),
 * 4-part-one (a webhook fires when the transcript exists), 5 (skipped, phase 3).
 * Criterion 3 lives in live-share.acceptance.test.ts and criterion 4's retry
 * behaviour in webhook-delivery.acceptance.test.ts.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import * as transcriptionQueue from "@/lib/transcription-queue";
import { MAX_AUDIO_UPLOAD_BYTES } from "@/lib/audio-limits";

// ---------------------------------------------------------------------------
// The pipeline entry point these tests require.
//
// One pass of a worker: recover jobs nothing has been heard from, claim the
// oldest pending one, run it, and write the transcript — or mark it failed.
//
// It is resolved at call time rather than imported by name, for two reasons:
// a criterion should fail with a message about the missing behaviour rather
// than a TypeScript compile error taking the whole file down with it, and the
// pipeline is being built in agent-worker/ while the app-side contract in
// src/lib/transcription-queue.ts may grow its own entry later. Whichever
// exists is used; see src/__acceptance__/README.md.
// ---------------------------------------------------------------------------

type TranscribeInput = {
    memoId: string;
    userId: string;
    audioUrl: string;
    durationSeconds: number;
    /** "still working" — so a three-hour job is not mistaken for a dead one. */
    heartbeat: () => Promise<void>;
};

type TranscribeOutput =
    | {
          transcript?: string;
          segments?: Array<{ startMs: number; endMs: number; text: string }>;
      }
    | void;

type TranscriptionWorkerDeps = {
    transcribe: (input: TranscribeInput) => Promise<TranscribeOutput>;
    now?: () => number;
    staleAfterMs?: number;
    deliverWebhook?: (event: Record<string, unknown>) => Promise<unknown>;
};

type RunTranscriptionWorker = (
    supabase: SupabaseClient,
    deps: TranscriptionWorkerDeps
) => Promise<unknown>;

type ClaimedJob = {
    id: string;
    user_id: string;
    entity_id: string;
    params?: Record<string, unknown> | null;
};

/** Stands in for the network fetch of the assembled audio object. */
const fakeAudioFetch = (async () => ({
    ok: true,
    status: 200,
    arrayBuffer: async () => new ArrayBuffer(4096),
})) as unknown as typeof fetch;

/**
 * The worker as it is actually built: drain the queue, process each claimed
 * job. Only the engine, the audio fetch and the clock are doubled — the claim,
 * the recovery, the writes and the ordering are the real code.
 */
function agentWorkerPipeline(): RunTranscriptionWorker | null {
    let queueModule: Record<string, unknown>;
    let jobModule: Record<string, unknown>;

    try {
        /* eslint-disable @typescript-eslint/no-require-imports */
        queueModule = require("../../agent-worker/src/transcribe-queue");
        jobModule = require("../../agent-worker/src/transcribe");
        /* eslint-enable @typescript-eslint/no-require-imports */
    } catch {
        return null;
    }

    const drain = queueModule.drainTranscribeQueue;
    const recover = queueModule.recoverStaleTranscribeJobs;
    const processJob = jobModule.processTranscribeJob;

    if (typeof drain !== "function" || typeof processJob !== "function") {
        return null;
    }

    return async (supabase, deps) => {
        const staleSeconds = Math.floor((deps.staleAfterMs ?? 300_000) / 1000);
        if (typeof recover === "function") {
            await (recover as (client: unknown, seconds: number) => Promise<unknown>)(
                supabase,
                staleSeconds
            );
        }

        return (
            drain as (
                client: unknown,
                options: { process?: (job: ClaimedJob) => Promise<unknown> }
            ) => Promise<unknown>
        )(supabase, {
            process: async (job: ClaimedJob) =>
                (
                    processJob as (
                        job: ClaimedJob,
                        client: unknown,
                        deps: Record<string, unknown>
                    ) => Promise<unknown>
                )(job, supabase, {
                    fetchImpl: fakeAudioFetch,
                    // No timers in a test; the engine stub beats explicitly.
                    startHeartbeat: () => () => {},
                    deliverWebhook:
                        deps.deliverWebhook ??
                        (async () => ({
                            delivered: false,
                            attempts: 0,
                            reason: "not_configured",
                        })),
                    transcribe: async () => {
                        const memoRow = await supabase
                            .from("memos")
                            .select("*")
                            .eq("id", job.entity_id)
                            .maybeSingle();
                        const memo = (memoRow.data ?? {}) as Record<string, unknown>;

                        const output = await deps.transcribe({
                            memoId: job.entity_id,
                            userId: job.user_id,
                            audioUrl: String(memo.audio_url ?? ""),
                            durationSeconds: Number(memo.duration ?? 0),
                            heartbeat: async () => {
                                await supabase.rpc("heartbeat_job_run", {
                                    p_job_id: job.id,
                                });
                            },
                        });

                        return {
                            transcript: output?.transcript ?? "",
                            segments: output?.segments ?? [],
                        };
                    },
                }),
        });
    };
}

function runTranscriptionWorker(): RunTranscriptionWorker {
    const built = agentWorkerPipeline();
    if (built) return built;

    const appSide = (transcriptionQueue as unknown as Record<string, unknown>)
        .runTranscriptionWorker;
    if (typeof appSide === "function") {
        return appSide as RunTranscriptionWorker;
    }

    throw new Error(
        "No queued transcription pipeline to run. Expected either " +
            "agent-worker/src/transcribe-queue.drainTranscribeQueue + " +
            "agent-worker/src/transcribe.processTranscribeJob, or " +
            "@/lib/transcription-queue.runTranscriptionWorker(supabase, deps). " +
            "Nothing claims a memo_transcribe job and turns it into a transcript, " +
            "so a long recording still cannot finish. " +
            "Contract: src/__acceptance__/README.md"
    );
}

// ---------------------------------------------------------------------------
// Doubles: a clock and an in-memory Supabase.
//
// The RPCs below mirror supabase/migrations/20260919120000_add_memo_transcribe_jobs.sql
// exactly — atomic claim, heartbeat, stale recovery. The SQL itself is tested by
// that migration's own test; what is under test here is the pipeline that uses it.
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;
type QueryResult = { data: unknown; error: unknown };

function createClock(startMs: number) {
    let ms = startMs;
    return {
        now: () => ms,
        nowIso: () => new Date(ms).toISOString(),
        advance: (byMs: number) => {
            ms += byMs;
        },
    };
}

type Clock = ReturnType<typeof createClock>;

/** Lets one test hold a worker mid-job while another worker runs past it. */
function deferred() {
    let resolve: () => void = () => {};
    const promise = new Promise<void>((settle) => {
        resolve = settle;
    });
    return { promise, resolve: () => resolve() };
}

function createFakeSupabase(clock: Clock) {
    const tables = new Map<string, Row[]>();
    const writes: Array<{ table: string; at: number; patch: Row }> = [];
    const rpcCalls: Array<{ name: string; args: unknown }> = [];
    let seq = 0;

    const rows = (table: string): Row[] => {
        const existing = tables.get(table);
        if (existing) return existing;
        const created: Row[] = [];
        tables.set(table, created);
        return created;
    };

    const nextId = (prefix: string) => {
        seq += 1;
        return `${prefix}-${seq}`;
    };

    const defaultsFor = (table: string): Row => {
        if (table === "job_runs") {
            return {
                id: nextId("job"),
                status: "pending",
                created_at: clock.nowIso(),
                started_at: null,
                finished_at: null,
                result: null,
                error: null,
            };
        }
        if (table === "memos") {
            return { id: nextId("memo"), created_at: clock.nowIso() };
        }
        return {};
    };

    function createQuery(table: string) {
        const filters: Array<{ col: string; value: unknown }> = [];
        let action:
            | { type: "select" }
            | { type: "insert"; rows: Row[] }
            | { type: "upsert"; rows: Row[]; onConflict: string[] }
            | { type: "update"; patch: Row }
            | { type: "delete" } = { type: "select" };
        let orderBy: { col: string; ascending: boolean } | null = null;
        let limitN: number | null = null;

        const matches = (row: Row) =>
            filters.every((filter) => row[filter.col] === filter.value);

        function run(): QueryResult {
            const table_rows = rows(table);

            if (action.type === "insert" || action.type === "upsert") {
                const written: Row[] = [];
                for (const incoming of action.rows) {
                    const conflictKeys =
                        action.type === "upsert" ? action.onConflict : [];
                    const existing =
                        conflictKeys.length > 0
                            ? table_rows.find((row) =>
                                  conflictKeys.every(
                                      (key) => row[key] === incoming[key]
                                  )
                              )
                            : undefined;

                    if (existing) {
                        Object.assign(existing, incoming);
                        written.push(existing);
                    } else {
                        const row = { ...defaultsFor(table), ...incoming };
                        table_rows.push(row);
                        written.push(row);
                    }
                    writes.push({ table, at: clock.now(), patch: { ...incoming } });
                }
                return { data: written, error: null };
            }

            if (action.type === "update") {
                const affected = table_rows.filter(matches);
                for (const row of affected) {
                    Object.assign(row, action.patch);
                    writes.push({
                        table,
                        at: clock.now(),
                        patch: { ...action.patch },
                    });
                }
                return { data: affected, error: null };
            }

            if (action.type === "delete") {
                const affected = table_rows.filter(matches);
                tables.set(
                    table,
                    table_rows.filter((row) => !matches(row))
                );
                writes.push({ table, at: clock.now(), patch: { deleted: affected.length } });
                return { data: affected, error: null };
            }

            let selected = table_rows.filter(matches);
            if (orderBy) {
                const { col, ascending } = orderBy;
                selected = [...selected].sort((a, b) => {
                    const left = String(a[col] ?? "");
                    const right = String(b[col] ?? "");
                    if (left === right) return 0;
                    return (left < right ? -1 : 1) * (ascending ? 1 : -1);
                });
            }
            if (limitN !== null) selected = selected.slice(0, limitN);
            return { data: selected, error: null };
        }

        const builder = {
            select(_columns?: string) {
                return builder;
            },
            insert(input: Row | Row[]) {
                action = {
                    type: "insert",
                    rows: Array.isArray(input) ? input : [input],
                };
                return builder;
            },
            upsert(input: Row | Row[], options?: { onConflict?: string }) {
                action = {
                    type: "upsert",
                    rows: Array.isArray(input) ? input : [input],
                    onConflict: options?.onConflict
                        ? options.onConflict.split(",").map((key) => key.trim())
                        : [],
                };
                return builder;
            },
            update(patch: Row) {
                action = { type: "update", patch };
                return builder;
            },
            delete() {
                action = { type: "delete" };
                return builder;
            },
            eq(col: string, value: unknown) {
                filters.push({ col, value });
                return builder;
            },
            order(col: string, options?: { ascending?: boolean }) {
                orderBy = { col, ascending: options?.ascending ?? true };
                return builder;
            },
            limit(count: number) {
                limitN = count;
                return builder;
            },
            async single(): Promise<QueryResult> {
                const result = run();
                const list = (result.data as Row[]) ?? [];
                if (list.length === 0) {
                    return {
                        data: null,
                        error: { code: "PGRST116", message: "no rows returned" },
                    };
                }
                return { data: list[0], error: null };
            },
            async maybeSingle(): Promise<QueryResult> {
                const result = run();
                const list = (result.data as Row[]) ?? [];
                return { data: list[0] ?? null, error: null };
            },
            then<TResult1 = QueryResult, TResult2 = never>(
                onfulfilled?:
                    | ((value: QueryResult) => TResult1 | PromiseLike<TResult1>)
                    | null,
                onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null
            ): Promise<TResult1 | TResult2> {
                return Promise.resolve(run()).then(onfulfilled, onrejected);
            },
        };

        return builder;
    }

    const rpc = async (
        name: string,
        args?: Record<string, unknown>
    ): Promise<QueryResult> => {
        rpcCalls.push({ name, args: args ?? null });
        const jobs = rows("job_runs");

        if (name === "claim_pending_transcribe_job") {
            const pending = jobs
                .filter(
                    (job) =>
                        job.job_type === transcriptionQueue.TRANSCRIBE_JOB_TYPE &&
                        job.status === "pending"
                )
                .sort((a, b) =>
                    String(a.created_at) < String(b.created_at) ? -1 : 1
                );
            const job = pending[0];
            if (!job) return { data: [], error: null };
            job.status = "running";
            job.started_at = clock.nowIso();
            return { data: [job], error: null };
        }

        if (name === "heartbeat_job_run") {
            const jobId = args?.p_job_id;
            const job = jobs.find(
                (candidate) => candidate.id === jobId && candidate.status === "running"
            );
            if (job) job.started_at = clock.nowIso();
            return { data: null, error: null };
        }

        if (name === "recover_stale_transcribe_jobs") {
            const staleSeconds = Number(args?.p_stale_seconds ?? 300);
            const cutoff = clock.now() - staleSeconds * 1000;
            const recovered = jobs.filter(
                (job) =>
                    job.job_type === transcriptionQueue.TRANSCRIBE_JOB_TYPE &&
                    job.status === "running" &&
                    typeof job.started_at === "string" &&
                    Date.parse(job.started_at) < cutoff
            );
            for (const job of recovered) {
                job.status = "pending";
                job.started_at = null;
            }
            return { data: recovered, error: null };
        }

        return {
            data: null,
            error: {
                code: "PGRST202",
                message: `Could not find the function public.${name}`,
            },
        };
    };

    const db = {
        from: (table: string) => createQuery(table),
        rpc,
        rows,
        writes,
        rpcCalls,
        seed(table: string, row: Row) {
            const stored = { ...defaultsFor(table), ...row };
            rows(table).push(stored);
            return stored;
        },
        memo(memoId: string): Row {
            const found = rows("memos").find((row) => row.id === memoId);
            if (!found) throw new Error(`no memo row ${memoId}`);
            return found;
        },
        jobsFor(memoId: string): Row[] {
            return rows("job_runs").filter((row) => row.entity_id === memoId);
        },
        writesTo(table: string) {
            return writes.filter((entry) => entry.table === table);
        },
    };

    return { ...db, client: db as unknown as SupabaseClient };
}

type FakeSupabase = ReturnType<typeof createFakeSupabase>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const THREE_HOURS_SECONDS = 3 * 60 * 60;
/** A 3h webm at a normal bitrate. The spec asks for hundreds of MB to work. */
const THREE_HOUR_BYTES = 320 * 1024 * 1024;
const MINUTE_MS = 60_000;
const USER = "user_acceptance";

/** Words at every minute, so a truncated transcript is visible as a gap. */
function threeHourTranscript(): string {
    return Array.from(
        { length: 180 },
        (_, minute) => `minute ${minute}: spoken words here.`
    ).join(" ");
}

function threeHourSegments() {
    return Array.from({ length: 180 }, (_, minute) => ({
        startMs: minute * MINUTE_MS,
        endMs: (minute + 1) * MINUTE_MS,
        text: `minute ${minute}: spoken words here.`,
    }));
}

async function seedLongRecording(db: FakeSupabase, clock: Clock) {
    const memo = db.seed("memos", {
        id: "memo-3h",
        user_id: USER,
        title: "Live recording (in progress)",
        transcript: "",
        transcript_status: "processing",
        audio_url: "https://storage.example/memo-3h.webm",
        duration: THREE_HOURS_SECONDS,
        file_size_bytes: THREE_HOUR_BYTES,
    });

    await transcriptionQueue.enqueueTranscriptionJob(
        String(memo.id),
        USER,
        db.client
    );

    const job = db.jobsFor("memo-3h")[0];
    return { memo, job, enqueuedAtMs: clock.now() };
}

// ===========================================================================
// CRITERION 1 — "A three-hour recording produces a complete transcript
// without anyone babysitting it."
// ===========================================================================

describe("Criterion 1: a three-hour recording transcribes itself", () => {
    let clock: Clock;
    let db: FakeSupabase;

    beforeEach(() => {
        clock = createClock(Date.parse("2026-09-19T10:00:00.000Z"));
        db = createFakeSupabase(clock);
    });

    it("does not run a three-hour recording inside an HTTP request", () => {
        // The 1h42m failure: transcription ran inline, so it could never finish.
        expect(
            transcriptionQueue.shouldQueueTranscription({
                durationSeconds: THREE_HOURS_SECONDS,
                fileSizeBytes: THREE_HOUR_BYTES,
            })
        ).toBe(true);
    });

    it("accepts a three-hour file at all — the upload cap admits hundreds of MB", () => {
        // Spec: "handle large files (hundreds of MB, even multiple GB) without
        // choking". A 75MB cap makes criterion 1 unreachable before any worker runs.
        expect(MAX_AUDIO_UPLOAD_BYTES).toBeGreaterThanOrEqual(THREE_HOUR_BYTES);
    });

    it("writes a complete transcript, start to end, with nobody watching", async () => {
        const run = runTranscriptionWorker();
        const { job, enqueuedAtMs } = await seedLongRecording(db, clock);

        const transcribe = jest.fn(async ({ heartbeat }: TranscribeInput) => {
            // Three hours of wall clock, reported alive throughout.
            for (let minute = 0; minute < 180; minute += 30) {
                clock.advance(30 * MINUTE_MS);
                await heartbeat();
            }
            return {
                transcript: threeHourTranscript(),
                segments: threeHourSegments(),
            };
        });

        await run(db.client, {
            transcribe,
            now: clock.now,
            staleAfterMs: 5 * 60_000,
        });

        const memo = db.memo("memo-3h");
        const transcript = String(memo.transcript ?? "");

        // done means the artifact exists.
        expect(transcript).not.toBe("");
        expect(transcript).toContain("minute 0:");
        expect(transcript).toContain("minute 90:");
        expect(transcript).toContain("minute 179:");
        expect(memo.transcript_status).toBe("complete");

        // ...and it is newer than the job that produced it.
        const transcriptWrite = db
            .writesTo("memos")
            .filter((entry) => typeof entry.patch.transcript === "string" && entry.patch.transcript !== "")
            .pop();
        expect(transcriptWrite).toBeDefined();
        expect(transcriptWrite!.at).toBeGreaterThan(enqueuedAtMs);
        expect(transcriptWrite!.at).toBeGreaterThanOrEqual(
            Date.parse(String(job.started_at ?? clock.nowIso()))
        );

        // Nobody babysat it: one worker pass, one engine call, no human step.
        expect(transcribe).toHaveBeenCalledTimes(1);
        expect(db.jobsFor("memo-3h")).toHaveLength(1);
        expect(db.jobsFor("memo-3h")[0].status).toBe("succeeded");
    });

    it("keeps the timestamps, not just a wall of text", async () => {
        // Spec B: "Receive structured data (timestamps, speaker labels if
        // available, confidence scores)". Automations need the timeline.
        const run = runTranscriptionWorker();
        await seedLongRecording(db, clock);

        await run(db.client, {
            transcribe: async () => ({
                transcript: threeHourTranscript(),
                segments: threeHourSegments(),
            }),
            now: clock.now,
        });

        const segments = db
            .rows("memo_transcript_segments")
            .filter((row) => row.memo_id === "memo-3h");
        expect(segments.length).toBeGreaterThan(1);
        expect(segments.some((row) => Number(row.end_ms) >= 179 * MINUTE_MS)).toBe(
            true
        );
    });

    // THE ONE THAT MATTERS. An engine that finishes cleanly having produced
    // nothing must not be reported as a finished transcript. This is the exact
    // shape of the 1h42m failure, and if it passes before the artifact check
    // exists then the artifact check is inert.
    it("reports failure when the engine exits cleanly having written nothing", async () => {
        const run = runTranscriptionWorker();
        await seedLongRecording(db, clock);

        const liar = jest.fn(async () => {
            clock.advance(90 * MINUTE_MS);
            return undefined; // exited 0, produced no transcript
        });

        await run(db.client, { transcribe: liar, now: clock.now });

        const memo = db.memo("memo-3h");
        expect(memo.transcript_status).not.toBe("complete");
        expect(memo.transcript_status).toBe("failed");
        expect(String(memo.transcript ?? "")).toBe("");
        expect(db.jobsFor("memo-3h")[0].status).toBe("failed");
    });

    it("reports failure when the engine returns an empty transcript", async () => {
        const run = runTranscriptionWorker();
        await seedLongRecording(db, clock);

        await run(db.client, {
            transcribe: async () => ({ transcript: "   ", segments: [] }),
            now: clock.now,
        });

        const memo = db.memo("memo-3h");
        expect(memo.transcript_status).toBe("failed");
        expect(db.jobsFor("memo-3h")[0].status).toBe("failed");
    });

    it("keeps the audio and names the failure when the engine crashes", async () => {
        const run = runTranscriptionWorker();
        await seedLongRecording(db, clock);

        await run(db.client, {
            transcribe: async () => {
                throw new Error("engine exploded at 01:42:11");
            },
            now: clock.now,
        });

        const memo = db.memo("memo-3h");
        expect(memo.transcript_status).toBe("failed");
        // The recording itself is never the casualty of a failed transcribe.
        expect(memo.audio_url).toBe("https://storage.example/memo-3h.webm");

        const job = db.jobsFor("memo-3h")[0];
        expect(job.status).toBe("failed");
        expect(String(job.error ?? "")).toContain("engine exploded");
    });

    it("leaves the job waiting, not finished, when no worker ever runs", async () => {
        const { job } = await seedLongRecording(db, clock);
        clock.advance(4 * 60 * MINUTE_MS);

        // No worker pass at all — the binary-is-missing case.
        expect(db.memo("memo-3h").transcript_status).not.toBe("complete");
        expect(String(db.memo("memo-3h").transcript ?? "")).toBe("");
        expect(db.jobsFor("memo-3h")).toHaveLength(1);
        expect(job.status).toBe("pending");
    });
});

// ===========================================================================
// CRITERION 2 — "Killing the worker mid-job loses nothing — the job is
// reclaimed."
// ===========================================================================

describe("Criterion 2: killing the worker mid-job loses nothing", () => {
    const STALE_AFTER_MS = 5 * 60_000;
    let clock: Clock;
    let db: FakeSupabase;

    beforeEach(() => {
        clock = createClock(Date.parse("2026-09-19T10:00:00.000Z"));
        db = createFakeSupabase(clock);
    });

    it("hands a killed worker's job to the next one, and the transcript still lands", async () => {
        const run = runTranscriptionWorker();
        const { job } = await seedLongRecording(db, clock);

        // Worker A claims the job the way the worker does — then is killed.
        const claimed = await db.rpc("claim_pending_transcribe_job");
        expect((claimed.data as Row[])[0].id).toBe(job.id);
        expect(job.status).toBe("running");

        // Nothing is heard from it again.
        clock.advance(STALE_AFTER_MS + 60_000);

        // Worker B starts up.
        const transcribe = jest.fn(async () => ({
            transcript: threeHourTranscript(),
            segments: threeHourSegments(),
        }));
        await run(db.client, {
            transcribe,
            now: clock.now,
            staleAfterMs: STALE_AFTER_MS,
        });

        expect(transcribe).toHaveBeenCalledTimes(1);

        const memo = db.memo("memo-3h");
        expect(String(memo.transcript ?? "")).toContain("minute 179:");
        expect(memo.transcript_status).toBe("complete");

        // Nothing duplicated, nothing orphaned: one job, one terminal state.
        const jobs = db.jobsFor("memo-3h");
        expect(jobs).toHaveLength(1);
        expect(jobs[0].status).toBe("succeeded");
    });

    it("does not steal a three-hour job that is still heartbeating", async () => {
        // The agent queue treats five minutes of running as dead. A long
        // transcribe outlives that window, so staleness has to mean "has not
        // been heard from" or worker B eats worker A's job halfway through.
        const run = runTranscriptionWorker();
        await seedLongRecording(db, clock);

        const aIsMidJob = deferred();
        const releaseA = deferred();

        const transcribeA = jest.fn(async ({ heartbeat }: TranscribeInput) => {
            clock.advance(STALE_AFTER_MS + 60_000);
            await heartbeat();
            aIsMidJob.resolve();
            await releaseA.promise;
            return { transcript: "A finished the recording", segments: [] };
        });

        const runA = run(db.client, {
            transcribe: transcribeA,
            now: clock.now,
            staleAfterMs: STALE_AFTER_MS,
        });

        await aIsMidJob.promise;

        const transcribeB = jest.fn(async () => ({
            transcript: "B should never have run",
            segments: [],
        }));
        await run(db.client, {
            transcribe: transcribeB,
            now: clock.now,
            staleAfterMs: STALE_AFTER_MS,
        });

        expect(transcribeB).not.toHaveBeenCalled();

        releaseA.resolve();
        await runA;

        expect(String(db.memo("memo-3h").transcript ?? "")).toBe(
            "A finished the recording"
        );
        expect(db.jobsFor("memo-3h")).toHaveLength(1);
    });

    it("gives one pending job to exactly one of two workers racing for it", async () => {
        const run = runTranscriptionWorker();
        await seedLongRecording(db, clock);

        const transcribe = jest.fn(async () => ({
            transcript: "transcribed once",
            segments: [],
        }));

        await Promise.all([
            run(db.client, { transcribe, now: clock.now }),
            run(db.client, { transcribe, now: clock.now }),
        ]);

        expect(transcribe).toHaveBeenCalledTimes(1);
        expect(db.jobsFor("memo-3h")).toHaveLength(1);
        expect(String(db.memo("memo-3h").transcript ?? "")).toBe("transcribed once");
    });
});

// ===========================================================================
// CRITERION 4 (part one) — "A webhook fires on completion."
// The retry-when-the-receiver-is-down half is in
// webhook-delivery.acceptance.test.ts, against the real delivery module.
// ===========================================================================

describe("Criterion 4: a webhook fires when the transcript exists", () => {
    let clock: Clock;
    let db: FakeSupabase;

    beforeEach(() => {
        clock = createClock(Date.parse("2026-09-19T10:00:00.000Z"));
        db = createFakeSupabase(clock);
    });

    it("fires transcript.ready only once the transcript is readable in the database", async () => {
        const run = runTranscriptionWorker();
        await seedLongRecording(db, clock);

        const transcriptAtFireTime: string[] = [];
        const deliverWebhook = jest.fn(async () => {
            transcriptAtFireTime.push(String(db.memo("memo-3h").transcript ?? ""));
            return { delivered: true };
        });

        await run(db.client, {
            transcribe: async () => ({
                transcript: threeHourTranscript(),
                segments: threeHourSegments(),
            }),
            now: clock.now,
            deliverWebhook,
        });

        expect(deliverWebhook).toHaveBeenCalledTimes(1);
        const event = deliverWebhook.mock.calls[0][0] as Record<string, unknown>;
        expect(event.event).toBe("transcript.ready");
        expect(event.memoId).toBe("memo-3h");
        expect(String(event.transcript ?? "")).toContain("minute 179:");

        // The event is not a promise about the future: the row was already there.
        expect(transcriptAtFireTime[0]).toContain("minute 179:");
    });

    it("fires transcript.failed, never transcript.ready, when the engine wrote nothing", async () => {
        const run = runTranscriptionWorker();
        await seedLongRecording(db, clock);

        const deliverWebhook = jest.fn(async () => ({ delivered: true }));

        await run(db.client, {
            transcribe: async () => undefined,
            now: clock.now,
            deliverWebhook,
        });

        const events = deliverWebhook.mock.calls.map(
            (call) => (call[0] as Record<string, unknown>).event
        );
        expect(events).not.toContain("transcript.ready");
        expect(events).toContain("transcript.failed");
    });

    it("does not turn a finished transcript into a failed job when the receiver is down", async () => {
        const run = runTranscriptionWorker();
        await seedLongRecording(db, clock);

        await run(db.client, {
            transcribe: async () => ({
                transcript: threeHourTranscript(),
                segments: threeHourSegments(),
            }),
            now: clock.now,
            deliverWebhook: async () => {
                throw new Error("ECONNREFUSED hooks.example.com");
            },
        });

        expect(db.memo("memo-3h").transcript_status).toBe("complete");
        expect(db.jobsFor("memo-3h")[0].status).toBe("succeeded");
    });
});

// ===========================================================================
// CRITERION 5 — "A keyword spoken at minute 90 triggers its automation before
// the recording ends."
//
// PENDING: PHASE 3 of docs/long-form-pipeline.md ("During-recording
// automations"). Nothing implements this yet, and phases 1 and 2 come first.
// The test is written out rather than left as a TODO so the shape of the thing
// is on the record: the automation must fire while the recording is still
// running, which is what makes it different from the completion webhook.
//
// Un-skip this when @/lib/transcript-automations exists. `require` is used
// inside the body so the missing module does not break this whole file today.
// ===========================================================================

describe("Criterion 5: a keyword at minute 90 fires before the recording ends", () => {
    // eslint-disable-next-line jest/no-disabled-tests
    it.skip("[PHASE 3] triggers the automation mid-recording, not at the end", async () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const automations = require("@/lib/transcript-automations") as {
            handleLiveSegment: (input: {
                memoId: string;
                segment: { startMs: number; endMs: number; text: string };
                rules: Array<{ id: string; keyword: string }>;
                dispatch: (event: Record<string, unknown>) => Promise<void>;
            }) => Promise<void>;
        };

        const clock = createClock(Date.parse("2026-09-19T10:00:00.000Z"));
        const db = createFakeSupabase(clock);
        db.seed("memos", {
            id: "memo-live",
            user_id: USER,
            transcript_status: "processing",
            audio_url: "",
        });

        const fired: Array<{ atMs: number; event: Record<string, unknown> }> = [];
        const dispatch = async (event: Record<string, unknown>) => {
            fired.push({ atMs: clock.now(), event });
        };
        const rules = [{ id: "rule-1", keyword: "action item" }];

        // Minute 89: nothing said yet.
        clock.advance(89 * MINUTE_MS);
        await automations.handleLiveSegment({
            memoId: "memo-live",
            segment: {
                startMs: 89 * MINUTE_MS,
                endMs: 90 * MINUTE_MS,
                text: "so anyway, moving on",
            },
            rules,
            dispatch,
        });
        expect(fired).toHaveLength(0);

        // Minute 90: the keyword is spoken.
        clock.advance(MINUTE_MS);
        const firedAtMs = clock.now();
        await automations.handleLiveSegment({
            memoId: "memo-live",
            segment: {
                startMs: 90 * MINUTE_MS,
                endMs: 91 * MINUTE_MS,
                text: "that is an action item for Marko",
            },
            rules,
            dispatch,
        });

        // It fired, and it fired NOW — not when the recording stopped.
        expect(fired).toHaveLength(1);
        expect(fired[0].event.event).toBe("transcript.keyword");
        expect(fired[0].event.ruleId).toBe("rule-1");
        expect(fired[0].atMs).toBe(firedAtMs);

        // The recording is still going when the automation runs.
        expect(db.memo("memo-live").transcript_status).toBe("processing");

        // And the whole recording still has 90 minutes left to run.
        clock.advance(90 * MINUTE_MS);
        expect(fired[0].atMs).toBeLessThan(clock.now());
    });
});
