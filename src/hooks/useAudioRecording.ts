import {
    useEffect,
    useRef,
    useState,
    type Dispatch,
    type MutableRefObject,
    type SetStateAction,
} from "react";
import { DEFAULT_PENDING_MIME_TYPE } from "@/lib/audio-upload";
import type { AudioInputPayload } from "@/components/AudioRecorder";

const RECORDER_TIMESLICE_MS = 1000;

type UseAudioRecordingOptions = {
    onFirstChunk?: () => void;
    onRecordingStarted?: () => void;
    onRecordingStopped: (payload: AudioInputPayload) => void;
};

type UseAudioRecordingResult = {
    isRecording: boolean;
    recordingTime: number;
    recordingTimeRef: MutableRefObject<number>;
    micError: string | null;
    setMicError: Dispatch<SetStateAction<string | null>>;
    audioChunksRef: MutableRefObject<Blob[]>;
    mimeTypeRef: MutableRefObject<string>;
    // Header-only WebM blob captured before any audio data arrives (via requestData() in
    // onstart). Used by useLiveTranscription to build overflow snapshots without re-including
    // the first second of audio (which would create a gap and duplicate the opening phrase).
    // Null until the first ondataavailable fires after the onstart requestData() call.
    webmHeaderRef: MutableRefObject<Blob | null>;
    startRecording: () => Promise<boolean>;
    stopRecording: () => void;
    resetRecording: () => void;
};

export function useAudioRecording({
    onFirstChunk,
    onRecordingStarted,
    onRecordingStopped,
}: UseAudioRecordingOptions): UseAudioRecordingResult {
    const [isRecording, setIsRecording] = useState(false);
    const [recordingTime, setRecordingTime] = useState(0);
    const [micError, setMicError] = useState<string | null>(null);

    const mediaRecorderRef = useRef<MediaRecorder | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const mimeTypeRef = useRef(DEFAULT_PENDING_MIME_TYPE);
    const webmHeaderRef = useRef<Blob | null>(null);
    const headerCapturedRef = useRef(false);
    const timerRef = useRef<NodeJS.Timeout | null>(null);
    const recordingTimeRef = useRef(0);

    useEffect(() => {
        recordingTimeRef.current = recordingTime;
    }, [recordingTime]);

    useEffect(() => () => {
        if (timerRef.current) clearInterval(timerRef.current);
    }, []);

    const startRecording = async () => {
        setMicError(null);

        if (!navigator.mediaDevices?.getUserMedia) {
            const secureContext = window.isSecureContext;
            setMicError(
                secureContext
                    ? "Microphone access is not available in this browser."
                    : "Microphone access requires HTTPS (or localhost). Open this page over a secure origin and try again."
            );
            console.warn("Mic unavailable: navigator.mediaDevices.getUserMedia is unavailable", {
                isSecureContext: secureContext,
                origin: window.location.origin,
            });
            return false;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    sampleRate: { ideal: 48000 },
                    sampleSize: { ideal: 16 },
                    channelCount: { ideal: 1 },
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false,
                },
            });

            const mimeType = [
                "audio/webm;codecs=opus",
                "audio/webm",
                "audio/ogg;codecs=opus",
            ].find((t) => MediaRecorder.isTypeSupported(t)) ?? "";

            mimeTypeRef.current = mimeType || DEFAULT_PENDING_MIME_TYPE;

            const recorder = new MediaRecorder(stream, {
                ...(mimeType ? { mimeType } : {}),
                audioBitsPerSecond: 128_000,
            });

            mediaRecorderRef.current = recorder;
            audioChunksRef.current = [];
            webmHeaderRef.current = null;
            headerCapturedRef.current = false;

            // Capture a header-only WebM blob before any audio data arrives.
            // requestData() in onstart fires ondataavailable with just the EBML/init
            // segment (no audio clusters). This lets useLiveTranscription build overflow
            // snapshots as [headerBlob, ...lastNChunks] instead of
            // [chunks[0], ...lastNChunks] — eliminating the audio gap that caused
            // the opening phrase to be re-transcribed and duplicated.
            recorder.onstart = () => {
                recorder.requestData();
            };

            recorder.ondataavailable = (event) => {
                if (event.data.size <= 0) return;
                if (!headerCapturedRef.current) {
                    // First blob from the requestData() call in onstart: headers only.
                    webmHeaderRef.current = event.data;
                    headerCapturedRef.current = true;
                    return; // Don't include header blob in audio chunks
                }
                audioChunksRef.current.push(event.data);
                if (audioChunksRef.current.length === 1) {
                    onFirstChunk?.();
                }
            };

            recorder.onstop = () => {
                // Prepend the header blob so the final upload is a complete, decodable file.
                const allChunks = webmHeaderRef.current
                    ? [webmHeaderRef.current, ...audioChunksRef.current]
                    : audioChunksRef.current;
                const blob = new Blob(allChunks, { type: mimeTypeRef.current });
                stream.getTracks().forEach((track) => track.stop());
                onRecordingStopped({
                    blob,
                    durationSeconds: recordingTimeRef.current,
                    mimeType: mimeTypeRef.current,
                });
            };

            recorder.start(RECORDER_TIMESLICE_MS);
            setIsRecording(true);
            setRecordingTime(0);
            timerRef.current = setInterval(() => {
                setRecordingTime((previous) => previous + 1);
            }, 1000);
            onRecordingStarted?.();
            return true;
        } catch (error) {
            console.error("Mic error:", error);
            if (error instanceof DOMException && error.name === "NotAllowedError") {
                setMicError("Microphone permission was denied. Please allow access and try again.");
            } else {
                setMicError("Unable to access microphone. Check your browser settings and try again.");
            }
            return false;
        }
    };

    const stopRecording = () => {
        if (!mediaRecorderRef.current || !isRecording) return;
        if (timerRef.current) clearInterval(timerRef.current);
        mediaRecorderRef.current.stop();
        setIsRecording(false);
    };

    const resetRecording = () => {
        setRecordingTime(0);
    };

    return {
        isRecording,
        recordingTime,
        recordingTimeRef,
        micError,
        setMicError,
        audioChunksRef,
        mimeTypeRef,
        webmHeaderRef,
        startRecording,
        stopRecording,
        resetRecording,
    };
}
