import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import {
  MemoDetailView,
  MemoTranscriptPanel,
} from "./MemoStudioSections";
import type { useAudioPlayback as UseAudioPlayback } from "@/hooks/useMemoPlayback";

const { useAudioPlayback: realUseAudioPlayback } = jest.requireActual(
  "@/hooks/useMemoPlayback"
) as {
  useAudioPlayback: typeof UseAudioPlayback;
};

const mockUseMemoShare = jest.fn(() => ({
  handleShare: jest.fn(),
  handleShareLink: jest.fn(),
  lastShareUrl: null,
  shareLabel: "Share",
  shareState: "idle",
  shareLinkLabel: "Share link",
  shareLinkState: "idle",
}));

const mockUseAudioPlayback = jest.fn((...args: Parameters<typeof realUseAudioPlayback>) =>
  realUseAudioPlayback(...args)
);

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
  useMemoShare: (...args: unknown[]) => mockUseMemoShare(...args),
  useAudioPlayback: (...args: unknown[]) => mockUseAudioPlayback(...args),
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
    mockUseMemoShare.mockReturnValue({
      handleShare: jest.fn(),
      handleShareLink: jest.fn(),
      lastShareUrl: null,
      shareLabel: "Share",
      shareState: "idle",
      shareLinkLabel: "Share link",
      shareLinkState: "idle",
    });
    mockUseAudioPlayback.mockReturnValue({
      audioRef: { current: null },
      currentTime: 0,
      displayDuration: 0,
      handleEnded: jest.fn(),
      handleLoadedMetadata: jest.fn(),
      handleSeek: jest.fn(),
      handleTimeUpdate: jest.fn(),
      isPlaying: false,
      progress: 0,
      togglePlay: jest.fn(),
    });
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
    expect(screen.queryByRole("button", { name: /Okay, this is the first thought\./ })).toBeNull();
    expect(screen.queryByRole("button", { name: /This is the second thought\./ })).toBeNull();
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

  it("uses a single-column detail layout without the memo room sidebar", () => {
    const { container } = render(
      <MemoDetailView
        memo={{
          id: "memo-layout-1",
          title: "Layout Memo",
          transcript: "Transcript content.",
          createdAt: "2026-03-16T12:00:00.000Z",
          wordCount: 2,
        }}
      />
    );

    const detailColumn = container.querySelector(".mx-auto.w-full.max-w-7xl.flex.flex-col");
    expect(detailColumn).not.toBeNull();
    expect(container.querySelector(".xl\\:sticky")).toBeNull();
  });

  it("shows a dedicated share link button in the memo detail actions", () => {
    render(
      <MemoDetailView
        memo={{
          id: "memo-share-1",
          title: "Share Memo",
          transcript: "Transcript content.",
          createdAt: "2026-03-16T12:00:00.000Z",
          wordCount: 2,
        }}
      />
    );

    expect(
      screen.getByRole("button", { name: /share link/i })
    ).toBeInTheDocument();
  });

  it("keeps the open share page link to the left of copy when a share url is available", () => {
    mockUseMemoShare.mockReturnValue({
      handleShare: jest.fn(),
      handleShareLink: jest.fn(),
      lastShareUrl: "https://example.com/s/memo-share-2",
      shareLabel: "Copy",
      shareState: "idle",
      shareLinkLabel: "Copied!",
      shareLinkState: "copied",
    });

    render(
      <MemoDetailView
        memo={{
          id: "memo-share-2",
          title: "Share Memo",
          transcript: "Transcript content.",
          createdAt: "2026-03-16T12:00:00.000Z",
          wordCount: 2,
        }}
      />
    );

    const shareButton = screen.getByRole("button", { name: /copied!/i });
    const openSharePageLink = screen.getByRole("link", { name: /open share page/i });
    const copyButton = screen.getByRole("button", { name: /copy/i });

    expect(
      shareButton.compareDocumentPosition(openSharePageLink) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      openSharePageLink.compareDocumentPosition(copyButton) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("MemoTranscriptPanel commits only once when re-rendered with identical props", () => {
    const onRender = jest.fn();
    const onToggle = jest.fn();
    const memo = {
      id: "memo-transcript-panel-1",
      transcript: "Transcript body",
      createdAt: "2026-03-15T12:00:00.000Z",
      wordCount: 2,
      transcriptSegments: [
        {
          id: "segment-1",
          startMs: 0,
          endMs: 1200,
          text: "Segment one",
        },
      ],
    } as never;

    const { rerender } = render(
      <MemoTranscriptPanel
        memo={memo}
        showTimestamps={false}
        onToggleTimestamps={onToggle}
        transcriptProfilerOnRender={onRender}
      />
    );
    expect(onRender).toHaveBeenCalledTimes(1);

    rerender(
      <MemoTranscriptPanel
        memo={memo}
        showTimestamps={false}
        onToggleTimestamps={onToggle}
        transcriptProfilerOnRender={onRender}
      />
    );

    expect(onRender).toHaveBeenCalledTimes(1);
  });

  it("MemoTranscriptPanel does not commit when playback currentTime changes in the footer", () => {
    const onRender = jest.fn();
    mockUseAudioPlayback.mockImplementation((...args) => realUseAudioPlayback(...args));
    const memo = {
      id: "memo-transcript-panel-2",
      transcript: "hello",
      url: "https://example.com/audio.mp3",
      createdAt: "2026-03-15T12:00:00.000Z",
      durationSeconds: 120,
      wordCount: 1,
    } as never;

    const { container } = render(
      <MemoDetailView memo={memo} transcriptPanelProfilerOnRender={onRender} />
    );
    expect(onRender).toHaveBeenCalledTimes(1);

    const audio = container.querySelector("audio") as HTMLAudioElement | null;
    expect(audio).not.toBeNull();

    act(() => {
      Object.defineProperty(audio, "currentTime", {
        configurable: true,
        value: 42,
        writable: true,
      });
      fireEvent.timeUpdate(audio as HTMLAudioElement);
    });

    expect(screen.getByText("0:42")).toBeInTheDocument();
    expect(onRender).toHaveBeenCalledTimes(1);
  });
});
