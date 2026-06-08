import { NextRequest, NextResponse } from "next/server";
import {
  failImportRun,
  FathomTimeoutError,
  getImportRun,
  processImportRunPage,
} from "@/lib/fathom-import";
import { resolveMemoUserId } from "@/lib/memo-api-auth";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

type RouteContext = {
  params: Promise<{ jobId: string }> | { jobId: string };
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: CORS });
}

export async function GET(req: NextRequest, context: RouteContext) {
  const userId = await resolveMemoUserId(req);
  if (!userId) {
    return json({ error: "Unauthorized" }, 401);
  }

  const { jobId } = await context.params;
  const run = await getImportRun(userId, jobId);
  if (!run) {
    return json({ error: "Fathom import job not found" }, 404);
  }

  if (run.status === "succeeded" || run.status === "failed") {
    return json({
      jobId: run.id,
      status: run.status,
      imported: run.imported_count,
      meetings: run.meeting_count,
      processedPages: run.processed_pages,
      startedAt: run.started_at,
      completedAt: run.completed_at,
      error: run.last_error,
    });
  }

  const fathomApiKey = process.env.FATHOM_API_KEY?.trim();
  if (!fathomApiKey) {
    const failed = await failImportRun(
      run,
      new Error("FATHOM_API_KEY is not set on the server.")
    );
    return json(failed, 503);
  }

  try {
    return json(await processImportRunPage(run, fathomApiKey));
  } catch (error) {
    const failed = await failImportRun(run, error);
    return json(failed, error instanceof FathomTimeoutError ? 504 : 502);
  }
}
