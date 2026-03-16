import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { type ArtifactType } from "@/lib/artifact-types";

export type MemoArtifactSource = "live" | "final";

type ChunkRow = {
    user_id: string;
    chunk_index: number;
    start_ms: number;
    end_ms: number;
    text: string;
};

type OutlineDraftItem = {
    chunkStart: number;
    chunkEnd: number;
    title: string;
    summary: string;
};

type OutlineArtifactItem = OutlineDraftItem & {
    startMs: number;
    endMs: number;
};

const SUMMARY_MODEL = "claude-haiku-4-5";
const OUTLINE_MODEL = "claude-haiku-4-5";

function countWords(text: string): number {
    return text.trim().split(/\s+/).filter(Boolean).length;
}

function buildFallbackSummary(text: string): string {
    const normalized = text.replace(/\s+/g, " ").trim();
    if (!normalized) return "";
    const sentences = normalized.match(/[^.!?]+[.!?]?/g) ?? [normalized];
    return sentences
        .slice(0, 2)
        .map((sentence) => sentence.trim())
        .filter(Boolean)
        .join(" ");
}

function buildFallbackOutline(chunks: ChunkRow[]): OutlineDraftItem[] {
    if (chunks.length === 0) {
        return [];
    }

    const chunkStart = chunks[0].chunk_index;
    const chunkEnd = chunks[chunks.length - 1].chunk_index;
    const summary = buildFallbackSummary(
        chunks
            .map((chunk) => chunk.text)
            .join(" ")
    );

    return [
        {
            chunkStart,
            chunkEnd,
            title: "Conversation arc",
            summary,
        },
    ];
}

function getAnthropicApiKey(): string | null {
    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    return apiKey ? apiKey : null;
}

function extractTextResponse(response: unknown): string {
    const content = Array.isArray((response as { content?: unknown })?.content)
        ? ((response as { content: unknown[] }).content)
        : [];
    const textBlocks = content
        .filter((block) => {
            const record =
                block && typeof block === "object" ? (block as Record<string, unknown>) : null;
            return record?.type === "text" && typeof record.text === "string";
        })
        .map((block) => ((block as { text: string }).text).trim())
        .filter(Boolean);

    return textBlocks.join("\n").trim();
}

function stripJsonCodeFence(text: string): string {
    const trimmed = text.trim();
    if (!trimmed.startsWith("```")) {
        return trimmed;
    }

    return trimmed
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/, "")
        .trim();
}

function normalizeOutlinePayload(raw: unknown): OutlineDraftItem[] {
    const maybeObject =
        raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
    const maybeItems = Array.isArray(maybeObject?.items)
        ? maybeObject.items
        : Array.isArray(raw)
            ? raw
            : null;

    if (!maybeItems) {
        throw new Error("Outline model returned an invalid payload shape.");
    }

    return maybeItems.map((item) => {
        const record =
            item && typeof item === "object" ? (item as Record<string, unknown>) : null;
        if (!record) {
            throw new Error("Outline model returned a non-object item.");
        }

        return {
            chunkStart: Number(record.chunkStart),
            chunkEnd: Number(record.chunkEnd),
            title: typeof record.title === "string" ? record.title.trim() : "",
            summary: typeof record.summary === "string" ? record.summary.trim() : "",
        };
    });
}

async function fetchReadyChunks(
    memoId: string,
    source: MemoArtifactSource,
    supabase: SupabaseClient,
): Promise<ChunkRow[]> {
    const { data, error } = await supabase
        .from("memo_transcript_chunks")
        .select("user_id, chunk_index, start_ms, end_ms, text")
        .eq("memo_id", memoId)
        .eq("source", source)
        .eq("status", "ready")
        .order("chunk_index", { ascending: true });

    if (error) {
        throw error;
    }

    return (data ?? []) as ChunkRow[];
}

async function summarizeChunkText(chunks: ChunkRow[]): Promise<string> {
    const combinedText = chunks
        .map((chunk) => chunk.text.trim())
        .filter(Boolean)
        .join("\n\n")
        .slice(0, 12000);

    if (!combinedText) {
        return "";
    }

    const apiKey = getAnthropicApiKey();
    if (!apiKey) {
        return buildFallbackSummary(combinedText);
    }

    const client = new Anthropic({ apiKey });
    const response = await client.messages.create({
        model: SUMMARY_MODEL,
        max_tokens: 120,
        messages: [
            {
                role: "user",
                content:
                    "Summarize the main points discussed so far in 2-3 sentences.\n\n" +
                    combinedText,
            },
        ],
    });

    const text = extractTextResponse(response);
    return text || buildFallbackSummary(combinedText);
}

