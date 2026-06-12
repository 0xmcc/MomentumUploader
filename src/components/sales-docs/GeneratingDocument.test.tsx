import { act, render, screen } from "@testing-library/react";
import GeneratingDocument from "./GeneratingDocument";
import { OUTLINE } from "./ArtifactDocument";

jest.mock("./sales-docs.css", () => ({}));

describe("GeneratingDocument", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("renders the generating skeleton with disabled document actions", () => {
    jest.useFakeTimers();

    render(<GeneratingDocument animated={false} />);

    expect(screen.getByTestId("sales-docs-generating-canvas")).toBeInTheDocument();
    expect(screen.getByText("Generating your call prep…")).toBeInTheDocument();
    expect(screen.getByText("Summarizing the brief…")).toBeInTheDocument();

    for (const item of OUTLINE) {
      expect(screen.getByText(item.label)).toBeInTheDocument();
    }

    for (const label of ["Export", "Copy", "Regenerate", "Share"]) {
      const button = screen.getByRole("button", { name: label });
      expect(button).toBeDisabled();
      expect(button).toHaveClass("opacity-40");
    }

    expect(jest.getTimerCount()).toBe(0);

    act(() => {
      jest.advanceTimersByTime(7000);
    });

    expect(screen.getByText("Brief")).toHaveClass("text-[var(--sd-text)]");
    expect(screen.getByText("Summarizing the brief…")).toBeInTheDocument();
  });

  it("advances the active outline item and status message while animated", () => {
    jest.useFakeTimers();

    render(<GeneratingDocument animated={true} />);

    expect(screen.getByText("Brief")).toHaveClass("text-[var(--sd-text)]");
    expect(screen.getByText("Summarizing the brief…")).toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(7000);
    });

    expect(screen.getByText("Brief")).toHaveClass("text-[var(--sd-text-secondary)]");
    expect(screen.getByText("Diagnosis")).toHaveClass("text-[var(--sd-text)]");
    expect(screen.getByText("Diagnosing the call…")).toBeInTheDocument();
  });
});
