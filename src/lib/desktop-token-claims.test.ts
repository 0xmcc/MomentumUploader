import {
    createDesktopTokenClaim,
    claimDesktopToken,
    __resetDesktopTokenClaimsForTests,
} from "./desktop-token-claims";
import { supabaseAdmin } from "./supabase";

jest.mock("./supabase");

const mockFrom = supabaseAdmin.from as jest.Mock;
const mockRpc = supabaseAdmin.rpc as jest.Mock;

function makeInsertChain(result: { error: null | { message: string; code?: string } }) {
    return { insert: jest.fn().mockResolvedValue(result) };
}

beforeEach(() => {
    jest.clearAllMocks();
});

describe("createDesktopTokenClaim", () => {
    it("inserts a row and returns code + codeExpiresAt", async () => {
        mockFrom.mockReturnValue(makeInsertChain({ error: null }));

        const { code, codeExpiresAt } = await createDesktopTokenClaim(
            "tok_abc",
            "2026-04-01T00:00:00.000Z"
        );

        expect(code).toMatch(/^[A-Z2-9]{8}$/);
        expect(new Date(codeExpiresAt).getTime()).toBeGreaterThan(Date.now());
        expect(mockFrom).toHaveBeenCalledWith("desktop_token_claims");
    });

    it("retries on unique_violation (23505) and succeeds on second attempt", async () => {
        const collision = { error: { message: "duplicate", code: "23505" } };
        const success = { error: null };
        mockFrom
            .mockReturnValueOnce(makeInsertChain(collision))
            .mockReturnValue(makeInsertChain(success));

        const { code } = await createDesktopTokenClaim("tok_abc", "2026-04-01T00:00:00.000Z");

        expect(code).toMatch(/^[A-Z2-9]{8}$/);
        expect(mockFrom).toHaveBeenCalledTimes(2);
    });

    it("throws on a non-collision insert error", async () => {
        mockFrom.mockReturnValue(makeInsertChain({ error: { message: "db down" } }));

        await expect(
            createDesktopTokenClaim("tok_abc", "2026-04-01T00:00:00.000Z")
        ).rejects.toThrow("db down");
    });

    it("surfaces useful details when Supabase omits the message field", async () => {
        mockFrom.mockReturnValue(
            makeInsertChain({
                error: {
                    code: "42P01",
                    details: 'relation "desktop_token_claims" does not exist',
                } as { message: string; code?: string },
            })
        );

        await expect(
            createDesktopTokenClaim("tok_abc", "2026-04-01T00:00:00.000Z")
        ).rejects.toThrow('desktop_token_claims');
    });

    it("throws after exhausting max insert attempts with repeated collisions", async () => {
        const collision = { error: { message: "duplicate", code: "23505" } };
        mockFrom.mockReturnValue(makeInsertChain(collision));

        await expect(
            createDesktopTokenClaim("tok_abc", "2026-04-01T00:00:00.000Z")
        ).rejects.toThrow("max attempts");
    });
});

describe("claimDesktopToken", () => {
    it("returns token and expiresAt when RPC returns a row", async () => {
        mockRpc.mockResolvedValue({
            data: [{ token: "tok_abc", token_expires_at: "2026-04-01T00:00:00.000Z" }],
            error: null,
        });

        const result = await claimDesktopToken("ABCD1234");

        expect(result).toEqual({ token: "tok_abc", expiresAt: "2026-04-01T00:00:00.000Z" });
        expect(mockRpc).toHaveBeenCalledWith("claim_desktop_token", { p_code: "ABCD1234" });
    });

    it("uppercases and trims the input code", async () => {
        mockRpc.mockResolvedValue({
            data: [{ token: "tok_abc", token_expires_at: "2026-04-01T00:00:00.000Z" }],
            error: null,
        });

        await claimDesktopToken("  abcd1234  ");

        expect(mockRpc).toHaveBeenCalledWith("claim_desktop_token", { p_code: "ABCD1234" });
    });

    it("returns null when RPC returns empty array (code not found or expired)", async () => {
        mockRpc.mockResolvedValue({ data: [], error: null });

        expect(await claimDesktopToken("NOTEXIST")).toBeNull();
    });

    it("returns null on RPC error", async () => {
        mockRpc.mockResolvedValue({ data: null, error: { message: "rpc error" } });

        expect(await claimDesktopToken("ABCD1234")).toBeNull();
    });

    it("returns null for empty string input", async () => {
        expect(await claimDesktopToken("   ")).toBeNull();
        expect(mockRpc).not.toHaveBeenCalled();
    });

    it("consume-once: second call gets empty result (RPC already deleted the row)", async () => {
        mockRpc
            .mockResolvedValueOnce({
                data: [{ token: "tok_abc", token_expires_at: "2026-04-01T00:00:00.000Z" }],
                error: null,
            })
            .mockResolvedValueOnce({ data: [], error: null });

        const first = await claimDesktopToken("ABCD1234");
        const second = await claimDesktopToken("ABCD1234");

        expect(first).not.toBeNull();
        expect(second).toBeNull();
    });
});

describe("__resetDesktopTokenClaimsForTests", () => {
    it("calls delete on the table", async () => {
        const deleteMock = jest.fn().mockReturnValue({ neq: jest.fn().mockResolvedValue({}) });
        mockFrom.mockReturnValue({ delete: deleteMock });

        await __resetDesktopTokenClaimsForTests();

        expect(mockFrom).toHaveBeenCalledWith("desktop_token_claims");
        expect(deleteMock).toHaveBeenCalled();
    });
});
