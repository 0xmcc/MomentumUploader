import { Square } from "lucide-react";
import { motion } from "framer-motion";
import type { ChangeEvent, MutableRefObject } from "react";
import { MANUAL_UPLOAD_ACCEPT } from "@/lib/audio-upload";

type RecorderControlsProps = {
    isRecording: boolean;
    isUploadActive: boolean;
    playbackTheme: string;
    fileInputRef: MutableRefObject<HTMLInputElement | null>;
    onToggleRecording: () => void;
    onManualFileSelect: (event: ChangeEvent<HTMLInputElement>) => void;
};

export default function RecorderControls({
    isRecording,
    isUploadActive,
    playbackTheme,
    fileInputRef,
    onToggleRecording,
    onManualFileSelect,
}: RecorderControlsProps) {
    return (
        <div className="bg-[#161616] border-t border-white/10 px-8 py-10 shadow-[0_-10px_40px_rgba(0,0,0,0.5)] z-10 transition-all duration-500">
            <div className="max-w-3xl mx-auto flex flex-col items-center justify-center gap-10">
                <div className="relative flex items-center justify-center w-28 h-28">
                    <button
                        onClick={onToggleRecording}
                        aria-label={isRecording ? "Stop recording" : "Start recording"}
                        disabled={isUploadActive}
                        className={`group relative flex items-center justify-center w-full h-full rounded-full transition-all duration-500 ${(isRecording || isUploadActive) ? "scale-110" : "hover:scale-105 active:scale-95"} ${isUploadActive ? "opacity-50 cursor-not-allowed" : ""}`}
                    >
                        <div className={`absolute inset-0 rounded-full blur-2xl transition-all duration-700 ${isRecording
                            ? "bg-red-500/40 animate-pulse"
                            : (playbackTheme === "accent" ? "bg-accent/20 group-hover:bg-accent/30" : "bg-white/5 group-hover:bg-white/10")
                            }`} />
                        <div className="absolute inset-0 rounded-full bg-[#121212] border border-white/5 shadow-2xl" />
                        <div className={`absolute inset-2 rounded-full border border-white/5 transition-colors duration-500 ${isRecording ? "bg-red-500/10 border-red-500/20" : "bg-white/[0.02]"
                            }`} />
                        <div className={`absolute inset-5 rounded-full border transition-all duration-500 ${isRecording
                            ? "border-red-500/40 bg-red-500/20"
                            : (playbackTheme === "accent" ? "border-accent/20 bg-accent/10" : "border-white/10 bg-white/5")
                            }`} />
                        <div className={`absolute inset-[24%] rounded-full flex items-center justify-center shadow-2xl transition-all duration-500 ${isRecording
                            ? "bg-red-500 text-white shadow-red-500/40"
                            : (playbackTheme === "accent" ? "bg-white text-black group-hover:bg-accent group-hover:text-white" : "bg-white/10 text-white group-hover:bg-white group-hover:text-black")
                            }`}>
                            {isRecording ? (
                                <Square fill="currentColor" size={28} className="animate-in zoom-in duration-300" />
                            ) : (
                                <div className="w-6 h-6 rounded-full bg-red-600 transition-transform group-hover:scale-110" />
                            )}
                        </div>
                    </button>
                </div>
                <input
                    ref={fileInputRef}
                    data-testid="manual-audio-upload"
                    type="file"
                    accept={MANUAL_UPLOAD_ACCEPT}
                    className="hidden"
                    onChange={onManualFileSelect}
                />
                <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isRecording || isUploadActive}
                    className="rounded-lg border border-white/20 px-4 py-2 text-xs font-mono uppercase tracking-widest text-white/70 transition-colors hover:border-white/35 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                    Upload MP3/M4A
                </button>
            </div>
        </div>
    );
}
