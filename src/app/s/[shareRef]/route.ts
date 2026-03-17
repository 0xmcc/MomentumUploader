import {
    buildArtifactMap,
    createEmptyArtifactMap,
    type ArtifactMap,
} from "@/lib/artifact-types";
import { resolveMemoShare } from "@/lib/memo-share";
import {
    buildSharePageViewModel,
    buildShareErrorHtml,
    buildShareErrorMarkdown,
    buildSharedArtifactHtml,
    buildSharedArtifactJson,
    buildSharedArtifactMarkdown,
    parseShareRef,
    resolveShareFormat,
    type ShareFormat,
} from "@/lib/share-contract";
import { isValidShareToken } from "@/lib/share-access";
import { supabaseAdmin } from "@/lib/supabase";

type Params = { params: Promise<{ shareRef: string }> };
type ArtifactSource = "final" | "live";

const ALLOW = "GET, HEAD, OPTIONS";

function buildLinkHeader(canonicalUrl: string): string {
    return `<${canonicalUrl}>; rel="canonical", <${canonicalUrl}.md>; rel="alternate"; type="text/markdown", <${canonicalUrl}.json>; rel="alternate"; type="application/json"`;
}

function methodNotAllowed(): Response {
    return Response.json(
        { error: "Share routes are read-only." },
        {
            status: 405,
            headers: { Allow: ALLOW },
        }
    );
}

function respondError(status: number, format: ShareFormat, message: string): Response {
    if (format === "json") {
        return Response.json({ error: message }, { status });
    }

    if (format === "md") {
        return new Response(buildShareErrorMarkdown(message), {
            status,
            headers: { "content-type": "text/markdown; charset=utf-8" },
        });
    }

    return new Response(buildShareErrorHtml(message), {
        status,
        headers: { "content-type": "text/html; charset=utf-8" },
    });
}

async function fetchArtifactMap(memoId: string, source: ArtifactSource): Promise<ArtifactMap> {
    const { data: artifactRows } = await supabaseAdmin
        .from("memo_artifacts")
        .select(
            "artifact_type, payload, based_on_chunk_start, based_on_chunk_end, version, updated_at"
        )
        .eq("memo_id", memoId)
        .eq("source", source)
        .eq("status", "ready");

    if (!artifactRows || artifactRows.length === 0) {
        return createEmptyArtifactMap();
    }

    return buildArtifactMap(artifactRows as Parameters<typeof buildArtifactMap>[0]);
}

export async function GET(req: Request, { params }: Params): Promise<Response> {
    const { shareRef } = await params;
    const url = new URL(req.url);

    let parsedRef;
    try {
        parsedRef = parseShareRef(shareRef);
    } catch {
        return respondError(404, "html", "This share link is not available.");
    }

    const { shareToken, pathFormat } = parsedRef;
    const canonicalUrl = new URL(`/s/${shareToken}`, url.origin).toString();

    let format: ShareFormat;
    try {
        format = resolveShareFormat(pathFormat, url.searchParams.get("format"));
    } catch (error) {
        const message = error instanceof Error && error.message.includes("Unsupported format")
            ? "Unsupported share format. Use html, md, or json."
            : "Conflicting format selectors on this share URL.";
        return respondError(400, pathFormat, message);
    }

    if (!isValidShareToken(shareToken)) {
        return respondError(404, format, "This share link is not available.");
    }

    const share = await resolveMemoShare(shareToken);
    if (share.status !== "ok") {
        if (share.status === "not_found") {
            return respondError(404, format, "This share link is not available.");
        }

        if (share.status === "revoked") {
            return respondError(410, format, "This share link is no longer active.");
        }

        return respondError(410, format, "This share link has expired.");
    }

    const memo = share.memo;
    const artifactSource: ArtifactSource = memo.transcriptStatus === "complete" ? "final" : "live";
    const artifactMap = await fetchArtifactMap(memo.memoId, artifactSource);
    const linkHeader = buildLinkHeader(canonicalUrl);
    const viewModel = buildSharePageViewModel(memo, canonicalUrl, artifactMap);

    if (format === "json") {
        return Response.json(buildSharedArtifactJson(viewModel), {
            headers: { Link: linkHeader },
        });
    }

    if (format === "md") {
        return new Response(buildSharedArtifactMarkdown(viewModel), {
            headers: {
                "content-type": "text/markdown; charset=utf-8",
                Link: linkHeader,
            },
        });
    }

    return new Response(buildSharedArtifactHtml(viewModel), {
        headers: {
            "content-type": "text/html; charset=utf-8",
            Link: linkHeader,
        },
    });
}

export async function HEAD(req: Request, context: Params): Promise<Response> {
    const response = await GET(req, context);
    return new Response(null, {
        status: response.status,
        headers: response.headers,
    });
}

export async function OPTIONS(): Promise<Response> {
    return new Response(null, {
        status: 204,
        headers: {
            Allow: ALLOW,
        },
    });
}

export async function POST(): Promise<Response> {
    return methodNotAllowed();
}

export async function PUT(): Promise<Response> {
    return methodNotAllowed();
}

export async function PATCH(): Promise<Response> {
    return methodNotAllowed();
}

export async function DELETE(): Promise<Response> {
    return methodNotAllowed();
}
