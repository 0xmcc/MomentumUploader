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

type MemoListResponse = {
  memos?: Memo[];
  total?: number;
};

const MEMOS_PAGE_SIZE = 20;
export const FATHOM_IMPORT_CLIENT_TIMEOUT_MS = 45_000;
export const FATHOM_IMPORT_POLL_INTERVAL_MS = 1_500;
const FATHOM_IMPORT_PROGRESS_MESSAGE =
  "Importing Fathom meetings. This can take up to 45 seconds.";
const FATHOM_IMPORT_TIMEOUT_MESSAGE =
  "Fathom import timed out. Try again in a minute.";

export type FathomImportRunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed";

export type FathomImportRunSummary = {
  jobId: string;
  status: FathomImportRunStatus;
  imported: number;
  meetings: number;
  processedPages: number;
  startedAt: string | null;
  completedAt: string | null;
  error: string | null;
};

export type FathomImportSettings = {
  configured: boolean;
  connectionStatus: "connected" | "not_configured";
  lastImport: FathomImportRunSummary | null;
};

function getMemosPageUrl(offset: number) {
  const params = new URLSearchParams({
    limit: String(MEMOS_PAGE_SIZE),
    offset: String(offset),
  });
  return `/api/memos?${params.toString()}`;
}

function mergeMemoPages(current: Memo[], incoming: Memo[]) {
  const seenIds = new Set<string>();
  const merged: Memo[] = [];

  for (const memo of [...current, ...incoming]) {
    if (seenIds.has(memo.id)) continue;
    seenIds.add(memo.id);
    merged.push(memo);
  }

  return merged;
}

