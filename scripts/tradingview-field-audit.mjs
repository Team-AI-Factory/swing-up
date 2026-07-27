#!/usr/bin/env node

import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";

const baseUrl = (process.env.COMBINED_ENGINE_RAILWAY_URL || "https://swing-up-swing-up-pr-262.up.railway.app").replace(/\/+$/, "");
const expectedCommit = (process.env.EXPECTED_BRANCH_COMMIT || "").trim();
const token = (process.env.SWING_UP_AUTOMATION_TOKEN || "").trim();
const outputPath = process.env.TRADINGVIEW_FIELD_AUDIT_PATH || "artifacts/tradingview-field-audit.json";
const deadline = Date.now() + 15 * 60 * 1000;
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function request(path) {
  const headers = { accept: "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(`${baseUrl}${path}`, { headers, signal: AbortSignal.timeout(5 * 60 * 1000), redirect: "manual" });
  const raw = await response.text();
  let json;
  try { json = JSON.parse(raw); } catch { throw new Error(`Expected JSON; status=${response.status}; body=${raw.slice(0, 500)}`); }
  return { status: response.status, json };
}

let health = null;
let attempts = 0;
while (Date.now() < deadline) {
  attempts += 1;
  try {
    const result = await request("/api/internal/combined-opportunity-engine");
    const runtimeCommit = String(result.json?.runtime?.commitSha || "");
    const matches = !expectedCommit || runtimeCommit === expectedCommit || runtimeCommit.startsWith(expectedCommit.slice(0, 12));
    if (result.status === 200 && result.json?.ok && matches) { health = result.json; break; }
  } catch { /* Railway deployment may still be rolling */ }
  await sleep(10_000);
}
assert.ok(health, `Expected Railway commit was not available: ${expectedCommit}`);

const audit = await request("/api/internal/combined-opportunity-engine/tradingview-field-audit");
assert.equal(audit.status, 200);
assert.equal(audit.json?.ok, true);
assert.ok(Array.isArray(audit.json?.availableFields));
assert.ok(audit.json.availableFields.length >= 8, `Too few usable fundamental fields: ${audit.json.availableFields.length}`);
const report = { ...audit.json, expectedCommit: expectedCommit || null, runtimeCommit: health.runtime?.commitSha || null, deploymentAttempts: attempts };
await mkdir(outputPath.split("/").slice(0, -1).join("/") || ".", { recursive: true });
await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ok: true, runtimeCommit: report.runtimeCommit, availableFields: report.availableFields, unavailableFields: report.unavailableFields, reportPath: outputPath }, null, 2));
