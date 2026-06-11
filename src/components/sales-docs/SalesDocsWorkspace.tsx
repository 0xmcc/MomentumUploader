"use client";

import { useState } from "react";
import "./sales-docs.css";
import type { SalesSession } from "@/data/salesDocTypes";
import ArtifactDocument from "./ArtifactDocument";
import ChatPanel from "./ChatPanel";
import LiveCoachingPanel from "./LiveCoachingPanel";
import Sidebar from "./Sidebar";
import WorkspaceTopBar from "./WorkspaceTopBar";

/**
 * Full Sales Docs app shell. Entirely data-driven: the document, chat, and
 * coaching rail all render from the active SalesSession. The composer calls
 * the generation endpoint and prepends the returned session.
 *
 * `animated` is off when embedded as a scaled-down landing-page mockup
 * (which also leaves the composer inert — the mockup is aria-hidden).
 */
export default function SalesDocsWorkspace({
  sessions: initialSessions,
  staticSessions = [],
  animated = true,
}: {
  sessions: SalesSession[];
  staticSessions?: Array<{ label: string; lastActive: string }>;
  animated?: boolean;
}) {
  const [sessions, setSessions] = useState(initialSessions);
  const [activeSessionId, setActiveSessionId] = useState(initialSessions[0].id);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [generationError, setGenerationError] = useState<string | null>(null);

  const session =
    sessions.find((s) => s.id === activeSessionId) ?? sessions[0];

  const sidebarSessions = [
    ...sessions.map((s) => ({ id: s.id as string | null, label: s.sidebarLabel, lastActive: s.lastActive })),
    ...staticSessions.map((s) => ({ id: null, label: s.label, lastActive: s.lastActive })),
  ];

  async function handleGenerate(prompt: string) {
    if (pendingPrompt) return;
    setPendingPrompt(prompt);
    setGenerationError(null);

    try {
      const res = await fetch("/api/sales-docs/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      const data = (await res.json().catch(() => null)) as
        | { session?: SalesSession; error?: string }
        | null;

      if (!res.ok || !data?.session) {
        throw new Error(data?.error ?? `Generation failed (${res.status}).`);
      }

      const generated = data.session;
      setSessions((prev) => [generated, ...prev]);
      setActiveSessionId(generated.id);
    } catch (error) {
      setGenerationError(
        error instanceof Error ? error.message : "Generation failed. Try again."
      );
    } finally {
      setPendingPrompt(null);
    }
  }

  return (
    <div className="sd-root flex h-full w-full overflow-hidden text-[var(--sd-text)]">
      <Sidebar
        sessions={sidebarSessions}
        activeSessionId={session.id}
        onSelectSession={setActiveSessionId}
      />
      <ChatPanel
        key={`chat-${session.id}`}
        prompt={session.doc.sourceInputs.prompt}
        chat={session.chat}
        onGenerate={animated ? handleGenerate : undefined}
        pendingPrompt={pendingPrompt}
        error={generationError}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <WorkspaceTopBar liveCoaching={session.doc.liveCoaching} animated={animated} />
        <div className="flex min-h-0 flex-1">
          {/* key forces a remount so document scroll resets per session */}
          <ArtifactDocument key={`doc-${session.id}`} doc={session.doc} />
          <LiveCoachingPanel
            liveCoaching={session.doc.liveCoaching}
            animated={animated}
          />
        </div>
      </div>
    </div>
  );
}
