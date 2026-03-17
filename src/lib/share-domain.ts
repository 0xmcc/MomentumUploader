import type { TranscriptSegment } from "@/lib/transcript";

export type ResolvedMemoShare = {
  memoId: string;
  shareToken: string;
  title: string;
  transcript: string;
  transcriptStatus: string | null;
  transcriptSegments: TranscriptSegment[] | null;
  mediaUrl: string | null;
  isLiveRecording: boolean;
  createdAt: string;
  sharedAt: string | null;
  expiresAt: string | null;
};
