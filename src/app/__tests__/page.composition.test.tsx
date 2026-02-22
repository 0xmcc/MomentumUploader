import React from "react";
import { render, screen } from "@testing-library/react";
import Home from "../page";
import { useMemosWorkspace } from "@/hooks/useMemosWorkspace";

const memoSidebarMock = jest.fn();
const memoDetailViewMock = jest.fn();
const primaryHeaderControlsMock = jest.fn();
const recorderPanelMock = jest.fn();

jest.mock("@clerk/nextjs", () => ({
  useUser: () => ({ isSignedIn: true, isLoaded: true }),
  useClerk: () => ({ openSignIn: jest.fn() }),
}));

jest.mock("@/hooks/useMemosWorkspace", () => ({
  useMemosWorkspace: jest.fn(),
}));

jest.mock("@/components/memos/MemoStudioSections", () => ({
  MemoSidebar: (props: unknown) => {
    memoSidebarMock(props);
    return <div data-testid="memo-sidebar" />;
  },
  MemoDetailView: (props: unknown) => {
    memoDetailViewMock(props);
    return <div data-testid="memo-detail-view" />;
  },
  PrimaryHeaderControls: (props: unknown) => {
    primaryHeaderControlsMock(props);
    return <div data-testid="primary-header-controls" />;
  },
  RecorderPanel: (props: unknown) => {
    recorderPanelMock(props);
    return <div data-testid="recorder-panel" />;
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
      filteredMemos: [],
      handleRecordingStop: jest.fn(),
      handleUploadComplete: jest.fn(),
      loading: false,
      retryUpload: jest.fn(),
      searchQuery: "",
      selectedMemoId: null,
      setSearchQuery: jest.fn(),
      setSelectedMemoId: jest.fn(),
      showUploadError: false,
    };

    mockedUseMemosWorkspace.mockReturnValue({
      ...commonHookState,
      selectedMemo: null,
    });

    render(<Home />);

    expect(screen.getByTestId("memo-sidebar")).toBeInTheDocument();
    expect(screen.getByTestId("primary-header-controls")).toBeInTheDocument();
    expect(screen.getByTestId("recorder-panel")).toBeInTheDocument();
    expect(screen.queryByTestId("memo-detail-view")).not.toBeInTheDocument();

    expect(memoSidebarMock).toHaveBeenCalledWith(
      expect.objectContaining({
        filteredMemos: [],
        selectedMemoId: null,
      })
    );
    expect(recorderPanelMock).toHaveBeenCalledWith(
      expect.objectContaining({
        showUploadError: false,
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
      handleRecordingStop: jest.fn(),
      handleUploadComplete: jest.fn(),
      loading: false,
      retryUpload: jest.fn(),
      searchQuery: "",
      selectedMemo,
      selectedMemoId: selectedMemo.id,
      setSearchQuery: jest.fn(),
      setSelectedMemoId: jest.fn(),
      showUploadError: false,
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
});
