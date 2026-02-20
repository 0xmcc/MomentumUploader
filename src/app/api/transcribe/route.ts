import { NextRequest, NextResponse } from "next/server";
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
    LOG("init", "Request received");

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
        const file = formData.get("file") as File | null;

        if (!file) {
            ERR("parse", "No file in formData", null);
            return NextResponse.json({ error: "No audio file provided" }, { status: 400 });
        }

        LOG("parse", `File received: name=${file.name}, size=${file.size} bytes, type=${file.type}`);

        // --- Step 1: Upload to Supabase Storage ---
        const fileName = `${Date.now()}_${file.name || "audio.webm"}`;
        LOG("storage", `Uploading as: audio/${fileName}`);

        let fileUrl = "";
        try {
            const uploadResult = await uploadAudio(file, fileName);
            LOG("storage", "Upload result", uploadResult);

            const { data } = supabase.storage
                .from("voice-memos")
                .getPublicUrl(`audio/${fileName}`);
            fileUrl = data.publicUrl;
            LOG("storage", "Public URL", fileUrl);
        } catch (uploadError) {
            ERR("storage", "Supabase upload failed", uploadError);
            return NextResponse.json(
                { error: "Failed to upload file to Supabase", detail: String(uploadError) },
                { status: 500 }
            );
        }

        // --- Step 2: Transcribe via NVIDIA Parakeet-CTC (gRPC) ---
        LOG("nvidia", "Sending audio to NVIDIA Parakeet via gRPC...");
        let transcriptionText = "";
        try {
            const audioBuffer = Buffer.from(await file.arrayBuffer());
            LOG("nvidia", `Audio buffer size: ${audioBuffer.byteLength} bytes`);

            transcriptionText = await transcribeAudio(
                audioBuffer,
                process.env.NVIDIA_API_KEY!,
                file.type || "audio/webm"
            );

            LOG("nvidia", "Transcription result", transcriptionText);
        } catch (transcriptionError) {
            ERR("nvidia", "Transcription failed", transcriptionError);
            transcriptionText = "[Transcription failed]";
        }

        // --- Step 3: Save to Supabase DB ---
        LOG("db", "Inserting into items table...");
        try {
            const { data: dbData, error: dbError } = await supabaseAdmin.from("items").insert({
                user_id: "anonymous_user",
                type: "voice",
                source: "other",
                source_type: "audio",
                content: transcriptionText,
                source_url: fileUrl,
                metadata: { file_url: fileUrl },
                dedupe_key: fileName,
                content_hash: fileName,
            }).select();

            if (dbError) {
                ERR("db", "DB insert error", dbError);
            } else {
                LOG("db", "Inserted row", dbData);
            }
        } catch (dbErr) {
            ERR("db", "Unexpected DB error", dbErr);
        }

        LOG("done", "Returning success response");
        return NextResponse.json({
            success: true,
            text: transcriptionText,
            url: fileUrl,
            modelUsed: "nvidia/parakeet-rnnt-1.1b",
        });

    } catch (error) {
        ERR("catch", "Unhandled error in POST handler", error);
        return NextResponse.json({ error: "Failed to transcribe audio" }, { status: 500 });
    }
}
