import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { issueApiToken } from "@/lib/api-token";
import { createDesktopTokenClaim } from "@/lib/desktop-token-claims";

const DEFAULT_TOKEN_DAYS = 30;
const MAX_TOKEN_DAYS = 90;
const MIN_TOKEN_DAYS = 1;
const SECONDS_PER_DAY = 24 * 60 * 60;

function parseTokenDays(value: unknown): number {
  if (value == null) return DEFAULT_TOKEN_DAYS;

  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_TOKEN_DAYS;

  const wholeDays = Math.floor(numeric);
  if (wholeDays < MIN_TOKEN_DAYS) return MIN_TOKEN_DAYS;
  return Math.min(wholeDays, MAX_TOKEN_DAYS);
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let body: { days?: unknown } = {};
  try {
    body = (await req.json()) as { days?: unknown };
  } catch {
    body = {};
  }

  try {
    const days = parseTokenDays(body.days);
    const { token, expiresAt } = issueApiToken({
      userId,
      ttlSeconds: days * SECONDS_PER_DAY,
    });
    const { code, codeExpiresAt } = createDesktopTokenClaim(token, expiresAt);

    return NextResponse.json({
      code,
      codeExpiresAt,
      tokenExpiresAt: expiresAt,
      days,
    });
  } catch (error) {
    console.error("[api/connect/desktop/start]", error);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
