import { spawnSync } from "node:child_process";
const checks = [
  "company-profile-cohort-extracts",
  "pr262-direct-issuer-feed", "pr262-lightweight-sensor-v3-bootstrap",
  "equity-universe-fallback", "pr262-sensor-foundation",
  "ai-committee-model-policy", "company-profile-layout-cache",
  "pr262-pilot-watch-valuation", "company-profile-service-recipients",
  "pr262-pilot-directory-bootstrap",
  "simple-alert-small-ai-cohort", "company-profile-customer-types",
  "simple-alert-cohort-namespace", "exact-evidence-followup",
  "company-profile-source-layout", "company-profile-annual-source", "company-profile-40f-cache",
  "simple-alert-delivery-controls",
  "ai-committee-analyst-output",
  "simple-alert-profile-throughput", "simple-alert-profile-transport",
  "ai-committee-evidence-text-references", "ai-committee-crypto-policy",
  "pr262-processing-reliability", "simple-alert-cycle-summary",
  "pr262-backlog-readiness",
  "pr262-profile-recovery-capacity",
  "reliable-alert-recovery", "ai-committee-failure-diagnostics", "ai-committee-provider-guardrails",
  "pr262-ai-daily-cost-fuse", "pr262-event-job", "pr262-committee-authority", "pr262-serious-watch-out-authority",
  "serious-signal-delivery", "equity-event-first-runner", "equity-event-sources", "equity-sec-filing-details",
  "pr262-evidence-quality", "company-profile", "signal-presentation", "inclusive-committee-quality",
  "pr262-analysis-only-orchestrator", "pr262-production-foundation", "us-serious-signal-consistency",
];
for (const check of checks) {
  const result = spawnSync(process.execPath, [`scripts/${check}-smoke.mjs`], { encoding: "utf8", timeout: 60000 });
  if (result.status !== 0) {
    console.error(`FAIL ${check}\n${result.stdout.slice(-3000)}\n${result.stderr.slice(-5000)}`);
    process.exit(1);
  }
  console.log(`PASS ${check}`);
}
console.log(`${checks.length} reliability regression suites passed; no paid model calls or external alerts.`);
