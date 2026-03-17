/** @jest-environment node */

import { resolveMemoShare } from "@/lib/memo-share";
import { supabaseAdmin } from "@/lib/supabase";

jest.mock("@/lib/supabase", () => ({
  supabaseAdmin: {
    from: jest.fn(),
  },
}));

type MemoShareRow = {
  id: string;
  title: string;
  transcript: string;
  transcript_status: string;
  audio_url: string | null;
  created_at: string;
  share_token: string;
  shared_at: string | null;
  share_expires_at?: string | null;
  expires_at?: string | null;
  revoked_at?: string | null;
  is_shareable?: boolean;
};

function setupMemoShareMocks(row: MemoShareRow) {
  const maybeSingle = jest.fn().mockResolvedValue({ data: row, error: null });
  const memoEq = jest.fn(() => ({ maybeSingle }));
  const memoSelect = jest.fn(() => ({ eq: memoEq }));

  const segmentOrder = jest.fn().mockResolvedValue({
    data: [
      {
        segment_index: 0,
        start_ms: 0,
        end_ms: 2500,
        text: "First segment",
      },
    ],
    error: null,
  });
  const segmentEq2 = jest.fn(() => ({ order: segmentOrder }));
  const segmentEq1 = jest.fn(() => ({ eq: segmentEq2 }));
  const segmentSelect = jest.fn(() => ({ eq: segmentEq1 }));

  (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
    if (table === "memo_transcript_segments") {
      return { select: segmentSelect };
    }

    return { select: memoSelect };
  });
}

describe("resolveMemoShare", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("returns a memo-pure share payload without renderer-only fields", async () => {
    setupMemoShareMocks({
      id: "memo-123",
      title: "Weekly Sync",
      transcript: "We reviewed the roadmap.",
      transcript_status: "complete",
      audio_url: "https://cdn.example.com/audio.webm",
      created_at: "2026-03-10T10:00:00.000Z",
      share_token: "ignored-in-row",
      shared_at: "2026-03-10T10:05:00.000Z",
      share_expires_at: null,
      revoked_at: null,
      is_shareable: true,
    });

    const result = await resolveMemoShare("token1234");

    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      throw new Error("Expected ok result");
    }

    expect(result.memo).toEqual({
      memoId: "memo-123",
      shareToken: "token1234",
      title: "Weekly Sync",
      transcript: "We reviewed the roadmap.",
      transcriptStatus: "complete",
      transcriptSegments: [
        {
          id: "0",
          startMs: 0,
          endMs: 2500,
          text: "First segment",
        },
      ],
      mediaUrl: "https://cdn.example.com/audio.webm",
      isLiveRecording: false,
      createdAt: "2026-03-10T10:00:00.000Z",
      sharedAt: "2026-03-10T10:05:00.000Z",
      expiresAt: null,
    });
    expect(result.memo).not.toHaveProperty("canonicalUrl");
    expect(result.memo).not.toHaveProperty("artifactType");
    expect(result.memo).not.toHaveProperty("artifacts");
  });
});
