import { auth } from "@clerk/nextjs/server";
import type { NextRequest } from "next/server";
import { verifyApiToken } from "@/lib/api-token";

function getBearerToken(req: NextRequest): string | null {
  const authorization =
    typeof req.headers?.get === "function"
      ? req.headers.get("authorization")
      : null;
  if (!authorization) return null;

  const [scheme, value] = authorization.split(" ");
  if (!scheme || !value) return null;
  if (scheme.toLowerCase() !== "bearer") return null;
  const token = value.trim();
  return token.length > 0 ? token : null;
}

export async function resolveMemoUserId(req: NextRequest): Promise<string | null> {
  const { userId } = await auth();
  if (userId) return userId;

  const bearerToken = getBearerToken(req);
  if (!bearerToken) return null;

  const verified = verifyApiToken(bearerToken);
  return verified?.userId ?? null;
}
