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
 * Full Sales Docs app shell. Entirely data-driven: pass a different set of
 * sessions and the whole page (chat, document, coaching rail) re-renders
 * with no component changes.
 *
 * `animated` is off when embedded as a scaled-down landing-page mockup.
 */
export default function SalesDocsWorkspace({
  sessions,
  staticSessions = [],
  animated = true,
}: {
  sessions: SalesSession[];
  staticSessions?: Array<{ label: string; lastActive: string }>;
  animated?: boolean;
}) {
  const [activeSessionId, setActiveSessionId] = useState(sessions[0].id);
  const session =
    sessions.find((s) => s.id === activeSessionId) ?? sessions[0];

  const sidebarSessions = [
    ...sessions.map((s) => ({ id: s.id as string | null, label: s.sidebarLabel, lastActive: s.lastActive })),
    ...staticSessions.map((s) => ({ id: null, label: s.label, lastActive: s.lastActive })),
  ];

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
