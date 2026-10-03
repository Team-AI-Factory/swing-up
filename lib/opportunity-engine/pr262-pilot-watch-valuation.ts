import { isSimpleAlertPilot } from "@/lib/simple-alert-pilot-runtime";
import { pilotCompanies } from "@/lib/simple-alert-pilot-scope";
import { validEquityUniverseSnapshot, type EquityUniverseSnapshot } from "@/lib/equity-signal/universe";
import { readVersionedTextFromR2, writeVersionedJsonToR2 } from "@/lib/r2-warehouse";
import { pr262StorageKey } from "@/lib/opportunity-engine/pr262-storage";
import { analyzeUsValueScannerRow, US_VALUE_SCANNER_COLUMNS } from "@/lib/opportunity-engine/us-value-investing-engine";
import { hardenUsValueCompanyAnalysis } from "@/lib/opportunity-engine/us-value-investing-safety";
import type { Pr262ExposureEntry } from "@/lib/opportunity-engine/pr262-exposure-index";

const CACHE_KEY = pr262StorageKey("value-investing/cohort-watch-snapshot-v1.json");
export const PILOT_WATCH_VALUATION_MAX_AGE_MS = 15 * 60_000;
const IDENTITY_MAX_AGE_MS = 24 * 60 * 60_000;
type Json = Record<string, unknown>;
type Identity = { ticker: string; cik: string | null; tradingViewSymbol: string };
function object(value: unknown): Json {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
}
function exchange(value: unknown) {
  const normalized = typeof value === "string" ? value.toUpperCase().replace(/[^A-Z]/g, "") : "";
  return normalized === "NYSEAMERICAN" ? "AMEX" : normalized;
}

function reviewedPilotAdsAttestation(config: Json, row: Json, now: Date) {
  if (config.securityType !== "adr" || row.securityType !== "common_stock"
    || !Array.isArray(row.sourceNames) || row.sourceNames.length !== 1
    || row.sourceNames[0] !== "SEC company_tickers_exchange"
    || typeof config.adsOrdinarySharesRatio !== "number"
    || !Number.isFinite(config.adsOrdinarySharesRatio) || config.adsOrdinarySharesRatio <= 0
    || !Array.isArray(config.sourceUrls) || !config.sourceUrls.includes(config.adsRatioSourceUrl)) return false;
  const effectiveAt = Date.parse(String(config.adsRatioEffectiveAt ?? ""));
  if (!Number.isFinite(effectiveAt) || effectiveAt > now.getTime()) return false;
  // SEC ticker metadata has no share-class field. Only the reviewed, pinned
  // issuer filing can correct its name-derived fallback; a Nasdaq class conflict cannot.
  return typeof config.adsRatioSourceUrl === "string" && new RegExp(
    `^https://www\\.sec\\.gov/Archives/edgar/data/${Number(config.cik)}/\\d{18}/[A-Za-z0-9._-]+\\.html?$`,
  ).test(config.adsRatioSourceUrl);
}

/** A checked-in cohort is admission only. The official universe must separately
 * confirm the exact issuer and exchange; missing/stale/ambiguous identities fail closed. */
export function pilotWatchIdentities(snapshot: EquityUniverseSnapshot, now: Date) {
  if (!isSimpleAlertPilot() || !validEquityUniverseSnapshot(snapshot)) return [];
  const age = now.getTime() - Date.parse(snapshot.refreshedAt);
  if (age < 0 || age > IDENTITY_MAX_AGE_MS) return [];
  return pilotCompanies().flatMap(company => {
    const config = object(company);
    const matches = snapshot.entries.filter(entry => entry.ticker === company.ticker && entry.cik === company.cik
      && entry.sourceNames.includes("SEC company_tickers_exchange")
      && ["NASDAQ", "NYSE", "AMEX"].includes(exchange(entry.exchange))
      && (!config.exchange || exchange(config.exchange) === exchange(entry.exchange))
      && (!config.securityType || config.securityType === entry.securityType || reviewedPilotAdsAttestation(config, object(entry), now)));
    if (matches.length !== 1 || snapshot.entries.filter(entry => entry.cik === company.cik
      && ["NASDAQ", "NYSE", "AMEX"].includes(exchange(entry.exchange))).length !== 1) return [];
    const entry = matches[0];
    return [{ ticker: company.ticker, company: company.company, cik: company.cik,
      exchange: exchange(entry.exchange), tradingViewSymbol: `${exchange(entry.exchange)}:${company.ticker}`,
      securityType: config.securityType === "adr" ? "adr" as const : entry.securityType,
      ...(reviewedPilotAdsAttestation(config, object(entry), now)
        ? { securityIdentitySource: "pilot_reviewed_sec_ads_filing", securityIdentitySourceUrl: config.adsRatioSourceUrl } : {}),
      universeRefreshedAt: snapshot.refreshedAt }];
  });
}

