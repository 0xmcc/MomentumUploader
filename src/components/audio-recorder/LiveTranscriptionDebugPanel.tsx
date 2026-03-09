import type { LiveTranscriptionDebugState, LiveTranscriptionWindowMode } from "@/hooks/useLiveTranscription";

type LiveTranscriptionDebugPanelProps = {
    liveDebug: LiveTranscriptionDebugState;
};

const DEBUG_SEGMENT_COUNT = 24;

function formatWindowMode(windowMode: LiveTranscriptionWindowMode): string {
    switch (windowMode) {
        case "full_buffer":
            return "Full buffer";
        case "tail_window":
            return "Tail window";
        case "return_catch_up":
            return "Return catch-up";
        case "hybrid_first_and_tail":
            return "First + tail hybrid";
        default:
            return "Idle";
    }
}

function formatBytes(byteCount: number): string {
    if (byteCount < 1024) return `${byteCount} B`;
    return `${(byteCount / 1024).toFixed(1)} KB`;
}

function describeWindowMode(windowMode: LiveTranscriptionWindowMode): string {
    switch (windowMode) {
        case "tail_window":
            return "Only the newest audio tail is being sent. If the upstream model repeats older text inside this hypothesis, duplicate clauses can slip in.";
        case "return_catch_up":
            return "The tab just became visible again, so the full buffered window is being resent as a catch-up snapshot.";
        case "hybrid_first_and_tail":
            return "The request had to reuse the first chunk plus the latest tail. This split window is the riskiest duplication shape.";
        case "full_buffer":
            return "The whole buffered recording is being sent on each live tick.";
        default:
            return "Waiting for the next live transcription tick.";
    }
}

function buildDebugSegments(liveDebug: LiveTranscriptionDebugState) {
    const totalSegments = Math.max(1, Math.min(DEBUG_SEGMENT_COUNT, liveDebug.bufferedChunkCount || 1));
    const tailWindowEndIndex = liveDebug.snapshotWindowStartIndex + liveDebug.snapshotWindowChunkCount;

    return Array.from({ length: totalSegments }, (_, index) => {
        const segmentStart = Math.floor((index * liveDebug.bufferedChunkCount) / totalSegments);
        const segmentEnd = Math.max(
            segmentStart + 1,
            Math.floor(((index + 1) * liveDebug.bufferedChunkCount) / totalSegments)
        );
        const overlapsTailWindow =
            segmentEnd > liveDebug.snapshotWindowStartIndex &&
            segmentStart < tailWindowEndIndex;
        const containsFirstChunk = liveDebug.firstChunkRetained && segmentStart === 0;

        return {
            index,
            active: overlapsTailWindow || containsFirstChunk,
            containsFirstChunk,
        };
    });
}

export default function LiveTranscriptionDebugPanel({
    liveDebug,
}: LiveTranscriptionDebugPanelProps) {
    const debugSegments = buildDebugSegments(liveDebug);
    const lastServerTextPreview = liveDebug.lastServerText || "No hypothesis received yet.";

    return (
        <details className="mt-6 rounded-2xl border border-white/10 bg-white/[0.03]">
            <summary className="cursor-pointer list-none px-4 py-3 text-xs font-mono uppercase tracking-[0.18em] text-white/45">
                Live transcription diagnostics
            </summary>

            <div className="border-t border-white/10 px-4 py-4 text-sm text-white/70">
                <p className="mb-4 max-w-4xl text-xs leading-6 text-white/50">
                    {describeWindowMode(liveDebug.windowMode)}
                </p>

                <div className="grid gap-2 text-xs md:grid-cols-6">
                    <div className="rounded-xl border border-white/8 bg-black/10 px-3 py-2">
                        <span className="block text-[10px] uppercase tracking-[0.16em] text-white/40">Tab</span>
                        <span className="mt-1 block font-medium text-white/80">
                            {liveDebug.tabVisibility === "hidden" ? "Hidden" : "Visible"}
                        </span>
                    </div>
                    <div className="rounded-xl border border-white/8 bg-black/10 px-3 py-2">
                        <span className="block text-[10px] uppercase tracking-[0.16em] text-white/40">Window</span>
                        <span className="mt-1 block font-medium text-white/80">
                            {formatWindowMode(liveDebug.windowMode)}
                        </span>
                    </div>
                    <div className="rounded-xl border border-white/8 bg-black/10 px-3 py-2">
                        <span className="block text-[10px] uppercase tracking-[0.16em] text-white/40">Buffered chunks</span>
                        <span className="mt-1 block font-medium text-white/80">{liveDebug.bufferedChunkCount}</span>
                    </div>
                    <div className="rounded-xl border border-white/8 bg-black/10 px-3 py-2">
                        <span className="block text-[10px] uppercase tracking-[0.16em] text-white/40">Snapshot chunks</span>
                        <span className="mt-1 block font-medium text-white/80">
                            {liveDebug.snapshotAudioChunkCount} audio / {liveDebug.snapshotBlobCount} blobs
                        </span>
                    </div>
                    <div className="rounded-xl border border-white/8 bg-black/10 px-3 py-2">
                        <span className="block text-[10px] uppercase tracking-[0.16em] text-white/40">Snapshot size</span>
                        <span className="mt-1 block font-medium text-white/80">{formatBytes(liveDebug.snapshotByteSize)}</span>
                    </div>
                    <div className="rounded-xl border border-white/8 bg-black/10 px-3 py-2">
                        <span className="block text-[10px] uppercase tracking-[0.16em] text-white/40">Header blob</span>
                        <span className="mt-1 block font-medium text-white/80">
                            {liveDebug.headerIncluded ? "Prepended" : "Unavailable"}
                        </span>
                    </div>
                </div>

                <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,0.8fr)]">
                    <div className="rounded-xl border border-white/8 bg-black/10 px-3 py-3">
                        <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-[0.16em] text-white/40">
                            <span>Chunk window</span>
                            <span>
                                {liveDebug.snapshotWindowChunkCount > 0
                                    ? `tail ${liveDebug.snapshotWindowStartIndex + 1}-${liveDebug.snapshotWindowStartIndex + liveDebug.snapshotWindowChunkCount}`
                                    : "waiting"}
                            </span>
                        </div>
                        <div className="flex gap-1">
                            {debugSegments.map((segment) => (
                                <span
                                    key={segment.index}
                                    className={`h-3 flex-1 rounded-full ${
                                        segment.containsFirstChunk
                                            ? "bg-amber-300"
                                            : segment.active
                                                ? "bg-accent/80"
                                                : "bg-white/10"
                                    }`}
                                />
                            ))}
                        </div>
                        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] uppercase tracking-[0.16em] text-white/35">
                            <span>Amber = first chunk retained</span>
                            <span>Accent = active live window</span>
                        </div>
                    </div>

                    <div className="rounded-xl border border-white/8 bg-black/10 px-3 py-3">
                        <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-[0.16em] text-white/40">
                            <span>Latest ASR hypothesis</span>
                            <span>{liveDebug.inFlight ? "Request in flight" : "Idle"}</span>
                        </div>
                        <p className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-6 text-white/75">
                            {lastServerTextPreview}
                        </p>
                    </div>
                </div>
            </div>
        </details>
    );
}
