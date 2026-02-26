import { createHmac, timingSafeEqual } from "node:crypto";

const TOKEN_PREFIX = "vm1";
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 30;
const MAX_TTL_SECONDS = 60 * 60 * 24 * 365;

type ApiTokenPayload = {
  v: 1;
  sub: string;
  iat: number;
  exp: number;
};

type IssueApiTokenArgs = {
  userId: string;
  ttlSeconds?: number;
  nowMs?: number;
};

type VerifyApiTokenOptions = {
  nowMs?: number;
};

function getSigningSecret(): string {
  const raw =
    process.env.MEMOS_API_TOKEN_SECRET?.trim() ??
    process.env.CLERK_SECRET_KEY?.trim() ??
    "";
  if (!raw) {
    throw new Error(
      "Missing MEMOS_API_TOKEN_SECRET (or CLERK_SECRET_KEY fallback).",
    );
  }
  return raw;
}

function toBase64Url(value: string | Buffer): string {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function fromBase64Url(value: string): Buffer | null {
  if (!value || /[^A-Za-z0-9\-_]/.test(value)) return null;
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  try {
    return Buffer.from(normalized + padding, "base64");
  } catch {
    return null;
  }
}

function signPayload(encodedPayload: string, secret: string): string {
  const signature = createHmac("sha256", secret).update(encodedPayload).digest();
  return toBase64Url(signature);
}

export function issueApiToken({
  userId,
  ttlSeconds = DEFAULT_TTL_SECONDS,
  nowMs = Date.now(),
}: IssueApiTokenArgs): { token: string; expiresAt: string } {
  const normalizedUserId = userId.trim();
  if (!normalizedUserId) {
    throw new Error("userId is required to issue an API token.");
  }

  const normalizedTtl = Number.isFinite(ttlSeconds)
    ? Math.min(Math.max(Math.floor(ttlSeconds), 1), MAX_TTL_SECONDS)
    : DEFAULT_TTL_SECONDS;

  const nowSeconds = Math.floor(nowMs / 1000);
  const payload: ApiTokenPayload = {
    v: 1,
    sub: normalizedUserId,
    iat: nowSeconds,
    exp: nowSeconds + normalizedTtl,
  };

  const encodedPayload = toBase64Url(JSON.stringify(payload));
  const signature = signPayload(encodedPayload, getSigningSecret());

  return {
    token: `${TOKEN_PREFIX}.${encodedPayload}.${signature}`,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
  };
}

export function verifyApiToken(
  token: string,
  { nowMs = Date.now() }: VerifyApiTokenOptions = {},
): { userId: string } | null {
  try {
    const [prefix, encodedPayload, providedSignature] = token.split(".");
    if (
      prefix !== TOKEN_PREFIX ||
      !encodedPayload ||
      !providedSignature ||
      token.split(".").length !== 3
    ) {
      return null;
    }

    const expectedSignature = signPayload(encodedPayload, getSigningSecret());
    const expectedBuffer = Buffer.from(expectedSignature);
    const providedBuffer = Buffer.from(providedSignature);
    if (
      expectedBuffer.length !== providedBuffer.length ||
      !timingSafeEqual(expectedBuffer, providedBuffer)
    ) {
      return null;
    }

    const payloadBuffer = fromBase64Url(encodedPayload);
    if (!payloadBuffer) return null;
    const payload = JSON.parse(payloadBuffer.toString("utf8")) as Partial<ApiTokenPayload>;

    if (
      payload.v !== 1 ||
      typeof payload.sub !== "string" ||
      !payload.sub.trim() ||
      typeof payload.exp !== "number"
    ) {
      return null;
    }

    const nowSeconds = Math.floor(nowMs / 1000);
    if (payload.exp <= nowSeconds) return null;

    return { userId: payload.sub };
  } catch {
    return null;
  }
}
