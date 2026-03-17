import { NextRequest, NextResponse } from "next/server";
import {
    getOwnedMemoDurationMs,
    loadPreferredTranscriptSegments,
    searchTranscriptSegments,
} from "@/lib/memo-transcript";
import { resolveMemoUserId } from "@/lib/memo-api-auth";

const CORS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

type Params = { params: Promise<{ id: string }> };

function parseOptionalInteger(value: string | null): number | null | undefined {
    if (value === null) {
        return undefined;
    }

    if (!/^-?\d+$/.test(value)) {
        return null;
    }

    return Number(value);
}

function validateSearchRequest(req: NextRequest) {
    const { searchParams } = req.nextUrl;
    const query = searchParams.get("query")?.trim() ?? "";
    if (!query) {
        return { error: "'query' is required" } as const;
    }

    const limitValue = parseOptionalInteger(searchParams.get("limit"));
    const startMs = parseOptionalInteger(searchParams.get("startMs"));
    const endMs = parseOptionalInteger(searchParams.get("endMs"));
    const startSegmentIndex = parseOptionalInteger(searchParams.get("startSegmentIndex"));
    const endSegmentIndex = parseOptionalInteger(searchParams.get("endSegmentIndex"));
    const values = [limitValue, startMs, endMs, startSegmentIndex, endSegmentIndex];
    if (values.some((value) => value === null)) {
        return { error: "Invalid transcript search bounds" } as const;
    }

    const normalizedLimitValue = limitValue === null ? undefined : limitValue;
    const normalizedStartMs = startMs === null ? undefined : startMs;
    const normalizedEndMs = endMs === null ? undefined : endMs;
    const normalizedStartSegmentIndex =
        startSegmentIndex === null ? undefined : startSegmentIndex;
    const normalizedEndSegmentIndex =
        endSegmentIndex === null ? undefined : endSegmentIndex;

    const hasTimeBounds = startMs !== undefined || endMs !== undefined;
    const hasSegmentBounds = startSegmentIndex !== undefined || endSegmentIndex !== undefined;

    if (hasTimeBounds && hasSegmentBounds) {
        return { error: "Provide either time bounds or segment bounds, not both" } as const;
    }

    if (hasTimeBounds) {
        if (
            normalizedStartMs === undefined ||
            normalizedEndMs === undefined ||
            normalizedStartMs < 0 ||
            normalizedEndMs <= normalizedStartMs
        ) {
            return { error: "Invalid transcript search bounds" } as const;
        }
    }

    if (hasSegmentBounds) {
        if (
            normalizedStartSegmentIndex === undefined ||
            normalizedEndSegmentIndex === undefined ||
            normalizedStartSegmentIndex < 0 ||
            normalizedEndSegmentIndex < normalizedStartSegmentIndex
        ) {
            return { error: "Invalid transcript search bounds" } as const;
        }
    }

    const limit = Math.min(Math.max(normalizedLimitValue ?? 10, 1), 50);

    return {
        query,
        limit,
        bounds: {
            startMs: normalizedStartMs,
            endMs: normalizedEndMs,
            startSegmentIndex: normalizedStartSegmentIndex,
            endSegmentIndex: normalizedEndSegmentIndex,
        },
    } as const;
}

export async function OPTIONS() {
    return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(req: NextRequest, { params }: Params) {
    const userId = await resolveMemoUserId(req);
    if (!userId) {
        return NextResponse.json({ error: "Memo not found" }, { status: 404, headers: CORS });
    }

    const validation = validateSearchRequest(req);
    if ("error" in validation) {
        return NextResponse.json({ error: validation.error }, { status: 422, headers: CORS });
    }

    const { id: memoId } = await params;
    const durationMs = await getOwnedMemoDurationMs(memoId, userId);
    if (durationMs === undefined) {
        return NextResponse.json({ error: "Memo not found" }, { status: 404, headers: CORS });
    }

    const transcript = await loadPreferredTranscriptSegments(memoId);
    const hits = searchTranscriptSegments(
        transcript.segments,
        validation.query,
        validation.bounds,
        validation.limit
    );

    return NextResponse.json(
        {
            search: {
                memoId,
                query: validation.query,
                source: transcript.source,
                total: hits.length,
                totalDurationMs: durationMs,
                hits,
            },
        },
        { headers: CORS }
    );
}
