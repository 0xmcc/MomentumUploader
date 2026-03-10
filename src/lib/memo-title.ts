import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";

const TITLE_MODEL = "claude-haiku-4-5";
const MIN_WORDS_FOR_AI_TITLE = 8;

/**
 * Generates an AI title for a memo based on its transcript.
 * Falls back to "Memo #N" (based on user's total memo count) if:
 *   - The transcript is too short
 *   - ANTHROPIC_API_KEY is not set
 *   - The Claude call fails
 */
export async function generateMemoTitle(
    transcript: string,
    userId: string,
    supabaseAdmin: SupabaseClient
): Promise<string> {
    const fallback = await getFallbackTitle(userId, supabaseAdmin);

    const wordCount = transcript.trim().split(/\s+/).filter(Boolean).length;
    if (wordCount < MIN_WORDS_FOR_AI_TITLE) {
        return fallback;
    }

    const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
    if (!apiKey) {
        console.warn("[memo-title] ANTHROPIC_API_KEY not set — using fallback title");
        return fallback;
    }

    try {
        const client = new Anthropic({ apiKey });
        const response = await client.messages.create({
            model: TITLE_MODEL,
            max_tokens: 40,
            messages: [
                {
                    role: "user",
                    content: `Generate a short, descriptive title (3–6 words) for this voice memo transcript. Return only the title — no quotes, no punctuation at the end, no explanation.\n\n${transcript.slice(0, 3000)}`,
                },
            ],
        });

        const block = response.content[0];
        if (block.type === "text") {
            const title = block.text.trim().replace(/^["']|["']$/g, "");
            if (title) return title;
        }
    } catch (err) {
        console.error("[memo-title] Claude API call failed:", err);
    }

    return fallback;
}

async function getFallbackTitle(
    userId: string,
    supabaseAdmin: SupabaseClient
): Promise<string> {
    try {
        const { count } = await supabaseAdmin
            .from("memos")
            .select("id", { count: "exact", head: true })
            .eq("user_id", userId);
        return `Memo #${count ?? 1}`;
    } catch {
        return "Memo";
    }
}
