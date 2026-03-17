/** @jest-environment node */

import { NextRequest } from "next/server";
import { GET, POST } from "./route";
import { resolveMemoUserId } from "@/lib/memo-api-auth";
import { supabaseAdmin } from "@/lib/supabase";

jest.mock("@/lib/memo-api-auth", () => ({
    resolveMemoUserId: jest.fn(),
}));

jest.mock("@/lib/supabase");

describe("GET /api/agents", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("lists the current owner's agent roster", async () => {
        (resolveMemoUserId as jest.Mock).mockResolvedValue("owner-user");

        const ownerEq = jest.fn(() => ({
            order: jest.fn().mockResolvedValue({
                data: [
                    {
                        id: "agent-1",
                        owner_user_id: "owner-user",
                        name: "Coach",
                        description: "Helps review calls",
                        status: "active",
                        created_at: "2026-03-16T18:00:00.000Z",
                    },
                ],
                error: null,
            }),
        }));
        const select = jest.fn(() => ({ eq: ownerEq }));

        (supabaseAdmin.from as jest.Mock).mockReturnValue({ select });

        const req = { nextUrl: new URL("https://example.com/api/agents") } as NextRequest;
        const res = await GET(req);
        const body = await res.json();

        expect(res.status).toBe(200);
        expect(body.agents).toEqual([
            expect.objectContaining({
                id: "agent-1",
                ownerUserId: "owner-user",
                name: "Coach",
                status: "active",
            }),
        ]);
    });
});

describe("POST /api/agents", () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("creates an agent owned by the current user", async () => {
        (resolveMemoUserId as jest.Mock).mockResolvedValue("owner-user");

        const insertSingle = jest.fn().mockResolvedValue({
            data: {
                id: "agent-1",
                owner_user_id: "owner-user",
                name: "Coach",
                description: "Helps review calls",
                status: "active",
                created_at: "2026-03-16T18:00:00.000Z",
            },
            error: null,
        });
        const insert = jest.fn(() => ({
            select: jest.fn(() => ({ single: insertSingle })),
        }));

        (supabaseAdmin.from as jest.Mock).mockReturnValue({ insert });

        const req = {
            json: jest.fn().mockResolvedValue({
                name: "Coach",
                description: "Helps review calls",
            }),
        } as unknown as NextRequest;

        const res = await POST(req);
        const body = await res.json();

        expect(res.status).toBe(201);
        expect(insert).toHaveBeenCalledWith({
            owner_user_id: "owner-user",
            name: "Coach",
            description: "Helps review calls",
        });
        expect(body.agent).toMatchObject({
            id: "agent-1",
            ownerUserId: "owner-user",
            name: "Coach",
            status: "active",
        });
    });
});
