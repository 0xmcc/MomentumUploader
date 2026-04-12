import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import SharedMemoSummary from "./SharedMemoSummary";
import type { ResolvedMemoShare } from "@/lib/share-domain";

const memo: ResolvedMemoShare = {
  memoId: "memo-1",
  ownerUserId: "user-1",
  authorName: "Marko",
  authorAvatarUrl: null,
  shareToken: "sharetoken1234",
  title: "Venue research",
  transcript:
    "Paragraph one.\n\nParagraph two.\n\nParagraph three.\n\nParagraph four.\n\nParagraph five.",
  transcriptStatus: "complete",
  transcriptSegments: null,
  mediaUrl: null,
  isLiveRecording: false,
  createdAt: "2026-04-12T19:00:00.000Z",
  sharedAt: "2026-04-12T19:05:00.000Z",
  expiresAt: null,
};

describe("SharedMemoSummary", () => {
  const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL;

  afterEach(() => {
    process.env.NEXT_PUBLIC_SITE_URL = originalSiteUrl;
  });

  it("keeps the transcript in its own scroll container on desktop layouts", () => {
    const { container } = render(<SharedMemoSummary memo={memo} />);

    expect(container.querySelector("section")).toHaveClass("lg:h-full", "lg:min-h-0");
    expect(screen.getByText("Transcript").parentElement).toHaveClass(
      "lg:flex-1",
      "lg:min-h-0",
      "lg:overflow-y-auto"
    );
  });

  it("renders transcript segments with timestamps when segment data is available", () => {
    const { container } = render(
      <SharedMemoSummary
        memo={{
          ...memo,
          transcript: "Dense fallback transcript that should stay hidden.",
          transcriptSegments: [
            {
              id: "segment-1",
              startMs: 0,
              endMs: 3900,
              text: "First timestamped thought.",
            },
            {
              id: "segment-2",
              startMs: 42000,
              endMs: 47500,
              text: "Second timestamped thought.",
            },
          ],
        }}
      />
    );

    expect(screen.getByText("0:00")).toBeInTheDocument();
    expect(screen.getByText("0:42")).toBeInTheDocument();
    expect(screen.getByText("First timestamped thought.")).toBeInTheDocument();
    expect(screen.getByText("Second timestamped thought.")).toBeInTheDocument();
    expect(screen.queryByText("Dense fallback transcript that should stay hidden.")).toBeNull();
    const segmentRows = container.querySelectorAll(".grid.grid-cols-\\[auto_minmax\\(0\\2c 1fr\\)\\]");
    expect(segmentRows[0]).not.toHaveClass("border", "border-white/8", "bg-white/[0.03]");
  });

  it("shows a copy-only share link instead of the raw share token", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    process.env.NEXT_PUBLIC_SITE_URL = "https://voice-memos.vercel.app";
    Object.defineProperty(window.navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    render(<SharedMemoSummary memo={memo} />);

    const shareUrl = "https://voice-memos.vercel.app/s/sharetoken1234";
    const copyButton = screen.getByRole("button", { name: shareUrl });

    expect(screen.getByText("Share link")).toBeInTheDocument();
    expect(screen.getByText(shareUrl)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: shareUrl })).toBeNull();
    expect(screen.queryByText("Click to copy")).toBeNull();
    expect(copyButton.querySelector("svg")).not.toBeNull();

    await userEvent.click(copyButton);

    expect(writeText).toHaveBeenCalledWith(shareUrl);
  });
});
