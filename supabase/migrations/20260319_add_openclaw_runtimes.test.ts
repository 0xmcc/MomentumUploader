/** @jest-environment node */

import { readFileSync } from "node:fs";
import path from "node:path";

describe("20260319_add_openclaw_runtimes migration", () => {
    it("defines the runtime + token tables before the registration RPCs", () => {
        const migration = readFileSync(
            path.join(
                process.cwd(),
                "supabase/migrations/20260319_add_openclaw_runtimes.sql"
            ),
            "utf8"
        );

        const tokenTableIndex = migration.search(
            /create table if not exists public\.openclaw_registration_tokens/i
        );
        const runtimeTableIndex = migration.search(
            /create table if not exists public\.openclaw_runtimes/i
        );
        const issueFunctionIndex = migration.search(
            /create or replace function public\.issue_openclaw_registration_token/i
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

        expect(migration).toMatch(
            /create unique index if not exists openclaw_registration_tokens_owner_active_idx/i
        );
        expect(migration).toMatch(
            /create unique index if not exists openclaw_runtimes_owner_active_idx/i
        );
        expect(migration).toMatch(
            /create index if not exists openclaw_register_rate_limits_last_attempt_at_idx/i
        );
        expect(migration).toMatch(/select[\s\S]*for update/i);
        expect(migration).toMatch(/update public\.openclaw_registration_tokens/i);
        expect(migration).toMatch(/insert into public\.openclaw_registration_tokens/i);
        expect(migration).toMatch(/insert into public\.openclaw_runtimes/i);
        expect(tokenTableIndex).toBeGreaterThanOrEqual(0);
        expect(runtimeTableIndex).toBeGreaterThan(tokenTableIndex);
        expect(rateLimitTableIndex).toBeGreaterThan(runtimeTableIndex);
        expect(issueFunctionIndex).toBeGreaterThan(runtimeTableIndex);
        expect(registerFunctionIndex).toBeGreaterThan(issueFunctionIndex);
        expect(rateLimitFunctionIndex).toBeGreaterThan(registerFunctionIndex);
        expect(runtimeInsertIndex).toBeGreaterThanOrEqual(0);
        expect(tokenConsumeIndex).toBeGreaterThan(runtimeInsertIndex);
    });
});
