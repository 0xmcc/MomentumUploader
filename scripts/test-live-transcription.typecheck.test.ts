import { execFileSync } from "node:child_process";
import path from "node:path";

describe("scripts/test-live-transcription.ts typecheck", () => {
    it("compiles without BlobPart type errors", () => {
        const tscBin = path.join(process.cwd(), "node_modules", "typescript", "bin", "tsc");

        expect(() => {
            execFileSync(
                process.execPath,
                [tscBin, "--pretty", "false", "--noEmit", "scripts/test-live-transcription.ts"],
                { cwd: process.cwd(), stdio: "pipe" }
            );
        }).not.toThrow();
    });
});
