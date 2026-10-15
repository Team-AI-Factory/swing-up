import assert from "node:assert/strict";
import { writeFileSync, unlinkSync } from "node:fs";
import { loadTsModule, compiledTextCacheStatsForTest } from "./helpers/load-typescript-module.mjs";

const name = `scripts/helpers/.loader-fixture-${process.pid}`;
const file = new URL(`../${name}.ts`, import.meta.url);
const specifier = `@/${name}`;
const original = `import { value } from "@/fixture-input"; let count = 0; export const dependency = value; export const next = () => ++count; export const object = { changed: false };`;
writeFileSync(file, original, { flag: "wx" });
try {
  const before = compiledTextCacheStatsForTest();
  const first = loadTsModule(specifier, { "@/fixture-input": { value: "first" } });
  assert.equal(first.next(), 1); assert.equal(first.next(), 2); first.object.changed = true;
  const second = loadTsModule(specifier, { "@/fixture-input": { value: "second" } });
  assert.equal(second.next(), 1, "Compiled-text reuse must not reuse mutable module state");
  assert.equal(second.object.changed, false); assert.notEqual(first.object, second.object);
  assert.equal(first.dependency, "first"); assert.equal(second.dependency, "second", "Fresh override closure per harness");
  const reused = compiledTextCacheStatsForTest();
  assert.equal(reused.misses, before.misses + 1); assert.equal(reused.hits, before.hits + 1);

  writeFileSync(file, original.replace("count = 0", "count = 10"));
  assert.equal(loadTsModule(specifier, { "@/fixture-input": { value: "changed" } }).next(), 11, "Same-path changed source invalidates cached compilation");
  assert.equal(compiledTextCacheStatsForTest().misses, reused.misses + 1);
  writeFileSync(file, original);
  assert.equal(loadTsModule(specifier, { "@/fixture-input": { value: "restored" } }).next(), 1, "Restored code still gets fresh state");
  assert.equal(compiledTextCacheStatsForTest().hits, reused.hits + 1);

  const override = { ready: "direct" };
  assert.equal(loadTsModule(specifier, { [specifier]: override }), override, "Direct module substitution retains its exact semantics");
  assert.throws(() => loadTsModule(specifier), /ENOENT/, "Missing dependencies still throw; a prior override is not retained");
  writeFileSync(file, "export const broken = ;");
  assert.throws(() => loadTsModule(specifier), SyntaxError);
  assert.throws(() => loadTsModule(specifier), SyntaxError, "Cached output must not suppress execution syntax failures");
  writeFileSync(file, original);
  assert.equal(loadTsModule(specifier, { "@/fixture-input": { value: "repaired" } }).next(), 1);
  for (let i = 0; i <= reused.maxEntries; i++) {
    writeFileSync(file, `export const unique = ${i};`);
    assert.equal(loadTsModule(specifier).unique, i);
  }
  assert.equal(compiledTextCacheStatsForTest().entries, reused.maxEntries, "Compilation cache remains bounded");
  writeFileSync(file, original);
  assert.equal(loadTsModule(specifier, { "@/fixture-input": { value: "after-eviction" } }).next(), 1);
  console.log(JSON.stringify({ result: "PASS", sourceInvalidation: true, freshModuleState: true, perHarnessOverrides: true,
    directOverrides: true, errorsPreserved: true, boundedCache: true, stats: compiledTextCacheStatsForTest() }));
} finally { unlinkSync(file); }
