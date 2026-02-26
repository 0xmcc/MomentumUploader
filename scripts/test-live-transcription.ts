#!/usr/bin/env npx tsx
/**
 * Manual integration test for live transcription.
 *
 * Tests the full pipeline: ElevenLabs TTS → audio chunks → /api/transcribe/live → mergeLiveTranscript
 * Including the gapped-window overflow scenario (>30 chunks) that caused duplication.
 *
 * This script is ADVISORY ONLY — not a CI gate. Run it manually to gain confidence
 * before shipping a live transcription change or after a RIVA/NVIDIA API update.
 *
 * Usage:
 *   npx tsx scripts/test-live-transcription.ts
 *
 * Required env vars:
 *   ELEVENLABS_API_KEY   — ElevenLabs API key (for TTS audio generation)
 *   NEXT_PUBLIC_APP_URL  — Base URL of the running dev server (default: http://localhost:3000)
 *
 * The dev server must be running (`npm run dev`) for /api/transcribe/live to be reachable.
 */

import { mergeLiveTranscript } from "../src/components/audio-recorder/live-transcript";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY ?? "";
const ELEVENLABS_VOICE_ID = "nPczCjzI2devNBz1zQrb"; // Brian — authoritative, clear
const LIVE_MAX_CHUNKS = 30;

// Known input text. Long enough to trigger the >30 chunk overflow when split into ~1s blobs.
const KNOWN_TEXT = `
Hello and welcome to this test recording. The purpose of this session is to validate
that the live transcription pipeline correctly handles long recordings without duplicating
any of the text that was already spoken. We will speak for an extended period to ensure
that we exceed the thirty chunk threshold where the overflow logic kicks in.

First, let me talk about the weather. The weather today is quite pleasant with mild
temperatures and a light breeze. It is the kind of day that makes you want to go outside
and enjoy the sunshine. Moving on to our second topic.

Second, let us discuss technology. Artificial intelligence has made tremendous strides
over the past few years. Language models can now generate coherent text, write code,
and assist with a wide range of tasks. This is particularly exciting for voice applications.

Third and finally, let me wrap up with a summary. We have covered the weather, technology,
and now the conclusion. If this transcript appears without duplication of any opening
phrases, then the live transcription fix is working correctly. Thank you for listening.
`.trim();

type TestResult = { passed: boolean; reason: string };

