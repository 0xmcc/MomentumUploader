import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";

type MemoArtifactSource = "live" | "final";
type MemoArtifactType = "rolling_summary";
type ChunkRow = {
    chunk_index: number;
    text: string;
};

type JobRunRow = {
    id: number;
};

const SUMMARY_MODEL = "claude-haiku-4-5";

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

async function fetchReadyChunks(
    memoId: string,
    source: MemoArtifactSource,
    supabase: SupabaseClient,
) {
    const { data, error } = await supabase
        .from("memo_transcript_chunks")
        .select("chunk_index, text")
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

    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
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

    const block = response.content[0];
    if (block.type !== "text") {
        return buildFallbackSummary(combinedText);
    }

    return block.text.trim();
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

async function fetchReadyRollingSummary(
    memoId: string,
    source: MemoArtifactSource,
    supabase: SupabaseClient,
) {
    const { data, error } = await supabase
        .from("memo_artifacts")
        .select("based_on_chunk_end")
        .eq("memo_id", memoId)
        .eq("source", source)
        .eq("artifact_type", "rolling_summary")
        .eq("status", "ready")
        .maybeSingle();

    if (error) {
        throw error;
    }

    return data as { based_on_chunk_end?: number | null } | null;
}

async function hasRunningLiveSummaryJob(memoId: string, supabase: SupabaseClient) {
    const { data, error } = await supabase
        .from("job_runs")
        .select("id")
        .eq("job_type", "memo_summary_live")
        .eq("entity_id", memoId)
        .eq("status", "running")
        .single();

    if (error) {
        return false;
    }

    return Boolean(data);
}

async function insertLiveSummaryJob(
    memoId: string,
    userId: string,
    supabase: SupabaseClient,
) {
    const { data, error } = await supabase
        .from("job_runs")
        .insert({
            user_id: userId,
            job_type: "memo_summary_live",
            entity_type: "memo",
            entity_id: memoId,
            status: "running",
        })
        .select("id")
        .single();

    if (error) {
        throw error;
    }

    return data as JobRunRow;
}

async function finishLiveSummaryJob(
    jobId: number,
    status: "succeeded" | "failed",
    result: Record<string, unknown> | null,
    errorMessage: string | null,
    supabase: SupabaseClient,
) {
    const payload: Record<string, unknown> = {
        status,
        finished_at: new Date().toISOString(),
    };

    if (result) payload.result = result;
    if (errorMessage) payload.error = errorMessage;

    const { error } = await supabase
        .from("job_runs")
        .update(payload)
        .eq("id", jobId);

    if (error) {
        throw error;
    }
}

export async function supersedeMemoArtifacts(
    memoId: string,
    source: MemoArtifactSource,
    artifactType: MemoArtifactType | undefined,
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

export async function generateLiveRollingSummary(
    memoId: string,
    userId: string,
    supabase: SupabaseClient,
) {
    const chunks = await fetchReadyChunks(memoId, "live", supabase);
    if (chunks.length === 0) {
        return { generated: false, reason: "no_chunks" as const };
    }

    const latestChunkIndex = chunks[chunks.length - 1].chunk_index;
    const currentArtifact = await fetchReadyRollingSummary(memoId, "live", supabase);
    const lastSummaryChunkEnd = currentArtifact?.based_on_chunk_end ?? null;

    if (
        lastSummaryChunkEnd !== null &&
        latestChunkIndex < lastSummaryChunkEnd + 2
    ) {
        return { generated: false, reason: "threshold" as const };
    }

    if (await hasRunningLiveSummaryJob(memoId, supabase)) {
        return { generated: false, reason: "running" as const };
    }

    const job = await insertLiveSummaryJob(memoId, userId, supabase);

    try {
        await insertRollingSummaryArtifact(memoId, userId, "live", chunks, supabase);
        await finishLiveSummaryJob(
            job.id,
            "succeeded",
            { latestChunkIndex },
            null,
            supabase,
        );
        return { generated: true, latestChunkIndex };
    } catch (error) {
        await finishLiveSummaryJob(
            job.id,
            "failed",
            null,
            error instanceof Error ? error.message : String(error),
            supabase,
        );
        throw error;
    }
}

export async function generateFinalArtifacts(
    memoId: string,
    userId: string,
    supabase: SupabaseClient,
) {
    const chunks = await fetchReadyChunks(memoId, "final", supabase);
    if (chunks.length === 0) {
        return { generated: false };
    }

    await insertRollingSummaryArtifact(memoId, userId, "final", chunks, supabase);
    return { generated: true };
}
