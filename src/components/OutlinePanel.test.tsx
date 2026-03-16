import { render, screen } from "@testing-library/react";
import OutlinePanel from "./OutlinePanel";
import type { ArtifactMap } from "@/lib/artifact-types";

function makeArtifacts(overrides: Partial<ArtifactMap>): ArtifactMap {
    return {
        rolling_summary: null,
        outline: null,
        title_candidates: null,
        title: null,
        key_topics: null,
        action_items: null,
        ...overrides,
    };
}

describe("OutlinePanel", () => {
    it("renders the outline list when available", () => {
        render(
            <OutlinePanel
                artifacts={makeArtifacts({
                    outline: {
                        payload: {
                            items: [
                                { title: "Intro", summary: "Sets the stage." },
                                { title: "Plan", summary: "Outlines next steps." },
                            ],
                        },
                        basedOnChunkStart: 0,
                        basedOnChunkEnd: 2,
                        version: 1,
                        updatedAt: "2026-03-15T10:00:00.000Z",
                    },
                })}
            />
        );

        expect(screen.getByText("Intro")).toBeInTheDocument();
        expect(screen.getByText("Outlines next steps.")).toBeInTheDocument();
    });

    it("falls back to the rolling summary when no outline exists", () => {
        render(
            <OutlinePanel
                artifacts={makeArtifacts({
                    rolling_summary: {
                        payload: { summary: "A concise summary." },
                        basedOnChunkStart: 0,
                        basedOnChunkEnd: 1,
                        version: 1,
                        updatedAt: "2026-03-15T10:00:00.000Z",
                    },
                })}
            />
        );

        expect(screen.getByText("A concise summary.")).toBeInTheDocument();
    });

    it("renders a placeholder when neither artifact exists", () => {
        render(<OutlinePanel artifacts={makeArtifacts({})} />);
        expect(screen.getByText("Listening for structure…")).toBeInTheDocument();
    });
});
