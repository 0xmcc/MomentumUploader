import type { Metadata } from "next";
import SalesDocsWorkspace from "@/components/sales-docs/SalesDocsWorkspace";
import { mockSessions, staticRecentSessions } from "@/data/mockSalesDoc";
import type { SalesSession } from "@/data/salesDocTypes";
import { listSalesDocSessions } from "@/lib/sales-doc-sessions";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sales Docs — Call Prep Workspace",
  description:
    "AI call prep workspace: tailored briefs, Belief Ladder discovery, pitch scripts, and live coaching.",
};

export default async function SalesDocsPage() {
  let persistedSessions: SalesSession[] = [];
  try {
    persistedSessions = await listSalesDocSessions();
  } catch (error) {
    console.error(
      "[sales-docs] failed to list persisted sessions; falling back to mocks",
      error
    );
  }
  const hasPersistedSessions = persistedSessions.length > 0;

  return (
    <main className="fixed inset-0 z-50 h-dvh w-screen bg-[#09090c]">
      <SalesDocsWorkspace
        sessions={hasPersistedSessions ? persistedSessions : mockSessions}
        staticSessions={hasPersistedSessions ? [] : staticRecentSessions}
      />
    </main>
  );
}
