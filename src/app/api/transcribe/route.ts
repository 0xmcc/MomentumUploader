import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { uploadAudio, supabase, supabaseAdmin } from "@/lib/supabase";
import { transcribeAudio } from "@/lib/riva";

const LOG = (step: string, msg: string, data?: unknown) => {
    const prefix = `[transcribe/${step}]`;
    if (data !== undefined) {
        console.log(prefix, msg, JSON.stringify(data, null, 2));
    } else {
        console.log(prefix, msg);
    }
};
const ERR = (step: string, msg: string, err: unknown) => {
    console.error(`[transcribe/${step}] ❌ ${msg}`, err);
};

export async function POST(req: NextRequest) {
    const startedAtMs = Date.now();
    LOG("init", "Request received");
    const { userId } = await auth();
    if (!userId) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // --- Env check ---
    LOG("env", "NEXT_PUBLIC_SUPABASE_URL set?", !!process.env.NEXT_PUBLIC_SUPABASE_URL);
    LOG("env", "NEXT_PUBLIC_SUPABASE_ANON_KEY set?", !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    LOG("env", "NVIDIA_API_KEY set?", !!process.env.NVIDIA_API_KEY);
    // Log first 20 chars of each key so you can confirm it's not the placeholder
    LOG("env", "SUPABASE_URL prefix", process.env.NEXT_PUBLIC_SUPABASE_URL?.slice(0, 30));
    LOG("env", "SUPABASE_KEY prefix", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.slice(0, 20));
    LOG("env", "NVIDIA_KEY prefix", process.env.NVIDIA_API_KEY?.slice(0, 12));

    try {
        const formData = await req.formData();
        LOG("timing", "Parsed form data ms", Date.now() - startedAtMs);
        const file = formData.get("file") as File | null;

        if (!file) {
            ERR("parse", "No file in formData", null);
            return NextResponse.json({ error: "No audio file provided" }, { status: 400 });
        }

        LOG("parse", `File received: name=${file.name}, size=${file.size} bytes, type=${file.type}`);

        // --- Step 1: Upload to Supabase Storage ---
        const fileName = `${Date.now()}_${file.name || "audio.webm"}`;
        LOG("storage", `Uploading as: audio/${fileName}`);

        const audioBuffer = Buffer.from(await file.arrayBuffer());
        LOG("storage", `Audio buffer size: ${audioBuffer.byteLength} bytes`);

        let fileUrl = "";
        try {
            const uploadResult = await uploadAudio(audioBuffer, fileName, file.type);
            LOG("storage", "Upload result", uploadResult);

            const { data } = supabase.storage
                .from("voice-memos")
                .getPublicUrl(`audio/${fileName}`);
            fileUrl = data.publicUrl;
            LOG("storage", "Public URL", fileUrl);
            LOG("timing", "Storage upload ms", Date.now() - startedAtMs);
        } catch (uploadError) {
            ERR("storage", "Supabase upload failed", uploadError);
            return NextResponse.json(
                { error: "Failed to upload file to Supabase", detail: String(uploadError) },
                { status: 500 }
            );
        }

        // --- Step 2: Transcribe via NVIDIA Parakeet-CTC (gRPC) ---
        LOG("nvidia", "Sending audio to NVIDIA Parakeet via gRPC...");
        const transcribeStartMs = Date.now();
        let transcriptionText = "";
        try {

            transcriptionText = await transcribeAudio(
                audioBuffer,
                process.env.NVIDIA_API_KEY!,
                file.type || "audio/webm",
                { priority: "final" }
            );

            LOG("nvidia", "Transcription result", transcriptionText);
            LOG("timing", "Transcription ms", Date.now() - transcribeStartMs);
        } catch (transcriptionError) {
            ERR("nvidia", "Transcription failed", transcriptionError);
            transcriptionText = "[Transcription failed]";
        }

        // --- Step 3: Save to Supabase DB ---
        LOG("db", "Inserting into memos table...");
        try {
            const { data: dbData, error: dbError } = await supabaseAdmin.from("memos").insert({
                title: file.name || "Voice Memo",
                transcript: transcriptionText,
                audio_url: fileUrl,
                user_id: userId,
            }).select();

            if (dbError) {
                ERR("db", "DB insert error", dbError);
                return NextResponse.json(
                    { error: "Failed to save memo", detail: dbError.message },
                    { status: 500 }
                );
            }

            const insertedId = dbData?.[0]?.id as string | undefined;
            if (!insertedId) {
                ERR("db", "Insert returned no ID", dbData);
                return NextResponse.json(
                    { error: "Failed to save memo", detail: "No ID returned" },
                    { status: 500 }
                );
            }

            LOG("db", "Inserted row", dbData);
            LOG("timing", "Total request ms", Date.now() - startedAtMs);
            LOG("done", "Returning success response");
            return NextResponse.json({
                success: true,
                id: insertedId,
                text: transcriptionText,
                url: fileUrl,
                modelUsed: "nvidia/parakeet-rnnt-1.1b",
            });
        } catch (dbErr) {
            ERR("db", "Unexpected DB error", dbErr);
            return NextResponse.json(
                { error: "Failed to save memo", detail: String(dbErr) },
                { status: 500 }
            );
        }

    } catch (error) {
        ERR("catch", "Unhandled error in POST handler", error);
        return NextResponse.json({ error: "Failed to transcribe audio" }, { status: 500 });
    }
}
