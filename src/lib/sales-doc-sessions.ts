import type { SalesSession } from "@/data/salesDocTypes";
import { isMissingTableError } from "@/lib/supabase-compat";
import { supabaseAdmin } from "@/lib/supabase";

const SALES_DOC_SESSIONS_TABLE = "sales_doc_sessions";

type SalesDocSessionRow = {
  session_json: SalesSession;
  created_at: string | null;
};

function formatRelativeLastActive(createdAt: string | null | undefined): string {
  if (!createdAt) return "Just now";

  const createdAtMs = new Date(createdAt).getTime();
  if (!Number.isFinite(createdAtMs)) return "Just now";

  const diffMs = Math.max(0, Date.now() - createdAtMs);
  const minuteMs = 60_000;
  const hourMs = 60 * minuteMs;
  const dayMs = 24 * hourMs;

  if (diffMs < minuteMs) return "Just now";
  if (diffMs < hourMs) return `${Math.floor(diffMs / minuteMs)}m ago`;
  if (diffMs < dayMs) return `${Math.floor(diffMs / hourMs)}h ago`;
  return `${Math.floor(diffMs / dayMs)}d ago`;
}

export async function saveSalesDocSession(
  session: SalesSession,
  input: { prompt: string; transcript?: string }
): Promise<void> {
  const { error } = await supabaseAdmin.from(SALES_DOC_SESSIONS_TABLE).insert({
    id: session.id,
    title: session.doc.documentMetadata.title,
    sidebar_label: session.sidebarLabel,
    prompt: input.prompt,
    transcript: input.transcript ?? null,
    session_json: session,
    user_id: null,
  });

  if (!error) return;

  if (isMissingTableError(error, SALES_DOC_SESSIONS_TABLE)) {
    console.warn(
      "[sales-doc-sessions] sales_doc_sessions table is missing; skipping save"
    );
    return;
  }

  throw error;
}

export async function listSalesDocSessions(
  limit = 20
): Promise<SalesSession[]> {
  const { data, error } = await supabaseAdmin
    .from(SALES_DOC_SESSIONS_TABLE)
    .select("session_json, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    if (isMissingTableError(error, SALES_DOC_SESSIONS_TABLE)) {
      console.warn(
        "[sales-doc-sessions] sales_doc_sessions table is missing; returning no sessions"
      );
      return [];
    }

    throw error;
  }

  return ((data ?? []) as SalesDocSessionRow[]).map((row) => ({
    ...row.session_json,
    lastActive: formatRelativeLastActive(row.created_at),
  }));
}
