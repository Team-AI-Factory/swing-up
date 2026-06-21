export type EntityResolverConfidence = "none" | "low" | "medium" | "high";

export type TickerResolverInput = {
  companyName?: unknown;
  ticker?: unknown;
  sourceTitle?: unknown;
  sourceSummary?: unknown;
  sourceProvider?: unknown;
  rawPayload?: unknown;
};

export type TickerResolverResult = {
  ticker: string | null;
  companyName: string | null;
  confidence: EntityResolverConfidence;
  matchReason: string;
  warnings: string[];
};

type KnownEntity = {
  ticker: string;
  companyName: string;
  aliases: string[];
};

const KNOWN_ENTITIES: KnownEntity[] = [
  { ticker: "AAPL", companyName: "Apple Inc.", aliases: ["Apple", "Apple Inc", "Apple Inc."] },
  { ticker: "MSFT", companyName: "Microsoft Corporation", aliases: ["Microsoft", "Microsoft Corp", "Microsoft Corporation"] },
  { ticker: "NVDA", companyName: "NVIDIA Corporation", aliases: ["NVIDIA", "Nvidia", "NVIDIA Corporation"] },
  { ticker: "TSLA", companyName: "Tesla, Inc.", aliases: ["Tesla", "Tesla Inc", "Tesla, Inc."] },
  { ticker: "AMZN", companyName: "Amazon.com, Inc.", aliases: ["Amazon", "Amazon.com", "Amazon.com Inc"] },
  { ticker: "GOOGL", companyName: "Alphabet Inc.", aliases: ["Alphabet", "Alphabet Inc", "Google"] },
  { ticker: "META", companyName: "Meta Platforms, Inc.", aliases: ["Meta", "Meta Platforms", "Facebook"] },
  { ticker: "AMD", companyName: "Advanced Micro Devices, Inc.", aliases: ["AMD", "Advanced Micro Devices"] },
  { ticker: "AVGO", companyName: "Broadcom Inc.", aliases: ["Broadcom", "Broadcom Inc"] },
  { ticker: "ORCL", companyName: "Oracle Corporation", aliases: ["Oracle", "Oracle Corporation"] },
  { ticker: "CRM", companyName: "Salesforce, Inc.", aliases: ["Salesforce", "Salesforce Inc"] },
  { ticker: "SHOP", companyName: "Shopify Inc.", aliases: ["Shopify", "Shopify Inc"] },
  { ticker: "PLTR", companyName: "Palantir Technologies Inc.", aliases: ["Palantir", "Palantir Technologies"] },
  { ticker: "SMCI", companyName: "Super Micro Computer, Inc.", aliases: ["Super Micro", "Supermicro", "Super Micro Computer"] },
  { ticker: "JPM", companyName: "JPMorgan Chase & Co.", aliases: ["JPMorgan", "JP Morgan", "JPMorgan Chase"] },
  { ticker: "BAC", companyName: "Bank of America Corporation", aliases: ["Bank of America", "BofA"] },
  { ticker: "XOM", companyName: "Exxon Mobil Corporation", aliases: ["Exxon", "ExxonMobil", "Exxon Mobil"] },
  { ticker: "PFE", companyName: "Pfizer Inc.", aliases: ["Pfizer", "Pfizer Inc"] },
  { ticker: "MRNA", companyName: "Moderna, Inc.", aliases: ["Moderna", "Moderna Inc"] },
  { ticker: "LLY", companyName: "Eli Lilly and Company", aliases: ["Eli Lilly", "Lilly", "Eli Lilly and Company"] },
  { ticker: "BIIB", companyName: "Biogen Inc.", aliases: ["Biogen", "Biogen Inc"] },
  { ticker: "COIN", companyName: "Coinbase Global, Inc.", aliases: ["Coinbase", "Coinbase Global"] },
  { ticker: "NFLX", companyName: "Netflix, Inc.", aliases: ["Netflix", "Netflix Inc"] },
  { ticker: "SPY", companyName: "SPDR S&P 500 ETF Trust", aliases: ["SPDR S&P 500 ETF", "S&P 500 ETF", "SPY"] },
];

