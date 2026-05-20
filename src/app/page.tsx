"use client";

import { useClerk, useUser } from "@clerk/nextjs";
import { useState } from "react";
import {
  MemoDetailView,
  MemoSidebar,
  PrimaryHeaderControls,
  RecorderPanel,
  TranscriptFeedPanel,
} from "@/components/memos/MemoStudioSections";
import StatusDot from "@/components/StatusDot";
import { useMemosWorkspace } from "@/hooks/useMemosWorkspace";

export default function Home() {
  const { isSignedIn, isLoaded } = useUser();
  const { openSignIn } = useClerk();
  const [isRecordingLive, setIsRecordingLive] = useState(false);

  const {
    filteredBookmarkedMemos,
    filteredMemos,
    hasMoreMemos,
    handleUploadComplete,
    loadMoreMemos,
    loading,
    loadingMoreMemos,
    isUploading,
    retryUpload,
    regenerateMemoTitle,
    searchQuery,
    selectedMemo,
    selectedMemoId,
    setSearchQuery,
    setSelectedMemoId,
    showUploadError,
    updateMemoTitle,
    uploadProgressPercent,
  } = useMemosWorkspace({
    isLoaded,
    isSignedIn,
    openSignIn,
  });

  const handleSelectMemo = (memoId: string | null) => {
    if (
      isRecordingLive &&
      memoId !== selectedMemoId &&
      !window.confirm("Switching memos will stop the current recording. Continue?")
    ) {
      return;
    }

    setSelectedMemoId(memoId);
  };

  return (
    <main className="flex h-screen w-full bg-[#0A0A0A] overflow-hidden text-white font-sans">
      <MemoSidebar
        filteredBookmarkedMemos={filteredBookmarkedMemos}
        filteredMemos={filteredMemos}
        isSignedIn={isSignedIn}
        loading={loading}
        searchQuery={searchQuery}
        selectedMemoId={selectedMemoId}
        onSearchQueryChange={setSearchQuery}
        onSelectMemo={handleSelectMemo}
      />

      <section className="flex-1 flex flex-col relative bg-[#121212] overflow-hidden">
        {!selectedMemo && <PrimaryHeaderControls />}
        {isUploading && (
          <div className="pointer-events-none absolute right-6 top-6 z-40">
            <StatusDot
              tone="processing"
              label={
                uploadProgressPercent >= 100
                  ? "Finalizing memo"
                  : `Uploading audio at ${uploadProgressPercent}%`
              }
              className="h-3 w-3"
            />
            <span className="sr-only">
              {uploadProgressPercent >= 100
                ? "Finalizing memo"
                : `Uploading audio at ${uploadProgressPercent}%`}
            </span>
          </div>
        )}

        {selectedMemo ? (
          <MemoDetailView
            key={selectedMemo.id}
            memo={selectedMemo}
            onTitleSave={updateMemoTitle}
            onTitleRegenerate={regenerateMemoTitle}
          />
        ) : (
          <TranscriptFeedPanel
            memos={filteredMemos}
            loading={loading}
            hasMoreMemos={hasMoreMemos}
            loadingMoreMemos={loadingMoreMemos}
            onLoadMoreMemos={loadMoreMemos}
            onSelectMemo={handleSelectMemo}
            recorderPanel={
              <RecorderPanel
                variant="compact"
                isUploading={isUploading}
                uploadProgressPercent={uploadProgressPercent}
                onRetryUpload={retryUpload}
                onUploadComplete={handleUploadComplete}
                onRecordingStateChange={setIsRecordingLive}
                showUploadError={showUploadError}
              />
            }
          />
        )}
      </section>
    </main>
  );
}
