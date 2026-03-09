/** @jest-environment node */

import { POST as startDesktopConnect } from "@/app/api/connect/desktop/start/route";
import { auth } from "@clerk/nextjs/server";
import { POST } from "./route";
import { __resetDesktopTokenClaimsForTests } from "@/lib/desktop-token-claims";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

describe("POST /api/auth/claim", () => {
  const originalSecret = process.env.MEMOS_API_TOKEN_SECRET;

  beforeEach(() => {
    jest.clearAllMocks();
    __resetDesktopTokenClaimsForTests();
    process.env.MEMOS_API_TOKEN_SECRET = "test-secret";
  });

  afterAll(() => {
    if (originalSecret === undefined) {
      delete process.env.MEMOS_API_TOKEN_SECRET;
    } else {
      process.env.MEMOS_API_TOKEN_SECRET = originalSecret;
    }
  });

  it("rejects missing codes", async () => {
    const response = await POST({
      json: async () => ({}),
    } as Request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_code" });
  });

  it("claims a previously-issued desktop token", async () => {
    (auth as unknown as jest.Mock).mockResolvedValue({ userId: "user_123" });

    const startResponse = await startDesktopConnect({
      json: async () => ({}),
    } as Request);
    const startPayload = (await startResponse.json()) as { code: string };

    const response = await POST({
      json: async () => ({ code: startPayload.code.toLowerCase() }),
    } as Request);

    expect(response.status).toBe(200);

    const payload = (await response.json()) as {
      tokenType: string;
      token: string;
      expiresAt: string;
    };

    expect(payload.tokenType).toBe("Bearer");
    expect(payload.token).toMatch(/^vm1\./);
    expect(payload.expiresAt).toEqual(expect.any(String));
  });

  it("invalidates codes after one successful claim", async () => {
    (auth as unknown as jest.Mock).mockResolvedValue({ userId: "user_123" });

    const startResponse = await startDesktopConnect({
      json: async () => ({}),
    } as Request);
    const startPayload = (await startResponse.json()) as { code: string };

    const firstClaim = await POST({
      json: async () => ({ code: startPayload.code }),
    } as Request);
    expect(firstClaim.status).toBe(200);

    const secondClaim = await POST({
      json: async () => ({ code: startPayload.code }),
    } as Request);
    expect(secondClaim.status).toBe(404);
    await expect(secondClaim.json()).resolves.toEqual({ error: "invalid_code" });
  });
});
