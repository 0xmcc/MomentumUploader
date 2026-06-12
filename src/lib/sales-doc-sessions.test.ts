/** @jest-environment node */

import {
  listSalesDocSessions,
  saveSalesDocSession,
} from "@/lib/sales-doc-sessions";
import { supabaseAdmin } from "@/lib/supabase";
import { mockSessions } from "@/data/mockSalesDoc";

jest.mock("@/lib/supabase");

describe("sales-doc-sessions", () => {
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    errorSpy.mockRestore();
    jest.useRealTimers();
  });

  it("saves the full SalesSession JSON with scalar lookup columns", async () => {
    const upsert = jest.fn().mockResolvedValue({ data: null, error: null });
    const insert = jest.fn().mockResolvedValue({ data: null, error: null });
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === "users") {
        return { upsert };
      }
      return { insert };
    });

    await saveSalesDocSession(mockSessions[0], {
      prompt: "Discovery call with Alex.",
      transcript: "Alex: close rate is low.",
      userId: "user_sales_123",
    });

    expect(supabaseAdmin.from).toHaveBeenCalledWith("users");
    expect(supabaseAdmin.from).toHaveBeenCalledWith("sales_doc_sessions");
    expect(upsert).toHaveBeenCalledWith(
      { id: "user_sales_123" },
      { onConflict: "id", ignoreDuplicates: true }
    );
    expect(upsert.mock.invocationCallOrder[0]).toBeLessThan(
      insert.mock.invocationCallOrder[0]
    );
    expect(insert).toHaveBeenCalledWith({
      id: mockSessions[0].id,
      title: mockSessions[0].doc.documentMetadata.title,
      sidebar_label: mockSessions[0].sidebarLabel,
      prompt: "Discovery call with Alex.",
      transcript: "Alex: close rate is low.",
      session_json: mockSessions[0],
      user_id: "user_sales_123",
    });
  });

  it("logs user provisioning failures and still attempts the session insert", async () => {
    const upsertError = { code: "23503", message: "user provision failed" };
    const upsert = jest.fn().mockResolvedValue({ data: null, error: upsertError });
    const insert = jest.fn().mockResolvedValue({ data: null, error: null });
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === "users") {
        return { upsert };
      }
      return { insert };
    });

    await expect(
      saveSalesDocSession(mockSessions[0], {
        prompt: "Discovery call with Alex.",
        userId: "user_sales_123",
      })
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(
      "[sales-doc-sessions] failed to provision user",
      { userId: "user_sales_123", error: upsertError }
    );
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: "user_sales_123" })
    );
  });

  it("does not throw when saving before the migration has been applied", async () => {
    const upsert = jest.fn().mockResolvedValue({ data: null, error: null });
    const insert = jest.fn().mockResolvedValue({
      data: null,
      error: {
        code: "42P01",
        message: 'relation "public.sales_doc_sessions" does not exist',
      },
    });
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === "users") {
        return { upsert };
      }
      return { insert };
    });

    await expect(
      saveSalesDocSession(mockSessions[0], {
        prompt: "Discovery call with Alex.",
        userId: "user_sales_123",
      })
    ).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledWith(
      "[sales-doc-sessions] sales_doc_sessions table is missing; skipping save"
    );
  });

  it("throws non-compat save errors", async () => {
    const error = { code: "23505", message: "duplicate key" };
    const upsert = jest.fn().mockResolvedValue({ data: null, error: null });
    const insert = jest.fn().mockResolvedValue({ data: null, error });
    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === "users") {
        return { upsert };
      }
      return { insert };
    });

    await expect(
      saveSalesDocSession(mockSessions[0], {
        prompt: "Discovery call with Alex.",
        userId: "user_sales_123",
      })
    ).rejects.toEqual(error);
  });

  it("lists newest sessions and recomputes lastActive from created_at", async () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-06-11T15:00:00.000Z"));
    const limit = jest.fn().mockResolvedValue({
      data: [
        {
          session_json: { ...mockSessions[0], lastActive: "stale label" },
          created_at: "2026-06-11T13:00:00.000Z",
        },
        {
          session_json: { ...mockSessions[1], lastActive: "stale label" },
          created_at: "2026-06-08T15:00:00.000Z",
        },
      ],
      error: null,
    });
    const order = jest.fn(() => ({ limit }));
    const eq = jest.fn(() => ({ order }));
    const select = jest.fn(() => ({ eq }));
    (supabaseAdmin.from as jest.Mock).mockReturnValue({ select });

    const sessions = await listSalesDocSessions("user_sales_123", 2);

    expect(supabaseAdmin.from).toHaveBeenCalledWith("sales_doc_sessions");
    expect(select).toHaveBeenCalledWith("session_json, created_at");
    expect(eq).toHaveBeenCalledWith("user_id", "user_sales_123");
    expect(order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(limit).toHaveBeenCalledWith(2);
    expect(sessions).toEqual([
      { ...mockSessions[0], lastActive: "2h ago" },
      { ...mockSessions[1], lastActive: "3d ago" },
    ]);
  });

  it("returns an empty list when listing before the migration has been applied", async () => {
    const limit = jest.fn().mockResolvedValue({
      data: null,
      error: {
        code: "PGRST205",
        message:
          "Could not find the table 'sales_doc_sessions' in the schema cache",
      },
    });
    const order = jest.fn(() => ({ limit }));
    const eq = jest.fn(() => ({ order }));
    const select = jest.fn(() => ({ eq }));
    (supabaseAdmin.from as jest.Mock).mockReturnValue({ select });

    await expect(listSalesDocSessions("user_sales_123")).resolves.toEqual([]);
    expect(eq).toHaveBeenCalledWith("user_id", "user_sales_123");
    expect(warnSpy).toHaveBeenCalledWith(
      "[sales-doc-sessions] sales_doc_sessions table is missing; returning no sessions"
    );
  });
});
