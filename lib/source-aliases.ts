export const SOURCE_ALIAS_MAP = {
  FMP: "FMP Catalyst",
  fmp: "FMP Catalyst",
  "Financial Modeling Prep": "FMP Catalyst",
  "Alpha Vantage": "Alpha Vantage Catalyst",
  "alpha-vantage": "Alpha Vantage Catalyst",
  alphavantage: "Alpha Vantage Catalyst",
  Marketaux: "Marketaux Catalyst",
  marketaux: "Marketaux Catalyst",
  FRED: "FRED Macro",
  fred: "FRED Macro",
  "Wikidata ripple mapping": "Wikidata",
  "wikidata-ripple": "Wikidata",
  "Google News": "Google News RSS",
  "google-news": "Google News RSS",
  googlenews: "Google News RSS",
  FDA: "openFDA",
  OpenFDA: "openFDA",
  openfda: "openFDA",
  "open-fda": "openFDA",
} as const;

const CANONICAL = new Set<string>([...Object.values(SOURCE_ALIAS_MAP), "Database", "SEC EDGAR", "GDELT", "ClinicalTrials.gov", "CoinGecko", "Frankfurter FX", "Polygon", "Company Catalyst Watchlist", "FINRA Short Sale", "AI Committee", "Telegram", "Stripe Managed Payments"]);

function key(value: string) { return value.trim().replace(/\s+/g, " "); }
function loose(value: string) { return key(value).toLowerCase(); }

export function normalizeSourceName(inputSourceName: string | null | undefined) {
  const source = key(inputSourceName ?? "");
  if (!source) return "Unknown Source";
  const direct = SOURCE_ALIAS_MAP[source as keyof typeof SOURCE_ALIAS_MAP];
  if (direct) return direct;
  const found = Object.entries(SOURCE_ALIAS_MAP).find(([alias]) => loose(alias) === loose(source));
  return found?.[1] ?? source;
}

export function aliasesForSource(canonicalSource: string) {
  return Object.entries(SOURCE_ALIAS_MAP).filter(([, canonical]) => canonical === canonicalSource).map(([alias]) => alias);
}

export function isCanonicalSourceName(source: string) { return CANONICAL.has(source) || normalizeSourceName(source) === source; }

export function isSourceAlias(source: string) { return normalizeSourceName(source) !== key(source); }
