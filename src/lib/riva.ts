/**
 * Transcribes audio bytes using NVIDIA Riva Parakeet-CTC via gRPC.
 * Model: nvidia/parakeet-ctc-0.6b-asr
 * Endpoint: grpc.nvcf.nvidia.com:443
 * Function ID: d8dd4e9b-fbf5-4fb0-9dba-8cf436c8d965
 *
 * The hosted NVIDIA NVCF endpoint expects a supported audio container
 * (for example 16-bit mono WAV/OGG/OPUS), not browser WebM and not raw PCM.
 * Browser MediaRecorder outputs audio/webm;codecs=opus, so we use
 * ffmpeg to transcode to a 16kHz mono WAV/PCM16 container before sending.
 *
 * CONCURRENCY: Riva's cloud endpoint degrades when two ASR calls
 * hit the same channel simultaneously (live + final calls overlap when
 * recording stops). We enforce a sequential call queue so calls never
 * run concurrently — the final transcript always gets a clean channel.
 */
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import ffmpegPath from "ffmpeg-static";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import os from "os";
import { existsSync } from "fs";
import fs from "fs/promises";
import dns from "node:dns";
import type { TranscriptSegment } from "@/lib/transcript";

// Prefer IPv4 for node requests to avoid IPv6 'EHOSTUNREACH' routing issues
// that could affect gRPC or other downstream service connections.
dns.setDefaultResultOrder("ipv4first");

const execFileAsync = promisify(execFile);

const GRPC_TARGET = "grpc.nvcf.nvidia.com:443";
const FUNCTION_ID = "d8dd4e9b-fbf5-4fb0-9dba-8cf436c8d965";
const PROTO_ROOT = path.join(process.cwd(), "src/lib/proto");
const STREAMING_AUDIO_CHUNK_BYTES = 64 * 1024;

function resolveFfmpegPath(): string {
    const fromEnv = process.env.FFMPEG_PATH?.trim();
    if (fromEnv) return fromEnv;

    const candidates: string[] = [];
    if (typeof ffmpegPath === "string" && ffmpegPath.length > 0) {
        // Next.js/Vercel bundling can surface a synthetic /ROOT prefix.
        // Remap that prefix to the runtime cwd (for example /var/task).
        const normalized = ffmpegPath.startsWith("/ROOT/")
            ? path.join(process.cwd(), ffmpegPath.slice("/ROOT/".length))
            : ffmpegPath;
        candidates.push(normalized);
    }

    const bundledFallback = path.join(
        process.cwd(),
        "node_modules",
        "ffmpeg-static",
        process.platform === "win32" ? "ffmpeg.exe" : "ffmpeg"
    );
    candidates.push(bundledFallback);

    for (const candidate of candidates) {
        if (existsSync(candidate)) return candidate;
    }

    return "ffmpeg";
}

// ── Live call queue ────────────────────────────────────────────────────────────
// Live ticks are best-effort and can queue behind each other. Final transcripts
// should never wait behind live updates after the user stops speaking.
let _callQueue: Promise<unknown> = Promise.resolve();

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = _callQueue.then(fn);
    // Prevent an rejected call from poisoning the queue for future calls
    _callQueue = next.catch(() => { });
    return next;
}
// ─────────────────────────────────────────────────────────────────────────────

type RecognitionConfig = {
    encoding?: number | string;
    sample_rate_hertz?: number;
    language_code: string;
    max_alternatives: number;
    enable_automatic_punctuation: boolean;
};

type RecognizeResult = {
    alternatives?: Array<{
        transcript?: string;
    }>;
    audio_processed?: number; // cumulative seconds of audio processed up to this result
};

type StreamingRecognizeRequest = {
    streaming_config?: {
        config: RecognitionConfig;
        interim_results: boolean;
    };
    audio_content?: Buffer;
};

type StreamingRecognizeResult = RecognizeResult & {
    is_final?: boolean;
};

type StreamingRecognizeResponse = {
    results?: StreamingRecognizeResult[];
};

type RivaAsrClient = {
    StreamingRecognize: (
        metadata: grpc.Metadata
    ) => grpc.ClientDuplexStream<StreamingRecognizeRequest, StreamingRecognizeResponse>;
};

type RivaAsrConstructor = new (
    address: string,
    credentials: grpc.ChannelCredentials,
    options?: grpc.ClientOptions
) => RivaAsrClient;

let _asrClient: RivaAsrClient | null = null;

function getAsrClient() {
    if (_asrClient) return _asrClient;

    const packageDef = protoLoader.loadSync(
        path.join(PROTO_ROOT, "riva/proto/riva_asr.proto"),
        {
            keepCase: true,
            longs: String,
            enums: String,
            defaults: true,
            oneofs: true,
            includeDirs: [PROTO_ROOT],
        }
    );

    const proto = grpc.loadPackageDefinition(packageDef) as unknown as {
        nvidia?: {
            riva?: {
                asr?: {
                    RivaSpeechRecognition?: RivaAsrConstructor;
                };
            };
        };
    };
    const RivaASR = proto.nvidia?.riva?.asr?.RivaSpeechRecognition;
    if (!RivaASR) {
        throw new Error("RivaSpeechRecognition service definition missing from loaded proto");
    }
    const credentials = grpc.credentials.createSsl();

    _asrClient = new RivaASR(GRPC_TARGET, credentials, {
        "grpc.default_authority": "grpc.nvcf.nvidia.com",
        // Allow plenty of concurrent streams on the channel even though we
        // serialize at the application level — keeps the channel healthy
        "grpc.max_concurrent_streams": 10,
    });

    return _asrClient;
}

