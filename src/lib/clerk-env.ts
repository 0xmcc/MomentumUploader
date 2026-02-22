type ClerkEnv = {
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY?: string;
  CLERK_SECRET_KEY?: string;
};

function getKeyMode(key: string): "test" | "live" | "unknown" {
  if (key.includes("_test_")) return "test";
  if (key.includes("_live_")) return "live";
  return "unknown";
}

function requireKey(value: string | undefined, keyName: keyof ClerkEnv): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`Missing ${keyName}. Add it to your environment variables.`);
  }
  return trimmed;
}

export function validateClerkEnv(env: ClerkEnv = process.env): {
  publishableKey: string;
  secretKey: string;
} {
  const publishableKey = requireKey(
    env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY,
    "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  );
  const secretKey = requireKey(env.CLERK_SECRET_KEY, "CLERK_SECRET_KEY");

  const publishableMode = getKeyMode(publishableKey);
  const secretMode = getKeyMode(secretKey);

  if (publishableMode === "unknown" || secretMode === "unknown") {
    throw new Error(
      "Invalid Clerk key format. Expected NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY to include _test_ or _live_.",
    );
  }

  if (publishableMode !== secretMode) {
    throw new Error(
      `Clerk key mode mismatch: publishable key is ${publishableMode}, secret key is ${secretMode}.`,
    );
  }

  return { publishableKey, secretKey };
}
