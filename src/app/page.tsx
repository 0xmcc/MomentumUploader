"use client";

import { useClerk, useUser } from "@clerk/nextjs";
import {
  MemoDetailView,
  MemoSidebar,
  PrimaryHeaderControls,
  RecorderPanel,
} from "@/components/memos/MemoStudioSections";
import StatusDot from "@/components/StatusDot";
import { useMemosWorkspace } from "@/hooks/useMemosWorkspace";

export default function Home() {
  const { isSignedIn, isLoaded } = useUser();
  const { openSignIn } = useClerk();

  const {
    filteredBookmarkedMemos,
    filteredMemos,
    handleUploadComplete,
    loading,
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
        onSelectMemo={setSelectedMemoId}
      />

      <section className="flex-1 flex flex-col relative bg-[#121212] overflow-y-auto">
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
          <RecorderPanel
            isUploading={isUploading}
            uploadProgressPercent={uploadProgressPercent}
            onRetryUpload={retryUpload}
            onUploadComplete={handleUploadComplete}
            showUploadError={showUploadError}
          />
        )}
      </section>
    </main>
  );
}
