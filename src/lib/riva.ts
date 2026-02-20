/**
 * Transcribes audio bytes using NVIDIA Riva Parakeet-CTC via gRPC.
 * Model: nvidia/parakeet-ctc-0.6b-asr
 * Endpoint: grpc.nvcf.nvidia.com:443
 * Function ID: d8dd4e9b-fbf5-4fb0-9dba-8cf436c8d965
 *
 * Riva only supports LINEAR_PCM, FLAC, MULAW, OGGOPUS — NOT WebM.
 * Browser MediaRecorder outputs audio/webm;codecs=opus, so we use
 * ffmpeg to transcode to 16kHz mono LINEAR_PCM before sending.
 */
import * as grpc from "@grpc/grpc-js";
import * as protoLoader from "@grpc/proto-loader";
import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import os from "os";
import fs from "fs/promises";

const execFileAsync = promisify(execFile);

const GRPC_TARGET = "grpc.nvcf.nvidia.com:443";
const FUNCTION_ID = "d8dd4e9b-fbf5-4fb0-9dba-8cf436c8d965";
const PROTO_ROOT = path.join(process.cwd(), "src/lib/proto"); // contains riva/proto/*.proto

let _asrClient: any = null;

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

    const proto = grpc.loadPackageDefinition(packageDef) as any;
    const RivaASR = proto.nvidia.riva.asr.RivaSpeechRecognition;
    const credentials = grpc.credentials.createSsl();

    _asrClient = new RivaASR(GRPC_TARGET, credentials, {
        "grpc.default_authority": "grpc.nvcf.nvidia.com",
    });

    return _asrClient;
}

/**
 * Converts any audio buffer (webm, ogg, mp4, etc.) to raw 16kHz mono s16le PCM
 * using ffmpeg. This is what Riva expects for LINEAR_PCM encoding.
 */
async function toPCM16(inputBuffer: Buffer, inputExt = "webm"): Promise<Buffer> {
    const tmpIn = path.join(os.tmpdir(), `riva-in-${Date.now()}.${inputExt}`);
    const tmpOut = path.join(os.tmpdir(), `riva-out-${Date.now()}.raw`);

    try {
        await fs.writeFile(tmpIn, inputBuffer);

        await execFileAsync("ffmpeg", [
            "-y",
            "-i", tmpIn,
            "-ar", "16000",       // 16kHz sample rate (Parakeet requirement)
            "-ac", "1",           // mono
            "-f", "s16le",        // raw signed 16-bit little-endian PCM
            "-acodec", "pcm_s16le",
            tmpOut,
        ]);

        const pcmBuffer = await fs.readFile(tmpOut);
        console.log(`[riva/ffmpeg] Converted ${inputBuffer.byteLength}b → ${pcmBuffer.byteLength}b PCM`);
        return pcmBuffer;
    } finally {
        await fs.unlink(tmpIn).catch(() => { });
        await fs.unlink(tmpOut).catch(() => { });
    }
}

export async function transcribeAudio(
    audioBytes: Buffer,
    apiKey: string,
    mimeType = "audio/webm"
): Promise<string> {
    const client = getAsrClient();

    // Transcode to raw LINEAR_PCM — the only reliable format for Riva
    const inputExt = mimeType.includes("ogg") ? "ogg" : mimeType.includes("mp4") ? "mp4" : "webm";
    const pcmBuffer = await toPCM16(audioBytes, inputExt);

    // Build per-request metadata (not cached on client) so we can pass the current apiKey
    const metadata = new grpc.Metadata();
    metadata.set("authorization", `Bearer ${apiKey}`);
    metadata.set("function-id", FUNCTION_ID);

    const request = {
        config: {
            encoding: 1,              // LINEAR_PCM = 1 in riva_audio.proto
            sample_rate_hertz: 16000,
            language_code: "en-US",
            max_alternatives: 1,
            enable_automatic_punctuation: true,
        },
        audio: pcmBuffer,
    };

    return new Promise((resolve, reject) => {
        client.Recognize(request, metadata, (err: any, response: any) => {
            if (err) {
                console.error("[riva/grpc] Recognize error:", err);
                reject(err);
                return;
            }
            console.log("[riva/grpc] Raw response results:", JSON.stringify(response?.results));
            // Riva splits on silence — join ALL result segments to get the full transcript
            const transcript = (response?.results ?? [])
                .map((r: any) => r.alternatives?.[0]?.transcript ?? "")
                .join(" ")
                .trim();
            resolve(transcript);
        });
    });
}
