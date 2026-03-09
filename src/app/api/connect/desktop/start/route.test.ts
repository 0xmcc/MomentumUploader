/** @jest-environment node */

import { auth } from "@clerk/nextjs/server";
import { POST } from "./route";
import { createDesktopTokenClaim } from "@/lib/desktop-token-claims";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/desktop-token-claims", () => ({
  createDesktopTokenClaim: jest.fn(),
}));

describe("POST /api/connect/desktop/start", () => {
  const originalSecret = process.env.MEMOS_API_TOKEN_SECRET;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.MEMOS_API_TOKEN_SECRET = "test-secret";
  });

  afterAll(() => {
    if (originalSecret === undefined) {
      delete process.env.MEMOS_API_TOKEN_SECRET;
    } else {
      process.env.MEMOS_API_TOKEN_SECRET = originalSecret;
    }
  });

  it("returns unauthorized for signed-out users", async () => {
    (auth as unknown as jest.Mock).mockResolvedValue({ userId: null });

    const response = await POST({
      json: async () => ({}),
    } as Request);

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
  });

  it("creates a one-time desktop claim for signed-in users", async () => {
    (auth as unknown as jest.Mock).mockResolvedValue({ userId: "user_123" });
    (createDesktopTokenClaim as jest.Mock).mockResolvedValue({
      code: "ABCD2345",
      codeExpiresAt: "2026-04-01T00:10:00.000Z",
    });

    const response = await POST({
      json: async () => ({ days: 30 }),
    } as Request);

    expect(response.status).toBe(200);

    const payload = (await response.json()) as {
      code: string;
      codeExpiresAt: string;
      tokenExpiresAt: string;
      days: number;
    };

    expect(payload.code).toMatch(/^[A-Z2-9]{8}$/);
    expect(payload.codeExpiresAt).toEqual(expect.any(String));
    expect(payload.tokenExpiresAt).toEqual(expect.any(String));
    expect(payload.days).toBe(30);
    expect(createDesktopTokenClaim).toHaveBeenCalledWith(
      expect.stringMatching(/^vm1\./),
      expect.any(String)
    );
  });
});
