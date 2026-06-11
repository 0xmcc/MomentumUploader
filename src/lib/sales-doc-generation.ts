import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import type { BeliefId, SalesDoc, SalesSession } from "@/data/salesDocTypes";

/**
 * SalesDoc generation pipeline: prompt/transcript in, SalesSession out.
 *
 * The model emits a `GeneratedPayload` (the prep content) constrained by a
 * JSON schema via structured outputs. Server-side we wrap it into the full
 * `SalesDoc` contract — ids, timestamps, sourceInputs, and a derived
 * `liveCoaching` block (demo mode) so the UI renders with zero changes.
 */

const GENERATION_MODEL = "claude-opus-4-8";
const MAX_OUTPUT_TOKENS = 32000;

export class SalesDocGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SalesDocGenerationError";
  }
}

export type GenerationInput = {
  prompt: string;
  transcript?: string;
};

/** What the model generates. Everything else in SalesDoc is filled server-side. */
export type GeneratedPayload = {
  title: string;
  sidebarLabel: string;
  prospect: SalesDoc["prospect"];
  callBrief: SalesDoc["callBrief"];
  salesDiagnosis: SalesDoc["salesDiagnosis"];
  beliefLadder: SalesDoc["beliefLadder"];
  pitchScript: SalesDoc["pitchScript"];
  objectionPrep: SalesDoc["objectionPrep"];
  callFlow: SalesDoc["callFlow"];
  nextBestQuestions: SalesDoc["nextBestQuestions"];
  chat: {
    assistantIntro: string;
    generatedChecklist: string[];
    assistantOutro: string;
  };
};

const BELIEF_IDS: BeliefId[] = [
  "pain",
  "doubt",
  "cost",
  "desire",
  "money",
  "support",
  "trust",
];

const questionSchema = {
  type: "object",
  properties: {
    id: { type: "string", description: "Short unique snake_case id" },
    text: { type: "string" },
    reason: {
      type: "string",
      description: "Why this question matters — include only when it adds insight",
    },
    priority: { type: "string", enum: ["high", "medium", "low"] },
  },
  required: ["id", "text", "priority"],
  additionalProperties: false,
} as const;

const scriptSectionSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    script: {
      type: "string",
      description: "Verbatim talk track written in the seller's voice",
    },
    coachNotes: { type: "array", items: { type: "string" } },
  },
  required: ["title", "script", "coachNotes"],
  additionalProperties: false,
} as const;

