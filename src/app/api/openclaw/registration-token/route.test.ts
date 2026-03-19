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
    function mockEnsureUserRecord(error: unknown = null): jest.Mock {
        const upsert = jest.fn().mockResolvedValue({ error });
        (supabaseAdmin.from as jest.Mock).mockReturnValue({ upsert });
        return upsert;
    }

    beforeEach(() => {
        jest.clearAllMocks();
        mockEnsureUserRecord();
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

    it("provisions the authenticated user before issuing a registration token", async () => {
        (resolveMemoUserId as jest.Mock).mockResolvedValue("user_123");
        const upsert = jest.fn().mockResolvedValue({ error: null });
        (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
            expect(table).toBe("users");
            return { upsert };
        });
        (supabaseAdmin.rpc as jest.Mock).mockImplementation(async () => {
            if (upsert.mock.calls.length === 0) {
                return {
                    data: null,
                    error: {
                        code: "23503",
                        message:
                            'insert or update on table "openclaw_registration_tokens" violates foreign key constraint "openclaw_registration_tokens_owner_user_id_fkey"',
                    },
                };
            }

            return {
                data: [
                    {
                        status: "created",
                        expires_at: "2026-03-25T00:00:00.000Z",
                    },
                ],
                error: null,
            };
        });

        const res = await POST(makeRequest());
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.expires_at).toBe("2026-03-25T00:00:00.000Z");
        expect(upsert).toHaveBeenCalledWith(
            { id: "user_123" },
            { onConflict: "id", ignoreDuplicates: true }
        );
    });

    it("returns a migration hint when the OpenClaw registration schema is unavailable", async () => {
        (resolveMemoUserId as jest.Mock).mockResolvedValue("user_123");
        (supabaseAdmin.rpc as jest.Mock).mockResolvedValue({
            data: null,
            error: {
                code: "PGRST202",
                message: 'Could not find the function public.issue_openclaw_registration_token',
            },
        });

        const res = await POST(makeRequest());
        const body = await res.json();

        expect(res.status).toBe(503);
        expect(body).toEqual({
            error: "OpenClaw registration tokens are unavailable until the latest database migration is applied.",
        });
    });

    it("returns a migration hint when the OpenClaw registration function is on the broken pre-patch version", async () => {
        (resolveMemoUserId as jest.Mock).mockResolvedValue("user_123");
        (supabaseAdmin.rpc as jest.Mock).mockResolvedValue({
            data: null,
            error: {
                code: "42702",
                message: 'column reference "status" is ambiguous',
                details:
                    "It could refer to either a PL/pgSQL variable or a table column.",
            },
        });

        const res = await POST(makeRequest());
        const body = await res.json();

        expect(res.status).toBe(503);
        expect(body).toEqual({
            error: "OpenClaw registration tokens are unavailable until the latest database migration is applied.",
        });
    });
});
