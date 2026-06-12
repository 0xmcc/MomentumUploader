import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
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

function buildSignInTarget(params: { prompt?: string } | undefined): string {
  if (typeof params?.prompt === "string") {
    return `/sales-docs?prompt=${encodeURIComponent(params.prompt)}`;
  }

  return "/sales-docs";
}

export default async function SalesDocsPage({
  searchParams,
}: {
  searchParams?: Promise<{ prompt?: string }>;
} = {}) {
  const params = await searchParams;
  const { userId } = await auth();

  if (!userId) {
    redirect(
      `/sign-in?redirect_url=${encodeURIComponent(buildSignInTarget(params))}`
    );
  }

  const initialPrompt =
    typeof params?.prompt === "string" && params.prompt.trim()
      ? params.prompt
      : undefined;

  let persistedSessions: SalesSession[] = [];
  try {
    persistedSessions = await listSalesDocSessions(userId);
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
        initialPrompt={initialPrompt}
      />
    </main>
  );
}