const GENERATION_SCHEMA = {
  type: "object",
  properties: {
    title: {
      type: "string",
      description: "Document title, e.g. 'Alex — Fitness Coach Discovery Call'",
    },
    sidebarLabel: {
      type: "string",
      description: "Short sidebar label, e.g. 'Fitness Coach — Discovery'",
    },
    prospect: {
      type: "object",
      properties: {
        name: { type: "string" },
        businessType: { type: "string" },
        offer: { type: "string" },
        pricePoint: { type: "string" },
        mainChallenge: { type: "string" },
        callGoal: { type: "string" },
        stage: { type: "string", description: "e.g. Discovery, Demo, Closing" },
      },
      required: [
        "name",
        "businessType",
        "offer",
        "pricePoint",
        "mainChallenge",
        "callGoal",
        "stage",
      ],
      additionalProperties: false,
    },
    callBrief: {
      type: "object",
      properties: {
        title: { type: "string" },
        summary: { type: "string" },
        objective: { type: "string" },
        keyFacts: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              value: { type: "string" },
            },
            required: ["label", "value"],
            additionalProperties: false,
          },
        },
      },
      required: ["title", "summary", "objective", "keyFacts"],
      additionalProperties: false,
    },
    salesDiagnosis: {
      type: "object",
      properties: {
        title: { type: "string" },
        summary: { type: "string" },
        likelyGaps: {
          type: "array",
          items: {
            type: "object",
            properties: {
              label: { type: "string" },
              description: { type: "string" },
            },
            required: ["label", "description"],
            additionalProperties: false,
          },
        },
      },
      required: ["title", "summary", "likelyGaps"],
      additionalProperties: false,
    },
    beliefLadder: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", enum: BELIEF_IDS },
          label: { type: "string" },
          status: {
            type: "string",
            enum: ["covered", "needs_work", "not_covered"],
          },
          goal: { type: "string" },
          questions: { type: "array", items: questionSchema },
        },
        required: ["id", "label", "status", "goal", "questions"],
        additionalProperties: false,
      },
    },
    pitchScript: {
      type: "object",
      properties: {
        highLevelPromise: scriptSectionSchema,
        bridgePillars: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string" },
              title: { type: "string" },
              script: { type: "string" },
              coachNotes: { type: "array", items: { type: "string" } },
            },
            required: ["id", "title", "script", "coachNotes"],
            additionalProperties: false,
          },
        },
        delivery: scriptSectionSchema,
      },
      required: ["highLevelPromise", "bridgePillars", "delivery"],
      additionalProperties: false,
    },
    objectionPrep: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          objection: { type: "string", description: "In the prospect's words" },
          likelyMeaning: { type: "string" },
          isolateQuestion: { type: "string" },
          recommendedResponse: { type: "string" },
          fallbackQuestion: { type: "string" },
        },
        required: [
          "id",
          "objection",
          "likelyMeaning",
          "isolateQuestion",
          "recommendedResponse",
        ],
        additionalProperties: false,
      },
    },
    callFlow: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          step: { type: "string" },
          goal: { type: "string" },
          talkTrack: { type: "string" },
        },
        required: ["id", "step", "goal", "talkTrack"],
        additionalProperties: false,
      },
    },
    nextBestQuestions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          question: { type: "string" },
          why: { type: "string" },
          useCase: {
            type: "string",
            enum: ["discovery", "objection", "pitch", "transition", "closing"],
          },
        },
        required: ["id", "question", "why", "useCase"],
        additionalProperties: false,
      },
    },
    chat: {
      type: "object",
      properties: {
        assistantIntro: {
          type: "string",
          description: "1-2 sentences acknowledging the request before the checklist",
        },
        generatedChecklist: {
          type: "array",
          items: { type: "string" },
          description: "4-6 short labels of what was generated",
        },
        assistantOutro: {
          type: "string",
          description: "1-2 sentences on how to use the document",
        },
      },
      required: ["assistantIntro", "generatedChecklist", "assistantOutro"],
      additionalProperties: false,
    },
  },
  required: [
    "title",
    "sidebarLabel",
    "prospect",
    "callBrief",
    "salesDiagnosis",
    "beliefLadder",
    "pitchScript",
    "objectionPrep",
    "callFlow",
    "nextBestQuestions",
    "chat",
  ],
  additionalProperties: false,
} as const;

const SYSTEM_PROMPT = `You are Sales Docs, an elite sales call-prep strategist. Given a description of an upcoming sales call (and optionally a transcript or call notes), you produce a complete, tailored call-prep document built on the Belief Ladder framework.

The Belief Ladder is the sequence of beliefs a prospect must hold before buying:
1. Pain — the problem is real and urgent
2. Doubt — they can't solve it on their own
3. Cost — staying stuck has a quantifiable cost
4. Desire — they want a specific better future
5. Money — the investment is justified by the outcome
6. Support — they believe they'll get the help they need
7. Trust — they believe you specifically can deliver

Rules:
- beliefLadder MUST contain exactly 7 entries, one per belief, in this order: pain, doubt, cost, desire, money, support, trust. Use the labels Pain, Doubt, Cost, Desire, Money, Support, Trust.
- Set each belief's status from the source input: "covered" if the input gives concrete evidence the belief is already established, "needs_work" if partially there, "not_covered" if the call must build it from scratch. Most beliefs should be "needs_work" or "not_covered" for a first call.
- 2-4 questions per belief. Make them sound like a real person talking, anchored in the prospect's own numbers and words. Add a "reason" only where it teaches the seller something non-obvious.
- objectionPrep: 4-6 likely objections phrased in the prospect's words, what each really means, an isolating question, and a recommended response.
- callFlow: 5-7 steps from open to close, each with a goal and a short verbatim talk track.
- nextBestQuestions: 6-8 questions spread across useCases.
- callBrief.keyFacts: 4-6 label/value pairs (Business, Offer, Price, Main Challenge, Call Goal...). Values are short.
- Write like a sharp sales coach: direct, specific, conversational. Quantify the cost of inaction wherever the input gives you numbers. Never pad with generic filler.
- chat.assistantIntro: 1-2 sentences acknowledging what you were given. chat.generatedChecklist: 4-6 short past-tense labels (e.g. "Call brief generated", "Belief Ladder mapped (7 stages)"). chat.assistantOutro: 1-2 sentences on how to use the doc on the call.
- All ids: short unique snake_case strings.
- If a transcript is provided, mine it for the prospect's exact phrases, numbers, and objections — quote them in questions and scripts.`;

