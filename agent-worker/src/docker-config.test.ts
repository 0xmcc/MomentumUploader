import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function readPackageFile(fileName: string) {
  return readFile(path.join(packageRoot, fileName), "utf8");
}

test("production Docker support uses Node 20 slim and required runtime files", async () => {
  const workflowFile = path.resolve(
    packageRoot,
    "..",
    ".github",
    "workflows",
    "agent-worker-docker-smoke.yml"
  );

  const [
    dockerfile,
    dockerignore,
    composeFile,
    envExample,
    packageJsonRaw,
    smokeTest,
    workflow,
  ] =
    await Promise.all([
      readPackageFile("Dockerfile"),
      readPackageFile(".dockerignore"),
      readPackageFile("docker-compose.yml"),
      readPackageFile(".env.example"),
      readPackageFile("package.json"),
      readPackageFile("src/docker-smoke.integration.ts"),
      readFile(workflowFile, "utf8"),
    ]);

  const packageJson = JSON.parse(packageJsonRaw) as {
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  assert.match(dockerfile, /^FROM node:20-bookworm-slim/m);
  assert.match(dockerfile, /COPY package\.json package-lock\.json \.\/\nRUN npm ci --omit=dev/m);
  assert.match(dockerfile, /COPY src \.\/src/m);
  assert.match(dockerfile, /mkdir -p \/tmp\/memo-workspaces && chown -R node:node \/tmp\/memo-workspaces/m);
  assert.match(dockerfile, /CMD \["npm", "start"\]/);

  assert.equal(packageJson.scripts?.start, "tsx src/index.ts");
  assert.equal(
    packageJson.scripts?.["test:docker"],
    "tsx --test src/docker-smoke.integration.ts"
  );
  assert.ok(packageJson.dependencies?.tsx, "tsx must be installed in production");
  assert.equal(packageJson.devDependencies?.tsx, undefined);

  assert.match(dockerignore, /^node_modules$/m);
  assert.match(dockerignore, /^\.env\*$/m);
  assert.match(dockerignore, /^\.git$/m);

  assert.match(composeFile, /^services:/m);
  assert.match(composeFile, /env_file:\s*- \.env/m);
  assert.match(composeFile, /restart:\s+unless-stopped/m);
  assert.match(composeFile, /SUPABASE_URL:/m);
  assert.match(composeFile, /SUPABASE_SERVICE_ROLE_KEY:/m);
  assert.match(composeFile, /ANTHROPIC_API_KEY:/m);
  assert.match(composeFile, /ANTHROPIC_MODEL:/m);
  assert.match(composeFile, /memo-workspaces:\/tmp\/memo-workspaces/m);
  assert.match(composeFile, /healthcheck:/m);
  assert.match(composeFile, /\/tmp\/memo-workspaces/m);

  assert.match(envExample, /^SUPABASE_URL=/m);
  assert.match(envExample, /^SUPABASE_SERVICE_ROLE_KEY=/m);
  assert.match(envExample, /^ANTHROPIC_API_KEY=/m);
  assert.match(envExample, /^ANTHROPIC_MODEL=/m);

  assert.match(smokeTest, /docker compose/m);
  assert.match(smokeTest, /\/tmp\/memo-workspaces/m);
  assert.doesNotMatch(smokeTest, /\$\{process\.getuid\(\)\}/);
  assert.match(smokeTest, /uid=.*process\.getuid\(\)\+/);
  assert.doesNotMatch(smokeTest, /SMOKE_WORKSPACE_HOST/);
  assert.match(smokeTest, /"-p"/);

  assert.match(workflow, /^name:\s+Agent Worker Docker Smoke/m);
  assert.match(workflow, /runs-on:\s+ubuntu-latest/m);
  assert.match(workflow, /working-directory:\s+agent-worker/m);
  assert.match(workflow, /cache-dependency-path:\s+agent-worker\/package-lock\.json/m);
  assert.match(workflow, /npm run test:docker/m);
});