async function generateOutlineDraft(chunks: ChunkRow[]): Promise<OutlineDraftItem[]> {
    if (chunks.length === 0) {
        return [];
    }

    const apiKey = getAnthropicApiKey();
    if (!apiKey) {
        return buildFallbackOutline(chunks);
    }

    const client = new Anthropic({ apiKey });
    const prompt = [
        "Create a concise outline of the memo so far.",
        "Return JSON only with this shape: {\"items\":[{\"chunkStart\":0,\"chunkEnd\":1,\"title\":\"...\",\"summary\":\"...\"}]}",
        "Rules:",
        "- Create 3 to 8 sections when possible.",
        "- Use chunk indices exactly as provided.",
        "- Do not include timestamps.",
        "- Do not include any keys besides chunkStart, chunkEnd, title, summary.",
        "",
        "Chunks:",
        ...chunks.map((chunk) => `[${chunk.chunk_index}] ${chunk.text.trim()}`),
    ].join("\n");

    const response = await client.messages.create({
        model: OUTLINE_MODEL,
        max_tokens: 600,
        messages: [
            {
                role: "user",
                content: prompt,
            },
        ],
    });

    const text = extractTextResponse(response);
    const parsed = JSON.parse(stripJsonCodeFence(text));
    return normalizeOutlinePayload(parsed);
}

function validateOutlineDraft(
    items: OutlineDraftItem[],
    chunks: ChunkRow[],
): OutlineArtifactItem[] {
    const maxIndex = chunks.length - 1;
    const sortedItems = [...items].sort((left, right) => left.chunkStart - right.chunkStart);

    for (const item of sortedItems) {
        if (item.chunkStart > item.chunkEnd) {
            console.error("[memo-artifacts] invalid outline chunk order", { item });
            throw new Error("Outline item chunkStart must be <= chunkEnd.");
        }

        if (
            item.chunkStart < 0 ||
            item.chunkEnd < 0 ||
            item.chunkStart > maxIndex ||
            item.chunkEnd > maxIndex
        ) {
            console.error("[memo-artifacts] outline chunk range out of bounds", {
                item,
                maxIndex,
            });
            throw new Error("Outline item chunk range is out of bounds.");
        }
    }

    for (let index = 0; index < sortedItems.length - 1; index += 1) {
        const current = sortedItems[index];
        const next = sortedItems[index + 1];
        if (current && next && current.chunkEnd >= next.chunkStart) {
            console.error("[memo-artifacts] overlapping outline ranges", {
                current,
                next,
            });
            throw new Error("Outline items must not overlap.");
        }
    }

    return sortedItems.map((item) => ({
        ...item,
        startMs: chunks[item.chunkStart].start_ms,
        endMs: chunks[item.chunkEnd].end_ms,
    }));
}

async function insertRollingSummaryArtifact(
    memoId: string,
    userId: string,
    source: MemoArtifactSource,
    chunks: ChunkRow[],
    supabase: SupabaseClient,
) {
    const summary = await summarizeChunkText(chunks);
    const firstChunkIndex = chunks[0]?.chunk_index ?? null;
    const lastChunkIndex = chunks.at(-1)?.chunk_index ?? null;

    await supersedeMemoArtifacts(memoId, source, "rolling_summary", supabase);

    const { error } = await supabase
        .from("memo_artifacts")
        .insert({
            memo_id: memoId,
            user_id: userId,
            source,
            artifact_type: "rolling_summary",
            status: "ready",
            based_on_chunk_start: firstChunkIndex,
            based_on_chunk_end: lastChunkIndex,
            payload: {
                summary,
                wordCount: countWords(summary),
            },
        });

    if (error) {
        throw error;
    }
}

async function insertOutlineArtifact(
    memoId: string,
    userId: string,
    source: MemoArtifactSource,
    chunks: ChunkRow[],
    supabase: SupabaseClient,
) {
    const draft = await generateOutlineDraft(chunks);
    const items = validateOutlineDraft(
        draft.map((item) => ({
            ...item,
            chunkStart: chunks.findIndex((chunk) => chunk.chunk_index === item.chunkStart),
            chunkEnd: chunks.findIndex((chunk) => chunk.chunk_index === item.chunkEnd),
        })),
        chunks,
    );

    await supersedeMemoArtifacts(memoId, source, "outline", supabase);

    const { error } = await supabase
        .from("memo_artifacts")
        .insert({
            memo_id: memoId,
            user_id: userId,
            source,
            artifact_type: "outline",
            status: "ready",
            based_on_chunk_start: chunks[0]?.chunk_index ?? null,
            based_on_chunk_end: chunks.at(-1)?.chunk_index ?? null,
            payload: { items },
        });

    if (error) {
        throw error;
    }
}