/** Static waveform silhouette for the demo coaching rail. */
const DEMO_WAVEFORM = [
  0.35, 0.62, 0.48, 0.8, 0.55, 0.3, 0.68, 0.9, 0.5, 0.4, 0.72, 0.58, 0.33,
  0.85, 0.6, 0.45, 0.7, 0.52, 0.38, 0.65, 0.78, 0.42, 0.56, 0.3,
];

const BELIEF_STATUS_RANK: Record<string, number> = {
  covered: 0,
  needs_work: 1,
  not_covered: 2,
};

/**
 * Derive the coaching rail from the generated doc: belief progress mirrors
 * the ladder statuses (first uncovered belief becomes "active"), insights
 * come from the diagnosis gaps, and the next question is the highest-value
 * question of the active belief. Pure prep preview — no audio involved.
 */
export function deriveLiveCoaching(
  payload: GeneratedPayload
): SalesDoc["liveCoaching"] {
  const firstOpenIndex = payload.beliefLadder.findIndex(
    (belief) => belief.status !== "covered"
  );

  const beliefProgress = payload.beliefLadder.map((belief, i) => ({
    beliefId: belief.id,
    label: belief.label,
    status:
      belief.status === "covered"
        ? ("complete" as const)
        : i === firstOpenIndex
          ? ("active" as const)
          : ("incomplete" as const),
  }));

  const focusBelief =
    payload.beliefLadder[firstOpenIndex] ?? payload.beliefLadder[0];
  const focusQuestion =
    focusBelief?.questions.find((q) => q.priority === "high") ??
    focusBelief?.questions[0];

  const insights: SalesDoc["liveCoaching"]["insights"] = payload.salesDiagnosis.likelyGaps
    .slice(0, 3)
    .map((gap, i) => ({
      id: `insight_gap_${i + 1}`,
      type: i === 0 ? ("warning" as const) : ("suggestion" as const),
      text: gap.label,
      priority: i === 0 ? ("high" as const) : ("medium" as const),
    }));

  if (focusBelief) {
    insights.push({
      id: "insight_focus",
      type: "next_step",
      text: `Focus next: ${focusBelief.label} — ${focusBelief.goal}`,
      relatedBelief: focusBelief.id,
      priority: "high",
    });
  }

  return {
    mode: "demo",
    statusLabel: "Prep preview — coaching goes live on your call",
    timer: "00:00",
    waveform: DEMO_WAVEFORM,
    insights,
    beliefProgress,
    nextSuggestedQuestion: {
      question: focusQuestion?.text ?? "What prompted you to take this call today?",
      reason:
        focusQuestion?.reason ??
        focusBelief?.goal ??
        "Open the conversation on their terms.",
    },
  };
}

/** Wrap a generated payload into the full SalesSession the UI renders. */
export function buildSessionFromPayload(
  payload: GeneratedPayload,
  input: GenerationInput
): SalesSession {
  const suffix = randomUUID().slice(0, 8);
  const timestamp = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

  const doc: SalesDoc = {
    documentMetadata: {
      id: `doc_${suffix}`,
      title: payload.title,
      status: "generated",
      generatedAt: "Just now",
      updatedAt: "Just now",
    },
    prospect: payload.prospect,
    sourceInputs: {
      prompt: input.prompt,
      ...(input.transcript
        ? {
            uploadedFiles: [
              {
                id: `upload_${suffix}`,
                name: "Pasted transcript",
                type: "transcript" as const,
              },
            ],
          }
        : {}),
    },
    callBrief: payload.callBrief,
    salesDiagnosis: payload.salesDiagnosis,
    beliefLadder: payload.beliefLadder,
    pitchScript: payload.pitchScript,
    objectionPrep: payload.objectionPrep,
    callFlow: payload.callFlow,
    nextBestQuestions: payload.nextBestQuestions,
    liveCoaching: deriveLiveCoaching(payload),
  };

  return {
    id: `session_${suffix}`,
    sidebarLabel: payload.sidebarLabel,
    lastActive: "Just now",
    doc,
    chat: {
      assistantIntro: payload.chat.assistantIntro,
      generatedChecklist: payload.chat.generatedChecklist,
      assistantOutro: payload.chat.assistantOutro,
      userTimestamp: timestamp,
      assistantTimestamp: timestamp,
    },
  };
}

