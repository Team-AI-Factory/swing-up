import crypto from "node:crypto";
import { loadEquityUniverse } from "@/lib/equity-signal/universe";
import {
  getR2Config,
  readVersionedTextFromR2,
  writeVersionedJsonToR2,
} from "@/lib/r2-warehouse";
import { assessStrategicOptionality } from "@/lib/opportunity-engine/strategic-optionality";
import type { UsValueCompanyAnalysis } from "@/lib/opportunity-engine/us-value-investing-engine";
import { readResumableUsValueState } from "@/lib/opportunity-engine/us-value-investing-resumable";
import { pr262StorageKey } from "@/lib/opportunity-engine/pr262-storage";

const BRANCH = "agent/combined-opportunity-engine" as const;
const RELATIONSHIP_INDEX_KEY = pr262StorageKey("signal-operations/strategic-relationships/index.json");
const BACKFILL_STATE_KEY = pr262StorageKey("signal-operations/strategic-relationships/backfill-state.json");
const BACKFILL_RUN_PREFIX = pr262StorageKey("signal-operations/strategic-relationships/backfill-runs");
const SEC_AGENT = "SwingUp/1.0 support@swingup.app";
const COMPANIES_PER_RUN = 20;
const FILING_FORMS = new Set(["10-Q", "10-K", "20-F", "40-F"]);

type Json = Record<string, unknown>;

type StrategicRelationship = {
  publicTicker: string;
  publicCompany: string;
  relatedEntity: string;
  relationTypes: string[];
  confidence: number;
  sourceUrls: string[];
  firstObservedAt: string;
  lastObservedAt: string;
};

type RelationshipLedger = {
  version: 1;
  branch: typeof BRANCH;
  updatedAt: string;
  relationships: StrategicRelationship[];
};

type BackfillState = {
  version: 1;
  branch: typeof BRANCH;
  universeFingerprint: string;
  nextIndex: number;
  lastRunAt: string;
  companiesAttemptedTotal: number;
  companiesWithRelationshipsTotal: number;
};

export type StrategicRelationshipBackfillReport = {
  version: 1;
  ok: boolean;
  branch: typeof BRANCH;
  checkedAt: string;
  mode: "pr262_strategic_relationship_advance_backfill";
  coverage: {
    eligibleCompanies: number;
    startIndex: number;
    companiesAttempted: number;
    filingsRead: number;
    companiesWithRelationships: number;
    relationshipsAddedOrUpdated: number;
    nextIndex: number;
    fullPassCompleted: boolean;
  };
  relationshipsFound: Array<{
    ticker: string;
    company: string;
    relatedEntities: string[];
    sourceUrl: string;
    optionalityScore: number;
  }>;
  warehouse: {
    relationshipIndexKey: string;
    stateKey: string;
    persisted: boolean;
    errors: string[];
  };
  safety: {
    databaseWrites: false;
    publishing: false;
    directUserNotifications: false;
    trades: false;
    productionWrites: false;
    nonUsScanning: false;
  };
};

function object(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function safeError(error: unknown) {
  return error instanceof Error ? error.message.replace(/\s+/g, " ").slice(0, 400) : "unknown_relationship_backfill_error";
}

function dateKey(value: string) {
  return value.replace(/[^0-9]/g, "").slice(0, 17);
}

async function readJson(key: string) {
  const current = await readVersionedTextFromR2(key);
  if (!current.found || !current.text) return null;
  return JSON.parse(current.text) as unknown;
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>) {
  const output = new Array<R>(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), Math.max(1, items.length)) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      output[index] = await worker(items[index]);
    }
  }));
  return output;
}

function companyKey(item: UsValueCompanyAnalysis) {
  return `${item.exchange.toUpperCase()}:${item.ticker.toUpperCase()}`;
}

async function loadAnalyses() {
  const state = await readResumableUsValueState();
  if (!state) return [] as UsValueCompanyAnalysis[];
  const batches = await mapWithConcurrency(state.completedBatchKeys, 4, async (key) => {
    try {
      const parsed = object(await readJson(key));
      return array(parsed.analyses) as UsValueCompanyAnalysis[];
    } catch {
      return [] as UsValueCompanyAnalysis[];
    }
  });
  const fallback = [...state.seriousAlerts.buy, ...state.qualityPriceWatchlist, ...state.seriousAlerts.sell, ...state.seriousAlerts.watchOut];
  const all = batches.flat().length ? batches.flat() : fallback;
  return [...new Map(all.map((item) => [companyKey(item), item])).values()];
}

