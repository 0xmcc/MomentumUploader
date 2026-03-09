import { randomInt } from "node:crypto";
import { supabaseAdmin } from "./supabase";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const DEFAULT_CLAIM_TTL_SECONDS = 10 * 60;
const MAX_INSERT_ATTEMPTS = 5;

type SupabaseErrorLike = {
  code?: string;
  message?: string;
  details?: string;
  hint?: string;
};

function generateCode(length = 8): string {
  let value = "";
  for (let index = 0; index < length; index += 1) {
    value += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)];
  }
  return value;
}

function describeSupabaseError(error: SupabaseErrorLike): string {
  return (
    error.message?.trim() ||
    error.details?.trim() ||
    error.hint?.trim() ||
    error.code?.trim() ||
    "unknown Supabase error"
  );
}

export async function createDesktopTokenClaim(
  token: string,
  tokenExpiresAt: string,
  ttlSeconds = DEFAULT_CLAIM_TTL_SECONDS
): Promise<{ code: string; codeExpiresAt: string }> {
  const claimExpiresAtMs = Date.now() + ttlSeconds * 1000;
  const codeExpiresAt = new Date(claimExpiresAtMs).toISOString();

  for (let attempt = 0; attempt < MAX_INSERT_ATTEMPTS; attempt++) {
    const code = generateCode();
    const { error } = await supabaseAdmin
      .from("desktop_token_claims")
      .insert({ code, token, token_expires_at: tokenExpiresAt, claim_expires_at: codeExpiresAt });

    if (!error) return { code, codeExpiresAt };

    // 23505 = unique_violation — code collision, retry with a new code
    if ((error as SupabaseErrorLike).code !== "23505") {
      throw new Error(
        `Failed to store desktop token claim: ${describeSupabaseError(error as SupabaseErrorLike)}`
      );
    }
  }

  throw new Error("Failed to generate a unique claim code after max attempts");
}

export async function claimDesktopToken(
  codeInput: string
): Promise<{ token: string; expiresAt: string } | null> {
  const code = codeInput.trim().toUpperCase();
  if (!code) return null;

  // Atomic: DELETE ... WHERE code = ? AND claim_expires_at > now() RETURNING ...
  // Only one concurrent caller can delete the row; any second caller gets no rows back.
  const { data, error } = await supabaseAdmin.rpc("claim_desktop_token", { p_code: code });

  if (error || !data || (data as unknown[]).length === 0) return null;

  const row = (data as { token: string; token_expires_at: string }[])[0];
  return { token: row.token, expiresAt: row.token_expires_at };
}

export async function __resetDesktopTokenClaimsForTests(): Promise<void> {
  await supabaseAdmin.from("desktop_token_claims").delete().neq("code", "");
}