const IGNORED_TICKERS = new Set(["CEO", "CFO", "FDA", "SEC", "DOJ", "FTC", "ETF", "USA", "USD", "AI", "API", "RSS", "FDA"]);
const TICKER_PATTERN = /^[A-Z][A-Z0-9.]{0,7}$/;

function asText(value: unknown, maxLength = 2000) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function normalizeTicker(value: unknown) {
  const ticker = asText(value, 16).toUpperCase();
  return ticker && TICKER_PATTERN.test(ticker) && !IGNORED_TICKERS.has(ticker) ? ticker : null;
}

function normalizeName(value: string) {
  return value.toLowerCase().replace(/&/g, " and ").replace(/\b(incorporated|inc|corporation|corp|company|co|ltd|plc|class a|common stock)\b/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

function phraseInText(text: string, phrase: string) {
  const normalizedText = ` ${normalizeName(text)} `;
  const normalizedPhrase = normalizeName(phrase);
  return Boolean(normalizedPhrase) && normalizedText.includes(` ${normalizedPhrase} `);
}

function entityByTicker(ticker: string) {
  return KNOWN_ENTITIES.find((entity) => entity.ticker === ticker) ?? null;
}

function entityByName(name: string) {
  const matches = KNOWN_ENTITIES.filter((entity) => [entity.companyName, ...entity.aliases].some((alias) => normalizeName(alias) === normalizeName(name)));
  return matches.length === 1 ? matches[0] : null;
}

function entityMentionedIn(text: string) {
  const matches = KNOWN_ENTITIES.filter((entity) => [entity.companyName, ...entity.aliases].some((alias) => phraseInText(text, alias)));
  return matches.length === 1 ? matches[0] : null;
}

function rawValueAt(payload: unknown, keys: string[]) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "";
  const record = payload as Record<string, unknown>;
  for (const key of keys) {
    const value = asText(record[key], 240);
    if (value) return value;
  }
  return "";
}

export function resolveTickerEntity(input: TickerResolverInput): TickerResolverResult {
  const warnings: string[] = [];
  const explicitTicker = normalizeTicker(input.ticker) ?? normalizeTicker(rawValueAt(input.rawPayload, ["ticker", "symbol", "linkedTicker"]));
  const explicitCompany = asText(input.companyName, 240) || rawValueAt(input.rawPayload, ["company", "companyName", "issuerName", "name"]);
  const textBlob = [input.sourceTitle, input.sourceSummary, input.sourceProvider].map((value) => asText(value)).filter(Boolean).join(" ");

  if (explicitTicker) {
    const known = entityByTicker(explicitTicker);
    const companyMatch = explicitCompany ? entityByName(explicitCompany) : null;
    if (companyMatch && companyMatch.ticker !== explicitTicker) {
      return { ticker: null, companyName: explicitCompany, confidence: "none", matchReason: "conflicting_explicit_ticker_and_company", warnings: [`Explicit ticker ${explicitTicker} conflicts with explicit company ${explicitCompany}.`] };
    }
    return { ticker: explicitTicker, companyName: known?.companyName ?? (explicitCompany || null), confidence: known ? "high" : "medium", matchReason: known ? "explicit_ticker_known_entity" : "explicit_ticker_unmapped_company_not_invented", warnings };
  }

  if (explicitCompany) {
    const known = entityByName(explicitCompany);
    if (known) return { ticker: known.ticker, companyName: known.companyName, confidence: "high", matchReason: "explicit_company_exact_alias_match", warnings };
    warnings.push("Company name was present but no exact safe ticker mapping was found.");
  }

  const mentioned = entityMentionedIn(textBlob);
  if (mentioned) return { ticker: mentioned.ticker, companyName: mentioned.companyName, confidence: "medium", matchReason: "single_known_entity_mentioned_in_source_text", warnings };

  return { ticker: null, companyName: explicitCompany || null, confidence: "none", matchReason: "no_safe_match", warnings: warnings.length ? warnings : ["No ticker was returned because the resolver only uses explicit tickers or exact known aliases."] };
}

export const tickerResolverKnownEntities = KNOWN_ENTITIES.map(({ ticker, companyName, aliases }) => ({ ticker, companyName, aliases: [...aliases] }));
