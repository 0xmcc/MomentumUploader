import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { resolveMemoUserId } from "@/lib/memo-api-auth";
import { lookupRuntimeByCredential } from "@/lib/openclaw-registry";
import { supabaseAdmin } from "@/lib/supabase";

export const OPENCLAW_INTERNAL_KEY_HEADER = "x-openclaw-internal-key";
export const OPENCLAW_API_KEY_HEADER = "x-openclaw-api-key";
export const MEMO_AGENT_ID_HEADER = "x-memo-agent-id";

export type AgentRow = {
    id: string;
    owner_user_id: string;
    name: string;
    description: string | null;
    status: "active" | "disabled";
    created_at: string;
};

type OptionalAgentContext =
    | {
          ok: true;
          memoUserId: string;
          agentId: string | null;
      }
    | {
          ok: false;
          status: number;
          error: string;
      };

export type OpenClawGatewayContext =
    | {
          ok: true;
          openclawExternalId: string;
      }
    | {
          ok: false;
          status: number;
          error: string;
      };

function readGatewayKey(req: NextRequest): string | null {
    const value =
        typeof req.headers?.get === "function"
            ? req.headers.get(OPENCLAW_INTERNAL_KEY_HEADER)?.trim()
            : null;
    return value ? value : null;
}

function readAgentId(req: NextRequest): string | null {
    const value =
        typeof req.headers?.get === "function"
            ? req.headers.get(MEMO_AGENT_ID_HEADER)?.trim()
            : null;
    return value ? value : null;
}

function readOpenClawApiKey(req: NextRequest): string | null {
    const value =
        typeof req.headers?.get === "function"
            ? req.headers.get(OPENCLAW_API_KEY_HEADER)?.trim()
            : null;
    return value ? value : null;
}

function secureCompare(left: string, right: string): boolean {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);

    if (leftBuffer.length !== rightBuffer.length) {
        return false;
    }

    return timingSafeEqual(leftBuffer, rightBuffer);
}

function resolveConfiguredOpenClawSecrets(): Record<string, string> {
    const raw = process.env.OPENCLAW_API_KEYS_JSON?.trim();
    if (!raw) {
        return {};
    }

    try {
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        return Object.fromEntries(
            Object.entries(parsed).filter(
                (entry): entry is [string, string] => typeof entry[1] === "string"
            )
        );
    } catch {
        return {};
    }
}

export function serializeAgent(agent: AgentRow) {
    return {
        id: agent.id,
        ownerUserId: agent.owner_user_id,
        name: agent.name,
        description: agent.description ?? null,
        status: agent.status,
        createdAt: agent.created_at,
    };
}

export async function validateOpenClawGateway(
    req: NextRequest
): Promise<OpenClawGatewayContext> {
    const apiKey = readOpenClawApiKey(req);
    if (!apiKey) {
        return { ok: false, status: 401, error: "Unauthorized" };
    }

    const parts = apiKey.split(":");
    if (parts.length !== 2) {
        return { ok: false, status: 401, error: "Unauthorized" };
    }

    const [accountIdRaw, secretRaw] = parts;
    const accountId = accountIdRaw.trim();
    const secret = secretRaw.trim();

    if (!accountId || !secret) {
        return { ok: false, status: 401, error: "Unauthorized" };
    }

    const runtime = await lookupRuntimeByCredential(accountId, secret);
    if (runtime) {
        return {
            ok: true,
            openclawExternalId: runtime.openclaw_external_id,
        };
    }

    const configuredSecrets = resolveConfiguredOpenClawSecrets();
    const expectedSecret = configuredSecrets[accountId];
    if (!expectedSecret || !secureCompare(secret, expectedSecret)) {
        return { ok: false, status: 401, error: "Unauthorized" };
    }

    return {
        ok: true,
        openclawExternalId: accountId,
    };
}

async function getOwnedAgent(agentId: string, userId: string): Promise<AgentRow | null> {
    const { data, error } = await supabaseAdmin
        .from("agents")
        .select("id, owner_user_id, name, description, status, created_at")
        .eq("id", agentId)
        .single();

    if (error || !data) {
        return null;
    }

    const agent = data as AgentRow;
    if (agent.owner_user_id !== userId || agent.status !== "active") {
        return null;
    }

    return agent;
}

export async function resolveOptionalAgentContext(
    req: NextRequest,
    expectedAgentId?: string
): Promise<OptionalAgentContext> {
    const memoUserId = await resolveMemoUserId(req);
    if (!memoUserId) {
        return { ok: false, status: 404, error: "Not found" };
    }

    const headerAgentId = readAgentId(req);
    const gatewayKey = readGatewayKey(req);
    const isAgentRequest = Boolean(expectedAgentId || headerAgentId || gatewayKey);

    if (!isAgentRequest) {
        return { ok: true, memoUserId, agentId: null };
    }

    const configuredKey = process.env.OPENCLAW_INTERNAL_API_KEY?.trim();
    if (!configuredKey || !gatewayKey || gatewayKey !== configuredKey) {
        return { ok: false, status: 403, error: "Forbidden" };
    }

    const agentId = expectedAgentId ?? headerAgentId;
    if (!agentId) {
        return { ok: false, status: 400, error: "'agentId' is required" };
    }

    if (expectedAgentId && headerAgentId && headerAgentId !== expectedAgentId) {
        return { ok: false, status: 403, error: "Forbidden" };
    }

    const agent = await getOwnedAgent(agentId, memoUserId);
    if (!agent) {
        return { ok: false, status: 404, error: "Agent not found" };
    }

    return { ok: true, memoUserId, agentId: agent.id };
}

export async function requireOwnedAgent(agentId: string, userId: string): Promise<AgentRow | null> {
    return getOwnedAgent(agentId, userId);
}
