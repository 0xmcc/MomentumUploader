import { fireEvent, render, screen, within } from "@testing-library/react";
import SalesDocsWorkspace from "./SalesDocsWorkspace";
import { mockSessions, staticRecentSessions } from "@/data/mockSalesDoc";

jest.mock("./sales-docs.css", () => ({}));

function renderWorkspace() {
  return render(
    <SalesDocsWorkspace
      sessions={mockSessions}
      staticSessions={staticRecentSessions}
      animated={false}
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
