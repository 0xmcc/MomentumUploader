import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
    ERR,
    LOG,
    parseUploadRequest,
    persistMemo,
    transcribeUploadedAudio,
    uploadAudioToStorage,
} from "./workflow";

export async function POST(req: NextRequest) {
    const startedAtMs = Date.now();
    LOG("init", "Request received");

    const { userId } = await auth();
    if (!userId) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const nvidiaApiKey = process.env.NVIDIA_API_KEY?.trim();
    if (!nvidiaApiKey) {
        ERR("env", "NVIDIA_API_KEY is missing", null);
        return NextResponse.json(
            {
                error: "Transcription is not configured",
                detail: "NVIDIA_API_KEY is not set on the server.",
            },
            { status: 500 }
        );
    }

    LOG("env", "NEXT_PUBLIC_SUPABASE_URL set?", !!process.env.NEXT_PUBLIC_SUPABASE_URL);
    LOG("env", "NEXT_PUBLIC_SUPABASE_ANON_KEY set?", !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    LOG("env", "NVIDIA_API_KEY set?", !!process.env.NVIDIA_API_KEY);
    LOG("env", "SUPABASE_URL prefix", process.env.NEXT_PUBLIC_SUPABASE_URL?.slice(0, 30));
    LOG("env", "SUPABASE_KEY prefix", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.slice(0, 20));
    LOG("env", "NVIDIA_KEY prefix", process.env.NVIDIA_API_KEY?.slice(0, 12));

    try {
        const parsed = await parseUploadRequest(req, startedAtMs);
        if (!parsed.ok) return parsed.response;

        const uploaded = await uploadAudioToStorage(parsed.data, startedAtMs);
        if (!uploaded.ok) return uploaded.response;

        const transcription = await transcribeUploadedAudio(uploaded.data, nvidiaApiKey);
        if (!transcription.ok) return transcription.response;

        return persistMemo(
            uploaded.data,
            transcription.data,
            userId,
            startedAtMs
        );
    } catch (error) {
        ERR("catch", "Unhandled error in POST handler", error);
        return NextResponse.json({ error: "Failed to transcribe audio" }, { status: 500 });
    }
}
