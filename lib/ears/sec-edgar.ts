import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { trySaveRawDataToR2 } from "@/lib/r2-warehouse";
import { writeRawSignal } from "@/lib/raw-signal-writer";

export const SEC_EDGAR_SOURCE = "SEC EDGAR";

const SEC_BASE_URL = "https://www.sec.gov";
const SEC_DATA_URL = "https://data.sec.gov";
const FALLBACK_USER_AGENT = "SwingUp/0.1 research-contact@example.com";
const IMPORTANT_FORMS = new Set(["8-K", "10-K", "10-Q", "4", "S-1", "6-K", "SC 13D", "SC 13G", "13D", "13G"]);
const HIGH_IMPORTANCE_FORMS = new Set(["8-K", "S-1", "SC 13D", "SC 13G", "13D", "13G"]);
const DEFAULT_LIMIT = 10;
const THIRTEEN_F_FORMS = new Set(["13F-HR", "13F-HR/A"]);
const DEFAULT_13F_LIMIT = 25;
const DEFAULT_13F_MANAGERS = [
  { cik: "1067983", name: "Berkshire Hathaway Inc." },
  { cik: "1166559", name: "Scion Asset Management, LLC" },
];

export const DEFAULT_SEC_TICKERS = ["AAPL", "NVDA", "TSLA", "MSFT", "AMD", "META", "PLTR", "COIN", "LLY", "SMCI"];

type SecTickerEntry = {
  cik_str: number;
  ticker: string;
  title: string;
};

type SecRecentFilings = {
  accessionNumber?: string[];
  filingDate?: string[];
  reportDate?: string[];
  acceptanceDateTime?: string[];
  form?: string[];
  primaryDocument?: string[];
  primaryDocDescription?: string[];
};

type SecSubmissions = {
  cik: string;
  name?: string;
  tickers?: string[];
  filings?: {
    recent?: SecRecentFilings;
  };
};

type FilingCandidate = {
  ticker: string;
  cik: string;
  companyName?: string;
  accessionNumber: string;
  formType: string;
  filingDate: string;
  reportDate?: string;
  acceptanceDateTime?: string;
  primaryDocument?: string;
  primaryDocDescription?: string;
  filingUrl: string;
  secCompanyUrl: string;
};

export type SecEdgarRunOptions = {
  tickers?: string[];
  limit?: number;
  dryRun?: boolean;
};

export type SecEdgarRunResult = {
  ok: boolean;
  source: typeof SEC_EDGAR_SOURCE;
  tickersChecked: number;
  signalsCreated: number;
  duplicatesSkipped: number;
  errors: string[];
};

type ThirteenFManager = {
  cik: string;
  name?: string;
};

type ThirteenFHolding = {
  issuer: string;
  cusip: string;
  valueThousands: number | null;
  shares: number | null;
  putCall?: string | null;
};

type ThirteenFFiling = {
  manager: ThirteenFManager;
  cik: string;
  accessionNumber: string;
  formType: string;
  filingDate: string;
  reportDate?: string;
  acceptanceDateTime?: string;
  filingUrl: string;
  infoTableUrl: string;
  holdings: ThirteenFHolding[];
};

type ThirteenFSignal = {
  signalType: "new_institutional_holding" | "increased_institutional_holding" | "reduced_institutional_holding" | "exited_institutional_position";
  title: string;
  summary: string;
  filing: ThirteenFFiling;
  latestHolding?: ThirteenFHolding;
  previousHolding?: ThirteenFHolding;
  shareChange?: number | null;
  shareChangePercent?: number | null;
};

export type SecEdgar13FRunOptions = {
  managers?: ThirteenFManager[];
  limit?: number;
  dryRun?: boolean;
};

export type SecEdgar13FRunResult = {
  ok: boolean;
  source: typeof SEC_EDGAR_SOURCE;
  dryRun: boolean;
  managersChecked: number;
  filingsChecked: number;
  holdingsCompared: number;
  signalsCreated: number;
  duplicatesSkipped: number;
  errors: string[];
};

