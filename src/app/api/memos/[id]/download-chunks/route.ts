import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { supabaseAdmin } from "@/lib/supabase";

type Params = { params: Promise<{ id: string }> };

const CHUNK_FILE_NAME = /^\d{7}-\d{7}\.webm$/;

export async function GET(_req: NextRequest, { params }: Params) {
    const { userId } = await auth();
    if (!userId) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id: memoId } = await params;
    const chunkPrefix = `audio/chunks/${memoId}`;
    const storage = supabaseAdmin.storage.from("voice-memos");
    const { data: listedChunks, error: listError } = await storage.list(chunkPrefix, {
        limit: 1000,
        sortBy: { column: "name", order: "asc" },
    });

    if (listError) {
        return NextResponse.json({ error: "Failed to read uploaded chunks" }, { status: 500 });
    }

    const chunkNames = (listedChunks ?? [])
        .map((entry) => entry.name)
        .filter((name): name is string => CHUNK_FILE_NAME.test(name))
        .sort((left, right) => left.localeCompare(right));

    if (chunkNames.length === 0) {
        return NextResponse.json({ error: "No uploaded audio chunks were found." }, { status: 404 });
    }

    const buffers: Buffer[] = [];
    for (const chunkName of chunkNames) {
        const chunkPath = `${chunkPrefix}/${chunkName}`;
        const { data, error } = await storage.download(chunkPath);
        if (error || !data) {
            return NextResponse.json(
                { error: "Failed to download uploaded chunks" },
                { status: 500 }
            );
        }

        buffers.push(Buffer.from(await data.arrayBuffer()));
    }

    return new NextResponse(Buffer.concat(buffers), {
        headers: {
            "Content-Type": "audio/webm",
            "Content-Disposition": `attachment; filename=recording-${memoId}.webm`,
        },
    });
}
