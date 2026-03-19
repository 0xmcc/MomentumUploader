import { randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import { resolveMemoUserId } from "@/lib/memo-api-auth";
import { isMissingOpenClawSchemaError } from "@/lib/openclaw-compat";
import { sha256hex } from "@/lib/openclaw-registry";
import { supabaseAdmin } from "@/lib/supabase";

const REGISTRATION_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const TOKEN_NOTE =
    "This token is shown once and expires in 7 days. Use it to register your OpenClaw runtime.";
const MISSING_SCHEMA_ERROR =
    "OpenClaw registration tokens are unavailable until the latest database migration is applied.";

type RegistrationTokenBody = {
    force?: unknown;
};

type RegistrationTokenRpcRow = {
    status: "created" | "active_token_exists";
    expires_at: string;
};

function isOutdatedRegistrationTokenFunctionError(error: unknown): boolean {
    const maybeError = error as {
        code?: unknown;
        message?: unknown;
        details?: unknown;
    } | null;

    if (maybeError?.code !== "42702") {
        return false;
    }

    const diagnosticText = [maybeError?.message, maybeError?.details]
        .filter((value): value is string => typeof value === "string")
        .join(" ");

    return (
        diagnosticText.includes('column reference "status" is ambiguous') ||
        diagnosticText.includes('column reference "expires_at" is ambiguous')
    );
}

async function ensureRegistrationOwner(userId: string): Promise<boolean> {
    const { error } = await supabaseAdmin.from("users").upsert(
        { id: userId },
        { onConflict: "id", ignoreDuplicates: true }
    );

    return !error;
}

export async function POST(req: NextRequest): Promise<Response> {
    const userId = await resolveMemoUserId(req);
    if (!userId) {
        return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!(await ensureRegistrationOwner(userId))) {
        return Response.json(
            { error: "Failed to issue registration token." },
            { status: 500 }
        );
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

    if (error) {
        if (
            isMissingOpenClawSchemaError(error) ||
            isOutdatedRegistrationTokenFunctionError(error)
        ) {
            return Response.json(
                { error: MISSING_SCHEMA_ERROR },
                { status: 503 }
            );
        }

        return Response.json(
            { error: "Failed to issue registration token." },
            { status: 500 }
        );
    }

    if (!Array.isArray(data) || data.length === 0) {
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
