import type { GeneratedPayload } from "./sales-doc-generation";

/**
 * Canonical GeneratedPayload fixture — the shape the generation model emits.
 * Shared by the assembly unit tests and the ArtifactDocument contract
 * regression test so pipeline output changes can't silently break the UI.
 */
export function makeGeneratedPayload(): GeneratedPayload {
  return {
    title: "Alex — Fitness Coach Discovery Call",
    sidebarLabel: "Fitness Coach — Discovery",
    prospect: {
      name: "Alex",
      businessType: "Fitness Coaching",
      offer: "1:1 Coaching",
      pricePoint: "$3,500",
      mainChallenge: "Low close rate",
      callGoal: "Close as ideal client",
      stage: "Discovery",
    },
    callBrief: {
      title: "Executive Call Brief",
      summary: "Alex converts only 10-15% of discovery calls.",
      objective: "Lock Pain, Doubt, and Cost before presenting.",
      keyFacts: [{ label: "Business", value: "Fitness Coaching" }],
    },
    salesDiagnosis: {
      title: "Sales Diagnosis",
      summary: "Process problem, not a traffic problem.",
      likelyGaps: [
        { label: "No discovery structure", description: "Jumps to pitch." },
        { label: "Pitching features", description: "Sells the program." },
      ],
    },
    beliefLadder: [
      {
        id: "pain",
        label: "Pain",
        status: "covered",
        goal: "Surface the core problem.",
        questions: [
          { id: "pain_q1", text: "Where did your last three calls fall apart?", priority: "high" },
        ],
      },
      {
        id: "doubt",
        label: "Doubt",
        status: "needs_work",
        goal: "Show effort alone has not worked.",
        questions: [
          { id: "doubt_q1", text: "What have you tried already?", priority: "medium" },
          {
            id: "doubt_q2",
            text: "Why didn't it stick?",
            priority: "high",
            reason: "Failed attempts are evidence.",
          },
        ],
      },
      {
        id: "cost",
        label: "Cost",
        status: "not_covered",
        goal: "Quantify staying stuck.",
        questions: [
          { id: "cost_q1", text: "What does another flat year cost you?", priority: "high" },
        ],
      },
    ],
    pitchScript: {
      highLevelPromise: {
        title: "High-Level Promise",
        script: "From improvised calls to a 30%+ close rate.",
        coachNotes: ["Deliver in under 15 seconds."],
      },
      bridgePillars: [
        {
          id: "pillar_1",
          title: "Pillar 1 — Position the offer",
          script: "Ideal clients self-select before the call.",
          coachNotes: ["Tie back to his Pain answer."],
        },
      ],
      delivery: {
        title: "Delivery",
        script: "Frameworks, scripts, and weekly call reviews.",
        coachNotes: [],
      },
    },
    objectionPrep: [
      {
        id: "obj_1",
        objection: "It's a lot of money.",
        likelyMeaning: "Comparing the price to doing nothing.",
        isolateQuestion: "Is it the amount, or how fast the return shows up?",
        recommendedResponse: "Two extra closes a month pays for this in 30 days.",
      },
    ],
    callFlow: [
      {
        id: "flow_1",
        step: "Frame",
        goal: "Set the agenda.",
        talkTrack: "By the end of this call we'll both know if this is a fit.",
      },
    ],
    nextBestQuestions: [
      {
        id: "nbq_1",
        question: "What's the cost of staying stuck another year?",
        why: "Cost is the weakest belief.",
        useCase: "discovery",
      },
    ],
    chat: {
      assistantIntro: "Got it — building your prep doc now.",
      generatedChecklist: ["Call brief generated"],
      assistantOutro: "Review the artifacts before the call.",
    },
  };
}
