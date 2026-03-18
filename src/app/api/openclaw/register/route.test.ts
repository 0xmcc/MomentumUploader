/** @jest-environment node */

import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { POST } from "./route";
import { supabaseAdmin } from "@/lib/supabase";

jest.mock("@/lib/supabase");

describe("POST /api/openclaw/register", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    function makeRequest(
        body: Record<string, unknown>,
        forwardedFor = "203.0.113.10"
    ): NextRequest {
        return new NextRequest("https://example.com/api/openclaw/register", {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "x-forwarded-for": forwardedFor,
            },
            body: JSON.stringify(body),
        });
    }

    it("returns 404 when the registration token is invalid, expired, or already consumed", async () => {
        (supabaseAdmin.rpc as jest.Mock)
            .mockResolvedValueOnce({
                data: [{ allowed: true, retry_after_seconds: 0 }],
                error: null,
            })
            .mockResolvedValueOnce({
                data: [{ status: "token_not_found" }],
                error: null,
            });

        const res = await POST(
            makeRequest({ registration_token: "raw-token", display_name: "My OpenClaw" })
        );
        const body = await res.json();

        expect(res.status).toBe(404);
        expect(body.error).toBe("Not found");
        expect(supabaseAdmin.rpc).toHaveBeenNthCalledWith(
            1,
            "consume_openclaw_register_rate_limit",
            {
                p_rate_limit_key: createHash("sha256")
                    .update("openclaw-register:ip:203.0.113.10")
                    .digest("hex"),
                p_max_attempts: 5,
                p_window_seconds: 60,
            }
        );
    });

    it("returns 409 when the owner already has an active runtime", async () => {
        (supabaseAdmin.rpc as jest.Mock)
            .mockResolvedValueOnce({
                data: [{ allowed: true, retry_after_seconds: 0 }],
                error: null,
            })
            .mockResolvedValueOnce({
                data: [{ status: "active_runtime_exists" }],
                error: null,
            });

        const res = await POST(makeRequest({ registration_token: "raw-token" }));
        const body = await res.json();

        expect(res.status).toBe(409);
        expect(body.error).toBe("active_runtime_exists");
    });

    it("creates a runtime and returns the issued api key", async () => {
        (supabaseAdmin.rpc as jest.Mock)
            .mockResolvedValueOnce({
                data: [{ allowed: true, retry_after_seconds: 0 }],
                error: null,
            })
            .mockResolvedValueOnce({
                data: [{ status: "registered" }],
                error: null,
            });

        const res = await POST(
            makeRequest({ registration_token: "raw-token", display_name: "My OpenClaw" })
        );
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.openclaw_external_id).toMatch(/^oc_acct_[0-9a-f]{16}$/);
        expect(body.api_key).toMatch(/^oc_acct_[0-9a-f]{16}:[0-9a-f]{64}$/);

        const [accountId, secret] = (body.api_key as string).split(":");
        expect(accountId).toBe(body.openclaw_external_id);
        expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
            "register_openclaw_runtime",
            {
                p_token_hash: createHash("sha256").update("raw-token").digest("hex"),
                p_display_name: "My OpenClaw",
                p_openclaw_external_id: accountId,
                p_secret_hash: createHash("sha256").update(secret).digest("hex"),
            }
        );
    });

    it("returns 429 from the shared limiter and skips runtime registration", async () => {
        (supabaseAdmin.rpc as jest.Mock).mockResolvedValueOnce({
            data: [{ allowed: false, retry_after_seconds: 60 }],
            error: null,
        });

        const limited = await POST(makeRequest({ registration_token: "raw-token-6" }));
        const body = await limited.json();

        expect(limited.status).toBe(429);
        expect(body.error).toBe("Too many requests");
        expect(limited.headers.get("retry-after")).toBe("60");
        expect(supabaseAdmin.rpc).toHaveBeenCalledTimes(1);
        expect(supabaseAdmin.rpc).not.toHaveBeenCalledWith(
            "register_openclaw_runtime",
            expect.anything()
        );
    });
});
