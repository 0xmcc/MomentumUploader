import { randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import { resolveMemoUserId } from "@/lib/memo-api-auth";
import { sha256hex } from "@/lib/openclaw-registry";
import { supabaseAdmin } from "@/lib/supabase";

const REGISTRATION_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TOKEN_NOTE =
    "This token is shown once and expires in 7 days. Use it to register your OpenClaw runtime.";

type RegistrationTokenBody = {
    force?: unknown;
};

type RegistrationTokenRpcRow = {
    status: "created" | "active_token_exists";
    expires_at: string;
};

export async function POST(req: NextRequest): Promise<Response> {
    const userId = await resolveMemoUserId(req);
    if (!userId) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    let body: RegistrationTokenBody = {};
    try {
        body = (await req.json()) as RegistrationTokenBody;
    } catch {
        body = {};
    }

    const rawToken = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + REGISTRATION_TOKEN_TTL_MS).toISOString();

    const { data, error } = await supabaseAdmin.rpc(
        "issue_openclaw_registration_token",
        {
            p_owner_user_id: userId,
            p_token_hash: sha256hex(rawToken),
            p_force: body.force === true,
            p_expires_at: expiresAt,
        }
    );

    if (error || !Array.isArray(data) || data.length === 0) {
        return Response.json(
            { error: "Failed to issue registration token." },
            { status: 500 }
        );
    }

    const result = data[0] as RegistrationTokenRpcRow;
    if (result.status === "active_token_exists") {
        return Response.json(
            {
                error: "active_token_exists",
                expires_at: result.expires_at,
            },
            { status: 409 }
        );
    }

    return Response.json({
        registration_token: rawToken,
        expires_at: result.expires_at,
        note: TOKEN_NOTE,
    });
}
