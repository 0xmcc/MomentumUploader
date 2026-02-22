import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type SyntheticEvent,
} from "react";
import {
  SHARE_STATE_RESET_MS,
  copyToClipboard,
  type Memo,
} from "@/lib/memo-ui";

export type ShareState = "idle" | "loading" | "copied" | "error";

function getShareLabel(shareState: ShareState) {
  if (shareState === "copied") return "Copied";
  if (shareState === "loading") return "Sharing...";
  if (shareState === "error") return "Retry Share";
  return "Share";
}

export function useMemoPlayback(memo: Memo) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState<number | null>(null);
  const [shareState, setShareState] = useState<ShareState>("idle");
  const [lastShareUrl, setLastShareUrl] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const shareResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearShareResetTimer = useCallback(() => {
    if (shareResetTimerRef.current) {
      clearTimeout(shareResetTimerRef.current);
      shareResetTimerRef.current = null;
    }
  }, []);

  useEffect(() => {
    setShareState("idle");
    setLastShareUrl(null);
    clearShareResetTimer();

    return () => {
      clearShareResetTimer();
    };
  }, [clearShareResetTimer, memo.id]);

  const togglePlay = useCallback(async () => {
    if (!audioRef.current) return;

    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
      return;
    }

    await audioRef.current.play();
    setIsPlaying(true);
  }, [isPlaying]);

  const handleSeek = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (!audioRef.current || !audioDuration) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      audioRef.current.currentTime = ratio * audioDuration;
      setCurrentTime(ratio * audioDuration);
    },
    [audioDuration]
  );

  const handleLoadedMetadata = useCallback(
    (e: SyntheticEvent<HTMLAudioElement>) => {
      setAudioDuration((e.target as HTMLAudioElement).duration);
    },
    []
  );

  const handleTimeUpdate = useCallback((e: SyntheticEvent<HTMLAudioElement>) => {
    setCurrentTime((e.target as HTMLAudioElement).currentTime);
  }, []);

  const handleEnded = useCallback(() => {
    setIsPlaying(false);
    setCurrentTime(0);
  }, []);

  const handleShare = useCallback(async () => {
    setShareState("loading");
    setLastShareUrl(null);

    try {
      const res = await fetch(`/api/memos/${memo.id}/share`, { method: "POST" });
      const json = await res.json();

      if (!res.ok || !json?.shareUrl) {
        throw new Error(json?.error || "Unable to generate share link.");
      }

      const copied = await copyToClipboard(json.shareUrl);
      if (!copied) {
        throw new Error("Clipboard unavailable.");
      }

      setLastShareUrl(json.shareUrl);
      setShareState("copied");
      clearShareResetTimer();
      shareResetTimerRef.current = setTimeout(() => {
        setShareState("idle");
        shareResetTimerRef.current = null;
      }, SHARE_STATE_RESET_MS);
    } catch (error) {
      console.error("Failed to copy share link:", error);
      setShareState("error");
    }
  }, [clearShareResetTimer, memo.id]);

  const progress = audioDuration ? (currentTime / audioDuration) * 100 : 0;
  const displayDuration = audioDuration ?? memo.durationSeconds ?? null;
  const shareLabel = getShareLabel(shareState);

  return {
    audioRef,
    currentTime,
    displayDuration,
    handleEnded,
    handleLoadedMetadata,
    handleSeek,
    handleShare,
    handleTimeUpdate,
    isPlaying,
    lastShareUrl,
    progress,
    shareLabel,
    shareState,
    togglePlay,
  };
}
