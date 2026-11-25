import { issueApiToken, verifyApiToken } from "./api-token";

describe("api-token", () => {
  const originalSecret = process.env.MEMOS_API_TOKEN_SECRET;
  const originalClerkSecret = process.env.CLERK_SECRET_KEY;

  beforeEach(() => {
    process.env.MEMOS_API_TOKEN_SECRET = "test-secret";
    process.env.CLERK_SECRET_KEY = "";
  });

  afterAll(() => {
    if (originalSecret === undefined) {
      delete process.env.MEMOS_API_TOKEN_SECRET;
    } else {
      process.env.MEMOS_API_TOKEN_SECRET = originalSecret;
    }

    if (originalClerkSecret === undefined) {
      delete process.env.CLERK_SECRET_KEY;
    } else {
      process.env.CLERK_SECRET_KEY = originalClerkSecret;
    }
  });

  it("issues and verifies a token", () => {
    const nowMs = Date.UTC(2026, 1, 26, 0, 0, 0);
    const issued = issueApiToken({
      userId: "user_123",
      ttlSeconds: 3600,
      nowMs,
    });

    expect(typeof issued.token).toBe("string");
    expect(issued.expiresAt).toBe("2026-02-26T01:00:00.000Z");

    const verified = verifyApiToken(issued.token, { nowMs: nowMs + 30_000 });
    expect(verified).toEqual({ userId: "user_123" });
  });

  it("rejects expired tokens", () => {
    const nowMs = Date.UTC(2026, 1, 26, 0, 0, 0);
    const issued = issueApiToken({
      userId: "user_123",
      ttlSeconds: 1,
      nowMs,
    });

    const verified = verifyApiToken(issued.token, { nowMs: nowMs + 2_000 });
    expect(verified).toBeNull();
  });

  // Clerk's middleware parses any three-part dotted bearer as a JWT and throws,
  // so a dotted token took the whole request down with a 500 in production.
  it("never looks like a JWT to the login middleware", () => {
    const { token } = issueApiToken({ userId: "user_123" });

    expect(token).toMatch(/^vm1~[A-Za-z0-9_-]+~[A-Za-z0-9_-]+$/);
    expect(token.split(".")).toHaveLength(1);
    expect(verifyApiToken(token)).toEqual({ userId: "user_123" });
  });

  it("still verifies tokens issued in the old dotted form", () => {
    const { token } = issueApiToken({ userId: "user_123" });

    expect(verifyApiToken(token.replace(/~/g, "."))).toEqual({ userId: "user_123" });
  });

  it("rejects a tampered token and mixed separators", () => {
    const { token } = issueApiToken({ userId: "user_123" });

    expect(verifyApiToken(`${token}x`)).toBeNull();
    expect(verifyApiToken(token.replace("~", "."))).toBeNull();
  });
});
