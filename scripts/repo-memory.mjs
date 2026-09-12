#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const SCHEMA_VERSION = 2;
const PARSER_VERSION = "repo-memory-node-4";
const DEFAULT_OUT = ".repo-memory";
const INDEX_FILE = "index.json";
const CODE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]);
const TEXT_EXTENSIONS = new Set([
  ...CODE_EXTENSIONS, ".swift", ".sql", ".md", ".mdx", ".css", ".scss",
  ".json", ".yaml", ".yml", ".sh", ".proto",
]);
const SKIP_DIRS = new Set([
  ".git", ".next", "node_modules", "coverage", "out", "build", ".repo-memory",
  ".playwright-mcp",
]);
const SKIP_FILES = new Set([
  "docs/repo-memory-eval.json",
  "package-lock.json",
  "agent-worker/package-lock.json",
]);
const STOP_WORDS = new Set((
  "a an and are as at be before but by can does for from how in into is it its of on or " +
  "that the their then this through to user what when where which while who why with"
).split(/\s+/));

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function posix(relativePath) {
  return relativePath.split(path.sep).join("/");
}

function lineStartsOf(text) {
  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) starts.push(index + 1);
  }
  return starts;
}

function lineAt(starts, offset) {
  let low = 0;
  let high = starts.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (starts[mid] <= offset) low = mid + 1;
    else high = mid;
  }
  return Math.max(1, low);
}

function languageFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if ([".ts", ".tsx"].includes(ext)) return "typescript";
  if ([".js", ".jsx", ".mjs", ".cjs"].includes(ext)) return "javascript";
  if (ext === ".swift") return "swift";
  if (ext === ".sql") return "sql";
  if ([".md", ".mdx"].includes(ext)) return "markdown";
  return ext.slice(1) || "text";
}

export function tokenize(value) {
  const expanded = String(value)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\\/.-]+/g, " ")
    .toLowerCase();
  const base = expanded.match(/[\p{L}\p{N}@$][\p{L}\p{N}@$:-]*/gu) ?? [];
  const exact = String(value).toLowerCase().match(/[\p{L}\p{N}_@$/.-]{2,}/gu) ?? [];
  return [...base, ...exact].filter((term) => term.length > 1 && !STOP_WORDS.has(term));
}

function countTerms(value) {
  const terms = Object.create(null);
  for (const term of tokenize(value)) {
    const count = Object.hasOwn(terms, term) ? terms[term] : 0;
    terms[term] = count + 1;
  }
  return terms;
}

function termCount(terms, term) {
  return Object.hasOwn(terms, term) && Number.isFinite(terms[term]) ? terms[term] : 0;
}

function documentLength(terms) {
  return Object.values(terms).reduce((sum, value) => sum + (Number.isFinite(value) ? value : 0), 0);
}

const CONCEPT_ALIASES = new Map(Object.entries({
  authenticated: "auth", authentication: "auth", authorize: "auth", authorized: "auth",
  clerk: "auth", owner: "auth", ownership: "auth", signin: "auth", "sign-in": "auth",
  generated: "generate", generation: "generate", generator: "generate",
  persisted: "persist", persistence: "persist", saving: "persist", saved: "persist", stored: "persist",
  database: "persist", supabase: "persist",
  recorded: "record", recorder: "record", recording: "record", microphone: "record",
  transcribe: "transcript", transcribed: "transcript", transcription: "transcript",
  uploaded: "upload", uploading: "upload", mp3: "upload", m4a: "upload", signedurl: "upload",
  finalized: "finalize", finalization: "finalize", final: "finalize",
  controls: "control", buttons: "control", inert: "visual-only", static: "visual-only", mock: "visual-only",
  worker: "job", queue: "job", queued: "job", jobs: "job",
  callers: "call", callee: "call", callees: "call", invoked: "call", invokes: "call",
}));

function conceptFor(term) {
  const normalized = term.toLowerCase();
  if (CONCEPT_ALIASES.has(normalized)) return CONCEPT_ALIASES.get(normalized);
  if (normalized.length > 5 && normalized.endsWith("ing")) return normalized.slice(0, -3);
  if (normalized.length > 4 && normalized.endsWith("ed")) return normalized.slice(0, -2);
  if (normalized.length > 4 && normalized.endsWith("s")) return normalized.slice(0, -1);
  return normalized;
}

function makeChunk({ file, language, kind, name, start, end, text, starts, ordinal, headingPath }) {
  const boundedStart = Math.max(0, Math.min(start, text.length));
  const boundedEnd = Math.max(boundedStart, Math.min(end, text.length));
  const source = text.slice(boundedStart, boundedEnd);
  const logicalName = name || `${kind}-${ordinal}`;
  return {
    chunkKey: sha256(`${file}\0${kind}\0${logicalName}\0${ordinal}`).slice(0, 24),
    contentHash: sha256(source),
    path: file,
    language,
    kind,
    qualifiedName: name || null,
    headingPath: headingPath ?? null,
    startOffset: boundedStart,
    endOffset: boundedEnd,
    startLine: lineAt(starts, boundedStart),
    endLine: lineAt(starts, Math.max(boundedStart, boundedEnd - 1)),
    tokenEstimate: Math.ceil(source.length / 4),
    text: source,
    terms: countTerms(`${file} ${logicalName} ${(headingPath ?? []).join(" ")} ${source}`),
  };
}

