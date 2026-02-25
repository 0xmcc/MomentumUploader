import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AudioInputPayload,
  UploadCompletePayload,
} from "@/components/AudioRecorder";
import {
  MEMO_RECONCILE_DELAY_MS,
  type Memo,
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

export function useMemosWorkspace({
  isLoaded,
  isSignedIn,
  openSignIn,
}: UseMemosWorkspaceArgs) {
  const [memos, setMemos] = useState<Memo[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMemoId, setSelectedMemoId] = useState<string | null>(null);

  const [pendingBlob, setPendingBlob] = useState<Blob | null>(null);
  const [pendingDuration, setPendingDuration] = useState(0);
  const [pendingMimeType, setPendingMimeType] = useState(DEFAULT_PENDING_MIME_TYPE);
  const [pendingMemoId, setPendingMemoId] = useState<string | null>(null);
  const [activeUploadCount, setActiveUploadCount] = useState(0);
  const [uploadProgressPercent, setUploadProgressPercent] = useState(0);
  const [uploadError, setUploadError] = useState(false);

  const reconcilingMemoIdsRef = useRef<Set<string>>(new Set());
  const reconcileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchMemos = useCallback(async () => {
    try {
      const res = await fetch("/api/memos");
      const json = await res.json();
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
        createdAt: new Date().toISOString(),
        url: data?.url,
        modelUsed: data?.modelUsed,
        wordCount: data?.text
          ? data.text.split(/\s+/).filter(Boolean).length
          : 0,
        durationSeconds: data?.durationSeconds,
        success: data?.success,
      };
      setMemos((prev) => [newMemo, ...prev]);
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

  const clearPendingUpload = useCallback(() => {
    setPendingBlob(null);
    setPendingDuration(0);
    setPendingMimeType(DEFAULT_PENDING_MIME_TYPE);
    setPendingMemoId(null);
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
      if (!isSignedIn) {
        void openSignIn();
      }
    },
    [isSignedIn, openSignIn]
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

  const normalizedQuery = searchQuery.toLowerCase();
  const filteredMemos = memos.filter((memo) =>
    memo.transcript.toLowerCase().includes(normalizedQuery)
  );
  const selectedMemo = selectedMemoId
    ? memos.find((memo) => memo.id === selectedMemoId) ?? null
    : null;
  const isUploading = activeUploadCount > 0;
  const showUploadError = uploadError && Boolean(pendingBlob);

  const retryUpload = useCallback(() => {
    if (!pendingBlob) return;
    void uploadBlob(pendingBlob, pendingDuration, pendingMimeType, pendingMemoId);
  }, [pendingBlob, pendingDuration, pendingMimeType, pendingMemoId, uploadBlob]);

  return {
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
    uploadProgressPercent,
  };
}
