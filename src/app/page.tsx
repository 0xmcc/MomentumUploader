"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import AudioRecorder from "@/components/AudioRecorder";
import type { UploadCompletePayload } from "@/components/AudioRecorder";
import ThemeToggle from "@/components/ThemeToggle";
import {
  Mic2, CloudSync, BrainCircuit, Search, Calendar,
  ChevronDown, ChevronUp, Play, Pause, ExternalLink,
  FileAudio, AlignLeft, Cpu, Loader2, Clock, FileDown,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

type Memo = {
  id: string;
  transcript: string;
  createdAt: string;
  url?: string;
  modelUsed?: string;
  wordCount: number;
  durationSeconds?: number;
  success?: boolean;
};

function formatDate(iso: string) {
  const d = new Date(iso);
  const now = new Date();
  const diffMins = Math.floor((now.getTime() - d.getTime()) / 60000);
  if (diffMins < 1) return "Just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function formatSecs(s: number) {
  if (!isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function exportMarkdown(memo: Memo) {
  const date = new Date(memo.createdAt).toISOString();
  const duration = memo.durationSeconds != null ? formatSecs(memo.durationSeconds) : "unknown";
  const safeTitle = date.slice(0, 10);

  const md = [
    "---",
    `id: ${memo.id}`,
    `date: "${date}"`,
    `model: "${memo.modelUsed ?? "unknown"}"`,
    `word_count: ${memo.wordCount}`,
    `duration: "${duration}"`,
    memo.url ? `audio_url: "${memo.url}"` : null,
    "---",
    "",
    "# Voice Memo Transcript",
    "",
    "## Metadata",
    "",
    `| Field | Value |`,
    `| ----- | ----- |`,
    `| Date | ${new Date(memo.createdAt).toLocaleString("en-US", { dateStyle: "long", timeStyle: "short" })} |`,
    `| Duration | ${duration} |`,
    `| Word count | ${memo.wordCount} |`,
    `| Model | ${memo.modelUsed ?? "unknown"} |`,
    memo.url ? `| Audio | [Listen](${memo.url}) |` : null,
    "",
    "## Transcript",
    "",
    memo.transcript || "*(no transcript)*",
    "",
  ]
    .filter((line) => line !== null)
    .join("\n");

  const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `memo-${safeTitle}-${memo.id.slice(0, 8)}.md`;
  a.click();
  URL.revokeObjectURL(url);
}

function MemoCard({ memo }: { memo: Memo }) {
  const [expanded, setExpanded] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const isFailed = memo.transcript === "[Transcription failed]" || !memo.transcript;

  const togglePlay = async () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      await audioRef.current.play();
      setIsPlaying(true);
    }
  };

  const handleSeek = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!audioRef.current || !audioDuration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audioRef.current.currentTime = ratio * audioDuration;
    setCurrentTime(ratio * audioDuration);
  };

  const progress = audioDuration ? (currentTime / audioDuration) * 100 : 0;
  // Use audio element's real duration; fall back to prop only if not yet loaded
  const displayDuration = audioDuration ?? memo.durationSeconds ?? null;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`group relative bg-surface border rounded-2xl p-6 transition-all overflow-hidden backdrop-blur-sm ${isFailed ? "border-red-500/20" : "border-white/5 hover:border-accent/30"
        }`}
    >
      <div className="absolute top-0 right-0 w-32 h-32 bg-accent/5 rounded-full blur-3xl -translate-y-16 translate-x-16 group-hover:bg-accent/10 transition-colors" />

      {/* Header */}
      <div className="flex justify-between items-start mb-3 relative">
        <div className="flex items-center gap-2">
          {isFailed ? (
            <span className="text-xs text-red-400 bg-red-400/10 px-2 py-1 rounded-full">Transcription failed</span>
          ) : (
            <span className="text-xs text-green-400/80 bg-green-400/10 px-2 py-1 rounded-full">Transcribed</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {displayDuration != null && (
            <span className="text-xs text-white/40 font-mono bg-white/5 px-3 py-1 rounded-full flex items-center gap-1">
              <Clock size={10} /> {formatSecs(displayDuration)}
            </span>
          )}
          {!isFailed && memo.transcript && (
            <button
              id={`export-md-${memo.id}`}
              onClick={() => exportMarkdown(memo)}
              title="Export as Markdown"
              className="flex items-center gap-1.5 text-xs text-white/35 hover:text-accent bg-white/5 hover:bg-accent/10 border border-white/8 hover:border-accent/30 px-2.5 py-1 rounded-full transition-all duration-200 group/export"
            >
              <FileDown size={11} className="transition-transform duration-200 group-hover/export:-translate-y-0.5" />
              <span className="font-mono tracking-wide">.md</span>
            </button>
          )}
        </div>
      </div>

      {/* Transcript */}
      <p className={`text-sm leading-relaxed mb-4 line-clamp-3 relative z-10 ${isFailed ? "text-red-300/50 italic" : "text-white/70"
        }`}>
        {memo.transcript || "No transcript available."}
      </p>

      {/* Meta row */}
      <div className="flex flex-wrap items-center gap-3 text-xs text-white/35 mb-3 relative z-10">
        <span className="flex items-center gap-1"><Calendar size={10} /> {formatDate(memo.createdAt)}</span>
        {!isFailed && <span className="flex items-center gap-1"><AlignLeft size={10} /> {memo.wordCount} words</span>}
        {memo.modelUsed && (
          <span className="flex items-center gap-1"><Cpu size={10} /> {memo.modelUsed}</span>
        )}
        {memo.url && (
          <a href={memo.url} target="_blank" rel="noopener noreferrer"
            className="flex items-center gap-1 text-accent/50 hover:text-accent transition-colors">
            <ExternalLink size={10} /> Storage
          </a>
        )}
      </div>

      {/* Audio player */}
      {memo.url && (
        <div className="flex items-center gap-3 mb-4 bg-white/[0.03] border border-white/5 rounded-xl px-4 py-3 relative z-10">
          <audio
            ref={audioRef}
            src={memo.url}
            preload="metadata"
            onLoadedMetadata={(e) => setAudioDuration((e.target as HTMLAudioElement).duration)}
            onTimeUpdate={(e) => setCurrentTime((e.target as HTMLAudioElement).currentTime)}
            onEnded={() => { setIsPlaying(false); setCurrentTime(0); }}
          />

          {/* Play / Pause */}
          <button
            onClick={togglePlay}
            className="w-8 h-8 rounded-full bg-accent/20 text-accent hover:bg-accent hover:text-white flex items-center justify-center transition flex-shrink-0"
          >
            {isPlaying ? <Pause size={12} /> : <Play size={12} className="translate-x-px" />}
          </button>

          {/* Progress bar */}
          <div
            onClick={handleSeek}
            className="flex-1 h-1.5 bg-white/10 rounded-full cursor-pointer overflow-hidden relative"
          >
            <div
              className="absolute left-0 top-0 h-full bg-accent rounded-full"
              style={{ width: `${progress}%`, transition: "width 0.1s linear" }}
            />
          </div>

          {/* Time */}
          <span className="text-white/30 font-mono text-xs flex-shrink-0 tabular-nums">
            {formatSecs(currentTime)} / {audioDuration != null ? formatSecs(audioDuration) : "--:--"}
          </span>

          <FileAudio size={12} className="text-white/20 flex-shrink-0" />
        </div>
      )}

      {/* Expand toggle */}
      {!isFailed && memo.transcript && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 text-xs text-accent/70 font-medium hover:text-accent transition relative z-10"
        >
          {expanded ? <><ChevronUp size={12} /> Collapse</> : <><ChevronDown size={12} /> Full transcript</>}
        </button>
      )}

      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <p className="mt-3 text-white/60 text-sm leading-relaxed border-t border-white/5 pt-3">
              {memo.transcript}
            </p>
            {memo.url && (
              <p className="mt-2 text-white/20 text-xs font-mono break-all">{memo.url}</p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

export default function Home() {
  const [memos, setMemos] = useState<Memo[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");

  const fetchMemos = useCallback(async () => {
    try {
      const res = await fetch("/api/memos");
      const json = await res.json();
      if (json.memos) setMemos(json.memos);
    } catch (err) {
      console.error("Failed to fetch memos:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchMemos();
  }, [fetchMemos]);

  const handleUploadComplete = (data: UploadCompletePayload) => {
    const newMemo: Memo = {
      id: `optimistic-${Date.now()}`,
      transcript: data?.text ?? "",
      createdAt: new Date().toISOString(),
      url: data?.url,
      modelUsed: data?.modelUsed,
      wordCount: data?.text ? data.text.split(/\s+/).filter(Boolean).length : 0,
      durationSeconds: data?.durationSeconds,
      success: data?.success,
    };
    setMemos((prev) => [newMemo, ...prev]);
    // Re-fetch to replace optimistic row with real Supabase row
    setTimeout(() => fetchMemos(), 1500);
  };

  const filteredMemos = memos.filter((m) =>
    m.transcript.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <main className="container mx-auto px-4 py-12 max-w-6xl">
      <header className="flex flex-col md:flex-row items-center justify-between mb-16 gap-6">
        <div className="flex items-center space-x-4">
          <div className="w-12 h-12 bg-accent/20 rounded-2xl flex items-center justify-center text-accent shadow-[0_0_30px_var(--theme-glow)] border border-accent/20">
            <Mic2 size={24} />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Sonic Memos</h1>
            <p className="text-white/60 text-sm mt-1 flex items-center gap-2">
              <CloudSync size={14} className="text-blue-400" /> Cloud Sync
              <span className="w-1 h-1 rounded-full bg-white/20 mx-1" />
              <BrainCircuit size={14} className="text-green-400" /> Parakeet AI
              <span className="w-1 h-1 rounded-full bg-white/20 mx-1" />
              <Link href="/docs" className="text-accent/70 hover:text-accent transition-colors flex items-center gap-1">
                API Docs ↗
              </Link>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto">
          <div className="relative flex-1 md:w-80">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" size={18} />
            <input
              type="text"
              placeholder="Search transcripts..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-surface border border-white/5 rounded-full py-2 pl-10 pr-4 text-sm focus:outline-none focus:ring-2 focus:ring-accent/50 focus:border-accent transition-all text-white/90 placeholder:text-white/30 shadow-inner"
            />
          </div>
          <ThemeToggle />
        </div>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-12">
        {/* Recorder */}
        <div className="lg:col-span-5 flex flex-col items-center">
          <div className="sticky top-12 w-full">
            <AudioRecorder onUploadComplete={handleUploadComplete} />
            <div className="mt-8 text-center text-xs text-white/40 font-mono">
              <p>Powered by Supabase &amp; NVIDIA NIM</p>
            </div>
          </div>
        </div>

        {/* Memo list */}
        <div className="lg:col-span-7 space-y-4">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-xl font-medium">Recent Transcripts</h2>
            {!loading && <span className="text-sm text-white/40">{memos.length} Total</span>}
          </div>

          {loading ? (
            <div className="flex flex-col items-center justify-center py-20 text-white/30 gap-3">
              <Loader2 size={28} className="animate-spin" />
              <p className="text-sm">Loading from Supabase...</p>
            </div>
          ) : (
            <div className="space-y-4">
              {filteredMemos.map((memo) => (
                <MemoCard key={memo.id} memo={memo} />
              ))}
              {filteredMemos.length === 0 && (
                <div className="text-center py-16 text-white/30 border border-dashed border-white/10 rounded-2xl bg-white/[0.02]">
                  <Mic2 size={32} className="mx-auto mb-4 opacity-40" />
                  <p className="text-sm">
                    {searchQuery ? "No memos match your search." : "No memos yet — record your first one!"}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
