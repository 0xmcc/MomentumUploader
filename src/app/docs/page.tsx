"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

// ---------- Types ----------
type HttpMethod = "GET" | "POST" | "PATCH" | "DELETE";
type ParamType = "query" | "path" | "body";

interface Param {
    name: string;
    type: ParamType;
    dataType: string;
    required: boolean;
    description: string;
    example?: string;
}

interface Endpoint {
    id: string;
    method: HttpMethod;
    path: string;
    summary: string;
    description: string;
    params: Param[];
    requestBody?: { example: string; contentType: string };
    responseExample: string;
    tag: string;
}

// ---------- API Definition ----------
const ENDPOINTS: Endpoint[] = [
    {
        id: "list-memos",
        method: "GET",
        path: "/api/memos",
        summary: "List all voice memos",
        description: "Returns a paginated list of all transcribed voice memos, ordered by creation date descending.",
        tag: "Memos",
        params: [
            { name: "search", type: "query", dataType: "string", required: false, description: "Filter by transcript content (case-insensitive)", example: "meeting notes" },
            { name: "limit", type: "query", dataType: "number", required: false, description: "Max number of results to return (default: 50, max: 200)", example: "20" },
            { name: "offset", type: "query", dataType: "number", required: false, description: "Number of results to skip for pagination", example: "0" },
        ],
        responseExample: JSON.stringify({
            memos: [
                { id: "3fd1f8ee-e40c-43ce-8e8f-971e3fed9dcc", title: null, transcript: "That's like, hey, how do we make sure liquids don't spill?", audioUrl: "https://...supabase.co/storage/v1/object/public/voice-memos/audio/abc.webm", wordCount: 12, createdAt: "2026-02-20T08:17:45.803Z", updatedAt: "2026-02-20T08:17:45.803Z" }
            ],
            total: 8,
            limit: 50,
            offset: 0
        }, null, 2),
    },
    {
        id: "create-memo",
        method: "POST",
        path: "/api/memos",
        summary: "Create a text memo",
        description: "Creates a memo directly from a transcript string — no audio file required.",
        tag: "Memos",
        params: [
            { name: "transcript", type: "body", dataType: "string", required: true, description: "The transcript text content", example: "Remember to follow up with the NVIDIA team on Friday." },
            { name: "title", type: "body", dataType: "string", required: false, description: "Optional title for the memo", example: "NVIDIA follow-up" },
            { name: "audioUrl", type: "body", dataType: "string", required: false, description: "Optional URL to an existing audio file", example: "https://example.com/audio.webm" },
        ],
        requestBody: {
            contentType: "application/json",
            example: JSON.stringify({ transcript: "Remember to follow up with the NVIDIA team on Friday.", title: "NVIDIA follow-up" }, null, 2),
        },
        responseExample: JSON.stringify({
            memo: { id: "new-uuid", title: "NVIDIA follow-up", transcript: "Remember to follow up with the NVIDIA team on Friday.", audioUrl: null, createdAt: "2026-02-20T08:30:00.000Z" }
        }, null, 2),
    },
    {
        id: "get-memo",
        method: "GET",
        path: "/api/memos/:id",
        summary: "Get a single memo",
        description: "Fetches a single voice memo by its UUID.",
        tag: "Memos",
        params: [
            { name: "id", type: "path", dataType: "uuid", required: true, description: "The UUID of the memo", example: "3fd1f8ee-e40c-43ce-8e8f-971e3fed9dcc" },
        ],
        responseExample: JSON.stringify({
            memo: { id: "3fd1f8ee-e40c-43ce-8e8f-971e3fed9dcc", title: null, transcript: "That's like, how do we make sure liquids don't spill?", audioUrl: "https://...supabase.co/.../audio.webm", wordCount: 12, createdAt: "2026-02-20T08:17:45.803Z", updatedAt: "2026-02-20T08:17:45.803Z" }
        }, null, 2),
    },
    {
        id: "update-memo",
        method: "PATCH",
        path: "/api/memos/:id",
        summary: "Update a memo",
        description: "Update the title and/or transcript of an existing memo.",
        tag: "Memos",
        params: [
            { name: "id", type: "path", dataType: "uuid", required: true, description: "The UUID of the memo to update", example: "3fd1f8ee-e40c-43ce-8e8f-971e3fed9dcc" },
            { name: "title", type: "body", dataType: "string", required: false, description: "New title for the memo" },
            { name: "transcript", type: "body", dataType: "string", required: false, description: "Corrected transcript text" },
        ],
        requestBody: {
            contentType: "application/json",
            example: JSON.stringify({ title: "Corrected title", transcript: "Updated transcript text here." }, null, 2),
        },
        responseExample: JSON.stringify({
            memo: { id: "3fd1f8ee-e40c-43ce-8e8f-971e3fed9dcc", title: "Corrected title", transcript: "Updated transcript text here.", audioUrl: "https://...", updatedAt: "2026-02-20T09:00:00.000Z" }
        }, null, 2),
    },
    {
        id: "delete-memo",
        method: "DELETE",
        path: "/api/memos/:id",
        summary: "Delete a memo",
        description: "Permanently deletes a voice memo and its database record. Note: the audio file in Supabase Storage is not deleted.",
        tag: "Memos",
        params: [
            { name: "id", type: "path", dataType: "uuid", required: true, description: "The UUID of the memo to delete", example: "3fd1f8ee-e40c-43ce-8e8f-971e3fed9dcc" },
        ],
        responseExample: JSON.stringify({ success: true, deleted: "3fd1f8ee-e40c-43ce-8e8f-971e3fed9dcc" }, null, 2),
    },
    {
        id: "transcribe",
        method: "POST",
        path: "/api/transcribe",
        summary: "Upload & transcribe audio",
        description: "Accepts an audio file (WebM, OGG, MP4, MP3, M4A), uploads it to Supabase Storage, transcribes it via NVIDIA Parakeet-CTC (gRPC), and saves the result to the database.",
        tag: "Transcription",
        params: [
            { name: "file", type: "body", dataType: "File (multipart)", required: true, description: "The audio file to transcribe. Supported: audio/webm, audio/ogg, audio/mp4, audio/mpeg, audio/mp3, audio/x-m4a" },
        ],
        requestBody: {
            contentType: "multipart/form-data",
            example: `// curl example:\ncurl -X POST http://localhost:3000/api/transcribe \\\n  -F "file=@recording.webm"`,
        },
        responseExample: JSON.stringify({
            success: true,
            text: "That's like, hey, how do we make sure liquids don't spill? Like seriously?",
            url: "https://...supabase.co/storage/v1/object/public/voice-memos/audio/1771575891300_memo.webm",
            modelUsed: "nvidia/parakeet-ctc-0.6b-asr"
        }, null, 2),
    },
];

