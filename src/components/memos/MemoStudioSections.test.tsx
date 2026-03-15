import React from "react";
import { render, screen } from "@testing-library/react";
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
});
