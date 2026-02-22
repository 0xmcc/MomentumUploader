import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import VoiceoverStudio from "./VoiceoverStudio";
import type { Memo } from "@/lib/memo-ui";

jest.mock("@/components/ThemeProvider", () => ({
  useTheme: () => ({ playbackTheme: "accent" }),
}));

jest.mock("framer-motion", () => {
  const motion = new Proxy(
    {},
    {
      get: (_target, key) =>
        ({ children, ...props }: { children?: React.ReactNode }) =>
          React.createElement(typeof key === "string" ? key : "div", props, children),
    }
  );

  return {
    motion,
    AnimatePresence: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
  };
});

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;

  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

const mockMemo: Memo = {
  id: "memo-12345678",
  transcript: "Sample transcript",
  createdAt: "2026-02-22T10:00:00.000Z",
  url: "https://cdn.example.com/memo.webm",
  wordCount: 2,
};

describe("VoiceoverStudio", () => {
  beforeEach(() => {
    jest.clearAllMocks();

    Object.defineProperty(global, "fetch", {
      writable: true,
      value: jest.fn(),
    });

    Object.defineProperty(global.URL, "createObjectURL", {
      writable: true,
      value: jest.fn(() => "blob:voiceover-result"),
    });

    Object.defineProperty(global.URL, "revokeObjectURL", {
      writable: true,
      value: jest.fn(),
    });

    Object.defineProperty(HTMLMediaElement.prototype, "play", {
      writable: true,
      value: jest.fn().mockResolvedValue(undefined),
    });

    Object.defineProperty(HTMLMediaElement.prototype, "pause", {
      writable: true,
      value: jest.fn(),
    });

    Object.defineProperty(HTMLMediaElement.prototype, "load", {
      writable: true,
      value: jest.fn(),
    });
  });

  it("shows loading state then readies audio after voice selection", async () => {
    const pendingResponse = deferred<Response>();
    (global.fetch as jest.Mock).mockReturnValue(pendingResponse.promise);

    const { container } = render(<VoiceoverStudio memo={mockMemo} />);

    fireEvent.click(screen.getByRole("button", { name: /Brian/i }));

    expect(screen.getByLabelText("Generating voiceover")).toBeInTheDocument();

    pendingResponse.resolve({
      ok: true,
      blob: async () => new Blob(["mock mp3"], { type: "audio/mpeg" }),
    } as Response);

    const audio = container.querySelector("audio");

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        "/api/memos/memo-12345678/voiceover",
        expect.objectContaining({
          method: "POST",
        })
      );
      expect(audio).toBeTruthy();
      expect(audio?.getAttribute("src")).toBe("blob:voiceover-result");
    });
  });

  it("shows error message when API returns error", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ error: "ElevenLabs rate limit — try again shortly" }),
    } as Response);

    render(<VoiceoverStudio memo={mockMemo} />);

    fireEvent.click(screen.getByRole("button", { name: /Brian/i }));

    await waitFor(() => {
      expect(
        screen.getByText("ElevenLabs rate limit — try again shortly")
      ).toBeInTheDocument();
    });
  });
});
