import { randomBytes } from "node:crypto";
import type { NextRequest } from "next/server";
import { sha256hex } from "@/lib/openclaw-registry";
import { supabaseAdmin } from "@/lib/supabase";

const REGISTER_RATE_LIMIT_WINDOW_SECONDS = 60;
const REGISTER_RATE_LIMIT_MAX_ATTEMPTS = 5;

type RegisterBody = {
    registration_token?: unknown;
    display_name?: unknown;
};

type RegisterRpcRow = {
    status: "registered" | "token_not_found" | "active_runtime_exists";
};

type RegisterRateLimitRpcRow = {
    allowed: boolean;
    retry_after_seconds: number;
};

function getRateLimitKey(req: NextRequest, registrationToken: string): string {
    const forwardedFor = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    const realIp = req.headers.get("x-real-ip")?.trim();
    const source = forwardedFor || realIp;

    // In deployed environments we rely on proxy-managed client IP headers.
    // When those are unavailable, fall back to a token-scoped key so the limiter
    // remains shared across instances rather than process-local.
    if (source) {
        return sha256hex(`openclaw-register:ip:${source}`);
    }

    return sha256hex(`openclaw-register:token:${sha256hex(registrationToken)}`);
}

async function consumeRegisterAttempt(
    req: NextRequest,
    registrationToken: string
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    const { data, error } = await supabaseAdmin.rpc(
        "consume_openclaw_register_rate_limit",
        {
            p_rate_limit_key: getRateLimitKey(req, registrationToken),
            p_max_attempts: REGISTER_RATE_LIMIT_MAX_ATTEMPTS,
            p_window_seconds: REGISTER_RATE_LIMIT_WINDOW_SECONDS,
        }
    );

    if (error || !Array.isArray(data) || data.length === 0) {
        throw new Error("Failed to consume OpenClaw register rate limit.");
    }

    const result = data[0] as RegisterRateLimitRpcRow;
    return {
        allowed: result.allowed,
        retryAfterSeconds: result.retry_after_seconds,
    };
}

export async function POST(req: NextRequest): Promise<Response> {
    let body: RegisterBody;
    try {
        body = (await req.json()) as RegisterBody;
    } catch {
        return Response.json({ error: "Invalid JSON body." }, { status: 400 });
    }

    const registrationToken =
        typeof body.registration_token === "string"
            ? body.registration_token.trim()
            : "";
    if (!registrationToken) {
        return Response.json(
            { error: "'registration_token' is required" },
            { status: 400 }
        );
    }

    let rateLimitResult: { allowed: boolean; retryAfterSeconds: number };
    try {
        rateLimitResult = await consumeRegisterAttempt(req, registrationToken);
    } catch {
        return Response.json(
            { error: "OpenClaw registration is temporarily unavailable." },
            { status: 503 }
        );
    }

    if (!rateLimitResult.allowed) {
        return Response.json(
            { error: "Too many requests" },
            {
                status: 429,
                headers: {
                    "Retry-After": String(rateLimitResult.retryAfterSeconds),
                },
            }
        );
    }

    const displayName =
        typeof body.display_name === "string" && body.display_name.trim()
            ? body.display_name.trim()
            : null;
    const openclawExternalId = `oc_acct_${randomBytes(8).toString("hex")}`;
    const secret = randomBytes(32).toString("hex");

    const { data, error } = await supabaseAdmin.rpc("register_openclaw_runtime", {
        p_token_hash: sha256hex(registrationToken),
        p_display_name: displayName,
        p_openclaw_external_id: openclawExternalId,
        p_secret_hash: sha256hex(secret),
    });

    if (error || !Array.isArray(data) || data.length === 0) {
        return Response.json(
            { error: "Failed to register OpenClaw runtime." },
            { status: 500 }
        );
    }

    const result = data[0] as RegisterRpcRow;
    if (result.status === "token_not_found") {
        return Response.json({ error: "Not found" }, { status: 404 });
    }

    if (result.status === "active_runtime_exists") {
        return Response.json(
            { error: "active_runtime_exists" },
            { status: 409 }
        );
    }

    return Response.json({
        openclaw_external_id: openclawExternalId,
        api_key: `${openclawExternalId}:${secret}`,
    });
}
