/** @jest-environment node */

import { buildSessionFromPayload, deriveLiveCoaching } from "./sales-doc-generation";
import { makeGeneratedPayload as makePayload } from "./sales-doc-generation.fixtures";

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
    expect(session.chat.assistantIntro).toBe("Got it — building your prep doc now.");
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
