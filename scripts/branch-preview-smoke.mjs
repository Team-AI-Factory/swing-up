const baseUrl = (process.env.SWING_UP_BRANCH_TEST_URL || "").replace(/\/$/, "");
if (!baseUrl) process.exit(0);

async function check(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, { ...options, signal: AbortSignal.timeout(20_000) });
  const text = await response.text();
  if (!response.ok) throw new Error(`${path} failed with ${response.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

await check("/api/health");
const evaluation = await check("/api/internal/serious-signal-evaluation", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
if (!evaluation.passed) throw new Error(`Branch evaluation failed: ${(evaluation.failures || []).join(", ")}`);
const outcomeStatus = await check("/api/internal/live-outcome-evaluator");
if (!outcomeStatus.realPricesOnly || outcomeStatus.mockFallback !== false) throw new Error("Live outcome evaluator allows a non-live fallback");

if (process.env.SWING_UP_AUTOMATION_TOKEN) {
  const liveDryRun = await check("/api/internal/live-outcome-evaluator", {
    method: "POST",
    headers: { "content-type": "application/json", "x-swing-up-automation-token": process.env.SWING_UP_AUTOMATION_TOKEN },
    body: JSON.stringify({ dryRun: true, limit: 5 }),
  });
  if (!liveDryRun.realPricesOnly) throw new Error("Live outcome dry-run did not enforce real prices");
}

console.log(JSON.stringify({ ok: true, baseUrl, evaluation: evaluation.metrics, outcomeStatus }, null, 2));