async function postFathomImport() {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, FATHOM_IMPORT_CLIENT_TIMEOUT_MS);

  try {
    return await fetch("/api/fathom/import", {
      method: "POST",
      signal: controller.signal,
    });
  } catch (error) {
    if (
      controller.signal.aborted ||
      (error instanceof Error && error.name === "AbortError")
    ) {
      throw new Error(FATHOM_IMPORT_TIMEOUT_MESSAGE);
    }

    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatFathomProgress(status: FathomImportRunSummary) {
  if (status.meetings > 0) {
    return `Importing Fathom meetings: ${status.imported} imported from ${status.meetings} seen.`;
  }

  return FATHOM_IMPORT_PROGRESS_MESSAGE;
}

function settingsWithLastImport(
  current: FathomImportSettings | null,
  lastImport: FathomImportRunSummary
): FathomImportSettings {
  return {
    configured: current?.configured ?? true,
    connectionStatus: current?.connectionStatus ?? "connected",
    lastImport,
  };
}

async function getFathomImportStatus(
  jobId: string
): Promise<FathomImportRunSummary> {
  const res = await fetch(`/api/fathom/import/${jobId}`);
  const json = (await res.json().catch(() => ({}))) as
    | Partial<FathomImportRunSummary>
    | { error?: string; detail?: string };

  const status = "status" in json ? json.status : undefined;
  if (!res.ok && status !== "failed") {
    throw new Error(
      "detail" in json && json.detail
        ? json.detail
        : "error" in json && json.error
        ? json.error
        : "Fathom import failed"
    );
  }

  if (!("jobId" in json) || typeof json.jobId !== "string") {
    throw new Error("Fathom import status response was invalid.");
  }

  return json as FathomImportRunSummary;
}

async function getFathomSettings(): Promise<FathomImportSettings> {
  const res = await fetch("/api/fathom/import/settings");
  const json = (await res.json().catch(() => ({}))) as Partial<FathomImportSettings> & {
    error?: string;
    detail?: string;
  };

  if (!res.ok) {
    throw new Error(json.detail || json.error || "Fathom settings failed");
  }

  return {
    configured: Boolean(json.configured),
    connectionStatus:
      json.connectionStatus === "connected" ? "connected" : "not_configured",
    lastImport: json.lastImport ?? null,
  };
}

export function useMemosWorkspace({
  isLoaded,
  isSignedIn,
  openSignIn,
}: UseMemosWorkspaceArgs) {
  const [memos, setMemos] = useState<Memo[]>([]);
  const [bookmarkedMemos, setBookmarkedMemos] = useState<SharedMemoBookmark[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMoreMemos, setLoadingMoreMemos] = useState(false);
  const [totalMemoCount, setTotalMemoCount] = useState(0);
  const [nextMemosOffset, setNextMemosOffset] = useState(0);
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
  const [importingFathom, setImportingFathom] = useState(false);
  const [fathomImportMessage, setFathomImportMessage] = useState<string | null>(
    null
  );
  const [fathomSettings, setFathomSettings] =
    useState<FathomImportSettings | null>(null);
  const [selectedMemoDetailRefreshToken, setSelectedMemoDetailRefreshToken] =
    useState(0);

  const reconcilingMemoIdsRef = useRef<Set<string>>(new Set());
  const reconcileTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedMemoRequestIdRef = useRef(0);
  const selectedMemoIdRef = useRef<string | null>(null);
  const loadingMoreMemosRef = useRef(false);

  const fetchMemos = useCallback(async () => {
    try {
      const [memosRes, bookmarksRes] = await Promise.allSettled([
        fetch(getMemosPageUrl(0)),
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

      const json = (await memosRes.value.json()) as MemoListResponse;
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
        setTotalMemoCount(
          typeof json.total === "number" ? json.total : fetchedMemos.length
        );
        setNextMemosOffset(fetchedMemos.length);
      }
    } catch (err) {
      console.error("Failed to fetch memos:", err);
    } finally {
      setLoading(false);
    }
  }, [isSignedIn]);

  const loadMoreMemos = useCallback(async () => {
    if (loading || loadingMoreMemosRef.current) return;
    if (nextMemosOffset >= totalMemoCount) return;

    loadingMoreMemosRef.current = true;
    setLoadingMoreMemos(true);

    try {
      const res = await fetch(getMemosPageUrl(nextMemosOffset));
      const json = (await res.json()) as MemoListResponse;

      if (Array.isArray(json.memos)) {
        const fetchedMemos = json.memos as Memo[];
        setMemos((prev) => mergeMemoPages(prev, fetchedMemos));
        setTotalMemoCount(
          typeof json.total === "number" ? json.total : totalMemoCount
        );
        setNextMemosOffset(nextMemosOffset + fetchedMemos.length);
      }
    } catch (err) {
      console.error("Failed to load more memos:", err);
    } finally {
      loadingMoreMemosRef.current = false;
      setLoadingMoreMemos(false);
    }
  }, [loading, nextMemosOffset, totalMemoCount]);

  useEffect(() => {
    if (!isLoaded) return;
    setLoading(true);
    void fetchMemos();
  }, [fetchMemos, isLoaded, isSignedIn]);

  const refreshFathomSettings = useCallback(async () => {
    if (!isSignedIn) {
      setFathomSettings(null);
      return;
    }

    try {
      setFathomSettings(await getFathomSettings());
    } catch {
      setFathomSettings(null);
    }
  }, [isSignedIn]);

  useEffect(() => {
    if (!isLoaded) return;
    void refreshFathomSettings();
  }, [isLoaded, refreshFathomSettings]);

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
  const hasMoreMemos = nextMemosOffset < totalMemoCount;

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

  const importFathomMemos = useCallback(async () => {
    if (importingFathom) return;

    if (!isSignedIn) {
      setFathomImportMessage(null);
      void openSignIn();
      return;
    }

    setImportingFathom(true);
    setFathomImportMessage(FATHOM_IMPORT_PROGRESS_MESSAGE);

    try {
      const res = await postFathomImport();
      const json = (await res.json().catch(() => ({}))) as {
        jobId?: string;
        status?: FathomImportRunStatus;
        imported?: number;
        meetings?: number;
        processedPages?: number;
        startedAt?: string | null;
        completedAt?: string | null;
        error?: string;
        detail?: string;
      };

      if (!res.ok) {
        throw new Error(json.detail || json.error || "Fathom import failed");
      }

      if (!json.jobId) {
        throw new Error("Fathom import did not return a job id.");
      }

      let status: FathomImportRunSummary = {
        jobId: json.jobId,
        status: json.status ?? "queued",
        imported: typeof json.imported === "number" ? json.imported : 0,
        meetings: typeof json.meetings === "number" ? json.meetings : 0,
        processedPages:
          typeof json.processedPages === "number" ? json.processedPages : 0,
        startedAt: json.startedAt ?? null,
        completedAt: json.completedAt ?? null,
        error: json.error ?? null,
      };

      while (status.status === "queued" || status.status === "running") {
        status = await getFathomImportStatus(status.jobId);
        setFathomSettings((current) => settingsWithLastImport(current, status));

        if (status.status === "succeeded") {
          break;
        }
        if (status.status === "failed") {
          throw new Error(status.error || "Fathom import failed");
        }

        setFathomImportMessage(formatFathomProgress(status));
        await sleep(FATHOM_IMPORT_POLL_INTERVAL_MS);
      }

      const imported = status.imported;
      setFathomImportMessage(
        `Imported ${imported} Fathom ${imported === 1 ? "meeting" : "meetings"}.`
      );
      setFathomSettings((current) => settingsWithLastImport(current, status));
      await fetchMemos();
    } catch (err) {
      console.error("Failed to import Fathom meetings:", err);
      setFathomImportMessage(
        err instanceof Error
          ? err.message
          : "Couldn't import Fathom meetings."
      );
    } finally {
      setImportingFathom(false);
    }
  }, [fetchMemos, importingFathom, isSignedIn, openSignIn]);

  return {
    filteredBookmarkedMemos,
    filteredMemos,
    fathomImportMessage,
    fathomSettings,
    hasMoreMemos,
    handleAudioInput,
    handleUploadComplete,
    importFathomMemos,
    importingFathom,
    loadMoreMemos,
    loading,
    loadingMoreMemos,
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