export function pilotWatchExposure(snapshot: EquityUniverseSnapshot, now: Date): Pr262ExposureEntry[] {
  return pilotWatchIdentities(snapshot, now).map(identity => ({ ...identity,
    sector: null, industry: null, marketCap: null, currentPrice: null, businessQuality: 0, risk: 0,
    buyBelowPrice: null, strongBuyBelowPrice: null, trimAbovePrice: null, baseFairValue: null }));
}

/** Scanner currency is not proof that foreign financial amounts and per-share
 * values share the listing's currency/ADS basis. No silent conversion or authority. */
export function pilotValuationUnitsBlocker(identity: { ticker: string; cik: string | null }) {
  if (!isSimpleAlertPilot()) return null;
  const config = object(pilotCompanies().find(row => row.ticker === identity.ticker && row.cik === identity.cik));
  return (typeof config.adsOrdinarySharesRatio === "number" && config.adsOrdinarySharesRatio !== 1)
    || (typeof config.financialReportingCurrency === "string" && config.financialReportingCurrency !== "USD")
    ? "pilot_valuation_currency_or_ads_basis_unverified" : null;
}

function exactAnalysis(row: unknown, identity: Identity, receivedAt: string) {
  const config = pilotCompanies().find(company => company.ticker === identity.ticker && company.cik === identity.cik);
  if (!config || (object(config).exchange && `${exchange(object(config).exchange)}:${config.ticker}` !== identity.tradingViewSymbol)) return null;
  const analysis = analyzeUsValueScannerRow({ row, ...identity, receivedAt });
  return analysis ? hardenUsValueCompanyAnalysis(analysis) : null;
}

/** Persist only rows from the single already-budgeted watch POST. No provider call
 * or new provider quota exists in this module. Missing provider times stay null. */
export async function persistPilotWatchValuations(rows: unknown[], identities: Identity[], now: Date) {
  if (!isSimpleAlertPilot()) return { written: false, records: 0, reason: "outside_pilot" };
  const receivedAt = now.toISOString();
  const records = identities.flatMap(identity => {
    const matches = rows.filter(row => object(row).s === identity.tradingViewSymbol);
    if (matches.length !== 1 || !exactAnalysis(matches[0], identity, receivedAt)) return [];
    return [{ ...identity, row: { s: identity.tradingViewSymbol, d: object(matches[0]).d } }];
  });
  const payload = { version: 1, source: "tradingview_cohort_watch", receivedAt,
    quoteObservedAt: null, liveQuoteVerified: false, fundamentalPeriodAsOf: null,
    columns: [...US_VALUE_SCANNER_COLUMNS], records };
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const current = await readVersionedTextFromR2(CACHE_KEY);
    if (current.found && current.text) {
      const previous = object(JSON.parse(current.text));
      if (Date.parse(String(previous.receivedAt)) >= now.getTime()) return { written: false, records: records.length, reason: "newer_or_equal_snapshot_exists" };
    }
    const written = await writeVersionedJsonToR2(CACHE_KEY, payload,
      current.etag ? { expectedEtag: current.etag } : { createOnly: true });
    if (!written.conflict) return { written: true, records: records.length, reason: null };
  }
  throw new Error("pr262_pilot_watch_valuation_write_conflict");
}

export async function readPilotWatchValuation(identity: Identity, now: Date) {
  if (!isSimpleAlertPilot() || pilotValuationUnitsBlocker(identity)) return null;
  const current = await readVersionedTextFromR2(CACHE_KEY);
  if (!current.found || !current.text) return null;
  const payload = object(JSON.parse(current.text));
  const receivedAt = typeof payload.receivedAt === "string" ? payload.receivedAt : "";
  const age = now.getTime() - Date.parse(receivedAt);
  if (payload.version !== 1 || payload.source !== "tradingview_cohort_watch"
    || !Number.isFinite(age) || age < 0 || age > PILOT_WATCH_VALUATION_MAX_AGE_MS
    || JSON.stringify(payload.columns) !== JSON.stringify(US_VALUE_SCANNER_COLUMNS)) return null;
  const records = Array.isArray(payload.records) ? payload.records.map(object) : [];
  const matches = records.filter(record => record.ticker === identity.ticker && record.cik === identity.cik
    && record.tradingViewSymbol === identity.tradingViewSymbol);
  if (matches.length !== 1) return null;
  const analysis = exactAnalysis(matches[0].row, identity, receivedAt);
  if (!analysis) return null;
  const sourceTiming = {
    source: "tradingview_cohort_watch" as const, observedAtMeaning: "provider_snapshot_retrieval" as const,
    receivedAt, quoteObservedAt: null, fundamentalPeriodAsOf: null, liveQuoteVerified: false as const,
    warning: "observedAt is the scanner retrieval time only. The provider did not supply the quote/session timestamp or financial reporting period. This valuation context is not a verified live quote, including on weekends; use the separate dated quote and filing evidence gates.",
  };
  return { analysis: { ...analysis, sourceTiming }, receivedAt, quoteObservedAt: null, liveQuoteVerified: false as const,
    fundamentalPeriodAsOf: null, source: "cohort_watch_snapshot" as const };
}
