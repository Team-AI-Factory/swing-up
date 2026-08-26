import crypto from "node:crypto";
import {
  getR2Config,
  readVersionedTextFromR2,
  writeVersionedJsonToR2,
} from "@/lib/r2-warehouse";
import { buildCatalystCompanyDiligence } from "@/lib/opportunity-engine/catalyst-company-diligence";
import {
  runUsValueInvestingCycle,
  type UsValueCompanyAnalysis,
} from "@/lib/opportunity-engine/us-value-investing-engine";
import {
  hardenAndPersistUsValueInvestingCycle,
  type HardenedUsValueInvestingCycle,
} from "@/lib/opportunity-engine/us-value-investing-safety";
import { pr262StorageKey, resolvePr262StoragePrefix } from "@/lib/opportunity-engine/pr262-storage";

const PR262_BRANCH = "agent/combined-opportunity-engine";
const STORAGE_PREFIX = resolvePr262StoragePrefix();
const PRODUCTION_R2_WRITES = STORAGE_PREFIX.startsWith("production/pr262/");
const RUNTIME_BRANCH = PRODUCTION_R2_WRITES
  ? "main"
  : process.env.RAILWAY_GIT_BRANCH?.trim() || PR262_BRANCH;
const R2_PREFIX = pr262StorageKey("value-investing/resumable");
const STATE_KEY = `${R2_PREFIX}/state.json`;
const LATEST_SUMMARY_KEY = `${R2_PREFIX}/latest/index.json`;
const SIGNAL_OUTBOX_PREFIX = pr262StorageKey("research-candidates/outbox/foundation");
const BATCH_SIZE = 500;
const BATCHES_PER_RUN = 4;
const TOP_ALERT_LIMIT = 250;
const TOP_WATCHLIST_LIMIT = 500;

type SignalAction = "buy" | "sell" | "watch_out";

type ResumableBatchSummary = {
  batchIndex: number;
  startIndex: number;
  endIndexExclusive: number;
  companyCount: number;
  companiesWithFairValue: number;
  companiesWithoutFairValue: number;
  seriousBuyCount: number;
  seriousSellCount: number;
  seriousWatchOutCount: number;
  qualityWatchCount: number;
};

type ResumableBatchObject = {
  version: 1;
  kind: "us_value_investing_company_batch";
  branch: string;
  cycleId: string;
  sourceCheckedAt: string;
  persistedAt: string;
  universeFingerprint: string;
  batch: ResumableBatchSummary;
  analyses: UsValueCompanyAnalysis[];
  seriousAlerts: {
    buy: UsValueCompanyAnalysis[];
    sell: UsValueCompanyAnalysis[];
    watchOut: UsValueCompanyAnalysis[];
  };
  qualityPriceWatchlist: UsValueCompanyAnalysis[];
  safety: {
    databaseWrites: false;
    publishing: false;
    notifications: false;
    trades: false;
    productionWrites: boolean;
  };
};

export type ResumableUsValueState = {
  version: 1;
  branch: string;
  cycleId: string;
  status: "running" | "complete";
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  sourceCheckedAt: string;
  latestSourceCheckedAt: string;
  universeFingerprint: string;
  totalCompanies: number;
  nextIndex: number;
  batchSize: number;
  batchesPerRun: number;
  totalBatches: number;
  completedBatchKeys: string[];
  companiesStored: number;
  companiesWithFairValue: number;
  companiesWithoutFairValue: number;
  seriousAlertCounts: {
    buy: number;
    sell: number;
    watchOut: number;
  };
  qualityWatchCount: number;
  seriousAlerts: {
    buy: UsValueCompanyAnalysis[];
    sell: UsValueCompanyAnalysis[];
    watchOut: UsValueCompanyAnalysis[];
  };
  qualityPriceWatchlist: UsValueCompanyAnalysis[];
  latestSummaryKey: string | null;
  immutableSummaryKey: string | null;
  lastError: string | null;
};

