/** @jest-environment node */

import { NextRequest } from "next/server";
import { validateOpenClawGateway } from "@/lib/agents";
import { lookupRuntimeByCredential } from "@/lib/openclaw-registry";

jest.mock("@/lib/memo-api-auth", () => ({
    resolveMemoUserId: jest.fn(),
}));

jest.mock("@/lib/openclaw-registry", () => ({
    lookupRuntimeByCredential: jest.fn(),
}));

jest.mock("@/lib/supabase", () => ({
    supabaseAdmin: {
        from: jest.fn(),
    },
}));

describe("validateOpenClawGateway", () => {
    const previousApiKeysJson = process.env.OPENCLAW_API_KEYS_JSON;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.OPENCLAW_API_KEYS_JSON = JSON.stringify({
            oc_acct_123: "secret-xyz",
        });
        (lookupRuntimeByCredential as jest.Mock).mockResolvedValue(null);
    });

    afterAll(() => {
        process.env.OPENCLAW_API_KEYS_JSON = previousApiKeysJson;
    });

    function makeRequest(apiKey?: string): NextRequest {
        return new NextRequest("https://example.com/api/s/sharetoken1234/handoff", {
            method: "POST",
            headers: apiKey
                ? {
                      "x-openclaw-api-key": apiKey,
                  }
                : undefined,
        });
    }

    it("rejects requests missing the API key header", async () => {
        await expect(validateOpenClawGateway(makeRequest())).resolves.toEqual({
            ok: false,
            status: 401,
            error: "Unauthorized",
        });
    });

    it("rejects malformed API keys", async () => {
        await expect(validateOpenClawGateway(makeRequest("oc_acct_123"))).resolves.toEqual({
            ok: false,
            status: 401,
            error: "Unauthorized",
        });
    });

    it("rejects unknown OpenClaw account ids", async () => {
        await expect(
            validateOpenClawGateway(makeRequest("oc_acct_unknown:secret-xyz"))
        ).resolves.toEqual({
            ok: false,
            status: 401,
            error: "Unauthorized",
        });
    });

    it("rejects bad secrets for known account ids", async () => {
        await expect(
            validateOpenClawGateway(makeRequest("oc_acct_123:not-the-secret"))
        ).resolves.toEqual({
            ok: false,
            status: 401,
            error: "Unauthorized",
        });
    });

    it("returns the stable external id for a valid API key", async () => {
        await expect(
            validateOpenClawGateway(makeRequest("oc_acct_123:secret-xyz"))
        ).resolves.toEqual({
            ok: true,
            openclawExternalId: "oc_acct_123",
        });
    });

    it("prefers DB-backed runtime credentials before the env fallback", async () => {
        (lookupRuntimeByCredential as jest.Mock).mockResolvedValue({
            openclaw_external_id: "oc_acct_db",
        });

        await expect(
            validateOpenClawGateway(makeRequest("oc_acct_db:db-secret"))
        ).resolves.toEqual({
            ok: true,
            openclawExternalId: "oc_acct_db",
        });
    });
});
