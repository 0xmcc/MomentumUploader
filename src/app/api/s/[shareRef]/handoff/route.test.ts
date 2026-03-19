/** @jest-environment node */

import { NextRequest } from "next/server";
import { POST } from "./route";
import { getOrCreateMemoDiscussion } from "@/lib/memo-discussion";
import { resolveMemoShare } from "@/lib/memo-share";
import { supabaseAdmin } from "@/lib/supabase";

jest.mock("@/lib/memo-discussion", () => ({
    getOrCreateMemoDiscussion: jest.fn(),
}));

jest.mock("@/lib/memo-share", () => ({
    resolveMemoShare: jest.fn(),
}));

jest.mock("@/lib/supabase", () => ({
    supabaseAdmin: {
        from: jest.fn(),
        rpc: jest.fn(),
    },
}));

const sharedMemo = {
    memoId: "memo-1",
    ownerUserId: "user-owner",
    shareToken: "sharetoken1234",
    title: "Shared Memo",
    transcript: "Transcript",
    transcriptStatus: "complete",
    transcriptSegments: null,
    mediaUrl: "https://example.com/audio.webm",
    createdAt: "2026-03-16T12:00:00.000Z",
    sharedAt: "2026-03-16T12:05:00.000Z",
    expiresAt: null,
    isLiveRecording: false,
};