function assertPayloadShape(raw: unknown): GeneratedPayload {
  const payload = raw as GeneratedPayload;
  const checks: Array<[string, boolean]> = [
    ["title", typeof payload?.title === "string" && payload.title.length > 0],
    ["sidebarLabel", typeof payload?.sidebarLabel === "string"],
    ["prospect", typeof payload?.prospect?.name === "string"],
    ["callBrief", Array.isArray(payload?.callBrief?.keyFacts)],
    ["salesDiagnosis", Array.isArray(payload?.salesDiagnosis?.likelyGaps)],
    [
      "beliefLadder",
      Array.isArray(payload?.beliefLadder) && payload.beliefLadder.length > 0,
    ],
    ["pitchScript", Array.isArray(payload?.pitchScript?.bridgePillars)],
    ["objectionPrep", Array.isArray(payload?.objectionPrep)],
    ["callFlow", Array.isArray(payload?.callFlow)],
    ["nextBestQuestions", Array.isArray(payload?.nextBestQuestions)],
    ["chat", Array.isArray(payload?.chat?.generatedChecklist)],
  ];

  const missing = checks.filter(([, ok]) => !ok).map(([field]) => field);
  if (missing.length > 0) {
    throw new SalesDocGenerationError(
      `Model output failed contract validation: ${missing.join(", ")}`
    );
  }

  // Keep the ladder in canonical order regardless of how the model emitted it.
  payload.beliefLadder = [...payload.beliefLadder].sort(
    (a, b) =>
      BELIEF_IDS.indexOf(a.id) - BELIEF_IDS.indexOf(b.id) ||
      BELIEF_STATUS_RANK[a.status] - BELIEF_STATUS_RANK[b.status]
  );

  return payload;
}

export async function generateSalesDoc(
  input: GenerationInput
): Promise<SalesSession> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) {
    throw new SalesDocGenerationError("ANTHROPIC_API_KEY is not configured.");
  }

  const client = new Anthropic({ apiKey });

  const userContent = input.transcript
    ? `${input.prompt}\n\n<call_transcript>\n${input.transcript}\n</call_transcript>`
    : input.prompt;

  const stream = client.messages.stream({
    model: GENERATION_MODEL,
    max_tokens: MAX_OUTPUT_TOKENS,
    system: SYSTEM_PROMPT,
    thinking: { type: "adaptive" },
    output_config: {
      format: {
        type: "json_schema",
        schema: GENERATION_SCHEMA as unknown as Record<string, unknown>,
      },
    },
    messages: [{ role: "user", content: userContent }],
  });

  let response: Awaited<ReturnType<typeof stream.finalMessage>>;
  try {
    response = await stream.finalMessage();
  } catch (error) {
    if (error instanceof Anthropic.APIError) {
      const body = error.error as
        | { error?: { message?: string } }
        | undefined;
      const detail = body?.error?.message ?? error.message;
      throw new SalesDocGenerationError(
        `Anthropic API error (${error.status ?? "network"}): ${detail}`
      );
    }
    throw error;
  }

  if (response.stop_reason === "max_tokens") {
    throw new SalesDocGenerationError(
      "Generation ran out of output tokens before completing the document."
    );
  }
  if (response.stop_reason === "refusal") {
    throw new SalesDocGenerationError(
      "The model declined to generate a document for this input."
    );
  }

  const text = response.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();

  if (!text) {
    throw new SalesDocGenerationError("Model returned no document content.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SalesDocGenerationError("Model returned invalid JSON.");
  }

  return buildSessionFromPayload(assertPayloadShape(parsed), input);
}
