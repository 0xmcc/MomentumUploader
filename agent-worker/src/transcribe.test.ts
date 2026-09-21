/**
 * The transcription job, tested with a stub standing in for the slow part.
 *
 * Four scenarios, and the second is the one that matters: a transcriber that
 * exits cleanly having produced nothing must FAIL the job. `done` means the
 * transcript exists — never "the call returned". If that scenario passes
 * before the artifact check exists, the check is inert.
 *
 *   a. the stub returns words          -> memo complete, transcript.ready
 *   b. the stub returns nothing        -> memo failed,  transcript.failed
 *   c. the stub throws                 -> memo failed,  transcript.failed
 *   d. no transcriber configured       -> memo failed,  transcript.failed
 *
 * Plus the two things that make it long-form: a heartbeat, so a three-hour job
 * is not mistaken for a dead one, and a killed worker leaving the row exactly
 * as it was — running, un-heartbeated, therefore reclaimable.
 *
 * No network, no NVIDIA call, no Supabase. Run with:
 *   npx tsx --test src/transcribe.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  SEGMENT_INSERT_BATCH_SIZE,
  loadRivaTranscribeAudio,
  processTranscribeJob,
  resolveTranscribeAudio,
} from "./transcribe";
import type { TranscribeJobRow } from "./transcribe";

type Call = { table: string; op: string; payload?: unknown; filters: Record<string, unknown> };

function fakeSupabase(options: {
  memo?: Record<string, unknown> | null;
  downloads?: Record<string, Buffer>;
} = {}) {
  const calls: Call[] = [];
  const rpcCalls: Array<{ fn: string; args: unknown }> = [];
  const storageOps: Array<{ op: string; arg: unknown }> = [];
  const memo =
    options.memo === undefined
      ? {
          id: "memo-1",
          user_id: "user-1",
          audio_url: null,
          transcript_status: "processing",
          duration_seconds: 6117,
        }
      : options.memo;

  function table(name: string) {
    return {
      select() {
        const filters: Record<string, unknown> = {};
        const chain = {
          eq(column: string, value: unknown) {
            filters[column] = value;
            return chain;
          },
          async maybeSingle() {
            calls.push({ table: name, op: "select", filters });
            return { data: memo, error: null };
          },
        };
        return chain;
      },
      update(payload: unknown) {
        const filters: Record<string, unknown> = {};
        const chain = {
          eq(column: string, value: unknown) {
            filters[column] = value;
            calls.push({ table: name, op: "update", payload, filters: { ...filters } });
            return Object.assign(Promise.resolve({ data: null, error: null }), chain);
          },
        };
        return chain;
      },
      delete() {
        const filters: Record<string, unknown> = {};
        const chain = {
          eq(column: string, value: unknown) {
            filters[column] = value;
            calls.push({ table: name, op: "delete", filters: { ...filters } });
            return Object.assign(Promise.resolve({ data: null, error: null }), chain);
          },
        };
        return chain;
      },
      async insert(payload: unknown) {
        calls.push({ table: name, op: "insert", payload, filters: {} });
        return { data: null, error: null };
      },
    };
  }

  const supabase = {
    from: table,
    async rpc(fn: string, args: unknown) {
      rpcCalls.push({ fn, args });
      return { data: null, error: null };
    },
    storage: {
      from() {
        return {
          async download(path: string) {
            storageOps.push({ op: "download", arg: path });
            const bytes = options.downloads?.[path];
            if (!bytes) {
              return { data: null, error: { message: `missing ${path}` } };
            }
            return {
              data: { arrayBuffer: async () => Uint8Array.from(bytes).buffer },
              error: null,
            };
          },
          async upload(path: string, body: unknown) {
            storageOps.push({ op: "upload", arg: { path, size: (body as Buffer).byteLength } });
            return { data: { path }, error: null };
          },
          getPublicUrl(path: string) {
            return { data: { publicUrl: `https://cdn.example.com/${path}` } };
          },
          async remove(paths: string[]) {
            storageOps.push({ op: "remove", arg: paths });
            return { data: null, error: null };
          },
        };
      },
    },
  };

  return { supabase: supabase as never, calls, rpcCalls, storageOps };
}

function chunkJob(): TranscribeJobRow {
  return {
    id: "job-1",
    user_id: "user-1",
    job_type: "memo_transcribe",
    entity_type: "memo",
    entity_id: "memo-1",
    status: "running",
    params: {
      chunk_paths: [
        "audio/chunks/memo-1/0000000-0000015.webm",
        "audio/chunks/memo-1/0000015-0000030.webm",
      ],
      upload_content_type: "audio/webm",
      upload_file_extension: "webm",
      duration_seconds: 6117,
    },
  };
}

function chunkBytes() {
  return {
    "audio/chunks/memo-1/0000000-0000015.webm": Buffer.from("head"),
    "audio/chunks/memo-1/0000015-0000030.webm": Buffer.from("tail"),
  };
}

function findUpdate(calls: Call[], table: string) {
  return calls.filter((call) => call.table === table && call.op === "update");
}

function collectWebhooks() {
  const sent: Array<Record<string, unknown>> = [];
  return {
    sent,
    deliver: async (event: Record<string, unknown>) => {
      sent.push(event);
      return { delivered: true, attempts: 1 };
    },
  };
}

test("a: the transcriber returns words, so the memo completes and the webhook fires", async () => {
  const db = fakeSupabase({ downloads: chunkBytes() });
  const webhook = collectWebhooks();

  const result = await processTranscribeJob(chunkJob(), db.supabase, {
    transcribe: async () => ({
      transcript: "the whole hour and forty two minutes of it",
      segments: [
        { id: "0", startMs: 0, endMs: 1200, text: "the whole hour" },
        { id: "1", startMs: 1200, endMs: 2400, text: "and forty two minutes of it" },
      ],
    }),
    deliverWebhook: webhook.deliver as never,
    startHeartbeat: () => () => {},
  });

  assert.equal(result.ok, true);

  const memoUpdates = findUpdate(db.calls, "memos");
  const completed = memoUpdates.find(
    (call) => (call.payload as Record<string, unknown>).transcript_status === "complete"
  );
  assert.ok(completed, "the memo must be marked complete");
  assert.equal(
    (completed!.payload as Record<string, string>).transcript,
    "the whole hour and forty two minutes of it"
  );

  const segmentInsert = db.calls.find(
    (call) => call.table === "memo_transcript_segments" && call.op === "insert"
  );
  assert.ok(segmentInsert, "segments must be written");
  assert.equal((segmentInsert!.payload as unknown[]).length, 2);

  const jobUpdate = findUpdate(db.calls, "job_runs").at(-1);
  assert.equal((jobUpdate!.payload as Record<string, string>).status, "succeeded");

  assert.equal(webhook.sent.length, 1);
  assert.equal(webhook.sent[0].event, "transcript.ready");
  assert.equal(webhook.sent[0].memoId, "memo-1");

  // The assembled audio is the artifact the next attempt would resume from.
  const uploaded = db.storageOps.find((op) => op.op === "upload");
  assert.ok(uploaded, "the assembled audio must be stored");
});

test("b: the transcriber exits cleanly having written nothing — the job must FAIL", async () => {
  const db = fakeSupabase({ downloads: chunkBytes() });
  const webhook = collectWebhooks();

  const result = await processTranscribeJob(chunkJob(), db.supabase, {
    // The stub that lies: a clean return, an empty transcript.
    transcribe: async () => ({ transcript: "   ", segments: [] }),
    deliverWebhook: webhook.deliver as never,
    startHeartbeat: () => () => {},
  });

  assert.equal(result.ok, false);
  assert.match(String(result.error), /no transcript/i);

  const memoUpdates = findUpdate(db.calls, "memos");
  assert.ok(
    !memoUpdates.some(
      (call) => (call.payload as Record<string, unknown>).transcript_status === "complete"
    ),
    "nothing may be marked complete when no transcript was produced"
  );
  assert.ok(
    memoUpdates.some(
      (call) => (call.payload as Record<string, unknown>).transcript_status === "failed"
    ),
    "the memo must be marked failed rather than left on Transcribing…"
  );

  const jobUpdate = findUpdate(db.calls, "job_runs").at(-1);
  assert.equal((jobUpdate!.payload as Record<string, string>).status, "failed");

  assert.equal(webhook.sent.length, 1);
  assert.equal(webhook.sent[0].event, "transcript.failed");
});

test("c: the transcriber crashes — the job fails with the reason attached", async () => {
  const db = fakeSupabase({ downloads: chunkBytes() });
  const webhook = collectWebhooks();

  const result = await processTranscribeJob(chunkJob(), db.supabase, {
    transcribe: async () => {
      throw new Error("riva channel closed");
    },
    deliverWebhook: webhook.deliver as never,
    startHeartbeat: () => () => {},
  });

  assert.equal(result.ok, false);
  assert.match(String(result.error), /riva channel closed/);

  const jobUpdate = findUpdate(db.calls, "job_runs").at(-1);
  assert.equal((jobUpdate!.payload as Record<string, string>).status, "failed");
  assert.match(String((jobUpdate!.payload as Record<string, string>).error), /riva channel closed/);
  assert.equal(webhook.sent[0].event, "transcript.failed");
});

test("d: no transcriber configured at all — a failure, not a silent success", async () => {
  const previousKey = process.env.NVIDIA_API_KEY;
  delete process.env.NVIDIA_API_KEY;

  try {
    const db = fakeSupabase({ downloads: chunkBytes() });
    const webhook = collectWebhooks();

    const result = await processTranscribeJob(chunkJob(), db.supabase, {
      // No `transcribe` dep: the worker falls back to the real one, which is
      // not configured here — the "binary is absent" case.
      deliverWebhook: webhook.deliver as never,
      startHeartbeat: () => () => {},
    });

    assert.equal(result.ok, false);
    assert.match(String(result.error), /NVIDIA_API_KEY|not configured/i);

    const jobUpdate = findUpdate(db.calls, "job_runs").at(-1);
    assert.equal((jobUpdate!.payload as Record<string, string>).status, "failed");
    assert.equal(webhook.sent[0].event, "transcript.failed");
  } finally {
    if (previousKey === undefined) {
      delete process.env.NVIDIA_API_KEY;
    } else {
      process.env.NVIDIA_API_KEY = previousKey;
    }
  }
});

test("heartbeats while it runs, and stops when it is done", async () => {
  const db = fakeSupabase({ downloads: chunkBytes() });
  let started = 0;
  let stopped = 0;

  await processTranscribeJob(chunkJob(), db.supabase, {
    transcribe: async () => ({ transcript: "words", segments: [] }),
    deliverWebhook: (async () => ({ delivered: false, attempts: 0 })) as never,
    startHeartbeat: (jobId) => {
      started += 1;
      assert.equal(jobId, "job-1");
      return () => {
        stopped += 1;
      };
    },
  });

  assert.equal(started, 1);
  assert.equal(stopped, 1);
});

test("the default heartbeat calls the RPC the migration added", async () => {
  const db = fakeSupabase({ downloads: chunkBytes() });

  await processTranscribeJob(chunkJob(), db.supabase, {
    transcribe: async () => ({ transcript: "words", segments: [] }),
    deliverWebhook: (async () => ({ delivered: false, attempts: 0 })) as never,
    heartbeatIntervalMs: 1,
    // No startHeartbeat override: exercise the real one.
  });

  assert.ok(
    db.rpcCalls.some((call) => call.fn === "heartbeat_job_run"),
    "the running job must say it is still alive"
  );
});

test("a worker killed mid-job leaves the row running and un-finished, so it is reclaimable", async () => {
  const db = fakeSupabase({ downloads: chunkBytes() });
  let heartbeatStopped = false;

  // A transcriber that never returns: the worker is killed while it waits.
  const inFlight = processTranscribeJob(chunkJob(), db.supabase, {
    transcribe: () => new Promise(() => {}),
    deliverWebhook: (async () => ({ delivered: false, attempts: 0 })) as never,
    startHeartbeat: () => () => {
      heartbeatStopped = true;
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(
    findUpdate(db.calls, "job_runs").length,
    0,
    "the job row must not be finished before the transcript exists"
  );
  assert.equal(heartbeatStopped, false);
  void inFlight;
});

test("resumes from audio a previous attempt already assembled", async () => {
  const db = fakeSupabase({
    memo: {
      id: "memo-1",
      user_id: "user-1",
      audio_url: "https://cdn.example.com/audio/already-there.webm",
      transcript_status: "processing",
    },
    downloads: chunkBytes(),
  });

  let fetched: string | null = null;
  await processTranscribeJob(chunkJob(), db.supabase, {
    transcribe: async () => ({ transcript: "words", segments: [] }),
    deliverWebhook: (async () => ({ delivered: false, attempts: 0 })) as never,
    startHeartbeat: () => () => {},
    fetchImpl: (async (url: string) => {
      fetched = url;
      return { ok: true, arrayBuffer: async () => Uint8Array.from(Buffer.from("audio")).buffer };
    }) as never,
  });

  assert.equal(fetched, "https://cdn.example.com/audio/already-there.webm");
  assert.ok(
    !db.storageOps.some((op) => op.op === "download"),
    "a second attempt must not re-download and re-concatenate every chunk"
  );
});

test("keeps the uploaded chunks when the job fails, so a retry still has the audio", async () => {
  const db = fakeSupabase({ downloads: chunkBytes() });

  await processTranscribeJob(chunkJob(), db.supabase, {
    transcribe: async () => {
      throw new Error("riva channel closed");
    },
    deliverWebhook: (async () => ({ delivered: false, attempts: 0 })) as never,
    startHeartbeat: () => () => {},
  });

  assert.ok(
    !db.storageOps.some((op) => op.op === "remove"),
    "a failed job must not destroy the only copy of the audio"
  );
});

test("removes the chunks once the transcript is safely written", async () => {
  const db = fakeSupabase({ downloads: chunkBytes() });

  await processTranscribeJob(chunkJob(), db.supabase, {
    transcribe: async () => ({ transcript: "words", segments: [] }),
    deliverWebhook: (async () => ({ delivered: false, attempts: 0 })) as never,
    startHeartbeat: () => () => {},
  });

  const removed = db.storageOps.find((op) => op.op === "remove");
  assert.ok(removed, "the chunk copies are redundant once the audio object exists");
});

test("a memo that no longer exists fails the job instead of hanging it", async () => {
  const db = fakeSupabase({ memo: null, downloads: chunkBytes() });
  const webhook = collectWebhooks();

  const result = await processTranscribeJob(chunkJob(), db.supabase, {
    transcribe: async () => ({ transcript: "words", segments: [] }),
    deliverWebhook: webhook.deliver as never,
    startHeartbeat: () => () => {},
  });

  assert.equal(result.ok, false);
  assert.match(String(result.error), /memo/i);
  const jobUpdate = findUpdate(db.calls, "job_runs").at(-1);
  assert.equal((jobUpdate!.payload as Record<string, string>).status, "failed");
});

/**
 * The real transcriber is reached by a dynamic import across the package
 * boundary, and tsx loads the app's modules as CommonJS — so the namespace
 * object carries `default.transcribeAudio`, not `transcribeAudio`. A plain
 * named destructure silently yields undefined, which would surface as
 * "transcribe is not a function" only on a real recording.
 */
