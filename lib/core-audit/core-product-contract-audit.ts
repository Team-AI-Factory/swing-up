import fs from "node:fs";
import path from "node:path";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { AI_COMMITTEE_AGENTS } from "@/lib/ai-committee/agents";
import { getAiCommitteeProviderStatus } from "@/lib/ai-committee/provider";

const ROOT = process.cwd();

type Severity = "critical" | "important" | "optional";
type AuditItem = { key: string; label: string; severity: Severity; ok: boolean; detail: string; paths?: string[] };

function exists(relativePath: string) {
  return fs.existsSync(path.join(ROOT, relativePath));
}

function fileIncludes(relativePath: string, needles: string[]) {
  if (!exists(relativePath)) return false;
  const content = fs.readFileSync(path.join(ROOT, relativePath), "utf8");
  return needles.every((needle) => content.includes(needle));
}

async function tableReachable<T>(fn: () => Promise<T>) {
  if (!process.env.DATABASE_URL) return { ok: false, detail: "DATABASE_URL is not configured." };
  try {
    await fn();
    return { ok: true, detail: "Database table/query is reachable." };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError) return { ok: false, detail: `Prisma error ${error.code}; table/query may be missing.` };
    return { ok: false, detail: "Database query failed without exposing connection details." };
  }
}

function secretStatus(name: string) {
  const configured = Boolean(process.env[name]);
  return { name, configured, status: configured ? "configured" : "missing" };
}

