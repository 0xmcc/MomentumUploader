/** @jest-environment node */

const mockStream = jest.fn();
const mockFinalMessage = jest.fn();

jest.mock("@anthropic-ai/sdk", () => {
  class MockAPIError extends Error {
    status?: number;
    error?: unknown;
  }

  const MockAnthropic = Object.assign(
    jest.fn().mockImplementation(() => ({
      messages: {
        stream: mockStream,
      },
    })),
    { APIError: MockAPIError }
  );

  return {
    __esModule: true,
    default: MockAnthropic,
  };
});

import {
  assertPayloadShape,
  buildSessionFromPayload,
  deriveLiveCoaching,
  GENERATION_SCHEMA,
  generateSalesDoc,
  SalesDocGenerationError,
} from "./sales-doc-generation";
import { makeGeneratedPayload as makePayload } from "./sales-doc-generation.fixtures";

function collectForbiddenSchemaKeywords(
  value: unknown,
  parentKey?: string
): string[] {
  if (!value || typeof value !== "object") {
    return [];
  }

  return Object.entries(value).flatMap(([key, child]) => [
    ...(key === "enum" || (key === "description" && parentKey !== "properties")
      ? [key]
      : []),
    ...collectForbiddenSchemaKeywords(child, key),
  ]);
}

function makeAnthropicMessage(text: string) {
  return {
    stop_reason: "end_turn",
    content: [{ type: "text", text }],
  };
}

const originalApiKey = process.env.ANTHROPIC_API_KEY;

beforeEach(() => {
  process.env.ANTHROPIC_API_KEY = "test_api_key";
  mockFinalMessage.mockReset();
  mockStream.mockReset();
  mockStream.mockReturnValue({ finalMessage: mockFinalMessage });
});

afterAll(() => {
  if (originalApiKey === undefined) {
    delete process.env.ANTHROPIC_API_KEY;
  } else {
    process.env.ANTHROPIC_API_KEY = originalApiKey;
  }
});

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

describe("GENERATION_SCHEMA", () => {
  it("omits grammar-heavy descriptions and enum constraints", () => {
    expect(GENERATION_SCHEMA).toEqual(
      expect.objectContaining({ type: "object" })
    );
    expect(collectForbiddenSchemaKeywords(GENERATION_SCHEMA)).not.toEqual(
      expect.arrayContaining(["description", "enum"])
    );
  });
});

describe("assertPayloadShape", () => {
  it("rejects belief ids outside the SalesDoc contract", () => {
    const payload = makePayload();
    payload.beliefLadder[0] = {
      ...payload.beliefLadder[0],
      id: "timeline" as never,
    };

    expect(() => assertPayloadShape(payload)).toThrow(SalesDocGenerationError);
  });

  it("rejects string union values formerly enforced by schema enums", () => {
    const payload = makePayload();
    payload.beliefLadder[0] = {
      ...payload.beliefLadder[0],
      status: "done" as never,
    };
    payload.beliefLadder[1].questions[0] = {
      ...payload.beliefLadder[1].questions[0],
      priority: "urgent" as never,
    };
    payload.nextBestQuestions[0] = {
      ...payload.nextBestQuestions[0],
      useCase: "follow_up" as never,
    };

    expect(() => assertPayloadShape(payload)).toThrow(
      /beliefLadder\[0\]\.status|beliefLadder\[1\]\.questions\[0\]\.priority|nextBestQuestions\[0\]\.useCase/
    );
  });
});

describe("generateSalesDoc", () => {
  it("uses prompt-schema JSON output and strips markdown fences before parsing", async () => {
    mockFinalMessage.mockResolvedValueOnce(
      makeAnthropicMessage(`\`\`\`json\n${JSON.stringify(makePayload())}\n\`\`\``)
    );

    await expect(
      generateSalesDoc({ prompt: "Discovery call with Alex tomorrow." })
    ).resolves.toEqual(
      expect.objectContaining({ sidebarLabel: "Fitness Coach — Discovery" })
    );

    expect(mockStream).toHaveBeenCalledTimes(1);
    const request = mockStream.mock.calls[0][0];
    expect(request.output_config).toBeUndefined();
    expect(request.system).toContain("Output ONLY a single JSON object");
    expect(request.system).toContain('"beliefLadder"');
  });

  it("enumerates every runtime string union in the system prompt", async () => {
    mockFinalMessage.mockResolvedValueOnce(
      makeAnthropicMessage(JSON.stringify(makePayload()))
    );

    await generateSalesDoc({ prompt: "Discovery call with Alex tomorrow." });

    const request = mockStream.mock.calls[0][0];
    expect(request.system).toContain(
      "beliefLadder.id must be exactly one of: pain, doubt, cost, desire, money, support, trust"
    );
    expect(request.system).toContain(
      "beliefLadder.status must be exactly one of: covered, needs_work, not_covered"
    );
    expect(request.system).toContain(
      "beliefLadder.questions[].priority must be exactly one of: high, medium, low"
    );
    expect(request.system).toContain(
      "nextBestQuestions[].useCase must be exactly one of: discovery, objection, pitch, transition, closing"
    );
  });

  it("retries exactly once with the validation error when model JSON breaks the contract", async () => {
    const invalidPayload = makePayload();
    invalidPayload.beliefLadder[0] = {
      ...invalidPayload.beliefLadder[0],
      status: "done" as never,
    };

    mockFinalMessage
      .mockResolvedValueOnce(makeAnthropicMessage(JSON.stringify(invalidPayload)))
      .mockResolvedValueOnce(makeAnthropicMessage(JSON.stringify(makePayload())));

    await expect(
      generateSalesDoc({ prompt: "Discovery call with Alex tomorrow." })
    ).resolves.toEqual(
      expect.objectContaining({ sidebarLabel: "Fitness Coach — Discovery" })
    );

    expect(mockStream).toHaveBeenCalledTimes(2);
    expect(mockStream.mock.calls[1][0].messages[0].content).toContain(
      "Previous output failed validation"
    );
    expect(mockStream.mock.calls[1][0].messages[0].content).toContain(
      "beliefLadder[0].status"
    );
  });

  it("retries exactly once when model output is malformed JSON", async () => {
    mockFinalMessage
      .mockResolvedValueOnce(makeAnthropicMessage("{not valid json"))
      .mockResolvedValueOnce(makeAnthropicMessage(JSON.stringify(makePayload())));

    await expect(
      generateSalesDoc({ prompt: "Discovery call with Alex tomorrow." })
    ).resolves.toEqual(
      expect.objectContaining({ sidebarLabel: "Fitness Coach — Discovery" })
    );

    expect(mockStream).toHaveBeenCalledTimes(2);
    expect(mockStream.mock.calls[1][0].messages[0].content).toContain(
      "Previous output failed validation"
    );
    expect(mockStream.mock.calls[1][0].messages[0].content).toContain(
      "Model returned invalid JSON."
    );
  });
});
