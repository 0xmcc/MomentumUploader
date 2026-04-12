import test from "node:test";
import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFile = promisify(execFileCallback);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function hasDockerCompose() {
  try {
    await execFile("docker", ["compose", "version"], {
      cwd: packageRoot,
    });
    return true;
  } catch {
    return false;
  }
}

test(
  "docker compose smoke test writes to the workspace volume as the node user",
  { timeout: 180_000 },
  async (t) => {
    if (!(await hasDockerCompose())) {
      t.skip("docker compose is not available in this environment");
      return;
    }

    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "memo-agent-docker-smoke-"));
    const hostWorkspaceDir = path.join(tempRoot, "workspace");
    const envFile = path.join(tempRoot, ".env");
    const overrideFile = path.join(tempRoot, "docker-compose.smoke.yml");
    const smokeFile = path.join(hostWorkspaceDir, "compose-smoke.txt");

    await mkdir(hostWorkspaceDir, { recursive: true });
    await writeFile(
      envFile,
      [
        "SUPABASE_URL=https://example.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY=test-service-role-key",
        "ANTHROPIC_API_KEY=test-anthropic-key",
        "ANTHROPIC_MODEL=",
        `SMOKE_WORKSPACE_HOST=${hostWorkspaceDir}`,
        "",
      ].join("\n"),
      "utf8"
    );

    await writeFile(
      overrideFile,
      [
        "services:",
        "  memo-agent-worker:",
        "    command:",
        '      - "node"',
        '      - "-e"',
        '      - "const fs=require(\\"node:fs\\");const target=\\"/tmp/memo-workspaces/compose-smoke.txt\\";fs.mkdirSync(\\"/tmp/memo-workspaces\\",{recursive:true});fs.writeFileSync(target,`uid=${process.getuid()}\\\\n`);console.log(fs.readFileSync(target,\\"utf8\\"));"',
        "    volumes:",
        '      - "${SMOKE_WORKSPACE_HOST}:/tmp/memo-workspaces"',
        "",
      ].join("\n"),
      "utf8"
    );

    try {
      await execFile(
        "docker",
        [
          "compose",
          "--env-file",
          envFile,
          "-f",
          "docker-compose.yml",
          "-f",
          overrideFile,
          "up",
          "--build",
          "--abort-on-container-exit",
          "--exit-code-from",
          "memo-agent-worker",
        ],
        {
          cwd: packageRoot,
        }
      );

      await access(smokeFile);
      const smokeContents = await readFile(smokeFile, "utf8");
      assert.match(smokeContents, /^uid=\d+\n$/);
      assert.doesNotMatch(smokeContents, /^uid=0$/m);
    } finally {
      await execFile(
        "docker",
        [
          "compose",
          "--env-file",
          envFile,
          "-f",
          "docker-compose.yml",
          "-f",
          overrideFile,
          "down",
          "--volumes",
          "--remove-orphans",
        ],
        {
          cwd: packageRoot,
        }
      ).catch(() => undefined);

      await rm(tempRoot, { recursive: true, force: true });
    }
  }
);
