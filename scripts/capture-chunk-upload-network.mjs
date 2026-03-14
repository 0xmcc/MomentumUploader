/**
 * Captures network traffic for POST /api/transcribe/upload-chunks while recording.
 * Run with: npx playwright run scripts/capture-chunk-upload-network.mjs (or node + playwright API)
 *
 * Prereqs: dev server running (npm run dev), and you may need to be signed in.
 * Usage: node scripts/capture-chunk-upload-network.mjs
 */

import { chromium } from "playwright";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const WAIT_AFTER_START_MS = 38_000; // Just over one 30s interval
const OUTPUT_FILE = "network-capture-upload-chunks.json";

const uploadChunksCalls = [];

async function main() {
    const browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();

    page.on("request", (request) => {
        const url = request.url();
        if (url.includes("/api/transcribe/upload-chunks")) {
            uploadChunksCalls.push({
                time: new Date().toISOString(),
                method: request.method(),
                url,
                postData: request.postData() ? "(present)" : null,
            });
        }
    });

    page.on("response", async (response) => {
        const url = response.url();
        if (url.includes("/api/transcribe/upload-chunks")) {
            const status = response.status();
            let body = null;
            try {
                body = await response.text();
            } catch {
                body = "(failed to read body)";
            }
            const last = uploadChunksCalls[uploadChunksCalls.length - 1];
            if (last) {
                last.status = status;
                last.responseBody = body;
            }
        }
    });

    console.log("Navigating to", BASE_URL);
    await page.goto(BASE_URL, { waitUntil: "networkidle" });

    const startButton = page.getByRole("button", { name: /start recording/i });
    await startButton.waitFor({ state: "visible", timeout: 15_000 }).catch(() => null);
    const visible = await startButton.isVisible();
    if (!visible) {
        console.log("Start recording button not visible (maybe not signed in?). Waiting anyway to capture any requests.");
    } else {
        console.log("Clicking Start recording...");
        await startButton.click();
    }

    console.log("Waiting", WAIT_AFTER_START_MS / 1000, "seconds for chunk upload interval...");
    await page.waitForTimeout(WAIT_AFTER_START_MS);

    const result = {
        capturedAt: new Date().toISOString(),
        baseUrl: BASE_URL,
        uploadChunksCalls,
        summary: {
            totalCalls: uploadChunksCalls.length,
            statuses: uploadChunksCalls.map((c) => c.status),
        },
    };

    const fs = await import("fs");
    const path = await import("path");
    const outPath = path.join(process.cwd(), OUTPUT_FILE);
    fs.writeFileSync(outPath, JSON.stringify(result, null, 2), "utf8");
    console.log("Wrote", outPath);
    console.log("upload-chunks calls:", uploadChunksCalls.length);
    uploadChunksCalls.forEach((c, i) => {
        console.log(`  ${i + 1}. ${c.status ?? "?"} ${c.url}`);
    });

    await browser.close();
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
