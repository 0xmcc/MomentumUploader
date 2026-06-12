"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp } from "lucide-react";

/**
 * Lovable-style hero composer for the landing page. Submitting routes to the
 * workspace with the prompt in the query string, where SalesDocsWorkspace
 * seeds a new session from it and starts generation immediately.
 */
export default function LandingPromptForm({ className = "" }: { className?: string }) {
  const [draft, setDraft] = useState("");
  const router = useRouter();

  function submit() {
    const text = draft.trim();
    if (!text) return;
    router.push(`/sales-docs?prompt=${encodeURIComponent(text)}`);
  }

  return (
    <div
      className={`w-full max-w-[640px] rounded-2xl border border-[var(--sd-border-strong)] bg-[rgba(17,17,24,0.85)] px-4 pt-4 pb-3 text-left shadow-[0_24px_70px_rgba(0,0,0,0.5)] backdrop-blur transition-colors focus-within:border-[rgba(139,92,246,0.45)] ${className}`}
    >
      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="Describe your client or situation..."
        rows={2}
        className="w-full resize-none bg-transparent text-[15px] leading-relaxed text-[var(--sd-text)] placeholder:text-[var(--sd-text-faint)] focus:outline-none"
      />
      <div className="mt-1 flex items-center justify-between">
        <span className="text-[12px] text-[var(--sd-text-faint)]">
          Prospect, offer, price point — anything you know
        </span>
        <button
          type="button"
          onClick={submit}
          disabled={!draft.trim()}
          aria-label="Generate a call prep doc"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white transition-opacity disabled:opacity-40"
          style={{ background: "var(--sd-gradient-btn)" }}
        >
          <ArrowUp size={16} strokeWidth={2.4} />
        </button>
      </div>
    </div>
  );
}
