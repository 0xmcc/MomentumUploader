import { NextRequest, NextResponse } from "next/server";
import { createImportRun } from "@/lib/fathom-import";
import { resolveMemoUserId } from "@/lib/memo-api-auth";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: CORS });
}

export async function POST(req: NextRequest) {
  const userId = await resolveMemoUserId(req);
  if (!userId) {
    return json({ error: "Unauthorized" }, 401);
  }

  const fathomApiKey = process.env.FATHOM_API_KEY?.trim();
  if (!fathomApiKey) {
    return json(
      {
        error: "Fathom import is not configured",
        detail: "FATHOM_API_KEY is not set on the server.",
      },
      503
    );
  }

  try {
    return json(await createImportRun(userId), 202);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return json({ error: "Failed to start Fathom import", detail }, 502);
  }
}