export type ResumableUsValueRun = {
  version: 1;
  ok: boolean;
  mode: "pr262_us_value_resumable_batches";
  branch: string;
  checkedAt: string;
  runtime: {
    commitSha: string | null;
    deploymentId: string | null;
  };
  status: ResumableUsValueState["status"];
  progress: {
    cycleId: string;
    totalCompanies: number;
    companiesStored: number;
    companiesStoredThisRun: number;
    batchesCompleted: number;
    batchesCompletedThisRun: number;
    totalBatches: number;
    coveragePercent: number;
    resumedExistingCycle: boolean;
    universeRestarted: boolean;
  };
  provisionalFoundationSignals: {
    buy: UsValueCompanyAnalysis[];
    sell: UsValueCompanyAnalysis[];
    watchOut: UsValueCompanyAnalysis[];
  };
  confirmedFoundationSignals: {
    buy: UsValueCompanyAnalysis[];
    sell: UsValueCompanyAnalysis[];
    watchOut: UsValueCompanyAnalysis[];
  };
  seriousSignalFound: boolean;
  seriousSignalCount: number;
  newSeriousSignalCount: number;
  newSeriousSignals: Array<{
    fingerprint: string;
    action: SignalAction;
    ticker: string;
    company: string;
    currentPrice: number;
    baseFairValue: number | null;
    potentialPercent: number | null;
    reasons: string[];
    outboxKey: string;
  }>;
  diligence: {
    checkedCompanies: number;
    unavailableCompanies: number;
    queuedFoundationCompanies: number;
    persisted: boolean;
    errors: string[];
  };
  warehouse: {
    backend: "cloudflare_r2";
    stateKey: string;
    latestSummaryKey: string | null;
    immutableSummaryKey: string | null;
    completedBatchKeys: string[];
    persisted: boolean;
    errors: string[];
  };
  safety: {
    databaseWrites: false;
    publishing: false;
    notifications: false;
    trades: false;
    productionWrites: boolean;
    nonUsScanning: false;
  };
};

type LoadedState = {
  state: ResumableUsValueState | null;
  etag: string | null;
};

function safeError(error: unknown) {
  return error instanceof Error
    ? error.message.replace(/\s+/g, " ").slice(0, 400)
    : "unknown_resumable_value_error";
}

function dateKey(value: string) {
  return value.replace(/[^0-9]/g, "").slice(0, 17);
}

