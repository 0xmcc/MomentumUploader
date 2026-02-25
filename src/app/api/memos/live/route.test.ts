/** @jest-environment node */

import { auth } from "@clerk/nextjs/server";
import { POST } from "./route";
import { supabaseAdmin } from "@/lib/supabase";
import { LIVE_MEMO_TITLE } from "@/lib/live-memo";

jest.mock("@clerk/nextjs/server", () => ({
  auth: jest.fn(),
}));

jest.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    from: jest.fn(),
  },
}));

describe("POST /api/memos/live", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns 401 when user is not authenticated", async () => {
    (auth as unknown as jest.Mock).mockResolvedValue({ userId: null });

    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.error).toBe("Unauthorized");
    expect(supabaseAdmin.from).not.toHaveBeenCalled();
  });

  it("creates an in-progress memo for the authenticated user", async () => {
    (auth as unknown as jest.Mock).mockResolvedValue({ userId: "user_live" });

    const single = jest.fn().mockResolvedValue({
      data: { id: "memo-live-1" },
      error: null,
    });
    const select = jest.fn(() => ({ single }));
    const insert = jest.fn(() => ({ select }));
    (supabaseAdmin.from as jest.Mock).mockReturnValue({ insert });

    const res = await POST();
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.memoId).toBe("memo-live-1");
    expect(supabaseAdmin.from).toHaveBeenCalledWith("memos");
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({
        title: LIVE_MEMO_TITLE,
        transcript: "",
        audio_url: "",
        user_id: "user_live",
      })
    );
  });
});
