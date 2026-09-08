import fs from "node:fs";
import path from "node:path";
import { parse } from "@babel/parser";

const root = process.cwd();
const sourceRoot = path.join(root, "src");
const rustSourceRoot = path.join(root, "src-tauri", "src");
const japanese = /[\u3041-\u30ff\u3400-\u9fff]/;
const exact = new Set();
const patterns = new Set();

function walkFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      // Generated locale catalogs are outputs, not Japanese source strings. Reading
      // them here makes every regeneration recursively ingest prior translations.
      if (path.resolve(fullPath) === path.resolve(sourceRoot, "lib", "translations")) return [];
      return walkFiles(fullPath);
    }
    // *Locale.ts modules already contain complete hand-reviewed catalogs for
    // every supported language. Treating their Chinese/Korean values as
    // Japanese source text makes the generated document catalog recursively
    // translate translations and eventually fail its residual-Japanese gate.
    if (!/\.tsx?$/.test(entry.name) || /\.test\.tsx?$/.test(entry.name) || /Locale\.tsx?$/.test(entry.name) || ["i18n.tsx", "documentTranslation.ts", "generatedTranslations.ts"].includes(entry.name)) return [];
    return [fullPath];
  });
}

function clean(value) {
  return value.replace(/[ \t\r\f\v]+/g, " ").trim();
}

function addExact(raw) {
  const value = clean(raw);
  if (value && japanese.test(value)) exact.add(value);
}

function addPattern(node) {
  let value = node.quasis[0]?.value.cooked ?? node.quasis[0]?.value.raw ?? "";
  node.expressions.forEach((_, index) => {
    const quasi = node.quasis[index + 1];
    value += `[[VAR${index}]]${quasi?.value.cooked ?? quasi?.value.raw ?? ""}`;
  });
  value = clean(value);
  if (!japanese.test(value)) return;
  patterns.add(value);
  for (const part of value.split(/\[\[VAR\d+\]\]/)) {
    if (clean(part).length >= 2) addExact(part);
  }
}

function addPatternValue(raw) {
  let marker = 0;
  const openBrace = "\u0000OPEN_BRACE\u0000";
  const closeBrace = "\u0000CLOSE_BRACE\u0000";
  const protectedValue = raw.replaceAll("{{", openBrace).replaceAll("}}", closeBrace);
  const value = clean(protectedValue.replace(/\{[^{}\r\n]*\}/g, () => `[[VAR${marker++}]]`)
    .replaceAll(openBrace, "{").replaceAll(closeBrace, "}"));
  if (!japanese.test(value)) return;
  if (marker === 0) addExact(value);
  else {
    patterns.add(value);
    for (const part of value.split(/\[\[VAR\d+\]\]/)) {
      if (clean(part).length >= 2) addExact(part);
    }
  }
}

function walkRustFiles(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walkRustFiles(fullPath);
    return entry.name.endsWith(".rs") ? [fullPath] : [];
  });
}

function parseRustString(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return raw.slice(1, -1).replaceAll('\\"', '"').replaceAll("\\\\", "\\");
  }
}

for (const file of walkFiles(sourceRoot)) {
  const source = fs.readFileSync(file, "utf8");
  const sourceFile = parse(source, { sourceType: "module", plugins: ["typescript", ...(file.endsWith(".tsx") ? ["jsx"] : [])] });
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === "StringLiteral") addExact(node.value);
    else if (node.type === "TemplateLiteral") addPattern(node);
    else if (node.type === "JSXText") addExact(node.value);
    for (const [key, value] of Object.entries(node)) {
      if (["loc", "start", "end", "extra", "leadingComments", "trailingComments", "innerComments"].includes(key)) continue;
      if (Array.isArray(value)) value.forEach(visit);
      else visit(value);
    }
  }
  visit(sourceFile);
}

for (const file of walkRustFiles(rustSourceRoot)) {
  const source = fs.readFileSync(file, "utf8");
  const runtimeSource = source.split(/#\[cfg\(test\)\]\s*mod\s+tests/, 1)[0];
  for (const match of runtimeSource.matchAll(/"(?:\\.|[^"\\])*"/gs)) {
    const value = parseRustString(match[0]);
    if (!japanese.test(value) || value.includes("\uFFFD") || value.length > 500 || /[<>]/.test(value)) continue;
    addPatternValue(value);
  }
}

process.stdout.write(JSON.stringify({ exact: [...exact].sort(), patterns: [...patterns].sort() }));
