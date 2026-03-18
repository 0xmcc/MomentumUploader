import type { NextRequest } from "next/server";
import { resolveMemoUserId } from "@/lib/memo-api-auth";
import { resolveMemoShare } from "@/lib/memo-share";
import { isValidShareToken } from "@/lib/share-access";
import type { ResolvedMemoShare } from "@/lib/share-domain";

type SharedMemoRouteResult =
    | {
          ok: true;
          memo: ResolvedMemoShare;
      }
    | {
          ok: false;
          response: Response;
      };

type OwnedSharedMemoResult =
    | {
          ok: true;
          memo: ResolvedMemoShare;
          userId: string;
      }
    | {
          ok: false;
          response: Response;
      };

export function respondShareStatus(
    status: "not_found" | "revoked" | "expired"
): Response {
    if (status === "not_found") {
        return Response.json(
            { error: "This share link is not available." },
            { status: 404 }
        );
    }

    if (status === "revoked") {
        return Response.json(
            { error: "This share link is no longer active." },
            { status: 410 }
        );
    }

    return Response.json(
        { error: "This share link has expired." },
        { status: 410 }
    );
}

export async function resolveSharedMemoForRoute(
    shareRef: string
): Promise<SharedMemoRouteResult> {
    if (!isValidShareToken(shareRef)) {
        return { ok: false, response: respondShareStatus("not_found") };
    }

    const share = await resolveMemoShare(shareRef);
    if (share.status !== "ok") {
        return { ok: false, response: respondShareStatus(share.status) };
    }

    return { ok: true, memo: share.memo };
}

export async function requireOwnedSharedMemo(
    req: NextRequest,
    shareRef: string
): Promise<OwnedSharedMemoResult> {
    const shared = await resolveSharedMemoForRoute(shareRef);
    if (!shared.ok) {
        return shared;
    }

    const userId = await resolveMemoUserId(req);
    if (!userId) {
        return {
            ok: false,
            response: Response.json(
                { error: "Authentication required." },
                { status: 401 }
            ),
        };
    }

    if (!shared.memo.ownerUserId || shared.memo.ownerUserId !== userId) {
        return {
            ok: false,
            response: Response.json(
                { error: "Only the memo owner can access this route." },
                { status: 403 }
            ),
        };
    }

    return {
        ok: true,
        memo: shared.memo,
        userId,
    };
}
