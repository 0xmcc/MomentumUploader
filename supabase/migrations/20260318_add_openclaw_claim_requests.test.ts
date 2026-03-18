/** @jest-environment node */

import { readFileSync } from "node:fs";
import path from "node:path";

describe("20260318_add_openclaw_claim_requests migration", () => {
    it("defines the OpenClaw invite and claim tables before the nonce-claim RPC", () => {
        const migration = readFileSync(
            path.join(
                process.cwd(),
                "supabase/migrations/20260318_add_openclaw_claim_requests.sql"
            ),
            "utf8"
        );

        const nonceTableIndex = migration.search(
            /create table public\.openclaw_invite_nonces/i
        );
        const claimTableIndex = migration.search(
            /create table public\.openclaw_claim_requests/i
        );
        const functionIndex = migration.search(
            /create or replace function public\.claim_openclaw_invite_nonce/i
        );

        expect(migration).toMatch(
            /alter table public\.agents[\s\S]*add column(?: if not exists)? openclaw_external_id text/i
        );
        expect(migration).toMatch(
            /create unique index(?: if not exists)? agents_openclaw_external_id_owner_idx/i
        );
        expect(migration).toMatch(
            /create unique index(?: if not exists)? openclaw_claim_requests_share_pending_idx/i
        );
        expect(migration).toMatch(/update public\.openclaw_invite_nonces/i);
        expect(migration).toMatch(/insert into public\.openclaw_claim_requests/i);
        expect(nonceTableIndex).toBeGreaterThanOrEqual(0);
        expect(claimTableIndex).toBeGreaterThan(nonceTableIndex);
        expect(functionIndex).toBeGreaterThan(claimTableIndex);
    });
});