function splitLargeRange(range, text, starts, maxChars = 12000, maxLines = 260) {
  const startLine = lineAt(starts, range.start);
  const endLine = lineAt(starts, Math.max(range.start, range.end - 1));
  if (range.end - range.start <= maxChars && endLine - startLine + 1 <= maxLines) return [range];
  const pieces = [];
  let cursor = range.start;
  while (cursor < range.end) {
    let end = Math.min(range.end, cursor + maxChars);
    const maxLineEnd = starts[Math.min(starts.length - 1, lineAt(starts, cursor) - 1 + maxLines)];
    if (maxLineEnd && maxLineEnd > cursor) end = Math.min(end, maxLineEnd);
    if (end < range.end) {
      const boundary = text.lastIndexOf("\n", end);
      if (boundary > cursor + 200) end = boundary + 1;
    }
    pieces.push({ ...range, start: cursor, end, part: pieces.length + 1 });
    cursor = end;
  }
  return pieces;
}

function tsName(node, sourceFile) {
  if (node.name && ts.isIdentifier(node.name)) return node.name.text;
  if (node.name && ts.isStringLiteral(node.name)) return node.name.text;
  if (ts.isVariableStatement(node)) {
    return node.declarationList.declarations.map((decl) => decl.name.getText(sourceFile)).join(", ");
  }
  if (ts.isExportAssignment(node)) return "default export";
  return null;
}

function tsKind(node) {
  if (ts.isFunctionDeclaration(node)) return "function";
  if (ts.isClassDeclaration(node)) return "class";
  if (ts.isInterfaceDeclaration(node)) return "interface";
  if (ts.isTypeAliasDeclaration(node)) return "type";
  if (ts.isEnumDeclaration(node)) return "enum";
  if (ts.isVariableStatement(node)) return "variable";
  if (ts.isImportDeclaration(node)) return "import";
  if (ts.isExportDeclaration(node) || ts.isExportAssignment(node)) return "export";
  return "statement";
}

function literalText(node) {
  return node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    ? node.text
    : null;
}

function enclosingTsSymbol(node) {
  for (let current = node.parent; current; current = current.parent) {
    if (
      ts.isFunctionDeclaration(current) || ts.isMethodDeclaration(current) ||
      ts.isClassDeclaration(current) || ts.isFunctionExpression(current) ||
      ts.isArrowFunction(current)
    ) {
      if (current.name && ts.isIdentifier(current.name)) return current.name.text;
      if ((ts.isFunctionExpression(current) || ts.isArrowFunction(current)) && ts.isVariableDeclaration(current.parent)) {
        return current.parent.name.getText();
      }
    }
  }
  return null;
}

