/** @jest-environment node */

import { POST } from "./route";
import { claimDesktopToken } from "@/lib/desktop-token-claims";

jest.mock("@/lib/desktop-token-claims", () => ({
  claimDesktopToken: jest.fn(),
}));

describe("POST /api/auth/claim", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("rejects missing codes", async () => {
    const response = await POST({
      json: async () => ({}),
    } as Request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_code" });
  });

  it("claims a previously-issued desktop token", async () => {
    (claimDesktopToken as jest.Mock).mockResolvedValue({
      token: "vm1.payload.signature",
      expiresAt: "2026-04-01T00:00:00.000Z",
    });

    const response = await POST({
      json: async () => ({ code: "abcd2345" }),
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
    expect(claimDesktopToken).toHaveBeenCalledWith("abcd2345");
  });

  it("invalidates codes after one successful claim", async () => {
    (claimDesktopToken as jest.Mock)
      .mockResolvedValueOnce({
        token: "vm1.payload.signature",
        expiresAt: "2026-04-01T00:00:00.000Z",
      })
      .mockResolvedValueOnce(null);

    const firstClaim = await POST({
      json: async () => ({ code: "ABCD2345" }),
    } as Request);
    expect(firstClaim.status).toBe(200);

    const secondClaim = await POST({
      json: async () => ({ code: "ABCD2345" }),
    } as Request);
    expect(secondClaim.status).toBe(404);
    await expect(secondClaim.json()).resolves.toEqual({ error: "invalid_code" });
  });
});
