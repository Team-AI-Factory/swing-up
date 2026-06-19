import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";

export const OPENFDA_SOURCE = "openFDA";

const OPENFDA_DRUGS_URL = "https://api.fda.gov/drug/drugsfda.json";
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;
const REQUEST_TIMEOUT_MS = 10_000;

type OpenFdaProduct = { brand_name?: string; active_ingredients?: { name?: string }[] };
type OpenFdaSubmission = { submission_type?: string; submission_number?: string; submission_status?: string; submission_status_date?: string };
type OpenFdaApplication = {
  application_number?: string;
  sponsor_name?: string;
  products?: OpenFdaProduct[];
  submissions?: OpenFdaSubmission[];
};
type OpenFdaResponse = { results?: OpenFdaApplication[] };

type OpenFdaCandidate = {
  applicationNumber: string;
  sponsorName: string;
  brandName: string;
  activeIngredients: string[];
  submissionType: string;
  submissionStatus: string;
  submissionDate: string | null;
  sourceUrl: string;
};

export type OpenFdaRunOptions = { dryRun?: boolean; limit?: number };
export type OpenFdaRunResult = {
  ok: boolean;
  source: typeof OPENFDA_SOURCE;
  dryRun: boolean;
  applicationsChecked: number;
  signalsCreated: number;
  duplicatesSkipped: number;
  responseTimeMs: number;
  errors: string[];
};

function capLimit(limit?: number) {
  if (!Number.isFinite(limit) || !limit || limit < 1) return DEFAULT_LIMIT;
  return Math.min(Math.floor(limit), MAX_LIMIT);
}

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function safeError(error: unknown) {
  return error instanceof Error ? error.message.split("\n")[0]?.slice(0, 180) || "openFDA request failed" : "openFDA request failed";
}

function latestSubmission(application: OpenFdaApplication) {
  const submissions = Array.isArray(application.submissions) ? application.submissions : [];
  return submissions
    .filter((submission) => text(submission.submission_status_date))
    .sort((left, right) => text(right.submission_status_date).localeCompare(text(left.submission_status_date)))[0] ?? submissions[0];
}

function toCandidate(application: OpenFdaApplication): OpenFdaCandidate | null {
  const applicationNumber = text(application.application_number);
  const sponsorName = text(application.sponsor_name);
  const product = Array.isArray(application.products) ? application.products[0] : undefined;
  const brandName = text(product?.brand_name, "Unknown drug product");
  const activeIngredients = Array.isArray(product?.active_ingredients)
    ? product.active_ingredients.map((ingredient) => text(ingredient.name)).filter(Boolean)
    : [];
  const submission = latestSubmission(application);
  const submissionType = text(submission?.submission_type, "submission");
  const submissionStatus = text(submission?.submission_status, "unknown status");
  const submissionDate = text(submission?.submission_status_date) || null;

  if (!applicationNumber || !sponsorName) return null;

  const sourceUrl = `${OPENFDA_DRUGS_URL}?search=application_number:${encodeURIComponent(applicationNumber)}`;
  return { applicationNumber, sponsorName, brandName, activeIngredients, submissionType, submissionStatus, submissionDate, sourceUrl };
}

async function fetchRecentDrugApplications(limit: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const url = new URL(OPENFDA_DRUGS_URL);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("sort", "submissions.submission_status_date:desc");

  try {
    const response = await fetch(url, { cache: "no-store", signal: controller.signal, headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`openFDA request failed with status ${response.status}`);
    const body = (await response.json()) as OpenFdaResponse;
    return (body.results ?? []).map(toCandidate).filter((candidate): candidate is OpenFdaCandidate => Boolean(candidate));
  } finally {
    clearTimeout(timeout);
  }
}

async function rawSignalExists(candidate: OpenFdaCandidate) {
  if (!process.env.DATABASE_URL) return false;
  const existing = await prisma.rawSignal.findFirst({
    where: { source: OPENFDA_SOURCE, signalType: "fda_drug_application", OR: [{ sourceUrl: candidate.sourceUrl }, { title: `${candidate.sponsorName} ${candidate.brandName} FDA ${candidate.submissionStatus}` }] },
    select: { id: true },
  });
  return Boolean(existing);
}

async function createRawSignal(candidate: OpenFdaCandidate, dryRun: boolean) {
  if (await rawSignalExists(candidate)) return "duplicate" as const;
  if (dryRun || !process.env.DATABASE_URL) return "dry_run" as const;

  await prisma.rawSignal.create({
    data: {
      source: OPENFDA_SOURCE,
      ticker: null,
      signalType: "fda_drug_application",
      title: `${candidate.sponsorName} ${candidate.brandName} FDA ${candidate.submissionStatus}`,
      summary: `${candidate.sponsorName} has an openFDA Drugs@FDA ${candidate.submissionType} marked ${candidate.submissionStatus}. This is a raw regulatory signal only and needs ticker mapping, proof, risk, scoring, and review before any alert.`,
      sourceUrl: candidate.sourceUrl,
      receivedAt: candidate.submissionDate ? new Date(`${candidate.submissionDate}T00:00:00Z`) : new Date(),
      processedStatus: "new",
      importanceHint: candidate.submissionStatus.toLowerCase().includes("approved") ? "high" : "medium",
      payload: { ...candidate, noFinalAlerts: true, requiresTickerMapping: true } satisfies Prisma.InputJsonValue,
    },
  });
  return "created" as const;
}

async function updateOpenFdaHealth(status: "connected" | "degraded" | "error", startedAt: number, errorMessage: string | null, notes: string) {
  if (!process.env.DATABASE_URL) return;
  const now = new Date();
  await prisma.sourceHealth.upsert({
    where: { source: OPENFDA_SOURCE },
    create: { source: OPENFDA_SOURCE, status, checkedAt: now, lastSuccessAt: status === "error" ? null : now, responseTimeMs: Date.now() - startedAt, errorMessage, usage: "Public openFDA Drugs@FDA regulatory ear; no API key required", notes },
    update: { status, checkedAt: now, lastSuccessAt: status === "error" ? undefined : now, responseTimeMs: Date.now() - startedAt, errorMessage, usage: "Public openFDA Drugs@FDA regulatory ear; no API key required", notes },
  });
}

export async function runOpenFdaIngestion(options: OpenFdaRunOptions = {}): Promise<OpenFdaRunResult> {
  const startedAt = Date.now();
  const dryRun = options.dryRun !== false;
  const errors: string[] = [];
  let candidates: OpenFdaCandidate[] = [];
  let signalsCreated = 0;
  let duplicatesSkipped = 0;

  try {
    candidates = await fetchRecentDrugApplications(capLimit(options.limit));
    for (const candidate of candidates) {
      const result = await createRawSignal(candidate, dryRun);
      if (result === "created") signalsCreated += 1;
      if (result === "duplicate") duplicatesSkipped += 1;
    }
  } catch (error) {
    errors.push(safeError(error));
  }

  const status = errors.length ? "error" : candidates.length ? "connected" : "degraded";
  await updateOpenFdaHealth(status, startedAt, errors[0] ?? null, "Captures recent Drugs@FDA application changes into raw_signals only; does not map to tradable tickers or publish alerts.");

  return { ok: !errors.length, source: OPENFDA_SOURCE, dryRun, applicationsChecked: candidates.length, signalsCreated, duplicatesSkipped, responseTimeMs: Date.now() - startedAt, errors };
}
