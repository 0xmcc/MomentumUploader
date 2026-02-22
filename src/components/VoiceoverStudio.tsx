"use client";

import { Download, Loader2, Mic2, Pause, Play } from "lucide-react";
import { useTheme } from "@/components/ThemeProvider";
import { useVoiceoverStudio } from "@/hooks/useVoiceoverStudio";
import { formatSecs, type Memo } from "@/lib/memo-ui";

type VoiceoverStudioProps = {
  memo: Memo;
};

export default function VoiceoverStudio({ memo }: VoiceoverStudioProps) {
  const { playbackTheme } = useTheme();
  const {
    voices,
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
  } = useVoiceoverStudio({
    memoId: memo.id,
    memoUrl: memo.url ?? null,
  });

  if (!memo.url) {
    return null;
  }

  const selectedVoice = voices.find((voice) => voice.id === selectedVoiceId) ?? null;
  const progress = voDuration ? (voCurrentTime / voDuration) * 100 : 0;
  const canPlay = voState === "ready" && Boolean(voObjectUrl);

  return (
    <section className="mt-10 rounded-3xl border border-white/10 bg-white/[0.02] p-5 sm:p-6 shadow-[0_20px_40px_rgba(0,0,0,0.35)]">
      <audio ref={audioRef} src={voObjectUrl ?? undefined} preload="metadata" />

      <div className="flex items-center justify-between gap-4 pb-4 border-b border-white/10">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl border border-accent/30 bg-accent/15 text-accent flex items-center justify-center">
            <Mic2 size={16} />
          </div>
          <div>
            <h3 className="text-white/95 text-base font-semibold">Voiceover Studio</h3>
            <p className="text-[11px] text-white/45 uppercase tracking-[0.18em] font-mono">
              Powered by ElevenLabs
            </p>
          </div>
        </div>

        {canPlay && (
          <button
            onClick={handleDownload}
            className="inline-flex items-center gap-1.5 rounded-full border border-accent/35 bg-accent/15 px-3 py-1.5 text-xs font-mono uppercase tracking-wide text-accent hover:bg-accent/25 transition-colors"
          >
            <Download size={13} />
            Export MP3
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-5">
        {voices.map((voice) => {
          const isSelected = selectedVoiceId === voice.id;
          const isLoading = isSelected && voState === "loading";
          const isReady = isSelected && voState === "ready";

          return (
            <button
              key={voice.id}
              onClick={() => handleVoiceSelect(voice.id)}
              className={`relative overflow-hidden rounded-2xl border p-4 text-left transition-all duration-200 ${
                isSelected
                  ? "border-accent/40 bg-accent/10"
                  : "border-white/8 bg-white/[0.03] hover:bg-white/[0.06] hover:border-white/15"
              }`}
            >
              {isLoading && (
                <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent animate-pulse" />
              )}

              <div className="relative flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm text-white/90 font-semibold tracking-tight">{voice.name}</p>
                  <p className="text-[10px] font-mono uppercase tracking-widest text-white/40 mt-1">
                    {voice.accent}
                  </p>
                </div>

                {isLoading && <Loader2 size={14} className="animate-spin text-accent" aria-label="Generating voiceover" />}
                {!isLoading && isReady && (
                  <span className="w-2 h-2 rounded-full bg-accent shadow-[0_0_10px_var(--accent)] animate-pulse" />
                )}
              </div>

              <p className="relative mt-3 text-xs text-white/70">{voice.style}</p>
            </button>
          );
        })}
      </div>

      {voError && (
        <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          {voError}
        </div>
      )}

      <div className="mt-5 border-t border-white/10 pt-5">
        <div className="flex items-center gap-3 text-sm text-white/75">
          <div className="flex items-end gap-1 h-4" aria-hidden="true">
            {[0, 1, 2, 3].map((bar) => (
              <span
                key={bar}
                className={`w-1 rounded-full bg-accent/70 ${
                  voIsPlaying ? "animate-pulse" : "opacity-35"
                }`}
                style={{
                  height: `${9 + bar * 2}px`,
                  animationDelay: `${bar * 120}ms`,
                }}
              />
            ))}
          </div>
          <span className="font-medium text-white/85">
            {selectedVoice ? `${selectedVoice.name} — ${selectedVoice.style}` : "Select a voice"}
          </span>
        </div>

        <div className="mt-4 flex flex-col gap-2">
          <div
            onClick={canPlay ? handleVoSeek : undefined}
            className={`w-full h-1.5 rounded-full relative overflow-hidden ${
              canPlay ? "bg-white/10 cursor-pointer" : "bg-white/5"
            }`}
          >
            <div
              className={`absolute left-0 top-0 h-full transition-all duration-100 ease-linear ${
                playbackTheme === "accent"
                  ? "bg-accent shadow-[0_0_12px_var(--accent)]"
                  : "bg-white/70 shadow-[0_0_10px_rgba(255,255,255,0.3)]"
              }`}
              style={{ width: `${progress}%` }}
            />
          </div>
          <div className="flex items-center justify-end text-[11px] text-white/35 font-mono uppercase tabular-nums tracking-tight">
            <span>
              {formatSecs(voCurrentTime)} / {voDuration != null ? formatSecs(voDuration) : "--:--"}
            </span>
          </div>
        </div>

        <div className="flex justify-center pt-4">
          <button
            onClick={handlePlayPause}
            disabled={!canPlay}
            aria-label={voIsPlaying ? "Pause voiceover" : "Play voiceover"}
            className="group relative flex h-20 w-20 items-center justify-center rounded-full transition-all duration-300 hover:scale-105 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <div
              className={`absolute inset-0 rounded-full blur-xl ${
                playbackTheme === "accent" ? "bg-accent/20" : "bg-white/10"
              }`}
            />
            <div className="absolute inset-0 rounded-full bg-[#121212] border border-white/10" />
            <div
              className={`absolute inset-3 rounded-full flex items-center justify-center ${
                playbackTheme === "accent"
                  ? "bg-accent/15 border border-accent/35 text-white"
                  : "bg-white/10 border border-white/20 text-white"
              }`}
            >
              {voIsPlaying ? (
                <Pause size={28} fill="currentColor" />
              ) : (
                <Play size={28} fill="currentColor" className="translate-x-0.5" />
              )}
            </div>
          </button>
        </div>
      </div>
    </section>
  );
}
