/** @jest-environment node */

import { NextRequest } from "next/server";
import { DELETE, POST } from "./route";
import { resolveMemoUserId } from "@/lib/memo-api-auth";
import { findMemoDiscussion, getOrCreateMemoDiscussion } from "@/lib/memo-discussion";
import { resolveMemoShare } from "@/lib/memo-share";
import { supabaseAdmin } from "@/lib/supabase";

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

describe("POST /api/s/:shareRef/claim", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (resolveMemoUserId as jest.Mock).mockResolvedValue("user-owner");
        (resolveMemoShare as jest.Mock).mockResolvedValue({ status: "ok", memo: sharedMemo });
        (getOrCreateMemoDiscussion as jest.Mock).mockResolvedValue({
            roomId: "room-1",
            ownerParticipantId: "owner-participant-1",
        });
    });

    function makePendingClaimSelect(result: { data: unknown; error: unknown }) {
        const maybeSingle = jest.fn().mockResolvedValue(result);
        const limit = jest.fn(() => ({ maybeSingle }));
        const order = jest.fn(() => ({ limit }));
        const statusEq = jest.fn(() => ({ order }));
        const shareEq = jest.fn(() => ({ eq: statusEq }));
        const select = jest.fn(() => ({ eq: shareEq }));

        return { select };
    }

    it("reuses an existing agent row and reactivates a removed participant", async () => {
        const pendingClaim = makePendingClaimSelect({
            data: {
                id: "claim-1",
                share_ref: "sharetoken1234",
                memo_id: "memo-1",
                owner_user_id: "user-owner",
                openclaw_external_id: "oc_acct_123",
                openclaw_display_name: "My OpenClaw",
                openclaw_context: "telegram",
                status: "pending",
            },
            error: null,
        });

        const agentMaybeSingle = jest.fn().mockResolvedValue({
            data: {
                id: "agent-1",
                owner_user_id: "user-owner",
                name: "Existing OpenClaw",
                description: null,
                status: "active",
                created_at: "2026-03-16T12:10:00.000Z",
            },
            error: null,
        });
        const agentExternalEq = jest.fn(() => ({ maybeSingle: agentMaybeSingle }));
        const agentOwnerEq = jest.fn(() => ({ eq: agentExternalEq }));
        const agentSelect = jest.fn(() => ({ eq: agentOwnerEq }));
        const agentUpdateIdEq = jest.fn().mockResolvedValue({ error: null });
        const agentUpdate = jest.fn(() => ({ eq: agentUpdateIdEq }));

        const participantMaybeSingle = jest.fn().mockResolvedValue({
            data: {
                id: "participant-agent-1",
                status: "removed",
            },
            error: null,
        });
        const participantAgentEq = jest.fn(() => ({ maybeSingle: participantMaybeSingle }));
        const participantRoomEq = jest.fn(() => ({ eq: participantAgentEq }));
        const participantSelect = jest.fn(() => ({ eq: participantRoomEq }));

        const participantUpdateSingle = jest.fn().mockResolvedValue({
            data: { id: "participant-agent-1" },
            error: null,
        });
        const participantUpdateSelect = jest.fn(() => ({ single: participantUpdateSingle }));
        const participantUpdateAgentEq = jest.fn(() => ({ select: participantUpdateSelect }));
        const participantUpdateRoomEq = jest.fn(() => ({ eq: participantUpdateAgentEq }));
        const participantUpdate = jest.fn(() => ({ eq: participantUpdateRoomEq }));

        const claimUpdateIdEq = jest.fn().mockResolvedValue({ error: null });
        const claimUpdate = jest.fn(() => ({ eq: claimUpdateIdEq }));
        const agentRoomStateUpsert = jest.fn().mockResolvedValue({ error: null });

        (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
            if (table === "openclaw_claim_requests") {
                return { select: pendingClaim.select, update: claimUpdate };
            }

            if (table === "agents") {
                return { select: agentSelect, update: agentUpdate };
            }

            if (table === "memo_room_participants") {
                return {
                    select: participantSelect,
                    update: participantUpdate,
                };
            }

            if (table === "agent_room_state") {
                return {
                    upsert: agentRoomStateUpsert,
                };
            }

            throw new Error(`Unexpected table ${table}`);
        });

        const req = new NextRequest("https://example.com/api/s/sharetoken1234/claim", {
            method: "POST",
        });
        const res = await POST(req, { params: Promise.resolve({ shareRef: "sharetoken1234" }) });
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(getOrCreateMemoDiscussion).toHaveBeenCalledWith(
            "memo-1",
            "user-owner",
            "Shared Memo"
        );
        expect(participantUpdate).toHaveBeenCalledWith({
            status: "active",
            removed_at: null,
        });
        expect(claimUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                status: "claimed",
                agent_id: "agent-1",
                claimed_at: expect.any(String),
            })
        );
        expect(body).toEqual({
            agentId: "agent-1",
            participantId: "participant-agent-1",
        });
    });

    it("creates a new agent row and participant when the OpenClaw is new to this owner", async () => {
        const pendingClaim = makePendingClaimSelect({
            data: {
                id: "claim-1",
                share_ref: "sharetoken1234",
                memo_id: "memo-1",
                owner_user_id: "user-owner",
                openclaw_external_id: "oc_acct_123",
                openclaw_display_name: "My OpenClaw",
                openclaw_context: "telegram",
                status: "pending",
            },
            error: null,
        });

        const agentMaybeSingle = jest.fn().mockResolvedValue({
            data: null,
            error: null,
        });
        const agentExternalEq = jest.fn(() => ({ maybeSingle: agentMaybeSingle }));
        const agentOwnerEq = jest.fn(() => ({ eq: agentExternalEq }));
        const agentSelect = jest.fn(() => ({ eq: agentOwnerEq }));

        const agentInsertSingle = jest.fn().mockResolvedValue({
            data: {
                id: "agent-2",
                owner_user_id: "user-owner",
                name: "My OpenClaw",
                description: null,
                status: "active",
                created_at: "2026-03-16T12:10:00.000Z",
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
            data: { id: "participant-agent-2" },
            error: null,
        });
        const participantInsert = jest.fn(() => ({
            select: jest.fn(() => ({ single: participantInsertSingle })),
        }));

        const claimUpdateIdEq = jest.fn().mockResolvedValue({ error: null });
        const claimUpdate = jest.fn(() => ({ eq: claimUpdateIdEq }));
        const agentRoomStateUpsert = jest.fn().mockResolvedValue({ error: null });

        (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
            if (table === "openclaw_claim_requests") {
                return { select: pendingClaim.select, update: claimUpdate };
            }

            if (table === "agents") {
                return { select: agentSelect, insert: agentInsert };
            }

            if (table === "memo_room_participants") {
                return {
                    select: participantSelect,
                    insert: participantInsert,
                };
            }

            if (table === "agent_room_state") {
                return {
                    upsert: agentRoomStateUpsert,
                };
            }

            throw new Error(`Unexpected table ${table}`);
        });

        const req = new NextRequest("https://example.com/api/s/sharetoken1234/claim", {
            method: "POST",
        });
        const res = await POST(req, { params: Promise.resolve({ shareRef: "sharetoken1234" }) });
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(agentInsert).toHaveBeenCalledWith({
            owner_user_id: "user-owner",
            name: "My OpenClaw",
            description: null,
            openclaw_external_id: "oc_acct_123",
            openclaw_display_name: "My OpenClaw",
            openclaw_context: "telegram",
        });
        expect(participantInsert).toHaveBeenCalledWith(
            expect.objectContaining({
                memo_room_id: "room-1",
                participant_type: "agent",
                agent_id: "agent-2",
                status: "active",
            })
        );
        expect(body).toEqual({
            agentId: "agent-2",
            participantId: "participant-agent-2",
        });
    });
});