function getSecUserAgent() {
  return process.env.SEC_USER_AGENT?.trim() || FALLBACK_USER_AGENT;
}

function secFetchHeaders() {
  return {
    "User-Agent": getSecUserAgent(),
    Accept: "application/json,text/html;q=0.9,*/*;q=0.8",
  };
}

function normalizeTicker(ticker: string) {
  return ticker.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
}

function normalizeForm(form: string) {
  const upper = form.trim().toUpperCase();
  if (upper === "13D") return "SC 13D";
  if (upper === "13G") return "SC 13G";
  return upper;
}

function cikPadded(cik: string | number) {
  return String(cik).padStart(10, "0");
}

function cikPlain(cik: string | number) {
  return String(Number(cik));
}

function safeError(error: unknown) {
  if (error instanceof Error) {
    return error.message.split("\n")[0]?.slice(0, 180) || "SEC EDGAR request failed";
  }

  return "SEC EDGAR request failed";
}

function parseSecAcceptanceDate(value?: string) {
  if (!value) return undefined;
  if (/^\d{14}$/.test(value)) {
    const iso = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}T${value.slice(8, 10)}:${value.slice(10, 12)}:${value.slice(12, 14)}Z`;
    const date = new Date(iso);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function describeForm(formType: string) {
  if (formType === "8-K") return "A current report that may describe material company events.";
  if (formType === "10-K") return "An annual report with audited financial and business disclosures.";
  if (formType === "10-Q") return "A quarterly report with updated financial and business disclosures.";
  if (formType === "4") return "An insider ownership transaction filing.";
  if (formType === "S-1") return "A registration statement for a securities offering.";
  if (formType === "6-K") return "A foreign issuer report furnished to the SEC.";
  if (formType === "SC 13D") return "A beneficial ownership filing that can indicate activist or control intent.";
  if (formType === "SC 13G") return "A beneficial ownership filing for significant passive or exempt holders.";
  return "An SEC filing signal.";
}

function decodeXml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;|&apos;/g, "'")
    .trim();
}

function xmlTag(block: string, tag: string) {
  const match = block.match(new RegExp(`<[^:>/]*:?${tag}[^>]*>([\\\\s\\\\S]*?)<\\\\/[^:>]*:?${tag}>`, "i"));
  return match?.[1] ? decodeXml(match[1].replace(/<[^>]+>/g, " ")) : null;
}

function numberFromXml(value: string | null) {
  if (!value) return null;
  const parsed = Number(value.replace(/,/g, "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeCusip(value?: string | null) {
  return value?.trim().toUpperCase().replace(/[^A-Z0-9]/g, "") ?? "";
}

function parseManagers(value?: string | null): ThirteenFManager[] {
  if (!value) return DEFAULT_13F_MANAGERS;
  const managers = value
    .split(",")
    .map((part) => {
      const [cikPart, namePart] = part.split(":");
      return { cik: cikPlain(cikPart ?? ""), name: namePart?.trim() || undefined };
    })
    .filter((manager) => manager.cik && Number.isFinite(Number(manager.cik)));
  return managers.length ? managers : DEFAULT_13F_MANAGERS;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: secFetchHeaders(), cache: "no-store" });

  if (!response.ok) {
    throw new Error(`SEC request failed with status ${response.status}`);
  }

  const json = (await response.json()) as T;
  await trySaveRawDataToR2("sec", "filings", null, "submissions", new Date().toISOString().slice(0,10), json, { sourceUrl: url, recordCount: Array.isArray(json) ? json.length : 1 });
  return json;
}

async function fetchText(url: string): Promise<string> {
  const response = await fetch(url, { headers: secFetchHeaders(), cache: "no-store" });

  if (!response.ok) {
    throw new Error(`SEC request failed with status ${response.status}`);
  }

  const text = await response.text();
  await trySaveRawDataToR2("sec", "filings", null, "filing-document", new Date().toISOString().slice(0,10), { text }, { sourceUrl: url, recordCount: 1 });
  return text;
}

async function loadTickerMap() {
  const mapping = await fetchJson<Record<string, SecTickerEntry>>(`${SEC_BASE_URL}/files/company_tickers.json`);
  const byTicker = new Map<string, SecTickerEntry>();

  for (const entry of Object.values(mapping)) {
    if (entry.ticker) byTicker.set(normalizeTicker(entry.ticker), entry);
  }

  return byTicker;
}

function recentFilingCandidates(ticker: string, submission: SecSubmissions, limit: number) {
  const recent = submission.filings?.recent;
  const candidates: FilingCandidate[] = [];

  if (!recent?.accessionNumber?.length) return candidates;

  for (let index = 0; index < recent.accessionNumber.length && candidates.length < limit; index += 1) {
    const accessionNumber = recent.accessionNumber[index];
    const formType = normalizeForm(recent.form?.[index] ?? "");
    const filingDate = recent.filingDate?.[index];

    if (!accessionNumber || !formType || !filingDate || !IMPORTANT_FORMS.has(formType)) continue;

    const cik = cikPadded(submission.cik);
    const accessionPath = accessionNumber.replace(/-/g, "");
    const primaryDocument = recent.primaryDocument?.[index];
    const filingUrl = primaryDocument
      ? `${SEC_BASE_URL}/Archives/edgar/data/${cikPlain(cik)}/${accessionPath}/${primaryDocument}`
      : `${SEC_BASE_URL}/Archives/edgar/data/${cikPlain(cik)}/${accessionPath}/`;

    candidates.push({
      ticker,
      cik,
      companyName: submission.name,
      accessionNumber,
      formType,
      filingDate,
      reportDate: recent.reportDate?.[index] || undefined,
      acceptanceDateTime: recent.acceptanceDateTime?.[index] || undefined,
      primaryDocument,
      primaryDocDescription: recent.primaryDocDescription?.[index] || undefined,
      filingUrl,
      secCompanyUrl: `${SEC_DATA_URL}/submissions/CIK${cik}.json`,
    });
  }

  return candidates;
}

async function createRawSignal(candidate: FilingCandidate, dryRun: boolean) {
  const result = await writeRawSignal({
    sourceName: SEC_EDGAR_SOURCE,
    sourceType: "filing",
    ticker: candidate.ticker,
    eventType: "sec_filing",
    title: `${candidate.ticker} ${candidate.formType} filed ${candidate.filingDate}`,
    summary: `${candidate.ticker} filed ${candidate.formType} with the SEC. ${describeForm(candidate.formType)}`,
    url: candidate.filingUrl,
    detectedAt: parseSecAcceptanceDate(candidate.acceptanceDateTime) ?? new Date(`${candidate.filingDate}T00:00:00Z`),
    duplicateKey: `${SEC_EDGAR_SOURCE}|sec_filing|${candidate.ticker}|${candidate.accessionNumber}`,
    qualityHints: { importanceHint: HIGH_IMPORTANCE_FORMS.has(candidate.formType) ? "high" : "medium", sourceQuality: "high", useful: true, reasons: ["official SEC filing"] },
    rawPayload: {
      accessionNumber: candidate.accessionNumber,
      formType: candidate.formType,
      filingDate: candidate.filingDate,
      reportDate: candidate.reportDate ?? null,
      secUrls: {
        filing: candidate.filingUrl,
        companySubmissions: candidate.secCompanyUrl,
      },
      rawMetadata: candidate,
    },
    dryRun,
  });
  if (result.status === "saved") return "created" as const;
  if (result.status === "skipped" && result.reason === "duplicate") return "duplicate" as const;
  return "dry_run" as const;
}

function parse13FHoldings(xml: string, limit: number) {
  const holdings: ThirteenFHolding[] = [];
  const blocks = xml.match(/<[^:>/]*:?infoTable\b[\s\S]*?<\/[^:>]*:?infoTable>/gi) ?? [];

  for (const block of blocks) {
    const cusip = normalizeCusip(xmlTag(block, "cusip"));
    const issuer = xmlTag(block, "nameOfIssuer");
    if (!cusip || !issuer) continue;
    holdings.push({
      issuer,
      cusip,
      valueThousands: numberFromXml(xmlTag(block, "value")),
      shares: numberFromXml(xmlTag(block, "sshPrnamt")),
      putCall: xmlTag(block, "putCall"),
    });
    if (holdings.length >= limit) break;
  }

  return holdings;
}

async function find13FInfoTableUrl(cik: string, accessionNumber: string) {
  const accessionPath = accessionNumber.replace(/-/g, "");
  const baseArchiveUrl = `${SEC_BASE_URL}/Archives/edgar/data/${cikPlain(cik)}/${accessionPath}`;
  const index = await fetchJson<{ directory?: { item?: { name?: string; type?: string }[] } }>(`${baseArchiveUrl}/index.json`);
  const items = index.directory?.item ?? [];
  const xml = items.find((item) => /infotable|form13fInfoTable/i.test(item.name ?? ""))
    ?? items.find((item) => /\.xml$/i.test(item.name ?? "") && !/primary|xsl/i.test(item.name ?? ""));
  if (!xml?.name) throw new Error("13F information table XML not found");
  return `${baseArchiveUrl}/${xml.name}`;
}

function recent13FFilingMetas(manager: ThirteenFManager, submission: SecSubmissions, count = 2) {
  const recent = submission.filings?.recent;
  const filings: Omit<ThirteenFFiling, "infoTableUrl" | "holdings">[] = [];
  if (!recent?.accessionNumber?.length) return filings;

  for (let index = 0; index < recent.accessionNumber.length && filings.length < count; index += 1) {
    const accessionNumber = recent.accessionNumber[index];
    const formType = normalizeForm(recent.form?.[index] ?? "");
    const filingDate = recent.filingDate?.[index];
    if (!accessionNumber || !filingDate || !THIRTEEN_F_FORMS.has(formType)) continue;
    const cik = cikPadded(submission.cik);
    const accessionPath = accessionNumber.replace(/-/g, "");
    filings.push({
      manager: { cik, name: manager.name ?? submission.name },
      cik,
      accessionNumber,
      formType,
      filingDate,
      reportDate: recent.reportDate?.[index] || undefined,
      acceptanceDateTime: recent.acceptanceDateTime?.[index] || undefined,
      filingUrl: `${SEC_BASE_URL}/Archives/edgar/data/${cikPlain(cik)}/${accessionPath}/`,
    });
  }

  return filings;
}

async function load13FFiling(manager: ThirteenFManager, meta: Omit<ThirteenFFiling, "infoTableUrl" | "holdings">, limit: number): Promise<ThirteenFFiling> {
  const infoTableUrl = await find13FInfoTableUrl(meta.cik, meta.accessionNumber);
  const xml = await fetchText(infoTableUrl);
  return { ...meta, manager, infoTableUrl, holdings: parse13FHoldings(xml, limit) };
}

function build13FSignals(latest: ThirteenFFiling, previous: ThirteenFFiling | null) {
  const signals: ThirteenFSignal[] = [];
  const previousByCusip = new Map((previous?.holdings ?? []).map((holding) => [holding.cusip, holding]));
  const latestByCusip = new Map(latest.holdings.map((holding) => [holding.cusip, holding]));
  const managerName = latest.manager.name ?? `CIK ${cikPlain(latest.cik)}`;
  const period = latest.reportDate ?? latest.filingDate;

  for (const holding of latest.holdings) {
    const old = previousByCusip.get(holding.cusip);
    const shareChange = old?.shares != null && holding.shares != null ? holding.shares - old.shares : null;
    const shareChangePercent = shareChange != null && old?.shares ? (shareChange / old.shares) * 100 : null;
    const common = {
      filing: latest,
      latestHolding: holding,
      previousHolding: old,
      shareChange,
      shareChangePercent,
    };
    if (!old) {
      signals.push({
        ...common,
        signalType: "new_institutional_holding",
        title: `${managerName} disclosed a new 13F holding in ${holding.issuer}`,
        summary: `${managerName} disclosed a historical 13F holding in ${holding.issuer} for report period ${period}. This is a delayed SEC holdings disclosure, not a live trade signal or statement of intent.`,
      });
    } else if (shareChange != null && shareChange > 0) {
      signals.push({
        ...common,
        signalType: "increased_institutional_holding",
        title: `${managerName} disclosed increased 13F shares in ${holding.issuer}`,
        summary: `${managerName} disclosed a higher historical 13F share count in ${holding.issuer} versus the prior sampled filing. This is a delayed SEC holdings disclosure, not a live trade signal or statement of intent.`,
      });
    } else if (shareChange != null && shareChange < 0) {
      signals.push({
        ...common,
        signalType: "reduced_institutional_holding",
        title: `${managerName} disclosed reduced 13F shares in ${holding.issuer}`,
        summary: `${managerName} disclosed a lower historical 13F share count in ${holding.issuer} versus the prior sampled filing. This is a delayed SEC holdings disclosure, not a live trade signal or statement of intent.`,
      });
    }
  }

  for (const old of previous?.holdings ?? []) {
    if (latestByCusip.has(old.cusip)) continue;
    signals.push({
      signalType: "exited_institutional_position",
      title: `${managerName} no longer disclosed a sampled 13F position in ${old.issuer}`,
      summary: `${managerName} did not disclose ${old.issuer} in the latest sampled 13F information table after it appeared in the prior sampled filing. This is a delayed SEC holdings disclosure, not a live trade signal or statement of intent.`,
      filing: latest,
      previousHolding: old,
    });
  }

  return signals;
}

async function create13FRawSignal(signal: ThirteenFSignal, dryRun: boolean) {
  const result = await writeRawSignal({
    sourceName: SEC_EDGAR_SOURCE,
    sourceType: "filing",
    eventType: signal.signalType,
    title: signal.title,
    summary: signal.summary,
    url: signal.filing.infoTableUrl,
    detectedAt: parseSecAcceptanceDate(signal.filing.acceptanceDateTime) ?? new Date(`${signal.filing.filingDate}T00:00:00Z`),
    duplicateKey: `${SEC_EDGAR_SOURCE}|13f|${signal.signalType}|${cikPlain(signal.filing.cik)}|${signal.filing.accessionNumber}|${signal.latestHolding?.cusip ?? signal.previousHolding?.cusip ?? "unknown"}`,
    qualityHints: { importanceHint: "medium", sourceQuality: "high", useful: true, reasons: ["official SEC 13F filing", "disclosed historical holdings"] },
    rawPayload: {
      disclosureType: "SEC Form 13F-HR institutional holdings",
      safetyLabel: "Disclosed historical holdings; not live trades and not investment intent.",
      manager: signal.filing.manager,
      accessionNumber: signal.filing.accessionNumber,
      formType: signal.filing.formType,
      filingDate: signal.filing.filingDate,
      reportDate: signal.filing.reportDate ?? null,
      signalType: signal.signalType,
      latestHolding: signal.latestHolding ?? null,
      previousHolding: signal.previousHolding ?? null,
      shareChange: signal.shareChange ?? null,
      shareChangePercent: signal.shareChangePercent ?? null,
      secUrls: { filing: signal.filing.filingUrl, informationTable: signal.filing.infoTableUrl },
    },
    dryRun,
  });
  if (result.status === "saved") return "created" as const;
  if (result.status === "skipped" && result.reason === "duplicate") return "duplicate" as const;
  return "dry_run" as const;
}

async function updateSecSourceHealth(status: "connected" | "degraded" | "error", startedAt: number, errorMessage: string | null) {
  if (!process.env.DATABASE_URL) return;
  const now = new Date();
  await prisma.sourceHealth.upsert({
    where: { source: SEC_EDGAR_SOURCE },
    create: {
      source: SEC_EDGAR_SOURCE,
      status,
      checkedAt: now,
      lastSuccessAt: status === "connected" || status === "degraded" ? now : null,
      responseTimeMs: Date.now() - startedAt,
      errorMessage,
      usage: "Public SEC EDGAR filing ingestion",
      notes: "Ingests important public SEC filings into the Raw Signal Store.",
    },
    update: {
      status,
      checkedAt: now,
      lastSuccessAt: status === "connected" || status === "degraded" ? now : undefined,
      responseTimeMs: Date.now() - startedAt,
      errorMessage,
      usage: "Public SEC EDGAR filing ingestion",
      notes: "Ingests important public SEC filings into the Raw Signal Store.",
    },
  });
}

async function recordSec13FSourceRun(input: {
  startedAt: Date;
  status: "ok" | "degraded" | "error";
  dryRun: boolean;
  recordsChecked: number;
  signalsCreated: number;
  duplicatesSkipped: number;
  errors: string[];
  sourceHealthStatus: string;
}) {
  if (!process.env.DATABASE_URL) return;
  try {
    await prisma.sourceRun.create({
      data: {
        source: `${SEC_EDGAR_SOURCE} 13F`,
        startedAt: input.startedAt,
        finishedAt: new Date(),
        status: input.status,
        dryRun: input.dryRun,
        recordsChecked: input.recordsChecked,
        signalsCreated: input.signalsCreated,
        duplicatesSkipped: input.duplicatesSkipped,
        errors: input.errors as Prisma.InputJsonValue,
        sourceHealthStatus: input.sourceHealthStatus,
      },
    });
  } catch {
    // Source run history is audit-only and should never make ingestion fail.
  }
}

export async function runSecEdgarIngestion(options: SecEdgarRunOptions = {}): Promise<SecEdgarRunResult> {
  const startedAt = Date.now();
  const tickers = (options.tickers?.length ? options.tickers : DEFAULT_SEC_TICKERS).map(normalizeTicker).filter(Boolean);
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_LIMIT, 1), 25);
  const errors: string[] = [];
  let signalsCreated = 0;
  let duplicatesSkipped = 0;

  try {
    const tickerMap = await loadTickerMap();

    for (const ticker of tickers) {
      try {
        const mapped = tickerMap.get(ticker);
        if (!mapped) {
          errors.push(`${ticker}: ticker not found in SEC mapping`);
          continue;
        }

        const cik = cikPadded(mapped.cik_str);
        const submission = await fetchJson<SecSubmissions>(`${SEC_DATA_URL}/submissions/CIK${cik}.json`);
        const candidates = recentFilingCandidates(ticker, submission, limit);

        for (const candidate of candidates) {
          const result = await createRawSignal(candidate, Boolean(options.dryRun));
          if (result === "duplicate") duplicatesSkipped += 1;
          if (result === "created") signalsCreated += 1;
        }
      } catch (error) {
        errors.push(`${ticker}: ${safeError(error)}`);
      }
    }

    await updateSecSourceHealth(errors.length ? "degraded" : "connected", startedAt, errors[0] ?? null);

    return { ok: true, source: SEC_EDGAR_SOURCE, tickersChecked: tickers.length, signalsCreated, duplicatesSkipped, errors };
  } catch (error) {
    const safe = safeError(error);
    await updateSecSourceHealth("error", startedAt, safe);
    return { ok: false, source: SEC_EDGAR_SOURCE, tickersChecked: tickers.length, signalsCreated, duplicatesSkipped, errors: [safe] };
  }
}

export function parseSec13FManagersParam(value?: string | null) {
  return parseManagers(value);
}

export async function runSecEdgar13FIngestion(options: SecEdgar13FRunOptions = {}): Promise<SecEdgar13FRunResult> {
  const startedAt = Date.now();
  const runStartedAt = new Date(startedAt);
  const dryRun = options.dryRun !== false;
  const managers = (options.managers?.length ? options.managers : DEFAULT_13F_MANAGERS).slice(0, 5);
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_13F_LIMIT, 1), 50);
  const errors: string[] = [];
  let filingsChecked = 0;
  let holdingsCompared = 0;
  let signalsCreated = 0;
  let duplicatesSkipped = 0;

  try {
    for (const manager of managers) {
      try {
        const cik = cikPadded(manager.cik);
        const submission = await fetchJson<SecSubmissions>(`${SEC_DATA_URL}/submissions/CIK${cik}.json`);
        const metas = recent13FFilingMetas(manager, submission, 2);
        if (!metas.length) {
          errors.push(`${manager.name ?? cik}: no recent 13F-HR filings found`);
          continue;
        }

        const latest = await load13FFiling({ cik, name: manager.name ?? submission.name }, metas[0], limit);
        const previous = metas[1] ? await load13FFiling({ cik, name: manager.name ?? submission.name }, metas[1], limit) : null;
        filingsChecked += previous ? 2 : 1;
        holdingsCompared += latest.holdings.length + (previous?.holdings.length ?? 0);

        for (const signal of build13FSignals(latest, previous)) {
          const result = await create13FRawSignal(signal, dryRun);
          if (result === "duplicate") duplicatesSkipped += 1;
          if (result === "created") signalsCreated += 1;
        }
      } catch (error) {
        errors.push(`${manager.name ?? manager.cik}: ${safeError(error)}`);
      }
    }

    const healthStatus = errors.length ? (filingsChecked ? "degraded" : "error") : "connected";
    await updateSecSourceHealth(healthStatus, startedAt, errors[0] ?? null);
    await recordSec13FSourceRun({ startedAt: runStartedAt, status: filingsChecked ? (errors.length ? "degraded" : "ok") : "error", dryRun, recordsChecked: holdingsCompared, signalsCreated, duplicatesSkipped, errors, sourceHealthStatus: healthStatus });

    return { ok: filingsChecked > 0, source: SEC_EDGAR_SOURCE, dryRun, managersChecked: managers.length, filingsChecked, holdingsCompared, signalsCreated, duplicatesSkipped, errors };
  } catch (error) {
    const safe = safeError(error);
    await updateSecSourceHealth("error", startedAt, safe);
    await recordSec13FSourceRun({ startedAt: runStartedAt, status: "error", dryRun, recordsChecked: holdingsCompared, signalsCreated, duplicatesSkipped, errors: [safe], sourceHealthStatus: "error" });
    return { ok: false, source: SEC_EDGAR_SOURCE, dryRun, managersChecked: managers.length, filingsChecked, holdingsCompared, signalsCreated, duplicatesSkipped, errors: [safe] };
  }
}

export async function getSecEdgarSourceHealth() {
  if (!process.env.DATABASE_URL) {
    return {
      source: SEC_EDGAR_SOURCE,
      status: "stubbed",
      lastChecked: null,
      lastSuccess: null,
      responseTimeMs: null,
      lastError: null,
      usage: "Public SEC EDGAR filing ingestion",
      notes: "Source Health persistence is unavailable because DATABASE_URL is not configured.",
    };
  }

  const row = await prisma.sourceHealth.findUnique({ where: { source: SEC_EDGAR_SOURCE } });

  return row
    ? {
        source: row.source,
        status: row.status,
        lastChecked: row.checkedAt.toISOString(),
        lastSuccess: row.lastSuccessAt?.toISOString() ?? null,
        responseTimeMs: row.responseTimeMs,
        lastError: row.errorMessage ? row.errorMessage.slice(0, 240) : null,
        usage: row.usage,
        notes: row.notes,
      }
    : {
        source: SEC_EDGAR_SOURCE,
        status: "stubbed",
        lastChecked: null,
        lastSuccess: null,
        responseTimeMs: null,
        lastError: null,
        usage: "Public SEC EDGAR filing ingestion",
        notes: "SEC EDGAR has not been checked yet.",
      };
}
