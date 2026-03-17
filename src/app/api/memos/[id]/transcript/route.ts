import { NextRequest, NextResponse } from "next/server";
import {
    buildTranscriptWindow,
    getOwnedMemoDurationMs,
    loadPreferredTranscriptSegments,
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

function validateBounds(req: NextRequest) {
    const { searchParams } = req.nextUrl;
    const startMs = parseOptionalInteger(searchParams.get("startMs"));
    const endMs = parseOptionalInteger(searchParams.get("endMs"));
    const startSegmentIndex = parseOptionalInteger(searchParams.get("startSegmentIndex"));
    const endSegmentIndex = parseOptionalInteger(searchParams.get("endSegmentIndex"));
    const contextBeforeMs = parseOptionalInteger(searchParams.get("contextBeforeMs")) ?? 0;
    const contextAfterMs = parseOptionalInteger(searchParams.get("contextAfterMs")) ?? 0;

    const values = [startMs, endMs, startSegmentIndex, endSegmentIndex, contextBeforeMs, contextAfterMs];
    if (values.some((value) => value === null)) {
        return { error: "Invalid transcript bounds" } as const;
    }

    if ((contextBeforeMs as number) < 0 || (contextAfterMs as number) < 0) {
        return { error: "Invalid transcript bounds" } as const;
    }

    const normalizedStartMs = startMs === null ? undefined : startMs;
    const normalizedEndMs = endMs === null ? undefined : endMs;
    const normalizedStartSegmentIndex =
        startSegmentIndex === null ? undefined : startSegmentIndex;
    const normalizedEndSegmentIndex =
        endSegmentIndex === null ? undefined : endSegmentIndex;
    const normalizedContextBeforeMs = contextBeforeMs === null ? 0 : contextBeforeMs;
    const normalizedContextAfterMs = contextAfterMs === null ? 0 : contextAfterMs;

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
            return { error: "Invalid transcript bounds" } as const;
        }
    }

    if (hasSegmentBounds) {
        if (
            normalizedStartSegmentIndex === undefined ||
            normalizedEndSegmentIndex === undefined ||
            normalizedStartSegmentIndex < 0 ||
            normalizedEndSegmentIndex < normalizedStartSegmentIndex
        ) {
            return { error: "Invalid transcript bounds" } as const;
        }
    }

    return {
        bounds: {
            startMs: normalizedStartMs,
            endMs: normalizedEndMs,
            startSegmentIndex: normalizedStartSegmentIndex,
            endSegmentIndex: normalizedEndSegmentIndex,
            contextBeforeMs: normalizedContextBeforeMs,
            contextAfterMs: normalizedContextAfterMs,
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

    const validation = validateBounds(req);
    if ("error" in validation) {
        return NextResponse.json({ error: validation.error }, { status: 422, headers: CORS });
    }

    const { id: memoId } = await params;
    const durationMs = await getOwnedMemoDurationMs(memoId, userId);
    if (durationMs === undefined) {
        return NextResponse.json({ error: "Memo not found" }, { status: 404, headers: CORS });
    }

    const transcript = await loadPreferredTranscriptSegments(memoId);
    const window = buildTranscriptWindow(transcript.segments, validation.bounds);

    return NextResponse.json(
        {
            transcript: {
                memoId,
                source: transcript.source,
                totalDurationMs: durationMs,
                windowStartMs: window.windowStartMs,
                windowEndMs: window.windowEndMs,
                hasMoreBefore: window.hasMoreBefore,
                hasMoreAfter: window.hasMoreAfter,
                segments: window.segments,
            },
        },
        { headers: CORS }
    );
}
