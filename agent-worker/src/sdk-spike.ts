import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { query } from "@anthropic-ai/claude-agent-sdk";

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      "ANTHROPIC_API_KEY is required to run the SDK spike and inspect live stream events."
    );
  }

  const workspaceDir = await mkdtemp(path.join(os.tmpdir(), "memo-agent-sdk-spike-"));

  for await (const message of query({
    prompt: "Reply with the single word ACK.",
    options: {
      cwd: workspaceDir,
      allowedTools: ["Read"],
      model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5",
    },
  })) {
    console.dir(message, { depth: null, colors: true });
  }
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
