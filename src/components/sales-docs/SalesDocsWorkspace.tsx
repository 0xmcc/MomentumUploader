"use client";

import { useEffect, useRef, useState } from "react";
import { MessageCircle } from "lucide-react";
import "./sales-docs.css";
import type { SalesSession } from "@/data/salesDocTypes";
import ArtifactDocument from "./ArtifactDocument";
import ChatPanel from "./ChatPanel";
import GeneratingDocument from "./GeneratingDocument";
import LiveCoachingPanel from "./LiveCoachingPanel";
import Sidebar from "./Sidebar";
import WorkspaceTopBar from "./WorkspaceTopBar";

export const PENDING_SESSION_ID = "__generating__";

/**
 * Full Sales Docs app shell. Entirely data-driven: the document, chat, and
 * coaching rail all render from the active SalesSession. The composer calls
 * the generation endpoint and prepends the returned session.
 *
 * `animated` is off when embedded as a scaled-down landing-page mockup
 * (which also leaves the composer inert — the mockup is aria-hidden).
 *
 * `initialPrompt` seeds a brand-new session from the landing page form:
 * generation fires immediately and the chat shows only that prompt (no prior
 * session transcript) until the generated session arrives.
 */
export default function SalesDocsWorkspace({
  sessions: initialSessions,
  staticSessions = [],
  animated = true,
  initialPrompt,
}: {
  sessions: SalesSession[];
  staticSessions?: Array<{ label: string; lastActive: string }>;
  animated?: boolean;
  initialPrompt?: string;
}) {
  const [sessions, setSessions] = useState(initialSessions);
  const [activeSessionId, setActiveSessionId] = useState(initialSessions[0].id);
  const [pendingPrompt, setPendingPrompt] = useState<string | null>(null);
  const [isCanvasPending, setCanvasPending] = useState(false);
  const [generationError, setGenerationError] = useState<string | null>(null);
  const [isSeeding, setIsSeeding] = useState(false);
  const [isSidebarDrawerOpen, setSidebarDrawerOpen] = useState(false);
  const [isLiveDrawerOpen, setLiveDrawerOpen] = useState(false);
  const [isChatDrawerOpen, setChatDrawerOpen] = useState(false);
  const seedFiredRef = useRef(false);

  const session =
    sessions.find((s) => s.id === activeSessionId) ?? sessions[0];

  const sidebarSessions = [
    ...(pendingPrompt
      ? [{ id: PENDING_SESSION_ID, label: "New session", lastActive: "Generating…" }]
      : []),
    ...sessions.map((s) => ({ id: s.id as string | null, label: s.sidebarLabel, lastActive: s.lastActive })),
    ...staticSessions.map((s) => ({ id: null, label: s.label, lastActive: s.lastActive })),
  ];

  function handleSelectSession(id: string) {
    if (id === PENDING_SESSION_ID) {
      if (pendingPrompt) setCanvasPending(true);
      setSidebarDrawerOpen(false);
      return;
    }

    setCanvasPending(false);
    setActiveSessionId(id);
    setSidebarDrawerOpen(false);
  }

  async function handleGenerate(prompt: string) {
    if (pendingPrompt) return;
    setPendingPrompt(prompt);
    setCanvasPending(true);
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
      setCanvasPending(false);
      setPendingPrompt(null);
    }
  }

  // Seed a new session from the landing page prompt (?prompt=...). Fires
  // once; the URL is cleaned so a refresh doesn't re-generate.
  useEffect(() => {
    const seed = initialPrompt?.trim();
    if (!seed || seedFiredRef.current) return;
    seedFiredRef.current = true;
    window.history.replaceState(null, "", window.location.pathname);
    setIsSeeding(true);
    void handleGenerate(seed).finally(() => setIsSeeding(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPrompt]);

  function renderSidebar() {
    return (
      <Sidebar
        sessions={sidebarSessions}
        activeSessionId={isCanvasPending ? PENDING_SESSION_ID : session.id}
        onSelectSession={handleSelectSession}
      />
    );
  }

  function renderChatPanel() {
    return (
      <ChatPanel
        key={`chat-${session.id}`}
        prompt={session.doc.sourceInputs.prompt}
        chat={session.chat}
        onGenerate={animated ? handleGenerate : undefined}
        pendingPrompt={pendingPrompt}
        error={generationError}
        showSessionChat={!isSeeding}
      />
    );
  }

  function renderLiveCoachingPanel() {
    return (
      <LiveCoachingPanel
        liveCoaching={session.doc.liveCoaching}
        animated={animated}
        pending={isCanvasPending}
      />
    );
  }

  return (
    <div className="sd-root relative flex h-full w-full overflow-hidden text-[var(--sd-text)]">
      <div data-testid="sales-docs-sidebar-rail" className="hidden lg:contents">
        {renderSidebar()}
      </div>
      <div data-testid="sales-docs-chat-rail" className="hidden md:contents">
        {renderChatPanel()}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <WorkspaceTopBar
          liveCoaching={session.doc.liveCoaching}
          animated={animated}
          onOpenSidebar={() => setSidebarDrawerOpen(true)}
          onOpenLiveCoaching={() => setLiveDrawerOpen(true)}
        />
        <div className="flex min-h-0 flex-1">
          {/* key forces a remount so document scroll resets per session */}
          {isCanvasPending ? (
            <GeneratingDocument animated={animated} />
          ) : (
            <ArtifactDocument key={`doc-${session.id}`} doc={session.doc} />
          )}
          <div data-testid="sales-docs-live-rail" className="hidden xl:contents">
            {renderLiveCoachingPanel()}
          </div>
        </div>
      </div>

      {isSidebarDrawerOpen && (
        <div className="absolute inset-0 z-40 lg:hidden">
          <button
            aria-label="Close navigation"
            className="absolute inset-0 bg-black/60"
            onClick={() => setSidebarDrawerOpen(false)}
            type="button"
          />
          <div
            data-testid="sales-docs-sidebar-drawer"
            className="absolute inset-y-0 left-0 h-full lg:hidden"
          >
            {renderSidebar()}
          </div>
        </div>
      )}

      {isLiveDrawerOpen && (
        <div className="absolute inset-0 z-40 xl:hidden">
          <button
            aria-label="Close live coaching"
            className="absolute inset-0 bg-black/60"
            onClick={() => setLiveDrawerOpen(false)}
            type="button"
          />
          <div
            data-testid="sales-docs-live-drawer"
            className="absolute inset-y-0 right-0 h-full max-w-[calc(100%-2rem)] xl:hidden"
          >
            {renderLiveCoachingPanel()}
          </div>
        </div>
      )}

      {isChatDrawerOpen && (
        <div className="absolute inset-0 z-50 md:hidden">
          <button
            aria-label="Close assistant"
            className="absolute inset-0 bg-black/60"
            onClick={() => setChatDrawerOpen(false)}
            type="button"
          />
          <div
            data-testid="sales-docs-chat-drawer"
            className="absolute inset-x-0 bottom-0 top-14 overflow-hidden rounded-t-2xl border-t border-[var(--sd-border-strong)] bg-[var(--sd-bg)] md:hidden [&>div]:w-full [&>div]:border-r-0"
          >
            {renderChatPanel()}
          </div>
        </div>
      )}

      {!isChatDrawerOpen && (
        <button
          aria-label="Open assistant"
          className="sd-gradient-btn absolute bottom-4 right-4 z-30 flex items-center gap-2 rounded-full px-4 py-3 text-[13px] font-medium shadow-2xl md:hidden"
          onClick={() => setChatDrawerOpen(true)}
          type="button"
        >
          <MessageCircle size={15} strokeWidth={2.2} />
          Assistant
        </button>
      )}
    </div>
  );
}
