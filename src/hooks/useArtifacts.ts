"use client";

import { useEffect, useState } from "react";
import type { ArtifactMap } from "@/lib/artifact-types";

export function useArtifacts(memoId: string | null, isRecording: boolean) {
    const [artifacts, setArtifacts] = useState<ArtifactMap | null>(null);

    useEffect(() => {
        if (!memoId || !isRecording) {
            return;
        }

        let cancelled = false;

        const load = async () => {
            try {
                const response = await fetch(`/api/memos/${memoId}/artifacts?source=live`);
                if (!response.ok) {
                    throw new Error(`Artifacts request failed with ${response.status}`);
                }

                const nextArtifacts = (await response.json()) as ArtifactMap;
                if (!cancelled) {
                    setArtifacts(nextArtifacts);
                }
            } catch (error) {
                console.error("[useArtifacts] polling failed", {
                    memoId,
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        };

        void load();
        const intervalId = window.setInterval(() => {
            void load();
        }, 5000);

        return () => {
            cancelled = true;
            window.clearInterval(intervalId);
        };
    }, [isRecording, memoId]);

    return artifacts;
}