describe("POST /api/s/:shareRef/handoff", () => {
    const previousApiKeysJson = process.env.OPENCLAW_API_KEYS_JSON;

    beforeEach(() => {
        jest.clearAllMocks();
        process.env.OPENCLAW_API_KEYS_JSON = JSON.stringify({
            oc_acct_123: "secret-xyz",
        });
        (resolveMemoShare as jest.Mock).mockResolvedValue({ status: "ok", memo: sharedMemo });
        (getOrCreateMemoDiscussion as jest.Mock).mockResolvedValue({
            roomId: "room-1",
            ownerParticipantId: "owner-participant-1",
        });
    });

    afterAll(() => {
        process.env.OPENCLAW_API_KEYS_JSON = previousApiKeysJson;
    });

    function makeCurrentClaimChain(result: { data: unknown; error: unknown }) {
        const maybeSingle = jest.fn().mockResolvedValue(result);
        const limit = jest.fn(() => ({ maybeSingle }));
        const order = jest.fn(() => ({ limit }));
        const statusIn = jest.fn(() => ({ order }));
        const shareEq = jest.fn(() => ({ in: statusIn }));
        const select = jest.fn(() => ({ eq: shareEq }));

        return {
            select,
            maybeSingle,
        };
    }

    function makeRequest(
        body: Record<string, unknown>,
        apiKey = "oc_acct_123:secret-xyz"
    ): NextRequest {
        return new NextRequest("https://example.com/api/s/sharetoken1234/handoff", {
            method: "POST",
            headers: {
                "content-type": "application/json",
                "x-openclaw-api-key": apiKey,
            },
            body: JSON.stringify(body),
        });
    }

    it("consumes a valid nonce and creates a pending claim for a first-time handoff", async () => {
        const currentClaim = makeCurrentClaimChain({ data: null, error: null });
        (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
            if (table === "openclaw_claim_requests") {
                return { select: currentClaim.select };
            }

            throw new Error(`Unexpected table ${table}`);
        });
        (supabaseAdmin.rpc as jest.Mock).mockResolvedValue({
            data: [{ id: "claim-1" }],
            error: null,
        });

        const res = await POST(makeRequest({ nonce: "invite-nonce-1", display_name: "My OpenClaw" }), {
            params: Promise.resolve({ shareRef: "sharetoken1234" }),
        });
        const body = await res.json();

        expect(res.status).toBe(202);
        expect(body).toEqual({
            status: "pending_claim",
            shareRef: "sharetoken1234",
        });
        expect(supabaseAdmin.rpc).toHaveBeenCalledWith(
            "claim_openclaw_invite_nonce",
            expect.objectContaining({
                p_share_ref: "sharetoken1234",
                p_memo_id: "memo-1",
                p_owner_user_id: "user-owner",
                p_openclaw_external_id: "oc_acct_123",
                p_nonce: "invite-nonce-1",
                p_openclaw_display_name: "My OpenClaw",
            })
        );
    });

    it("rejects bad or missing invite nonces for first-time handoffs", async () => {
        const currentClaim = makeCurrentClaimChain({ data: null, error: null });
        (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
            if (table === "openclaw_claim_requests") {
                return { select: currentClaim.select };
            }

            throw new Error(`Unexpected table ${table}`);
        });
        (supabaseAdmin.rpc as jest.Mock).mockResolvedValue({ data: [], error: null });

        const res = await POST(makeRequest({ nonce: "bad-nonce" }), {
            params: Promise.resolve({ shareRef: "sharetoken1234" }),
        });

        expect(res.status).toBe(401);
    });

    it("returns pending_claim idempotently when the same OpenClaw retries a pending handoff", async () => {
        const currentClaim = makeCurrentClaimChain({
            data: {
                id: "claim-1",
                status: "pending",
                openclaw_external_id: "oc_acct_123",
            },
            error: null,
        });
        (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
            if (table === "openclaw_claim_requests") {
                return { select: currentClaim.select };
            }

            throw new Error(`Unexpected table ${table}`);
        });

        const res = await POST(makeRequest({ nonce: "ignored-on-retry" }), {
            params: Promise.resolve({ shareRef: "sharetoken1234" }),
        });
        const body = await res.json();

        expect(res.status).toBe(202);
        expect(body).toEqual({
            status: "pending_claim",
            shareRef: "sharetoken1234",
        });
        expect(supabaseAdmin.rpc).not.toHaveBeenCalled();
    });

    it("returns already_claimed idempotently for the same claimed OpenClaw", async () => {
        const currentClaim = makeCurrentClaimChain({
            data: {
                id: "claim-1",
                status: "claimed",
                openclaw_external_id: "oc_acct_123",
                agent_id: "agent-1",
            },
            error: null,
        });
        (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
            if (table === "openclaw_claim_requests") {
                return { select: currentClaim.select };
            }

            throw new Error(`Unexpected table ${table}`);
        });

        const res = await POST(makeRequest({ nonce: "ignored-on-claimed-retry" }), {
            params: Promise.resolve({ shareRef: "sharetoken1234" }),
        });
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body).toEqual({
            status: "already_claimed",
            shareRef: "sharetoken1234",
            agentId: "agent-1",
            roomId: "room-1",
        });
        expect(supabaseAdmin.rpc).not.toHaveBeenCalled();
        expect(getOrCreateMemoDiscussion).toHaveBeenCalledWith(
            "memo-1",
            "user-owner",
            "Shared Memo"
        );
    });

    it("rejects a different OpenClaw identity when the share is already claimed", async () => {
        const currentClaim = makeCurrentClaimChain({
            data: {
                id: "claim-1",
                status: "claimed",
                openclaw_external_id: "oc_acct_other",
            },
            error: null,
        });
        (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
            if (table === "openclaw_claim_requests") {
                return { select: currentClaim.select };
            }

            throw new Error(`Unexpected table ${table}`);
        });

        const res = await POST(makeRequest({ nonce: "invite-nonce-1" }), {
            params: Promise.resolve({ shareRef: "sharetoken1234" }),
        });

        expect(res.status).toBe(409);
        expect(supabaseAdmin.rpc).not.toHaveBeenCalled();
    });

    it("matches share-token failure semantics", async () => {
        const invalidRes = await POST(makeRequest({ nonce: "n-1" }), {
            params: Promise.resolve({ shareRef: "nope!" }),
        });
        expect(invalidRes.status).toBe(404);

        (resolveMemoShare as jest.Mock).mockResolvedValueOnce({ status: "not_found" });
        const notFoundRes = await POST(makeRequest({ nonce: "n-1" }), {
            params: Promise.resolve({ shareRef: "sharetoken1234" }),
        });
        expect(notFoundRes.status).toBe(404);

        (resolveMemoShare as jest.Mock).mockResolvedValueOnce({ status: "revoked" });
        const revokedRes = await POST(makeRequest({ nonce: "n-1" }), {
            params: Promise.resolve({ shareRef: "sharetoken1234" }),
        });
        expect(revokedRes.status).toBe(410);

        (resolveMemoShare as jest.Mock).mockResolvedValueOnce({ status: "expired" });
        const expiredRes = await POST(makeRequest({ nonce: "n-1" }), {
            params: Promise.resolve({ shareRef: "sharetoken1234" }),
        });
        expect(expiredRes.status).toBe(410);
    });

    it("falls back to a direct attachment flow when the claim schema is unavailable", async () => {
        const missingClaimMaybeSingle = jest.fn().mockResolvedValue({
            data: null,
            error: {
                code: "42P01",
                message: 'relation "public.openclaw_claim_requests" does not exist',
            },
        });
        const missingClaimLimit = jest.fn(() => ({ maybeSingle: missingClaimMaybeSingle }));
        const missingClaimOrder = jest.fn(() => ({ limit: missingClaimLimit }));
        const missingClaimStatusIn = jest.fn(() => ({ order: missingClaimOrder }));
        const missingClaimShareEq = jest.fn(() => ({ in: missingClaimStatusIn }));
        const missingClaimSelect = jest.fn(() => ({ eq: missingClaimShareEq }));

        const ownerAgentsOrder = jest.fn().mockResolvedValue({
            data: [],
            error: null,
        });
        const ownerAgentsEq = jest.fn(() => ({ order: ownerAgentsOrder }));
        const ownerAgentsSelect = jest.fn(() => ({ eq: ownerAgentsEq }));
        const agentInsertSingle = jest.fn().mockResolvedValue({
            data: {
                id: "agent-1",
                owner_user_id: "user-owner",
                name: "My OpenClaw",
                description: "Connected OpenClaw account: oc_acct_123",
                status: "active",
                created_at: "2026-03-18T00:00:00.000Z",
            },
            error: null,
        });
        const agentInsert = jest.fn(() => ({
            select: jest.fn(() => ({ single: agentInsertSingle })),
        }));

        const participantMaybeSingle = jest.fn().mockResolvedValue({
            data: null,
            error: null,
        });
        const participantAgentEq = jest.fn(() => ({ maybeSingle: participantMaybeSingle }));
        const participantRoomEq = jest.fn(() => ({ eq: participantAgentEq }));
        const participantSelect = jest.fn(() => ({ eq: participantRoomEq }));
        const participantInsertSingle = jest.fn().mockResolvedValue({
            data: { id: "participant-1" },
            error: null,
        });
        const participantInsert = jest.fn(() => ({
            select: jest.fn(() => ({ single: participantInsertSingle })),
        }));

        const roomStateUpsert = jest.fn().mockResolvedValue({ error: null });

        (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
            if (table === "openclaw_claim_requests") {
                return { select: missingClaimSelect };
            }

            if (table === "agents") {
                return { select: ownerAgentsSelect, insert: agentInsert };
            }

            if (table === "memo_room_participants") {
                return { select: participantSelect, insert: participantInsert };
            }

            if (table === "agent_room_state") {
                return { upsert: roomStateUpsert };
            }

            throw new Error(`Unexpected table ${table}`);
        });

        const res = await POST(makeRequest({ display_name: "My OpenClaw" }), {
            params: Promise.resolve({ shareRef: "sharetoken1234" }),
        });
        const body = await res.json();

        expect(res.status).toBe(202);
        expect(body).toEqual({
            status: "pending_claim",
            shareRef: "sharetoken1234",
        });
        expect(getOrCreateMemoDiscussion).toHaveBeenCalledWith(
            "memo-1",
            "user-owner",
            "Shared Memo"
        );
        expect(agentInsert).toHaveBeenCalledWith({
            owner_user_id: "user-owner",
            name: "My OpenClaw",
            description: "Connected OpenClaw account: oc_acct_123",
        });
        expect(participantInsert).toHaveBeenCalledWith(
            expect.objectContaining({
                memo_room_id: "room-1",
                participant_type: "agent",
                agent_id: "agent-1",
                status: "active",
            })
        );
        expect(supabaseAdmin.rpc).not.toHaveBeenCalled();
    });
});
