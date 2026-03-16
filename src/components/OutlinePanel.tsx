import type { ArtifactMap } from "@/lib/artifact-types";

type OutlinePayload = {
    items?: Array<{
        title?: string;
        summary?: string;
    }>;
};

export default function OutlinePanel({
    artifacts,
}: {
    artifacts: ArtifactMap | null;
}) {
    const outline = artifacts?.outline?.payload as OutlinePayload | null | undefined;
    const summary = artifacts?.rolling_summary?.payload as
        | { summary?: string }
        | null
        | undefined;

    return (
        <section className="border-t border-white/10 bg-[#171717] px-4 py-4 text-white">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-[0.14em] text-white/60">
                Structure
            </h2>
            {outline?.items && outline.items.length > 0 ? (
                <ol className="space-y-3">
                    {outline.items.map((item, index) => (
                        <li key={`${item.title ?? "section"}-${index}`} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
                            <p className="text-sm font-semibold text-white">
                                {item.title ?? "Untitled"}
                            </p>
                            <p className="mt-1 text-sm text-white/70">
                                {item.summary ?? ""}
                            </p>
                        </li>
                    ))}
                </ol>
            ) : summary?.summary ? (
                <p className="text-sm leading-6 text-white/75">{summary.summary}</p>
            ) : (
                <p className="text-sm text-white/50">Listening for structure…</p>
            )}
        </section>
    );
}
