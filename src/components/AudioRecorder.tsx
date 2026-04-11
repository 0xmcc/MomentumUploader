"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useTheme } from "./ThemeProvider";
import {
    getFileExtensionFromMime,
    resolveUploadMimeType,
    uploadManualAudioBySignedUrl,
} from "@/lib/audio-upload";
import { SHOW_ARTIFACTS_IN_UI } from "@/lib/feature-flags";
import { useAudioRecording } from "@/hooks/useAudioRecording";
import { useArtifacts } from "@/hooks/useArtifacts";
import { useChunkUpload } from "@/hooks/useChunkUpload";
import { useLiveTranscription } from "@/hooks/useLiveTranscription";
import LiveTranscriptView from "@/components/audio-recorder/LiveTranscriptView";
import OutlinePanel from "@/components/OutlinePanel";
import RecorderHeader from "@/components/audio-recorder/RecorderHeader";
import RecorderControls from "@/components/audio-recorder/RecorderControls";

export type UploadCompletePayload = {
    id?: string;
    success?: boolean;
    text?: string;
    url?: string;
    modelUsed?: string;
    durationSeconds?: number;
    transcriptStatus?: "processing" | "complete" | "failed";
};

export type AudioInputPayload = {
    blob: Blob;
    durationSeconds: number;
    mimeType: string;
    memoId?: string;
    provisionalTranscript?: string;
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
    const chunkPruneOffsetRef = useRef(0);
    const liveMemoIdRef = useRef<string | null>(null);
    const { playbackTheme } = useTheme();
    const isUploadActive = isUploading || isUploadInProgress;
    const chunkUploadEnabled = !onAudioInput;

    const recording = useAudioRecording({
        onRecordingStarted: handleRecordingStarted,
        onFirstChunk: handleFirstChunk,
        onRecordingStopped: handleRecordingStopped,
    });

    const liveTranscription = useLiveTranscription({
        audioChunksRef: recording.audioChunksRef,
        mimeTypeRef: recording.mimeTypeRef,
        webmHeaderRef: recording.webmHeaderRef,
        chunkPruneOffsetRef,
    });

    const chunkUpload = useChunkUpload({
        audioChunksRef: recording.audioChunksRef,
        webmHeaderRef: recording.webmHeaderRef,
        mimeTypeRef: recording.mimeTypeRef,
        memoId: liveTranscription.liveMemoId,
        enabled: chunkUploadEnabled,
        chunkPruneOffsetRef,
    });
    const artifacts = useArtifacts(liveTranscription.liveMemoId, recording.isRecording);

    useEffect(() => {
        liveMemoIdRef.current = liveTranscription.liveMemoId;
    }, [liveTranscription.liveMemoId]);

    function handleRecordingStarted() {
        chunkUpload.resetChunkUpload();
        liveTranscription.beginRecordingSession();
    }

    function handleFirstChunk() {
        liveTranscription.runLiveTick();
    }

    async function handleRecordingStopped({
        blob,
        durationSeconds,
        mimeType,
    }: AudioInputPayload) {
        const memoId = liveMemoIdRef.current;
        const provisionalTranscript = (await liveTranscription.runFinalTailTick()) || undefined;
        if (onAudioInput) {
            onAudioInput({
                blob,
                durationSeconds,
                mimeType,
                memoId: memoId ?? undefined,
                provisionalTranscript,
            });
            return;
        }

        if (!memoId) {
            void handleUpload(blob, mimeType, undefined, null, provisionalTranscript);
            return;
        }

        onUploadComplete?.({
            id: memoId,
            text: provisionalTranscript ?? "",
            transcriptStatus: "processing",
            durationSeconds,
        });
        void handleFinalize(memoId, durationSeconds, provisionalTranscript);
    }

    useEffect(() => {
        if (!isUploadActive && !recording.isRecording) return;
        const handler = (e: BeforeUnloadEvent) => {
            e.preventDefault();
            e.returnValue = "";
        };
        window.addEventListener("beforeunload", handler);
        return () => window.removeEventListener("beforeunload", handler);
    }, [isUploadActive, recording.isRecording]);

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
        memoId?: string | null,
        provisionalTranscript?: string,
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
            if (provisionalTranscript) {
                formData.append("provisionalTranscript", provisionalTranscript);
            }
            const response = await fetch("/api/transcribe", { method: "POST", body: formData });
            if (!response.ok) throw new Error("Upload failed");
            const data = (await response.json()) as Omit<UploadCompletePayload, "durationSeconds">;
            recording.resetRecording();
            liveTranscription.resetLiveSession();
            chunkUpload.resetChunkUpload();
            onUploadComplete?.({ ...data, durationSeconds: recording.recordingTimeRef.current });
        } catch (error) {
            console.error("Upload error:", error);
        } finally {
            setIsUploading(false);
        }
    };

    const handleFinalize = async (
        memoId: string,
        durationSeconds: number,
        provisionalTranscript?: string,
    ) => {
        setIsUploading(true);

        try {
            await chunkUpload.flushRemainingChunks();
            const totalChunks =
                recording.audioChunksRef.current.length + chunkUpload.chunkPruneOffsetRef.current;
            const response = await fetch("/api/transcribe/finalize", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    memoId,
                    totalChunks,
                    provisionalTranscript,
                }),
            });

            if (!response.ok) {
                throw new Error("Finalize failed");
            }

            const data = (await response.json()) as Omit<UploadCompletePayload, "durationSeconds">;
            recording.resetRecording();
            liveTranscription.resetLiveSession();
            chunkUpload.resetChunkUpload();
            onUploadComplete?.({ ...data, durationSeconds });
        } catch (error) {
            console.error("Finalize error:", error);
            onUploadComplete?.({
                id: memoId,
                success: false,
                text: provisionalTranscript ?? "",
                transcriptStatus: "failed",
                durationSeconds,
            });
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

        setIsUploading(true);
        void uploadManualAudioBySignedUrl(file, mimeType)
            .then((data) => {
                const payload = data as Omit<UploadCompletePayload, "durationSeconds">;
                onUploadComplete?.({
                    ...payload,
                    durationSeconds: 0,
                });
            })
            .catch((error) => {
                console.error("Upload error:", error);
            })
            .finally(() => {
                setIsUploading(false);
            });
    };

    const shouldShowLiveShare =
        (recording.isRecording || isUploadActive) && liveTranscription.liveShareState !== "idle";

    return (
        <div className="flex flex-col h-full w-full bg-[#121212]">
            <RecorderHeader
                isRecording={recording.isRecording}
                isUploadActive={isUploadActive}
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
            {SHOW_ARTIFACTS_IN_UI && <OutlinePanel artifacts={artifacts} />}

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
