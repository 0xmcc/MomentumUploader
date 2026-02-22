/** @jest-environment node */

import { auth } from "@clerk/nextjs/server";
import { GET } from "./route";
import { supabaseAdmin } from "@/lib/supabase";
import { NextRequest } from "next/server";

jest.mock("@clerk/nextjs/server", () => ({
    auth: jest.fn(),
}));

jest.mock("@/lib/supabase", () => ({
    supabaseAdmin: {
        from: jest.fn(),
    },
}));

describe("GET /api/memos/:id", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("returns 404 when the request is signed out", async () => {
        (auth as unknown as jest.Mock).mockResolvedValue({ userId: null });

        const req = {} as NextRequest;
        const res = await GET(req, { params: Promise.resolve({ id: "memo-1" }) });
        const body = await res.json();

        expect(res.status).toBe(404);
        expect(body.error).toBe("Memo not found");
        expect(supabaseAdmin.from).not.toHaveBeenCalled();
    });

    it("returns 404 when a signed-in user requests another user's memo", async () => {
        (auth as unknown as jest.Mock).mockResolvedValue({ userId: "user_a" });

        const single = jest.fn().mockResolvedValue({ data: null, error: { message: "not found" } });
        const userEq = jest.fn(() => ({ single }));
        const idEq = jest.fn(() => ({ eq: userEq }));
        const select = jest.fn(() => ({ eq: idEq }));
        (supabaseAdmin.from as jest.Mock).mockReturnValue({ select });

        const req = {} as NextRequest;
        const res = await GET(req, { params: Promise.resolve({ id: "memo-owned-by-user-b" }) });
        const body = await res.json();

        expect(res.status).toBe(404);
        expect(body.error).toBe("Memo not found");
        expect(idEq).toHaveBeenCalledWith("id", "memo-owned-by-user-b");
        expect(userEq).toHaveBeenCalledWith("user_id", "user_a");
    });
});
