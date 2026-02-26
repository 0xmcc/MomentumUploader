/** @jest-environment node */

import { auth } from "@clerk/nextjs/server";
import { POST } from "./route";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

describe("POST /api/auth/token", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.MEMOS_API_TOKEN_SECRET = "test-secret";
  });

  it("returns 401 when signed out", async () => {
    (auth as unknown as jest.Mock).mockResolvedValue({ userId: null });

    const req = {
      json: async () => ({}),
    } as Request;

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
  });

  it("returns a bearer token for signed-in users", async () => {
    (auth as unknown as jest.Mock).mockResolvedValue({ userId: "user_abc" });

    const req = {
      json: async () => ({ days: 7 }),
    } as Request;

    const res = await POST(req);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.tokenType).toBe("Bearer");
    expect(typeof body.token).toBe("string");
    expect(typeof body.expiresAt).toBe("string");
  });
});
