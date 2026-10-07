import { spawnSync } from "node:child_process";
const checks = [
  "company-profile-storage-retry-isolated.mjs",
  "pr262-storage-namespace",
  "company-profile-contention",
  "serious-signal-cross-cohort",
  "pr262-sec-submissions-schema",
  "simple-alert-registry-finalization", "serious-signal-evidence-binding",
  "r2-prefix-list",
  "terminal-review-journal", "terminal-review-runner", "terminal-review-event-job", "terminal-review-legacy-overwrite", "research-alert-read-dedupe",
  "committee-usage-retention", "review-evidence-revision-diagnostics",
  "pilot-review-evidence-snapshot", "company-profile-advertising-fees",
  "company-profile-sales-grammar", "company-profile-write-reduction",
  "company-profile-complete-source-codec", "company-profile-complete-source-identity",
  "company-profile-complete-source-cache", "company-profile-operating-quality",
  "simple-alert-source-storage-deadline",
  "company-profile-r2-integration",
  "company-profile-storage-provenance",
  "r2-state-write-recovery", "simple-alert-profile-deferral-labels", "ai-committee-prompt-budget", "evidence-model-upgrade",
  "simple-alert-issuer-coverage",
  "company-profile-cache-invalidation",
  "company-profile-storage-retry", "r2-state-abort-signal",
  "simple-alert-profile-storage-reporting", "simple-alert-profile-finalization", "simple-alert-profile-persistence-r2", "r2-state-error-provenance",
  "ai-committee-financial-facts-prompt",
  "financial-debt-period-completeness",
  "company-profile-financial-note-source", "company-profile-financial-note-cache",
  "company-profile-revenue-note-source", "company-profile-revenue-note-cache",
  "company-profile-sec-name",
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
  "ai-committee-evidence-text-references", "ai-committee-embedded-evidence-text", "ai-committee-crypto-policy",
  "pr262-processing-reliability", "simple-alert-cycle-summary",
  "pr262-backlog-readiness",
  "pr262-profile-recovery-capacity",
  "reliable-alert-recovery", "ai-committee-failure-diagnostics", "ai-committee-provider-guardrails",
  "pr262-ai-daily-cost-fuse", "pr262-event-job", "pr262-committee-authority", "pr262-serious-watch-out-authority",
  "valuation-review-materiality", "valuation-review-admission", "valuation-committee-followup",
  "serious-signal-delivery", "equity-event-first-runner", "equity-event-sources", "equity-sec-filing-details",
  "pr262-evidence-quality", "company-profile", "signal-presentation", "inclusive-committee-quality",
  "pr262-analysis-only-orchestrator", "pr262-production-foundation", "us-serious-signal-consistency",
];
for (const check of checks) {
  const filename = check.endsWith(".mjs") ? check : `${check}-smoke.mjs`;
  const result = spawnSync(process.execPath, [`scripts/${filename}`], { encoding: "utf8", timeout: 60000 });
  if (result.status !== 0) {
    console.error(`FAIL ${check}\n${result.stdout.slice(-3000)}\n${result.stderr.slice(-5000)}`);
    process.exit(1);
  }
  console.log(`PASS ${check}`);
}
console.log(`${checks.length} reliability regression suites passed; no paid model calls or external alerts.`);
