"use client";

import Link from "next/link";
import {
  Check,
  Cpu,
  ExternalLink,
  FileDown,
  Link2,
  Loader2,
  Mic2,
  Pause,
  Play,
  Plus,
  Search,
} from "lucide-react";
import { motion } from "framer-motion";
import {
  SignedIn,
  SignedOut,
  SignInButton,
  UserButton,
} from "@clerk/nextjs";
import AudioRecorder from "@/components/AudioRecorder";
import VoiceoverStudio from "@/components/VoiceoverStudio";
import type {
  RecordingStopPayload,
  UploadCompletePayload,
} from "@/components/AudioRecorder";
import ThemeToggle from "@/components/ThemeToggle";
import { useTheme } from "@/components/ThemeProvider";
import { useMemoPlayback } from "@/hooks/useMemoPlayback";
import {
  exportMarkdown,
  formatDate,
  formatSecs,
  getMemoTitle,
  isMemoFailed,
  type Memo,
} from "@/lib/memo-ui";

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
        <span>
          {memo.durationSeconds != null ? formatSecs(memo.durationSeconds) : "--:--"}
        </span>
      </div>
    </div>
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

export function MemoDetailView({ memo }: { memo: Memo }) {
  const { playbackTheme } = useTheme();
  const {
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
  } = useMemoPlayback(memo);
  const isFailed = isMemoFailed(memo);

  return (
    <motion.div
      key={memo.id}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col h-full w-full"
    >
      <div className="flex justify-between items-center pl-8 pr-8 py-6 border-b border-white/5 bg-[#121212]/50 backdrop-blur-md z-10">
        <div className="flex flex-col">
          <h2 className="text-xl font-semibold text-white/90">
            {formatDate(memo.createdAt)}
          </h2>
          <div className="flex items-center gap-2 mt-1">
            {isFailed ? (
              <span className="text-[10px] text-red-400 bg-red-400/10 px-2 py-0.5 rounded-full border border-red-500/20 uppercase tracking-tight">
                Failed
              </span>
            ) : (
              <span className="text-[10px] text-green-400/80 bg-green-400/10 px-2 py-0.5 rounded-full border border-green-500/20 uppercase tracking-tight">
                Transcribed
              </span>
            )}
            {!isFailed && (
              <span className="text-[10px] text-white/30 font-mono uppercase tracking-tight">
                {memo.wordCount} words
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3">
          {memo.modelUsed && (
            <span className="hidden sm:flex items-center gap-1.5 text-[10px] text-white/30 font-mono uppercase tracking-tight">
              <Cpu size={10} /> {memo.modelUsed}
            </span>
          )}
          <button
            onClick={handleShare}
            title="Copy share link"
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
              <Link2 size={14} />
            )}
            <span className="hidden sm:inline font-mono tracking-wide">
              {shareLabel}
            </span>
          </button>
          {shareState === "copied" && lastShareUrl && (
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

      <div className="flex-1 overflow-y-auto px-8 py-10 relative">
        <div className="max-w-3xl mx-auto">
          <div
            className={`text-lg leading-relaxed whitespace-pre-wrap ${
              isFailed ? "text-red-300/40 italic" : "text-white/80"
            }`}
          >
            {memo.transcript || "No transcript available."}
          </div>

          {!isFailed && memo.transcript && memo.url && <VoiceoverStudio memo={memo} />}

          {memo.url && (
            <div className="mt-12 pt-8 border-t border-white/5 flex items-center justify-between text-[11px] text-white/20 font-mono uppercase tracking-widest">
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

      <div className="bg-[#161616] border-t border-white/10 px-8 py-10 shadow-[0_-10px_40px_rgba(0,0,0,0.5)] z-10">
        <div className="max-w-3xl mx-auto flex flex-col gap-8">
          {memo.url && (
            <div className="flex flex-col gap-6">
              <audio
                ref={audioRef}
                src={memo.url}
                preload="metadata"
                onLoadedMetadata={handleLoadedMetadata}
                onTimeUpdate={handleTimeUpdate}
                onEnded={handleEnded}
              />

              <div className="flex flex-col gap-3">
                <div
                  onClick={handleSeek}
                  className="w-full h-1.5 bg-white/5 rounded-full cursor-pointer relative group overflow-hidden"
                >
                  <div
                    className={`absolute left-0 top-0 h-full transition-all duration-100 ease-linear ${
                      playbackTheme === "accent"
                        ? "bg-accent shadow-[0_0_12px_var(--accent)]"
                        : "bg-white/60 shadow-[0_0_12px_rgba(255,255,255,0.3)]"
                    }`}
                    style={{ width: `${progress}%` }}
                  />
                  <div
                    className="absolute h-full w-0.5 bg-white scale-y-150 transition-all opacity-0 group-hover:opacity-100"
                    style={{ left: `${progress}%` }}
                  />
                </div>
                <div className="flex items-center justify-between font-mono text-[11px] text-white/20 tracking-tighter tabular-nums uppercase">
                  <span>{formatSecs(currentTime)}</span>
                  <span>
                    {displayDuration != null ? formatSecs(displayDuration) : "--:--"}
                  </span>
                </div>
              </div>

              <div className="flex items-center justify-center py-4">
                <button
                  onClick={togglePlay}
                  className="group relative flex items-center justify-center w-24 h-24 rounded-full transition-all duration-300 hover:scale-105 active:scale-95"
                >
                  <div
                    className={`absolute inset-0 rounded-full blur-2xl transition-opacity duration-500 ${
                      playbackTheme === "accent"
                        ? "bg-accent/20 group-hover:bg-accent/30"
                        : "bg-white/5 group-hover:bg-white/10"
                    }`}
                  />

                  <div className="absolute inset-0 rounded-full bg-[#121212] border border-white/5 shadow-2xl" />
                  <div
                    className={`absolute inset-1.5 rounded-full border border-white/5 ${
                      playbackTheme === "accent" ? "bg-accent/5" : "bg-white/[0.02]"
                    }`}
                  />

                  <div
                    className={`absolute inset-4 rounded-full border transition-colors duration-300 ${
                      playbackTheme === "accent"
                        ? "border-accent/20 bg-accent/10"
                        : "border-white/10 bg-white/5"
                    }`}
                  />

                  <div
                    className={`absolute inset-[22%] rounded-full flex items-center justify-center shadow-2xl transition-all duration-300 ${
                      playbackTheme === "accent"
                        ? "bg-white text-black group-hover:bg-accent group-hover:text-white"
                        : "bg-white/10 text-white group-hover:bg-white group-hover:text-black"
                    }`}
                  >
                    {isPlaying ? (
                      <Pause size={32} fill="currentColor" />
                    ) : (
                      <Play size={32} fill="currentColor" className="translate-x-0.5" />
                    )}
                  </div>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}

type MemoSidebarProps = {
  filteredMemos: Memo[];
  isSignedIn: boolean | undefined;
  loading: boolean;
  searchQuery: string;
  selectedMemoId: string | null;
  onSearchQueryChange: (value: string) => void;
  onSelectMemo: (memoId: string | null) => void;
};

export function MemoSidebar({
  filteredMemos,
  isSignedIn,
  loading,
  searchQuery,
  selectedMemoId,
  onSearchQueryChange,
  onSelectMemo,
}: MemoSidebarProps) {
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
          <button
            onClick={() => onSelectMemo(null)}
            className="w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 active:scale-90 flex items-center justify-center text-white/70 transition-all border border-white/10 shadow-lg"
            title="New Recording"
          >
            <Plus size={22} />
          </button>
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
        ) : filteredMemos.length === 0 ? (
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
  onRecordingStop: (payload: RecordingStopPayload) => void;
  onRetryUpload: () => void;
  onUploadComplete: (data: UploadCompletePayload) => void;
  showUploadError: boolean;
};

export function RecorderPanel({
  onRecordingStop,
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
        onUploadComplete={onUploadComplete}
        onRecordingStop={onRecordingStop}
      />
      <div className="mt-8 text-center text-xs text-white/30 font-mono tracking-widest uppercase">
        <p>Powered by Supabase &amp; NVIDIA NIM</p>
      </div>
    </div>
  );
}
