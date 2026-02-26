import type { Metadata } from "next";
import PortfolioShowcase from "./PortfolioShowcase";

export const metadata: Metadata = {
  title: "Sonic Memos | Portfolio Showcase",
  description:
    "A flashy case-study page highlighting Sonic Memos, an open-source AI voice memo platform built with Next.js, Supabase, Clerk, NVIDIA Parakeet, and ElevenLabs.",
};

export default function PortfolioPage() {
  return <PortfolioShowcase />;
}
