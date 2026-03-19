/** @jest-environment node */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

describe("openclaw skill bundle mirror", () => {
    it("keeps the public bundle in sync with ../openclaw-skill", () => {
        const sourceDir = path.join(process.cwd(), "..", "openclaw-skill");
        const publicDir = path.join(process.cwd(), "public", "openclaw", "memo-room", "v1");
        const sourceFiles = readdirSync(sourceDir).sort();

        for (const fileName of sourceFiles) {
            const mirroredPath = path.join(publicDir, fileName);
            expect(existsSync(mirroredPath)).toBe(true);
            expect(readFileSync(mirroredPath, "utf8")).toBe(
                readFileSync(path.join(sourceDir, fileName), "utf8")
            );
        }
    });

    it("documents the handoff auth contract in the published skill", () => {
        const publicDir = path.join(process.cwd(), "public", "openclaw", "memo-room", "v1");
        const skill = readFileSync(path.join(publicDir, "SKILL.md"), "utf8");

        expect(skill).toContain("x-openclaw-api-key");
        expect(skill).toContain("oc_acct_123:secret-xyz");
        expect(skill).toContain("If you only have a registration token and no `x-openclaw-api-key`, do not call `/api/s/{shareRef}/handoff` yet.");
        expect(skill).toContain("Registration tokens are only valid for `POST /api/openclaw/register`.");
        expect(skill).toContain("nonce");
        expect(skill).toContain("pending_claim");
        expect(skill).toContain("already_claimed");
        expect(skill).toContain("Use the exact handoff URL");
    });

    it("publishes canonical bundle metadata instead of local placeholder hosts", () => {
        const publicDir = path.join(process.cwd(), "public", "openclaw", "memo-room", "v1");
        const skillJson = JSON.parse(
            readFileSync(path.join(publicDir, "skill.json"), "utf8")
        ) as {
            version: string;
            homepage: string;
            openclaw: {
                api_base: string;
                fallback_files: Record<string, string>;
            };
        };

        expect(skillJson.version).toBe("0.1.2");
        expect(skillJson.homepage).toBe("https://voice-memos.vercel.app/features/openclaw");
        expect(skillJson.openclaw.api_base).toBe("https://voice-memos.vercel.app/api");
        expect(skillJson.openclaw).toMatchObject({
            authentication: {
                header: "x-openclaw-api-key",
                format: "oc_acct_123:secret-xyz",
                required: true,
                register_first_if_missing_api_key: true,
            },
            bootstrap: {
                registration_url: "https://voice-memos.vercel.app/api/openclaw/register",
                method: "POST",
                registration_token_field: "registration_token",
                display_name_field: "display_name",
            },
        });
        expect(skillJson.openclaw.fallback_files).toEqual({
            "SKILL.md": "https://voice-memos.vercel.app/openclaw/memo-room/v1/SKILL.md",
            "HEARTBEAT.md": "https://voice-memos.vercel.app/openclaw/memo-room/v1/HEARTBEAT.md",
            "MESSAGING.md": "https://voice-memos.vercel.app/openclaw/memo-room/v1/MESSAGING.md",
            "RULES.md": "https://voice-memos.vercel.app/openclaw/memo-room/v1/RULES.md",
            "skill.json": "https://voice-memos.vercel.app/openclaw/memo-room/v1/skill.json",
        });
    });
});
