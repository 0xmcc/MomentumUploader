import { useEffect, useRef, useState, type MutableRefObject } from "react";
import { copyToClipboard } from "@/lib/memo-ui";
import {
    getLiveShareLabel as describeLiveShareLabel,
    type LiveShareState,
} from "./useLiveTranscription.shared";

type UseLiveTranscriptionShareOptions = {
    onUnauthorizedRef: MutableRefObject<(() => void) | null>;
};

export function useLiveTranscriptionShare({
    onUnauthorizedRef,
}: UseLiveTranscriptionShareOptions) {
    const [liveMemoId, setLiveMemoId] = useState<string | null>(null);
    const [liveShareUrl, setLiveShareUrl] = useState<string | null>(null);
    const [liveShareState, setLiveShareState] = useState<LiveShareState>("idle");

    const liveMemoIdRef = useRef<string | null>(null);
    const liveShareResetTimerRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        liveMemoIdRef.current = liveMemoId;
    }, [liveMemoId]);

    useEffect(() => () => {
        if (liveShareResetTimerRef.current) {
            clearTimeout(liveShareResetTimerRef.current);
        }
    }, []);

    const clearLiveShareResetTimer = () => {
        if (liveShareResetTimerRef.current) {
            clearTimeout(liveShareResetTimerRef.current);
            liveShareResetTimerRef.current = null;
        }
    };

    const requestLiveShareUrl = async (memoId: string): Promise<string> => {
        const response = await fetch(`/api/memos/${memoId}/share`, {
            method: "POST",
        });
        const json = await response.json().catch(() => null);
        const nextShareUrl =
            typeof json?.shareUrl === "string" ? json.shareUrl : null;

        if (!response.ok || !nextShareUrl) {
            throw new Error("Unable to create live share link.");
        }

        return nextShareUrl;
    };

    const resetLiveShareSession = () => {
        clearLiveShareResetTimer();
        setLiveMemoId(null);
        setLiveShareUrl(null);
        setLiveShareState("idle");
        liveMemoIdRef.current = null;
    };

    const startLiveShareSession = async () => {
        setLiveShareState("loading");

        try {
            const liveMemoResponse = await fetch("/api/memos/live", { method: "POST" });
            if (liveMemoResponse.status === 401) {
                resetLiveShareSession();
                return;
            }

            const liveMemoJson = await liveMemoResponse.json().catch(() => null);
            const memoId =
                typeof liveMemoJson?.memoId === "string"
                    ? liveMemoJson.memoId
                    : null;

            if (!liveMemoResponse.ok || !memoId) {
                throw new Error("Unable to initialize live memo.");
            }

            setLiveMemoId(memoId);
            const nextShareUrl = await requestLiveShareUrl(memoId);
            setLiveShareUrl(nextShareUrl);
            setLiveShareState("ready");
        } catch (error) {
            console.error("[live-share]", error);
            setLiveShareState("error");
        }
    };

    const handleCopyLiveShare = async () => {
        clearLiveShareResetTimer();

        try {
            let nextUrl = liveShareUrl;
            if (!nextUrl) {
                const memoId = liveMemoIdRef.current;
                if (!memoId) return;
                setLiveShareState("loading");
                nextUrl = await requestLiveShareUrl(memoId);
                setLiveShareUrl(nextUrl);
            }

            const copied = await copyToClipboard(nextUrl);
            if (!copied) {
                setLiveShareState("error");
                return;
            }

            setLiveShareState("copied");
            liveShareResetTimerRef.current = setTimeout(() => {
                setLiveShareState("ready");
                liveShareResetTimerRef.current = null;
            }, 3000);
        } catch (error) {
            console.error("[live-share-copy]", error);
            setLiveShareState("error");
        }
    };

    const getLiveShareLabel = () => describeLiveShareLabel(liveShareState);

    return {
        liveMemoId,
        liveMemoIdRef,
        liveShareUrl,
        liveShareState,
        resetLiveShareSession,
        startLiveShareSession,
        handleCopyLiveShare,
        getLiveShareLabel,
    };
}
