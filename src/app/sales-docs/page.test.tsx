import { render, screen } from "@testing-library/react";
import SalesDocsPage, { dynamic } from "./page";
import SalesDocsWorkspace from "@/components/sales-docs/SalesDocsWorkspace";
import { listSalesDocSessions } from "@/lib/sales-doc-sessions";
import { mockSessions, staticRecentSessions } from "@/data/mockSalesDoc";

jest.mock("@/components/sales-docs/SalesDocsWorkspace", () => ({
  __esModule: true,
  default: jest.fn(() => <div data-testid="mock-sales-docs-workspace" />),
}));

jest.mock("@/lib/sales-doc-sessions", () => ({
  listSalesDocSessions: jest.fn(),
}));

describe("SalesDocsPage", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("is dynamic so Recent Sessions are fresh per request", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("passes persisted sessions when any exist", async () => {
    const persistedSessions = [
      { ...mockSessions[1], id: "session_saved", lastActive: "2h ago" },
    ];
    (listSalesDocSessions as jest.Mock).mockResolvedValue(persistedSessions);

    render(await SalesDocsPage());

    expect(screen.getByTestId("mock-sales-docs-workspace")).toBeInTheDocument();
    expect(listSalesDocSessions).toHaveBeenCalledWith();
    expect(SalesDocsWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        sessions: persistedSessions,
        staticSessions: [],
      }),
      undefined
    );
  });

  it("forwards the landing prompt to the workspace as initialPrompt", async () => {
    (listSalesDocSessions as jest.Mock).mockResolvedValue([]);

    render(
      await SalesDocsPage({
        searchParams: Promise.resolve({ prompt: "Prep me for Jamie" }),
      })
    );

    expect(SalesDocsWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({ initialPrompt: "Prep me for Jamie" }),
      undefined
    );
  });

  it("falls back to the mock spike sessions when none are persisted", async () => {
    (listSalesDocSessions as jest.Mock).mockResolvedValue([]);

    render(await SalesDocsPage());

    expect(SalesDocsWorkspace).toHaveBeenCalledWith(
      expect.objectContaining({
        sessions: mockSessions,
        staticSessions: staticRecentSessions,
      }),
      undefined
    );
  });

  it("falls back to the mock spike sessions when listing persisted sessions fails", async () => {
    const error = new Error("database unavailable");
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    (listSalesDocSessions as jest.Mock).mockRejectedValue(error);

    try {
      render(await SalesDocsPage());

      expect(SalesDocsWorkspace).toHaveBeenCalledWith(
        expect.objectContaining({
          sessions: mockSessions,
          staticSessions: staticRecentSessions,
        }),
        undefined
      );
      expect(errorSpy).toHaveBeenCalledWith(
        "[sales-docs] failed to list persisted sessions; falling back to mocks",
        error
      );
    } finally {
      errorSpy.mockRestore();
    }
  });
});
