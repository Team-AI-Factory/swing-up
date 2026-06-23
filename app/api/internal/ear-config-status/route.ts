import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { SOURCE_DEFINITIONS } from "@/lib/engine-start-readiness";
import { getSourceHealth } from "@/lib/source-health";
import { getR2Config } from "@/lib/r2-warehouse";
import { secretFingerprint, withRedactionMetadata } from "@/lib/redact-secrets";

export const dynamic = "force-dynamic";

type SourceRole = "discovery" | "proof" | "fundamentals" | "price_volume" | "filings" | "history" | "risk";

function roleFor(sourceName: string): SourceRole {
  if (/sec|filing/i.test(sourceName)) return "filings";
  if (/fmp|alpha|marketaux/i.test(sourceName)) return "discovery";
  if (/polygon|finra/i.test(sourceName)) return "price_volume";
  if (/fred|fx|coingecko|gdelt/i.test(sourceName)) return "risk";
  if (/wikidata|watchlist/i.test(sourceName)) return "proof";
  return "discovery";
}

function budgets(sourceName: string) {
  if (/alpha/i.test(sourceName)) return { rateLimitBudget: "tiny: max 3 fresh pulls per run", dailyCallBudget: "provider-plan-dependent; preserve free-tier budget" };
  if (/fmp|marketaux|polygon/i.test(sourceName)) return { rateLimitBudget: "tiny: max 3 fresh pulls per run", dailyCallBudget: "provider-plan-dependent" };
  return { rateLimitBudget: "bounded tiny health/source runs", dailyCallBudget: "public endpoint/provider dependent" };
}

async function lastRuns() {
  if (!process.env.DATABASE_URL) return new Map<string, { status: string; errors: unknown }>();
  const runs = await prisma.sourceRun.findMany({ orderBy: { finishedAt: "desc" }, take: 100 }).catch(() => []);
  const map = new Map<string, { status: string; errors: unknown }>();
  for (const run of runs) if (!map.has(run.source)) map.set(run.source, { status: run.status, errors: run.errors });
  return map;
}

export async function GET() {
  const [health, runs] = await Promise.all([getSourceHealth(), lastRuns()]);
  const bySource = new Map(health.sources.map((row) => [row.source, row]));
  const r2Configured = getR2Config().configured;
  const sources = SOURCE_DEFINITIONS.map((source) => {
    const required = source.apiKey ? [source.apiKey] : [];
    const missingEnvVars = required.filter((name) => !process.env[name]?.trim());
    const healthRow = bySource.get(source.name);
    const run = runs.get(source.name);
    const lastRunErrors = Array.isArray(run?.errors) ? run.errors.map(String) : [];
    const { rateLimitBudget, dailyCallBudget } = budgets(source.name);
    return {
      sourceName: source.name,
      provider: source.name,
      enabled: !source.disabledReason && missingEnvVars.length === 0,
      requiredEnvVarsPresent: missingEnvVars.length === 0,
      missingEnvVars,
      keyFingerprint: source.apiKey ? secretFingerprint(process.env[source.apiKey]) : null,
      rateLimitBudget,
      dailyCallBudget,
      callsUsedToday: null,
      cooldownUntil: null,
      sourceRole: roleFor(source.name),
      storageMode: r2Configured ? "r2_raw_storage" : "postgresql_summary_only",
      lastRunStatus: run?.status ?? healthRow?.status ?? "not_run",
      lastSafeError: lastRunErrors[0] ?? healthRow?.errorMessage ?? null,
      secretsRedacted: true,
    };
  });
  return NextResponse.json(withRedactionMetadata({ ok: true, sources, secretsRedacted: true }));
}
