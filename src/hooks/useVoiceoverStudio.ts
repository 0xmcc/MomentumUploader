import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type RefObject,
} from "react";
import { CURATED_VOICES, type CuratedVoice } from "@/lib/elevenlabs-voices";

export type VoiceoverState = "idle" | "loading" | "ready" | "error";

type UseVoiceoverStudioArgs = {
  memoId: string;
  memoUrl: string | null;
};

type UseVoiceoverStudioResult = {
  voices: CuratedVoice[];
  selectedVoiceId: string | null;
  voState: VoiceoverState;
  voError: string | null;
  voIsPlaying: boolean;
  voCurrentTime: number;
  voDuration: number | null;
  voObjectUrl: string | null;
  audioRef: RefObject<HTMLAudioElement | null>;
  handleVoiceSelect: (voiceId: string) => void;
  handlePlayPause: () => void;
  handleVoSeek: (e: MouseEvent<HTMLDivElement>) => void;
  handleDownload: () => void;
};

const MAX_CACHE_ENTRIES = 20;

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

function readErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const maybeError = (payload as { error?: unknown }).error;
  return typeof maybeError === "string" ? maybeError : null;
}

export function useVoiceoverStudio({
  memoId,
  memoUrl,
}: UseVoiceoverStudioArgs): UseVoiceoverStudioResult {
  const [selectedVoiceId, setSelectedVoiceId] = useState<string | null>(null);
  const [voState, setVoState] = useState<VoiceoverState>("idle");
  const [voError, setVoError] = useState<string | null>(null);
  const [voIsPlaying, setVoIsPlaying] = useState(false);
  const [voCurrentTime, setVoCurrentTime] = useState(0);
  const [voDuration, setVoDuration] = useState<number | null>(null);
  const [voObjectUrl, setVoObjectUrl] = useState<string | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCacheRef = useRef<Map<string, string>>(new Map());
  const cacheOrderRef = useRef<string[]>([]);
  const inflightAbortRef = useRef<AbortController | null>(null);
  const selectedVoiceIdRef = useRef<string | null>(null);
  const shouldAutoPlayRef = useRef(false);

  const clearCache = useCallback(() => {
    for (const cachedUrl of audioCacheRef.current.values()) {
      URL.revokeObjectURL(cachedUrl);
    }
    audioCacheRef.current.clear();
    cacheOrderRef.current = [];
  }, []);

  useEffect(() => {
    selectedVoiceIdRef.current = null;
    shouldAutoPlayRef.current = false;

    if (inflightAbortRef.current) {
      inflightAbortRef.current.abort();
      inflightAbortRef.current = null;
    }

    clearCache();
    setSelectedVoiceId(null);
    setVoState("idle");
    setVoError(null);
    setVoIsPlaying(false);
    setVoCurrentTime(0);
    setVoDuration(null);
    setVoObjectUrl(null);

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute("src");
      audioRef.current.load();
    }
  }, [clearCache, memoId]);

  useEffect(() => {
    return () => {
      if (inflightAbortRef.current) {
        inflightAbortRef.current.abort();
        inflightAbortRef.current = null;
      }
      clearCache();
    };
  }, [clearCache]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onLoadedMetadata = () => {
      const duration = Number.isFinite(audio.duration) ? audio.duration : null;
      setVoDuration(duration);

      if (shouldAutoPlayRef.current) {
        shouldAutoPlayRef.current = false;
        void audio
          .play()
          .then(() => {
            setVoIsPlaying(true);
          })
          .catch(() => {
            setVoIsPlaying(false);
          });
      }
    };

    const onTimeUpdate = () => {
      setVoCurrentTime(audio.currentTime);
    };

    const onEnded = () => {
      setVoIsPlaying(false);
      setVoCurrentTime(0);
    };

    const onPause = () => {
      setVoIsPlaying(false);
    };

    const onPlay = () => {
      setVoIsPlaying(true);
    };

    audio.addEventListener("loadedmetadata", onLoadedMetadata);
    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("play", onPlay);

    return () => {
      audio.removeEventListener("loadedmetadata", onLoadedMetadata);
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("play", onPlay);
    };
  }, [voObjectUrl]);

  const handlePlayPause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !voObjectUrl) return;

    if (voIsPlaying) {
      audio.pause();
      setVoIsPlaying(false);
      return;
    }

    void audio
      .play()
      .then(() => {
        setVoIsPlaying(true);
      })
      .catch(() => {
        setVoIsPlaying(false);
      });
  }, [voIsPlaying, voObjectUrl]);

  const addToCache = useCallback((voiceId: string, objectUrl: string) => {
    const existing = audioCacheRef.current.get(voiceId);
    if (existing && existing !== objectUrl) {
      URL.revokeObjectURL(existing);
    }

    audioCacheRef.current.set(voiceId, objectUrl);
    cacheOrderRef.current = cacheOrderRef.current.filter((cachedId) => cachedId !== voiceId);
    cacheOrderRef.current.push(voiceId);

    if (cacheOrderRef.current.length > MAX_CACHE_ENTRIES) {
      const evictedVoiceId = cacheOrderRef.current.shift();
      if (evictedVoiceId) {
        const evictedUrl = audioCacheRef.current.get(evictedVoiceId);
        if (evictedUrl) {
          audioCacheRef.current.delete(evictedVoiceId);
          URL.revokeObjectURL(evictedUrl);
        }
      }
    }
  }, []);

  const handleVoiceSelect = useCallback(
    (voiceId: string) => {
      if (!memoUrl) {
        setVoState("error");
        setVoError("Memo has no audio");
        return;
      }

      if (voiceId === selectedVoiceId && voState === "ready") {
        handlePlayPause();
        return;
      }

      if (inflightAbortRef.current) {
        inflightAbortRef.current.abort();
      }

      const controller = new AbortController();
      inflightAbortRef.current = controller;

      selectedVoiceIdRef.current = voiceId;
      setSelectedVoiceId(voiceId);
      setVoError(null);
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      }

      const cachedUrl = audioCacheRef.current.get(voiceId);
      if (cachedUrl) {
        inflightAbortRef.current = null;
        setVoObjectUrl(cachedUrl);
        setVoState("ready");
        shouldAutoPlayRef.current = true;
        return;
      }

      setVoState("loading");
      setVoIsPlaying(false);
      setVoCurrentTime(0);
      setVoDuration(null);

      void (async () => {
        try {
          const res = await fetch(`/api/memos/${memoId}/voiceover`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ voiceId }),
            signal: controller.signal,
          });

          if (voiceId !== selectedVoiceIdRef.current) {
            return;
          }

          if (!res.ok) {
            let message = "Failed to generate voiceover";

            try {
              const errorJson = (await res.json()) as unknown;
              message = readErrorMessage(errorJson) ?? message;
            } catch {
              // Ignore malformed error bodies from server and keep fallback message.
            }

            if (voiceId !== selectedVoiceIdRef.current) {
              return;
            }

            setVoState("error");
            setVoError(message);
            setVoObjectUrl(null);
            return;
          }

          const blob = await res.blob();
          if (voiceId !== selectedVoiceIdRef.current) {
            return;
          }

          const objectUrl = URL.createObjectURL(blob);
          if (voiceId !== selectedVoiceIdRef.current) {
            URL.revokeObjectURL(objectUrl);
            return;
          }

          addToCache(voiceId, objectUrl);
          setVoObjectUrl(objectUrl);
          setVoState("ready");
          setVoError(null);
          shouldAutoPlayRef.current = true;
        } catch (error) {
          if (isAbortError(error)) {
            return;
          }

          if (voiceId !== selectedVoiceIdRef.current) {
            return;
          }

          setVoState("error");
          setVoError("Failed to generate voiceover");
          setVoObjectUrl(null);
        } finally {
          if (inflightAbortRef.current === controller) {
            inflightAbortRef.current = null;
          }
        }
      })();
    },
    [addToCache, handlePlayPause, memoId, memoUrl, selectedVoiceId, voState]
  );

  const handleVoSeek = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      const audio = audioRef.current;
      if (!audio || !voDuration) return;

      const rect = e.currentTarget.getBoundingClientRect();
      const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      const nextTime = ratio * voDuration;
      audio.currentTime = nextTime;
      setVoCurrentTime(nextTime);
    },
    [voDuration]
  );

  const handleDownload = useCallback(() => {
    if (!voObjectUrl || !selectedVoiceId) return;

    const selectedVoice = CURATED_VOICES.find((voice) => voice.id === selectedVoiceId);
    const voiceName = (selectedVoice?.name ?? "voice").toLowerCase();

    const link = document.createElement("a");
    link.href = voObjectUrl;
    link.download = `voiceover-${memoId.slice(0, 8)}-${voiceName}.mp3`;
    link.click();
  }, [memoId, selectedVoiceId, voObjectUrl]);

  return {
    voices: CURATED_VOICES,
    selectedVoiceId,
    voState,
    voError,
    voIsPlaying,
    voCurrentTime,
    voDuration,
    voObjectUrl,
    audioRef,
    handleVoiceSelect,
    handlePlayPause,
    handleVoSeek,
    handleDownload,
  };
}
