import { act, fireEvent, render, screen, within } from "@testing-library/react";
import SalesDocsWorkspace from "./SalesDocsWorkspace";
import { mockSessions, staticRecentSessions } from "@/data/mockSalesDoc";

jest.mock("./sales-docs.css", () => ({}));

function renderWorkspace(initialPrompt?: string) {
  return render(
    <SalesDocsWorkspace
      sessions={mockSessions}
      staticSessions={staticRecentSessions}
      animated={false}
      initialPrompt={initialPrompt}
    />
  );
}

describe("SalesDocsWorkspace responsive shell", () => {
  it("keeps desktop rails while defining breakpoint collapse wrappers", () => {
    renderWorkspace();

    expect(screen.getByTestId("sales-docs-sidebar-rail")).toHaveClass(
      "hidden",
      "lg:contents"
    );
    expect(screen.getByTestId("sales-docs-chat-rail")).toHaveClass(
      "hidden",
      "md:contents"
    );
    expect(screen.getByTestId("sales-docs-live-rail")).toHaveClass(
      "hidden",
      "xl:contents"
    );
  });

  it("opens and closes responsive overlay drawers without forking panel content", () => {
    renderWorkspace();

    fireEvent.click(screen.getByRole("button", { name: "Open navigation" }));
    expect(screen.getByTestId("sales-docs-sidebar-drawer")).toHaveClass(
      "lg:hidden"
    );
    expect(
      within(screen.getByTestId("sales-docs-sidebar-drawer")).getByText(
        "Sales Docs"
      )
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close navigation" }));
    expect(screen.queryByTestId("sales-docs-sidebar-drawer")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open live coaching" }));
    expect(screen.getByTestId("sales-docs-live-drawer")).toHaveClass(
      "xl:hidden"
    );
    expect(
      within(screen.getByTestId("sales-docs-live-drawer")).getByText(
        "Next Best Question"
      )
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close live coaching" }));
    expect(screen.queryByTestId("sales-docs-live-drawer")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Open assistant" }));
    expect(screen.getByTestId("sales-docs-chat-drawer")).toHaveClass(
      "md:hidden"
    );
    expect(
      within(screen.getByTestId("sales-docs-chat-drawer")).getByPlaceholderText(
        "Describe your client or situation..."
      )
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Close assistant" }));
    expect(screen.queryByTestId("sales-docs-chat-drawer")).not.toBeInTheDocument();
  });
});

describe("SalesDocsWorkspace initial prompt seeding", () => {
  const originalFetch = global.fetch;
  let resolveFetch: (value: unknown) => void;

  beforeEach(() => {
    global.fetch = jest.fn(
      () =>
        new Promise((resolve) => {
          resolveFetch = resolve;
        })
    ) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("auto-generates from the landing prompt, showing it as the first chat message", async () => {
    const initialPrompt = "Call tomorrow with Jamie, agency owner at $5k";
    const generatedSession = {
      ...mockSessions[1],
      id: "session_generated",
      sidebarLabel: "Jamie — Agency Owner",
      chat: {
        ...mockSessions[1].chat,
        assistantIntro: "Here's your tailored prep for Jamie:",
      },
      doc: {
        ...mockSessions[1].doc,
        sourceInputs: { prompt: initialPrompt },
      },
    };

    renderWorkspace(initialPrompt);

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/sales-docs/generate",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ prompt: initialPrompt }),
      })
    );

    // The user's prompt is the first chat message; the prior mock session's
    // chat transcript must not appear above it.
    const chatRail = screen.getByTestId("sales-docs-chat-rail");
    expect(within(chatRail).getByText(initialPrompt)).toBeInTheDocument();
    expect(
      within(chatRail).queryByText(mockSessions[0].chat.assistantIntro)
    ).not.toBeInTheDocument();
    expect(
      within(chatRail).queryByText(mockSessions[0].doc.sourceInputs.prompt)
    ).not.toBeInTheDocument();
    expect(
      within(chatRail).getByText(/Generating your call prep document/)
    ).toBeInTheDocument();

    await act(async () => {
      resolveFetch({
        ok: true,
        status: 200,
        json: async () => ({ session: generatedSession }),
      });
    });

    // The generated session becomes active: its chat starts with the prompt.
    expect(
      within(chatRail).getByText(generatedSession.chat.assistantIntro)
    ).toBeInTheDocument();
    expect(within(chatRail).getByText(initialPrompt)).toBeInTheDocument();
    expect(screen.getByText("Jamie — Agency Owner")).toBeInTheDocument();
  });

  it("does not call the generation endpoint without an initial prompt", () => {
    renderWorkspace();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
