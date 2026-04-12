import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, mkdir, readFile, stat, utimes } from "node:fs/promises";
import {
  cleanupStaleWorkspaces,
  materializeWorkspace,
} from "./workspace";

function createSupabaseStub() {
  return {
    from(table: string) {
      if (table === "memos") {
        const chain = {
          select() {
            return chain;
          },
          eq() {
            return chain;
          },
          maybeSingle() {
            return Promise.resolve({
              data: {
                id: "memo-1",
                title: "Weekly Sync",
                created_at: "2026-04-12T12:00:00.000Z",
                duration: 125,
                transcript: "Fallback transcript",
              },
              error: null,
            });
          },
        };
        return chain;
      }

      if (table === "memo_transcript_segments") {
        const chain = {
          select() {
            return chain;
          },
          eq() {
            return chain;
          },
          order() {
            return Promise.resolve({
              data: [
                { start_ms: 0, text: "First segment" },
                { start_ms: 1234, text: "Second segment" },
              ],
              error: null,
            });
          },
        };
        return chain;
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

test("materializeWorkspace writes memo context, transcript, attachments dir, and heartbeat", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "memo-agent-workspace-"));

  const { workspaceDir } = await materializeWorkspace(
    "session-1",
    "memo-1",
    createSupabaseStub() as never,
    rootDir
  );

  const transcript = await readFile(path.join(workspaceDir, "transcript.md"), "utf8");
  const context = await readFile(path.join(workspaceDir, "context.md"), "utf8");
  const heartbeat = await stat(path.join(workspaceDir, ".last_active"));
  const attachments = await stat(path.join(workspaceDir, "attachments"));

  assert.match(transcript, /\[0ms\] First segment/);
  assert.match(transcript, /\[1234ms\] Second segment/);
  assert.match(context, /title: "Weekly Sync"/);
  assert.match(context, /memo_id: "memo-1"/);
  assert.equal(attachments.isDirectory(), true);
  assert.equal(heartbeat.isFile(), true);
});

test("cleanupStaleWorkspaces removes directories inactive for more than 24 hours", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "memo-agent-cleanup-"));
  const staleDir = path.join(rootDir, "stale-session");
  const freshDir = path.join(rootDir, "fresh-session");

  await mkdir(staleDir, { recursive: true });
  await mkdir(freshDir, { recursive: true });

  const staleHeartbeat = path.join(staleDir, ".last_active");
  const freshHeartbeat = path.join(freshDir, ".last_active");

  await readFile(await materializeWorkspace("temp", "memo-1", createSupabaseStub() as never, rootDir).then(({ workspaceDir }) => path.join(workspaceDir, ".last_active")));
  await readFile(await materializeWorkspace("fresh-session", "memo-1", createSupabaseStub() as never, rootDir).then(({ workspaceDir }) => path.join(workspaceDir, ".last_active")));
  await readFile(await materializeWorkspace("stale-session", "memo-1", createSupabaseStub() as never, rootDir).then(({ workspaceDir }) => path.join(workspaceDir, ".last_active")));

  const staleDate = new Date(Date.now() - 25 * 60 * 60 * 1000);
  await utimes(staleHeartbeat, staleDate, staleDate);

  await cleanupStaleWorkspaces(rootDir, Date.now());

  await assert.rejects(() => stat(staleDir));
  assert.equal((await stat(freshDir)).isDirectory(), true);
});
