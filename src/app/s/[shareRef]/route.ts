import { resolveMemoShare } from "@/lib/memo-share";
import {
    buildShareErrorHtml,
    buildShareErrorMarkdown,
    buildSharedArtifactHtml,
    buildSharedArtifactJson,
    buildSharedArtifactMarkdown,
    isValidShareToken,
    parseShareRef,
    resolveShareFormat,
    type ShareFormat,
} from "@/lib/share-contract";

type Params = { params: Promise<{ shareRef: string }> };

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

    const share = await resolveMemoShare(shareToken, canonicalUrl);
    if (share.status !== "ok") {
        if (share.status === "not_found") {
            return respondError(404, format, "This share link is not available.");
        }

        if (share.status === "revoked") {
            return respondError(410, format, "This share link is no longer active.");
        }

        return respondError(410, format, "This share link has expired.");
    }

    const linkHeader = buildLinkHeader(canonicalUrl);

    if (format === "json") {
        return Response.json(buildSharedArtifactJson(share.artifact), {
            headers: { Link: linkHeader },
        });
    }

    if (format === "md") {
        return new Response(buildSharedArtifactMarkdown(share.artifact), {
            headers: {
                "content-type": "text/markdown; charset=utf-8",
                Link: linkHeader,
            },
        });
    }

    return new Response(buildSharedArtifactHtml(share.artifact), {
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
