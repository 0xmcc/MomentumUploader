/** @jest-environment node */

import { NextRequest } from "next/server";
import { GET } from "./route";
import { validateOpenClawGateway } from "@/lib/agents";
import { resolveMemoUserId } from "@/lib/memo-api-auth";
import { findMemoDiscussion, getOrCreateMemoDiscussion } from "@/lib/memo-discussion";
import { resolveMemoShare } from "@/lib/memo-share";
import { supabaseAdmin } from "@/lib/supabase";

jest.mock("@/lib/agents", () => ({
    validateOpenClawGateway: jest.fn(),
}));

jest.mock("@/lib/memo-api-auth", () => ({
    resolveMemoUserId: jest.fn(),
}));

jest.mock("@/lib/memo-discussion", () => ({
    findMemoDiscussion: jest.fn(),
    getOrCreateMemoDiscussion: jest.fn(),
}));

jest.mock("@/lib/memo-share", () => ({
    resolveMemoShare: jest.fn(),
}));

jest.mock("@/lib/supabase", () => ({
    supabaseAdmin: {
        from: jest.fn(),
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

describe("GET /api/s/:shareRef/openclaw-status", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (resolveMemoUserId as jest.Mock).mockResolvedValue("user-owner");
        (resolveMemoShare as jest.Mock).mockResolvedValue({ status: "ok", memo: sharedMemo });
        (validateOpenClawGateway as jest.Mock).mockResolvedValue({
            ok: true,
            openclawExternalId: "oc_acct_123",
        });
        (findMemoDiscussion as jest.Mock).mockResolvedValue({
            roomId: "room-1",
            ownerParticipantId: "owner-participant-1",
        });
        (getOrCreateMemoDiscussion as jest.Mock).mockResolvedValue({
            roomId: "room-1",
            ownerParticipantId: "owner-participant-1",
        });
    });

    function makeCurrentClaimChain(result: { data: unknown; error: unknown }) {
        const maybeSingle = jest.fn().mockResolvedValue(result);
        const limit = jest.fn(() => ({ maybeSingle }));
        const order = jest.fn(() => ({ limit }));
        const statusIn = jest.fn(() => ({ order }));
        const shareEq = jest.fn(() => ({ in: statusIn }));
        const select = jest.fn(() => ({ eq: shareEq }));

        return { select };
    }

    it("returns state none when no non-rejected claim exists", async () => {
        const currentClaim = makeCurrentClaimChain({ data: null, error: null });
        (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
            if (table === "openclaw_claim_requests") {
                return { select: currentClaim.select };
            }

            throw new Error(`Unexpected table ${table}`);
        });

        const req = new NextRequest("https://example.com/api/s/sharetoken1234/openclaw-status");
        const res = await GET(req, { params: Promise.resolve({ shareRef: "sharetoken1234" }) });
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body).toEqual({
            state: "none",
            agentId: null,
            roomId: null,
        });
        expect(findMemoDiscussion).not.toHaveBeenCalled();
    });

    it("returns pending_claim when an OpenClaw is awaiting owner confirmation", async () => {
        const currentClaim = makeCurrentClaimChain({
            data: {
                id: "claim-1",
                status: "pending",
                agent_id: null,
            },
            error: null,
        });
        (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
            if (table === "openclaw_claim_requests") {
                return { select: currentClaim.select };
            }

            throw new Error(`Unexpected table ${table}`);
        });

        const req = new NextRequest("https://example.com/api/s/sharetoken1234/openclaw-status");
        const res = await GET(req, { params: Promise.resolve({ shareRef: "sharetoken1234" }) });
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body).toEqual({
            state: "pending_claim",
            agentId: null,
            roomId: null,
        });
    });

    it("returns claimed with the owner-private room id once linked", async () => {
        const currentClaim = makeCurrentClaimChain({
            data: {
                id: "claim-1",
                status: "claimed",
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

        const req = new NextRequest("https://example.com/api/s/sharetoken1234/openclaw-status");
        const res = await GET(req, { params: Promise.resolve({ shareRef: "sharetoken1234" }) });
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body).toEqual({
            state: "claimed",
            agentId: "agent-1",
            roomId: "room-1",
        });
    });

    it("allows the linked OpenClaw runtime to resolve its claimed room via x-openclaw-api-key", async () => {
        (resolveMemoUserId as jest.Mock).mockResolvedValue(null);

        const currentClaim = makeCurrentClaimChain({
            data: {
                id: "claim-1",
                status: "claimed",
                agent_id: "agent-1",
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

        const req = new NextRequest("https://example.com/api/s/sharetoken1234/openclaw-status", {
            headers: new Headers({
                "x-openclaw-api-key": "oc_acct_123:secret-xyz",
            }),
        });
        const res = await GET(req, { params: Promise.resolve({ shareRef: "sharetoken1234" }) });
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body).toEqual({
            state: "claimed",
            agentId: "agent-1",
            roomId: "room-1",
        });
    });

    it("repairs a claimed room that is missing the owner participant before exposing it to the share page", async () => {
        const currentClaim = makeCurrentClaimChain({
            data: {
                id: "claim-1",
                status: "claimed",
                agent_id: "agent-1",
            },
            error: null,
        });
        (findMemoDiscussion as jest.Mock).mockResolvedValue({
            roomId: "room-stale",
            ownerParticipantId: null,
        });
        (getOrCreateMemoDiscussion as jest.Mock).mockResolvedValue({
            roomId: "room-repaired",
            ownerParticipantId: "owner-participant-1",
        });
        (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
            if (table === "openclaw_claim_requests") {
                return { select: currentClaim.select };
            }

            throw new Error(`Unexpected table ${table}`);
        });

        const req = new NextRequest("https://example.com/api/s/sharetoken1234/openclaw-status");
        const res = await GET(req, { params: Promise.resolve({ shareRef: "sharetoken1234" }) });
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(getOrCreateMemoDiscussion).toHaveBeenCalledWith(
            "memo-1",
            "user-owner",
            "Shared Memo"
        );
        expect(body).toEqual({
            state: "claimed",
            agentId: "agent-1",
            roomId: "room-repaired",
        });
    });

    it("falls back to the direct attachment state when the claim table is unavailable", async () => {
        const currentClaim = makeCurrentClaimChain({
            data: null,
            error: {
                code: "42P01",
                message: 'relation "public.openclaw_claim_requests" does not exist',
            },
        });

        const activeAgentEq = jest.fn().mockResolvedValue({
            data: [
                {
                    agent_id: "agent-legacy-1",
                    status: "active",
                },
            ],
            error: null,
        });
        const participantTypeEq = jest.fn(() => ({ eq: activeAgentEq }));
        const participantRoomEq = jest.fn(() => ({ eq: participantTypeEq }));
        const participantSelect = jest.fn(() => ({ eq: participantRoomEq }));

        const ownerAgentsOrder = jest.fn().mockResolvedValue({
            data: [
                {
                    id: "agent-legacy-1",
                    owner_user_id: "user-owner",
                    name: "OpenClaw",
                    description: "Connected OpenClaw account: oc_acct_123",
                    status: "active",
                    created_at: "2026-03-18T00:00:00.000Z",
                },
            ],
            error: null,
        });
        const ownerAgentsOwnerEq = jest.fn(() => ({ order: ownerAgentsOrder }));
        const ownerAgentsSelect = jest.fn(() => ({ eq: ownerAgentsOwnerEq }));

        (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
            if (table === "openclaw_claim_requests") {
                return { select: currentClaim.select };
            }

            if (table === "memo_room_participants") {
                return { select: participantSelect };
            }

            if (table === "agents") {
                return { select: ownerAgentsSelect };
            }

            throw new Error(`Unexpected table ${table}`);
        });

        const req = new NextRequest("https://example.com/api/s/sharetoken1234/openclaw-status");
        const res = await GET(req, { params: Promise.resolve({ shareRef: "sharetoken1234" }) });
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body).toEqual({
            state: "claimed",
            agentId: "agent-legacy-1",
            roomId: "room-1",
        });
    });
});