/**
 * Converts any audio buffer (webm, ogg, mp4...) to a 16kHz mono WAV/PCM16
 * container using ffmpeg. This mirrors NVIDIA's hosted Riva client path, which
 * sends container bytes and lets the service infer the audio encoding.
 */
async function toWavPCM16(inputBuffer: Buffer, inputExt = "webm"): Promise<Buffer> {
    // Use random suffix so concurrent ffmpeg calls don't collide on filenames
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const tmpIn = path.join(os.tmpdir(), `riva-in-${id}.${inputExt}`);
    const tmpOut = path.join(os.tmpdir(), `riva-out-${id}.wav`);

    const ffmpegExecutable = resolveFfmpegPath();

    try {
        await fs.writeFile(tmpIn, inputBuffer);

        await execFileAsync(ffmpegExecutable, [
            "-y",
            "-i", tmpIn,
            "-ar", "16000",       // 16 kHz (Parakeet requirement)
            "-ac", "1",           // mono
            "-sample_fmt", "s16",  // 16-bit samples inside the WAV container
            "-f", "wav",
            "-acodec", "pcm_s16le",
            tmpOut,
        ]);

        const wav = await fs.readFile(tmpOut);
        const pcmPayloadBytes = Math.max(0, wav.byteLength - 44);
        console.log(`[riva/ffmpeg] ${inputBuffer.byteLength}b → ${wav.byteLength}b WAV/PCM16 (${(pcmPayloadBytes / 32000).toFixed(1)}s)`);
        return wav;
    } finally {
        await fs.unlink(tmpIn).catch(() => { });
        await fs.unlink(tmpOut).catch(() => { });
    }
}

async function _doRecognize(
    audioBytes: Buffer,
    apiKey: string,
    mimeType: string
): Promise<{ transcript: string; segments: TranscriptSegment[] }> {
    const client = getAsrClient();
    const normalizedApiKey = apiKey.trim();

    if (!normalizedApiKey) {
        throw new Error("NVIDIA API key is missing or empty after trimming");
    }

    const normalizedMime = mimeType.toLowerCase();
    const inputExt = normalizedMime.includes("ogg")
        ? "ogg"
        : normalizedMime.includes("m4a")
            ? "m4a"
            : normalizedMime.includes("mp4")
                ? "mp4"
                : normalizedMime.includes("mpeg") || normalizedMime.includes("mp3")
                    ? "mp3"
                    : "webm";
    const wavBuffer = await toWavPCM16(audioBytes, inputExt);

    const metadata = new grpc.Metadata();
    metadata.set("authorization", `Bearer ${normalizedApiKey}`);
    metadata.set("function-id", FUNCTION_ID);

    const config: RecognitionConfig = {
        language_code: "en-US",
        max_alternatives: 1,
        enable_automatic_punctuation: true,
    };

    return new Promise<{ transcript: string; segments: TranscriptSegment[] }>((resolve, reject) => {
        const stream = client.StreamingRecognize(metadata);
        const finalResults: StreamingRecognizeResult[] = [];
        let fallbackResults: StreamingRecognizeResult[] = [];

        stream.on("data", (response: StreamingRecognizeResponse) => {
            const populatedResults = (response.results ?? []).filter((r: StreamingRecognizeResult) =>
                r.alternatives?.[0]?.transcript?.trim()
            );
            if (populatedResults.length === 0) return;

            const finals = populatedResults.filter((r) => r.is_final);
            if (finals.length > 0) {
                finalResults.push(...finals);
                return;
            }
            fallbackResults = populatedResults;
        });

        stream.on("error", (err) => {
            console.error("[riva/grpc] StreamingRecognize error:", err);
            reject(err);
        });

        stream.on("end", () => {
            const results = finalResults.length > 0 ? finalResults : fallbackResults;
            console.log("[riva/grpc] streaming results:", JSON.stringify(results.length), "segments");
            const segments = resultsToSegments(results);
            const transcript = segments.map((s) => s.text).join(" ");
            resolve({ transcript, segments });
        });

        stream.write({
            streaming_config: {
                config,
                interim_results: true,
            },
        });

        for (let offset = 0; offset < wavBuffer.byteLength; offset += STREAMING_AUDIO_CHUNK_BYTES) {
            stream.write({
                audio_content: wavBuffer.subarray(offset, offset + STREAMING_AUDIO_CHUNK_BYTES),
            });
        }
        stream.end();
    });
}

function resultsToSegments(results: RecognizeResult[]): TranscriptSegment[] {
    // audio_processed is cumulative seconds up to each result. Guard against
    // 0/missing values so endMs is always strictly greater than startMs.
    let prevMs = 0;
    return results.map((r, i) => {
        const text = r.alternatives?.[0]?.transcript?.trim() ?? "";
        const endMs = Math.max(prevMs + 1, Math.round((r.audio_processed ?? 0) * 1000));
        const seg: TranscriptSegment = { id: String(i), startMs: prevMs, endMs, text };
        prevMs = endMs;
        return seg;
    });
}

/**
 * Public entry point — always queues behind any in-flight ASR call.
 */
export async function transcribeAudio(
    audioBytes: Buffer,
    apiKey: string,
    mimeType = "audio/webm",
    options?: { priority?: "live" | "final" }
): Promise<{ transcript: string; segments: TranscriptSegment[] }> {
    const priority = options?.priority ?? "final";
    console.log(
        `[riva] StreamingRecognize request priority=${priority} size=${(audioBytes.byteLength / 1024).toFixed(0)} KB`
    );

    // Keep live polling serialized to protect provider stability.
    // Final transcripts bypass this queue to prevent stop->result lag.
    if (priority === "live") {
        return enqueue(() => _doRecognize(audioBytes, apiKey, mimeType));
    }

    return _doRecognize(audioBytes, apiKey, mimeType);
}
