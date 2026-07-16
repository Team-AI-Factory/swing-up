import fs from "node:fs/promises";
import path from "node:path";

const baseUrl = (process.env.SWING_UP_EVAL_BASE_URL || "http://127.0.0.1:3010").replace(/\/$/, "");
const outputDir = path.resolve(process.cwd(), "artifacts");

async function waitForHealth() {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(3000) });
      if (response.ok) return;
    } catch {
      // The local Next server may still be starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Swing Up did not become healthy at ${baseUrl}`);
}

await waitForHealth();
const response = await fetch(`${baseUrl}/api/internal/serious-signal-evaluation`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: "{}",
  signal: AbortSignal.timeout(15_000),
});
const report = await response.json();
await fs.mkdir(outputDir, { recursive: true });
await fs.writeFile(path.join(outputDir, "serious-signal-evaluation.json"), `${JSON.stringify(report, null, 2)}\n`);
const lines = [
  "# Swing Up Serious Signal Evaluation",
  "",
  `Result: ${report.passed ? "PASS" : "FAIL"}`,
  "",
  "## Checks",
  "",
  ...(report.checks || []).map((check) => `- ${check.passed ? "PASS" : "FAIL"}: ${check.key}`),
  "",
  "## Metrics",
  "",
  ...Object.entries(report.metrics || {}).map(([key, value]) => `- ${key}: ${String(value)}`),
  "",
  "The evaluation is branch-only and performs no publishing, notifications, database writes, OpenAI calls, merges, or main-branch writes.",
  "",
];
await fs.writeFile(path.join(outputDir, "serious-signal-evaluation.md"), lines.join("\n"));
if (!response.ok || !report.passed) {
  console.error(JSON.stringify(report, null, 2));
  process.exit(1);
}
console.log(JSON.stringify(report, null, 2));
