/** @jest-environment node */

import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { POST } from "./route";
import { resolveMemoUserId } from "@/lib/memo-api-auth";
import { supabaseAdmin } from "@/lib/supabase";

jest.mock("@/lib/memo-api-auth", () => ({
    resolveMemoUserId: jest.fn(),
}));

jest.mock("@/lib/supabase");

describe("POST /api/openclaw/registration-token", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    function makeRequest(body?: Record<string, unknown>): NextRequest {
        return new NextRequest("https://example.com/api/openclaw/registration-token", {
            method: "POST",
            headers: body
                ? {
                      "content-type": "application/json",
                  }
                : undefined,
            body: body ? JSON.stringify(body) : undefined,
        });
    }

    it("returns 401 when the caller is not authenticated", async () => {
        (resolveMemoUserId as jest.Mock).mockResolvedValue(null);

        const res = await POST(makeRequest());
        const body = await res.json();

        expect(res.status).toBe(401);
        expect(body.error).toBe("Unauthorized");
    });

    it("issues a new raw token and stores only its hash", async () => {
        (resolveMemoUserId as jest.Mock).mockResolvedValue("user_123");
        (supabaseAdmin.rpc as jest.Mock).mockResolvedValue({
            data: [
                {
                    status: "created",
                    expires_at: "2026-03-25T00:00:00.000Z",
                },
            ],
            error: null,
        });

        const res = await POST(makeRequest());
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.expires_at).toBe("2026-03-25T00:00:00.000Z");
        expect(body.note).toBe(
            "This token is shown once and expires in 7 days. Use it to register your OpenClaw runtime."
        );
        expect(body.registration_token).toMatch(/^[0-9a-f]{64}$/);

        const rawToken = body.registration_token as string;
        expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
            "issue_openclaw_registration_token",
            {
                p_owner_user_id: "user_123",
                p_token_hash: createHash("sha256").update(rawToken).digest("hex"),
                p_force: false,
                p_expires_at: expect.any(String),
            }
        );
    });

    it("returns 409 when an active token already exists", async () => {
        (resolveMemoUserId as jest.Mock).mockResolvedValue("user_123");
        (supabaseAdmin.rpc as jest.Mock).mockResolvedValue({
            data: [
                {
                    status: "active_token_exists",
                    expires_at: "2026-03-25T00:00:00.000Z",
                },
            ],
            error: null,
        });

        const res = await POST(makeRequest());
        const body = await res.json();

        expect(res.status).toBe(409);
        expect(body).toEqual({
            error: "active_token_exists",
            expires_at: "2026-03-25T00:00:00.000Z",
        });
    });

    it("passes force=true through to the RPC", async () => {
        (resolveMemoUserId as jest.Mock).mockResolvedValue("user_123");
        (supabaseAdmin.rpc as jest.Mock).mockResolvedValue({
            data: [
                {
                    status: "created",
                    expires_at: "2026-03-25T00:00:00.000Z",
                },
            ],
            error: null,
        });

        await POST(makeRequest({ force: true }));

        expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
            "issue_openclaw_registration_token",
            expect.objectContaining({
                p_force: true,
            })
        );
    });
});
