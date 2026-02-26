import { NextResponse } from "next/server";
import { AGENT_MEMO_EXPORT_SKILL_MARKDOWN } from "@/lib/agent-memo-export-skill";

export async function GET() {
  return new NextResponse(AGENT_MEMO_EXPORT_SKILL_MARKDOWN, {
    status: 200,
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "Content-Disposition": 'inline; filename="agent-memo-export-skill.md"',
    },
  });
}
