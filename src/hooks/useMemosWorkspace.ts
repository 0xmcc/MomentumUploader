import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AudioInputPayload,
  UploadCompletePayload,
} from "@/components/AudioRecorder";
import {
  MEMO_RECONCILE_DELAY_MS,
  type Memo,
  type SharedMemoBookmark,
  type TranscriptStatus,
} from "@/lib/memo-ui";
import {
  DEFAULT_PENDING_MIME_TYPE,
  getFileExtensionFromMime,
  uploadAudioForTranscription,
} from "@/lib/audio-upload";

type UseMemosWorkspaceArgs = {
  isLoaded: boolean;
  isSignedIn: boolean | undefined;
  openSignIn: () => void | Promise<void>;
};

type MemoDetailResponse = {
  memo?: Partial<Memo> & {
    duration?: number | null;
    durationSeconds?: number | null;
  };
};

export function useMemosWorkspace({
  isLoaded,
  isSignedIn,
  openSignIn,
}: UseMemosWorkspaceArgs) {
  const [memos, setMemos] = useState<Memo[]>([]);
  const [bookmarkedMemos, setBookmarkedMemos] = useState<SharedMemoBookmark[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMemoId, setSelectedMemoId] = useState<string | null>(null);

  const [pendingBlob, setPendingBlob] = useState<Blob | null>(null);
  const [pendingDuration, setPendingDuration] = useState(0);
  const [pendingMimeType, setPendingMimeType] = useState(DEFAULT_PENDING_MIME_TYPE);
  const [pendingMemoId, setPendingMemoId] = useState<string | null>(null);
  const [pendingProvisionalTranscript, setPendingProvisionalTranscript] = useState<string | null>(null);
  const [activeUploadCount, setActiveUploadCount] = useState(0);
  const [uploadProgressPercent, setUploadProgressPercent] = useState(0);
  const [uploadError, setUploadError] = useState(false);
  const [selectedMemoDetailRefreshToken, setSelectedMemoDetailRefreshToken] =
    useState(0);

  const reconcilingMemoIdsRef = useRef<Set<string>>(new Set());
  const reconcileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedMemoRequestIdRef = useRef(0);
  const selectedMemoIdRef = useRef<string | null>(null);

  const fetchMemos = useCallback(async () => {
    try {
      const [memosRes, bookmarksRes] = await Promise.allSettled([
        fetch("/api/memos"),
        isSignedIn ? fetch("/api/shared-memo-bookmarks") : Promise.resolve(null),
      ]);

      if (bookmarksRes.status === "fulfilled" && bookmarksRes.value) {
        try {
          const bookmarksJson = await bookmarksRes.value.json();
          if (Array.isArray(bookmarksJson.bookmarks)) {
            setBookmarkedMemos(bookmarksJson.bookmarks as SharedMemoBookmark[]);
          } else {
            setBookmarkedMemos([]);
          }
        } catch (_error) {
          setBookmarkedMemos([]);
        }
      } else {
        setBookmarkedMemos([]);
      }

      if (memosRes.status !== "fulfilled") {
        throw memosRes.reason;
      }

      const json = await memosRes.value.json();
      if (Array.isArray(json.memos)) {
        const fetchedMemos = json.memos as Memo[];
        const fetchedIds = new Set(fetchedMemos.map((memo) => memo.id));

        for (const memoId of Array.from(reconcilingMemoIdsRef.current)) {
          if (fetchedIds.has(memoId)) {
            reconcilingMemoIdsRef.current.delete(memoId);
          }
        }

        setMemos((prev) => {
          const stillReconciling = prev.filter(
            (memo) =>
              reconcilingMemoIdsRef.current.has(memo.id) && !fetchedIds.has(memo.id)
          );
          return [...stillReconciling, ...fetchedMemos];
        });
      }
    } catch (err) {
      console.error("Failed to fetch memos:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!isLoaded) return;
    setLoading(true);
    void fetchMemos();
  }, [fetchMemos, isLoaded, isSignedIn]);

  const handleUploadComplete = useCallback(
    (data: UploadCompletePayload) => {
      const newMemoId = data.id ?? `optimistic-${Date.now()}`;
      reconcilingMemoIdsRef.current.add(newMemoId);
      const newMemo: Memo = {
        id: newMemoId,
        transcript: data?.text ?? "",
        transcriptStatus: data?.transcriptStatus ?? "complete",
        createdAt: new Date().toISOString(),
        url: data?.url,
        modelUsed: data?.modelUsed,
        wordCount: data?.text
          ? data.text.split(/\s+/).filter(Boolean).length
          : 0,
        durationSeconds: data?.durationSeconds,
        success: data?.success,
      };
      // Update in place if the memo already exists (e.g. was immediately surfaced on recording stop).
      // Otherwise prepend as a new entry.
      setMemos((prev) => {
        const idx = prev.findIndex((m) => m.id === newMemoId);
        if (idx >= 0) {
          const updated = [...prev];
          updated[idx] = newMemo;
          return updated;
        }
        return [newMemo, ...prev];
      });
      if (selectedMemoIdRef.current === newMemoId) {
        setSelectedMemoDetailRefreshToken((current) => current + 1);
      }
      setSelectedMemoId(newMemoId);

      if (reconcileTimerRef.current) {
        clearTimeout(reconcileTimerRef.current);
      }
      reconcileTimerRef.current = setTimeout(() => {
        fetchMemos().then(() => {
          // Refresh list quietly after optimistic row creation.
        });
        reconcileTimerRef.current = null;
      }, MEMO_RECONCILE_DELAY_MS);
    },
    [fetchMemos]
  );

  useEffect(() => {
    return () => {
      if (reconcileTimerRef.current) {
        clearTimeout(reconcileTimerRef.current);
        reconcileTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    selectedMemoIdRef.current = selectedMemoId;
  }, [selectedMemoId]);

  const clearPendingUpload = useCallback(() => {
    setPendingBlob(null);
    setPendingDuration(0);
    setPendingMimeType(DEFAULT_PENDING_MIME_TYPE);
    setPendingMemoId(null);
    setPendingProvisionalTranscript(null);
  }, []);

  const uploadBlob = useCallback(
    async (
      blob: Blob,
      durationSeconds: number,
      mimeType: string,
      memoId?: string | null
    ) => {
      setUploadError(false);
      setUploadProgressPercent(0);
      setActiveUploadCount((count) => count + 1);
      try {
        const fd = new FormData();
        const ext = getFileExtensionFromMime(mimeType);
        fd.append("file", blob, `memo_${Date.now()}.${ext}`);
        if (memoId) {
          fd.append("memoId", memoId);
        }
        const data = (await uploadAudioForTranscription(fd, (percent) => {
          setUploadProgressPercent((current) => Math.max(current, percent));
        })) as UploadCompletePayload;
        setUploadProgressPercent(100);
        handleUploadComplete({ ...data, durationSeconds });
        clearPendingUpload();
      } catch (err) {
        console.error("Upload error:", err);
        setUploadError(true);
      } finally {
        setActiveUploadCount((count) => Math.max(0, count - 1));
      }
    },
    [clearPendingUpload, handleUploadComplete]
  );

  const handleAudioInput = useCallback(
    (payload: AudioInputPayload) => {
      setUploadError(false);
      setPendingBlob(payload.blob);
      setPendingDuration(payload.durationSeconds);
      setPendingMimeType(payload.mimeType);
      setPendingMemoId(payload.memoId ?? null);
      setPendingProvisionalTranscript(payload.provisionalTranscript ?? null);

      // If a live memo already exists, surface it immediately so the user sees
      // their recording before transcription completes.
      if (payload.memoId) {
        handleUploadComplete({
          id: payload.memoId,
          text: payload.provisionalTranscript ?? "",
          transcriptStatus: "processing",
        });
      }

      if (!isSignedIn) {
        void openSignIn();
      }
    },
    [handleUploadComplete, isSignedIn, openSignIn]
  );

  useEffect(() => {
    if (isSignedIn && isLoaded && pendingBlob) {
      void uploadBlob(pendingBlob, pendingDuration, pendingMimeType, pendingMemoId);
    }
  }, [
    isSignedIn,
    isLoaded,
    pendingBlob,
    pendingDuration,
    pendingMimeType,
    pendingMemoId,
    uploadBlob,
  ]);

  useEffect(() => {
    if (!selectedMemoId) return;
    if (!memos.some((memo) => memo.id === selectedMemoId)) {
      if (reconcilingMemoIdsRef.current.has(selectedMemoId)) return;
      setSelectedMemoId(null);
    }
  }, [memos, selectedMemoId]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn || !selectedMemoId) return;

    const requestId = selectedMemoRequestIdRef.current + 1;
    selectedMemoRequestIdRef.current = requestId;

    void (async () => {
      try {
        const res = await fetch(`/api/memos/${selectedMemoId}`);
        if (!res.ok) return;

        const json = (await res.json()) as MemoDetailResponse;
        const detailMemo = json.memo;
        if (!detailMemo?.id) return;
        if (selectedMemoRequestIdRef.current !== requestId) return;

        setMemos((prev) =>
          prev.map((memo) =>
            memo.id !== selectedMemoId
              ? memo
              : {
                  ...memo,
                  ...detailMemo,
                  transcript: detailMemo.transcript ?? memo.transcript,
                  transcriptSegments:
                    detailMemo.transcriptSegments ?? memo.transcriptSegments ?? null,
                  createdAt: detailMemo.createdAt ?? memo.createdAt,
                  durationSeconds:
                    detailMemo.durationSeconds ??
                    detailMemo.duration ??
                    memo.durationSeconds,
                  url: detailMemo.url ?? memo.url,
                  wordCount: detailMemo.wordCount ?? memo.wordCount,
                }
          )
        );
      } catch (err) {
        console.error("Failed to fetch memo detail:", err);
      }
    })();
  }, [isLoaded, isSignedIn, selectedMemoId, selectedMemoDetailRefreshToken]);

  const normalizedQuery = searchQuery.toLowerCase();
  const filteredMemos = memos.filter((memo) =>
    memo.transcript.toLowerCase().includes(normalizedQuery)
  );
  const filteredBookmarkedMemos = bookmarkedMemos.filter((memo) => {
    const haystack = `${memo.title} ${memo.authorName}`.toLowerCase();
    return haystack.includes(normalizedQuery);
  });
  const selectedMemo = selectedMemoId
    ? memos.find((memo) => memo.id === selectedMemoId) ?? null
    : null;
  const isUploading = activeUploadCount > 0;
  const showUploadError = uploadError && Boolean(pendingBlob);

  const retryUpload = useCallback(() => {
    if (!pendingBlob) return;
    void uploadBlob(pendingBlob, pendingDuration, pendingMimeType, pendingMemoId);
  }, [pendingBlob, pendingDuration, pendingMimeType, pendingMemoId, uploadBlob]);

  const updateMemoTitle = useCallback(
    async (memoId: string, newTitle: string) => {
      // Optimistic update
      setMemos((prev) =>
        prev.map((m) => (m.id === memoId ? { ...m, title: newTitle } : m))
      );
      try {
        const res = await fetch(`/api/memos/${memoId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: newTitle }),
        });
        if (!res.ok) throw new Error("PATCH failed");
      } catch {
        // Revert on failure
        await fetchMemos();
      }
    },
    [fetchMemos]
  );

  const regenerateMemoTitle = useCallback(
    async (memoId: string): Promise<string | null> => {
      try {
        const res = await fetch(`/api/memos/${memoId}/title`, { method: "POST" });
        if (!res.ok) return null;
        const json = (await res.json()) as { title: string };
        setMemos((prev) =>
          prev.map((m) => (m.id === memoId ? { ...m, title: json.title } : m))
        );
        return json.title;
      } catch {
        return null;
      }
    },
    []
  );

  return {
    filteredBookmarkedMemos,
    filteredMemos,
    handleAudioInput,
    handleUploadComplete,
    loading,
    searchQuery,
    selectedMemo,
    selectedMemoId,
    setSearchQuery,
    setSelectedMemoId,
    isUploading,
    showUploadError,
    retryUpload,
    updateMemoTitle,
    regenerateMemoTitle,
    uploadProgressPercent,
  };
}
