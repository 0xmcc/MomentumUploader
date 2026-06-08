import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import Home from "../page";
import { useMemosWorkspace } from "@/hooks/useMemosWorkspace";

const memoSidebarMock = jest.fn();
const memoDetailViewMock = jest.fn();
const primaryHeaderControlsMock = jest.fn();
const recorderPanelMock = jest.fn();
const transcriptFeedPanelMock = jest.fn();

jest.mock("@clerk/nextjs", () => ({
  useUser: () => ({
    isSignedIn: true,
    isLoaded: true,
    user: {
      fullName: "Marko M",
      imageUrl: "https://img.example.com/marko.png",
      primaryEmailAddress: { emailAddress: "marko@example.com" },
      username: "marko",
    },
  }),
  useClerk: () => ({ openSignIn: jest.fn() }),
}));

jest.mock("@/hooks/useMemosWorkspace", () => ({
  useMemosWorkspace: jest.fn(),
}));

jest.mock("@/components/memos/MemoStudioSections", () => ({
  MemoSidebar: (props: { onSelectMemo: (memoId: string | null) => void }) => {
    memoSidebarMock(props);
    return (
      <div data-testid="memo-sidebar">
        <button onClick={() => props.onSelectMemo("memo-2")}>Select memo</button>
      </div>
    );
  },
  MemoDetailView: (props: unknown) => {
    memoDetailViewMock(props);
    return <div data-testid="memo-detail-view" />;
  },
  PrimaryHeaderControls: (props: unknown) => {
    primaryHeaderControlsMock(props);
    return <div data-testid="primary-header-controls" />;
  },
  RecorderPanel: (props: {
    onRecordingStateChange?: (isRecording: boolean) => void;
  }) => {
    recorderPanelMock(props);
    return (
      <div data-testid="recorder-panel">
        <button onClick={() => props.onRecordingStateChange?.(true)}>
          Mark recording live
        </button>
      </div>
    );
  },
  TranscriptFeedPanel: (props: {
    onLoadMoreMemos: () => void;
    onSelectMemo: (memoId: string) => void;
    recorderPanel?: React.ReactNode;
  }) => {
    transcriptFeedPanelMock(props);
    return (
      <div data-testid="transcript-feed-panel">
        {props.recorderPanel}
        <button onClick={() => props.onLoadMoreMemos()}>Load next page</button>
        <button onClick={() => props.onSelectMemo("memo-1")}>Open feed memo</button>
      </div>
    );
  },
}));

const mockedUseMemosWorkspace = useMemosWorkspace as jest.MockedFunction<
  typeof useMemosWorkspace
>;

