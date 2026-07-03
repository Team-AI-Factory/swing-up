/* eslint-disable @typescript-eslint/no-explicit-any */
import crypto from "node:crypto";
import { prisma } from "@/lib/db/client";
import { getR2OperationalStatus, saveJsonToR2 } from "@/lib/r2-warehouse";
import { redactSecrets } from "@/lib/redact-secrets";

export type AccessStatus =
  | "available"
  | "missing_key"
  | "plan_restricted"
  | "rate_limited"
  | "endpoint_needs_verification"
  | "provider_error"
  | "disabled_by_policy"
  | "disabled_placeholder";
type Cadence =
  | "real_time"
  | "near_real_time"
  | "scheduled_event"
  | "filing_event"
  | "daily"
  | "weekly"
  | "monthly"
  | "quarterly"
  | "annual"
  | "on_demand_only"
  | "one_time_until_changed";
type Entry = {
  provider: string;
  source_id: string;
  display_name: string;
  endpoint_group: string;
  endpoint_name: string;
  endpoint_path: string;
  requires_api_key: boolean;
  api_key_env_name: string | null;
  access_status: AccessStatus;
  safe_error_category?: string | null;
  safe_error_message?: string | null;
  plan_required?: string | null;
  plan_detected?: string | null;
  data_type: string;
  proof_types_produced: string[];
  pull_mode: string;
  symbol_supported: boolean;
  keyword_supported: boolean;
  date_range_supported: boolean;
  bulk_supported: boolean;
  historical_supported: boolean;
  real_time_supported: boolean;
  recommended_interval_seconds: number;
  priority: number;
  cost_level: string;
  max_items_per_run: number;
  max_calls_per_run: number;
  raw_storage_path_template: string;
  enabled_by_default: boolean;
  update_cadence_type: Cadence;
  update_detection_method: string;
  natural_update_frequency: string;
  should_pull_again_after_success: boolean;
  next_pull_reason: string;
  cooldown_after_success_seconds: number;
  cooldown_after_empty_seconds: number;
  cooldown_after_rate_limit_seconds: number;
};
const memoryState = globalThis as typeof globalThis & {
  __sourceCoverageRows?: any[];
  __sourceFreshness?: Record<string, any>;
};
const hasDb = () => Boolean(process.env.DATABASE_URL?.trim());
const DAY = () => new Date().toISOString().slice(0, 10);
const now = () => new Date().toISOString();
const hash = (x: unknown) =>
  crypto.createHash("sha256").update(JSON.stringify(x)).digest("hex");
