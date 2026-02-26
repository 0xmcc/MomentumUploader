export const AGENT_MEMO_EXPORT_SKILL_MARKDOWN = `# Skill: Momentum Memos Export

## Purpose
Fetch all memos + transcripts from the MomentumUploader service and export them as:
- one JSON bundle
- optional per-memo markdown files

## API Contract
- Endpoint: \`GET /api/memos\`
- Pagination: \`limit\` (max \`200\`), \`offset\`
- Search filter: \`search\` (optional)
- Auth: Clerk session cookie or Bearer token

## Preferred Command
\`\`\`bash
MEMOS_COOKIE='__session=<clerk-session-cookie>' \\
npm run fetch:memos -- \\
  --base-url https://voice-memos.vercel.app \\
  --page-size 200 \\
  --out tmp/memos-export.json \\
  --md-dir tmp/memos-md
\`\`\`

## Alternative Auth
Generate a personal token first (signed-in user):
\`\`\`bash
curl -X POST https://voice-memos.vercel.app/api/auth/token \\
  -H "Cookie: __session=<clerk-session-cookie>" \\
  -H "Content-Type: application/json" \\
  -d '{"days":30}'
\`\`\`

Then export with that token:
\`\`\`bash
MEMOS_BEARER_TOKEN='<token>' \\
npm run fetch:memos -- --base-url https://voice-memos.vercel.app
\`\`\`

## Output Guarantees
- JSON object:
  - \`exportedAt\`
  - \`baseUrl\`
  - \`search\`
  - \`count\`
  - \`total\`
  - \`memos[]\`
- Each memo markdown file includes frontmatter metadata + transcript body.

## Operational Notes
- If auth is missing/invalid, \`/api/memos\` returns no memo rows for signed-out context.
- Prefer \`--page-size 200\` for fastest complete export.
- Use \`--max-total\` for bounded sampling during tests.

## Anthropic Custom Skill
If your environment supports Anthropic custom skills, use this markdown as the skill body/instructions and set the execution command to the \`npm run fetch:memos\` flow above.
`;
