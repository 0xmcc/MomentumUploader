/** @jest-environment node */

/**
 * Where the Riva .proto files are, when the process is not the Next app.
 *
 * riva.ts found them at `<cwd>/src/lib/proto`, which is true for `next dev`
 * and false for the worker, whose cwd is agent-worker/. Transcription now runs
 * in the worker, so a wrong answer here is a job that fails at the first real
 * recording — after the upload, after the queue, at the one step nothing else
 * covers.
 */
import path from "node:path";
import { resolveProtoRoot } from "@/lib/riva-proto-root";

describe("resolveProtoRoot", () => {
  it("takes the explicit override first, for a deployment that moves them", () => {
    const resolved = resolveProtoRoot({
      cwd: "/app",
      exists: () => true,
      env: { RIVA_PROTO_ROOT: "/opt/proto" },
    });

    expect(resolved).toBe("/opt/proto");
  });

  it("finds them under the app's own cwd", () => {
    const resolved = resolveProtoRoot({
      cwd: "/app",
      exists: (candidate) => candidate === path.join("/app", "src/lib/proto"),
      env: {},
    });

    expect(resolved).toBe(path.join("/app", "src/lib/proto"));
  });

  it("finds them from the worker, whose cwd is one directory down", () => {
    const resolved = resolveProtoRoot({
      cwd: "/app/agent-worker",
      exists: (candidate) => candidate === path.join("/app", "src/lib/proto"),
      env: {},
    });

    expect(resolved).toBe(path.join("/app", "src/lib/proto"));
  });

  it("falls back to the app path rather than an empty string when nothing exists", () => {
    const resolved = resolveProtoRoot({
      cwd: "/app",
      exists: () => false,
      env: {},
    });

    expect(resolved).toBe(path.join("/app", "src/lib/proto"));
  });

  it("really does find the checked-in protos from this repo", () => {
    expect(resolveProtoRoot()).toBe(path.join(process.cwd(), "src/lib/proto"));
  });
});