test("finds transcribeAudio whichever shape the module arrives in", async () => {
  const named = { transcribeAudio: () => {} };
  const cjs = { default: { transcribeAudio: () => {} } };

  assert.equal(typeof resolveTranscribeAudio(named), "function");
  assert.equal(typeof resolveTranscribeAudio(cjs), "function");
  assert.throws(() => resolveTranscribeAudio({}), /transcribeAudio/);
});

test("the real riva module is actually reachable from the worker", async () => {
  // Loads the module only — no NVIDIA call, no network, no spend.
  const transcribeAudio = await loadRivaTranscribeAudio();
  assert.equal(typeof transcribeAudio, "function");
});

test("a receiver that is down does not undo a finished transcript", async () => {
  // The transcript exists. A webhook nobody answered is not a reason to tell
  // the user their three-hour recording failed.
  const db = fakeSupabase({ downloads: chunkBytes() });

  const result = await processTranscribeJob(chunkJob(), db.supabase, {
    transcribe: async () => ({ transcript: "words", segments: [] }),
    deliverWebhook: (async () => {
      throw new Error("ECONNREFUSED hooks.example.com");
    }) as never,
    startHeartbeat: () => () => {},
  });

  assert.equal(result.ok, true);

  const completed = findUpdate(db.calls, "memos").find(
    (call) => (call.payload as Record<string, unknown>).transcript_status === "complete"
  );
  assert.ok(completed, "the memo stays complete");

  const jobUpdate = findUpdate(db.calls, "job_runs").at(-1);
  assert.equal((jobUpdate!.payload as Record<string, string>).status, "succeeded");
});

