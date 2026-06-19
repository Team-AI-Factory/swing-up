#!/usr/bin/env node
import { readFileSync, existsSync } from "node:fs";
import { relative, resolve } from "node:path";

const repoRoot = resolve(import.meta.dirname, "..");

const labels = [
  "mock",
  "preview",
  "sample",
  "not a real alert",
  "sourceMode",
  "mock_fallback",
];

const targets = [
  { route: "/ledger", file: "app/ledger/page.tsx", expectation: "page" },
  { route: "/alert-examples", file: "app/alert-examples/page.tsx", expectation: "mock-only page" },
  { route: "/onboarding-preview", file: "app/onboarding-preview/page.tsx", expectation: "preview page" },
  { route: "/roadmap-preview", file: "app/roadmap-preview/page.tsx", expectation: "preview page" },
  { route: "/launch-readiness", file: "app/launch-readiness/page.tsx", expectation: "preview page" },
  { route: "/api/brain/score-preview?mock=true", file: "app/api/brain/score-preview/route.ts", expectation: "mock preview API" },
  { route: "/api/pattern-matches/preview?mock=true", file: "app/api/pattern-matches/preview/route.ts", expectation: "mock preview API" },
  { route: "/api/ai-committee/preview?mock=true", file: "app/api/ai-committee/preview/route.ts", expectation: "mock preview API" },
  { route: "/api/rule-filter/preview?mock=true", file: "app/api/rule-filter/preview/route.ts", expectation: "mock preview API" },
  { route: "/api/mini-ai-scan/preview?mock=true", file: "app/api/mini-ai-scan/preview/route.ts", expectation: "mock preview API" },
  { route: "/api/receipts/normalize-preview?mock=true", file: "app/api/receipts/normalize-preview/route.ts", expectation: "mock preview API" },
  { route: "/api/price-snapshots/preview?mock=true", file: "app/api/price-snapshots/preview/route.ts", expectation: "mock preview API" },
];

function findLabels(source) {
  const lower = source.toLowerCase();
  return labels.filter((label) => lower.includes(label.toLowerCase()));
}

function statusFor(target, foundLabels) {
  if (foundLabels.length === 0) {
    return { status: "FAIL", note: "No approved mock/preview/sample/source-mode label found." };
  }

  if (target.expectation.includes("mock") && !foundLabels.includes("mock")) {
    return { status: "WARN", note: "Preview label found, but no explicit mock label found." };
  }

  return { status: "PASS", note: "Contains approved mock/live disclosure language." };
}

const results = targets.map((target) => {
  const path = resolve(repoRoot, target.file);
  if (!existsSync(path)) {
    return { ...target, status: "FAIL", labels: [], note: "Target file is missing." };
  }

  const source = readFileSync(path, "utf8");
  const found = findLabels(source);
  const verdict = statusFor(target, found);
  return { ...target, labels: found, ...verdict };
});

console.log("Mock vs Live Label Audit");
console.log("========================");
console.log(`Repo: ${relative(process.cwd(), repoRoot) || "."}`);
console.log(`Approved labels: ${labels.join(", ")}`);
console.log("");

for (const result of results) {
  console.log(`[${result.status}] ${result.route}`);
  console.log(`  file: ${result.file}`);
  console.log(`  expected: ${result.expectation}`);
  console.log(`  labels: ${result.labels.length ? result.labels.join(", ") : "none"}`);
  console.log(`  note: ${result.note}`);
}

const counts = results.reduce((summary, result) => {
  summary[result.status] = (summary[result.status] ?? 0) + 1;
  return summary;
}, {});

console.log("");
console.log(`Summary: PASS ${counts.PASS ?? 0}, WARN ${counts.WARN ?? 0}, FAIL ${counts.FAIL ?? 0}`);

if ((counts.FAIL ?? 0) > 0) {
  process.exitCode = 1;
}
