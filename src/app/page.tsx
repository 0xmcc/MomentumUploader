"use client";

import { useClerk, useUser } from "@clerk/nextjs";
import { Loader2 } from "lucide-react";
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
    handleAudioInput,
    handleUploadComplete,
    loading,
    isUploading,
    retryUpload,
    searchQuery,
    selectedMemo,
    selectedMemoId,
    setSearchQuery,
    setSelectedMemoId,
    showUploadError,
    uploadProgressPercent,
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
        {isUploading && (
          <div className="pointer-events-none absolute left-1/2 top-6 z-40 w-[min(28rem,calc(100%-2rem))] -translate-x-1/2 rounded-xl border border-accent/30 bg-[#0f0f0f]/95 px-4 py-3 shadow-xl backdrop-blur-md">
            <div className="flex items-center gap-2 text-xs font-mono uppercase tracking-widest text-accent/90">
              <Loader2 size={12} className="animate-spin" />
              <span>
                {uploadProgressPercent >= 100
                  ? "Upload complete - transcribing"
                  : `Uploading ${uploadProgressPercent}%`}
              </span>
            </div>
            <div
              role="progressbar"
              aria-label="Workspace upload in progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={uploadProgressPercent}
              className="mt-2 h-1 overflow-hidden rounded-full bg-white/10"
            >
              <div
                className="h-full bg-accent/80 transition-[width] duration-300"
                style={{ width: `${uploadProgressPercent}%` }}
              />
            </div>
          </div>
        )}

        {selectedMemo ? (
          <MemoDetailView key={selectedMemo.id} memo={selectedMemo} />
        ) : (
          <RecorderPanel
            isUploading={isUploading}
            uploadProgressPercent={uploadProgressPercent}
            onAudioInput={handleAudioInput}
            onRetryUpload={retryUpload}
            onUploadComplete={handleUploadComplete}
            showUploadError={showUploadError}
          />
        )}
      </section>
    </main>
  );
}
