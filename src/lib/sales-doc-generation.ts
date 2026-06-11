import Anthropic from "@anthropic-ai/sdk";
import { randomUUID } from "node:crypto";
import type { BeliefId, SalesDoc, SalesSession } from "@/data/salesDocTypes";

/**
 * SalesDoc generation pipeline: prompt/transcript in, SalesSession out.
 *
 * The model emits a `GeneratedPayload` (the prep content) as JSON, then
 * server-side validation enforces the contract before wrapping it into the full
 * `SalesDoc` — ids, timestamps, sourceInputs, and a derived `liveCoaching`
 * block (demo mode) so the UI renders with zero changes.
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

type AnthropicMessageResponse = {
  stop_reason: string | null;
  content: Array<{
    type: string;
    text?: string;
  }>;
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

const BELIEF_STATUSES = ["covered", "needs_work", "not_covered"] as const;
const QUESTION_PRIORITIES = ["high", "medium", "low"] as const;
const NEXT_BEST_QUESTION_USE_CASES = [
  "discovery",
  "objection",
  "pitch",
  "transition",
  "closing",
] as const;

const questionSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    text: { type: "string" },
    reason: { type: "string" },
    priority: { type: "string" },
  },
  required: ["id", "text", "priority"],
  additionalProperties: false,
} as const;

const scriptSectionSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    script: { type: "string" },
    coachNotes: { type: "array", items: { type: "string" } },
  },
  required: ["title", "script", "coachNotes"],
  additionalProperties: false,
} as const;

export const GENERATION_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    sidebarLabel: { type: "string" },
    prospect: {
      type: "object",
      properties: {
        name: { type: "string" },
        businessType: { type: "string" },
        offer: { type: "string" },
        pricePoint: { type: "string" },
        mainChallenge: { type: "string" },
        callGoal: { type: "string" },
        stage: { type: "string" },
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
          id: { type: "string" },
          label: { type: "string" },
          status: { type: "string" },
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
          objection: { type: "string" },
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
          useCase: { type: "string" },
        },
        required: ["id", "question", "why", "useCase"],
        additionalProperties: false,
      },
    },
    chat: {
      type: "object",
      properties: {
        assistantIntro: { type: "string" },
        generatedChecklist: {
          type: "array",
          items: { type: "string" },
        },
        assistantOutro: { type: "string" },
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
- title: document title, e.g. "Alex — Fitness Coach Discovery Call". sidebarLabel: short sidebar label, e.g. "Fitness Coach — Discovery". prospect.stage: short stage label, e.g. Discovery, Demo, Closing.
- beliefLadder MUST contain exactly 7 entries, one per belief, in this order: pain, doubt, cost, desire, money, support, trust. Use the labels Pain, Doubt, Cost, Desire, Money, Support, Trust.
- beliefLadder.id must be exactly one of: pain, doubt, cost, desire, money, support, trust.
- beliefLadder.status must be exactly one of: covered, needs_work, not_covered.
- beliefLadder.questions[].priority must be exactly one of: high, medium, low.
- nextBestQuestions[].useCase must be exactly one of: discovery, objection, pitch, transition, closing.
- Set each belief's status from the source input: "covered" if the input gives concrete evidence the belief is already established, "needs_work" if partially there, "not_covered" if the call must build it from scratch. Most beliefs should be "needs_work" or "not_covered" for a first call.
- 2-4 questions per belief. Make them sound like a real person talking, anchored in the prospect's own numbers and words. Add a "reason" only where it teaches the seller something non-obvious.
- pitchScript: write highLevelPromise, bridgePillars, and delivery scripts as verbatim talk tracks in the seller's voice. Use coachNotes for short tactical delivery notes.
- objectionPrep: 4-6 likely objections phrased in the prospect's words, what each really means, an isolating question, and a recommended response.
- callFlow: 5-7 steps from open to close, each with a goal and a short verbatim talk track.
- nextBestQuestions: 6-8 questions spread across useCases.
- callBrief.keyFacts: 4-6 label/value pairs (Business, Offer, Price, Main Challenge, Call Goal...). Values are short.
- Write like a sharp sales coach: direct, specific, conversational. Quantify the cost of inaction wherever the input gives you numbers. Never pad with generic filler.
- chat.assistantIntro: 1-2 sentences acknowledging what you were given. chat.generatedChecklist: 4-6 short past-tense labels (e.g. "Call brief generated", "Belief Ladder mapped (7 stages)"). chat.assistantOutro: 1-2 sentences on how to use the doc on the call.
- All ids: short unique snake_case strings.
- If a transcript is provided, mine it for the prospect's exact phrases, numbers, and objections — quote them in questions and scripts.`;

const SYSTEM_PROMPT_WITH_SCHEMA = `${SYSTEM_PROMPT}

Output ONLY a single JSON object that conforms to this JSON Schema. Do not include prose, markdown fences, or any text outside the JSON object.

JSON Schema:
${JSON.stringify(GENERATION_SCHEMA, null, 2)}`;

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

function fieldPath(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}

function itemPath(path: string, index: number): string {
  return `${path}[${index}]`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function expectRecord(
  value: unknown,
  path: string,
  allowedKeys: readonly string[],
  issues: string[]
): Record<string, unknown> | undefined {
  if (!isRecord(value)) {
    issues.push(path || "payload");
    return undefined;
  }

  for (const key of Object.keys(value)) {
    if (!allowedKeys.includes(key)) {
      issues.push(fieldPath(path, key));
    }
  }

  return value;
}

function expectString(value: unknown, path: string, issues: string[]): void {
  if (typeof value !== "string") {
    issues.push(path);
  }
}

function expectOptionalString(
  value: unknown,
  path: string,
  issues: string[]
): void {
  if (value !== undefined && typeof value !== "string") {
    issues.push(path);
  }
}

function expectStringField(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: string[]
): void {
  expectString(record[key], fieldPath(path, key), issues);
}

function expectOptionalStringField(
  record: Record<string, unknown>,
  key: string,
  path: string,
  issues: string[]
): void {
  expectOptionalString(record[key], fieldPath(path, key), issues);
}

function expectArray(
  value: unknown,
  path: string,
  issues: string[]
): unknown[] | undefined {
  if (!Array.isArray(value)) {
    issues.push(path);
    return undefined;
  }

  return value;
}

function expectStringArray(value: unknown, path: string, issues: string[]): void {
  const items = expectArray(value, path, issues);
  items?.forEach((item, index) => {
    expectString(item, itemPath(path, index), issues);
  });
}

function expectOneOf(
  value: unknown,
  path: string,
  allowed: readonly string[],
  issues: string[]
): void {
  if (typeof value !== "string" || !allowed.includes(value)) {
    issues.push(path);
  }
}

function validateQuestion(value: unknown, path: string, issues: string[]): void {
  const question = expectRecord(
    value,
    path,
    ["id", "text", "reason", "priority"],
    issues
  );
  if (!question) {
    return;
  }

  expectStringField(question, "id", path, issues);
  expectStringField(question, "text", path, issues);
  expectOptionalStringField(question, "reason", path, issues);
  expectOneOf(
    question.priority,
    fieldPath(path, "priority"),
    QUESTION_PRIORITIES,
    issues
  );
}

function validateScriptSection(
  value: unknown,
  path: string,
  issues: string[]
): void {
  const section = expectRecord(
    value,
    path,
    ["title", "script", "coachNotes"],
    issues
  );
  if (!section) {
    return;
  }

  expectStringField(section, "title", path, issues);
  expectStringField(section, "script", path, issues);
  expectStringArray(section.coachNotes, fieldPath(path, "coachNotes"), issues);
}

function validateGeneratedPayload(value: unknown): string[] {
  const issues: string[] = [];
  const payload = expectRecord(
    value,
    "",
    [
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
    issues
  );
  if (!payload) {
    return issues;
  }

  expectStringField(payload, "title", "", issues);
  expectStringField(payload, "sidebarLabel", "", issues);

  const prospect = expectRecord(
    payload.prospect,
    "prospect",
    [
      "name",
      "businessType",
      "offer",
      "pricePoint",
      "mainChallenge",
      "callGoal",
      "stage",
    ],
    issues
  );
  if (prospect) {
    for (const key of [
      "name",
      "businessType",
      "offer",
      "pricePoint",
      "mainChallenge",
      "callGoal",
      "stage",
    ]) {
      expectStringField(prospect, key, "prospect", issues);
    }
  }

  const callBrief = expectRecord(
    payload.callBrief,
    "callBrief",
    ["title", "summary", "objective", "keyFacts"],
    issues
  );
  if (callBrief) {
    expectStringField(callBrief, "title", "callBrief", issues);
    expectStringField(callBrief, "summary", "callBrief", issues);
    expectStringField(callBrief, "objective", "callBrief", issues);
    expectArray(callBrief.keyFacts, "callBrief.keyFacts", issues)?.forEach(
      (fact, index) => {
        const factPath = itemPath("callBrief.keyFacts", index);
        const factRecord = expectRecord(
          fact,
          factPath,
          ["label", "value"],
          issues
        );
        if (factRecord) {
          expectStringField(factRecord, "label", factPath, issues);
          expectStringField(factRecord, "value", factPath, issues);
        }
      }
    );
  }

  const diagnosis = expectRecord(
    payload.salesDiagnosis,
    "salesDiagnosis",
    ["title", "summary", "likelyGaps"],
    issues
  );
  if (diagnosis) {
    expectStringField(diagnosis, "title", "salesDiagnosis", issues);
    expectStringField(diagnosis, "summary", "salesDiagnosis", issues);
    expectArray(
      diagnosis.likelyGaps,
      "salesDiagnosis.likelyGaps",
      issues
    )?.forEach((gap, index) => {
      const gapPath = itemPath("salesDiagnosis.likelyGaps", index);
      const gapRecord = expectRecord(
        gap,
        gapPath,
        ["label", "description"],
        issues
      );
      if (gapRecord) {
        expectStringField(gapRecord, "label", gapPath, issues);
        expectStringField(gapRecord, "description", gapPath, issues);
      }
    });
  }

  expectArray(payload.beliefLadder, "beliefLadder", issues)?.forEach(
    (belief, index) => {
      const beliefPath = itemPath("beliefLadder", index);
      const beliefRecord = expectRecord(
        belief,
        beliefPath,
        ["id", "label", "status", "goal", "questions"],
        issues
      );
      if (!beliefRecord) {
        return;
      }

      expectOneOf(
        beliefRecord.id,
        fieldPath(beliefPath, "id"),
        BELIEF_IDS,
        issues
      );
      expectStringField(beliefRecord, "label", beliefPath, issues);
      expectOneOf(
        beliefRecord.status,
        fieldPath(beliefPath, "status"),
        BELIEF_STATUSES,
        issues
      );
      expectStringField(beliefRecord, "goal", beliefPath, issues);
      expectArray(
        beliefRecord.questions,
        fieldPath(beliefPath, "questions"),
        issues
      )?.forEach((question, questionIndex) => {
        validateQuestion(
          question,
          itemPath(fieldPath(beliefPath, "questions"), questionIndex),
          issues
        );
      });
    }
  );

  const pitchScript = expectRecord(
    payload.pitchScript,
    "pitchScript",
    ["highLevelPromise", "bridgePillars", "delivery"],
    issues
  );
  if (pitchScript) {
    validateScriptSection(
      pitchScript.highLevelPromise,
      "pitchScript.highLevelPromise",
      issues
    );
    expectArray(
      pitchScript.bridgePillars,
      "pitchScript.bridgePillars",
      issues
    )?.forEach((pillar, index) => {
      const pillarPath = itemPath("pitchScript.bridgePillars", index);
      const pillarRecord = expectRecord(
        pillar,
        pillarPath,
        ["id", "title", "script", "coachNotes"],
        issues
      );
      if (pillarRecord) {
        expectStringField(pillarRecord, "id", pillarPath, issues);
        expectStringField(pillarRecord, "title", pillarPath, issues);
        expectStringField(pillarRecord, "script", pillarPath, issues);
        expectStringArray(
          pillarRecord.coachNotes,
          fieldPath(pillarPath, "coachNotes"),
          issues
        );
      }
    });
    validateScriptSection(
      pitchScript.delivery,
      "pitchScript.delivery",
      issues
    );
  }

  expectArray(payload.objectionPrep, "objectionPrep", issues)?.forEach(
    (objection, index) => {
      const objectionPath = itemPath("objectionPrep", index);
      const objectionRecord = expectRecord(
        objection,
        objectionPath,
        [
          "id",
          "objection",
          "likelyMeaning",
          "isolateQuestion",
          "recommendedResponse",
          "fallbackQuestion",
        ],
        issues
      );
      if (!objectionRecord) {
        return;
      }

      for (const key of [
        "id",
        "objection",
        "likelyMeaning",
        "isolateQuestion",
        "recommendedResponse",
      ]) {
        expectStringField(objectionRecord, key, objectionPath, issues);
      }
      expectOptionalStringField(
        objectionRecord,
        "fallbackQuestion",
        objectionPath,
        issues
      );
    }
  );

  expectArray(payload.callFlow, "callFlow", issues)?.forEach((step, index) => {
    const stepPath = itemPath("callFlow", index);
    const stepRecord = expectRecord(
      step,
      stepPath,
      ["id", "step", "goal", "talkTrack"],
      issues
    );
    if (!stepRecord) {
      return;
    }

    for (const key of ["id", "step", "goal", "talkTrack"]) {
      expectStringField(stepRecord, key, stepPath, issues);
    }
  });

  expectArray(
    payload.nextBestQuestions,
    "nextBestQuestions",
    issues
  )?.forEach((question, index) => {
    const questionPath = itemPath("nextBestQuestions", index);
    const questionRecord = expectRecord(
      question,
      questionPath,
      ["id", "question", "why", "useCase"],
      issues
    );
    if (!questionRecord) {
      return;
    }

    expectStringField(questionRecord, "id", questionPath, issues);
    expectStringField(questionRecord, "question", questionPath, issues);
    expectStringField(questionRecord, "why", questionPath, issues);
    expectOneOf(
      questionRecord.useCase,
      fieldPath(questionPath, "useCase"),
      NEXT_BEST_QUESTION_USE_CASES,
      issues
    );
  });

  const chat = expectRecord(
    payload.chat,
    "chat",
    ["assistantIntro", "generatedChecklist", "assistantOutro"],
    issues
  );
  if (chat) {
    expectStringField(chat, "assistantIntro", "chat", issues);
    expectStringArray(
      chat.generatedChecklist,
      "chat.generatedChecklist",
      issues
    );
    expectStringField(chat, "assistantOutro", "chat", issues);
  }

  return issues;
}

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

export function assertPayloadShape(raw: unknown): GeneratedPayload {
  const payload = raw as GeneratedPayload;
  const issues = validateGeneratedPayload(raw);
  if (issues.length > 0) {
    throw new SalesDocGenerationError(
      `Model output failed contract validation: ${issues.join(", ")}`
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

function stripMarkdownFences(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match?.[1].trim() ?? trimmed;
}

function shouldRetryGenerationError(error: unknown): error is SalesDocGenerationError {
  return (
    error instanceof SalesDocGenerationError &&
    (error.message === "Model returned invalid JSON." ||
      error.message.startsWith("Model output failed contract validation:"))
  );
}

async function requestGeneratedPayload(
  client: Anthropic,
  userContent: string
): Promise<GeneratedPayload> {
  let response: AnthropicMessageResponse;
  try {
    const stream = client.messages.stream({
      model: GENERATION_MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system: SYSTEM_PROMPT_WITH_SCHEMA,
      thinking: { type: "adaptive" },
      messages: [{ role: "user", content: userContent }],
    });
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

  const text = stripMarkdownFences(
    response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("")
  );

  if (!text) {
    throw new SalesDocGenerationError("Model returned no document content.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SalesDocGenerationError("Model returned invalid JSON.");
  }

  return assertPayloadShape(parsed);
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

  let payload: GeneratedPayload;
  try {
    payload = await requestGeneratedPayload(client, userContent);
  } catch (error) {
    if (!shouldRetryGenerationError(error)) {
      throw error;
    }

    payload = await requestGeneratedPayload(
      client,
      `${userContent}

Previous output failed validation:
${error.message}

Regenerate the full JSON object. Fix the validation error and output ONLY the corrected JSON object.`
    );
  }

  return buildSessionFromPayload(payload, input);
}
