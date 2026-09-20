/**
 * Locating the Riva .proto files.
 *
 * They used to be found at `<cwd>/src/lib/proto`, which is true only when the
 * process is the Next app. Transcription now also runs in agent-worker, whose
 * cwd is one directory down, so the lookup has to try more than one place —
 * and a deployment that moves them can say so with RIVA_PROTO_ROOT.
 *
 * Kept out of riva.ts so it can be tested without loading gRPC.
 */
import path from "node:path";
import { existsSync } from "node:fs";

export type ResolveProtoRootOptions = {
    cwd?: string;
    exists?: (candidate: string) => boolean;
    env?: Record<string, string | undefined>;
};

export function resolveProtoRoot(options: ResolveProtoRootOptions = {}): string {
    const cwd = options.cwd ?? process.cwd();
    const exists = options.exists ?? existsSync;
    const env = options.env ?? process.env;

    const fromEnv = env.RIVA_PROTO_ROOT?.trim();
    if (fromEnv) return fromEnv;

    const inApp = path.join(cwd, "src/lib/proto");
    if (exists(inApp)) return inApp;

    // agent-worker runs from a subdirectory of the app.
    const oneUp = path.join(cwd, "..", "src/lib/proto");
    if (exists(oneUp)) return path.normalize(oneUp);

    return inApp;
}
