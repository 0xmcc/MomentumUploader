"use client";

import React, {
  Profiler,
  useCallback,
  useRef,
  useState,
  type ProfilerOnRenderCallback,
} from "react";
import Link from "next/link";
import {
  Check,
  ChevronDown,
  ChevronUp,
  Clock3,
  Copy,
  Cpu,
  Download,
  ExternalLink,
  FileDown,
  Loader2,
  Mic2,
  PanelLeftClose,
  PanelLeftOpen,
  Pencil,
  Plus,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { motion } from "framer-motion";
import {
  SignedIn,
  SignedOut,
  SignInButton,
  UserButton,
} from "@clerk/nextjs";
import AudioRecorder from "@/components/AudioRecorder";
import StatusDot from "@/components/StatusDot";
import VoiceoverStudio from "@/components/VoiceoverStudio";
import { MemoPlaybackFooter } from "@/components/memos/MemoPlaybackFooter";
import type {
  AudioInputPayload,
  UploadCompletePayload,
} from "@/components/AudioRecorder";
import ThemeToggle from "@/components/ThemeToggle";
import { useTheme } from "@/components/ThemeProvider";
import { useMemoShare } from "@/hooks/useMemoPlayback";
import {
  MEMO_ESTIMATED_COST_PER_MINUTE_USD,
  exportMarkdown,
  formatDate,
  formatMemoEstimatedCost,
  formatSecs,
  getMemoAudioDownloadName,
  getMemoTitle,
  isMemoFailed,
  isMemoProcessing,
  type Memo,
  type SharedMemoBookmark,
} from "@/lib/memo-ui";

const TRANSCRIPT_TIMESTAMPS_STORAGE_KEY = "memo-transcript-show-timestamps";

function MemoListItem({
  memo,
  isActive,
  onClick,
}: {
  memo: Memo;
  isActive: boolean;
  onClick: () => void;
}) {
  const isFailed = isMemoFailed(memo);
  const title = getMemoTitle(memo);
  const durationLabel =
    memo.durationSeconds != null ? formatSecs(memo.durationSeconds) : "--:--";
  const costLabel = formatMemoEstimatedCost(memo.durationSeconds);

  return (
    <div
      onClick={onClick}
      className={`px-5 py-4 border-b border-white/5 cursor-pointer flex flex-col gap-1.5 transition-colors ${
        isActive ? "bg-blue-600/90 text-white" : "hover:bg-white/5 text-white/80"
      }`}
    >
      <div
        className={`font-medium text-sm truncate ${
          isActive ? "text-white font-semibold" : "text-white/90"
        }`}
      >
        {title}
      </div>
      <div
        className={`flex justify-between text-xs font-mono tabular-nums ${
          isActive ? "text-white/90" : "text-white/40"
        }`}
      >
        <span>{formatDate(memo.createdAt)}</span>
        <span>{`${durationLabel} · ${costLabel}`}</span>
      </div>
    </div>
  );
}

function SharedMemoBookmarkListItem({
  bookmark,
}: {
  bookmark: SharedMemoBookmark;
}) {
  const fallbackInitial = bookmark.authorName.trim().charAt(0).toUpperCase() || "?";

  return (
    <a
      href={`/s/${bookmark.shareToken}`}
      className="px-5 py-4 border-b border-white/5 flex flex-col gap-2 transition-colors hover:bg-white/5 text-white/80"
    >
      <div className="font-medium text-sm truncate text-white/90">{bookmark.title}</div>
      <div className="flex items-center gap-2 text-xs text-white/45">
        {bookmark.authorAvatarUrl ? (
          <img
            src={bookmark.authorAvatarUrl}
            alt={bookmark.authorName}
            className="h-5 w-5 rounded-full object-cover"
          />
        ) : (
          <span className="h-5 w-5 rounded-full bg-white/10 text-[10px] font-semibold text-white/70 flex items-center justify-center">
            {fallbackInitial}
          </span>
        )}
        <span className="truncate">{bookmark.authorName}</span>
      </div>
    </a>
  );
}

function AuthControls() {
  return (
    <>
      <SignedOut>
        <SignInButton mode="modal">
          <button className="text-xs text-white/50 hover:text-accent border border-white/10 hover:border-accent/30 px-3 py-1.5 rounded-full font-mono transition-all">
            Sign In
          </button>
        </SignInButton>
      </SignedOut>
      <SignedIn>
        <UserButton appearance={{ elements: { avatarBox: "w-8 h-8" } }} />
      </SignedIn>
    </>
  );
}

export const MemoTranscript = React.memo(function MemoTranscript({
  transcript,
  transcriptSegments,
  isFailed,
  showTimestamps,
}: Pick<Memo, "transcript" | "transcriptSegments"> & {
  isFailed: boolean;
  showTimestamps: boolean;
}) {
  const textClassName = isFailed ? "text-red-300/40 italic" : "text-white/80";

  if (transcriptSegments && transcriptSegments.length > 0) {
    return (
      <div className={`flex flex-col gap-5 text-lg leading-relaxed ${textClassName}`}>
        {transcriptSegments.map((segment) => (
          <div
            key={segment.id}
            className={`transcript-segment items-start ${
              showTimestamps
                ? "grid grid-cols-[auto_minmax(0,1fr)] gap-x-4"
                : "block"
            } rounded-2xl px-3 py-2`}
          >
            {showTimestamps ? (
              <div className="pt-1 text-xs font-mono uppercase tracking-wide text-white/35">
                {formatSecs(segment.startMs / 1000)}
              </div>
            ) : null}
            <div>{segment.text}</div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className={`text-lg leading-relaxed whitespace-pre-wrap ${textClassName}`}>
      {transcript || "No transcript available."}
    </div>
  );
});

export function MemoTranscriptPanelInner({
  memo,
  showTimestamps,
  onToggleTimestamps,
  transcriptProfilerOnRender,
}: {
  memo: Memo;
  showTimestamps: boolean;
  onToggleTimestamps: () => void;
  transcriptProfilerOnRender?: ProfilerOnRenderCallback;
}) {
  const isFailed = isMemoFailed(memo);
  const hasTranscriptSegments = Boolean(memo.transcriptSegments?.length);
  const transcript = (
    <MemoTranscript
      transcript={memo.transcript}
      transcriptSegments={memo.transcriptSegments}
      isFailed={isFailed}
      showTimestamps={showTimestamps}
    />
  );

  return (
    <div className="rounded-2xl border border-white/5 bg-white/[0.02] overflow-hidden flex flex-col min-h-0">
      {hasTranscriptSegments && (
        <div className="px-5 pt-4 pb-2 flex justify-end flex-shrink-0">
          <button
            type="button"
            onClick={onToggleTimestamps}
            aria-pressed={showTimestamps}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-mono uppercase tracking-wide transition-all ${
              showTimestamps
                ? "border-accent/40 bg-accent/10 text-accent"
                : "border-white/10 bg-white/5 text-white/50 hover:border-white/20 hover:text-white/75"
            }`}
          >
            <Clock3 size={13} />
            {showTimestamps ? "Hide timestamps" : "Show timestamps"}
          </button>
        </div>
      )}

      <div
        className="overflow-y-auto px-5 pb-6 md:h-[min(60vh,720px)]"
        style={{
          scrollbarWidth: "thin",
          scrollbarColor: "rgba(255,255,255,0.1) transparent",
        }}
      >
        {transcriptProfilerOnRender ? (
          <Profiler id="MemoTranscriptPanel" onRender={transcriptProfilerOnRender}>
            {transcript}
          </Profiler>
        ) : (
          transcript
        )}
      </div>
    </div>
  );
}

export const MemoTranscriptPanel = React.memo(MemoTranscriptPanelInner);

export function MemoDetailView({
  memo,
  onTitleSave,
  onTitleRegenerate,
  transcriptPanelProfilerOnRender,
}: {
  memo: Memo;
  onTitleSave?: (memoId: string, title: string) => void;
  onTitleRegenerate?: (memoId: string) => Promise<string | null>;
  transcriptPanelProfilerOnRender?: ProfilerOnRenderCallback;
}) {
  const { playbackTheme } = useTheme();
  const {
    handleShare,
    handleShareLink,
    lastShareUrl,
    shareLabel,
    shareLinkLabel,
    shareLinkState,
    shareState,
  } = useMemoShare(memo);
  const isFailed = isMemoFailed(memo);
  const isProcessing = isMemoProcessing(memo);
  const statusLabel = isFailed ? "Failed" : isProcessing ? "Processing" : "Ready";
  const canDownloadFailedRecording = isFailed && !memo.url;

  const displayTitle = getMemoTitle(memo);
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [showVoiceoverStudio, setShowVoiceoverStudio] = useState(false);
  const [showTranscriptTimestamps, setShowTranscriptTimestamps] = useState(() => {
    if (typeof window === "undefined") {
      return false;
    }

    return window.localStorage.getItem(TRANSCRIPT_TIMESTAMPS_STORAGE_KEY) === "true";
  });
  const inputRef = useRef<HTMLInputElement>(null);

  function startEditing() {
    setTitleError(null);
    setEditValue(displayTitle);
    setIsEditingTitle(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }

  function cancelEditing() {
    setTitleError(null);
    setIsEditingTitle(false);
  }

  function commitEdit() {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== displayTitle) {
      onTitleSave?.(memo.id, trimmed);
    }
    setIsEditingTitle(false);
  }

  async function handleRegenerate() {
    if (!onTitleRegenerate || isRegenerating) return;
    setIsRegenerating(true);
    setTitleError(null);

    try {
      const nextTitle = await onTitleRegenerate(memo.id);
      if (!nextTitle) {
        setTitleError("Couldn't regenerate the title. Try again.");
        return;
      }

      setIsEditingTitle(false);
    } catch {
      setTitleError("Couldn't regenerate the title. Try again.");
    } finally {
      setIsRegenerating(false);
    }
  }

  const handleTranscriptTimestampToggle = useCallback(() => {
    setShowTranscriptTimestamps((current) => {
      const next = !current;
      window.localStorage.setItem(
        TRANSCRIPT_TIMESTAMPS_STORAGE_KEY,
        next ? "true" : "false"
      );
      return next;
    });
  }, []);

  const transcriptPanel = (
    <MemoTranscriptPanel
      memo={memo}
      showTimestamps={showTranscriptTimestamps}
      onToggleTimestamps={handleTranscriptTimestampToggle}
      transcriptProfilerOnRender={transcriptPanelProfilerOnRender}
    />
  );

  return (
    <motion.div
      key={memo.id}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col h-full w-full"
    >
      <div className="flex justify-between items-center pl-8 pr-8 py-6 border-b border-white/5 bg-[#121212]/50 backdrop-blur-md z-10">
        <div className="flex flex-col gap-1 min-w-0 flex-1 mr-4">
          {isEditingTitle ? (
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commitEdit();
                  if (e.key === "Escape") cancelEditing();
                }}
                onBlur={commitEdit}
                autoFocus
                className="text-xl font-semibold bg-white/5 border border-accent/40 rounded-lg px-3 py-1 text-white/90 focus:outline-none focus:ring-1 focus:ring-accent/60 min-w-0 flex-1"
              />
              <button
                onMouseDown={(e) => { e.preventDefault(); commitEdit(); }}
                title="Save title"
                className="text-white/40 hover:text-emerald-400 transition-colors flex-shrink-0"
              >
                <Check size={16} />
              </button>
              <button
                onMouseDown={(e) => { e.preventDefault(); cancelEditing(); }}
                title="Cancel"
                className="text-white/40 hover:text-red-400 transition-colors flex-shrink-0"
              >
                <X size={16} />
              </button>
              <button
                onMouseDown={(e) => { e.preventDefault(); void handleRegenerate(); }}
                title="Regenerate with AI"
                disabled={isRegenerating}
                className="text-white/40 hover:text-accent transition-colors flex-shrink-0 disabled:opacity-40"
              >
                {isRegenerating ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 group">
              <h2
                className="text-xl font-semibold text-white/90 truncate cursor-text"
                onClick={startEditing}
                title="Click to edit title"
              >
                {displayTitle}
              </h2>
              <button
                onClick={startEditing}
                title="Edit title"
                className="opacity-0 group-hover:opacity-100 text-white/30 hover:text-white/70 transition-all flex-shrink-0"
              >
                <Pencil size={13} />
              </button>
              <button
                onClick={() => void handleRegenerate()}
                title="Regenerate title with AI"
                disabled={isRegenerating}
                className="opacity-0 group-hover:opacity-100 text-white/30 hover:text-accent transition-all flex-shrink-0 disabled:opacity-40"
              >
                {isRegenerating ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
              </button>
            </div>
          )}
          <div className="flex items-center gap-2">
            <span className="text-xs text-white/35 font-mono">{formatDate(memo.createdAt)}</span>
            {(isFailed || isProcessing) && (
              <StatusDot tone={isFailed ? "failed" : "processing"} label={statusLabel} />
            )}
            {isFailed && (
              <span className="text-[10px] text-red-400 uppercase tracking-tight">Failed</span>
            )}
            {!isFailed && (
              <span className="text-[10px] text-white/30 font-mono uppercase tracking-tight">
                {memo.wordCount} words
              </span>
            )}
            {memo.durationSeconds != null && (
              <span className="text-[10px] text-white/35 font-mono tracking-tight">
                Est. {formatMemoEstimatedCost(memo.durationSeconds)} at $
                {MEMO_ESTIMATED_COST_PER_MINUTE_USD.toFixed(2)}/min
              </span>
            )}
          </div>
          {titleError ? (
            <p role="alert" className="text-xs text-red-400">
              {titleError}
            </p>
          ) : null}
        </div>

        <div className="flex items-center gap-3">
          {memo.modelUsed && (
            <span className="hidden sm:flex items-center gap-1.5 text-[10px] text-white/30 font-mono uppercase tracking-tight">
              <Cpu size={10} /> {memo.modelUsed}
            </span>
          )}
          <button
            onClick={handleShareLink}
            title="Share link"
            disabled={shareLinkState === "loading"}
            className={`flex items-center gap-1.5 text-xs bg-white/5 border px-3 py-1.5 rounded-full transition-all duration-200 group ${
              shareLinkState === "copied"
                ? "text-emerald-300 border-emerald-500/35"
                : "text-white/55 hover:text-accent border-white/10 hover:border-accent/30 hover:bg-accent/10"
            } ${shareLinkState === "loading" ? "opacity-80 cursor-wait" : ""}`}
          >
            {shareLinkState === "loading" ? (
              <Loader2 size={14} className="animate-spin" />
            ) : shareLinkState === "copied" ? (
              <Check size={14} />
            ) : (
              <ExternalLink size={14} />
            )}
            <span className="hidden sm:inline font-mono tracking-wide">
              {shareLinkLabel}
            </span>
          </button>
          {shareLinkState === "copied" && lastShareUrl && (
            <a
              href={lastShareUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] text-emerald-300/90 hover:text-emerald-200 font-mono uppercase tracking-wide transition-colors"
              title="Open share page in a new tab"
            >
              Open share page
            </a>
          )}
          <button
            onClick={handleShare}
            title="Copy transcript"
            disabled={shareState === "loading"}
            className={`flex items-center gap-1.5 text-xs bg-white/5 border px-3 py-1.5 rounded-full transition-all duration-200 group ${
              shareState === "copied"
                ? "text-emerald-300 border-emerald-500/35"
                : "text-white/55 hover:text-accent border-white/10 hover:border-accent/30 hover:bg-accent/10"
            } ${shareState === "loading" ? "opacity-80 cursor-wait" : ""}`}
          >
            {shareState === "loading" ? (
              <Loader2 size={14} className="animate-spin" />
            ) : shareState === "copied" ? (
              <Check size={14} />
            ) : (
              <Copy size={14} />
            )}
            <span className="hidden sm:inline font-mono tracking-wide">
              {shareLabel}
            </span>
          </button>
          {!isFailed && memo.transcript && (
            <button
              onClick={() => exportMarkdown(memo)}
              title="Export as Markdown"
              className="flex items-center gap-1.5 text-xs text-white/50 hover:text-accent bg-white/5 hover:bg-accent/10 border border-white/10 hover:border-accent/30 px-3 py-1.5 rounded-full transition-all duration-200 group"
            >
              <FileDown
                size={14}
                className="transition-transform duration-200 group-hover:-translate-y-0.5"
              />
              <span className="hidden sm:inline font-mono tracking-wide">
                Export .md
              </span>
            </button>
          )}
          {memo.url && (
            <a
              href={memo.url}
              download={getMemoAudioDownloadName(memo)}
              title="Download memo audio"
              className="flex items-center gap-1.5 text-xs text-white/50 hover:text-accent bg-white/5 hover:bg-accent/10 border border-white/10 hover:border-accent/30 px-3 py-1.5 rounded-full transition-all duration-200 group"
            >
              <Download
                size={14}
                className="transition-transform duration-200 group-hover:-translate-y-0.5"
              />
              <span className="hidden sm:inline font-mono tracking-wide">
                Download audio
              </span>
            </a>
          )}
          <Link
            href="/docs"
            className="inline-flex items-center h-9 text-xs text-white/40 hover:text-accent transition-colors font-mono"
          >
            API Docs ↗
          </Link>
          <ThemeToggle />
          <AuthControls />
        </div>
      </div>

      <div className="flex-1 flex flex-col min-h-0 px-8 py-10 overflow-y-auto md:overflow-visible">
        <div className="mx-auto w-full max-w-7xl flex flex-col min-h-0 gap-6">
          {canDownloadFailedRecording && (
            <div className="rounded-2xl border border-red-500/25 bg-red-500/10 px-5 py-4 text-sm text-red-100">
              <div className="font-medium text-red-50">Recording couldn't be saved.</div>
              <div className="mt-1 text-red-100/75">
                Finalization failed, but the uploaded chunks are still available.
              </div>
              <a
                href={`/api/memos/${memo.id}/download-chunks`}
                download={`recording-${memo.id}.webm`}
                className="mt-3 inline-flex items-center gap-2 rounded-full border border-red-200/25 bg-red-950/30 px-3 py-1.5 text-xs font-mono uppercase tracking-wide text-red-50 transition-colors hover:border-red-100/40 hover:bg-red-950/50"
              >
                <FileDown size={14} />
                Download recording
              </a>
            </div>
          )}

          {transcriptPanel}

          {!isFailed && memo.transcript && memo.url && (
            <div className="mt-2">
              <button
                type="button"
                onClick={() => setShowVoiceoverStudio((v) => !v)}
                className="voiceover-studio-toggle flex items-center gap-2 text-white/70 hover:text-white/90 font-semibold text-base transition-colors"
                aria-expanded={showVoiceoverStudio}
              >
                {showVoiceoverStudio ? (
                  <ChevronUp size={18} className="voiceover-studio-toggle-icon" />
                ) : (
                  <ChevronDown size={18} className="voiceover-studio-toggle-icon" />
                )}
                Voiceover Studio
              </button>
              {showVoiceoverStudio && <VoiceoverStudio memo={memo} />}
            </div>
          )}

          {memo.url && (
            <div className="pt-8 border-t border-white/5 flex items-center justify-between text-[11px] text-white/20 font-mono uppercase tracking-widest">
              <span>Recorded {new Date(memo.createdAt).toLocaleString()}</span>
              <a
                href={memo.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1.5 hover:text-accent transition-colors"
              >
                <ExternalLink size={11} /> Source
              </a>
            </div>
          )}
        </div>
      </div>

      <MemoPlaybackFooter memo={memo} playbackTheme={playbackTheme} />
    </motion.div>
  );
}

type MemoSidebarProps = {
  filteredBookmarkedMemos: SharedMemoBookmark[];
  filteredMemos: Memo[];
  isSignedIn: boolean | undefined;
  loading: boolean;
  searchQuery: string;
  selectedMemoId: string | null;
  onSearchQueryChange: (value: string) => void;
  onSelectMemo: (memoId: string | null) => void;
};

export function MemoSidebar({
  filteredBookmarkedMemos,
  filteredMemos,
  isSignedIn,
  loading,
  searchQuery,
  selectedMemoId,
  onSearchQueryChange,
  onSelectMemo,
}: MemoSidebarProps) {
  const [collapsed, setCollapsed] = useState(false);

  if (collapsed) {
    return (
      <aside className="w-14 flex-shrink-0 flex flex-col items-center border-r border-white/10 bg-[#0F0F0F]/80 backdrop-blur-xl z-20 py-4 gap-4">
        <div className="w-10 h-10 bg-accent/20 rounded-xl flex items-center justify-center text-accent shadow-[0_0_20px_var(--theme-glow)] border border-accent/20">
          <Mic2 size={20} />
        </div>
        <button
          onClick={() => setCollapsed(false)}
          className="w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 active:scale-90 flex items-center justify-center text-white/50 hover:text-white/80 transition-all border border-white/10"
          title="Expand sidebar"
        >
          <PanelLeftOpen size={18} />
        </button>
      </aside>
    );
  }

  return (
    <aside className="w-80 flex-shrink-0 flex flex-col border-r border-white/10 bg-[#0F0F0F]/80 backdrop-blur-xl z-20">
      <div className="p-6 border-b border-white/5 flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3 active:scale-95 transition-transform cursor-default">
            <div className="w-10 h-10 bg-accent/20 rounded-xl flex items-center justify-center text-accent shadow-[0_0_20px_var(--theme-glow)] border border-accent/20">
              <Mic2 size={20} />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-white/95">Memos</h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCollapsed(true)}
              className="w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 active:scale-90 flex items-center justify-center text-white/50 hover:text-white/80 transition-all border border-white/10"
              title="Collapse sidebar"
            >
              <PanelLeftClose size={16} />
            </button>
            <button
              onClick={() => onSelectMemo(null)}
              className="w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 active:scale-90 flex items-center justify-center text-white/70 transition-all border border-white/10 shadow-lg"
              title="New Recording"
            >
              <Plus size={22} />
            </button>
          </div>
        </div>

        <div className="relative">
          <Search
            className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40"
            size={14}
          />
          <input
            type="text"
            placeholder="Search transcripts..."
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            className="w-full bg-black/40 border border-white/10 rounded-xl py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-accent/50 focus:border-accent transition-all text-white/90 placeholder:text-white/30"
          />
        </div>
      </div>

      <div
        className="flex-1 overflow-y-auto"
        style={{
          scrollbarWidth: "thin",
          scrollbarColor: "rgba(255,255,255,0.1) transparent",
        }}
      >
        {loading ? (
          <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-3">
            <Loader2 size={18} className="animate-spin" />
            <p className="text-xs">Loading from Supabase...</p>
          </div>
        ) : filteredMemos.length === 0 && filteredBookmarkedMemos.length === 0 ? (
          <div className="text-center py-10 text-white/30 px-4">
            <p className="text-sm">
              {!isSignedIn
                ? "Sign in to see your recordings."
                : searchQuery
                ? "No results found."
                : "No recordings yet."}
            </p>
          </div>
        ) : (
          <div className="flex flex-col">
            {filteredBookmarkedMemos.length > 0 ? (
              <>
                <div className="px-5 py-3 text-[11px] font-mono uppercase tracking-[0.24em] text-white/25 border-b border-white/5">
                  Saved shares
                </div>
                {filteredBookmarkedMemos.map((bookmark) => (
                  <SharedMemoBookmarkListItem
                    key={`${bookmark.memoId}:${bookmark.bookmarkedAt}`}
                    bookmark={bookmark}
                  />
                ))}
              </>
            ) : null}
            {filteredMemos.map((memo) => (
              <MemoListItem
                key={memo.id}
                memo={memo}
                isActive={selectedMemoId === memo.id}
                onClick={() => onSelectMemo(memo.id)}
              />
            ))}
          </div>
        )}
      </div>
    </aside>
  );
}

export function PrimaryHeaderControls() {
  return (
    <header className="absolute top-6 right-6 z-30 flex items-center gap-4">
      <Link
        href="/docs"
        className="text-xs text-white/40 hover:text-accent transition-colors flex items-center gap-1 font-mono"
      >
        API Docs ↗
      </Link>
      <ThemeToggle />
      <AuthControls />
    </header>
  );
}

type RecorderPanelProps = {
  isUploading: boolean;
  uploadProgressPercent: number;
  onAudioInput?: (payload: AudioInputPayload) => void;
  onRetryUpload: () => void;
  onUploadComplete: (data: UploadCompletePayload) => void;
  showUploadError: boolean;
};

export function RecorderPanel({
  isUploading,
  uploadProgressPercent,
  onAudioInput,
  onRetryUpload,
  onUploadComplete,
  showUploadError,
}: RecorderPanelProps) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 mt-12">
      {showUploadError && (
        <div className="mb-6 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          Recording failed to save.
          <button
            onClick={onRetryUpload}
            className="ml-2 underline underline-offset-2 hover:text-red-100"
          >
            Retry
          </button>
        </div>
      )}
      <AudioRecorder
        isUploadInProgress={isUploading}
        uploadProgressPercent={uploadProgressPercent}
        onUploadComplete={onUploadComplete}
        onAudioInput={onAudioInput}
      />
      <div className="mt-8 text-center text-xs text-white/30 font-mono tracking-widest uppercase">
        <p>Powered by Supabase &amp; NVIDIA NIM</p>
      </div>
    </div>
  );
}
