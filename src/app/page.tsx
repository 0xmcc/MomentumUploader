"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import Link from "next/link";
import AudioRecorder from "@/components/AudioRecorder";
import type { UploadCompletePayload } from "@/components/AudioRecorder";
import ThemeToggle from "@/components/ThemeToggle";
import {
  Mic2, CloudSync, BrainCircuit, Search, Calendar,
  ChevronDown, ChevronUp, Play, Pause, ExternalLink,
  FileAudio, AlignLeft, Cpu, Loader2, Clock, FileDown, Plus
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

function MemoListItem({ memo, isActive, onClick }: { memo: Memo, isActive: boolean, onClick: () => void }) {
  const isFailed = memo.transcript === "[Transcription failed]" || !memo.transcript;
  // Use a snippet of the transcript as the title, or a default
  let title = "New Recording";
  if (!isFailed && memo.transcript) {
    title = memo.transcript.split(" ").slice(0, 6).join(" ") + (memo.transcript.split(" ").length > 6 ? "..." : "");
  } else if (isFailed) {
    title = "Transcription failed";
  }

  return (
    <div
      onClick={onClick}
      className={`px-5 py-4 border-b border-white/5 cursor-pointer flex flex-col gap-1.5 transition-colors ${isActive ? "bg-blue-600/90 text-white" : "hover:bg-white/5 text-white/80"
        }`}
    >
      <div className={`font-medium text-sm truncate ${isActive ? "text-white font-semibold" : "text-white/90"}`}>
        {title}
      </div>
      <div className={`flex justify-between text-xs font-mono tabular-nums ${isActive ? "text-white/90" : "text-white/40"}`}>
        <span>{formatDate(memo.createdAt)}</span>
        <span>{memo.durationSeconds != null ? formatSecs(memo.durationSeconds) : "--:--"}</span>
      </div>
    </div>
  );
}

function MemoDetailView({ memo }: { memo: Memo }) {
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

  // Reset state when memo changes
  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setAudioDuration(null);
  }, [memo.id]);

  const progress = audioDuration ? (currentTime / audioDuration) * 100 : 0;
  const displayDuration = audioDuration ?? memo.durationSeconds ?? null;

  return (
    <motion.div
      key={memo.id}
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      className="w-full max-w-4xl mx-auto flex flex-col items-center p-8 py-16 min-h-full"
    >
      <div className={`w-full relative bg-surface border rounded-3xl p-8 transition-all overflow-hidden shadow-2xl ${isFailed ? "border-red-500/20" : "border-white/5"}`}>
        <div className="absolute top-0 right-0 w-64 h-64 bg-accent/5 rounded-full blur-3xl -translate-y-32 translate-x-32" />

        {/* Header */}
        <div className="flex justify-between items-start mb-6 relative">
          <div>
            <h2 className="text-3xl font-semibold mb-3 text-white">
              {formatDate(memo.createdAt)}
            </h2>
            <div className="flex items-center gap-2">
              {isFailed ? (
                <span className="text-xs text-red-400 bg-red-400/10 px-2.5 py-1 rounded-full border border-red-500/20">Transcription failed</span>
              ) : (
                <span className="text-xs text-green-400/80 bg-green-400/10 px-2.5 py-1 rounded-full border border-green-500/20">Transcribed</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {!isFailed && memo.transcript && (
              <button
                onClick={() => exportMarkdown(memo)}
                title="Export as Markdown"
                className="flex items-center gap-1.5 text-sm text-white/50 hover:text-accent bg-white/5 hover:bg-accent/10 border border-white/8 hover:border-accent/30 px-3 py-1.5 rounded-full transition-all duration-200 group"
              >
                <FileDown size={14} className="transition-transform duration-200 group-hover:-translate-y-0.5" />
                <span className="font-mono tracking-wide">Export .md</span>
              </button>
            )}
          </div>
        </div>

        {/* Huge Audio player controls */}
        {memo.url && (
          <div className="flex flex-col gap-5 mb-8 bg-black/30 border border-white/5 rounded-3xl p-6 relative z-10">
            <audio
              ref={audioRef}
              src={memo.url}
              preload="metadata"
              onLoadedMetadata={(e) => setAudioDuration((e.target as HTMLAudioElement).duration)}
              onTimeUpdate={(e) => setCurrentTime((e.target as HTMLAudioElement).currentTime)}
              onEnded={() => { setIsPlaying(false); setCurrentTime(0); }}
            />

            {/* Simulated waveform playback UI */}
            <div className="flex items-center justify-between font-mono text-xs text-white/40 mb-1 px-1">
              <span>{formatSecs(currentTime)}</span>
              <span>{displayDuration != null ? formatSecs(displayDuration) : "--:--"}</span>
            </div>

            <div
              onClick={handleSeek}
              className="w-full h-12 bg-white/5 rounded-xl cursor-pointer overflow-hidden relative group border border-white/5"
            >
              <div className="absolute inset-0 flex items-center justify-around opacity-30 px-1 pointer-events-none">
                {Array.from({ length: 60 }).map((_, i) => {
                  const active = (i / 60) * 100 <= progress;
                  return (
                    <div key={i} className={`w-1 rounded-full transition-colors ${active ? "bg-accent/80" : "bg-white/40"} ${isPlaying && active ? "animate-pulse" : ""}`} style={{ height: `${20 + Math.random() * 80}%` }} />
                  )
                })}
              </div>
              <div
                className="absolute left-0 top-0 h-full bg-blue-500/20 mix-blend-screen"
                style={{ width: `${progress}%`, transition: "width 0.1s linear" }}
              />
            </div>

            <div className="flex items-center justify-center mt-2">
              <button
                onClick={togglePlay}
                className="w-16 h-16 rounded-full bg-accent text-white hover:scale-105 shadow-[0_0_20px_rgba(139,92,246,0.3)] flex items-center justify-center transition-all flex-shrink-0 border border-white/10"
              >
                {isPlaying ? <Pause size={24} /> : <Play size={24} className="translate-x-1" />}
              </button>
            </div>
          </div>
        )}

        {/* Meta row */}
        <div className="flex flex-wrap items-center gap-4 text-xs text-white/40 mb-6 relative z-10 border-t border-white/5 pt-6">
          {!isFailed && <span className="flex items-center gap-1.5"><AlignLeft size={12} /> {memo.wordCount} words</span>}
          {memo.modelUsed && (
            <span className="flex items-center gap-1.5"><Cpu size={12} /> {memo.modelUsed}</span>
          )}
          {memo.url && (
            <a href={memo.url} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-accent/60 hover:text-accent transition-colors">
              <ExternalLink size={12} /> Open in Storage
            </a>
          )}
        </div>

        {/* Transcript */}
        <div className="relative z-10 bg-white/[0.02] border border-white/5 rounded-2xl p-6">
          <h3 className="text-xs font-semibold text-white/30 uppercase tracking-widest mb-4">Transcript</h3>
          <p className={`text-base leading-relaxed ${isFailed ? "text-red-300/50 italic" : "text-white/80"
            }`}>
            {memo.transcript || "No transcript available."}
          </p>
        </div>
      </div>
    </motion.div>
  );
}

export default function Home() {
  const [memos, setMemos] = useState<Memo[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedMemoId, setSelectedMemoId] = useState<string | null>(null);

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
    const newMemoId = `optimistic-${Date.now()}`;
    const newMemo: Memo = {
      id: newMemoId,
      transcript: data?.text ?? "",
      createdAt: new Date().toISOString(),
      url: data?.url,
      modelUsed: data?.modelUsed,
      wordCount: data?.text ? data.text.split(/\s+/).filter(Boolean).length : 0,
      durationSeconds: data?.durationSeconds,
      success: data?.success,
    };
    setMemos((prev) => [newMemo, ...prev]);
    setSelectedMemoId(newMemoId);
    // Re-fetch to replace optimistic row with real Supabase row
    setTimeout(() => {
      fetchMemos().then(() => {
        // Refresh list quietly
      });
    }, 1500);
  };

  const filteredMemos = memos.filter((m) =>
    m.transcript.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <main className="flex h-screen w-full bg-[#0A0A0A] overflow-hidden text-white font-sans">
      {/* Left Sidebar */}
      <aside className="w-80 flex-shrink-0 flex flex-col border-r border-white/10 bg-[#0F0F0F]/80 backdrop-blur-xl z-20">
        {/* Header inside sidebar */}
        <div className="p-6 border-b border-white/5 flex flex-col gap-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 active:scale-95 transition-transform cursor-default">
              <div className="w-10 h-10 bg-accent/20 rounded-xl flex items-center justify-center text-accent shadow-[0_0_20px_var(--theme-glow)] border border-accent/20">
                <Mic2 size={20} />
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-white/95">Memos</h1>
            </div>
            <button
              onClick={() => setSelectedMemoId(null)}
              className="w-10 h-10 rounded-full bg-white/5 hover:bg-white/10 active:scale-90 flex items-center justify-center text-white/70 transition-all border border-white/10 shadow-lg"
              title="New Recording"
            >
              <Plus size={22} />
            </button>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/40" size={14} />
            <input
              type="text"
              placeholder="Search transcripts..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-black/40 border border-white/10 rounded-xl py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-1 focus:ring-accent/50 focus:border-accent transition-all text-white/90 placeholder:text-white/30"
            />
          </div>
        </div>

        {/* Memo List */}
        <div className="flex-1 overflow-y-auto" style={{ scrollbarWidth: 'thin', scrollbarColor: 'rgba(255,255,255,0.1) transparent' }}>
          {loading ? (
            <div className="flex flex-col items-center justify-center py-10 text-white/30 gap-3">
              <Loader2 size={18} className="animate-spin" />
              <p className="text-xs">Loading from Supabase...</p>
            </div>
          ) : filteredMemos.length === 0 ? (
            <div className="text-center py-10 text-white/30 px-4">
              <p className="text-sm">
                {searchQuery ? "No results found." : "No recordings yet."}
              </p>
            </div>
          ) : (
            <div className="flex flex-col">
              {filteredMemos.map((memo) => (
                <MemoListItem
                  key={memo.id}
                  memo={memo}
                  isActive={selectedMemoId === memo.id}
                  onClick={() => setSelectedMemoId(memo.id)}
                />
              ))}
            </div>
          )}
        </div>
      </aside>

      {/* Main Content Area */}
      <section className="flex-1 flex flex-col relative bg-[#121212] overflow-y-auto">
        <header className="absolute top-6 right-6 z-30 flex items-center gap-4">
          <Link href="/docs" className="text-xs text-white/40 hover:text-accent transition-colors flex items-center gap-1 font-mono">
            API Docs ↗
          </Link>
          <ThemeToggle />
        </header>

        {selectedMemoId ? (
          <MemoDetailView memo={memos.find((m) => m.id === selectedMemoId) || memos[0]} />
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 mt-12">
            <AudioRecorder onUploadComplete={handleUploadComplete} />
            <div className="mt-8 text-center text-xs text-white/30 font-mono tracking-widest uppercase">
              <p>Powered by Supabase &amp; NVIDIA NIM</p>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
