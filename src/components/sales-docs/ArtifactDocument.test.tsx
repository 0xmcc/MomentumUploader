import { render, screen } from "@testing-library/react";
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
});
