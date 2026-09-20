/**
 * Long recordings must be queued, never transcribed inside a request.
 *
 * A 1h42m upload sat on "Transcribing…" indefinitely on 2026-09-18 because
 * finalize transcribes inline: one HTTP request holding an hours-long job. The
 * queue, worker and stale-job recovery already exist for other work — these
 * tests define transcription joining them.
 */
import {
  INLINE_TRANSCRIPTION_MAX_BYTES,
  INLINE_TRANSCRIPTION_MAX_SECONDS,
  TRANSCRIBE_JOB_TYPE,
  enqueueTranscriptionJob,
  shouldQueueTranscription,
} from "@/lib/transcription-queue";

describe("choosing between the queue and an inline transcribe", () => {
  it("keeps a short voice note inline, so quick memos stay quick", () => {
    expect(
      shouldQueueTranscription({ durationSeconds: 45, fileSizeBytes: 400_000 })
    ).toBe(false);
  });

  it("queues an hours-long recording", () => {
    expect(
      shouldQueueTranscription({
        durationSeconds: 6_117,
        fileSizeBytes: 51_842_670,
      })
    ).toBe(true);
  });

  it("queues on size alone when the duration is unknown", () => {
    // Manual uploads arrive with durationSeconds 0 — the file is all we know.
    expect(
      shouldQueueTranscription({
        durationSeconds: 0,
        fileSizeBytes: INLINE_TRANSCRIPTION_MAX_BYTES + 1,
      })
    ).toBe(true);
  });

  it("queues on duration alone when the size is unknown", () => {
    expect(
      shouldQueueTranscription({
        durationSeconds: INLINE_TRANSCRIPTION_MAX_SECONDS + 1,
        fileSizeBytes: 0,
      })
    ).toBe(true);
  });

  it("never runs inline just because both numbers are missing", () => {
    // Unknown length is not evidence of a short recording.
    expect(
      shouldQueueTranscription({ durationSeconds: 0, fileSizeBytes: 0 })
    ).toBe(true);
  });
});

describe("enqueueing the transcription job", () => {
  function fakeSupabase(result: { error: unknown } = { error: null }) {
    const insert = jest.fn().mockResolvedValue(result);
    const from = jest.fn().mockReturnValue({ insert });
    return { client: { from } as never, from, insert };
  }

  it("writes a pending job the existing worker can claim", async () => {
    const supabase = fakeSupabase();

    await enqueueTranscriptionJob("memo-1", "user-1", supabase.client);

    expect(supabase.from).toHaveBeenCalledWith("job_runs");
    expect(supabase.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "user-1",
        job_type: TRANSCRIBE_JOB_TYPE,
        entity_type: "memo",
        entity_id: "memo-1",
        status: "pending",
      })
    );
  });

  it("throws when the job cannot be queued, so the caller cannot report success", async () => {
    const supabase = fakeSupabase({ error: { message: "insert failed" } });

    await expect(
      enqueueTranscriptionJob("memo-1", "user-1", supabase.client)
    ).rejects.toThrow(/insert failed/);
  });
});