async function generateTTSAudio(text: string): Promise<Buffer> {
    console.log(`[TTS] Generating audio via ElevenLabs (${text.length} chars)...`);
    const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${ELEVENLABS_VOICE_ID}?output_format=mp3_44100_128`,
        {
            method: "POST",
            headers: {
                "xi-api-key": ELEVENLABS_API_KEY,
                "Content-Type": "application/json",
            },
            body: JSON.stringify({
                text,
                model_id: "eleven_multilingual_v2",
                voice_settings: { stability: 0.71, similarity_boost: 0.5 },
            }),
        }
    );

    if (!response.ok) {
        const err = await response.text().catch(() => response.statusText);
        throw new Error(`ElevenLabs TTS failed (${response.status}): ${err}`);
    }

    const buffer = await response.arrayBuffer();
    console.log(`[TTS] Generated ${buffer.byteLength} bytes of audio`);
    return Buffer.from(buffer);
}

async function callLiveTranscribe(audioBuffer: Buffer, chunkIndex: number): Promise<string> {
    const formData = new FormData();
    const blob = new Blob([audioBuffer], { type: "audio/mpeg" });
    formData.append("file", blob, `live_test_chunk_${chunkIndex}.mp3`);

    const response = await fetch(`${BASE_URL}/api/transcribe/live`, {
        method: "POST",
        body: formData,
    });

    if (!response.ok) {
        console.warn(`[live] Tick ${chunkIndex} failed (${response.status})`);
        return "";
    }

    const json = (await response.json()) as { text?: string };
    return typeof json.text === "string" ? json.text : "";
}

function checkForNgramDuplication(text: string, n: number): string | null {
    const words = text.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
    for (let i = 0; i < words.length - n; i++) {
        const ngram = words.slice(i, i + n).join(" ");
        const rest = words.slice(i + n).join(" ");
        if (rest.includes(ngram)) {
            return ngram;
        }
    }
    return null;
}

function wordErrorRate(reference: string, hypothesis: string): number {
    const refWords = reference.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean);
    const hypWords = hypothesis.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter(Boolean);
    // Simple WER via Levenshtein on word arrays
    const m = refWords.length;
    const n = hypWords.length;
    const dp: number[][] = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
    for (let j = 0; j <= n; j++) dp[0][j] = j;
    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            dp[i][j] = refWords[i - 1] === hypWords[j - 1]
                ? dp[i - 1][j - 1]
                : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
        }
    }
    return dp[m][n] / m;
}

async function runTests(): Promise<void> {
    const results: TestResult[] = [];

    // ── Pre-flight checks ────────────────────────────────────────────────────
    if (!ELEVENLABS_API_KEY) {
        console.error("❌ ELEVENLABS_API_KEY is not set. Export it and re-run.");
        process.exit(1);
    }

    console.log(`\n🎙  Testing live transcription pipeline`);
    console.log(`   Base URL: ${BASE_URL}`);
    console.log(`   LIVE_MAX_CHUNKS: ${LIVE_MAX_CHUNKS}\n`);

    // ── Step 1: Generate audio ───────────────────────────────────────────────
    const audioBuffer = await generateTTSAudio(KNOWN_TEXT);

    // ── Step 2: Split into N equal-byte blobs (simulating ~1s MediaRecorder chunks) ──
    const CHUNK_COUNT = 40; // Ensures we exceed LIVE_MAX_CHUNKS
    const chunkSize = Math.ceil(audioBuffer.byteLength / CHUNK_COUNT);
    const chunks: Buffer[] = [];
    for (let i = 0; i < CHUNK_COUNT; i++) {
        const start = i * chunkSize;
        const end = Math.min(start + chunkSize, audioBuffer.byteLength);
        chunks.push(audioBuffer.subarray(start, end));
    }
    console.log(`[chunks] Split into ${chunks.length} chunks of ~${chunkSize} bytes each`);

    // ── Step 3: Simulate live tick behavior with growing-window snapshots ────
    // Mirrors useLiveTranscription.runLiveTick:
    //   • Under LIVE_MAX_CHUNKS: send all chunks so far
    //   • Over LIVE_MAX_CHUNKS: send chunk[0] + last (LIVE_MAX_CHUNKS-1) chunks
    //     (this is the OLD/fallback behavior — webmHeaderRef not available here since
    //      we're using pre-recorded MP3 blobs, not a live MediaRecorder session)
    let accumulated = "";
    let overflowCount = 0;

    for (let tick = 0; tick < chunks.length; tick += 2) {
        // Advance 2 chunks per tick to match ~2s windows (MediaRecorder 1s + live 1.5s)
        const windowChunks = chunks.slice(0, tick + 2);
        const snapshotChunks =
            windowChunks.length <= LIVE_MAX_CHUNKS
                ? windowChunks
                : [windowChunks[0], ...windowChunks.slice(-(LIVE_MAX_CHUNKS - 1))];

        if (windowChunks.length > LIVE_MAX_CHUNKS) {
            overflowCount++;
        }

        const snapshotBuffer = Buffer.concat(snapshotChunks);
        const text = await callLiveTranscribe(snapshotBuffer, tick);

        if (text) {
            const merged = mergeLiveTranscript(accumulated, text);
            console.log(`[tick ${tick}] +${text.length} chars → accumulated ${merged.length} chars${windowChunks.length > LIVE_MAX_CHUNKS ? " [OVERFLOW]" : ""}`);
            accumulated = merged;
        } else {
            console.log(`[tick ${tick}] empty response (skipped)`);
        }

        // Small delay to avoid hammering RIVA's gRPC endpoint
        await new Promise((r) => setTimeout(r, 300));
    }

    console.log(`\n[overflow] ${overflowCount} overflow ticks out of ${Math.ceil(chunks.length / 2)} total`);

    // ── Step 4: Assertions ───────────────────────────────────────────────────

    // Test A: No 6-gram duplication in the final transcript
    const duplicatedNgram = checkForNgramDuplication(accumulated, 6);
    results.push({
        passed: duplicatedNgram === null,
        reason: duplicatedNgram
            ? `Found duplicated 6-gram: "${duplicatedNgram}"`
            : "No 6-gram duplications detected",
    });

    // Test B: Word error rate < 40% (ASR accuracy tolerance)
    const wer = wordErrorRate(KNOWN_TEXT, accumulated);
    results.push({
        passed: wer < 0.4,
        reason: `WER: ${(wer * 100).toFixed(1)}% (threshold: 40%)`,
    });

    // Test C: Opening phrase appears exactly once
    const openingPhrase = "hello and welcome to this test recording";
    const normalizedAccumulated = accumulated.toLowerCase().replace(/[^a-z0-9\s]/g, " ").replace(/\s+/g, " ");
    const openingCount = normalizedAccumulated.split(openingPhrase).length - 1;
    results.push({
        passed: openingCount <= 1,
        reason: openingCount <= 1
            ? `Opening phrase appears exactly ${openingCount === 0 ? "0 (ASR missed it)" : "once"}`
            : `Opening phrase duplicated ${openingCount} times`,
    });

    // ── Step 5: Report ───────────────────────────────────────────────────────
    console.log("\n══════════════ RESULTS ══════════════");
    for (const { passed, reason } of results) {
        console.log(`${passed ? "✅" : "❌"} ${reason}`);
    }
    console.log("══════════════════════════════════════");
    console.log("\nFinal accumulated transcript (first 500 chars):");
    console.log(accumulated.slice(0, 500) + (accumulated.length > 500 ? "..." : ""));

    const allPassed = results.every((r) => r.passed);
    if (!allPassed) {
        console.error("\n❌ One or more assertions failed.");
        process.exit(1);
    } else {
        console.log("\n✅ All assertions passed.");
    }
}

runTests().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
});
