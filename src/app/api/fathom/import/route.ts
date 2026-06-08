import { NextRequest, NextResponse } from "next/server";
import { resolveMemoUserId } from "@/lib/memo-api-auth";
import { supabaseAdmin } from "@/lib/supabase";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

const FATHOM_MEETINGS_URL = "https://api.fathom.ai/external/v1/meetings";
const MAX_FATHOM_PAGES = 20;
export const FATHOM_REQUEST_TIMEOUT_MS = 25_000;

class FathomTimeoutError extends Error {
  constructor() {
    super("Fathom did not respond before the import timeout.");
    this.name = "FathomTimeoutError";
  }
}

type FathomTranscriptEntry = {
  speaker?: {
    display_name?: unknown;
  };
  text?: unknown;
  timestamp?: unknown;
};

type FathomMeeting = {
  title?: unknown;
  meeting_title?: unknown;
  recording_id?: unknown;
  url?: unknown;
  share_url?: unknown;
  created_at?: unknown;
  scheduled_start_time?: unknown;
  recording_start_time?: unknown;
  recording_end_time?: unknown;
  transcript?: unknown;
};

type FathomMeetingsResponse = {
  items?: unknown;
  next_cursor?: unknown;
};

type ImportedSegment = {
  segmentIndex: number;
  startMs: number;
  endMs: number;
  text: string;
};

type ImportedMeeting = {
  sourceId: string;
  title: string;
  transcript: string;
  sourceUrl: string;
  createdAt: string | null;
  durationSeconds: number | null;
  segments: ImportedSegment[];
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: CORS });
}

function getString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function getSourceId(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return getString(value);
}

function parseIsoDate(value: unknown): string | null {
  const raw = getString(value);
  if (!raw) return null;

  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function getDurationSeconds(startValue: unknown, endValue: unknown): number | null {
  const start = parseIsoDate(startValue);
  const end = parseIsoDate(endValue);
  if (!start || !end) return null;

  const durationMs = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(durationMs) || durationMs < 0) return null;

  return Math.round(durationMs / 1000);
}

function parseTimestampMs(value: unknown): number {
  const raw = getString(value);
  if (!raw) return 0;

  const parts = raw.split(":").map((part) => Number.parseFloat(part));
  if (parts.some((part) => !Number.isFinite(part) || part < 0)) {
    return 0;
  }

  let seconds = 0;
  if (parts.length === 3) {
    seconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
  } else if (parts.length === 2) {
    seconds = parts[0] * 60 + parts[1];
  } else if (parts.length === 1) {
    seconds = parts[0];
  }

  return Math.max(0, Math.round(seconds * 1000));
}

function estimateSegmentDurationMs(text: string): number {
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1000, wordCount * 400);
}

function formatTranscriptEntry(entry: FathomTranscriptEntry): string | null {
  const text = getString(entry.text);
  if (!text) return null;

  const speakerName = getString(entry.speaker?.display_name);
  return speakerName ? `${speakerName}: ${text}` : text;
}

function normalizeTranscriptEntries(entries: FathomTranscriptEntry[]): ImportedSegment[] {
  const prepared = entries
    .map((entry) => ({
      startMs: parseTimestampMs(entry.timestamp),
      text: formatTranscriptEntry(entry),
    }))
    .filter((entry): entry is { startMs: number; text: string } => entry.text !== null);

  return prepared.map((entry, index) => {
    const nextStartMs = prepared[index + 1]?.startMs;
    const fallbackEndMs = entry.startMs + estimateSegmentDurationMs(entry.text);

    return {
      segmentIndex: index,
      startMs: entry.startMs,
      endMs:
        nextStartMs !== undefined && nextStartMs >= entry.startMs
          ? nextStartMs
          : fallbackEndMs,
      text: entry.text,
    };
  });
}

function normalizeMeeting(rawMeeting: unknown): ImportedMeeting | null {
  const meeting =
    rawMeeting && typeof rawMeeting === "object"
      ? (rawMeeting as FathomMeeting)
      : null;
  if (!meeting) return null;

  const sourceId = getSourceId(meeting.recording_id);
  if (!sourceId) return null;

  const rawTranscript = Array.isArray(meeting.transcript)
    ? (meeting.transcript as FathomTranscriptEntry[])
    : [];
  const segments = normalizeTranscriptEntries(rawTranscript);
  const transcript = segments.map((segment) => segment.text).join("\n\n");
  const title =
    getString(meeting.meeting_title) ??
    getString(meeting.title) ??
    "Fathom meeting";

  return {
    sourceId,
    title,
    transcript,
    sourceUrl: getString(meeting.share_url) ?? getString(meeting.url) ?? "",
    createdAt:
      parseIsoDate(meeting.created_at) ??
      parseIsoDate(meeting.recording_start_time) ??
      parseIsoDate(meeting.scheduled_start_time),
    durationSeconds: getDurationSeconds(
      meeting.recording_start_time,
      meeting.recording_end_time
    ),
    segments,
  };
}

