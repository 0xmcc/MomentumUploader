import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { resolveMemoUserId } from "@/lib/memo-api-auth";

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

function parseIndex(value: FormDataEntryValue | null): number | null {
    if (typeof value !== "string" || value.trim().length === 0) return null;
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) ? parsed : null;
}

export async function OPTIONS() {
    return withCors(new NextResponse(null, { status: 204 }));
}

export async function POST(req: NextRequest) {
    const userId = await resolveMemoUserId(req);
    if (!userId) {
        return withCors(NextResponse.json({ error: "Unauthorized" }, { status: 401 }));
    }

    try {
        const formData = await req.formData();
        const memoIdValue = formData.get("memoId");
        const memoId =
            typeof memoIdValue === "string" && memoIdValue.trim().length > 0
                ? memoIdValue.trim()
                : null;
        const startIndex = parseIndex(formData.get("startIndex"));
        const endIndex = parseIndex(formData.get("endIndex"));
        const file = formData.get("file") as File | null;

        if (!memoId || startIndex == null || endIndex == null || startIndex < 0 || endIndex <= startIndex || !file) {
            return withCors(
                NextResponse.json({ error: "Invalid chunk upload payload" }, { status: 400 })
            );
        }

        const objectPath =
            `audio/chunks/${memoId}/` +
            `${String(startIndex).padStart(7, "0")}-${String(endIndex).padStart(7, "0")}.webm`;
        const { error } = await supabaseAdmin.storage
            .from("voice-memos")
            .upload(objectPath, file, {
                upsert: true,
                contentType: file.type || "audio/webm",
            });

        if (error) {
            console.error("[chunk-upload]", error);
            return withCors(
                NextResponse.json({ error: "Failed to store audio chunk" }, { status: 500 })
            );
        }

        return withCors(NextResponse.json({ ok: true }));
    } catch (error) {
        console.error("[chunk-upload]", error);
        return withCors(
            NextResponse.json({ error: "Failed to store audio chunk" }, { status: 500 })
        );
    }
}
