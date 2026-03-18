import { createHash, timingSafeEqual } from "node:crypto";
import { isMissingOpenClawSchemaError } from "@/lib/openclaw-compat";
import { supabaseAdmin } from "@/lib/supabase";

type OpenClawRuntimeRow = {
    openclaw_external_id: string;
    secret_hash: string;
};

export function sha256hex(value: string): string {
    return createHash("sha256").update(value).digest("hex");
}

function secureCompareHex(leftHex: string, rightHex: string): boolean {
    try {
        const leftBuffer = Buffer.from(leftHex, "hex");
        const rightBuffer = Buffer.from(rightHex, "hex");

        if (
            leftBuffer.length === 0 ||
            rightBuffer.length === 0 ||
            leftBuffer.length !== rightBuffer.length
        ) {
            return false;
        }

        return timingSafeEqual(leftBuffer, rightBuffer);
    } catch {
        return false;
    }
}

export async function lookupRuntimeByCredential(
    accountId: string,
    secret: string
): Promise<{ openclaw_external_id: string } | null> {
    try {
        const { data, error } = await supabaseAdmin
            .from("openclaw_runtimes")
            .select("openclaw_external_id, secret_hash")
            .eq("openclaw_external_id", accountId)
            .eq("status", "active")
            .maybeSingle();

        if (error) {
            if (isMissingOpenClawSchemaError(error)) {
                return null;
            }

            return null;
        }

        if (!data) {
            return null;
        }

        const runtime = data as OpenClawRuntimeRow;
        if (!secureCompareHex(sha256hex(secret), runtime.secret_hash)) {
            return null;
        }

        return {
            openclaw_external_id: runtime.openclaw_external_id,
        };
    } catch {
        return null;
    }
}
