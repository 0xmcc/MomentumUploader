/** @jest-environment node */

import { NextRequest } from "next/server";
import { POST } from "./route";
import {
  generateSalesDoc,
  SalesDocGenerationError,
} from "@/lib/sales-doc-generation";
import { saveSalesDocSession } from "@/lib/sales-doc-sessions";

jest.mock("@/lib/sales-doc-generation", () => {
  class SalesDocGenerationError extends Error {}
  return {
    generateSalesDoc: jest.fn(),
    SalesDocGenerationError,
  };
});

jest.mock("@/lib/sales-doc-sessions", () => ({
  saveSalesDocSession: jest.fn(),
}));

function makeRequest(body: unknown) {
  return {
    json: jest.fn().mockResolvedValue(body),
  } as unknown as NextRequest;
}

describe("POST /api/sales-docs/generate", () => {
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
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
    expect(saveSalesDocSession).toHaveBeenCalledWith(
      { id: "session_abc" },
      {
        prompt: "Discovery call with Alex.",
        transcript: undefined,
      }
    );
    await expect(res.json()).resolves.toEqual({
      session: { id: "session_abc" },
    });
  });

  it("still returns the generated session when persistence fails", async () => {
    (generateSalesDoc as jest.Mock).mockResolvedValue({ id: "session_abc" });
    (saveSalesDocSession as jest.Mock).mockRejectedValue(new Error("db down"));

    const res = await POST(
      makeRequest({ prompt: "Discovery call.", transcript: "Call notes" })
    );

    expect(res.status).toBe(200);
    expect(saveSalesDocSession).toHaveBeenCalledWith(
      { id: "session_abc" },
      {
        prompt: "Discovery call.",
        transcript: "Call notes",
      }
    );
    expect(errorSpy).toHaveBeenCalledWith(
      "[sales-docs/generate] failed to persist session",
      expect.any(Error)
    );
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
