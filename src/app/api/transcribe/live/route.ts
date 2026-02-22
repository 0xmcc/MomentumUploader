import { NextRequest, NextResponse } from "next/server";
import { transcribeAudio } from "@/lib/riva";

export async function POST(req: NextRequest) {
    const startedAtMs = Date.now();
    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file || file.size < 1000) {
        // Too small to contain meaningful speech; skip rather than error
        return NextResponse.json({ text: "" });
    }

    try {
        const audioBuffer = Buffer.from(await file.arrayBuffer());
        const text = await transcribeAudio(
            audioBuffer,
            process.env.NVIDIA_API_KEY!,
            file.type || "audio/webm",
            { priority: "live" }
        );
        console.log("[api/transcribe/live] timing_ms", Date.now() - startedAtMs);
        return NextResponse.json({ text });
    } catch (err) {
        // Non-fatal — live transcription is best-effort
        console.error("[api/transcribe/live]", err);
        return NextResponse.json({ text: "" });
    }
}
