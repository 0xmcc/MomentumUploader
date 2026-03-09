import { NextResponse } from "next/server";
import { claimDesktopToken } from "@/lib/desktop-token-claims";

export async function POST(req: Request) {
  let body: { code?: unknown } = {};
  try {
    body = (await req.json()) as { code?: unknown };
  } catch {
    body = {};
  }

  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (!code) {
    return NextResponse.json({ error: "invalid_code" }, { status: 400 });
  }

  const claim = claimDesktopToken(code);
  if (!claim) {
    return NextResponse.json({ error: "invalid_code" }, { status: 404 });
  }

  return NextResponse.json({
    tokenType: "Bearer",
    token: claim.token,
    expiresAt: claim.expiresAt,
  });
}
