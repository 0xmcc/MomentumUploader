import { act, fireEvent, render, screen, within } from "@testing-library/react";
import SalesDocsWorkspace from "./SalesDocsWorkspace";
import { mockSessions, staticRecentSessions } from "@/data/mockSalesDoc";
import type { SalesSession } from "@/data/salesDocTypes";

jest.mock("./sales-docs.css", () => ({}));

function renderWorkspace(initialPrompt?: string, animated = false) {
  return render(
    <SalesDocsWorkspace
      sessions={mockSessions}
      staticSessions={staticRecentSessions}
      animated={animated}
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
  const initialPrompt = "Call tomorrow with Jamie, agency owner at $5k";
  const generatedSession: SalesSession = {
    ...mockSessions[1],
    id: "session_generated",
    sidebarLabel: "Jamie — Agency Owner",
    chat: {
      ...mockSessions[1].chat,
      assistantIntro: "Here's your tailored prep for Jamie:",
    },
    doc: {
      ...mockSessions[1].doc,
      documentMetadata: {
        ...mockSessions[1].doc.documentMetadata,
        id: "doc_generated",
        title: "Jamie — Agency Owner Call Prep",
      },
      sourceInputs: { prompt: initialPrompt },
    },
  };

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

  it("auto-generates from the landing prompt while hiding stale workspace content", async () => {
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

    expect(screen.getByTestId("sales-docs-generating-canvas")).toBeInTheDocument();
    expect(
      screen.queryByText(mockSessions[0].doc.documentMetadata.title)
    ).not.toBeInTheDocument();
    expect(screen.getByText("New session")).toBeInTheDocument();
    expect(screen.getByText("Generating…")).toBeInTheDocument();
    expect(
      within(screen.getByTestId("sales-docs-live-rail")).getByText("Standing by")
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("sales-docs-live-rail")).getByText(
        "Real-time insights will appear once your prep doc is ready."
      )
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
    expect(screen.queryByTestId("sales-docs-generating-canvas")).not.toBeInTheDocument();
    expect(
      screen.getAllByText(generatedSession.doc.documentMetadata.title).length
    ).toBeGreaterThan(0);
    expect(screen.queryByText("Generating…")).not.toBeInTheDocument();
  });

  it("does not call the generation endpoint without an initial prompt", () => {
    renderWorkspace();
    expect(global.fetch).not.toHaveBeenCalled();
  });
});

describe("SalesDocsWorkspace in-flight generation canvas", () => {
  const originalFetch = global.fetch;
  let resolveFetch: (value: unknown) => void;

  const composerPrompt = "Prep a discovery call with Casey at a B2B SaaS startup";
  const composerGeneratedSession: SalesSession = {
    ...mockSessions[1],
    id: "session_composer_generated",
    sidebarLabel: "Casey — B2B SaaS",
    doc: {
      ...mockSessions[1].doc,
      documentMetadata: {
        ...mockSessions[1].doc.documentMetadata,
        id: "doc_composer_generated",
        title: "Casey — B2B SaaS Call Prep",
      },
      sourceInputs: { prompt: composerPrompt },
    },
  };

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

  function submitComposerPrompt(prompt = composerPrompt) {
    // animated must be on: the composer is inert in the landing-page mockup.
    renderWorkspace(undefined, true);

    const chatRail = screen.getByTestId("sales-docs-chat-rail");
    fireEvent.change(
      within(chatRail).getByPlaceholderText("Describe your client or situation..."),
      { target: { value: prompt } }
    );
    fireEvent.click(
      within(chatRail).getByRole("button", {
        name: "Generate call prep document",
      })
    );
  }

  it("shows the generating canvas for composer-initiated generations", async () => {
    submitComposerPrompt();

    expect(global.fetch).toHaveBeenCalledWith(
      "/api/sales-docs/generate",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ prompt: composerPrompt }),
      })
    );
    expect(screen.getByTestId("sales-docs-generating-canvas")).toBeInTheDocument();
    expect(
      screen.queryByText(mockSessions[0].doc.documentMetadata.title)
    ).not.toBeInTheDocument();

    await act(async () => {
      resolveFetch({
        ok: true,
        status: 200,
        json: async () => ({ session: composerGeneratedSession }),
      });
    });

    expect(screen.queryByTestId("sales-docs-generating-canvas")).not.toBeInTheDocument();
    expect(
      screen.getAllByText(composerGeneratedSession.doc.documentMetadata.title).length
    ).toBeGreaterThan(0);
  });

  it("lets users switch away from and back to the pending session while generation continues", () => {
    submitComposerPrompt();

    const sidebar = screen.getByTestId("sales-docs-sidebar-rail");
    expect(screen.getByTestId("sales-docs-generating-canvas")).toBeInTheDocument();

    fireEvent.click(
      within(sidebar).getByRole("button", {
        name: new RegExp(mockSessions[1].sidebarLabel),
      })
    );

    expect(screen.queryByTestId("sales-docs-generating-canvas")).not.toBeInTheDocument();
    expect(
      screen.getAllByText(mockSessions[1].doc.documentMetadata.title).length
    ).toBeGreaterThan(0);
    expect(within(sidebar).getByText("New session")).toBeInTheDocument();
    expect(within(sidebar).getByText("Generating…")).toBeInTheDocument();

    fireEvent.click(
      within(sidebar).getByRole("button", { name: /New session\s+Generating…/ })
    );

    expect(screen.getByTestId("sales-docs-generating-canvas")).toBeInTheDocument();
    expect(
      screen.queryByText(mockSessions[1].doc.documentMetadata.title)
    ).not.toBeInTheDocument();
  });

  it("removes the generating canvas and restores the previous document on generation failure", async () => {
    submitComposerPrompt("Prep a failed generation case");

    expect(screen.getByTestId("sales-docs-generating-canvas")).toBeInTheDocument();

    await act(async () => {
      resolveFetch({
        ok: false,
        status: 500,
        json: async () => ({ error: "Model unavailable" }),
      });
    });

    expect(screen.queryByTestId("sales-docs-generating-canvas")).not.toBeInTheDocument();
    expect(
      screen.getAllByText(mockSessions[0].doc.documentMetadata.title).length
    ).toBeGreaterThan(0);
    expect(screen.getByText("Model unavailable")).toBeInTheDocument();
  });
});