function rounded(value: number, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function companyKey(item: UsValueCompanyAnalysis) {
  return `${item.exchange.toUpperCase()}:${item.ticker.toUpperCase()}`;
}

function universeFingerprint(items: UsValueCompanyAnalysis[]) {
  return crypto
    .createHash("sha256")
    .update(items.map(companyKey).sort().join("|"))
    .digest("hex");
}

function cycleId(checkedAt: string, fingerprint: string) {
  return `${dateKey(checkedAt)}-${fingerprint.slice(0, 12)}`;
}

function batchKey(state: ResumableUsValueState, batchIndex: number) {
  return `${R2_PREFIX}/cycles/${state.cycleId}/batches/batch-${String(batchIndex).padStart(3, "0")}.json`;
}

function immutableSummaryKey(state: ResumableUsValueState) {
  return `${R2_PREFIX}/runs/${state.startedAt.slice(0, 10)}/${state.cycleId}.json`;
}

function uniqueByCompany(items: UsValueCompanyAnalysis[]) {
  return [...new Map(items.map((item) => [companyKey(item), item])).values()];
}

function topBuy(items: UsValueCompanyAnalysis[]) {
  return uniqueByCompany(items)
    .sort((left, right) => (right.fairValue.upsideToBasePercent ?? -Infinity) - (left.fairValue.upsideToBasePercent ?? -Infinity))
    .slice(0, TOP_ALERT_LIMIT);
}

function topSell(items: UsValueCompanyAnalysis[]) {
  return uniqueByCompany(items)
    .sort((left, right) => (left.fairValue.upsideToBasePercent ?? Infinity) - (right.fairValue.upsideToBasePercent ?? Infinity))
    .slice(0, TOP_ALERT_LIMIT);
}

function topWatchOut(items: UsValueCompanyAnalysis[]) {
  return uniqueByCompany(items)
    .sort((left, right) => right.scores.risk - left.scores.risk)
    .slice(0, TOP_ALERT_LIMIT);
}

function topQualityWatch(items: UsValueCompanyAnalysis[]) {
  return uniqueByCompany(items)
    .sort((left, right) => right.scores.businessQuality - left.scores.businessQuality
      || (right.fairValue.discountToBasePercent ?? -Infinity) - (left.fairValue.discountToBasePercent ?? -Infinity))
    .slice(0, TOP_WATCHLIST_LIMIT);
}

function validState(value: unknown): value is ResumableUsValueState {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return item.version === 1
    && item.branch === RUNTIME_BRANCH
    && typeof item.cycleId === "string"
    && (item.status === "running" || item.status === "complete")
    && typeof item.universeFingerprint === "string"
    && typeof item.totalCompanies === "number"
    && typeof item.nextIndex === "number"
    && Array.isArray(item.completedBatchKeys);
}

async function loadState(): Promise<LoadedState> {
  const current = await readVersionedTextFromR2(STATE_KEY);
  if (!current.found || !current.text) return { state: null, etag: null };
  const parsed = JSON.parse(current.text) as unknown;
  if (!validState(parsed)) throw new Error("resumable_value_state_invalid");
  return { state: parsed, etag: current.etag };
}

async function saveState(state: ResumableUsValueState, etag: string | null) {
  const written = await writeVersionedJsonToR2(
    STATE_KEY,
    state,
    etag ? { expectedEtag: etag } : { createOnly: true },
  );
  if (written.conflict || !written.etag) throw new Error("resumable_value_state_conflict");
  return written.etag;
}

function newState(input: {
  checkedAt: string;
  fingerprint: string;
  totalCompanies: number;
}): ResumableUsValueState {
  return {
    version: 1,
    branch: RUNTIME_BRANCH,
    cycleId: cycleId(input.checkedAt, input.fingerprint),
    status: "running",
    startedAt: input.checkedAt,
    updatedAt: input.checkedAt,
    completedAt: null,
    sourceCheckedAt: input.checkedAt,
    latestSourceCheckedAt: input.checkedAt,
    universeFingerprint: input.fingerprint,
    totalCompanies: input.totalCompanies,
    nextIndex: 0,
    batchSize: BATCH_SIZE,
    batchesPerRun: BATCHES_PER_RUN,
    totalBatches: Math.ceil(input.totalCompanies / BATCH_SIZE),
    completedBatchKeys: [],
    companiesStored: 0,
    companiesWithFairValue: 0,
    companiesWithoutFairValue: 0,
    seriousAlertCounts: { buy: 0, sell: 0, watchOut: 0 },
    qualityWatchCount: 0,
    seriousAlerts: { buy: [], sell: [], watchOut: [] },
    qualityPriceWatchlist: [],
    latestSummaryKey: null,
    immutableSummaryKey: null,
    lastError: null,
  };
}

function buildBatch(
  state: ResumableUsValueState,
  sortedAnalyses: UsValueCompanyAnalysis[],
  startIndex: number,
  sourceCheckedAt: string,
): ResumableBatchObject {
  const batchIndex = Math.floor(startIndex / BATCH_SIZE);
  const analyses = sortedAnalyses.slice(startIndex, startIndex + BATCH_SIZE);
  const buy = analyses.filter((item) => item.decision.tier === "serious_foundation_buy");
  const sell = analyses.filter((item) => item.decision.tier === "serious_foundation_sell");
  const watchOut = analyses.filter((item) => item.decision.tier === "serious_foundation_watch_out");
  const quality = analyses.filter((item) => item.decision.tier === "quality_price_watchlist");
  return {
    version: 1,
    kind: "us_value_investing_company_batch",
    branch: RUNTIME_BRANCH,
    cycleId: state.cycleId,
    sourceCheckedAt,
    persistedAt: new Date().toISOString(),
    universeFingerprint: state.universeFingerprint,
    batch: {
      batchIndex,
      startIndex,
      endIndexExclusive: startIndex + analyses.length,
      companyCount: analyses.length,
      companiesWithFairValue: analyses.filter((item) => item.fairValue.baseValue !== null).length,
      companiesWithoutFairValue: analyses.filter((item) => item.fairValue.baseValue === null).length,
      seriousBuyCount: buy.length,
      seriousSellCount: sell.length,
      seriousWatchOutCount: watchOut.length,
      qualityWatchCount: quality.length,
    },
    analyses,
    seriousAlerts: { buy, sell, watchOut },
    qualityPriceWatchlist: quality,
    safety: {
      databaseWrites: false,
      publishing: false,
      notifications: false,
      trades: false,
      productionWrites: PRODUCTION_R2_WRITES,
    },
  };
}

function applyBatch(state: ResumableUsValueState, key: string, batch: ResumableBatchObject) {
  if (state.completedBatchKeys.includes(key)) return;
  state.completedBatchKeys.push(key);
  state.nextIndex = Math.max(state.nextIndex, batch.batch.endIndexExclusive);
  state.companiesStored += batch.batch.companyCount;
  state.companiesWithFairValue += batch.batch.companiesWithFairValue;
  state.companiesWithoutFairValue += batch.batch.companiesWithoutFairValue;
  state.seriousAlertCounts.buy += batch.batch.seriousBuyCount;
  state.seriousAlertCounts.sell += batch.batch.seriousSellCount;
  state.seriousAlertCounts.watchOut += batch.batch.seriousWatchOutCount;
  state.qualityWatchCount += batch.batch.qualityWatchCount;
  state.seriousAlerts.buy = topBuy([...state.seriousAlerts.buy, ...batch.seriousAlerts.buy]);
  state.seriousAlerts.sell = topSell([...state.seriousAlerts.sell, ...batch.seriousAlerts.sell]);
  state.seriousAlerts.watchOut = topWatchOut([...state.seriousAlerts.watchOut, ...batch.seriousAlerts.watchOut]);
  state.qualityPriceWatchlist = topQualityWatch([...state.qualityPriceWatchlist, ...batch.qualityPriceWatchlist]);
}

async function persistBatch(state: ResumableUsValueState, batch: ResumableBatchObject) {
  const key = batchKey(state, batch.batch.batchIndex);
  const written = await writeVersionedJsonToR2(key, batch, { createOnly: true });
  if (written.written) return { key, batch };
  if (!written.conflict) throw new Error("resumable_value_batch_write_failed");
  const existing = await readVersionedTextFromR2(key);
  if (!existing.found || !existing.text) throw new Error("resumable_value_batch_conflict_read_failed");
  const parsed = JSON.parse(existing.text) as ResumableBatchObject;
  if (
    parsed.kind !== "us_value_investing_company_batch"
    || parsed.cycleId !== state.cycleId
    || parsed.batch.batchIndex !== batch.batch.batchIndex
  ) {
    throw new Error("resumable_value_batch_content_conflict");
  }
  return { key, batch: parsed };
}

function signalBand(action: SignalAction, item: UsValueCompanyAnalysis) {
  const base = item.fairValue.baseValue;
  const ratio = base && base > 0 ? item.currentPrice / base : 0;
  const ratioBand = Math.round(ratio * 20) / 20;
  const riskBand = Math.floor(item.scores.risk / 10) * 10;
  return `${action}|${item.ticker.toUpperCase()}|ratio:${ratioBand.toFixed(2)}|risk:${riskBand}`;
}

async function persistSignalOutbox(
  confirmed: ResumableUsValueRun["confirmedFoundationSignals"],
  checkedAt: string,
) {
  const output: ResumableUsValueRun["newSeriousSignals"] = [];
  const groups: Array<[SignalAction, UsValueCompanyAnalysis[]]> = [
    ["buy", confirmed.buy],
    ["sell", confirmed.sell],
    ["watch_out", confirmed.watchOut],
  ];
  for (const [action, items] of groups) {
    for (const item of items) {
      const fingerprint = crypto.createHash("sha256").update(signalBand(action, item)).digest("hex").slice(0, 24);
      const outboxKey = `${SIGNAL_OUTBOX_PREFIX}/${action}/${item.ticker.toUpperCase()}/${fingerprint}.json`;
      const payload = {
        version: 1,
        kind: "pr262_foundation_research_candidate",
        branch: RUNTIME_BRANCH,
        fingerprint,
        action,
        ticker: item.ticker,
        company: item.company,
        observedAt: checkedAt,
        currentPrice: item.currentPrice,
        conservativeFairValue: item.fairValue.conservativeValue,
        baseFairValue: item.fairValue.baseValue,
        optimisticFairValue: item.fairValue.optimisticValue,
        potentialPercent: item.fairValue.upsideToBasePercent,
        qualityScore: item.scores.businessQuality,
        riskScore: item.scores.risk,
        reasons: item.decision.reasons,
        deliveryStatus: "pending_internal_notification_channel",
        safety: {
          databaseWrites: false,
          publishing: false,
          userNotificationsSent: false,
          trades: false,
        },
      };
      const written = await writeVersionedJsonToR2(outboxKey, payload, { createOnly: true });
      if (!written.written) continue;
      output.push({
        fingerprint,
        action,
        ticker: item.ticker,
        company: item.company,
        currentPrice: item.currentPrice,
        baseFairValue: item.fairValue.baseValue,
        potentialPercent: item.fairValue.upsideToBasePercent,
        reasons: item.decision.reasons,
        outboxKey,
      });
    }
  }
  return output;
}

async function finalizeState(state: ResumableUsValueState, checkedAt: string, etag: string | null) {
  state.status = "complete";
  state.completedAt = checkedAt;
  state.updatedAt = checkedAt;
  state.nextIndex = state.totalCompanies;
  state.companiesStored = Math.min(state.companiesStored, state.totalCompanies);
  const immutableKey = immutableSummaryKey(state);
  const summary = {
    version: 1,
    kind: "us_value_investing_resumable_summary",
    branch: RUNTIME_BRANCH,
    cycleId: state.cycleId,
    status: state.status,
    startedAt: state.startedAt,
    completedAt: state.completedAt,
    sourceCheckedAt: state.sourceCheckedAt,
    latestSourceCheckedAt: state.latestSourceCheckedAt,
    universeFingerprint: state.universeFingerprint,
    coverage: {
      totalCompanies: state.totalCompanies,
      companiesStored: state.companiesStored,
      companiesWithFairValue: state.companiesWithFairValue,
      companiesWithoutFairValue: state.companiesWithoutFairValue,
      totalBatches: state.totalBatches,
      completedBatches: state.completedBatchKeys.length,
      coveragePercent: state.totalCompanies > 0 ? rounded((state.companiesStored / state.totalCompanies) * 100) : 0,
    },
    seriousAlertCounts: state.seriousAlertCounts,
    seriousAlerts: state.seriousAlerts,
    qualityPriceWatchlist: state.qualityPriceWatchlist,
    batchKeys: state.completedBatchKeys,
    safety: {
      databaseWrites: false,
      publishing: false,
      notifications: false,
      trades: false,
      productionWrites: PRODUCTION_R2_WRITES,
    },
  };
  await writeVersionedJsonToR2(LATEST_SUMMARY_KEY, summary);
  const immutable = await writeVersionedJsonToR2(immutableKey, summary, { createOnly: true });
  if (!immutable.written && !immutable.conflict) throw new Error("resumable_value_summary_write_failed");
  state.latestSummaryKey = LATEST_SUMMARY_KEY;
  state.immutableSummaryKey = immutableKey;
  return saveState(state, etag);
}

function confirmedSignals(
  hardened: HardenedUsValueInvestingCycle,
  diligence: Awaited<ReturnType<typeof buildCatalystCompanyDiligence>>,
): ResumableUsValueRun["confirmedFoundationSignals"] {
  const buy = new Set(diligence.alertConfirmation.buy);
  const sell = new Set(diligence.alertConfirmation.sell);
  const watchOut = new Set(diligence.alertConfirmation.watchOut);
  return {
    buy: hardened.seriousAlerts.buy.filter((item) => buy.has(item.ticker)),
    sell: hardened.seriousAlerts.sell.filter((item) => sell.has(item.ticker)),
    watchOut: hardened.seriousAlerts.watchOut.filter((item) => watchOut.has(item.ticker)),
  };
}

export async function runResumableUsValueBatch(input: {
  fetchImpl?: typeof fetch;
  now?: Date;
  foundationOnly?: boolean;
  requireCompleteUniverse?: boolean;
} = {}): Promise<ResumableUsValueRun> {
  const now = input.now ?? new Date();
  const checkedAt = now.toISOString();
  const fetchImpl = input.fetchImpl ?? fetch;
  const warehouseErrors: string[] = [];
  if (!getR2Config().configured) throw new Error("cloudflare_r2_not_configured");

  const raw = await runUsValueInvestingCycle({ fetchImpl, now, persist: false });
  if (input.requireCompleteUniverse && !raw.ok) {
    throw new Error("production_foundation_universe_incomplete");
  }
  const hardened = await hardenAndPersistUsValueInvestingCycle(raw, { persist: false });
  const sortedAnalyses = [...hardened.analyses].sort((left, right) => companyKey(left).localeCompare(companyKey(right)));
  const fingerprint = universeFingerprint(sortedAnalyses);
  let loaded = await loadState();
  const prior = loaded.state;
  const sourceChangedAfterComplete = prior?.status === "complete" && prior.sourceCheckedAt !== hardened.checkedAt;
  const universeChanged = Boolean(prior && (prior.universeFingerprint !== fingerprint || prior.totalCompanies !== sortedAnalyses.length));
  const needsNewCycle = !prior || universeChanged || sourceChangedAfterComplete;
  let state = needsNewCycle
    ? newState({ checkedAt: hardened.checkedAt, fingerprint, totalCompanies: sortedAnalyses.length })
    : prior;
  let etag = loaded.etag;
  const resumedExistingCycle = Boolean(prior && !needsNewCycle && prior.status === "running");

  if (needsNewCycle) {
    try {
      etag = await saveState(state, etag);
    } catch (error) {
      if (safeError(error) !== "resumable_value_state_conflict") throw error;
      loaded = await loadState();
      if (!loaded.state) throw error;
      state = loaded.state;
      etag = loaded.etag;
    }
  }

  state.latestSourceCheckedAt = hardened.checkedAt;
  let batchesCompletedThisRun = 0;
  let companiesStoredThisRun = 0;
  for (let count = 0; count < BATCHES_PER_RUN && state.nextIndex < state.totalCompanies; count += 1) {
    const batch = buildBatch(state, sortedAnalyses, state.nextIndex, hardened.checkedAt);
    if (!batch.batch.companyCount) break;
    try {
      const persisted = await persistBatch(state, batch);
      const before = state.companiesStored;
      applyBatch(state, persisted.key, persisted.batch);
      state.updatedAt = checkedAt;
      state.lastError = null;
      etag = await saveState(state, etag);
      if (state.companiesStored > before) {
        batchesCompletedThisRun += 1;
        companiesStoredThisRun += state.companiesStored - before;
      }
    } catch (error) {
      state.lastError = safeError(error);
      state.updatedAt = checkedAt;
      warehouseErrors.push(state.lastError);
      try { etag = await saveState(state, etag); } catch {}
      break;
    }
  }

  if (state.nextIndex >= state.totalCompanies && state.status !== "complete") {
    try {
      etag = await finalizeState(state, checkedAt, etag);
    } catch (error) {
      state.lastError = safeError(error);
      warehouseErrors.push(state.lastError);
    }
  }

  let diligence: Awaited<ReturnType<typeof buildCatalystCompanyDiligence>> | null = null;
  if (!input.foundationOnly) {
    try {
      diligence = await buildCatalystCompanyDiligence({
        candidates: [],
        valueInvesting: hardened,
        fetchImpl,
        now,
        persist: true,
      });
    } catch (error) {
      warehouseErrors.push(`diligence:${safeError(error)}`);
    }
  }

  const confirmed = diligence
    ? confirmedSignals(hardened, diligence)
    : { buy: [], sell: [], watchOut: [] };
  const seriousSignalCount = confirmed.buy.length + confirmed.sell.length + confirmed.watchOut.length;
  let newSeriousSignals: ResumableUsValueRun["newSeriousSignals"] = [];
  if (!input.foundationOnly) {
    try {
      newSeriousSignals = await persistSignalOutbox(confirmed, checkedAt);
    } catch (error) {
      warehouseErrors.push(`outbox:${safeError(error)}`);
    }
  }

  return {
    version: 1,
    ok: raw.ok && warehouseErrors.length === 0,
    mode: "pr262_us_value_resumable_batches",
    branch: RUNTIME_BRANCH,
    checkedAt,
    runtime: {
      commitSha: process.env.RAILWAY_GIT_COMMIT_SHA?.trim() || null,
      deploymentId: process.env.RAILWAY_DEPLOYMENT_ID?.trim() || null,
    },
    status: state.status,
    progress: {
      cycleId: state.cycleId,
      totalCompanies: state.totalCompanies,
      companiesStored: state.companiesStored,
      companiesStoredThisRun,
      batchesCompleted: state.completedBatchKeys.length,
      batchesCompletedThisRun,
      totalBatches: state.totalBatches,
      coveragePercent: state.totalCompanies > 0 ? rounded((state.companiesStored / state.totalCompanies) * 100) : 0,
      resumedExistingCycle,
      universeRestarted: universeChanged,
    },
    provisionalFoundationSignals: {
      buy: hardened.seriousAlerts.buy,
      sell: hardened.seriousAlerts.sell,
      watchOut: hardened.seriousAlerts.watchOut,
    },
    confirmedFoundationSignals: confirmed,
    seriousSignalFound: seriousSignalCount > 0,
    seriousSignalCount,
    newSeriousSignalCount: newSeriousSignals.length,
    newSeriousSignals,
    diligence: {
      checkedCompanies: diligence?.coverage.companiesCompleted ?? 0,
      unavailableCompanies: diligence?.coverage.companiesUnavailable ?? 0,
      queuedFoundationCompanies: diligence?.coverage.foundationCompaniesQueuedForLaterScan ?? 0,
      persisted: diligence?.warehouse.persisted ?? false,
      errors: diligence?.warehouse.errors ?? [],
    },
    warehouse: {
      backend: "cloudflare_r2",
      stateKey: STATE_KEY,
      latestSummaryKey: state.latestSummaryKey,
      immutableSummaryKey: state.immutableSummaryKey,
      completedBatchKeys: state.completedBatchKeys,
      persisted: state.completedBatchKeys.length > 0,
      errors: warehouseErrors,
    },
    safety: {
      databaseWrites: false,
      publishing: false,
      notifications: false,
      trades: false,
      productionWrites: PRODUCTION_R2_WRITES,
      nonUsScanning: false,
    },
  };
}

export async function readResumableUsValueState() {
  const loaded = await loadState();
  return loaded.state;
}

export const RESUMABLE_US_VALUE_POLICY = Object.freeze({
  branch: RUNTIME_BRANCH,
  batchSize: BATCH_SIZE,
  batchesPerRun: BATCHES_PER_RUN,
  completedCompanyRecordsPersistImmediately: true,
  resumesAfterTimeoutOrRedeploy: true,
  r2StateKey: STATE_KEY,
  r2LatestSummaryKey: LATEST_SUMMARY_KEY,
  signalOutboxPrefix: SIGNAL_OUTBOX_PREFIX,
  publishing: false,
  notifications: false,
  trades: false,
});
