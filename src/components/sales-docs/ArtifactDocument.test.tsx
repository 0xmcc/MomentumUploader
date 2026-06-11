import { act, fireEvent, render, screen } from "@testing-library/react";
import ArtifactDocument from "./ArtifactDocument";
import LiveCoachingPanel from "./LiveCoachingPanel";
import { buildSessionFromPayload } from "@/lib/sales-doc-generation";
import { makeGeneratedPayload } from "@/lib/sales-doc-generation.fixtures";

/**
 * Contract regression test: a generation-pipeline payload, assembled into a
 * SalesSession, must render through the real canvas components. If the
 * pipeline's output shape drifts from what the UI dereferences, this fails
 * before a live generation ever does.
 */
describe("generated SalesDoc rendering contract", () => {
  const session = buildSessionFromPayload(makeGeneratedPayload(), {
    prompt: "Discovery call with Alex tomorrow.",
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  function mockClipboard(writeText: jest.Mock<Promise<void>, [string]>) {
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
  }

  it("renders every document section from a generated payload", () => {
    render(<ArtifactDocument doc={session.doc} />);

    // Header + brief
    expect(
      screen.getAllByText("Alex — Fitness Coach Discovery Call").length
    ).toBeGreaterThan(0);
    expect(screen.getByText("Executive Call Brief")).toBeInTheDocument();
    expect(screen.getByText("Fitness Coaching")).toBeInTheDocument();

    // Diagnosis
    expect(screen.getByText("Sales Diagnosis")).toBeInTheDocument();
    expect(screen.getByText(/No discovery structure/)).toBeInTheDocument();

    // Belief ladder questions
    expect(
      screen.getByText(/Where did your last three calls fall apart\?/)
    ).toBeInTheDocument();
    expect(screen.getByText(/Why didn't it stick\?/)).toBeInTheDocument();

    // Pitch script
    expect(
      screen.getByText(/From improvised calls to a 30%\+ close rate\./)
    ).toBeInTheDocument();
    expect(screen.getByText(/Pillar 1 — Position the offer/)).toBeInTheDocument();

    // Objections, call flow, next best questions
    expect(screen.getByText(/It's a lot of money\./)).toBeInTheDocument();
    expect(
      screen.getByText(/By the end of this call we'll both know if this is a fit\./)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/What's the cost of staying stuck another year\?/)
    ).toBeInTheDocument();

    // Footer carries the server-assigned doc id
    expect(screen.getByText(new RegExp(session.doc.documentMetadata.id))).toBeInTheDocument();
  });

  it("renders the derived demo coaching rail", () => {
    render(
      <LiveCoachingPanel liveCoaching={session.doc.liveCoaching} animated={false} />
    );

    expect(screen.getByText("Why didn't it stick?")).toBeInTheDocument();
    expect(screen.getByText("Pain")).toBeInTheDocument();
    expect(screen.getByText("Doubt")).toBeInTheDocument();
    expect(
      screen.getByText(/Prep preview — coaching goes live on your call/)
    ).toBeInTheDocument();
  });

  it("copies an individual section as clean plain text and resets copied feedback", async () => {
    jest.useFakeTimers();
    const writeText = jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined);
    mockClipboard(writeText);

    render(<ArtifactDocument doc={session.doc} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy Executive Call Brief section" }));
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0][0]).toContain("Executive Call Brief");
    expect(writeText.mock.calls[0][0]).toContain("Alex converts only 10-15% of discovery calls.");
    expect(writeText.mock.calls[0][0]).toContain(
      "Lock Pain, Doubt, and Cost before presenting."
    );
    expect(writeText.mock.calls[0][0]).not.toContain("Custom Pitch Script");
    expect(screen.getByRole("button", { name: "Copied Executive Call Brief section" }))
      .toBeInTheDocument();
    expect(screen.getByText("Copied")).toBeInTheDocument();

    await act(async () => {
      jest.advanceTimersByTime(1500);
    });

    expect(screen.getByRole("button", { name: "Copy Executive Call Brief section" }))
      .toBeInTheDocument();
  });

  it("copies the whole document from the toolbar copy action", async () => {
    jest.useFakeTimers();
    const writeText = jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined);
    mockClipboard(writeText);

    render(<ArtifactDocument doc={session.doc} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy document" }));
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0][0]).toContain("Alex — Fitness Coach Discovery Call");
    expect(writeText.mock.calls[0][0]).toContain("Executive Call Brief");
    expect(writeText.mock.calls[0][0]).toContain("Sales Diagnosis");
    expect(writeText.mock.calls[0][0]).toContain("Custom Pitch Script");
    expect(writeText.mock.calls[0][0]).toContain("Objection Prep");
    expect(writeText.mock.calls[0][0]).toContain("Call Flow");
    expect(writeText.mock.calls[0][0]).toContain("Next Best Questions");
    expect(writeText.mock.calls[0][0]).toContain(
      "What's the cost of staying stuck another year?"
    );
    expect(screen.getByRole("button", { name: "Copied document" })).toBeInTheDocument();

    await act(async () => {
      jest.advanceTimersByTime(1500);
    });

    expect(screen.getByRole("button", { name: "Copy document" })).toBeInTheDocument();
  });

  it("does not leave copied feedback stuck when clipboard writing fails", async () => {
    const writeText = jest.fn<Promise<void>, [string]>().mockRejectedValue(new Error("denied"));
    mockClipboard(writeText);

    render(<ArtifactDocument doc={session.doc} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy document" }));
      await Promise.resolve();
    });

    expect(writeText).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Copy document" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copied document" })).not.toBeInTheDocument();
  });

  it("smooth-scrolls outline clicks to the matching section and marks it active", () => {
    render(<ArtifactDocument doc={session.doc} />);

    const pitchSection = screen.getByRole("heading", { name: "Custom Pitch Script" }).closest(
      "section"
    );
    const scrollIntoView = jest.fn();
    pitchSection!.scrollIntoView = scrollIntoView;

    const pitchOutlineItem = screen.getByRole("link", { name: "Pitch" });
    fireEvent.click(pitchOutlineItem);

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "start" });
    expect(pitchOutlineItem).toHaveClass("bg-white/[0.04]", "text-[var(--sd-text)]");
    expect(screen.getByRole("link", { name: "Brief" })).not.toHaveClass("bg-white/[0.04]");
  });
});
