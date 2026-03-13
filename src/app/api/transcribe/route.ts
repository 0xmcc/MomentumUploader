import { NextRequest, NextResponse } from "next/server";
import { resolveMemoUserId } from "@/lib/memo-api-auth";
import {
    ERR,
    LOG,
    parseUploadRequest,
    persistMemoProvisional,
    promoteLiveSegmentsToFinal,
    transcribeUploadedAudio,
    updateMemoFailed,
    updateMemoFinal,
    uploadAudioToStorage,
} from "./workflow";

const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function withCors(response: NextResponse) {
    if (typeof response.headers?.set === "function") {
        Object.entries(CORS).forEach(([key, value]) => {
            response.headers.set(key, value);
        });
    }
    return response;
}

export async function OPTIONS() {
    return withCors(new NextResponse(null, { status: 204 }));
}

export async function POST(req: NextRequest) {
    const startedAtMs = Date.now();
    LOG("init", "Request received");

    const userId = await resolveMemoUserId(req);
    if (!userId) {
        return withCors(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    }

    LOG("env", "NEXT_PUBLIC_SUPABASE_URL set?", !!process.env.NEXT_PUBLIC_SUPABASE_URL);
    LOG("env", "NEXT_PUBLIC_SUPABASE_ANON_KEY set?", !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    LOG("env", "NVIDIA_API_KEY set?", !!process.env.NVIDIA_API_KEY);
    LOG("env", "SUPABASE_URL prefix", process.env.NEXT_PUBLIC_SUPABASE_URL?.slice(0, 30));
    LOG("env", "SUPABASE_KEY prefix", process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.slice(0, 20));
    LOG("env", "NVIDIA_KEY prefix", process.env.NVIDIA_API_KEY?.slice(0, 12));

    try {
        const parsed = await parseUploadRequest(req, startedAtMs);
        if (!parsed.ok) return withCors(parsed.response);

        const nvidiaApiKey = process.env.NVIDIA_API_KEY?.trim();
        if (!parsed.data.provisionalTranscript && !nvidiaApiKey) {
            ERR("env", "NVIDIA_API_KEY is missing", null);
            return withCors(NextResponse.json(
                {
                    error: "Transcription is not configured",
                    detail: "NVIDIA_API_KEY is not set on the server.",
                },
                { status: 500 }
            ));
        }

        const uploaded = await uploadAudioToStorage(parsed.data, startedAtMs);
        if (!uploaded.ok) return withCors(uploaded.response);

        // Stage A: persist memo row immediately after audio is stored.
        // This guarantees the recording is accessible even if transcription fails.
        const provisional = await persistMemoProvisional(
            uploaded.data.memoId,
            uploaded.data.fileUrl,
            userId
        );
        if (!provisional.ok) return withCors(provisional.response);

        const resolvedMemoId = provisional.data.memoId;
        LOG("db", "Provisional memo persisted", { id: resolvedMemoId });

        if (parsed.data.provisionalTranscript) {
            await promoteLiveSegmentsToFinal(resolvedMemoId, userId);
            return withCors(
                await updateMemoFinal(
                    resolvedMemoId,
                    parsed.data.provisionalTranscript,
                    [],
                    uploaded.data.fileUrl,
                    userId,
                    startedAtMs,
                )
            );
        }

        // Stage B: transcribe, then finalize or mark failed.
        const transcription = await transcribeUploadedAudio(uploaded.data, nvidiaApiKey!);
        if (!transcription.ok) {
            // Transcription failed but audio is safe. Mark memo failed and return 200.
            LOG("nvidia", "Transcription failed; marking memo failed and returning degraded 200");
            return withCors(await updateMemoFailed(resolvedMemoId, uploaded.data.fileUrl, userId, startedAtMs));
        }

        const { transcript, segments } = transcription.data;
        return withCors(await updateMemoFinal(resolvedMemoId, transcript, segments, uploaded.data.fileUrl, userId, startedAtMs));
    } catch (error) {
        ERR("catch", "Unhandled error in POST handler", error);
        return withCors(NextResponse.json({ error: "Failed to transcribe audio" }, { status: 500 }));
    }
}
