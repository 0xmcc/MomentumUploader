import { randomInt } from "node:crypto";

type ClaimValue = {
  token: string;
  tokenExpiresAt: string;
  claimExpiresAtMs: number;
};

const claims = new Map<string, ClaimValue>();
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DEFAULT_CLAIM_TTL_SECONDS = 10 * 60;

function generateCode(length = 8): string {
  let value = "";
  for (let index = 0; index < length; index += 1) {
    value += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)];
  }
  return value;
}

export function createDesktopTokenClaim(
  token: string,
  tokenExpiresAt: string,
  ttlSeconds = DEFAULT_CLAIM_TTL_SECONDS
): { code: string; codeExpiresAt: string } {
  let code = generateCode();
  while (claims.has(code)) {
    code = generateCode();
  }

  const claimExpiresAtMs = Date.now() + ttlSeconds * 1000;
  claims.set(code, {
    token,
    tokenExpiresAt,
    claimExpiresAtMs,
  });

  return {
    code,
    codeExpiresAt: new Date(claimExpiresAtMs).toISOString(),
  };
}

export function claimDesktopToken(
  codeInput: string
): { token: string; expiresAt: string } | null {
  const code = codeInput.trim().toUpperCase();
  if (!code) return null;

  const claim = claims.get(code);
  if (!claim) return null;

  claims.delete(code);
  if (claim.claimExpiresAtMs <= Date.now()) {
    return null;
  }

  return {
    token: claim.token,
    expiresAt: claim.tokenExpiresAt,
  };
}

export function __resetDesktopTokenClaimsForTests() {
  claims.clear();
}
