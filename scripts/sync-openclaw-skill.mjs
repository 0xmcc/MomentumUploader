import { cpSync, existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const sourceDir = path.resolve(repoRoot, "..", "openclaw-skill");
const targetDir = path.resolve(repoRoot, "public", "openclaw", "memo-room", "v1");
const readmePath = path.join(targetDir, "README.md");

if (!existsSync(sourceDir)) {
    throw new Error(`Missing OpenClaw skill source directory: ${sourceDir}`);
}

mkdirSync(targetDir, { recursive: true });

for (const fileName of readdirSync(sourceDir)) {
    cpSync(path.join(sourceDir, fileName), path.join(targetDir, fileName), {
        force: true,
        recursive: false,
    });
}

writeFileSync(
    readmePath,
    [
        "# Generated OpenClaw Skill Bundle",
        "",
        "This directory is generated from `../openclaw-skill/`.",
        "",
        "Run `npm run sync:openclaw-skill` from `voice-memos/` after editing the source bundle.",
    ].join("\n")
);
