import { Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import type { LiveShareState } from "@/hooks/useLiveTranscription";
import ShareButton from "@/components/audio-recorder/ShareButton";

type RecorderHeaderProps = {
    isRecording: boolean;
    isUploadActive: boolean;
    uploadProgressPercent: number;
    recordingTime: number;
    shouldShowLiveShare: boolean;
    liveShareState: LiveShareState;
    liveShareUrl: string | null;
    liveShareLabel: string;
    onCopyLiveShare: () => void;
};

function formatTime(seconds: number) {
    const minutes = Math.floor(seconds / 60);
    return `${minutes.toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}

export default function RecorderHeader({
    isRecording,
    isUploadActive,
    uploadProgressPercent,
    recordingTime,
    shouldShowLiveShare,
    liveShareState,
    liveShareUrl,
    liveShareLabel,
    onCopyLiveShare,
}: RecorderHeaderProps) {
    return (
        <div className="flex justify-between items-center pl-8 pr-40 py-6 border-b border-white/5 bg-[#121212]/50 backdrop-blur-md z-10">
            <div className="flex flex-col">
                <h2 className="text-xl font-semibold text-white/90">
                    {isRecording ? "Listening..." : (isUploadActive ? "Saving..." : "New Recording")}
                </h2>
                <p className="text-white/40 text-[10px] font-mono tracking-widest mt-1 uppercase">
                    {isRecording
                        ? formatTime(recordingTime)
                        : isUploadActive
                            ? uploadProgressPercent >= 100
                                ? "Upload complete. Transcribing with NVIDIA..."
                                : `Uploading file... ${uploadProgressPercent}%`
                            : "Ready to record"}
                </p>
                {isUploadActive && (
                    <div
                        role="progressbar"
                        aria-label="Upload in progress"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={uploadProgressPercent}
                        className="mt-2 h-1 w-48 overflow-hidden rounded-full bg-white/10"
                    >
                        <div
                            className="h-full bg-accent/80 transition-[width] duration-300"
                            style={{ width: `${uploadProgressPercent}%` }}
                        />
                    </div>
                )}
                {shouldShowLiveShare && (
                    <ShareButton
                        liveShareState={liveShareState}
                        liveShareUrl={liveShareUrl}
                        label={liveShareLabel}
                        onCopy={onCopyLiveShare}
                    />
                )}
            </div>
            {isRecording && (
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1 h-4">
                        {Array.from({ length: 8 }).map((_, index) => (
                            <motion.div
                                key={index}
                                className="w-0.5 rounded-full bg-red-500/50"
                                animate={{ height: ["4px", `${Math.random() * 12 + 4}px`, "4px"] }}
                                transition={{ duration: 0.5, repeat: Infinity, delay: index * 0.05 }}
                            />
                        ))}
                    </div>
                </div>
            )}
            {isUploadActive && (
                <div className="flex items-center gap-2">
                    <Loader2 size={14} className="animate-spin text-accent" />
                    <span className="text-[10px] text-accent/80 font-mono uppercase tracking-tight">
                        {uploadProgressPercent >= 100
                            ? "Processing"
                            : `${uploadProgressPercent}% uploaded`}
                    </span>
                </div>
            )}
        </div>
    );
}