export async function buildCoreProductContractAudit() {
  const db = await tableReachable(() => prisma.$queryRaw`select 1`);
  const rawSignals = await tableReachable(() => prisma.rawSignal.count({ take: 1 }));
  const sourceHealth = await tableReachable(() => prisma.sourceHealth.count({ take: 1 }));
  const sourceRuns = await tableReachable(() => prisma.sourceRun.count({ take: 1 }));
  const historicalEvents = await tableReachable(() => prisma.historicalEvent.count({ take: 1 }));
  const patternMatches = await tableReachable(() => prisma.patternMatch.count({ take: 1 }));
  const scoring = await tableReachable(() => prisma.alertScore.count({ take: 1 }));
  const aiRuns = await tableReachable(() => prisma.aiCommitteeRun.count({ take: 1 }));

  const earFiles = ["lib/ears/sec-edgar.ts", "lib/ears/polygon.ts", "lib/ears/fmp.ts", "lib/ears/alpha-vantage.ts", "lib/ears/marketaux.ts", "lib/ears/gdelt.ts"];
  const sourceEarCount = earFiles.filter(exists).length;
  const requiredAgentIds = AI_COMMITTEE_AGENTS.filter((agent) => agent.required).map((agent) => agent.id);
  const providerStatus = getAiCommitteeProviderStatus();

  const items: AuditItem[] = [
    { key: "app_shell_routes", label: "App shell routes", severity: "critical", ok: exists("app/page.tsx") && exists("app/layout.tsx"), detail: "Root app page and layout files are present.", paths: ["app/page.tsx", "app/layout.tsx"] },
    { key: "database_connection", label: "Database connection", severity: "critical", ok: db.ok, detail: db.detail, paths: ["lib/db/client.ts", "prisma/schema.prisma"] },
    { key: "raw_signals", label: "raw_signals", severity: "critical", ok: rawSignals.ok && fileIncludes("prisma/schema.prisma", ["model RawSignal", "@@map(\"raw_signals\")"]), detail: rawSignals.detail, paths: ["prisma/schema.prisma"] },
    { key: "source_health", label: "source_health", severity: "critical", ok: sourceHealth.ok && fileIncludes("prisma/schema.prisma", ["model SourceHealth", "@@map(\"source_health\")"]), detail: sourceHealth.detail, paths: ["prisma/schema.prisma"] },
    { key: "source_runs", label: "source_runs", severity: "important", ok: sourceRuns.ok && fileIncludes("prisma/schema.prisma", ["model SourceRun", "@@map(\"source_runs\")"]), detail: sourceRuns.detail, paths: ["prisma/schema.prisma"] },
    { key: "source_ears", label: "Source ears", severity: "critical", ok: sourceEarCount >= 4, detail: `${sourceEarCount} source ear module(s) found.`, paths: earFiles },
    { key: "raw_signal_writer", label: "Raw signal writer", severity: "critical", ok: exists("lib/raw-signal-writer.ts") || fileIncludes("lib/raw-signals.ts", ["writeRawSignal"]), detail: "Raw signal writer module presence check.", paths: ["lib/raw-signal-writer.ts", "lib/raw-signals.ts"] },
    { key: "quality_gate", label: "Quality gate", severity: "critical", ok: exists("lib/raw-signal-quality-gate.ts"), detail: "Deterministic raw signal quality gate module present.", paths: ["lib/raw-signal-quality-gate.ts"] },
    { key: "historical_events", label: "historical_events", severity: "important", ok: historicalEvents.ok && fileIncludes("prisma/schema.prisma", ["model HistoricalEvent", "@@map(\"historical_events\")"]), detail: historicalEvents.detail, paths: ["prisma/schema.prisma"] },
    { key: "pattern_matches", label: "pattern_matches", severity: "important", ok: patternMatches.ok && fileIncludes("prisma/schema.prisma", ["model PatternMatch", "@@map(\"pattern_matches\")"]), detail: patternMatches.detail, paths: ["prisma/schema.prisma"] },
    { key: "scoring_persistence", label: "Scoring persistence", severity: "critical", ok: scoring.ok && exists("app/api/candidate-alerts/persist-analysis/route.ts"), detail: scoring.detail, paths: ["app/api/candidate-alerts/persist-analysis/route.ts", "prisma/schema.prisma"] },
    { key: "ai_committee_agents", label: "AI committee agents", severity: "critical", ok: requiredAgentIds.includes("compliance_agent") && requiredAgentIds.includes("risk_agent") && requiredAgentIds.includes("skeptic_agent") && requiredAgentIds.includes("explainer_agent"), detail: `Required agents configured: ${requiredAgentIds.join(", ")}.`, paths: ["lib/ai-committee/agents.ts"] },
    { key: "evidence_pack", label: "Evidence pack", severity: "critical", ok: exists("lib/ai-committee/evidence-pack.ts") && exists("app/api/ai-committee/evidence-pack-preview/route.ts"), detail: "Evidence pack builder and preview route present.", paths: ["lib/ai-committee/evidence-pack.ts", "app/api/ai-committee/evidence-pack-preview/route.ts"] },
    { key: "ai_committee_orchestrator", label: "AI committee orchestrator", severity: "critical", ok: exists("lib/ai-committee/orchestrator.ts") && exists("app/api/ai-committee/run/route.ts"), detail: "Committee run route and orchestrator present.", paths: ["lib/ai-committee/orchestrator.ts", "app/api/ai-committee/run/route.ts"] },
    { key: "ai_committee_run_logs", label: "AI committee run logs", severity: "important", ok: aiRuns.ok && exists("lib/ai-committee/run-persistence.ts") && exists("app/api/ai-committee/runs/route.ts"), detail: aiRuns.detail, paths: ["lib/ai-committee/run-persistence.ts", "app/api/ai-committee/runs/route.ts"] },
    { key: "final_judge", label: "Final judge", severity: "critical", ok: exists("app/api/ai-committee/final-judge/route.ts") && exists("lib/ai-committee/final-judge.ts"), detail: "Final judge route and shared judge logic present.", paths: ["app/api/ai-committee/final-judge/route.ts", "lib/ai-committee/final-judge.ts"] },
    { key: "candidate_state_machine", label: "Candidate alert state machine", severity: "critical", ok: exists("app/api/candidate-alerts/state-transition/route.ts"), detail: "Candidate alert transition route present.", paths: ["app/api/candidate-alerts/state-transition/route.ts"] },
    { key: "approval_gate", label: "Approval/publish gate", severity: "critical", ok: exists("app/api/internal/publish-approved-alert/route.ts"), detail: "Separate approved-alert publish gate present.", paths: ["app/api/internal/publish-approved-alert/route.ts"] },
    { key: "public_alert_seo_pages", label: "Public alert SEO pages", severity: "important", ok: exists("app/alerts/[id]/page.tsx") || exists("app/alerts/[slug]/page.tsx"), detail: "Public alert detail page presence check.", paths: ["app/alerts/[id]/page.tsx"] },
    { key: "public_ledger", label: "Public ledger", severity: "important", ok: exists("app/ledger/page.tsx") && exists("lib/public-ledger.ts"), detail: "Public ledger page/data module present.", paths: ["app/ledger/page.tsx", "lib/public-ledger.ts"] },
    { key: "ledger_outcome_scheduler", label: "Ledger outcome scheduler", severity: "optional", ok: exists("app/api/internal/ledger-outcome-scheduler/route.ts") || exists("lib/ledger-outcome-scheduler.ts"), detail: "Optional scheduler check; missing is reported as important next-build only if required by deployment.", paths: ["app/api/internal/ledger-outcome-scheduler/route.ts", "lib/ledger-outcome-scheduler.ts"] },
    { key: "telegram_test_sender", label: "Telegram test sender", severity: "optional", ok: exists("app/api/internal/full-e2e-telegram-test/route.ts"), detail: "Telegram test route presence check without sending messages.", paths: ["app/api/internal/full-e2e-telegram-test/route.ts"] },
    { key: "full_e2e_test_runner", label: "Full E2E test runner", severity: "important", ok: exists("app/api/internal/full-e2e-telegram-test/route.ts") || exists("app/api/internal/e2e-alert-test/route.ts"), detail: "Internal E2E runner presence check; audit does not execute it.", paths: ["app/api/internal/full-e2e-telegram-test/route.ts", "app/api/internal/e2e-alert-test/route.ts"] },
    { key: "safe_wording_compliance", label: "Safe wording/compliance", severity: "critical", ok: exists("app/safe-wording/page.tsx") && fileIncludes("lib/ai-committee/agents.ts", ["Compliance Agent"]), detail: "Compliance agent and safe-wording reference page present.", paths: ["app/safe-wording/page.tsx", "lib/ai-committee/agents.ts"] },
    { key: "api_key_status", label: "API key status without exposing secrets", severity: "important", ok: true, detail: "Only boolean/configured statuses are returned; secret values are never included." },
  ];

  const missingCriticalItems = items.filter((item) => item.severity === "critical" && !item.ok).map((item) => ({ key: item.key, label: item.label, detail: item.detail, paths: item.paths ?? [] }));
  const missingImportantItems = items.filter((item) => item.severity !== "critical" && !item.ok).map((item) => ({ key: item.key, label: item.label, severity: item.severity, detail: item.detail, paths: item.paths ?? [] }));
  const duplicateRiskItems = [
    ...(exists("app/api/ai-committee/final-judge/route.ts") && fileIncludes("lib/ai-committee/orchestrator.ts", ["final_judge"]) ? [{ key: "final_judge_overlap", detail: "The orchestrator plans/logs a final_judge agent and the new final judge route performs deterministic gate checks. Keep the route as the publishing gate of record to avoid duplicate approvals." }] : []),
    ...(exists("app/api/internal/publish-approved-alert/route.ts") && exists("app/api/candidate-alerts/state-transition/route.ts") ? [{ key: "approval_state_overlap", detail: "Approval state transitions and publish gate both exist; maintain separate responsibilities." }] : []),
  ];
  const completeCount = items.filter((item) => item.ok || item.severity === "optional").length;
  const coreCompletenessPercent = Math.round((completeCount / items.length) * 100);
  const readyForFullE2ETest = missingCriticalItems.length === 0 && missingImportantItems.filter((item) => item.severity === "important").length <= 2;
  const readyForMilestone7 = missingCriticalItems.length === 0 && missingImportantItems.filter((item) => item.severity === "important").length === 0 && duplicateRiskItems.length === 0;
  const readyForTelegramTesting = missingCriticalItems.length === 0 && exists("app/api/internal/full-e2e-telegram-test/route.ts") && Boolean(process.env.TELEGRAM_BOT_TOKEN);

  const nextRequiredBuilds = [
    ...missingCriticalItems.map((item) => `Fix critical core item: ${item.label}.`),
    ...missingImportantItems.filter((item) => item.severity === "important").map((item) => `Complete important core item: ${item.label}.`),
    ...duplicateRiskItems.map((item) => `Resolve duplicate-risk note: ${item.key}.`),
  ];

  return {
    ok: missingCriticalItems.length === 0,
    coreCompletenessPercent,
    missingCriticalItems,
    missingImportantItems,
    duplicateRiskItems,
    nextRequiredBuilds,
    readyForFullE2ETest,
    readyForMilestone7,
    readyForTelegramTesting,
    auditItems: items,
    apiKeyStatus: {
      database: { configured: Boolean(process.env.DATABASE_URL), status: process.env.DATABASE_URL ? "configured" : "missing" },
      openai: { configured: providerStatus.configured, enabled: providerStatus.enabled },
      telegram: secretStatus("TELEGRAM_BOT_TOKEN"),
      fmp: secretStatus("FMP_API_KEY"),
      polygon: secretStatus("POLYGON_API_KEY"),
      alphaVantage: secretStatus("ALPHA_VANTAGE_API_KEY"),
      marketaux: secretStatus("MARKETAUX_API_KEY"),
    },
    compatibility: { mutatesData: false, callsPaidApis: false, exposesSecrets: false },
  };
}
