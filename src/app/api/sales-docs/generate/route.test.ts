/** @jest-environment node */

import { NextRequest } from "next/server";
import { POST } from "./route";
import {
  generateSalesDoc,
  SalesDocGenerationError,
} from "@/lib/sales-doc-generation";

jest.mock("@/lib/sales-doc-generation", () => {
  class SalesDocGenerationError extends Error {}
  return {
    generateSalesDoc: jest.fn(),
    SalesDocGenerationError,
  };
});

function makeRequest(body: unknown) {
  return {
    json: jest.fn().mockResolvedValue(body),
  } as unknown as NextRequest;
}

describe("POST /api/sales-docs/generate", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("rejects an empty prompt", async () => {
    const res = await POST(makeRequest({ prompt: "   " }));

    expect(res.status).toBe(422);
    expect(generateSalesDoc).not.toHaveBeenCalled();
  });

  it("rejects an oversized prompt", async () => {
    const res = await POST(makeRequest({ prompt: "x".repeat(5_000) }));

    expect(res.status).toBe(422);
    expect(generateSalesDoc).not.toHaveBeenCalled();
  });

  it("returns the generated session", async () => {
    (generateSalesDoc as jest.Mock).mockResolvedValue({ id: "session_abc" });

    const res = await POST(
      makeRequest({ prompt: "Discovery call with Alex.", transcript: "  " })
    );

    expect(res.status).toBe(200);
    expect(generateSalesDoc).toHaveBeenCalledWith({
      prompt: "Discovery call with Alex.",
      transcript: undefined,
    });
    await expect(res.json()).resolves.toEqual({
      session: { id: "session_abc" },
    });
  });

  it("maps generation failures to 502 with the message", async () => {
    (generateSalesDoc as jest.Mock).mockRejectedValue(
      new SalesDocGenerationError("Model returned invalid JSON.")
    );

    const res = await POST(makeRequest({ prompt: "Discovery call." }));

    expect(res.status).toBe(502);
    await expect(res.json()).resolves.toEqual({
      error: "Model returned invalid JSON.",
    });
  });

  it("maps unexpected failures to 500", async () => {
    (generateSalesDoc as jest.Mock).mockRejectedValue(new Error("boom"));

    const res = await POST(makeRequest({ prompt: "Discovery call." }));

    expect(res.status).toBe(500);
  });
});
