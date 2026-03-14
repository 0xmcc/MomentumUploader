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

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) return error.message;
    if (typeof error === "object" && error !== null && "message" in error) {
        return String((error as { message?: unknown }).message ?? "");
    }
    return String(error);
}

function logChunkUploadError(error: unknown) {
    const message = getErrorMessage(error);
    const details =
        typeof error === "object" && error !== null && "details" in error
            ? String((error as { details?: unknown }).details ?? "")
            : "";
    const statusCode =
        typeof error === "object" && error !== null && "statusCode" in error
            ? String((error as { statusCode?: unknown }).statusCode ?? "")
            : "";
    console.error("[chunk-upload]", message, { details, statusCode });
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
            logChunkUploadError(error);
            return withCors(
                NextResponse.json(
                    { error: "Failed to store audio chunk", detail: getErrorMessage(error) },
                    { status: 500 }
                )
            );
        }

        console.log("[chunk-upload] ok", { memoId, startIndex, endIndex, path: objectPath });
        return withCors(NextResponse.json({ ok: true }));
    } catch (error) {
        logChunkUploadError(error);
        return withCors(
            NextResponse.json(
                { error: "Failed to store audio chunk", detail: getErrorMessage(error) },
                { status: 500 }
            )
        );
    }
}
