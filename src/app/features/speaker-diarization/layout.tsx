import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Speaker Diarization | Sonic Memos",
  description:
    "Speaker diarization automatically labels each voice in your completed recordings. Learn what it does, when it works best, its honest limitations, and what your transcript will look like.",
};

export default function SpeakerDiarizationLayout({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
