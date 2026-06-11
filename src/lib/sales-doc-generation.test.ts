/** @jest-environment node */

import {
  buildSessionFromPayload,
  deriveLiveCoaching,
  type GeneratedPayload,
} from "./sales-doc-generation";

function makePayload(): GeneratedPayload {
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
      summary: "Summary.",
      objective: "Objective.",
      keyFacts: [{ label: "Business", value: "Fitness Coaching" }],
    },
    salesDiagnosis: {
      title: "Sales Diagnosis",
      summary: "Summary.",
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
        questions: [{ id: "pain_q1", text: "What happened?", priority: "high" }],
      },
      {
        id: "doubt",
        label: "Doubt",
        status: "needs_work",
        goal: "Show effort alone has not worked.",
        questions: [
          { id: "doubt_q1", text: "What have you tried?", priority: "medium" },
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
        questions: [{ id: "cost_q1", text: "What does it cost?", priority: "high" }],
      },
    ],
    pitchScript: {
      highLevelPromise: { title: "Promise", script: "Script.", coachNotes: [] },
      bridgePillars: [
        { id: "pillar_1", title: "Pillar", script: "Script.", coachNotes: ["Note"] },
      ],
      delivery: { title: "Delivery", script: "Script.", coachNotes: [] },
    },
    objectionPrep: [
      {
        id: "obj_1",
        objection: "Too expensive.",
        likelyMeaning: "Priority objection.",
        isolateQuestion: "Is it the price?",
        recommendedResponse: "Reframe.",
      },
    ],
    callFlow: [{ id: "flow_1", step: "Open", goal: "Set frame.", talkTrack: "Hi." }],
    nextBestQuestions: [
      { id: "nbq_1", question: "Why now?", why: "Urgency.", useCase: "discovery" },
    ],
    chat: {
      assistantIntro: "Got it.",
      generatedChecklist: ["Call brief generated"],
      assistantOutro: "Review before the call.",
    },
  };
}

describe("deriveLiveCoaching", () => {
  it("maps belief statuses to progress with a single active belief", () => {
    const coaching = deriveLiveCoaching(makePayload());

    expect(coaching.mode).toBe("demo");
    expect(coaching.beliefProgress).toEqual([
      { beliefId: "pain", label: "Pain", status: "complete" },
      { beliefId: "doubt", label: "Doubt", status: "active" },
      { beliefId: "cost", label: "Cost", status: "incomplete" },
    ]);
  });

  it("targets the active belief's high-priority question", () => {
    const coaching = deriveLiveCoaching(makePayload());

    expect(coaching.nextSuggestedQuestion.question).toBe("Why didn't it stick?");
    expect(coaching.nextSuggestedQuestion.reason).toBe(
      "Failed attempts are evidence."
    );
  });

  it("builds insights from diagnosis gaps plus a focus next-step", () => {
    const coaching = deriveLiveCoaching(makePayload());

    expect(coaching.insights.map((i) => i.type)).toEqual([
      "warning",
      "suggestion",
      "next_step",
    ]);
    expect(coaching.insights.at(-1)?.relatedBelief).toBe("doubt");
  });
});

describe("buildSessionFromPayload", () => {
  it("assembles a renderable SalesSession around the payload", () => {
    const session = buildSessionFromPayload(makePayload(), {
      prompt: "Discovery call with Alex tomorrow.",
    });

    expect(session.id).toMatch(/^session_/);
    expect(session.sidebarLabel).toBe("Fitness Coach — Discovery");
    expect(session.lastActive).toBe("Just now");
    expect(session.doc.documentMetadata.status).toBe("generated");
    expect(session.doc.sourceInputs.prompt).toBe(
      "Discovery call with Alex tomorrow."
    );
    expect(session.doc.sourceInputs.uploadedFiles).toBeUndefined();
    expect(session.doc.beliefLadder).toHaveLength(3);
    expect(session.chat.assistantIntro).toBe("Got it.");
    expect(session.chat.userTimestamp).toBeTruthy();
  });

  it("records a transcript upload when one was provided", () => {
    const session = buildSessionFromPayload(makePayload(), {
      prompt: "Prep from this call.",
      transcript: "Prospect: we keep losing deals...",
    });

    expect(session.doc.sourceInputs.uploadedFiles).toEqual([
      expect.objectContaining({ type: "transcript" }),
    ]);
  });
});
