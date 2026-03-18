/** @jest-environment node */

import { lookupRuntimeByCredential, sha256hex } from "@/lib/openclaw-registry";
import { supabaseAdmin } from "@/lib/supabase";

jest.mock("@/lib/supabase");

const mockFrom = supabaseAdmin.from as jest.Mock;

beforeEach(() => {
    jest.clearAllMocks();
});

describe("sha256hex", () => {
    it("returns the expected SHA-256 hex digest", () => {
        expect(sha256hex("hello")).toBe(
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
    });
});

describe("lookupRuntimeByCredential", () => {
    function makeMaybeSingle(result: {
        data: null | { openclaw_external_id: string; secret_hash: string };
        error: null | { code?: string; message?: string };
    }) {
        const maybeSingle = jest.fn().mockResolvedValue(result);
        const eqStatus = jest.fn(() => ({ maybeSingle }));
        const eqAccount = jest.fn(() => ({ eq: eqStatus }));
        const select = jest.fn(() => ({ eq: eqAccount }));

        mockFrom.mockReturnValue({ select });

        return { select, eqAccount, eqStatus, maybeSingle };
    }

    it("returns the runtime when the secret matches", async () => {
        makeMaybeSingle({
            data: {
                openclaw_external_id: "oc_acct_123",
                secret_hash: sha256hex("secret-xyz"),
            },
            error: null,
        });

        await expect(
            lookupRuntimeByCredential("oc_acct_123", "secret-xyz")
        ).resolves.toEqual({
            openclaw_external_id: "oc_acct_123",
        });
        expect(mockFrom).toHaveBeenCalledWith("openclaw_runtimes");
    });

    it("returns null when the secret does not match", async () => {
        makeMaybeSingle({
            data: {
                openclaw_external_id: "oc_acct_123",
                secret_hash: sha256hex("secret-xyz"),
            },
            error: null,
        });

        await expect(
            lookupRuntimeByCredential("oc_acct_123", "wrong-secret")
        ).resolves.toBeNull();
    });

    it("returns null when the runtime is missing", async () => {
        makeMaybeSingle({ data: null, error: null });

        await expect(
            lookupRuntimeByCredential("oc_acct_missing", "secret-xyz")
        ).resolves.toBeNull();
    });

    it("treats missing schema errors as an unavailable registry and falls back cleanly", async () => {
        makeMaybeSingle({
            data: null,
            error: {
                code: "42P01",
                message: 'relation "public.openclaw_runtimes" does not exist',
            },
        });

        await expect(
            lookupRuntimeByCredential("oc_acct_123", "secret-xyz")
        ).resolves.toBeNull();
    });
});
