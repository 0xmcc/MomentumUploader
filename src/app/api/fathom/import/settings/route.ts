import { NextRequest, NextResponse } from "next/server";
import { getLatestImportRun } from "@/lib/fathom-import";
import { resolveMemoUserId } from "@/lib/memo-api-auth";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: CORS });
}

export async function GET(req: NextRequest) {
  const userId = await resolveMemoUserId(req);
  if (!userId) {
    return json({ error: "Unauthorized" }, 401);
  }

  const configured = Boolean(process.env.FATHOM_API_KEY?.trim());
  if (!configured) {
    return json({
      configured: false,
      connectionStatus: "not_configured",
      lastImport: null,
    });
  }

  return json({
    configured: true,
    connectionStatus: "connected",
    lastImport: await getLatestImportRun(userId),
  });
}