async function fetchFathomMeetings(apiKey: string): Promise<FathomMeeting[]> {
  const meetings: FathomMeeting[] = [];
  let cursor: string | null = null;

  for (let page = 0; page < MAX_FATHOM_PAGES; page += 1) {
    const url = new URL(FATHOM_MEETINGS_URL);
    url.searchParams.set("include_transcript", "true");
    url.searchParams.set("include_summary", "true");
    url.searchParams.set("include_action_items", "true");
    if (cursor) {
      url.searchParams.set("cursor", cursor);
    }

    const response = await fetchFathomPage(url.toString(), apiKey);

    if (!response.ok) {
      throw new Error(`Fathom request failed with status ${response.status}`);
    }

    const body = (await response.json()) as FathomMeetingsResponse;
    const pageItems = Array.isArray(body.items) ? body.items : [];
    meetings.push(...(pageItems as FathomMeeting[]));

    cursor = getString(body.next_cursor);
    if (!cursor) break;
  }

  return meetings;
}

async function fetchFathomPage(url: string, apiKey: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, FATHOM_REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, {
      headers: {
        "X-Api-Key": apiKey,
        Accept: "application/json",
      },
      signal: controller.signal,
    });
  } catch (error) {
    if (
      controller.signal.aborted ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      throw new FathomTimeoutError();
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function replaceFinalSegments(
  memoId: string,
  userId: string,
  segments: ImportedSegment[]
) {
  const { error: deleteError } = await supabaseAdmin
    .from("memo_transcript_segments")
    .delete()
    .eq("memo_id", memoId)
    .eq("source", "final");

  if (deleteError) {
    throw deleteError;
  }

  if (segments.length === 0) {
    return;
  }

  const rows = segments.map((segment) => ({
    memo_id: memoId,
    user_id: userId,
    segment_index: segment.segmentIndex,
    start_ms: segment.startMs,
    end_ms: segment.endMs,
    text: segment.text,
    source: "final" as const,
  }));

  const { error: insertError } = await supabaseAdmin
    .from("memo_transcript_segments")
    .insert(rows);

  if (insertError) {
    throw insertError;
  }
}

async function persistMeeting(userId: string, meeting: ImportedMeeting) {
  const memoPayload: Record<string, unknown> = {
    user_id: userId,
    source_app: "fathom",
    source_id: meeting.sourceId,
    title: meeting.title,
    transcript: meeting.transcript,
    audio_url: meeting.sourceUrl,
    transcript_status: "complete",
  };

  if (meeting.createdAt) {
    memoPayload.created_at = meeting.createdAt;
  }
  if (meeting.durationSeconds !== null) {
    memoPayload.duration = meeting.durationSeconds;
  }

  const { data, error } = await supabaseAdmin
    .from("memos")
    .upsert(memoPayload, { onConflict: "user_id,source_app,source_id" })
    .select("id, source_id")
    .single();

  if (error || !data?.id) {
    throw error ?? new Error("Fathom memo upsert did not return an id.");
  }

  await replaceFinalSegments(String(data.id), userId, meeting.segments);
}

export async function POST(req: NextRequest) {
  const userId = await resolveMemoUserId(req);
  if (!userId) {
    return json({ error: "Unauthorized" }, 401);
  }

  const fathomApiKey = process.env.FATHOM_API_KEY?.trim();
  if (!fathomApiKey) {
    return json(
      {
        error: "Fathom import is not configured",
        detail: "FATHOM_API_KEY is not set on the server.",
      },
      503
    );
  }

  try {
    const rawMeetings = await fetchFathomMeetings(fathomApiKey);
    const meetings = rawMeetings
      .map(normalizeMeeting)
      .filter((meeting): meeting is ImportedMeeting => meeting !== null);

    for (const meeting of meetings) {
      await persistMeeting(userId, meeting);
    }

    return json({ imported: meetings.length, meetings: rawMeetings.length });
  } catch (error) {
    if (error instanceof FathomTimeoutError) {
      return json(
        {
          error: "Fathom import timed out",
          detail: error.message,
        },
        504
      );
    }

    const detail = error instanceof Error ? error.message : String(error);
    return json({ error: "Failed to import Fathom meetings", detail }, 502);
  }
}
