import type { RawSignal } from "@prisma/client";

export type SignalFilterStatus = "queued" | "filtered" | "promoted" | "rejected" | "error";

export type SignalFilterDecision = {
  status: SignalFilterStatus;
  reason: string;
};

type SeenSignalKeySet = Set<string>;

type FilterableSignal = Pick<
  RawSignal,
  "source" | "ticker" | "title" | "summary" | "payload" | "importanceHint"
>;

const URGENT_IMPORTANCE = new Set(["urgent", "high", "critical"]);

function clean(value: string | null | undefined) {
  return (value ?? "").trim();
}

function normalized(value: string | null | undefined) {
  return clean(value).toLowerCase();
}

function isSafePayload(payload: unknown) {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    return false;
  }

  try {
    JSON.stringify(payload);
    return true;
  } catch {
    return false;
  }
}

function duplicateKey(signal: FilterableSignal) {
  return [normalized(signal.source), normalized(signal.ticker), normalized(signal.title)].join("::");
}

function sourceIncludes(source: string, terms: string[]) {
  return terms.some((term) => source.includes(term));
}

export function createSignalFilterContext() {
  return { seenKeys: new Set<string>() };
}

export function applySignalRuleFilter(
  signal: FilterableSignal,
  context: { seenKeys: SeenSignalKeySet } = createSignalFilterContext(),
): SignalFilterDecision {
  if (!isSafePayload(signal.payload)) {
    return { status: "error", reason: "Unsafe or broken payload." };
  }

  const source = normalized(signal.source);
  const title = clean(signal.title);
  const summary = clean(signal.summary);
  const ticker = clean(signal.ticker);
  const importance = normalized(signal.importanceHint);

  if (!source) {
    return { status: "rejected", reason: "Missing source." };
  }

  if (!title && !summary) {
    return { status: "rejected", reason: "Missing title and summary." };
  }

  const key = duplicateKey(signal);
  if (context.seenKeys.has(key)) {
    return { status: "filtered", reason: "Duplicate-looking title/source/ticker." };
  }
  context.seenKeys.add(key);

  if (URGENT_IMPORTANCE.has(importance)) {
    return { status: "promoted", reason: "Urgent or high importance." };
  }

  if (sourceIncludes(source, ["sec", "edgar"]) && ticker) {
    return { status: "promoted", reason: "SEC EDGAR signal with ticker." };
  }

  if (sourceIncludes(source, ["fda", "clinicaltrials", "clinical trials"])) {
    return { status: "queued", reason: "FDA/ClinicalTrials signal queued for deeper review." };
  }

  if (sourceIncludes(source, ["fred", "macro"])) {
    return { status: "queued", reason: "Macro/FRED signal queued." };
  }

  if (sourceIncludes(source, ["coingecko", "crypto"])) {
    return { status: "queued", reason: "Crypto/CoinGecko signal queued." };
  }

  if (sourceIncludes(source, ["rss", "news", "gdelt", "google news"])) {
    return { status: "queued", reason: "Generic news/RSS signal queued." };
  }

  return { status: "queued", reason: "Unknown source queued for deeper review." };
}
