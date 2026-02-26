import { Check, Link2, Loader2 } from "lucide-react";
import type { LiveShareState } from "@/hooks/useLiveTranscription";

type ShareButtonProps = {
    liveShareState: LiveShareState;
    liveShareUrl: string | null;
    label: string;
    onCopy: () => void;
};

export default function ShareButton({
    liveShareState,
    liveShareUrl,
    label,
    onCopy,
}: ShareButtonProps) {
    return (
        <div className="mt-2 flex items-center gap-2">
            <button
                type="button"
                onClick={onCopy}
                disabled={liveShareState === "loading"}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-mono uppercase tracking-wide transition-colors ${
                    liveShareState === "copied"
                        ? "border-emerald-500/40 text-emerald-300"
                        : "border-white/15 text-white/60 hover:border-accent/40 hover:text-accent"
                } ${liveShareState === "loading" ? "cursor-wait opacity-75" : ""}`}
            >
                {liveShareState === "loading" ? (
                    <Loader2 size={12} className="animate-spin" />
                ) : liveShareState === "copied" ? (
                    <Check size={12} />
                ) : (
                    <Link2 size={12} />
                )}
                {label}
            </button>
            {liveShareUrl && (
                <a
                    href={liveShareUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[10px] font-mono uppercase tracking-tight text-emerald-300/85 hover:text-emerald-200"
                    title="Open live share page"
                >
                    Open live page
                </a>
            )}
        </div>
    );
}
