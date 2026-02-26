"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { useTheme } from "./ThemeProvider";
import {
    getFileExtensionFromMime,
    resolveUploadMimeType,
} from "@/lib/audio-upload";
import { useAudioRecording } from "@/hooks/useAudioRecording";
import { useLiveTranscription } from "@/hooks/useLiveTranscription";
import LiveTranscriptView from "@/components/audio-recorder/LiveTranscriptView";
import RecorderHeader from "@/components/audio-recorder/RecorderHeader";
import RecorderControls from "@/components/audio-recorder/RecorderControls";

export type UploadCompletePayload = {
    id?: string;
    success?: boolean;
    text?: string;
    url?: string;
    modelUsed?: string;
    durationSeconds?: number;
};

export type AudioInputPayload = {
    blob: Blob;
    durationSeconds: number;
    mimeType: string;
    memoId?: string;
};

export default function AudioRecorder({
    isUploadInProgress = false,
    uploadProgressPercent = 0,
    onUploadComplete,
    onAudioInput,
}: {
    isUploadInProgress?: boolean;
    uploadProgressPercent?: number;
    onUploadComplete?: (data: UploadCompletePayload) => void;
    onAudioInput?: (payload: AudioInputPayload) => void;
}) {
    const [isUploading, setIsUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement | null>(null);
    const { playbackTheme } = useTheme();
    const isUploadActive = isUploading || isUploadInProgress;

    const recording = useAudioRecording({
        onRecordingStarted: handleRecordingStarted,
        onFirstChunk: handleFirstChunk,
        onRecordingStopped: handleRecordingStopped,
    });

    const liveTranscription = useLiveTranscription({
        audioChunksRef: recording.audioChunksRef,
        mimeTypeRef: recording.mimeTypeRef,
        webmHeaderRef: recording.webmHeaderRef,
    });

    function handleRecordingStarted() {
        liveTranscription.beginRecordingSession();
    }

    function handleFirstChunk() {
        liveTranscription.runLiveTick();
    }

    function handleRecordingStopped({
        blob,
        durationSeconds,
        mimeType,
    }: AudioInputPayload) {
        const memoId = liveTranscription.liveMemoId;
        if (onAudioInput) {
            onAudioInput({
                blob,
                durationSeconds,
                mimeType,
                memoId: memoId ?? undefined,
            });
            return;
        }

        void handleUpload(blob, mimeType, undefined, memoId);
    }

    const startRecording = async () => {
        await recording.startRecording();
    };

    const stopRecording = () => {
        if (!recording.isRecording) return;
        liveTranscription.endRecordingSession();
        recording.stopRecording();
    };

    const handleUpload = async (
        blob: Blob,
        mimeType: string = recording.mimeTypeRef.current,
        fileName?: string,
        memoId?: string | null
    ) => {
        if (!blob) return;
        setIsUploading(true);
        try {
            const formData = new FormData();
            const uploadFileName =
                fileName ?? `memo_${Date.now()}.${getFileExtensionFromMime(mimeType)}`;
            formData.append("file", blob, uploadFileName);
            if (memoId) {
                formData.append("memoId", memoId);
            }
            const response = await fetch("/api/transcribe", { method: "POST", body: formData });
            if (!response.ok) throw new Error("Upload failed");
            const data = (await response.json()) as Omit<UploadCompletePayload, "durationSeconds">;
            recording.resetRecording();
            liveTranscription.resetLiveSession();
            onUploadComplete?.({ ...data, durationSeconds: recording.recordingTimeRef.current });
        } catch (error) {
            console.error("Upload error:", error);
        } finally {
            setIsUploading(false);
        }
    };

    const handleManualFileSelect = (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;

        const mimeType = resolveUploadMimeType(file);
        if (!mimeType) {
            recording.setMicError("Only MP3 and M4A files are supported for manual uploads.");
            return;
        }

        recording.setMicError(null);
        if (onAudioInput) {
            onAudioInput({
                blob: file,
                durationSeconds: 0,
                mimeType,
            });
            return;
        }

        void handleUpload(file, mimeType, file.name);
    };

    const shouldShowLiveShare =
        (recording.isRecording || isUploadActive) && liveTranscription.liveShareState !== "idle";

    return (
        <div className="flex flex-col h-full w-full bg-[#121212]">
            <RecorderHeader
                isRecording={recording.isRecording}
                isUploadActive={isUploadActive}
                uploadProgressPercent={uploadProgressPercent}
                recordingTime={recording.recordingTime}
                shouldShowLiveShare={shouldShowLiveShare}
                liveShareState={liveTranscription.liveShareState}
                liveShareUrl={liveTranscription.liveShareUrl}
                liveShareLabel={liveTranscription.getLiveShareLabel()}
                onCopyLiveShare={() => {
                    void liveTranscription.handleCopyLiveShare();
                }}
            />

            <LiveTranscriptView
                isRecording={recording.isRecording}
                isUploadActive={isUploadActive}
                uploadProgressPercent={uploadProgressPercent}
                liveTranscript={liveTranscription.liveTranscript}
                animatedWords={liveTranscription.animatedWords}
                newWordStartIndex={liveTranscription.newWordStartIndex}
                recordingTime={recording.recordingTime}
                micError={recording.micError}
                transcriptScrollRef={liveTranscription.transcriptScrollRef}
            />

            <RecorderControls
                isRecording={recording.isRecording}
                isUploadActive={isUploadActive}
                playbackTheme={playbackTheme}
                fileInputRef={fileInputRef}
                onToggleRecording={() => {
                    if (recording.isRecording) {
                        stopRecording();
                        return;
                    }
                    void startRecording();
                }}
                onManualFileSelect={handleManualFileSelect}
            />
        </div>
    );
}
