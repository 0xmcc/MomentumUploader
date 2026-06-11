import type { Metadata } from "next";
import SalesDocsWorkspace from "@/components/sales-docs/SalesDocsWorkspace";
import { mockSessions, staticRecentSessions } from "@/data/mockSalesDoc";

export const metadata: Metadata = {
  title: "Sales Docs — Call Prep Workspace",
  description:
    "AI call prep workspace: tailored briefs, Belief Ladder discovery, pitch scripts, and live coaching.",
};

export default function SalesDocsPage() {
  return (
    <main className="fixed inset-0 z-50 h-dvh w-screen bg-[#09090c]">
      <SalesDocsWorkspace
        sessions={mockSessions}
        staticSessions={staticRecentSessions}
      />
    </main>
  );
}
