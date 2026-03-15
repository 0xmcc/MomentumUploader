import { motion } from "framer-motion";
import type { LiveShareState } from "@/hooks/useLiveTranscription";
import ShareButton from "@/components/audio-recorder/ShareButton";
import StatusDot from "@/components/StatusDot";

type RecorderHeaderProps = {
    isRecording: boolean;
    isUploadActive: boolean;
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
                <div className="flex items-center gap-2">
                    <h2 className="text-xl font-semibold text-white/90">
                        {isRecording ? "Listening..." : "New Recording"}
                    </h2>
                    {isUploadActive && (
                        <StatusDot tone="processing" label="Upload in progress" />
                    )}
                </div>
                <p className="text-white/40 text-[10px] font-mono tracking-widest mt-1 uppercase">
                    {isRecording ? formatTime(recordingTime) : "Ready to record"}
                </p>
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
        </div>
    );
}