async function fetchLatestReadyArtifact(
    memoId: string,
    source: MemoArtifactSource,
    artifactType: ArtifactType,
    supabase: SupabaseClient,
): Promise<{ based_on_chunk_end?: number | null } | null> {
    const { data, error } = await supabase
        .from("memo_artifacts")
        .select("based_on_chunk_end")
        .eq("memo_id", memoId)
        .eq("source", source)
        .eq("artifact_type", artifactType)
        .eq("status", "ready")
        .maybeSingle();

    if (error) {
        throw error;
    }

    return data as { based_on_chunk_end?: number | null } | null;
}

async function insertPendingMemoJob(
    memoId: string,
    userId: string,
    jobType: "memo_summary_live" | "memo_outline_live" | "memo_artifact_final",
    supabase: SupabaseClient,
) {
    const { error } = await supabase
        .from("job_runs")
        .insert({
            user_id: userId,
            job_type: jobType,
            entity_type: "memo",
            entity_id: memoId,
            status: "pending",
        });

    if (error) {
        throw error;
    }

    console.log("[memo-jobs] queued", { memoId, jobType });
}

export async function supersedeMemoArtifacts(
    memoId: string,
    source: MemoArtifactSource,
    artifactType: ArtifactType | undefined,
    supabase: SupabaseClient,
) {
    let query = supabase
        .from("memo_artifacts")
        .update({
            status: "superseded",
            updated_at: new Date().toISOString(),
        })
        .eq("memo_id", memoId)
        .eq("source", source);

    if (artifactType) {
        query = query.eq("artifact_type", artifactType);
    }

    const { error } = await query;
    if (error) {
        throw error;
    }
}

export async function enqueueLiveSummaryJobIfNeeded(
    memoId: string,
    userId: string,
    supabase: SupabaseClient,
): Promise<{ enqueued: boolean; reason?: string }> {
    const chunks = await fetchReadyChunks(memoId, "live", supabase);
    if (chunks.length === 0) {
        return { enqueued: false, reason: "no_chunks" };
    }

    const latestChunkIndex = chunks[chunks.length - 1].chunk_index;
    const lastReady = await fetchLatestReadyArtifact(
        memoId,
        "live",
        "rolling_summary",
        supabase,
    );

    if (latestChunkIndex < (lastReady?.based_on_chunk_end ?? -1) + 2) {
        return { enqueued: false, reason: "threshold" };
    }

    await insertPendingMemoJob(memoId, userId, "memo_summary_live", supabase);
    return { enqueued: true };
}

export async function enqueueOutlineJobIfNeeded(
    memoId: string,
    userId: string,
    supabase: SupabaseClient,
): Promise<{ enqueued: boolean; reason?: string }> {
    const chunks = await fetchReadyChunks(memoId, "live", supabase);
    if (chunks.length === 0) {
        return { enqueued: false, reason: "no_chunks" };
    }

    const latestChunkIndex = chunks[chunks.length - 1].chunk_index;
    const lastReady = await fetchLatestReadyArtifact(
        memoId,
        "live",
        "outline",
        supabase,
    );

    if (latestChunkIndex < (lastReady?.based_on_chunk_end ?? -1) + 2) {
        return { enqueued: false, reason: "threshold" };
    }

    await insertPendingMemoJob(memoId, userId, "memo_outline_live", supabase);
    return { enqueued: true };
}

export async function executeLiveSummary(
    memoId: string,
    userId: string,
    supabase: SupabaseClient,
): Promise<void> {
    const chunks = await fetchReadyChunks(memoId, "live", supabase);
    if (chunks.length === 0) {
        return;
    }

    await insertRollingSummaryArtifact(memoId, userId, "live", chunks, supabase);
}

export async function executeOutline(
    memoId: string,
    source: MemoArtifactSource,
    supabase: SupabaseClient,
): Promise<void> {
    const chunks = await fetchReadyChunks(memoId, source, supabase);
    if (chunks.length === 0) {
        return;
    }

    await insertOutlineArtifact(memoId, chunks[0].user_id, source, chunks, supabase);
}

export async function executeFinalArtifacts(
    memoId: string,
    userId: string,
    supabase: SupabaseClient,
): Promise<void> {
    const chunks = await fetchReadyChunks(memoId, "final", supabase);
    if (chunks.length === 0) {
        return;
    }

    await supersedeMemoArtifacts(memoId, "live", undefined, supabase);
    await insertRollingSummaryArtifact(memoId, userId, "final", chunks, supabase);
    await executeOutline(memoId, "final", supabase);
}

export async function enqueueFinalArtifactsJob(
    memoId: string,
    userId: string,
    supabase: SupabaseClient,
): Promise<void> {
    await insertPendingMemoJob(memoId, userId, "memo_artifact_final", supabase);
}
