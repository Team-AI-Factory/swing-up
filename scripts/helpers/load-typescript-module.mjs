import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";
const nativeRequire = createRequire(import.meta.url);
/** Execute real TypeScript helpers with explicit I/O substitutes in smoke tests. */
export function loadTsModule(specifier, overrides = {}) {
  if (specifier in overrides) return overrides[specifier];
  if (!specifier.startsWith("@/")) return nativeRequire(specifier);
  const path = new URL(`../../${specifier.slice(2)}.ts`, import.meta.url);
  const source = readFileSync(path, "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
  const result = { exports: {} };
  new Function("require", "module", "exports", code)(name => loadTsModule(name, overrides), result, result.exports);
  return result.exports;
}