describe("Home composition wiring", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("renders recorder flow when no memo is selected", () => {
    const commonHookState = {
      filteredBookmarkedMemos: [],
      filteredMemos: [],
      fathomImportMessage: null,
      fathomSettings: null,
      handleAudioInput: jest.fn(),
      handleUploadComplete: jest.fn(),
      importFathomMemos: jest.fn(),
      importingFathom: false,
      isUploading: false,
      loading: false,
      retryUpload: jest.fn(),
      updateMemoTitle: jest.fn(),
      regenerateMemoTitle: jest.fn(),
      hasMoreMemos: true,
      loadMoreMemos: jest.fn(),
      loadingMoreMemos: false,
      searchQuery: "",
      selectedMemoId: null,
      setSearchQuery: jest.fn(),
      setSelectedMemoId: jest.fn(),
      showUploadError: false,
      uploadProgressPercent: 0,
    };

    mockedUseMemosWorkspace.mockReturnValue({
      ...commonHookState,
      selectedMemo: null,
    });

    render(<Home />);

    expect(screen.getByTestId("memo-sidebar")).toBeInTheDocument();
    expect(screen.getByTestId("primary-header-controls")).toBeInTheDocument();
    expect(screen.getByTestId("transcript-feed-panel")).toBeInTheDocument();
    expect(screen.getByTestId("recorder-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("memo-detail-view")).not.toBeInTheDocument();

    expect(memoSidebarMock).toHaveBeenCalledWith(
      expect.objectContaining({
        filteredBookmarkedMemos: [],
        filteredMemos: [],
        selectedMemoId: null,
      })
    );
    const recorderPanelProps = recorderPanelMock.mock.calls[0]?.[0] as Record<
      string,
      unknown
    >;
    expect(recorderPanelProps).toEqual(
      expect.objectContaining({
        isUploading: false,
        onUploadComplete: commonHookState.handleUploadComplete,
        showUploadError: false,
      })
    );
    expect(recorderPanelProps).not.toHaveProperty("onAudioInput");

    expect(transcriptFeedPanelMock).toHaveBeenCalledWith(
      expect.objectContaining({
        authorProfile: {
          avatarUrl: "https://img.example.com/marko.png",
          handle: "@marko",
          name: "Marko M",
        },
        hasMoreMemos: true,
        fathomImportMessage: null,
        fathomSettings: null,
        importingFathom: false,
        loadingMoreMemos: false,
        memos: [],
        onImportFathom: commonHookState.importFathomMemos,
        onLoadMoreMemos: commonHookState.loadMoreMemos,
      })
    );
  });

  it("renders memo detail flow when a memo is selected", () => {
    const selectedMemo = {
      id: "memo-1",
      transcript: "hello world",
      createdAt: "2026-02-22T10:00:00.000Z",
      wordCount: 2,
    };

    mockedUseMemosWorkspace.mockReturnValue({
      filteredMemos: [selectedMemo],
      filteredBookmarkedMemos: [],
      fathomImportMessage: null,
      fathomSettings: null,
      handleAudioInput: jest.fn(),
      handleUploadComplete: jest.fn(),
      importFathomMemos: jest.fn(),
      importingFathom: false,
      isUploading: false,
      loading: false,
      retryUpload: jest.fn(),
      updateMemoTitle: jest.fn(),
      regenerateMemoTitle: jest.fn(),
      hasMoreMemos: false,
      loadMoreMemos: jest.fn(),
      loadingMoreMemos: false,
      searchQuery: "",
      selectedMemo,
      selectedMemoId: selectedMemo.id,
      setSearchQuery: jest.fn(),
      setSelectedMemoId: jest.fn(),
      showUploadError: false,
      uploadProgressPercent: 0,
    });

    render(<Home />);

    expect(screen.getByTestId("memo-sidebar")).toBeInTheDocument();
    expect(screen.getByTestId("memo-detail-view")).toBeInTheDocument();
    expect(screen.queryByTestId("recorder-panel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("primary-header-controls")).not.toBeInTheDocument();

    expect(memoDetailViewMock).toHaveBeenCalledWith(
      expect.objectContaining({
        memo: selectedMemo,
      })
    );
  });

  it("replaces the workspace upload banner with a status dot", () => {
    mockedUseMemosWorkspace.mockReturnValue({
      filteredMemos: [],
      filteredBookmarkedMemos: [],
      fathomImportMessage: null,
      fathomSettings: null,
      handleAudioInput: jest.fn(),
      handleUploadComplete: jest.fn(),
      importFathomMemos: jest.fn(),
      importingFathom: false,
      isUploading: true,
      loading: false,
      retryUpload: jest.fn(),
      updateMemoTitle: jest.fn(),
      regenerateMemoTitle: jest.fn(),
      hasMoreMemos: false,
      loadMoreMemos: jest.fn(),
      loadingMoreMemos: false,
      searchQuery: "",
      selectedMemo: null,
      selectedMemoId: null,
      setSearchQuery: jest.fn(),
      setSelectedMemoId: jest.fn(),
      showUploadError: false,
      uploadProgressPercent: 42,
    });

    render(<Home />);

    expect(
      screen.getByRole("img", { name: "Uploading audio at 42%" })
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Upload complete - finalizing")
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Uploading 42%")).not.toBeInTheDocument();
  });

  it("warns before changing memos while recording is live", () => {
    const setSelectedMemoId = jest.fn();
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(false);

    mockedUseMemosWorkspace.mockReturnValue({
      filteredMemos: [],
      filteredBookmarkedMemos: [],
      fathomImportMessage: null,
      fathomSettings: null,
      handleAudioInput: jest.fn(),
      handleUploadComplete: jest.fn(),
      importFathomMemos: jest.fn(),
      importingFathom: false,
      isUploading: false,
      loading: false,
      retryUpload: jest.fn(),
      updateMemoTitle: jest.fn(),
      regenerateMemoTitle: jest.fn(),
      hasMoreMemos: false,
      loadMoreMemos: jest.fn(),
      loadingMoreMemos: false,
      searchQuery: "",
      selectedMemo: null,
      selectedMemoId: null,
      setSearchQuery: jest.fn(),
      setSelectedMemoId,
      showUploadError: false,
      uploadProgressPercent: 0,
    });

    render(<Home />);

    fireEvent.click(screen.getByRole("button", { name: "Mark recording live" }));
    fireEvent.click(screen.getByRole("button", { name: "Select memo" }));

    expect(confirmSpy).toHaveBeenCalledWith(
      "Switching memos will stop the current recording. Continue?"
    );
    expect(setSelectedMemoId).not.toHaveBeenCalled();
  });

  it("allows the memo change after the user confirms the recording warning", () => {
    const setSelectedMemoId = jest.fn();
    const confirmSpy = jest.spyOn(window, "confirm").mockReturnValue(true);

    mockedUseMemosWorkspace.mockReturnValue({
      filteredMemos: [],
      filteredBookmarkedMemos: [],
      fathomImportMessage: null,
      fathomSettings: null,
      handleAudioInput: jest.fn(),
      handleUploadComplete: jest.fn(),
      importFathomMemos: jest.fn(),
      importingFathom: false,
      isUploading: false,
      loading: false,
      retryUpload: jest.fn(),
      updateMemoTitle: jest.fn(),
      regenerateMemoTitle: jest.fn(),
      hasMoreMemos: false,
      loadMoreMemos: jest.fn(),
      loadingMoreMemos: false,
      searchQuery: "",
      selectedMemo: null,
      selectedMemoId: null,
      setSearchQuery: jest.fn(),
      setSelectedMemoId,
      showUploadError: false,
      uploadProgressPercent: 0,
    });

    render(<Home />);

    fireEvent.click(screen.getByRole("button", { name: "Mark recording live" }));
    fireEvent.click(screen.getByRole("button", { name: "Select memo" }));

    expect(confirmSpy).toHaveBeenCalledWith(
      "Switching memos will stop the current recording. Continue?"
    );
    expect(setSelectedMemoId).toHaveBeenCalledWith("memo-2");
  });
});
