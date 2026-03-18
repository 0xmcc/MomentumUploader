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
});