function extractTsEdges(sourceFile, file) {
  const edges = [];
  const add = (kind, rawTarget, node, extra = {}) => {
    if (!rawTarget) return;
    edges.push({ sourcePath: file, sourceSymbol: enclosingTsSymbol(node), kind, rawTarget, line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1, ...extra });
  };
  const visit = (node) => {
    if (ts.isImportDeclaration(node)) {
      const module = literalText(node.moduleSpecifier);
      add("imports", module, node);
      const clause = node.importClause;
      if (clause?.name) add("imports_symbol", clause.name.text, node, { module, importedName: "default" });
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) {
          add("imports_symbol", element.name.text, element, { module, importedName: element.propertyName?.text ?? element.name.text });
        }
      }
      if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
        add("imports_symbol", clause.namedBindings.name.text, clause.namedBindings, { module, importedName: "*" });
      }
    }
    if (ts.isExportDeclaration(node) && node.moduleSpecifier) add("exports", literalText(node.moduleSpecifier), node);
    if (ts.isPropertyAccessExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const receiver = node.expression;
      if (ts.isCallExpression(receiver) && ts.isPropertyAccessExpression(receiver.expression)) {
        const method = receiver.expression.name.text;
        const target = literalText(receiver.arguments[0]);
        if (method === "from" && target) {
          const operation = node.name.text;
          const write = ["insert", "upsert", "update", "delete", "upload", "remove"].includes(operation);
          add(write ? "writes_data" : "reads_data", target, node, { operation });
        }
        if (method === "rpc" && target) add("calls_rpc", target, node);
      }
    }
    if (ts.isCallExpression(node)) {
      if (ts.isIdentifier(node.expression)) {
        const called = node.expression.text;
        if (called === "fetch") add("fetches", literalText(node.arguments[0]), node);
        else if (!["String", "Number", "Boolean", "Array", "Object", "Promise"].includes(called)) add("calls", called, node);
      } else if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "rpc") {
        add("calls_rpc", literalText(node.arguments[0]), node);
      } else if (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "from") {
        add("reads_data", literalText(node.arguments[0]), node, { operation: "from" });
      } else if (ts.isPropertyAccessExpression(node.expression)) {
        const operation = node.expression.name.text;
        const receiver = node.expression.expression;
        if (
          ts.isCallExpression(receiver) &&
          ts.isPropertyAccessExpression(receiver.expression) &&
          receiver.expression.name.text === "from"
        ) {
          const target = literalText(receiver.arguments[0]);
          const write = ["insert", "upsert", "update", "delete", "upload", "remove"].includes(operation);
          add(write ? "writes_data" : "reads_data", target, node, { operation });
        }
      }
    }
    if (ts.isPropertyAccessExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      if (node.expression.expression.getText(sourceFile) === "process" && node.expression.name.text === "env") {
        add("uses_env", node.name.text, node);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return edges;
}

function chunkTypeScript(text, file, language) {
  const starts = lineStartsOf(text);
  const scriptKind = file.endsWith("x") ? ts.ScriptKind.TSX : file.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sourceFile = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, scriptKind);
  const chunks = [];
  const symbols = [];
  let ordinal = 0;
  for (const statement of sourceFile.statements) {
    const name = tsName(statement, sourceFile);
    const kind = tsKind(statement);
    const range = { start: statement.getFullStart(), end: statement.end, name, kind };
    const parts = splitLargeRange(range, text, starts);
    for (const part of parts) {
      const displayName = parts.length > 1 && name ? `${name} part ${part.part}/${parts.length}` : name;
      chunks.push(makeChunk({ file, language, kind, name: displayName, start: part.start, end: part.end, text, starts, ordinal: ordinal++ }));
    }
    if (name) {
      const modifiers = ts.canHaveModifiers(statement) ? ts.getModifiers(statement) ?? [] : [];
      symbols.push({
        symbolId: sha256(`${file}\0${kind}\0${name}`).slice(0, 24), name,
        qualifiedName: `${file}#${name}`, kind, path: file,
        chunkKey: chunks[chunks.length - parts.length].chunkKey,
        startLine: lineAt(starts, statement.getStart(sourceFile)),
        endLine: lineAt(starts, Math.max(statement.getStart(sourceFile), statement.end - 1)),
        exported: modifiers.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword),
      });
    }
  }
  if (chunks.length === 0 && text.trim()) chunks.push(makeChunk({ file, language, kind: "module", start: 0, end: text.length, text, starts, ordinal: 0 }));
  return { chunks, symbols, edges: extractTsEdges(sourceFile, file) };
}

function maskSwift(text) {
  const out = [...text];
  let state = "code";
  let blockDepth = 0;
  for (let i = 0; i < text.length; i += 1) {
    const pair = text.slice(i, i + 2);
    const triple = text.slice(i, i + 3);
    if (state === "code" && pair === "//") state = "line";
    else if (state === "code" && pair === "/*") { state = "block"; blockDepth = 1; }
    else if (state === "code" && triple === '\"\"\"') { state = "multi"; out[i] = out[i + 1] = out[i + 2] = " "; i += 2; continue; }
    else if (state === "code" && text[i] === '\"') state = "string";
    else if (state === "line" && text[i] === "\n") state = "code";
    else if (state === "block" && pair === "/*") { blockDepth += 1; out[i] = out[i + 1] = " "; i += 1; continue; }
    else if (state === "block" && pair === "*/") { blockDepth -= 1; out[i] = out[i + 1] = " "; i += 1; if (!blockDepth) state = "code"; continue; }
    else if (state === "multi" && triple === '\"\"\"') { out[i] = out[i + 1] = out[i + 2] = " "; i += 2; state = "code"; continue; }
    else if (state === "string" && text[i] === "\\") { out[i] = " "; if (i + 1 < out.length) out[++i] = " "; continue; }
    else if (state === "string" && text[i] === '\"') { out[i] = " "; state = "code"; continue; }
    if (state !== "code" && text[i] !== "\n") out[i] = " ";
  }
  return out.join("");
}

