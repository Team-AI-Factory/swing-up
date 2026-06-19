import { prisma } from "@/lib/db/client";
import { writeRawSignal } from "@/lib/raw-signal-writer";

export const SEC_EDGAR_SOURCE = "SEC EDGAR";

const SEC_BASE_URL = "https://www.sec.gov";
const SEC_DATA_URL = "https://data.sec.gov";
const FALLBACK_USER_AGENT = "SwingUp/0.1 research-contact@example.com";
const IMPORTANT_FORMS = new Set(["8-K", "10-K", "10-Q", "4", "S-1", "6-K", "SC 13D", "SC 13G", "13D", "13G"]);
const HIGH_IMPORTANCE_FORMS = new Set(["8-K", "S-1", "SC 13D", "SC 13G", "13D", "13G"]);
const DEFAULT_LIMIT = 10;

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

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: secFetchHeaders(), cache: "no-store" });

  if (!response.ok) {
    throw new Error(`SEC request failed with status ${response.status}`);
  }

  return (await response.json()) as T;
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

async function updateSecSourceHealth(status: "connected" | "degraded" | "error", startedAt: number, errorMessage: string | null) {
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

export async function getSecEdgarSourceHealth() {
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
