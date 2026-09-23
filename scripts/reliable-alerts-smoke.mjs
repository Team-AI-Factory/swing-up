import { spawnSync } from "node:child_process";
const checks = [
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
