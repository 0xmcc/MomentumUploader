"use client";

import { useClerk, useUser } from "@clerk/nextjs";
import {
  MemoDetailView,
  MemoSidebar,
  PrimaryHeaderControls,
  RecorderPanel,
} from "@/components/memos/MemoStudioSections";
import { useMemosWorkspace } from "@/hooks/useMemosWorkspace";

export default function Home() {
  const { isSignedIn, isLoaded } = useUser();
  const { openSignIn } = useClerk();

  const {
    filteredMemos,
    handleRecordingStop,
    handleUploadComplete,
    loading,
    retryUpload,
    searchQuery,
    selectedMemo,
    selectedMemoId,
    setSearchQuery,
    setSelectedMemoId,
    showUploadError,
  } = useMemosWorkspace({
    isLoaded,
    isSignedIn,
    openSignIn,
  });

  return (
    <main className="flex h-screen w-full bg-[#0A0A0A] overflow-hidden text-white font-sans">
      <MemoSidebar
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

        {selectedMemo ? (
          <MemoDetailView key={selectedMemo.id} memo={selectedMemo} />
        ) : (
          <RecorderPanel
            onRecordingStop={handleRecordingStop}
            onRetryUpload={retryUpload}
            onUploadComplete={handleUploadComplete}
            showUploadError={showUploadError}
          />
        )}
      </section>
    </main>
  );
}
