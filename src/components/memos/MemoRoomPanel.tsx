"use client";

import {
    Loader2,
    MessageSquareText,
    Send,
    Sparkles,
    Users,
    X,
} from "lucide-react";
import { startTransition, useEffect, useEffectEvent, useRef, useState } from "react";
import type { Memo } from "@/lib/memo-ui";
import { formatDate } from "@/lib/memo-ui";
import type { TranscriptSegment } from "@/lib/transcript";

type RoomParticipant = {
    id: string;
    participantType: "human" | "agent" | "system";
    userId: string | null;
    agentId: string | null;
    role: string;
    capability: string;
    defaultVisibility: "public" | "owner_only" | "restricted" | null;
    status: "active" | "removed";
};

type RoomMessage = {
    id: string;
    memoId: string;
    authorParticipantId: string;
    content: string;
    visibility: "public" | "owner_only" | "restricted";
    restrictedParticipantIds: string[];
    replyToMessageId: string | null;
    rootMessageId: string;
    anchorStartMs: number | null;
    anchorEndMs: number | null;
    anchorSegmentIds: number[];
    createdAt: string;
};

type Agent = {
    id: string;
    ownerUserId: string;
    name: string;
    description: string | null;
    status: "active" | "disabled";
    createdAt: string;
};

type RoomContextPayload = {
    room: {
        id: string;
        title: string;
        description: string | null;
        participants: RoomParticipant[];
    };
    viewerParticipant: RoomParticipant;
};

type MemoRoomPanelProps = {
    memo: Memo;
    selectedAnchorSegments: TranscriptSegment[];
    onClearSelectedAnchors: () => void;
};

async function readJson<T>(res: Response): Promise<T> {
    return (await res.json()) as T;
}

function getTranscriptAnchorPayload(selectedAnchorSegments: TranscriptSegment[]) {
    if (selectedAnchorSegments.length === 0) {
        return {};
    }

    const orderedSegments = [...selectedAnchorSegments].sort(
        (left, right) => left.startMs - right.startMs
    );
    const segmentIds = orderedSegments
        .map((segment) => segment.dbId)
        .filter((value): value is number => typeof value === "number");

    return {
        anchorStartMs: orderedSegments[0].startMs,
        anchorEndMs: orderedSegments[orderedSegments.length - 1].endMs,
        anchorSegmentIds: segmentIds,
    };
}

function getParticipantLabel(participant: RoomParticipant, agents: Agent[]) {
    if (participant.participantType === "agent" && participant.agentId) {
        return agents.find((agent) => agent.id === participant.agentId)?.name ?? "Agent";
    }

    if (participant.role === "owner") {
        return "Owner";
    }

    return participant.userId ?? "Participant";
}

