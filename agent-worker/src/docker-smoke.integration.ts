import test from "node:test";
import assert from "node:assert/strict";
import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
    const envFile = path.join(tempRoot, ".env");
    const overrideFile = path.join(tempRoot, "docker-compose.smoke.yml");
    const projectName = `memoagentsmoke${path.basename(tempRoot).replace(/[^a-z0-9]/gi, "")}`.toLowerCase();

    await writeFile(
      envFile,
      [
        "SUPABASE_URL=https://example.supabase.co",
        "SUPABASE_SERVICE_ROLE_KEY=test-service-role-key",
        "ANTHROPIC_API_KEY=test-anthropic-key",
        "ANTHROPIC_MODEL=",
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
        '      - "const fs=require(\\"node:fs\\");if(process.getuid()===0){throw new Error(\\"worker must not run as root\\");}const target=\\"/tmp/memo-workspaces/compose-smoke.txt\\";fs.mkdirSync(\\"/tmp/memo-workspaces\\",{recursive:true});fs.writeFileSync(target,\\"uid=\\"+process.getuid()+\\"\\\\n\\");console.log(fs.readFileSync(target,\\"utf8\\"));"',
        "",
      ].join("\n"),
      "utf8"
    );

    try {
      const { stdout } = await execFile(
        "docker",
        [
          "compose",
          "-p",
          projectName,
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

      assert.match(stdout, /uid=\d+/);
      assert.doesNotMatch(stdout, /uid=0/);
    } finally {
      await execFile(
        "docker",
        [
          "compose",
          "-p",
          projectName,
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
