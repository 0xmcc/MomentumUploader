import { readFileSync } from "node:fs";
import path from "node:path";

describe("voice-memos tsconfig", () => {
  it("excludes the standalone agent-worker package from the app typecheck scope", () => {
    const tsconfigPath = path.join(process.cwd(), "tsconfig.json");
    const tsconfig = JSON.parse(readFileSync(tsconfigPath, "utf8")) as {
      exclude?: string[];
    };

    expect(tsconfig.exclude).toEqual(
      expect.arrayContaining(["node_modules", "agent-worker/**/*"])
    );
  });
});