export function MemoRoomPanel({
    memo,
    selectedAnchorSegments,
    onClearSelectedAnchors,
}: MemoRoomPanelProps) {
    const [roomId, setRoomId] = useState<string | null>(null);
    const [participants, setParticipants] = useState<RoomParticipant[]>([]);
    const [messages, setMessages] = useState<RoomMessage[]>([]);
    const [viewerParticipant, setViewerParticipant] = useState<RoomParticipant | null>(null);
    const [agents, setAgents] = useState<Agent[]>([]);
    const [draft, setDraft] = useState("");
    const [visibility, setVisibility] = useState<"public" | "owner_only">("public");
    const [selectedAgentId, setSelectedAgentId] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isPosting, setIsPosting] = useState(false);
    const [isInvoking, setIsInvoking] = useState(false);
    const refreshInFlightRef = useRef<Promise<void> | null>(null);

    const refreshRoom = useEffectEvent(async () => {
        if (refreshInFlightRef.current) {
            return refreshInFlightRef.current;
        }

        const refreshPromise = (async () => {
            setIsLoading(true);
            setError(null);

            try {
                const roomLookupRes = await fetch(`/api/memos/${memo.id}/room`);
                const roomLookup = await readJson<{ room: { roomId: string } | null }>(roomLookupRes);

                let resolvedRoomId = roomLookup.room?.roomId ?? null;
                if (!resolvedRoomId) {
                    const createRoomRes = await fetch("/api/memo-rooms", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                            memoId: memo.id,
                            title: memo.title?.trim() || "Memo Room",
                        }),
                    });
                    const createRoom = await readJson<{ room?: { id: string } }>(createRoomRes);
                    resolvedRoomId = createRoom.room?.id ?? null;
                }

                if (!resolvedRoomId) {
                    throw new Error("Unable to resolve memo room");
                }

                const [contextRes, messagesRes, agentsRes] = await Promise.all([
                    fetch(`/api/memo-rooms/${resolvedRoomId}/context`),
                    fetch(`/api/memo-rooms/${resolvedRoomId}/messages`),
                    fetch("/api/agents"),
                ]);

                if (!contextRes.ok || !messagesRes.ok || !agentsRes.ok) {
                    throw new Error("Failed to load memo room");
                }

                const context = await readJson<RoomContextPayload>(contextRes);
                const messagePayload = await readJson<{ messages: RoomMessage[] }>(messagesRes);
                const agentsPayload = await readJson<{ agents: Agent[] }>(agentsRes);

                startTransition(() => {
                    setRoomId(resolvedRoomId);
                    setParticipants(context.room.participants);
                    setViewerParticipant(context.viewerParticipant);
                    setMessages(messagePayload.messages);
                    setAgents(agentsPayload.agents.filter((agent) => agent.status === "active"));
                    setVisibility(
                        context.viewerParticipant.defaultVisibility === "owner_only"
                            ? "owner_only"
                            : "public"
                    );
                    setSelectedAgentId((current) => {
                        if (current) {
                            return current;
                        }

                        const firstAgent = agentsPayload.agents.find((agent) => agent.status === "active");
                        return firstAgent?.id ?? "";
                    });
                });
            } catch (refreshError) {
                setError(
                    refreshError instanceof Error
                        ? refreshError.message
                        : "Failed to load memo room"
                );
            } finally {
                setIsLoading(false);
            }
        })();

        refreshInFlightRef.current = refreshPromise;

        try {
            await refreshPromise;
        } finally {
            if (refreshInFlightRef.current === refreshPromise) {
                refreshInFlightRef.current = null;
            }
        }
    });

    useEffect(() => {
        void refreshRoom();
    }, [memo.id, refreshRoom]);

    async function handlePostMessage() {
        if (!roomId || !draft.trim()) {
            return;
        }

        setIsPosting(true);
        setError(null);
        try {
            const res = await fetch(`/api/memo-rooms/${roomId}/messages`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    memoId: memo.id,
                    content: draft.trim(),
                    visibility,
                    ...getTranscriptAnchorPayload(selectedAnchorSegments),
                }),
            });

            if (!res.ok) {
                throw new Error("Failed to post message");
            }

            setDraft("");
            onClearSelectedAnchors();
            await refreshRoom();
        } catch (postError) {
            setError(postError instanceof Error ? postError.message : "Failed to post message");
        } finally {
            setIsPosting(false);
        }
    }

    async function ensureAgentParticipant(activeAgentId: string) {
        if (!roomId) {
            throw new Error("Memo room unavailable");
        }

        const alreadyJoined = participants.some(
            (participant) =>
                participant.participantType === "agent" &&
                participant.agentId === activeAgentId &&
                participant.status === "active"
        );

        if (alreadyJoined) {
            return;
        }

        const res = await fetch(`/api/memo-rooms/${roomId}/participants`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                participantType: "agent",
                agentId: activeAgentId,
                capability: "comment_only",
                defaultVisibility: "owner_only",
            }),
        });

        if (!res.ok) {
            throw new Error("Failed to add agent to room");
        }
    }

    async function handleInvokeAgent() {
        if (!roomId || !selectedAgentId || !draft.trim()) {
            return;
        }

        setIsInvoking(true);
        setError(null);

        try {
            await ensureAgentParticipant(selectedAgentId);

            const res = await fetch(`/api/memo-rooms/${roomId}/invocations`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    agentId: selectedAgentId,
                    memoId: memo.id,
                    content: draft.trim(),
                    visibility,
                    ...getTranscriptAnchorPayload(selectedAnchorSegments),
                }),
            });

            if (!res.ok) {
                throw new Error("Failed to ask agent");
            }

            setDraft("");
            onClearSelectedAnchors();
            await refreshRoom();
        } catch (invokeError) {
            setError(invokeError instanceof Error ? invokeError.message : "Failed to ask agent");
        } finally {
            setIsInvoking(false);
        }
    }

    const anchorLabel =
        selectedAnchorSegments.length > 0
            ? `${selectedAnchorSegments.length} transcript segment${selectedAnchorSegments.length > 1 ? "s" : ""} selected`
            : null;

    return (
        <aside className="rounded-[28px] border border-white/10 bg-white/[0.03] p-5 shadow-[0_24px_80px_rgba(0,0,0,0.25)] backdrop-blur-xl">
            <div className="flex items-center justify-between gap-3 border-b border-white/8 pb-4">
                <div>
                    <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.28em] text-white/35">
                        <Users size={13} />
                        Memo Room
                    </div>
                    <h3 className="mt-2 text-lg font-semibold text-white/90">
                        {memo.title?.trim() || "Memo Room"}
                    </h3>
                </div>
                {isLoading ? <Loader2 size={16} className="animate-spin text-white/45" /> : null}
            </div>

            {error ? (
                <div className="mt-4 rounded-2xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-100/85">
                    {error}
                </div>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-2">
                {participants.map((participant) => (
                    <span
                        key={participant.id}
                        className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-mono uppercase tracking-wide text-white/60"
                    >
                        {getParticipantLabel(participant, agents)}
                    </span>
                ))}
            </div>

            <div className="mt-5">
                <div className="mb-3 flex items-center gap-2 text-xs font-mono uppercase tracking-[0.28em] text-white/35">
                    <MessageSquareText size={13} />
                    Discussion
                </div>
                <div className="max-h-[320px] space-y-3 overflow-y-auto pr-1">
                    {messages.length === 0 ? (
                        <div className="rounded-2xl border border-dashed border-white/10 px-4 py-5 text-sm text-white/45">
                            Start the room by posting a note or asking an agent to respond.
                        </div>
                    ) : (
                        messages.map((message) => {
                            const author = participants.find(
                                (participant) => participant.id === message.authorParticipantId
                            );
                            const isOwnerOnly = message.visibility === "owner_only";

                            return (
                                <div
                                    key={message.id}
                                    className="rounded-2xl border border-white/8 bg-black/20 px-4 py-3"
                                >
                                    <div className="flex items-center justify-between gap-3">
                                        <span className="text-xs font-semibold text-white/80">
                                            {author
                                                ? getParticipantLabel(author, agents)
                                                : "Participant"}
                                        </span>
                                        <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-wide text-white/35">
                                            {isOwnerOnly ? "Owner only" : "Public"}
                                            <span>{formatDate(message.createdAt)}</span>
                                        </div>
                                    </div>
                                    <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-white/72">
                                        {message.content}
                                    </p>
                                    {message.anchorStartMs != null && message.anchorEndMs != null ? (
                                        <div className="mt-2 text-[10px] font-mono uppercase tracking-wide text-accent/80">
                                            Transcript {Math.floor(message.anchorStartMs / 1000)}s-
                                            {Math.ceil(message.anchorEndMs / 1000)}s
                                        </div>
                                    ) : null}
                                </div>
                            );
                        })
                    )}
                </div>
            </div>

            <div className="mt-5 border-t border-white/8 pt-5">
                {anchorLabel ? (
                    <div className="mb-3 flex items-center justify-between rounded-2xl border border-accent/20 bg-accent/10 px-4 py-3 text-sm text-accent">
                        <span>{anchorLabel}</span>
                        <button
                            type="button"
                            onClick={onClearSelectedAnchors}
                            className="text-accent/80 transition-colors hover:text-accent"
                        >
                            <X size={14} />
                        </button>
                    </div>
                ) : null}

                <textarea
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    placeholder="Post a note or ask an agent to respond..."
                    className="min-h-[110px] w-full rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-sm text-white/85 outline-none transition-colors placeholder:text-white/30 focus:border-accent/35"
                />

                <div className="mt-3 flex flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-3">
                        <label className="text-[11px] font-mono uppercase tracking-wide text-white/35">
                            Visibility
                        </label>
                        <select
                            value={visibility}
                            onChange={(event) =>
                                setVisibility(event.target.value as "public" | "owner_only")
                            }
                            className="rounded-full border border-white/10 bg-black/30 px-3 py-1.5 text-xs text-white/75 outline-none transition-colors focus:border-accent/35"
                        >
                            <option value="public">Public</option>
                            <option value="owner_only">Owner only</option>
                        </select>
                    </div>

                    <div className="flex flex-col gap-3 rounded-2xl border border-white/8 bg-black/20 p-3">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <div className="text-[11px] font-mono uppercase tracking-[0.28em] text-white/35">
                                    Ask Agent
                                </div>
                                <div className="mt-1 text-sm text-white/55">
                                    The selected agent will be added to the room automatically if needed.
                                </div>
                            </div>
                            <Sparkles size={16} className="text-accent/80" />
                        </div>
                        <div className="flex flex-col gap-3 sm:flex-row">
                            <select
                                value={selectedAgentId}
                                onChange={(event) => setSelectedAgentId(event.target.value)}
                                className="flex-1 rounded-full border border-white/10 bg-black/30 px-3 py-2 text-sm text-white/75 outline-none transition-colors focus:border-accent/35"
                            >
                                <option value="">Select an agent</option>
                                {agents.map((agent) => (
                                    <option key={agent.id} value={agent.id}>
                                        {agent.name}
                                    </option>
                                ))}
                            </select>
                            <button
                                type="button"
                                onClick={() => void handleInvokeAgent()}
                                disabled={isInvoking || !draft.trim() || !selectedAgentId}
                                className="inline-flex items-center justify-center gap-2 rounded-full border border-accent/25 bg-accent/10 px-4 py-2 text-sm text-accent transition-colors hover:border-accent/40 hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                                {isInvoking ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                                Ask agent
                            </button>
                        </div>
                    </div>

                    <button
                        type="button"
                        onClick={() => void handlePostMessage()}
                        disabled={isPosting || !draft.trim() || !roomId}
                        className="inline-flex items-center justify-center gap-2 rounded-full border border-white/12 bg-white/8 px-4 py-2 text-sm text-white/80 transition-colors hover:border-white/20 hover:bg-white/12 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        {isPosting ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                        Post message
                    </button>
                </div>
            </div>

            {viewerParticipant ? (
                <div className="mt-4 text-[10px] font-mono uppercase tracking-wide text-white/30">
                    Viewer capability: {viewerParticipant.capability}
                </div>
            ) : null}
        </aside>
    );
}
