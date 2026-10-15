import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import ts from "typescript";
const nativeRequire = createRequire(import.meta.url);
const compilerOptions = Object.freeze({ module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true });
const compilerIdentity = JSON.stringify({ version: ts.version, compilerOptions });
const compiledText = new Map();
const MAX_COMPILED_TEXT_ENTRIES = 128;
let cacheHits = 0, cacheMisses = 0;

// Cache text only. Every call still reads the actual source and executes a new
// module with that call's overrides; no exports or mutable module state survive.
function transpiledText(source) {
  const key = createHash("sha256").update(compilerIdentity).update("\0").update(source).digest("hex");
  if (compiledText.has(key)) { cacheHits++; return compiledText.get(key); }
  cacheMisses++;
  const code = ts.transpileModule(source, { compilerOptions }).outputText;
  if (compiledText.size >= MAX_COMPILED_TEXT_ENTRIES) compiledText.delete(compiledText.keys().next().value);
  compiledText.set(key, code);
  return code;
}
export function compiledTextCacheStatsForTest() {
  return { hits: cacheHits, misses: cacheMisses, entries: compiledText.size, maxEntries: MAX_COMPILED_TEXT_ENTRIES };
}
/** Execute real TypeScript helpers with explicit I/O substitutes in smoke tests. */
export function loadTsModule(specifier, overrides = {}) {
  if (specifier in overrides) return overrides[specifier];
  if (!specifier.startsWith("@/")) return nativeRequire(specifier);
  if (specifier.endsWith(".json")) return JSON.parse(readFileSync(new URL(`../../${specifier.slice(2)}`, import.meta.url), "utf8"));
  const path = new URL(`../../${specifier.slice(2)}.ts`, import.meta.url);
  const source = readFileSync(path, "utf8");
  const code = transpiledText(source);
  const result = { exports: {} };
  new Function("require", "module", "exports", code)(name => loadTsModule(name, overrides), result, result.exports);
  return result.exports;
}
