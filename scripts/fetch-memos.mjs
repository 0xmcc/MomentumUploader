#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const DEFAULT_BASE_URL = "http://localhost:3000";
const DEFAULT_PAGE_SIZE = 200;

function printUsage() {
  console.log(`Fetch memos/transcripts from the MomentumUploader API.

Usage:
  node scripts/fetch-memos.mjs [options]

Options:
  --base-url <url>      API base URL (default: ${DEFAULT_BASE_URL})
  --search <query>      Optional transcript search filter
  --page-size <n>       Page size per request (default: ${DEFAULT_PAGE_SIZE}, max 200)
  --max-total <n>       Stop after exporting at most n memos
  --out <file>          JSON export path (default: tmp/memos-export-<timestamp>.json)
  --md-dir <dir>        Also export one markdown file per memo into this directory
  --help                Show this help

Auth:
  Set MEMOS_COOKIE to your app session cookie string, or MEMOS_BEARER_TOKEN
  for Authorization: Bearer <token>. Without auth, /api/memos returns empty.`);
}

function parseArgs(argv) {
  const args = {
    baseUrl: DEFAULT_BASE_URL,
    search: "",
    pageSize: DEFAULT_PAGE_SIZE,
    maxTotal: null,
    out: null,
    mdDir: null,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }
    if (arg === "--base-url") {
      args.baseUrl = argv[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (arg === "--search") {
      args.search = argv[i + 1] ?? "";
      i += 1;
      continue;
    }
    if (arg === "--page-size") {
      args.pageSize = Number(argv[i + 1] ?? DEFAULT_PAGE_SIZE);
      i += 1;
      continue;
    }
    if (arg === "--max-total") {
      args.maxTotal = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--out") {
      args.out = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (arg === "--md-dir") {
      args.mdDir = argv[i + 1] ?? null;
      i += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!args.baseUrl) {
    throw new Error("--base-url cannot be empty");
  }
  if (!Number.isFinite(args.pageSize) || args.pageSize <= 0) {
    throw new Error("--page-size must be a positive number");
  }
  args.pageSize = Math.min(Math.floor(args.pageSize), 200);

  if (
    args.maxTotal != null &&
    (!Number.isFinite(args.maxTotal) || args.maxTotal <= 0)
  ) {
    throw new Error("--max-total must be a positive number");
  }
  if (args.maxTotal != null) {
    args.maxTotal = Math.floor(args.maxTotal);
  }

  return args;
}

function toSafeFileToken(value) {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/-+/g, "-");
}

function memoMarkdown(memo) {
  const createdLabel = memo.createdAt
    ? new Date(memo.createdAt).toISOString()
    : "unknown";

  return [
    "---",
    `id: ${memo.id}`,
    `created_at: "${createdLabel}"`,
    `word_count: ${memo.wordCount ?? 0}`,
    memo.url ? `audio_url: "${memo.url}"` : null,
    "---",
    "",
    "# Memo Transcript",
    "",
    memo.transcript ?? "",
    "",
  ]
    .filter((line) => line != null)
    .join("\n");
}

async function fetchPage({ baseUrl, search, pageSize, offset, headers }) {
  const url = new URL("/api/memos", baseUrl);
  url.searchParams.set("limit", String(pageSize));
  url.searchParams.set("offset", String(offset));
  if (search) {
    url.searchParams.set("search", search);
  }

  const response = await fetch(url, { headers });
  if (!response.ok) {
    const bodyText = await response.text().catch(() => "");
    throw new Error(
      `GET ${url.toString()} failed with ${response.status}: ${bodyText}`
    );
  }

  const data = await response.json();
  const memos = Array.isArray(data?.memos) ? data.memos : [];
  const total =
    typeof data?.total === "number" && Number.isFinite(data.total)
      ? data.total
      : memos.length;

  return { memos, total };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  const cookie = process.env.MEMOS_COOKIE;
  const bearer = process.env.MEMOS_BEARER_TOKEN;

  const headers = {};
  if (cookie) {
    headers.Cookie = cookie;
  }
  if (bearer) {
    headers.Authorization = `Bearer ${bearer}`;
  }

  let offset = 0;
  let total = 0;
  const memos = [];

  while (true) {
    const page = await fetchPage({
      baseUrl: args.baseUrl,
      search: args.search,
      pageSize: args.pageSize,
      offset,
      headers,
    });

    total = page.total;
    if (page.memos.length === 0) {
      break;
    }

    memos.push(...page.memos);
    offset += page.memos.length;

    if (args.maxTotal != null && memos.length >= args.maxTotal) {
      memos.length = args.maxTotal;
      break;
    }
    if (offset >= total) {
      break;
    }
  }

  const nowIso = new Date().toISOString();
  const timestamp = nowIso.replace(/[:.]/g, "-");
  const outPath =
    args.out ?? path.join("tmp", `memos-export-${timestamp}.json`);

  const exportPayload = {
    exportedAt: nowIso,
    baseUrl: args.baseUrl,
    search: args.search,
    count: memos.length,
    total,
    memos,
  };

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, JSON.stringify(exportPayload, null, 2), "utf8");

  if (args.mdDir) {
    await fs.mkdir(args.mdDir, { recursive: true });
    for (const memo of memos) {
      const created = memo.createdAt
        ? new Date(memo.createdAt).toISOString().slice(0, 10)
        : "unknown-date";
      const fileName = `memo-${created}-${toSafeFileToken(String(memo.id).slice(0, 12))}.md`;
      const filePath = path.join(args.mdDir, fileName);
      await fs.writeFile(filePath, memoMarkdown(memo), "utf8");
    }
  }

  console.log(
    `Exported ${memos.length} memos to ${outPath}${
      args.mdDir ? ` and markdown files in ${args.mdDir}` : ""
    }.`
  );

  if (memos.length === 0) {
    console.log(
      "No memos returned. If you expected data, set MEMOS_COOKIE or MEMOS_BEARER_TOKEN."
    );
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
