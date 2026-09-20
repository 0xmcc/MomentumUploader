/**
 * Claiming and reclaiming transcription jobs.
 *
 * The queue half of the pipeline: take one job atomically, keep taking until
 * there are none, and put back the ones whose worker died. The job itself is
 * tested in transcribe.test.ts; this is only the plumbing around it, which is
 * where "the job was claimed and then silently lost" lives.
 *
 * Run with: npx tsx --test src/transcribe-queue.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  claimPendingTranscribeJob,
  drainTranscribeQueue,
  recoverStaleTranscribeJobs,
} from "./transcribe-queue";

function fakeRpc(responses: Record<string, Array<{ data: unknown; error?: unknown }>>) {
  const calls: Array<{ fn: string; args: unknown }> = [];
  const client = {
    async rpc(fn: string, args?: unknown) {
      calls.push({ fn, args });
      const queue = responses[fn] ?? [];
      const next = queue.shift() ?? { data: null };
      return { data: next.data, error: next.error ?? null };
    },
  };
  return { client: client as never, calls };
}

test("claims one job, unwrapping the single row Postgres returns as a set", async () => {
  const { client } = fakeRpc({
    claim_pending_transcribe_job: [{ data: [{ id: "job-1", entity_id: "memo-1" }] }],
  });

  const job = await claimPendingTranscribeJob(client);

  assert.equal(job?.id, "job-1");
});

test("returns null when there is nothing pending", async () => {
  const { client } = fakeRpc({ claim_pending_transcribe_job: [{ data: [] }] });

  assert.equal(await claimPendingTranscribeJob(client), null);
});

test("throws when the claim itself fails, rather than looking like an empty queue", async () => {
  const { client } = fakeRpc({
    claim_pending_transcribe_job: [{ data: null, error: { message: "no such function" } }],
  });

  await assert.rejects(() => claimPendingTranscribeJob(client), /no such function/);
});

test("reclaims jobs whose worker went quiet, and says how many", async () => {
  const { client, calls } = fakeRpc({
    recover_stale_transcribe_jobs: [{ data: [{ id: "job-7" }, { id: "job-8" }] }],
  });

  const reclaimed = await recoverStaleTranscribeJobs(client, 300);

  assert.equal(reclaimed, 2);
  assert.deepEqual(calls[0], {
    fn: "recover_stale_transcribe_jobs",
    args: { p_stale_seconds: 300 },
  });
});

test("drains until the queue is empty", async () => {
  const { client } = fakeRpc({
    claim_pending_transcribe_job: [
      { data: [{ id: "job-1", entity_id: "memo-1" }] },
      { data: [{ id: "job-2", entity_id: "memo-2" }] },
      { data: [] },
    ],
  });

  const processed: string[] = [];
  await drainTranscribeQueue(client, {
    process: async (job) => {
      processed.push(job.id);
    },
  });

  assert.deepEqual(processed, ["job-1", "job-2"]);
});

test("one job blowing up does not stop the queue behind it", async () => {
  const { client } = fakeRpc({
    claim_pending_transcribe_job: [
      { data: [{ id: "job-1", entity_id: "memo-1" }] },
      { data: [{ id: "job-2", entity_id: "memo-2" }] },
      { data: [] },
    ],
  });

  const processed: string[] = [];
  await drainTranscribeQueue(client, {
    process: async (job) => {
      if (job.id === "job-1") throw new Error("boom");
      processed.push(job.id);
    },
  });

  assert.deepEqual(processed, ["job-2"]);
});

test("stops at the concurrency limit instead of claiming the whole backlog", async () => {
  const { client, calls } = fakeRpc({
    claim_pending_transcribe_job: [
      { data: [{ id: "job-1", entity_id: "memo-1" }] },
      { data: [{ id: "job-2", entity_id: "memo-2" }] },
      { data: [{ id: "job-3", entity_id: "memo-3" }] },
      { data: [] },
    ],
  });

  await drainTranscribeQueue(client, {
    maxJobs: 2,
    process: async () => {},
  });

  assert.equal(
    calls.filter((call) => call.fn === "claim_pending_transcribe_job").length,
    2,
    "a claimed job that cannot be worked on is a job nobody else can take"
  );
});
