/**
 * Transcribes audio bytes using NVIDIA Riva Parakeet-CTC via gRPC.
 * Model: nvidia/parakeet-ctc-0.6b-asr
 * Endpoint: grpc.nvcf.nvidia.com:443
 * Function ID: d8dd4e9b-fbf5-4fb0-9dba-8cf436c8d965
 *
 * Riva only supports LINEAR_PCM, FLAC, MULAW, OGGOPUS — NOT WebM.
 * Browser MediaRecorder outputs audio/webm;codecs=opus, so we use
 * ffmpeg to transcode to 16kHz mono LINEAR_PCM before sending.
 *
 * CONCURRENCY: Riva's cloud endpoint degrades when two Recognize calls
 * hit the same channel simultaneously (live + final calls overlap when
 * recording stops). We enforce a sequential call queue so calls never
 * run concurrently — the final transcript always gets a clean channel.
 */
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import os from "os";
import fs from "fs/promises";
import dns from "node:dns";

// Prefer IPv4 for node requests to avoid IPv6 'EHOSTUNREACH' routing issues
// that could affect gRPC or other downstream service connections.
dns.setDefaultResultOrder("ipv4first");

const execFileAsync = promisify(execFile);

const GRPC_TARGET = "grpc.nvcf.nvidia.com:443";
const FUNCTION_ID = "d8dd4e9b-fbf5-4fb0-9dba-8cf436c8d965";
const PROTO_ROOT = path.join(process.cwd(), "src/lib/proto");

// ── Sequential call queue ─────────────────────────────────────────────────────
// Ensures only ONE Recognize call runs at a time.  The live endpoint fires
// every 5 s; when recording stops the final call queues behind it instead of
// running concurrently and degrading both results.
let _callQueue: Promise<unknown> = Promise.resolve();

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = _callQueue.then(fn);
    // Prevent an rejected call from poisoning the queue for future calls
    _callQueue = next.catch(() => { });
    return next;
}
// ─────────────────────────────────────────────────────────────────────────────

type RecognizeRequest = {
    config: {
        encoding: number;
        sample_rate_hertz: number;
        language_code: string;
        max_alternatives: number;
        enable_automatic_punctuation: boolean;
    };
    audio: Buffer;
};

type RecognizeResult = {
    alternatives?: Array<{
        transcript?: string;
    }>;
};

type RecognizeResponse = {
    results?: RecognizeResult[];
};

type RivaAsrClient = {
    Recognize: (
        request: RecognizeRequest,
        metadata: grpc.Metadata,
        callback: (err: grpc.ServiceError | null, response?: RecognizeResponse) => void
    ) => void;
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
 * Converts any audio buffer (webm, ogg, mp4…) to raw 16kHz mono s16le PCM
 * using ffmpeg. This is what Riva expects for LINEAR_PCM encoding.
 */
async function toPCM16(inputBuffer: Buffer, inputExt = "webm"): Promise<Buffer> {
    // Use random suffix so concurrent ffmpeg calls don't collide on filenames
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const tmpIn = path.join(os.tmpdir(), `riva-in-${id}.${inputExt}`);
    const tmpOut = path.join(os.tmpdir(), `riva-out-${id}.raw`);

    try {
        await fs.writeFile(tmpIn, inputBuffer);

        await execFileAsync("ffmpeg", [
            "-y",
            "-i", tmpIn,
            "-ar", "16000",       // 16 kHz (Parakeet requirement)
            "-ac", "1",           // mono
            "-f", "s16le",        // raw signed 16-bit little-endian PCM
            "-acodec", "pcm_s16le",
            tmpOut,
        ]);

        const pcm = await fs.readFile(tmpOut);
        console.log(`[riva/ffmpeg] ${inputBuffer.byteLength}b → ${pcm.byteLength}b PCM (${(pcm.byteLength / 32000).toFixed(1)}s)`);
        return pcm;
    } finally {
        await fs.unlink(tmpIn).catch(() => { });
        await fs.unlink(tmpOut).catch(() => { });
    }
}

async function _doRecognize(audioBytes: Buffer, apiKey: string, mimeType: string): Promise<string> {
    const client = getAsrClient();

    const inputExt = mimeType.includes("ogg") ? "ogg" : mimeType.includes("mp4") ? "mp4" : "webm";
    const pcmBuffer = await toPCM16(audioBytes, inputExt);

    const metadata = new grpc.Metadata();
    metadata.set("authorization", `Bearer ${apiKey}`);
    metadata.set("function-id", FUNCTION_ID);

    const request: RecognizeRequest = {
        config: {
            encoding: 1,                   // LINEAR_PCM = 1 in riva_audio.proto
            sample_rate_hertz: 16000,
            language_code: "en-US",
            max_alternatives: 1,
            enable_automatic_punctuation: true,
        },
        audio: pcmBuffer,
    };

    return new Promise<string>((resolve, reject) => {
        client.Recognize(request, metadata, (err, response) => {
            if (err) {
                console.error("[riva/grpc] Recognize error:", err);
                reject(err);
                return;
            }
            console.log("[riva/grpc] results:", JSON.stringify(response?.results?.length), "segments");
            // Riva splits on silence — join ALL segments for the full transcript
            const transcript = (response?.results ?? [])
                .map((segment) => segment.alternatives?.[0]?.transcript ?? "")
                .join(" ")
                .trim();
            resolve(transcript);
        });
    });
}

/**
 * Public entry point — always queues behind any in-flight Recognize call.
 */
export async function transcribeAudio(
    audioBytes: Buffer,
    apiKey: string,
    mimeType = "audio/webm"
): Promise<string> {
    console.log(`[riva] Queuing Recognize (${(audioBytes.byteLength / 1024).toFixed(0)} KB audio)`);
    return enqueue(() => _doRecognize(audioBytes, apiKey, mimeType));
}
