import { supabaseAdmin } from "@/lib/supabase";
import { isMissingOpenClawSchemaError } from "@/lib/openclaw-compat";

export type OpenClawClaimStatus = "pending" | "claimed" | "rejected";

export type OpenClawClaimRow = {
    id: string;
    share_ref: string;
    memo_id: string;
    owner_user_id: string;
    openclaw_external_id: string;
    openclaw_display_name: string | null;
    openclaw_context: string | null;
    status: OpenClawClaimStatus;
    agent_id: string | null;
    created_at?: string;
    claimed_at: string | null;
};

const OPENCLAW_CLAIM_SELECT =
    "id, share_ref, memo_id, owner_user_id, openclaw_external_id, openclaw_display_name, openclaw_context, status, agent_id, created_at, claimed_at";

type OpenClawClaimLookupResult = {
    claim: OpenClawClaimRow | null;
    missingSchema: boolean;
};

export async function getCurrentOpenClawClaimState(
    shareRef: string
): Promise<OpenClawClaimLookupResult> {
    const { data, error } = await supabaseAdmin
        .from("openclaw_claim_requests")
        .select(OPENCLAW_CLAIM_SELECT)
        .eq("share_ref", shareRef)
        .in("status", ["pending", "claimed"])
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) {
        return {
            claim: null,
            missingSchema: isMissingOpenClawSchemaError(error),
        };
    }

    return {
        claim: data ? (data as OpenClawClaimRow) : null,
        missingSchema: false,
    };
}

export async function getCurrentOpenClawClaim(
    shareRef: string
): Promise<OpenClawClaimRow | null> {
    const result = await getCurrentOpenClawClaimState(shareRef);
    return result.claim;
}

export async function getPendingOpenClawClaimState(
    shareRef: string
): Promise<OpenClawClaimLookupResult> {
    const { data, error } = await supabaseAdmin
        .from("openclaw_claim_requests")
        .select(OPENCLAW_CLAIM_SELECT)
        .eq("share_ref", shareRef)
        .eq("status", "pending")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    if (error) {
        return {
            claim: null,
            missingSchema: isMissingOpenClawSchemaError(error),
        };
    }

    return {
        claim: data ? (data as OpenClawClaimRow) : null,
        missingSchema: false,
    };
}

export async function getPendingOpenClawClaim(
    shareRef: string
): Promise<OpenClawClaimRow | null> {
    const result = await getPendingOpenClawClaimState(shareRef);
    return result.claim;
}