function normalized(value: string) {
  return value.toLowerCase().replace(/\b(?:incorporated|inc|corporation|corp|company|co|limited|ltd|plc|holdings?|group)\b/g, " ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function relationTypes(value: ReturnType<typeof assessStrategicOptionality>) {
  return [
    ...(value.layers.equityInvestment ? ["equity_investment"] : []),
    ...(value.layers.commercialRelationship ? ["commercial_relationship"] : []),
    ...(value.layers.infrastructureDemand ? ["infrastructure_demand"] : []),
    ...(value.layers.liquidityEvent ? ["liquidity_event"] : []),
  ];
}

function stripHtml(value: string) {
  return value
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

function fingerprint(tickers: string[]) {
  return crypto.createHash("sha256").update(tickers.join("|")).digest("hex").slice(0, 24);
}

async function loadLedger(): Promise<RelationshipLedger> {
  try {
    const value = object(await readJson(RELATIONSHIP_INDEX_KEY));
    if (value.version === 1 && Array.isArray(value.relationships)) return value as unknown as RelationshipLedger;
  } catch {}
  return { version: 1, branch: BRANCH, updatedAt: new Date(0).toISOString(), relationships: [] };
}

async function loadState(universeFingerprint: string, checkedAt: string): Promise<BackfillState> {
  try {
    const value = object(await readJson(BACKFILL_STATE_KEY));
    if (value.version === 1 && value.branch === BRANCH && value.universeFingerprint === universeFingerprint) return value as unknown as BackfillState;
  } catch {}
  return {
    version: 1,
    branch: BRANCH,
    universeFingerprint,
    nextIndex: 0,
    lastRunAt: checkedAt,
    companiesAttemptedTotal: 0,
    companiesWithRelationshipsTotal: 0,
  };
}

function filingUrl(cik: string, accession: string, primaryDocument: string) {
  const accessionNoDashes = accession.replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${accessionNoDashes}/${primaryDocument}`;
}

async function latestStrategicFiling(cik: string, fetchImpl: typeof fetch) {
  const submissionsUrl = `https://data.sec.gov/submissions/CIK${cik}.json`;
  const response = await fetchImpl(submissionsUrl, {
    headers: { accept: "application/json", "user-agent": SEC_AGENT },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) throw new Error(`sec_submissions_http_${response.status}`);
  const payload = object(await response.json());
  const recent = object(object(payload.filings).recent);
  const forms = array(recent.form).map((value) => String(value));
  const accessions = array(recent.accessionNumber).map((value) => String(value));
  const primaryDocuments = array(recent.primaryDocument).map((value) => String(value));
  const filingDates = array(recent.filingDate).map((value) => String(value));
  let selected: { url: string; form: string; filingDate: string } | null = null;
  for (let index = 0; index < forms.length; index += 1) {
    if (!FILING_FORMS.has(forms[index])) continue;
    if (!accessions[index] || !primaryDocuments[index]) continue;
    selected = { url: filingUrl(cik, accessions[index], primaryDocuments[index]), form: forms[index], filingDate: filingDates[index] ?? "" };
    break;
  }
  if (!selected) return null;
  const filingResponse = await fetchImpl(selected.url, {
    headers: { accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1", "user-agent": SEC_AGENT, range: "bytes=0-1199999" },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });
  if (!filingResponse.ok) throw new Error(`sec_filing_http_${filingResponse.status}`);
  const body = (await filingResponse.text()).slice(0, 1_200_000);
  return { ...selected, bodyText: stripHtml(body).slice(0, 250_000) };
}

function mergeRelationships(
  ledger: RelationshipLedger,
  additions: Array<{ item: UsValueCompanyAnalysis; sourceUrl: string; optionality: ReturnType<typeof assessStrategicOptionality> }>,
  checkedAt: string,
) {
  const map = new Map(ledger.relationships.map((item) => [`${item.publicTicker.toUpperCase()}|${normalized(item.relatedEntity)}`, item]));
  let changed = 0;
  for (const addition of additions) {
    for (const relatedEntity of addition.optionality.relatedEntities) {
      const key = `${addition.item.ticker.toUpperCase()}|${normalized(relatedEntity)}`;
      const prior = map.get(key);
      map.set(key, {
        publicTicker: addition.item.ticker,
        publicCompany: addition.item.company,
        relatedEntity,
        relationTypes: [...new Set([...(prior?.relationTypes ?? []), ...relationTypes(addition.optionality)])],
        confidence: Math.max(prior?.confidence ?? 0, addition.optionality.confidence),
        sourceUrls: [...new Set([...(prior?.sourceUrls ?? []), addition.sourceUrl])].slice(-12),
        firstObservedAt: prior?.firstObservedAt ?? checkedAt,
        lastObservedAt: checkedAt,
      });
      changed += 1;
    }
  }
  return {
    version: 1 as const,
    branch: BRANCH,
    updatedAt: checkedAt,
    relationships: [...map.values()]
      .sort((left, right) => right.confidence - left.confidence || right.lastObservedAt.localeCompare(left.lastObservedAt))
      .slice(0, 2_000),
    changed,
  };
}

export async function runStrategicRelationshipBackfill(input: { fetchImpl?: typeof fetch; now?: Date } = {}): Promise<StrategicRelationshipBackfillReport> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const now = input.now ?? new Date();
  const checkedAt = now.toISOString();
  const errors: string[] = [];
  if (!getR2Config().configured) throw new Error("cloudflare_r2_not_configured");

  const [analyses, universe, ledger] = await Promise.all([loadAnalyses(), loadEquityUniverse(fetchImpl, now), loadLedger()]);
  const cikByTicker = new Map(universe.snapshot.entries.filter((entry) => entry.cik).map((entry) => [entry.ticker.toUpperCase(), entry.cik!]));
  const eligible = analyses
    .filter((item) => cikByTicker.has(item.ticker.toUpperCase()))
    .sort((left, right) => (right.marketCap ?? 0) - (left.marketCap ?? 0) || right.scores.businessQuality - left.scores.businessQuality || left.ticker.localeCompare(right.ticker));
  const universeFingerprint = fingerprint(eligible.map((item) => item.ticker.toUpperCase()));
  const state = await loadState(universeFingerprint, checkedAt);
  const startIndex = Math.min(state.nextIndex, Math.max(0, eligible.length - 1));
  const selected = eligible.slice(startIndex, startIndex + COMPANIES_PER_RUN);
  const wrapped = selected.length < COMPANIES_PER_RUN && startIndex > 0
    ? [...selected, ...eligible.slice(0, COMPANIES_PER_RUN - selected.length)]
    : selected;

  const rows = await mapWithConcurrency(wrapped, 4, async (item) => {
    const cik = cikByTicker.get(item.ticker.toUpperCase())!;
    try {
      const filing = await latestStrategicFiling(cik, fetchImpl);
      if (!filing) return { item, filing: null, optionality: null, error: null as string | null };
      const optionality = assessStrategicOptionality(filing.bodyText);
      return { item, filing, optionality, error: null as string | null };
    } catch (error) {
      return { item, filing: null, optionality: null, error: safeError(error) };
    }
  });
  for (const row of rows) if (row.error) errors.push(`${row.item.ticker}:${row.error}`);
  const additions = rows.flatMap((row) => row.filing && row.optionality?.detected
    ? [{ item: row.item, sourceUrl: row.filing.url, optionality: row.optionality }]
    : []);
  const merged = mergeRelationships(ledger, additions, checkedAt);
  const nextIndex = eligible.length ? (startIndex + wrapped.length) % eligible.length : 0;
  const fullPassCompleted = eligible.length > 0 && nextIndex <= startIndex && wrapped.length > 0;
  const nextState: BackfillState = {
    ...state,
    nextIndex,
    lastRunAt: checkedAt,
    companiesAttemptedTotal: state.companiesAttemptedTotal + wrapped.length,
    companiesWithRelationshipsTotal: state.companiesWithRelationshipsTotal + additions.length,
  };
  let persisted = false;
  try {
    await writeVersionedJsonToR2(RELATIONSHIP_INDEX_KEY, { version: 1, branch: BRANCH, updatedAt: checkedAt, relationships: merged.relationships });
    await writeVersionedJsonToR2(BACKFILL_STATE_KEY, nextState);
    await writeVersionedJsonToR2(`${BACKFILL_RUN_PREFIX}/${checkedAt.slice(0, 10)}/${dateKey(checkedAt)}.json`, {
      version: 1,
      branch: BRANCH,
      checkedAt,
      startIndex,
      nextIndex,
      selected: wrapped.map((item) => item.ticker),
      relationshipsFound: additions.map((item) => ({ ticker: item.item.ticker, relatedEntities: item.optionality.relatedEntities, sourceUrl: item.sourceUrl })),
      errors,
    }, { createOnly: true }).catch(() => {});
    persisted = true;
  } catch (error) {
    errors.push(`r2:${safeError(error)}`);
  }

  return {
    version: 1,
    ok: analyses.length > 0 && persisted,
    branch: BRANCH,
    checkedAt,
    mode: "pr262_strategic_relationship_advance_backfill",
    coverage: {
      eligibleCompanies: eligible.length,
      startIndex,
      companiesAttempted: wrapped.length,
      filingsRead: rows.filter((row) => row.filing).length,
      companiesWithRelationships: additions.length,
      relationshipsAddedOrUpdated: merged.changed,
      nextIndex,
      fullPassCompleted,
    },
    relationshipsFound: additions.map((item) => ({
      ticker: item.item.ticker,
      company: item.item.company,
      relatedEntities: item.optionality.relatedEntities,
      sourceUrl: item.sourceUrl,
      optionalityScore: item.optionality.optionalityScore,
    })),
    warehouse: { relationshipIndexKey: RELATIONSHIP_INDEX_KEY, stateKey: BACKFILL_STATE_KEY, persisted, errors },
    safety: { databaseWrites: false, publishing: false, directUserNotifications: false, trades: false, productionWrites: false, nonUsScanning: false },
  };
}

export async function readStrategicRelationshipBackfillState() {
  try {
    return await readJson(BACKFILL_STATE_KEY);
  } catch {
    return null;
  }
}

export const STRATEGIC_RELATIONSHIP_BACKFILL_POLICY = Object.freeze({
  branch: BRANCH,
  companiesPerRun: COMPANIES_PER_RUN,
  forms: [...FILING_FORMS],
  sources: "official SEC company submissions and periodic filings only",
  relationshipsBuiltBeforeFutureCatalyst: true,
  noPriceRequired: true,
  publishing: false,
  directUserNotifications: false,
  trades: false,
});