// ---------- UI Helpers ----------
const METHOD_STYLES: Record<HttpMethod, string> = {
    GET: "bg-blue-500/15 text-blue-400 border border-blue-500/30",
    POST: "bg-green-500/15 text-green-400 border border-green-500/30",
    PATCH: "bg-yellow-500/15 text-yellow-400 border border-yellow-500/30",
    DELETE: "bg-red-500/15 text-red-400 border border-red-500/30",
};

const PARAM_BADGE: Record<ParamType, string> = {
    query: "bg-purple-500/20 text-purple-300",
    path: "bg-orange-500/20 text-orange-300",
    body: "bg-cyan-500/20 text-cyan-300",
};

function MethodBadge({ method }: { method: HttpMethod }) {
    return (
        <span className={`font-mono text-xs font-bold px-2.5 py-1 rounded-md flex-shrink-0 ${METHOD_STYLES[method]}`}>
            {method}
        </span>
    );
}

function EndpointCard({ ep }: { ep: Endpoint }) {
    const [open, setOpen] = useState(false);
    const [copied, setCopied] = useState(false);

    const copy = (text: string) => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
    };

    const curlSnippet = ep.method === "GET"
        ? `curl http://localhost:3000${ep.path.replace(/:(\w+)/g, "<$1>")}`
        : ep.requestBody?.contentType === "multipart/form-data"
            ? ep.requestBody.example
            : `curl -X ${ep.method} http://localhost:3000${ep.path.replace(/:(\w+)/g, "<$1>")} \\\n  -H "Content-Type: application/json" \\\n  -d '${ep.requestBody?.example ?? "{}"}'`;

    return (
        <motion.div
            layout
            className="border border-white/8 rounded-2xl overflow-hidden bg-white/[0.02] hover:border-white/15 transition-colors"
        >
            {/* Header row */}
            <button
                onClick={() => setOpen(!open)}
                className="w-full flex items-center gap-4 px-6 py-4 text-left hover:bg-white/[0.03] transition-colors"
            >
                <MethodBadge method={ep.method} />
                <code className="text-white/80 text-sm font-mono flex-1">{ep.path}</code>
                <span className="text-white/50 text-sm hidden sm:block">{ep.summary}</span>
                <span className={`text-white/30 text-lg transition-transform ${open ? "rotate-180" : ""}`}>›</span>
            </button>

            <AnimatePresence>
                {open && (
                    <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: "auto", opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden border-t border-white/5"
                    >
                        <div className="p-6 grid grid-cols-1 lg:grid-cols-2 gap-8">
                            {/* Left: description + params */}
                            <div>
                                <p className="text-white/60 text-sm mb-6 leading-relaxed">{ep.description}</p>

                                {ep.params.length > 0 && (
                                    <div>
                                        <h4 className="text-xs font-semibold text-white/40 uppercase tracking-widest mb-3">Parameters</h4>
                                        <div className="space-y-3">
                                            {ep.params.map((p) => (
                                                <div key={p.name} className="bg-white/[0.03] rounded-xl px-4 py-3 border border-white/5">
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <code className="text-white/90 text-sm font-mono">{p.name}</code>
                                                        <span className={`text-xs px-1.5 py-0.5 rounded font-mono ${PARAM_BADGE[p.type]}`}>{p.type}</span>
                                                        <span className="text-white/40 font-mono text-xs">{p.dataType}</span>
                                                        {p.required && <span className="text-red-400 text-xs ml-auto">required</span>}
                                                    </div>
                                                    <p className="text-white/45 text-xs">{p.description}</p>
                                                    {p.example && (
                                                        <p className="text-white/30 text-xs mt-1 font-mono">e.g. <span className="text-accent/60">{p.example}</span></p>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Right: code blocks */}
                            <div className="space-y-4">
                                {/* cURL */}
                                <div>
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-xs text-white/40 font-mono uppercase tracking-widest">Request</span>
                                        <button
                                            onClick={() => copy(curlSnippet)}
                                            className="text-xs text-accent/60 hover:text-accent transition"
                                        >
                                            {copied ? "Copied!" : "Copy"}
                                        </button>
                                    </div>
                                    <pre className="bg-black/40 border border-white/5 rounded-xl p-4 text-xs text-green-300/80 font-mono overflow-x-auto whitespace-pre-wrap">
                                        {curlSnippet}
                                    </pre>
                                </div>

                                {/* Response */}
                                <div>
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-xs text-white/40 font-mono uppercase tracking-widest">Response <span className="text-green-400">200</span></span>
                                    </div>
                                    <pre className="bg-black/40 border border-white/5 rounded-xl p-4 text-xs text-blue-200/70 font-mono overflow-x-auto max-h-64">
                                        {ep.responseExample}
                                    </pre>
                                </div>
                            </div>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </motion.div>
    );
}

// ---------- Page ----------
const TAGS = ["All", ...Array.from(new Set(ENDPOINTS.map((e) => e.tag)))];

export default function DocsPage() {
    const [activeTag, setActiveTag] = useState("All");
    const [search, setSearch] = useState("");

    const filtered = ENDPOINTS.filter((ep) => {
        const matchTag = activeTag === "All" || ep.tag === activeTag;
        const matchSearch = !search ||
            ep.path.toLowerCase().includes(search.toLowerCase()) ||
            ep.summary.toLowerCase().includes(search.toLowerCase());
        return matchTag && matchSearch;
    });

    return (
        <main className="min-h-screen" style={{ background: "hsl(240 10% 5%)" }}>
            {/* Hero */}
            <div className="border-b border-white/5 bg-gradient-to-b from-white/[0.03] to-transparent">
                <div className="max-w-5xl mx-auto px-6 py-16">
                    <div className="inline-flex items-center gap-2 bg-accent/10 border border-accent/20 text-accent text-xs px-3 py-1.5 rounded-full mb-6 font-mono">
                        <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                        v1.0 · REST API
                    </div>
                    <h1 className="text-4xl font-bold text-white mb-4 tracking-tight">Sonic Memos API</h1>
                    <p className="text-white/50 text-lg max-w-2xl leading-relaxed">
                        Programmatic access to voice memos — list, create, update, delete, and transcribe audio using NVIDIA Parakeet-CTC.
                    </p>

                    <div className="mt-8 flex flex-wrap gap-6 text-sm text-white/40">
                        <div><span className="text-white/25">Base URL</span><br /><code className="text-accent/80 font-mono">http://localhost:3000</code></div>
                        <div><span className="text-white/25">Format</span><br /><code className="text-white/60 font-mono">application/json</code></div>
                        <div><span className="text-white/25">Authentication</span><br /><code className="text-white/60 font-mono">None (dev mode)</code></div>
                        <div><span className="text-white/25">Transcription Engine</span><br /><code className="text-white/60 font-mono">NVIDIA Parakeet-CTC 0.6B</code></div>
                    </div>
                </div>
            </div>

            <div className="max-w-5xl mx-auto px-6 py-12">
                {/* Filter bar */}
                <div className="flex flex-col sm:flex-row gap-4 mb-10">
                    <div className="flex gap-2">
                        {TAGS.map((tag) => (
                            <button
                                key={tag}
                                onClick={() => setActiveTag(tag)}
                                className={`px-4 py-1.5 rounded-full text-sm transition-all ${activeTag === tag
                                        ? "bg-accent text-white"
                                        : "bg-white/5 text-white/50 hover:text-white hover:bg-white/10"
                                    }`}
                            >
                                {tag}
                            </button>
                        ))}
                    </div>
                    <input
                        type="text"
                        placeholder="Filter endpoints..."
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                        className="ml-auto w-full sm:w-56 bg-white/5 border border-white/10 rounded-full px-4 py-1.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-accent/40"
                    />
                </div>

                {/* Endpoint groups */}
                {TAGS.filter((t) => t !== "All").map((tag) => {
                    const eps = filtered.filter((e) => e.tag === tag);
                    if (!eps.length) return null;
                    return (
                        <section key={tag} className="mb-10">
                            <h2 className="text-xs font-bold uppercase tracking-[0.2em] text-white/30 mb-4 pl-1">{tag}</h2>
                            <div className="space-y-3">
                                {eps.map((ep) => <EndpointCard key={ep.id} ep={ep} />)}
                            </div>
                        </section>
                    );
                })}

                {filtered.length === 0 && (
                    <div className="text-center py-20 text-white/20">
                        <p>No endpoints match your filter.</p>
                    </div>
                )}

                {/* Planned subscription tiers */}
                <div className="mt-16 p-6 rounded-2xl border border-white/5 bg-white/[0.02]">
                    <div className="flex items-center gap-2 mb-4">
                        <h3 className="text-sm font-semibold text-white/60">Planned Subscription Tiers</h3>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-yellow-500/15 text-yellow-400 border border-yellow-500/25 font-mono">not yet built</span>
                    </div>
                    <p className="text-white/35 text-xs mb-5 leading-relaxed">
                        Future pricing structure for reference. File size limits will be enforced in the app layer before the transcription request is sent.
                    </p>
                    <div className="overflow-x-auto">
                        <table className="w-full text-xs font-mono text-white/50">
                            <thead>
                                <tr className="border-b border-white/5">
                                    <th className="text-left text-white/25 uppercase tracking-widest pb-2 pr-6">Tier</th>
                                    <th className="text-left text-white/25 uppercase tracking-widest pb-2 pr-6">Price</th>
                                    <th className="text-left text-white/25 uppercase tracking-widest pb-2 pr-6">Max File Size</th>
                                    <th className="text-left text-white/25 uppercase tracking-widest pb-2">Notes</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/[0.03]">
                                <tr>
                                    <td className="py-2.5 pr-6 text-white/60">Free</td>
                                    <td className="py-2.5 pr-6">$0 / mo</td>
                                    <td className="py-2.5 pr-6 text-red-400/70">10 MB</td>
                                    <td className="py-2.5 text-white/30">Hard cap, no overage</td>
                                </tr>
                                <tr>
                                    <td className="py-2.5 pr-6 text-white/60">Starter</td>
                                    <td className="py-2.5 pr-6">$9 / mo</td>
                                    <td className="py-2.5 pr-6 text-yellow-400/70">25 MB</td>
                                    <td className="py-2.5 text-white/30">~10–15 min of typical audio</td>
                                </tr>
                                <tr>
                                    <td className="py-2.5 pr-6 text-white/60">Pro</td>
                                    <td className="py-2.5 pr-6">$29 / mo</td>
                                    <td className="py-2.5 pr-6 text-green-400/70">75 MB</td>
                                    <td className="py-2.5 text-white/30">Current API ceiling (NVIDIA)</td>
                                </tr>
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* Model info */}
                <div className="mt-6 p-6 rounded-2xl border border-white/5 bg-white/[0.02]">
                    <h3 className="text-sm font-semibold text-white/60 mb-3">Transcription Model</h3>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs text-white/40 font-mono">
                        <div><span className="text-white/25 block mb-1">Model</span>nvidia/parakeet-ctc-0.6b-asr</div>
                        <div><span className="text-white/25 block mb-1">Protocol</span>gRPC · grpc.nvcf.nvidia.com:443</div>
                        <div><span className="text-white/25 block mb-1">Input format</span>WebM/Opus → ffmpeg → 16kHz PCM</div>
                        <div><span className="text-white/25 block mb-1">Storage</span>Supabase Storage · voice-memos bucket</div>
                        <div><span className="text-white/25 block mb-1">Database</span>Supabase Postgres · items table</div>
                        <div><span className="text-white/25 block mb-1">Language</span>English (en-US)</div>
                    </div>
                </div>
            </div>
        </main>
    );
}
