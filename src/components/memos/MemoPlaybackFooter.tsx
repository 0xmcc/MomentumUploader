"use client";

import { Pause, Play } from "lucide-react";
import { useAudioPlayback } from "@/hooks/useMemoPlayback";
import { formatSecs, type Memo } from "@/lib/memo-ui";

export function MemoPlaybackFooter({
  memo,
  playbackTheme,
}: {
  memo: Memo;
  playbackTheme: string;
}) {
  const {
    audioRef,
    currentTime,
    displayDuration,
    handleEnded,
    handleLoadedMetadata,
    handleSeek,
    handleTimeUpdate,
    isPlaying,
    progress,
    togglePlay,
  } = useAudioPlayback(memo.url, memo.durationSeconds);

  return (
    <div className="bg-[#161616] border-t border-white/10 px-8 py-5 shadow-[0_-10px_40px_rgba(0,0,0,0.5)] z-10">
      <div className="max-w-3xl mx-auto flex flex-col gap-4">
        {memo.url && (
          <div className="flex flex-col gap-3">
            <audio
              ref={audioRef}
              src={memo.url}
              preload="metadata"
              onLoadedMetadata={handleLoadedMetadata}
              onTimeUpdate={handleTimeUpdate}
              onEnded={handleEnded}
            />

            <div className="flex flex-col gap-2">
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

            <div className="flex items-center justify-center">
              <button
                onClick={togglePlay}
                className="group relative flex items-center justify-center w-16 h-16 rounded-full transition-all duration-300 hover:scale-105 active:scale-95"
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
                  className={`absolute inset-1 rounded-full border border-white/5 ${
                    playbackTheme === "accent" ? "bg-accent/5" : "bg-white/[0.02]"
                  }`}
                />

                <div
                  className={`absolute inset-2.5 rounded-full border transition-colors duration-300 ${
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
                    <Pause size={18} fill="currentColor" />
                  ) : (
                    <Play size={18} fill="currentColor" className="translate-x-0.5" />
                  )}
                </div>
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