test("a failure webhook that throws does not mask the real failure", async () => {
  const db = fakeSupabase({ downloads: chunkBytes() });

  const result = await processTranscribeJob(chunkJob(), db.supabase, {
    transcribe: async () => {
      throw new Error("riva channel closed");
    },
    deliverWebhook: (async () => {
      throw new Error("ECONNREFUSED hooks.example.com");
    }) as never,
    startHeartbeat: () => () => {},
  });

  assert.equal(result.ok, false);
  assert.match(String(result.error), /riva channel closed/);
});

/**
 * Segments from a long recording must be written in batches.
 *
 * Found by running the real thing on 2026-09-21: a 1h42m call produced 989
 * segments, the worker sent all 989 rows in ONE insert, and the request died
 * with "fetch failed". The transcript itself had already landed, so the memo
 * looked complete while its segments were empty and the job row stayed
 * `running` forever — which recovery then re-queues, re-transcribing a
 * 1h42m file on a loop and spending on every pass.
 *
 * The 15-minute recording that passed first had 138 segments, which is why no
 * earlier test caught this. Size is the variable.
 */
test("writes a long recording's segments in batches, not one giant insert", async () => {
  const segments = Array.from({ length: 989 }, (_, index) => ({
    id: String(index),
    startMs: index * 1000,
    endMs: index * 1000 + 900,
    text: `segment ${index}`,
  }));

  const db = fakeSupabase({ downloads: chunkBytes() });

  const result = await processTranscribeJob(chunkJob(), db.supabase, {
    transcribe: async () => ({
      transcript: segments.map((s) => s.text).join(" "),
      segments,
    }),
    deliverWebhook: async () => ({ ok: true }) as never,
    startHeartbeat: () => () => {},
  });

  assert.equal(result.ok, true, "a long recording must still succeed");

  const inserts = db.calls.filter(
    (call) => call.table === "memo_transcript_segments" && call.op === "insert"
  );

  assert.ok(
    inserts.length > 1,
    `989 segments must not go in a single insert; got ${inserts.length} insert(s)`
  );

  for (const insert of inserts) {
    const rows = insert.payload as unknown[];
    assert.ok(
      rows.length <= SEGMENT_INSERT_BATCH_SIZE,
      `each batch must stay small; got ${rows.length} rows in one insert`
    );
  }

  const total = inserts.reduce(
    (sum, insert) => sum + (insert.payload as unknown[]).length,
    0
  );
  assert.equal(total, 989, "every segment must still be written");
});