function keyPresent(e: Entry) {
  return (
    !e.requires_api_key ||
    Boolean(e.api_key_env_name && process.env[e.api_key_env_name]?.trim())
  );
}
function base(
  p: string,
  group: string,
  name: string,
  path: string,
  data: string,
  proof: string[],
  mode: string,
  overrides: Partial<Entry> = {},
): Entry {
  const api =
    p === "FMP"
      ? "FMP_API_KEY"
      : p === "Marketaux"
        ? "MARKETAUX_API_KEY"
        : p === "Benzinga"
          ? "BENZINGA_API_KEY"
          : p === "SAM"
            ? "SAM_API_KEY"
            : null;
  const disabled = mode === "disabled_placeholder";
  return {
    provider: p,
    source_id: `${p.toLowerCase()}_${name.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
    display_name: `${p} ${name}`,
    endpoint_group: group,
    endpoint_name: name,
    endpoint_path: path,
    requires_api_key: Boolean(api),
    api_key_env_name: api,
    access_status: disabled
      ? "disabled_placeholder"
      : "endpoint_needs_verification",
    data_type: data,
    proof_types_produced: proof,
    pull_mode: mode,
    symbol_supported:
      /symbol|ticker|company|quote|profile|peer|filing|transcript|earnings|rating|target|guidance|insider|13f|holdings/i.test(
        name,
      ),
    keyword_supported:
      /news|keyword|search|register|fda|fed|spending|opportunities|lawsuit/i.test(
        name,
      ),
    date_range_supported: true,
    bulk_supported: /list|bulk|directory|calendar|all|zip|feed/i.test(name),
    historical_supported:
      /historical|statement|ratios|metrics|13f|bulk|facts|concept/i.test(name),
    real_time_supported:
      /quote|news|live|squawk|moving|fed|sec submissions/i.test(name),
    recommended_interval_seconds: 900,
    priority: 50,
    cost_level: api ? "medium" : "low",
    max_items_per_run: 5,
    max_calls_per_run: 1,
    raw_storage_path_template: `raw/${p.toLowerCase()}/${group.toLowerCase().replace(/[^a-z0-9]+/g, "-")}/{date}/{endpoint}.json`,
    enabled_by_default: !disabled,
    update_cadence_type: "daily",
    update_detection_method: "latest_timestamp",
    natural_update_frequency: "daily or event-driven",
    should_pull_again_after_success: true,
    next_pull_reason: "due_by_cadence_or_active_proof_need",
    cooldown_after_success_seconds: 900,
    cooldown_after_empty_seconds: 1800,
    cooldown_after_rate_limit_seconds: 3600,
    ...overrides,
  };
}
export function coverageDefaults(): Entry[] {
  const a: Entry[] = [];
  const add = (...x: Entry[]) => a.push(...x);
  [
    "search and directories",
    "stock list",
    "financial statement symbol list",
    "CIK list",
    "available exchanges sectors industries countries",
    "company profile",
    "peers",
    "market cap",
    "shares float",
    "quote",
    "quote short",
    "stock price change",
    "historical prices",
    "intraday prices",
    "financial statements",
    "key metrics",
    "ratios",
    "growth metrics",
    "analyst estimates",
    "price targets",
    "earnings calendar",
    "earnings report",
    "earnings transcripts list",
    "earnings transcript latest",
    "transcript dates by symbol",
    "transcript by symbol year quarter",
    "stock news",
    "press releases",
    "SEC filings",
    "insider trades",
    "congressional senate trades",
    "Form 13F",
    "ETF and mutual fund holdings",
    "crypto",
    "forex",
    "commodities",
    "economic data",
    "technical indicators",
    "market performance",
    "mergers and acquisitions",
    "dividends splits IPOs",
    "ESG",
  ].forEach((n) =>
    add(
      base(
        "FMP",
        /quote|price|market cap|float|technical/.test(n)
          ? "market proof"
          : /statement|metrics|ratios|growth|profile|peers|ESG/.test(n)
            ? "fundamentals"
            : "discovery",
        n,
        `/stable/${n.replaceAll(" ", "-")}`,
        "market_data",
        ["market_or_fundamental_proof"],
        /news|press/.test(n)
          ? "broad_latest"
          : /transcript|earnings/.test(n)
            ? "event_window"
            : "ticker_specific",
        {
          recommended_interval_seconds: /quote|intraday/.test(n)
            ? 120
            : /statement|metrics|ratios/.test(n)
              ? 604800
              : 900,
          update_cadence_type: /quote|intraday|news/.test(n)
            ? "near_real_time"
            : /transcript|earnings/.test(n)
              ? "scheduled_event"
              : /13F/.test(n)
                ? "quarterly"
                : "daily",
          cooldown_after_success_seconds: /statement|metrics|ratios/.test(n)
            ? 604800
            : 900,
        },
      ),
    ),
  );
  [
    "news all by symbols",
    "news all by keywords",
    "news all by country language source",
    "similar news by UUID",
    "entity stats intraday",
    "entity stats daily weekly monthly",
    "entity metadata",
    "sentiment filters",
    "min match score filters",
    "must_have_entities",
    "filter_entities",
  ].forEach((n) =>
    add(
      base(
        "Marketaux",
        "news intelligence",
        n,
        "/v1/news/all",
        "news",
        ["fresh_news_receipt"],
        /keyword|filter|sentiment|min match/.test(n)
          ? "keyword_specific"
          : "ticker_specific",
        {
          recommended_interval_seconds: /symbols/.test(n) ? 60 : 240,
          update_cadence_type: "near_real_time",
          update_detection_method: "latest_id",
          natural_update_frequency: "minutes",
        },
      ),
    ),
  );
  [
    "stock market news",
    "live conference call transcripts",
    "conference call calendar",
    "Why Is It Moving",
    "streaming audio news Squawk",
    "corporate guidance",
    "FDA calendar",
    "analyst ratings",
    "price targets",
    "SEC filings",
    "government trades",
    "insider trades",
    "unusual options",
    "market movers",
    "economic calendar",
    "events calendar",
    "press releases",
    "future earnings",
    "IPOs",
    "dividends",
    "M&A deals",
    "fundamentals",
  ].forEach((n) =>
    add(
      base(
        "Benzinga",
        "benzinga",
        n,
        `/api/v2/${n.replaceAll(" ", "-")}`,
        "news_or_market_data",
        ["benzinga_receipt"],
        /calendar|earnings|FDA|transcript/.test(n)
          ? "event_window"
          : "broad_latest",
        {
          recommended_interval_seconds: /Why|news|movers/.test(n)
            ? 60
            : /calendar/.test(n)
              ? 1800
              : 900,
          update_cadence_type: /live|Why|news/i.test(n)
            ? "near_real_time"
            : "scheduled_event",
          plan_required: /Squawk|fundamentals/.test(n)
            ? "paid_plan_may_be_required"
            : null,
        },
      ),
    ),
  );
  add(
    base(
      "SEC",
      "official filings",
      "SEC submissions API",
      "https://data.sec.gov/submissions/CIK##########.json",
      "filings",
      ["official_filing_proof"],
      "ticker_specific",
      {
        requires_api_key: false,
        api_key_env_name: null,
        recommended_interval_seconds: 60,
        update_cadence_type: "filing_event",
        update_detection_method: "accession_number",
        natural_update_frequency: "urgent filing events",
      },
    ),
    base(
      "SEC",
      "official filings",
      "SEC company facts API",
      "https://data.sec.gov/api/xbrl/companyfacts/CIK##########.json",
      "fundamentals",
      ["official_fundamentals_proof"],
      "proof_on_demand",
      {
        requires_api_key: false,
        api_key_env_name: null,
        recommended_interval_seconds: 604800,
        update_cadence_type: "filing_event",
        update_detection_method: "document_hash",
      },
    ),
    base(
      "SEC",
      "official filings",
      "SEC company concept API",
      "https://data.sec.gov/api/xbrl/companyconcept/...",
      "fundamentals",
      ["official_fundamentals_proof"],
      "proof_on_demand",
      { requires_api_key: false, api_key_env_name: null },
    ),
    base(
      "SEC",
      "official filings",
      "SEC bulk submissions nightly ZIP",
      "https://www.sec.gov/Archives/edgar/daily-index/",
      "bulk_filings",
      ["official_filing_proof"],
      "bulk_nightly",
      {
        requires_api_key: false,
        api_key_env_name: null,
        update_cadence_type: "daily",
      },
    ),
    base(
      "SEC",
      "official filings",
      "SEC bulk companyfacts nightly ZIP",
      "https://www.sec.gov/Archives/edgar/daily-index/xbrl/companyfacts.zip",
      "bulk_facts",
      ["official_fundamentals_proof"],
      "bulk_nightly",
      {
        requires_api_key: false,
        api_key_env_name: null,
        update_cadence_type: "daily",
      },
    ),
  );
  [
    ["Fed", "Federal Reserve feeds"],
    ["FederalRegister", "Federal Register search public inspection"],
    ["openFDA", "openFDA drug device food enforcement"],
    ["openFDA", "FDA official feeds placeholders"],
    ["BLS", "BLS release calendar placeholder"],
    ["BEA", "BEA release calendar placeholder"],
    ["Treasury", "Treasury releases placeholder"],
    ["DOJ_FTC", "DOJ FTC press enforcement placeholders"],
    ["USAspending", "USAspending awards search"],
    ["SAM", "SAM.gov opportunities"],
    ["CourtListener", "CourtListener placeholder"],
    ["Congress.gov", "Congress.gov placeholder"],
    ["GoogleNewsRSS", "Google News RSS"],
    ["GDELT", "GDELT"],
    ["AlphaVantage", "Alpha Vantage"],
    ["FRED", "FRED"],
    ["CoinGecko", "CoinGecko crypto"],
    ["FXMacro", "FX macro ears"],
    ["SocialFastChatter", "social fast chatter"],
  ].forEach(([p, n]) =>
    add(
      base(
        p,
        "free official and broad ears",
        n,
        "official_or_existing_repo_endpoint",
        "official_or_broad_data",
        ["official_or_context_receipt"],
        p === "SocialFastChatter" ? "disabled_placeholder" : "broad_latest",
        {
          requires_api_key: p === "SAM" || p === "AlphaVantage" || p === "FRED",
          api_key_env_name:
            p === "SAM"
              ? "SAM_API_KEY"
              : p === "AlphaVantage"
                ? "ALPHA_VANTAGE_API_KEY"
                : p === "FRED"
                  ? "FRED_API_KEY"
                  : null,
          access_status:
            p === "SocialFastChatter"
              ? "disabled_placeholder"
              : "endpoint_needs_verification",
          safe_error_category:
            p === "SocialFastChatter" ? "noisy_legal_quality_sensitive" : null,
          safe_error_message:
            p === "SocialFastChatter"
              ? "Disabled placeholder: noisy_legal_quality_sensitive"
              : null,
          recommended_interval_seconds: /Fed/.test(n)
            ? 180
            : /Register|openFDA/.test(n)
              ? 1800
              : 3600,
          update_cadence_type: /placeholder/.test(n)
            ? "on_demand_only"
            : /Fed/.test(n)
              ? "near_real_time"
              : "daily",
        },
      ),
    ),
  );
  return a;
}
export async function ensureStorage() {
  if (!hasDb()) {
    memoryState.__sourceCoverageRows ??= coverageDefaults().map((entry) => ({
      ...entry,
      proof_types_produced: entry.proof_types_produced,
      created_at: now(),
      updated_at: now(),
    }));
    memoryState.__sourceFreshness ??= {};
    return;
  }
  await prisma.$executeRawUnsafe(
    `create table if not exists source_coverage_matrix (id uuid primary key default gen_random_uuid(), provider text not null, source_id text not null unique, display_name text not null, endpoint_group text not null, endpoint_name text not null, endpoint_path text not null, requires_api_key boolean not null, api_key_env_name text, access_status text not null, last_tested_at timestamptz, last_success_at timestamptz, last_failure_at timestamptz, safe_error_category text, safe_error_message text, plan_required text, plan_detected text, data_type text not null, proof_types_produced jsonb not null default '[]', pull_mode text not null, symbol_supported boolean not null, keyword_supported boolean not null, date_range_supported boolean not null, bulk_supported boolean not null, historical_supported boolean not null, real_time_supported boolean not null, recommended_interval_seconds int not null, priority int not null, cost_level text not null, max_items_per_run int not null, max_calls_per_run int not null, raw_storage_path_template text not null, enabled_by_default boolean not null, update_cadence_type text, update_detection_method text, natural_update_frequency text, should_pull_again_after_success boolean, next_pull_reason text, last_seen_external_id text, last_seen_published_at timestamptz, last_seen_document_hash text, last_data_change_detected_at timestamptz, cooldown_after_success_seconds int, cooldown_after_empty_seconds int, cooldown_after_rate_limit_seconds int, created_at timestamptz not null default now(), updated_at timestamptz not null default now())`,
  );
  await prisma.$executeRawUnsafe(
    `create table if not exists source_pull_history (id uuid primary key default gen_random_uuid(), provider text not null, endpoint_name text not null, endpoint_path text not null, pull_mode text not null, symbols jsonb not null default '[]', keywords jsonb not null default '[]', started_at timestamptz, finished_at timestamptz, http_status int, items_returned int, raw_receipt_ref text, normalized_signals_created int default 0, proof_receipts_created int default 0, duplicates_skipped int default 0, calls_used int default 0, safe_error_category text, safe_error_message text, created_at timestamptz not null default now())`,
  );
  await prisma.$executeRawUnsafe(
    `create table if not exists source_freshness_ledger (id uuid primary key default gen_random_uuid(), provider text not null, endpoint_name text not null, symbol text, keyword text, event_type text, latest_external_id text, latest_published_at timestamptz, latest_document_hash text, latest_source_url text, latest_raw_storage_ref text, last_checked_at timestamptz, last_changed_at timestamptz, next_due_at timestamptz, update_cadence_type text, freshness_status text, created_at timestamptz not null default now(), updated_at timestamptz not null default now())`,
  );
  for (const e of coverageDefaults()) {
    await prisma.$executeRawUnsafe(
      `insert into source_coverage_matrix (${Object.keys(e).join(",")}) values (${Object.keys(
        e,
      )
        .map((_, i) => `$${i + 1}`)
        .join(
          ",",
        )}) on conflict (source_id) do update set updated_at=now(), endpoint_path=excluded.endpoint_path, proof_types_produced=excluded.proof_types_produced, recommended_interval_seconds=excluded.recommended_interval_seconds, update_cadence_type=excluded.update_cadence_type`,
      ...Object.values(e).map((v) =>
        Array.isArray(v) ? JSON.stringify(v) : v,
      ),
    );
  }
}
export async function rows() {
  await ensureStorage();
  if (!hasDb()) return [...(memoryState.__sourceCoverageRows ?? [])];
  return prisma.$queryRawUnsafe<any[]>(
    `select * from source_coverage_matrix order by provider, priority desc, endpoint_group, endpoint_name`,
  );
}
async function receipt(name: string, payload: unknown) {
  const r2 = await getR2OperationalStatus().catch(() => null);
  if (!r2?.writeAvailable) return null;
  const key = `raw/source-coverage/${DAY()}/${Date.now()}-${name}.json`;
  try {
    await saveJsonToR2(key, redactSecrets(payload), {
      source: "source-coverage",
      dataType: name,
    });
    return key;
  } catch {
    return null;
  }
}
export async function runCoverageTest(input: any) {
  const selected = new Set(
    (Array.isArray(input.providers) ? input.providers : []).map(String),
  );
  const all = (await rows()).filter(
    (r) => !selected.size || selected.has(r.provider),
  );
  const limited = Object.values(
    all.reduce((m: any, r: any) => {
      (m[r.provider] ??= []).push(r);
      return m;
    }, {}),
  ).flatMap((x: any) =>
    x.slice(
      0,
      Math.max(1, Math.min(Number(input.maxEndpointsPerProvider) || 30, 60)),
    ),
  );
  let r2c = 0;
  const diagnostics: Array<{
    provider: string;
    endpoint_name: string;
    access_status: AccessStatus;
    safe_error_category: string | null;
    safe_error_message: string | null;
    rawReceiptRef: string | null;
  }> = [];
  for (const r of limited as any[]) {
    let status: AccessStatus = r.access_status;
    let cat = null,
      msg = null,
      items = 0;
    const http: null | number = null;
    if (status === "disabled_placeholder" || status === "disabled_by_policy") {
      cat = r.safe_error_category || "disabled_placeholder";
      msg = r.safe_error_message || "Disabled placeholder";
    } else if (!keyPresent(r)) {
      status = "missing_key";
      cat = "missing_key";
      msg = `${r.api_key_env_name} is not configured`;
    } else {
      status = "available";
      items = 0;
      msg =
        "Dry-run access classified without fetching provider payload; use confirmRun=true for future tiny live checks.";
    }
    const ref = await receipt(`test-${r.source_id}`, {
      provider: r.provider,
      endpoint: r.endpoint_name,
      status,
      http,
      items,
      msg,
    });
    if (ref) r2c++;
    if (hasDb()) {
      await prisma.$executeRawUnsafe(
        `update source_coverage_matrix set access_status=$1,last_tested_at=now(),last_success_at=case when $1='available' then now() else last_success_at end,last_failure_at=case when $1<>'available' then now() else last_failure_at end,safe_error_category=$2,safe_error_message=$3,updated_at=now() where source_id=$4`,
        status,
        cat,
        msg,
        r.source_id,
      );
    } else {
      const row = memoryState.__sourceCoverageRows?.find(
        (item) => item.source_id === r.source_id,
      );
      if (row)
        Object.assign(row, {
          access_status: status,
          safe_error_category: cat,
          safe_error_message: msg,
          last_tested_at: now(),
          updated_at: now(),
        });
    }
    diagnostics.push({
      provider: r.provider,
      endpoint_name: r.endpoint_name,
      access_status: status,
      safe_error_category: cat,
      safe_error_message: msg,
      rawReceiptRef: ref,
    });
  }
  const counts = (s: AccessStatus) =>
    diagnostics.filter((d) => d.access_status === s).length;
  return {
    ok: true,
    providersTested: [...new Set(diagnostics.map((d) => d.provider))],
    endpointsTested: diagnostics.length,
    availableEndpoints: counts("available"),
    missingKeyEndpoints: counts("missing_key"),
    planRestrictedEndpoints: counts("plan_restricted"),
    rateLimitedEndpoints: counts("rate_limited"),
    providerErrorEndpoints: counts("provider_error"),
    disabledPlaceholders: counts("disabled_placeholder"),
    rawReceiptsStoredInR2: r2c,
    sourceCoverageSummary: summary(await rows()),
    endpointDiagnostics: diagnostics,
    nextBestApiUpgrade: diagnostics.some(
      (d) => d.access_status === "missing_key",
    )
      ? "Add missing API keys for highest-priority paid providers before expanding pull volume."
      : "Review any plan-restricted endpoints after tiny live checks.",
    noOpenAI: true,
    noPublish: true,
    noTelegram: true,
    secretsRedacted: true,
  };
}
export function summary(rs: any[]) {
  return {
    totalEndpoints: rs.length,
    available: rs.filter((r) => r.access_status === "available").length,
    missingKey: rs.filter((r) => r.access_status === "missing_key").length,
    planRestricted: rs.filter((r) => r.access_status === "plan_restricted")
      .length,
    disabledPlaceholders: rs.filter(
      (r) => r.access_status === "disabled_placeholder",
    ).length,
    providers: [...new Set(rs.map((r) => r.provider))],
  };
}
export async function pullPlan() {
  const rs = await rows();
  const plan = rs.map((r: any) => {
    const enabled =
      r.enabled_by_default &&
      r.access_status !== "disabled_placeholder" &&
      r.access_status !== "missing_key" &&
      r.access_status !== "plan_restricted";
    return {
      provider: r.provider,
      endpoint_group: r.endpoint_group,
      endpoint_name: r.endpoint_name,
      access_status: r.access_status,
      data_type: r.data_type,
      proof_types_produced: r.proof_types_produced,
      pull_mode: r.pull_mode,
      recommended_interval_seconds: r.recommended_interval_seconds,
      priority: r.priority,
      cost_level: r.cost_level,
      daily_call_estimate: enabled
        ? Math.ceil(86400 / Math.max(r.recommended_interval_seconds, 60)) *
          Math.max(r.max_calls_per_run, 1)
        : 0,
      enabled_now: enabled,
      disabled_reason: enabled ? null : r.access_status,
      when_to_pull: r.next_pull_reason || "when due by cadence",
      why_it_matters: `Produces ${r.data_type} for ${r.proof_types_produced?.join?.(", ") || "source receipts"}.`,
      next_best_use: r.pull_mode,
      update_cadence_type: r.update_cadence_type,
      natural_update_frequency: r.natural_update_frequency,
    };
  });
  return {
    ok: true,
    sections: {
      fastRadarPulls: plan.filter((p) => p.pull_mode === "broad_latest"),
      officialProofPulls: plan.filter((p) =>
        /SEC|Fed|Federal|FDA|USAspending|SAM/.test(p.provider),
      ),
      marketProofPulls: plan.filter((p) =>
        /quote|price|market/i.test(p.endpoint_name),
      ),
      fundamentalsProofPulls: plan.filter((p) =>
        /statement|metrics|ratios|fundamentals|facts/i.test(p.endpoint_name),
      ),
      transcriptPulls: plan.filter((p) =>
        /transcript|conference call/i.test(p.endpoint_name),
      ),
      eventWindowPulls: plan.filter((p) => p.pull_mode === "event_window"),
      nightlyBulkPulls: plan.filter((p) => p.pull_mode === "bulk_nightly"),
      onDemandProofPulls: plan.filter((p) => p.pull_mode === "proof_on_demand"),
    },
    plan,
    callsAvoidedBecauseAlreadyCaptured: 0,
    callsAvoidedBecauseNotDueYet: 0,
    callsAvoidedBecauseNoEventWindow: 0,
    callsAvoidedDueToBudget: 0,
    callsUsedForFreshData: 0,
    duplicateDataAvoidedCount: 0,
    estimatedQuotaSaved: 0,
    nextDuePulls: plan.filter((p) => p.enabled_now).slice(0, 10),
    urgentPullsNow: plan
      .filter((p) => p.update_cadence_type === "filing_event" && p.enabled_now)
      .slice(0, 10),
    slowDataSkipped: plan
      .filter((p) =>
        /weekly|monthly|quarterly|annual|on_demand_only/.test(
          String(p.update_cadence_type),
        ),
      )
      .slice(0, 20),
    noOpenAI: true,
    noPublish: true,
    noTelegram: true,
  };
}
export async function smartPull(input: any) {
  const max = Number(input.maxCallsTotal) || 100;
  const rs = (await rows())
    .filter((r: any) => r.enabled_by_default)
    .sort(
      (a: any, b: any) =>
        Number(keyPresent(b)) - Number(keyPresent(a)) ||
        Number(b.priority ?? 0) - Number(a.priority ?? 0),
    )
    .slice(0, Number(input.maxEndpoints) || 50);
  let used = 0,
    already = 0,
    notdue = 0,
    noevent = 0,
    budget = 0,
    r2c = 0;
  const decisions = [];
  for (const r of rs as any[]) {
    let decision = "pull_now",
      reason = "due";
    if (!keyPresent(r)) {
      decision = "skip_missing_key";
      reason = "missing key";
    } else if (r.access_status === "plan_restricted")
      decision = "skip_plan_restricted";
    else if (r.access_status === "rate_limited")
      decision = "skip_rate_limit_backoff";
    else if (r.pull_mode === "disabled_placeholder")
      decision = "skip_low_priority";
    else if (used >= max) decision = "skip_budget_limit";
    else {
      const ledgerKey = `${r.provider}:${r.endpoint_name}`;
      const led = hasDb()
        ? await prisma.$queryRawUnsafe<any[]>(
            `select * from source_freshness_ledger where provider=$1 and endpoint_name=$2 and coalesce(symbol,'')=$3 and coalesce(keyword,'')=$4 order by updated_at desc limit 1`,
            r.provider,
            r.endpoint_name,
            "",
            "",
          )
        : memoryState.__sourceFreshness?.[ledgerKey]
          ? [memoryState.__sourceFreshness[ledgerKey]]
          : [];
      const due = led[0]?.next_due_at
        ? Date.parse(led[0].next_due_at) <= Date.now()
        : true;
      if (
        led[0]?.latest_document_hash &&
        /weekly|monthly|quarterly|annual|on_demand_only|one_time_until_changed/.test(
          String(r.update_cadence_type),
        )
      ) {
        decision = "skip_already_captured";
        already++;
      } else if (!due) {
        decision = "skip_not_due_yet";
        notdue++;
      } else if (
        r.pull_mode === "event_window" &&
        !/earnings|FDA|guidance|call|lawsuit|investigation|contract/i.test(
          [...(input.keywords || [])].join(" "),
        )
      ) {
        decision = "skip_waiting_for_event";
        noevent++;
      }
    }
    if (decision === "pull_now") {
      used += Math.max(1, r.max_calls_per_run || 1);
      const payload = {
        provider: r.provider,
        endpoint: r.endpoint_name,
        dryRun: input.dryRun !== false,
        checkedAt: now(),
        symbols: input.symbols || [],
        keywords: input.keywords || [],
      };
      const h = hash(payload);
      const ref = await receipt(`pull-${r.source_id}`, payload);
      if (ref) r2c++;
      if (hasDb()) {
        await prisma.$executeRawUnsafe(
          `insert into source_pull_history (provider,endpoint_name,endpoint_path,pull_mode,symbols,keywords,started_at,finished_at,http_status,items_returned,raw_receipt_ref,calls_used,created_at) values ($1,$2,$3,$4,$5::jsonb,$6::jsonb,now(),now(),200,0,$7,$8,now())`,
          r.provider,
          r.endpoint_name,
          r.endpoint_path,
          r.pull_mode,
          JSON.stringify(input.symbols || []),
          JSON.stringify(input.keywords || []),
          ref,
          Math.max(1, r.max_calls_per_run || 1),
        );
        await prisma.$executeRawUnsafe(
          `insert into source_freshness_ledger (provider,endpoint_name,latest_document_hash,latest_raw_storage_ref,last_checked_at,last_changed_at,next_due_at,update_cadence_type,freshness_status,created_at,updated_at) values ($1,$2,$3,$4,now(),now(),now()+($5||' seconds')::interval,$6,'changed_now',now(),now())`,
          r.provider,
          r.endpoint_name,
          h,
          ref,
          String(
            r.cooldown_after_success_seconds ||
              r.recommended_interval_seconds ||
              900,
          ),
          r.update_cadence_type,
        );
      } else {
        memoryState.__sourceFreshness ??= {};
        memoryState.__sourceFreshness[`${r.provider}:${r.endpoint_name}`] = {
          latest_document_hash: h,
          latest_raw_storage_ref: ref,
          last_checked_at: now(),
          last_changed_at: now(),
          next_due_at: new Date(
            Date.now() +
              1000 *
                Number(
                  r.cooldown_after_success_seconds ||
                    r.recommended_interval_seconds ||
                    900,
                ),
          ).toISOString(),
          update_cadence_type: r.update_cadence_type,
          freshness_status: "changed_now",
        };
      }
    } else if (decision === "skip_budget_limit") budget++;
    decisions.push({
      provider: r.provider,
      endpoint_name: r.endpoint_name,
      decision,
      reason,
      update_cadence_type: r.update_cadence_type,
    });
  }
  return {
    ok: true,
    dryRun: input.dryRun !== false,
    confirmRun: input.confirmRun === true,
    mode: input.mode || "balanced",
    decisions,
    callsUsedForFreshData: used,
    callsAvoidedBecauseAlreadyCaptured: already,
    callsAvoidedBecauseNotDueYet: notdue,
    callsAvoidedBecauseNoEventWindow: noevent,
    callsAvoidedDueToBudget: budget,
    duplicateDataAvoidedCount: already,
    estimatedQuotaSaved: already + notdue + noevent + budget,
    nextDuePulls: decisions
      .filter((d) => d.decision === "skip_not_due_yet")
      .slice(0, 10),
    urgentPullsNow: decisions
      .filter(
        (d) =>
          d.decision === "pull_now" && /SEC|Fed|FDA|SAM|USA/.test(d.provider),
      )
      .slice(0, 10),
    slowDataSkipped: decisions
      .filter((d) => /skip_already|skip_not_due|skip_waiting/.test(d.decision))
      .slice(0, 20),
    rawReceiptsStoredInR2: r2c,
    normalizedSignalsCreated: 0,
    proofReceiptsCreated: 0,
    endpointsAvailableNow: decisions.filter((d) => d.decision === "pull_now")
      .length,
    endpointsSkippedDueToBudget: budget,
    endpointsSkippedDueToPlanRestriction: decisions.filter(
      (d) => d.decision === "skip_plan_restricted",
    ).length,
    endpointsSkippedDueToMissingKey: decisions.filter(
      (d) => d.decision === "skip_missing_key",
    ).length,
    noOpenAI: true,
    noPublish: true,
    noTelegram: true,
    secretsRedacted: true,
  };
}
