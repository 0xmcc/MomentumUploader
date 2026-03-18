/** @jest-environment node */

import { readFileSync } from "node:fs";
import path from "node:path";

describe("20260319090000_patch_openclaw_runtime_registration migration", () => {
    it("patches runtime registration ordering and adds the shared register rate limiter", () => {
        const migration = readFileSync(
            path.join(
                process.cwd(),
                "supabase/migrations/20260319090000_patch_openclaw_runtime_registration.sql"
            ),
            "utf8"
        );

        const registerFunctionIndex = migration.search(
            /create or replace function public\.register_openclaw_runtime/i
        );
        const rateLimitTableIndex = migration.search(
            /create table if not exists public\.openclaw_register_rate_limits/i
        );
        const rateLimitFunctionIndex = migration.search(
            /create or replace function public\.consume_openclaw_register_rate_limit/i
        );
        const registerFunction = migration.slice(registerFunctionIndex);
        const runtimeInsertIndex = registerFunction.search(
            /insert into public\.openclaw_runtimes/i
        );
        const tokenConsumeIndex = registerFunction.search(
            /update public\.openclaw_registration_tokens[\s\S]*set status = 'consumed'/i
        );

        expect(rateLimitTableIndex).toBeGreaterThanOrEqual(0);
        expect(registerFunctionIndex).toBeGreaterThan(rateLimitTableIndex);
        expect(rateLimitFunctionIndex).toBeGreaterThan(registerFunctionIndex);
        expect(migration).toMatch(
            /create index if not exists openclaw_register_rate_limits_last_attempt_at_idx/i
        );
        expect(runtimeInsertIndex).toBeGreaterThanOrEqual(0);
        expect(tokenConsumeIndex).toBeGreaterThan(runtimeInsertIndex);
    });
});
