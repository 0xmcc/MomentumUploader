import { createClient, type RealtimeChannel, type SupabaseClient } from "@supabase/supabase-js";
import { cleanupStaleWorkspaces } from "./workspace";
import { MAX_GLOBAL_JOBS, processJob } from "./worker";
import type { JobRow } from "./types";

const POLL_INTERVAL_MS = 10_000;
const CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
const STALE_RUNNING_JOB_MS = 5 * 60 * 1000;

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceRoleKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
}

const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let activeJobs = 0;
let draining = false;

function normalizeClaimedJob(data: unknown): JobRow | null {
  if (!data) {
    return null;
  }

  if (Array.isArray(data)) {
    return (data[0] as JobRow | undefined) ?? null;
  }

  return data as JobRow;
}

async function recoverRunningJobs(client: SupabaseClient) {
  const cutoffIso = new Date(Date.now() - STALE_RUNNING_JOB_MS).toISOString();
  const { error } = await client
    .from("job_runs")
    .update({ status: "pending", started_at: null })
    .eq("job_type", "memo_agent_chat")
    .eq("status", "running")
    .lt("started_at", cutoffIso);

  if (error) {
    console.error("[memo-agent-worker] failed to recover stale jobs", error);
  }
}

async function claimPendingAgentJob(client: SupabaseClient): Promise<JobRow | null> {
  const { data, error } = await client.rpc("claim_pending_agent_job");

  if (error) {
    throw error;
  }

  return normalizeClaimedJob(data);
}

async function drainQueue() {
  if (draining) {
    return;
  }

  draining = true;
  try {
    while (activeJobs < MAX_GLOBAL_JOBS) {
      const job = await claimPendingAgentJob(supabase);
      if (!job) {
        break;
      }

      activeJobs += 1;
      void processJob(job, supabase).finally(() => {
        activeJobs = Math.max(0, activeJobs - 1);
        void drainQueue();
      });
    }
  } catch (error) {
    console.error("[memo-agent-worker] drainQueue failed", error);
  } finally {
    draining = false;
  }
}

async function startRealtimeSubscription(client: SupabaseClient) {
  const channel: RealtimeChannel = client
    .channel("memo-agent-jobs")
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "job_runs",
        filter: "job_type=eq.memo_agent_chat",
      },
      () => {
        void drainQueue();
      }
    );

  await new Promise<void>((resolve) => {
    channel.subscribe((status) => {
      if (status === "SUBSCRIBED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        resolve();
      }
    });
  });
}

async function main() {
  console.log("[memo-agent-worker] starting");
  await recoverRunningJobs(supabase);
  await startRealtimeSubscription(supabase);
  await cleanupStaleWorkspaces();
  await drainQueue();

  setInterval(() => {
    void drainQueue();
  }, POLL_INTERVAL_MS);

  setInterval(() => {
    void cleanupStaleWorkspaces();
  }, CLEANUP_INTERVAL_MS);
}

void main().catch((error) => {
  console.error("[memo-agent-worker] fatal error", error);
  process.exitCode = 1;
});
