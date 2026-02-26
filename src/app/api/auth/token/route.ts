import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { issueApiToken } from "@/lib/api-token";

const DEFAULT_TOKEN_DAYS = 30;
const MIN_TOKEN_DAYS = 1;
const MAX_TOKEN_DAYS = 90;
const SECONDS_PER_DAY = 24 * 60 * 60;

function parseTokenDays(value: unknown): number | null {
  if (value == null) return DEFAULT_TOKEN_DAYS;

  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return null;

  const wholeDays = Math.floor(numeric);
  if (wholeDays < MIN_TOKEN_DAYS || wholeDays > MAX_TOKEN_DAYS) return null;
  return wholeDays;
}

export async function POST(req: Request) {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { days?: unknown } = {};
  try {
    body = (await req.json()) as { days?: unknown };
  } catch {
    body = {};
  }

  const tokenDays = parseTokenDays(body.days);
  if (!tokenDays) {
    return NextResponse.json(
      { error: `days must be an integer between ${MIN_TOKEN_DAYS} and ${MAX_TOKEN_DAYS}` },
      { status: 422 },
    );
  }

  try {
    const { token, expiresAt } = issueApiToken({
      userId,
      ttlSeconds: tokenDays * SECONDS_PER_DAY,
    });

    return NextResponse.json({
      tokenType: "Bearer",
      token,
      expiresAt,
      days: tokenDays,
    });
  } catch (error) {
    console.error("[api-auth-token]", error);
    return NextResponse.json(
      { error: "Token issuing is not configured on this deployment." },
      { status: 503 },
    );
  }
}
