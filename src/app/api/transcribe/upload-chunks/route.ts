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

type SignedChunkUploadRequestBody = {
    memoId?: unknown;
    startIndex?: unknown;
    endIndex?: unknown;
    contentType?: unknown;
};

type ParsedChunkUploadRequest =
    | {
          mode: "signed";
          memoId: string;
          startIndex: number;
          endIndex: number;
      }
    | {
          mode: "legacy";
          memoId: string;
          startIndex: number;
          endIndex: number;
          file: File;
          contentType: string;
      };

function readMemoId(value: unknown): string | null {
    return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readIndex(value: unknown): number | null {
    return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function parseFormDataIndex(value: FormDataEntryValue | null): number | null {
    if (typeof value !== "string" || value.trim().length === 0) return null;
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) ? parsed : null;
}

function isMultipartRequest(req: NextRequest): boolean {
    const contentType =
        typeof req.headers?.get === "function" ? req.headers.get("content-type") : null;
    return typeof contentType === "string" && contentType.toLowerCase().includes("multipart/form-data");
}

async function parseChunkUploadRequest(req: NextRequest): Promise<ParsedChunkUploadRequest | null> {
    if (isMultipartRequest(req)) {
        const formData = await req.formData();
        const memoId = readMemoId(formData.get("memoId"));
        const startIndex = parseFormDataIndex(formData.get("startIndex"));
        const endIndex = parseFormDataIndex(formData.get("endIndex"));
        const file = formData.get("file");

        if (
            !memoId ||
            startIndex == null ||
            endIndex == null ||
            startIndex < 0 ||
            endIndex <= startIndex ||
            !(file instanceof File)
        ) {
            return null;
        }

        return {
            mode: "legacy",
            memoId,
            startIndex,
            endIndex,
            file,
            contentType: file.type || "audio/webm",
        };
    }

    const body = (await req.json()) as SignedChunkUploadRequestBody;
    const memoId = readMemoId(body.memoId);
    const startIndex = readIndex(body.startIndex);
    const endIndex = readIndex(body.endIndex);

    if (!memoId || startIndex == null || endIndex == null || startIndex < 0 || endIndex <= startIndex) {
        return null;
    }

    return {
        mode: "signed",
        memoId,
        startIndex,
        endIndex,
    };
}

async function userOwnsMemo(memoId: string, userId: string): Promise<boolean> {
    const { data, error } = await supabaseAdmin
        .from("memos")
        .select("id")
        .eq("id", memoId)
        .eq("user_id", userId)
        .maybeSingle();

    if (error) {
        throw error;
    }

    return Boolean(data?.id);
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
        const parsedRequest = await parseChunkUploadRequest(req);

        if (!parsedRequest) {
            return withCors(
                NextResponse.json({ error: "Invalid chunk upload payload" }, { status: 400 })
            );
        }

        const { memoId, startIndex, endIndex } = parsedRequest;
        const ownedMemo = await userOwnsMemo(memoId, userId);
        if (!ownedMemo) {
            return withCors(NextResponse.json({ error: "Memo not found" }, { status: 404 }));
        }

        const objectPath =
            `audio/chunks/${memoId}/` +
            `${String(startIndex).padStart(7, "0")}-${String(endIndex).padStart(7, "0")}.webm`;
        const storage = supabaseAdmin.storage.from("voice-memos");

        if (parsedRequest.mode === "legacy") {
            const { error } = await storage.upload(objectPath, parsedRequest.file, {
                upsert: true,
                contentType: parsedRequest.contentType,
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
        }

        const { data, error } = await storage.createSignedUploadUrl(objectPath, {
            upsert: true,
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

        console.log("[chunk-upload] prepared", { memoId, startIndex, endIndex, path: objectPath });
        return withCors(
            NextResponse.json({
                ok: true,
                path: data.path,
                token: data.token,
            })
        );
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
