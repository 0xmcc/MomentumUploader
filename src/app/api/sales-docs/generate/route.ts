import type { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import {
  generateSalesDoc,
  SalesDocGenerationError,
} from "@/lib/sales-doc-generation";
import { saveSalesDocSession } from "@/lib/sales-doc-sessions";

// Generation streams a full document from the model; allow up to 5 minutes.
export const maxDuration = 300;

const MAX_PROMPT_CHARS = 4_000;
const MAX_TRANSCRIPT_CHARS = 200_000;

export async function POST(req: NextRequest): Promise<Response> {
  const { userId } = await auth();
  if (!userId) {
    return Response.json(
      { error: "Sign in to generate documents." },
      { status: 401 }
    );
  }

  let body: { prompt?: string; transcript?: string };
  try {
    body = (await req.json()) as { prompt?: string; transcript?: string };
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const prompt = body.prompt?.trim() ?? "";
  const transcript = body.transcript?.trim() || undefined;

  if (!prompt) {
    return Response.json(
      { error: "Describe your client or situation to generate a document." },
      { status: 422 }
    );
  }
  if (prompt.length > MAX_PROMPT_CHARS) {
    return Response.json(
      { error: `Prompt is too long (max ${MAX_PROMPT_CHARS} characters).` },
      { status: 422 }
    );
  }
  if (transcript && transcript.length > MAX_TRANSCRIPT_CHARS) {
    return Response.json(
      { error: "Transcript is too long — trim it to the relevant call." },
      { status: 422 }
    );
  }

  try {
    const session = await generateSalesDoc({ prompt, transcript });
    try {
      await saveSalesDocSession(session, { prompt, transcript, userId });
    } catch (error) {
      console.error("[sales-docs/generate] failed to persist session", error);
    }
    return Response.json({ session });
  } catch (error) {
    if (error instanceof SalesDocGenerationError) {
      console.error("[sales-docs/generate] generation failed", error.message);
      return Response.json({ error: error.message }, { status: 502 });
    }
    console.error("[sales-docs/generate] unexpected error", error);
    return Response.json(
      { error: "Failed to generate the document. Try again." },
      { status: 500 }
    );
  }
}
