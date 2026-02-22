import { act, renderHook } from "@testing-library/react";
import { useMemoPlayback } from "./useMemoPlayback";
import { SHARE_STATE_RESET_MS, type Memo } from "@/lib/memo-ui";

describe("useMemoPlayback", () => {
  const memo: Memo = {
    id: "memo-1",
    transcript: "hello world",
    createdAt: "2026-02-22T10:00:00.000Z",
    url: "https://example.com/audio.webm",
    modelUsed: "nvidia/parakeet-rnnt-1.1b",
    wordCount: 2,
    durationSeconds: 120,
    success: true,
  };

  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("shares successfully and resets share state after timeout", async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(global.navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });

    const mockFetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ shareUrl: "https://example.com/s/abc123" }),
    });
    Object.defineProperty(global, "fetch", { writable: true, value: mockFetch });

    const { result } = renderHook(() => useMemoPlayback(memo));

    await act(async () => {
      await result.current.handleShare();
    });

    expect(mockFetch).toHaveBeenCalledWith("/api/memos/memo-1/share", {
      method: "POST",
    });
    expect(writeText).toHaveBeenCalledWith("https://example.com/s/abc123");
    expect(result.current.shareState).toBe("copied");
    expect(result.current.shareLabel).toBe("Copied");
    expect(result.current.lastShareUrl).toBe("https://example.com/s/abc123");

    act(() => {
      jest.advanceTimersByTime(SHARE_STATE_RESET_MS);
    });

    expect(result.current.shareState).toBe("idle");
    expect(result.current.shareLabel).toBe("Share");
  });

  it("manages play/pause, seeking, and progress updates", async () => {
    const { result } = renderHook(() => useMemoPlayback(memo));
    const audio = {
      currentTime: 0,
      pause: jest.fn(),
      play: jest.fn().mockResolvedValue(undefined),
    } as unknown as HTMLAudioElement;

    act(() => {
      result.current.audioRef.current = audio;
    });

    await act(async () => {
      await result.current.togglePlay();
    });
    expect(result.current.isPlaying).toBe(true);
    expect(audio.play).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.handleLoadedMetadata({
        target: { duration: 100 },
      } as unknown as React.SyntheticEvent<HTMLAudioElement>);
    });

    act(() => {
      result.current.handleSeek({
        clientX: 50,
        currentTarget: {
          getBoundingClientRect: () => ({ left: 0, width: 100 }),
        },
      } as unknown as React.MouseEvent<HTMLDivElement>);
    });

    expect(result.current.currentTime).toBe(50);
    expect(result.current.progress).toBe(50);
    expect(audio.currentTime).toBe(50);

    act(() => {
      result.current.handleTimeUpdate({
        target: { currentTime: 80 },
      } as unknown as React.SyntheticEvent<HTMLAudioElement>);
    });
    expect(result.current.currentTime).toBe(80);
    expect(result.current.progress).toBe(80);

    await act(async () => {
      await result.current.togglePlay();
    });
    expect(result.current.isPlaying).toBe(false);
    expect(audio.pause).toHaveBeenCalledTimes(1);

    act(() => {
      result.current.handleEnded();
    });
    expect(result.current.currentTime).toBe(0);
  });
});
