import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoDetailView } from "./MemoStudioSections";

jest.mock("next/link", () => ({
  __esModule: true,
  default: ({
    children,
    href,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

jest.mock("framer-motion", () => {
  const motion = new Proxy(
    {},
    {
      get: (_target, key) => {
        return ({ children, ...props }: { children?: React.ReactNode }) =>
          React.createElement(
            typeof key === "string" ? key : "div",
            props,
            children
          );
      },
    }
  );

  return {
    motion,
    AnimatePresence: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
  };
});

jest.mock("@clerk/nextjs", () => ({
  SignedIn: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  SignedOut: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  SignInButton: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
  UserButton: () => <div data-testid="user-button" />,
}));

jest.mock("@/components/ThemeProvider", () => ({
  useTheme: () => ({ playbackTheme: "accent" }),
}));

jest.mock("@/hooks/useMemoPlayback", () => ({
  useMemoPlayback: jest.fn(() => ({
    audioRef: { current: null },
    currentTime: 0,
    displayDuration: 0,
    handleEnded: jest.fn(),
    handleLoadedMetadata: jest.fn(),
    handleSeek: jest.fn(),
    handleShare: jest.fn(),
    handleTimeUpdate: jest.fn(),
    isPlaying: false,
    lastShareUrl: null,
    progress: 0,
    shareLabel: "Share",
    shareState: "idle",
    togglePlay: jest.fn(),
  })),
}));

jest.mock("@/components/ThemeToggle", () => ({
  __esModule: true,
  default: () => <div data-testid="theme-toggle" />,
}));

jest.mock("@/components/VoiceoverStudio", () => ({
  __esModule: true,
  default: () => <div data-testid="voiceover-studio" />,
}));

describe("MemoDetailView", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("shows a download recording escape hatch when the memo failed", () => {
    render(
      <MemoDetailView
        memo={{
          id: "memo-failed-1",
          transcript: "",
          transcriptStatus: "failed",
          createdAt: "2026-03-15T12:00:00.000Z",
          wordCount: 0,
        }}
      />
    );

    expect(screen.getByText("Recording couldn't be saved.")).toBeInTheDocument();

    const link = screen.getByRole("link", { name: "Download recording" });
    expect(link).toHaveAttribute(
      "href",
      "/api/memos/memo-failed-1/download-chunks"
    );
  });

  it("defaults to spaced transcript paragraphs and lets the user toggle timestamps on", () => {
    const { container } = render(
      <MemoDetailView
        memo={
          {
            id: "memo-segmented-1",
            title: "Segmented memo",
            transcript:
              "Fallback transcript that should not be shown when segments exist.",
            createdAt: "2026-03-15T12:00:00.000Z",
            wordCount: 12,
            transcriptSegments: [
              {
                id: "0",
                startMs: 0,
                endMs: 2200,
                text: "Okay, this is the first thought.",
              },
              {
                id: "1",
                startMs: 2200,
                endMs: 5100,
                text: "This is the second thought.",
              },
            ],
          } as never
        }
      />
    );

    const hiddenBlocks = container.querySelectorAll(".transcript-segment");
    expect(hiddenBlocks).toHaveLength(2);
    expect(hiddenBlocks[0]).not.toHaveTextContent("0:00");
    expect(hiddenBlocks[0]).toHaveTextContent("Okay, this is the first thought.");
    expect(hiddenBlocks[1]).not.toHaveTextContent("0:02");
    expect(hiddenBlocks[1]).toHaveTextContent("This is the second thought.");

    fireEvent.click(screen.getByRole("button", { name: "Show timestamps" }));

    const blocks = container.querySelectorAll(".transcript-segment");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toHaveClass("grid");
    expect(blocks[0]).toHaveClass("grid-cols-[auto_minmax(0,1fr)]");
    expect(blocks[0]).toHaveTextContent("0:00");
    expect(blocks[0]).toHaveTextContent("Okay, this is the first thought.");
    expect(blocks[1]).toHaveTextContent("0:02");
    expect(blocks[1]).toHaveTextContent("This is the second thought.");
  });

  it("persists the timestamp toggle in localStorage", () => {
    const memo = {
      id: "memo-segmented-2",
      title: "Segmented memo",
      transcript: "Paragraph view transcript.",
      createdAt: "2026-03-15T12:00:00.000Z",
      wordCount: 8,
      transcriptSegments: [
        {
          id: "0",
          startMs: 42000,
          endMs: 47000,
          text: "Forty two seconds in.",
        },
      ],
    } as never;

    const { unmount, container } = render(<MemoDetailView memo={memo} />);

    fireEvent.click(screen.getByRole("button", { name: "Show timestamps" }));
    expect(window.localStorage.getItem("memo-transcript-show-timestamps")).toBe(
      "true"
    );

    unmount();

    const remounted = render(<MemoDetailView memo={memo} />);

    expect(screen.getByRole("button", { name: "Hide timestamps" })).toBeInTheDocument();
    const blocks = remounted.container.querySelectorAll(".transcript-segment");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toHaveTextContent("0:42");
    expect(blocks[0]).toHaveTextContent("Forty two seconds in.");
  });
});
