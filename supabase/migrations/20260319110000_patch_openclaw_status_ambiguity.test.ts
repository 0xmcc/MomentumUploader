/** @jest-environment node */

import { readFileSync } from "node:fs";
import path from "node:path";

describe("20260319110000_patch_openclaw_status_ambiguity migration", () => {
    it("qualifies status references inside the OpenClaw registration functions", () => {
        const migration = readFileSync(
            path.join(
                process.cwd(),
                "supabase/migrations/20260319110000_patch_openclaw_status_ambiguity.sql"
            ),
            "utf8"
        );

        expect(migration).toMatch(
            /create or replace function public\.issue_openclaw_registration_token/i
        );
        expect(migration).toContain("active_tokens.status = 'active'");
        expect(migration).toContain("active_tokens.expires_at <= now()");
        expect(migration).toContain("latest_active_token.status = 'active'");

        expect(migration).toMatch(
            /create or replace function public\.register_openclaw_runtime/i
        );
        expect(migration).toContain("registration_tokens.status = 'active'");
        expect(migration).toContain("runtimes.status = 'active'");
        expect(migration).toContain(
            "runtimes.owner_user_id = active_token.owner_user_id"
        );
    });
});