function chunkSwift(text, file) {
  const starts = lineStartsOf(text);
  const masked = maskSwift(text);
  const lineRanges = [];
  let depth = 0;
  let active = null;
  const declaration = /^\s*(?:@[\w()., "-]+\s+)*(?:(?:public|private|internal|fileprivate|open|final|static|class|mutating|nonmutating|override|required|convenience)\s+)*(actor|class|struct|enum|protocol|extension|func|init|deinit)\s*([A-Za-z_$][\w$]*)?/;
  for (let lineIndex = 0; lineIndex < starts.length; lineIndex += 1) {
    const begin = starts[lineIndex];
    const end = starts[lineIndex + 1] ?? text.length;
    const line = masked.slice(begin, end);
    const match = depth === 0 ? line.match(declaration) : null;
    if (match && !active) active = { start: begin, name: match[2] || match[1], kind: match[1], startDepth: depth };
    for (const char of line) { if (char === "{") depth += 1; else if (char === "}") depth = Math.max(0, depth - 1); }
    if (active && depth === active.startDepth && (line.includes("}") || (!line.includes("{") && active.kind === "func"))) {
      lineRanges.push({ ...active, end }); active = null;
    }
  }
  if (active) lineRanges.push({ ...active, end: text.length });
  return chunksFromRanges(text, file, "swift", lineRanges, starts);
}

function sqlStatements(text) {
  const ranges = [];
  let start = 0;
  let state = "code";
  let dollar = null;
  for (let i = 0; i < text.length; i += 1) {
    const pair = text.slice(i, i + 2);
    if (state === "code" && pair === "--") { state = "line"; i += 1; continue; }
    if (state === "code" && pair === "/*") { state = "block"; i += 1; continue; }
    if (state === "line" && text[i] === "\n") { state = "code"; continue; }
    if (state === "block" && pair === "*/") { state = "code"; i += 1; continue; }
    if (state === "single" && text[i] === "'" && text[i + 1] === "'") { i += 1; continue; }
    if (state === "single" && text[i] === "'") { state = "code"; continue; }
    if (state === "double" && text[i] === '"' && text[i + 1] === '"') { i += 1; continue; }
    if (state === "double" && text[i] === '"') { state = "code"; continue; }
    if (state === "dollar" && text.startsWith(dollar, i)) { i += dollar.length - 1; state = "code"; dollar = null; continue; }
    if (state !== "code") continue;
    if (text[i] === "'") { state = "single"; continue; }
    if (text[i] === '"') { state = "double"; continue; }
    if (text[i] === "$") {
      const match = text.slice(i).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
      if (match) { dollar = match[0]; state = "dollar"; i += dollar.length - 1; continue; }
    }
    if (text[i] === ";") { ranges.push({ start, end: i + 1 }); start = i + 1; }
  }
  if (text.slice(start).trim()) ranges.push({ start, end: text.length });
  return ranges;
}

function chunkSql(text, file) {
  const starts = lineStartsOf(text);
  const ranges = sqlStatements(text).map((range) => {
    const source = text.slice(range.start, range.end);
    const match = source.match(/\b(?:create\s+(?:or\s+replace\s+)?|alter\s+)(table|function|procedure|view|index|policy|trigger|type)\s+(?:if\s+not\s+exists\s+)?([\w."-]+)/i);
    return { ...range, kind: match?.[1]?.toLowerCase() ?? "sql", name: match?.[2] ?? null };
  });
  const result = chunksFromRanges(text, file, "sql", ranges, starts);
  const edges = [];
  for (const range of ranges) {
    const source = text.slice(range.start, range.end);
    for (const match of source.matchAll(/\breferences\s+([\w."]+)/gi)) edges.push({ sourcePath: file, kind: "foreign_key", rawTarget: match[1], line: lineAt(starts, range.start + match.index) });
    for (const match of source.matchAll(/\b(?:from|into|update|table)\s+([\w."]+)/gi)) edges.push({ sourcePath: file, kind: /\b(?:insert|update|delete|alter|create)\b/i.test(source) ? "writes_data" : "reads_data", rawTarget: match[1], line: lineAt(starts, range.start + match.index) });
  }
  result.edges = edges;
  return result;
}

function chunkMarkdown(text, file) {
  const starts = lineStartsOf(text);
  const ranges = [];
  let current = 0;
  let fence = null;
  let headings = [];
  for (let index = 0; index < starts.length; index += 1) {
    const begin = starts[index];
    const end = starts[index + 1] ?? text.length;
    const line = text.slice(begin, end);
    const fenceMatch = line.match(/^\s*(```+|~~~+)/);
    if (fenceMatch) { if (!fence) fence = fenceMatch[1][0]; else if (fence === fenceMatch[1][0]) fence = null; continue; }
    if (fence) continue;
    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      if (begin > current && text.slice(current, begin).trim()) ranges.push({ start: current, end: begin, kind: "section", name: headings.at(-1) ?? "preamble", headingPath: [...headings] });
      const level = heading[1].length;
      headings = headings.slice(0, level - 1);
      headings[level - 1] = heading[2].trim();
      current = begin;
    }
  }
  if (text.slice(current).trim()) ranges.push({ start: current, end: text.length, kind: "section", name: headings.at(-1) ?? "document", headingPath: [...headings] });
  const result = chunksFromRanges(text, file, "markdown", ranges, starts);
  result.edges = [...text.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map((match) => ({ sourcePath: file, kind: "links", rawTarget: match[1], line: lineAt(starts, match.index) }));
  return result;
}

function chunksFromRanges(text, file, language, ranges, starts = lineStartsOf(text)) {
  const chunks = [];
  const symbols = [];
  let ordinal = 0;
  for (const range of ranges) {
    const parts = splitLargeRange(range, text, starts);
    for (const part of parts) chunks.push(makeChunk({ file, language, kind: range.kind ?? "block", name: range.name, start: part.start, end: part.end, text, starts, ordinal: ordinal++, headingPath: range.headingPath }));
    if (range.name) symbols.push({ symbolId: sha256(`${file}\0${range.kind}\0${range.name}`).slice(0, 24), name: range.name, qualifiedName: `${file}#${range.name}`, kind: range.kind, path: file, chunkKey: chunks[chunks.length - parts.length].chunkKey, startLine: lineAt(starts, range.start), endLine: lineAt(starts, Math.max(range.start, range.end - 1)), exported: true });
  }
  if (!chunks.length && text.trim()) chunks.push(makeChunk({ file, language, kind: "document", start: 0, end: text.length, text, starts, ordinal: 0 }));
  return { chunks, symbols, edges: [] };
}

function parseFile(text, file) {
  const language = languageFor(file);
  if (CODE_EXTENSIONS.has(path.extname(file).toLowerCase())) return chunkTypeScript(text, file, language);
  if (language === "swift") return chunkSwift(text, file);
  if (language === "sql") return chunkSql(text, file);
  if (language === "markdown") return chunkMarkdown(text, file);
  return chunksFromRanges(text, file, language, [{ start: 0, end: text.length, kind: "document", name: path.basename(file) }]);
}

async function discover(root, outDir) {
  const files = [];
  const outRelative = posix(path.relative(root, outDir));
  async function walk(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relative = posix(path.relative(root, absolute));
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || relative === outRelative) continue;
        await walk(absolute);
      } else if (entry.isFile() && !SKIP_FILES.has(relative) && TEXT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(relative);
    }
  }
  await walk(root);
  return files;
}

async function readIndex(outDir) {
  try { return JSON.parse(await fs.readFile(path.join(outDir, INDEX_FILE), "utf8")); }
  catch { return null; }
}

export async function buildIndex({ root = process.cwd(), out = DEFAULT_OUT } = {}) {
  root = path.resolve(root);
  const outDir = path.resolve(root, out);
  const prior = await readIndex(outDir);
  const priorFiles = new Map((prior?.files ?? []).map((file) => [file.path, file]));
  const files = [];
  let reused = 0;
  for (const relative of await discover(root, outDir)) {
    const buffer = await fs.readFile(path.join(root, relative));
    if (buffer.subarray(0, 8192).includes(0)) continue;
    const contentHash = sha256(buffer);
    const previous = priorFiles.get(relative);
    if (previous?.contentHash === contentHash && previous.parserVersion === PARSER_VERSION) {
      files.push(previous); reused += 1; continue;
    }
    const text = buffer.toString("utf8");
    const parsed = parseFile(text, relative);
    files.push({ path: relative, language: languageFor(relative), contentHash, parserVersion: PARSER_VERSION, ...parsed });
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  resolveIndexEdges(files);
  const index = { schemaVersion: SCHEMA_VERSION, parserVersion: PARSER_VERSION, root, generatedAt: new Date().toISOString(), files };
  await fs.mkdir(outDir, { recursive: true });
  const temp = path.join(outDir, `${INDEX_FILE}.${process.pid}.tmp`);
  await fs.writeFile(temp, `${JSON.stringify(index)}\n`, "utf8");
  await fs.rename(temp, path.join(outDir, INDEX_FILE));
  return { index, stats: { files: files.length, chunks: files.reduce((sum, file) => sum + file.chunks.length, 0), symbols: files.reduce((sum, file) => sum + file.symbols.length, 0), edges: files.reduce((sum, file) => sum + file.edges.length, 0), reused, parsed: files.length - reused } };
}

function allChunks(index) { return index.files.flatMap((file) => file.chunks); }

function resolveImportPath(sourcePath, rawTarget, knownPaths) {
  if (rawTarget?.startsWith("/api/")) {
    const route = `src/app${rawTarget.split(/[?#]/, 1)[0]}/route.ts`;
    return knownPaths.has(route) ? route : null;
  }
  if (!rawTarget || !(rawTarget.startsWith(".") || rawTarget.startsWith("@/"))) return null;
  const base = rawTarget.startsWith("@/")
    ? `src/${rawTarget.slice(2)}`
    : path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), rawTarget));
  for (const candidate of [base, ...[".ts", ".tsx", ".js", ".jsx", ".mjs"].map((ext) => `${base}${ext}`), ...[".ts", ".tsx", ".js", ".jsx"].map((ext) => `${base}/index${ext}`)]) {
    if (knownPaths.has(candidate)) return candidate;
  }
  return null;
}

function resolveIndexEdges(files) {
  const knownPaths = new Set(files.map((file) => file.path));
  const filesByPath = new Map(files.map((file) => [file.path, file]));
  for (const file of files) {
    const importedBindings = new Map();
    for (const edge of file.edges) {
      if (edge.kind !== "imports_symbol") continue;
      const targetPath = resolveImportPath(file.path, edge.module, knownPaths);
      if (!targetPath) continue;
      importedBindings.set(edge.rawTarget, {
        path: targetPath,
        symbol: edge.importedName === "default" ? null : edge.importedName,
      });
      edge.resolvedTargetPath = targetPath;
      edge.resolvedTargetSymbol = edge.importedName === "default" ? null : edge.importedName;
      edge.confidence = "resolved";
    }
    const localSymbols = new Set(file.symbols.flatMap((symbol) => symbol.name.split(/\s*,\s*/)));
    for (const edge of file.edges) {
      if (["imports", "exports", "fetches"].includes(edge.kind)) {
        const targetPath = resolveImportPath(file.path, edge.rawTarget, knownPaths);
        if (targetPath) {
          edge.resolvedTargetPath = targetPath;
          edge.confidence = "resolved";
        }
      }
      if (edge.kind !== "calls") continue;
      const imported = importedBindings.get(edge.rawTarget);
      if (imported) {
        edge.resolvedTargetPath = imported.path;
        edge.resolvedTargetSymbol = imported.symbol ?? edge.rawTarget;
        edge.confidence = filesByPath.get(imported.path)?.symbols.some((symbol) => symbol.name === edge.resolvedTargetSymbol)
          ? "resolved"
          : "probable";
      } else if (localSymbols.has(edge.rawTarget)) {
        edge.resolvedTargetPath = file.path;
        edge.resolvedTargetSymbol = edge.rawTarget;
        edge.confidence = "resolved";
      } else {
        edge.confidence = "textual";
      }
    }
  }
}

export function searchIndex(index, query, limit = 10, { mode = "hybrid" } = {}) {
  const chunks = allChunks(index);
  const queryTerms = [...new Set(tokenize(query))];
  const queryConcepts = new Set(queryTerms.map(conceptFor));
  const df = new Map();
  let totalLength = 0;
  for (const chunk of chunks) {
    totalLength += documentLength(chunk.terms);
    for (const term of queryTerms) if (termCount(chunk.terms, term)) df.set(term, (df.get(term) ?? 0) + 1);
  }
  const avgLength = totalLength / Math.max(1, chunks.length);
  const lowered = query.toLowerCase();
  const scored = chunks.map((chunk) => {
    const length = documentLength(chunk.terms);
    let score = 0;
    const why = [];
    for (const term of queryTerms) {
      const tf = termCount(chunk.terms, term);
      if (!tf) continue;
      const idf = Math.log(1 + (chunks.length - (df.get(term) ?? 0) + 0.5) / ((df.get(term) ?? 0) + 0.5));
      score += idf * ((tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * length / Math.max(1, avgLength))));
    }
    const name = (chunk.qualifiedName ?? "").toLowerCase();
    const file = chunk.path.toLowerCase();
    if (name && lowered.includes(name)) { score += 12; why.push("exact symbol"); }
    for (const term of queryTerms) {
      if (name === term) score += 8;
      if (file.includes(term)) score += 1.5;
    }
    const matched = queryTerms.filter((term) => termCount(chunk.terms, term)).length;
    if (matched === queryTerms.length && queryTerms.length > 1) { score += 2; why.push("all terms"); }
    if (mode === "hybrid" && queryConcepts.size) {
      const chunkConcepts = new Set(Object.keys(chunk.terms).map(conceptFor));
      const semanticMatches = [...queryConcepts].filter((concept) => chunkConcepts.has(concept)).length;
      const semanticScore = 4 * semanticMatches / queryConcepts.size;
      score += semanticScore;
      if (semanticScore >= 1) why.push("semantic concepts");
    }
    const isTest = /(?:\.test\.|__tests__)/.test(chunk.path);
    if (isTest) score -= 2;
    else if (chunk.path.startsWith("src/") || chunk.path.startsWith("agent-worker/src/")) score += 2;
    return { chunk, score, why, matched };
  }).filter((entry) => entry.score > 0).sort((a, b) => b.score - a.score || b.matched - a.matched || a.chunk.path.localeCompare(b.chunk.path) || a.chunk.startLine - b.chunk.startLine);

  // Collapse to files first, then expand through explicit path references in the
  // strongest chunks. Architecture notes and tests often name the implementation
  // even when the user's vocabulary does not appear in the implementation itself.
  const bestByPath = new Map();
  for (const entry of scored) {
    if (!bestByPath.has(entry.chunk.path)) bestByPath.set(entry.chunk.path, { ...entry, referenceBoost: 0 });
  }
  if (mode === "lexical") {
    return [...bestByPath.values()].slice(0, limit).map((entry) => ({
      score: Number(entry.score.toFixed(4)), path: entry.chunk.path,
      startLine: entry.chunk.startLine, endLine: entry.chunk.endLine,
      citation: `${entry.chunk.path}:${entry.chunk.startLine}-${entry.chunk.endLine}`,
      kind: entry.chunk.kind, qualifiedName: entry.chunk.qualifiedName,
      snippet: entry.chunk.text.split(/\r?\n/).slice(0, 12).join("\n"), why: entry.why,
    }));
  }
  const knownPaths = index.files.map((file) => file.path);
  for (const source of scored.slice(0, 24)) {
    for (const candidate of knownPaths) {
      if (candidate === source.chunk.path || !source.chunk.text.includes(candidate)) continue;
      if (!bestByPath.has(candidate)) {
        const chunk = index.files.find((file) => file.path === candidate)?.chunks[0];
        if (!chunk) continue;
        bestByPath.set(candidate, { chunk, score: 0, why: [], matched: 0, referenceBoost: 0 });
      }
      const target = bestByPath.get(candidate);
      target.referenceBoost = Math.max(target.referenceBoost, Math.min(24, source.score * 0.8 + 2));
    }
  }
  const knownPathSet = new Set(knownPaths);
  const neighbors = new Map(knownPaths.map((file) => [file, new Set()]));
  for (const file of index.files) {
    for (const edge of file.edges) {
      if (!["imports", "exports", "fetches"].includes(edge.kind)) continue;
      const target = edge.resolvedTargetPath ?? resolveImportPath(file.path, edge.rawTarget, knownPathSet);
      if (!target) continue;
      neighbors.get(file.path).add(target);
      neighbors.get(target).add(file.path);
    }
  }
  const seedFiles = [...bestByPath.values()]
    .sort((a, b) => (b.score + b.referenceBoost) - (a.score + a.referenceBoost))
    .slice(0, 30);
  for (const source of seedFiles) {
    const sourceScore = source.score + source.referenceBoost;
    for (const candidate of neighbors.get(source.chunk.path) ?? []) {
      if (!bestByPath.has(candidate)) {
        const chunk = index.files.find((file) => file.path === candidate)?.chunks[0];
        if (!chunk) continue;
        bestByPath.set(candidate, { chunk, score: 0, why: [], matched: 0, referenceBoost: 0 });
      }
      const target = bestByPath.get(candidate);
      const sourceIsTest = /(?:\.test\.|__tests__)/.test(source.chunk.path);
      const targetIsTest = /(?:\.test\.|__tests__)/.test(candidate);
      const factor = sourceIsTest && !targetIsTest ? 1 : 0.78;
      const graphBoost = Math.min(40, sourceScore * factor + 1);
      if (graphBoost > target.referenceBoost) {
        target.referenceBoost = graphBoost;
        target.why = [...target.why, `connected to ${source.chunk.path}`];
      }
    }
  }
  const rankedFiles = [...bestByPath.values()].map((entry) => ({
    ...entry,
    score: entry.score + entry.referenceBoost,
    why: entry.referenceBoost ? [...entry.why, "referenced by a strong match"] : entry.why,
  })).sort((a, b) => b.score - a.score || b.matched - a.matched || a.chunk.path.localeCompare(b.chunk.path) || a.chunk.startLine - b.chunk.startLine);
  const results = [];
  for (const entry of rankedFiles) {
    results.push({ score: Number(entry.score.toFixed(4)), path: entry.chunk.path, startLine: entry.chunk.startLine, endLine: entry.chunk.endLine, citation: `${entry.chunk.path}:${entry.chunk.startLine}-${entry.chunk.endLine}`, kind: entry.chunk.kind, qualifiedName: entry.chunk.qualifiedName, snippet: entry.chunk.text.split(/\r?\n/).slice(0, 12).join("\n"), why: entry.why });
    if (results.length >= limit) break;
  }
  return results;
}

export function graphIndex(index, filter = "") {
  const lowered = filter.toLowerCase();
  return index.files.flatMap((file) => file.edges).filter((edge) => !lowered || [
    edge.sourcePath, edge.sourceSymbol, edge.rawTarget,
    edge.resolvedTargetPath, edge.resolvedTargetSymbol,
  ].some((value) => value?.toLowerCase().includes(lowered))).sort((a, b) => a.sourcePath.localeCompare(b.sourcePath) || a.line - b.line || a.kind.localeCompare(b.kind));
}

function parseOptions(argv) {
  const positional = [];
  const options = { root: process.cwd(), out: DEFAULT_OUT, json: false, limit: 10, mode: "hybrid", evalFile: "docs/repo-memory-eval.json" };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") options.json = true;
    else if (arg === "--root") options.root = argv[++i];
    else if (arg === "--out") options.out = argv[++i];
    else if (arg === "--limit") options.limit = Number(argv[++i]);
    else if (arg === "--mode") options.mode = argv[++i];
    else if (arg === "--eval-file") options.evalFile = argv[++i];
    else positional.push(arg);
  }
  return { positional, options };
}

async function loadRequiredIndex(options) {
  const outDir = path.resolve(options.root, options.out);
  const index = await readIndex(outDir);
  if (!index) throw new Error(`Index not found at ${path.join(outDir, INDEX_FILE)}; run index first.`);
  return index;
}

async function runEval(index, evalPath, mode = "hybrid") {
  const spec = JSON.parse(await fs.readFile(evalPath, "utf8"));
  const cases = (spec.cases ?? []).map((item) => {
    const results = searchIndex(index, item.question, 10, { mode });
    const paths = results.map((result) => result.path);
    const missingTop5 = (item.requiredTop5 ?? []).filter((required) => !paths.slice(0, 5).includes(required));
    const missingTop10 = (item.requiredTop10 ?? []).filter((required) => !paths.slice(0, 10).includes(required));
    return { id: item.id, passed: missingTop5.length === 0 && missingTop10.length === 0, missingTop5, missingTop10, paths };
  });
  let expectedAt5 = 0;
  let hitsAt5 = 0;
  let expectedAt10 = 0;
  let hitsAt10 = 0;
  let reciprocalRankTotal = 0;
  for (let index = 0; index < cases.length; index += 1) {
    const item = spec.cases[index];
    const paths = cases[index].paths;
    const top5 = item.requiredTop5 ?? [];
    const top10 = [...new Set([...top5, ...(item.requiredTop10 ?? [])])];
    expectedAt5 += top5.length;
    hitsAt5 += top5.filter((required) => paths.slice(0, 5).includes(required)).length;
    expectedAt10 += top10.length;
    hitsAt10 += top10.filter((required) => paths.slice(0, 10).includes(required)).length;
    const firstRank = Math.min(...top10.map((required) => {
      const rank = paths.indexOf(required);
      return rank < 0 ? Infinity : rank + 1;
    }));
    reciprocalRankTotal += Number.isFinite(firstRank) ? 1 / firstRank : 0;
  }
  return {
    passed: cases.filter((item) => item.passed).length,
    total: cases.length,
    metrics: {
      pathRecallAt5: expectedAt5 ? hitsAt5 / expectedAt5 : 1,
      pathRecallAt10: expectedAt10 ? hitsAt10 / expectedAt10 : 1,
      meanReciprocalRank: cases.length ? reciprocalRankTotal / cases.length : 1,
      hitsAt5,
      expectedAt5,
      hitsAt10,
      expectedAt10,
    },
    cases,
  };
}

export async function main(argv = process.argv.slice(2)) {
  const [command, ...rest] = argv;
  const { positional, options } = parseOptions(rest);
  if (command === "index") {
    const result = await buildIndex(options);
    console.log(options.json ? JSON.stringify(result.stats) : `Indexed ${result.stats.files} files, ${result.stats.chunks} chunks (${result.stats.reused} reused, ${result.stats.parsed} parsed).`);
    return result;
  }
  if (command === "ask") {
    const query = positional.join(" ").trim();
    if (!query) throw new Error("ask requires a query");
    if (!["hybrid", "lexical"].includes(options.mode)) throw new Error("--mode must be hybrid or lexical");
    const results = searchIndex(await loadRequiredIndex(options), query, options.limit, { mode: options.mode });
    if (options.json) console.log(JSON.stringify({ query, results }, null, 2));
    else for (const result of results) console.log(`${result.score.toFixed(2)}  ${result.citation}  ${result.qualifiedName ?? result.kind}\n${result.snippet}\n`);
    return results;
  }
  if (command === "graph") {
    const edges = graphIndex(await loadRequiredIndex(options), positional.join(" "));
    if (options.json) console.log(JSON.stringify({ edges }, null, 2));
    else for (const edge of edges) {
      const source = edge.sourceSymbol ? `${edge.sourcePath}#${edge.sourceSymbol}` : edge.sourcePath;
      const resolved = edge.resolvedTargetPath
        ? ` => ${edge.resolvedTargetPath}${edge.resolvedTargetSymbol ? `#${edge.resolvedTargetSymbol}` : ""} (${edge.confidence})`
        : "";
      console.log(`${source}:${edge.line} ${edge.kind} -> ${edge.rawTarget}${resolved}`);
    }
    return edges;
  }
  if (command === "eval") {
    const index = await loadRequiredIndex(options);
    if (!["hybrid", "lexical"].includes(options.mode)) throw new Error("--mode must be hybrid or lexical");
    const result = await runEval(index, path.resolve(options.root, options.evalFile), options.mode);
    const metrics = result.metrics;
    console.log(options.json ? JSON.stringify(result, null, 2) : `${result.passed}/${result.total} strict evaluation cases passed. Path recall@5 ${(metrics.pathRecallAt5 * 100).toFixed(1)}% (${metrics.hitsAt5}/${metrics.expectedAt5}); recall@10 ${(metrics.pathRecallAt10 * 100).toFixed(1)}% (${metrics.hitsAt10}/${metrics.expectedAt10}); MRR ${metrics.meanReciprocalRank.toFixed(3)}.\n${result.cases.filter((item) => !item.passed).map((item) => `${item.id}: missing top5 [${item.missingTop5.join(", ")}], top10 [${item.missingTop10.join(", ")}]`).join("\n")}`);
    return result;
  }
  throw new Error("Usage: repo-memory.mjs <index|ask|graph|eval> [options]");
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
