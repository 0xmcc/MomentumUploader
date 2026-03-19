/** @jest-environment node */

import { readFileSync } from "node:fs";
import path from "node:path";

describe("20260319120000_rotate_existing_openclaw_runtime_credentials migration", () => {
    it("rotates active runtime credentials instead of failing with active_runtime_exists", () => {
        const migration = readFileSync(
            path.join(
                process.cwd(),
                "supabase/migrations/20260319120000_rotate_existing_openclaw_runtime_credentials.sql"
            ),
            "utf8"
        );

        expect(migration).toMatch(
            /create or replace function public\.register_openclaw_runtime/i
        );
        expect(migration).toContain("registration_status := 'rotated_existing_runtime'");
        expect(migration).toContain(
            "update public.openclaw_runtimes as runtimes"
        );
        expect(migration).toContain("set secret_hash = p_secret_hash");
        expect(migration).toContain(
            "where runtimes.owner_user_id = active_token.owner_user_id"
        );
        expect(migration).toContain(
            "update public.openclaw_registration_tokens as registration_tokens"
        );
        expect(migration).toContain("set status = 'consumed'");
    });
});
