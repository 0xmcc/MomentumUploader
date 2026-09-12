import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { buildIndex, graphIndex, searchIndex, tokenize } from "./repo-memory.mjs";

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "repo-memory-test-"));
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.mkdir(path.join(root, "docs"), { recursive: true });
  await fs.mkdir(path.join(root, "db"), { recursive: true });
  await fs.writeFile(path.join(root, "src", "api.ts"), [
    'import { saveMemo } from "./store";',
    'export async function POST(req: Request) {',
    '  const key = process.env.API_KEY;',
    '  const body = await req.json();',
    '  await saveMemo(body);',
    '  await supabase.from("memos").insert(body);',
    '  return fetch("https://example.test/hook");',
    '}',
    '',
  ].join("\n"));
  await fs.writeFile(path.join(root, "src", "store.ts"), 'export function saveMemo(value: unknown) { return value; }\n');
  await fs.writeFile(path.join(root, "docs", "architecture.md"), '# Architecture\n\nThe POST handler saves a memo.\n\n```ts\n// # not a heading\n```\n');
  await fs.writeFile(path.join(root, "db", "schema.sql"), "create table memos (id uuid primary key);\ncreate function save_one() returns void as $$ begin perform 1; end; $$ language plpgsql;\n");
  await fs.writeFile(path.join(root, "Client.swift"), 'struct MemoClient {\n  func upload() { print("}") }\n}\n');
  return root;
}

test("tokenizer splits identifiers and retains exact forms", () => {
  const terms = tokenize("resolveMemoUserId src/lib/memo-api-auth.ts");
  assert(terms.includes("resolve"));
  assert(terms.includes("memo"));
  assert(terms.includes("resolvememouserid"));
});

test("reserved object-property tokens do not corrupt ranking", async (t) => {
  const root = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.appendFile(path.join(root, "src", "store.ts"), "export class ConstructorRegistry {}\n");
  const { index } = await buildIndex({ root });
  const results = searchIndex(index, "constructor registry save memo", 5);
  assert(results.length > 0);
  assert(results.every((result) => Number.isFinite(result.score)));
});

test("index creates exact citations, language chunks, and graph edges", async (t) => {
  const root = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const { index, stats } = await buildIndex({ root });
  assert.equal(stats.files, 5);
  assert(index.files.some((file) => file.language === "swift"));
  assert(index.files.some((file) => file.language === "sql"));
  assert(index.files.some((file) => file.language === "markdown"));

  const results = searchIndex(index, "POST handler save memo", 5);
  assert.equal(results[0].path, "src/api.ts");
  assert.match(results[0].citation, /^src\/api\.ts:\d+-\d+$/);
  const source = await fs.readFile(path.join(root, results[0].path), "utf8");
  const cited = source.split(/\r?\n/).slice(results[0].startLine - 1, results[0].endLine).join("\n");
  assert(cited.includes("function POST"));

  const edges = graphIndex(index, "api.ts");
  assert(edges.some((edge) => edge.kind === "imports" && edge.rawTarget === "./store"));
  assert(edges.some((edge) => edge.kind === "imports_symbol" && edge.rawTarget === "saveMemo" && edge.resolvedTargetPath === "src/store.ts"));
  assert(edges.some((edge) => edge.kind === "calls" && edge.rawTarget === "saveMemo" && edge.resolvedTargetPath === "src/store.ts" && edge.confidence === "resolved"));
  assert(edges.some((edge) => edge.kind === "writes_data" && edge.rawTarget === "memos"));
  assert(edges.some((edge) => edge.kind === "fetches" && edge.rawTarget.includes("example.test")));
  assert(edges.some((edge) => edge.kind === "uses_env" && edge.rawTarget === "API_KEY"));
});

test("hybrid concept ranking remains deterministic and lexical mode stays available", async (t) => {
  const root = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const { index } = await buildIndex({ root });
  const hybrid = searchIndex(index, "Which recording is uploaded and persisted?", 5);
  const repeated = searchIndex(index, "Which recording is uploaded and persisted?", 5);
  const lexical = searchIndex(index, "Which recording is uploaded and persisted?", 5, { mode: "lexical" });
  assert.deepEqual(hybrid, repeated);
  assert(hybrid.length > 0);
  assert(lexical.length > 0);
});

test("incremental build reuses unchanged files and reparses only changes", async (t) => {
  const root = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const first = await buildIndex({ root });
  assert.equal(first.stats.reused, 0);
  const second = await buildIndex({ root });
  assert.equal(second.stats.reused, second.stats.files);
  await fs.appendFile(path.join(root, "src", "store.ts"), "export const version = 2;\n");
  const third = await buildIndex({ root });
  assert.equal(third.stats.parsed, 1);
  assert.equal(third.stats.reused, third.stats.files - 1);
});

test("SQL dollar quotes and Markdown fenced headings stay in coherent chunks", async (t) => {
  const root = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const { index } = await buildIndex({ root });
  const sql = index.files.find((file) => file.path === "db/schema.sql");
  assert.equal(sql.chunks.length, 2);
  assert(sql.chunks[1].text.includes("perform 1; end;"));
  const markdown = index.files.find((file) => file.path === "docs/architecture.md");
  assert.equal(markdown.chunks.length, 1);
});