describe("DELETE /api/s/:shareRef/claim", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        (resolveMemoUserId as jest.Mock).mockResolvedValue("user-owner");
        (resolveMemoShare as jest.Mock).mockResolvedValue({ status: "ok", memo: sharedMemo });
        (findMemoDiscussion as jest.Mock).mockResolvedValue({
            roomId: "room-1",
            ownerParticipantId: "owner-participant-1",
        });
    });

    function makeCurrentClaimSelect(result: { data: unknown; error: unknown }) {
        const maybeSingle = jest.fn().mockResolvedValue(result);
        const limit = jest.fn(() => ({ maybeSingle }));
        const order = jest.fn(() => ({ limit }));
        const statusIn = jest.fn(() => ({ order }));
        const shareEq = jest.fn(() => ({ in: statusIn }));
        const select = jest.fn(() => ({ eq: shareEq }));

        return { select };
    }

    it("removes the linked participant and rejects the current claim", async () => {
        const currentClaim = makeCurrentClaimSelect({
            data: {
                id: "claim-1",
                status: "claimed",
                agent_id: "agent-1",
            },
            error: null,
        });

        const participantMaybeSingle = jest.fn().mockResolvedValue({
            data: { id: "participant-agent-1" },
            error: null,
        });
        const participantAgentEq = jest.fn(() => ({ maybeSingle: participantMaybeSingle }));
        const participantRoomEq = jest.fn(() => ({ eq: participantAgentEq }));
        const participantSelect = jest.fn(() => ({ eq: participantRoomEq }));

        const participantUpdateAgentEq = jest.fn().mockResolvedValue({ error: null });
        const participantUpdateRoomEq = jest.fn(() => ({ eq: participantUpdateAgentEq }));
        const participantUpdate = jest.fn(() => ({ eq: participantUpdateRoomEq }));
        const claimUpdateIdEq = jest.fn().mockResolvedValue({ error: null });
        const claimUpdate = jest.fn(() => ({ eq: claimUpdateIdEq }));

        (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
            if (table === "openclaw_claim_requests") {
                return { select: currentClaim.select, update: claimUpdate };
            }

            if (table === "memo_room_participants") {
                return { select: participantSelect, update: participantUpdate };
            }

            throw new Error(`Unexpected table ${table}`);
        });

        const req = new NextRequest("https://example.com/api/s/sharetoken1234/claim", {
            method: "DELETE",
        });
        const res = await DELETE(req, { params: Promise.resolve({ shareRef: "sharetoken1234" }) });

        expect(res.status).toBe(204);
        expect(participantUpdate).toHaveBeenCalledWith({
            status: "removed",
            removed_at: expect.any(String),
        });
        expect(claimUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                status: "rejected",
            })
        );
    });
});
