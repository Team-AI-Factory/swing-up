export const fmpDataRegistry = [
  {
    name: "company_profile",
    endpoint: "/stable/profile?symbol=AAPL",
    authStyles: ["query_param_apikey", "header_apikey"],
    purpose: "Company identity and sector context",
    rawBackfill: "disabled_until_r2",
  },
  {
    name: "symbol_search",
    endpoint: "/stable/search-symbol?query=AAPL",
    authStyles: ["query_param_apikey", "header_apikey"],
    purpose: "Symbol discovery diagnostics",
    rawBackfill: "disabled_until_r2",
  },
  {
    name: "stock_list",
    endpoint: "/stable/stock-list",
    authStyles: ["query_param_apikey", "header_apikey"],
    purpose: "Tradable equity universe seed",
    rawBackfill: "disabled_until_r2",
  },
  {
    name: "stock_news",
    endpoint: "/stable/news/stock",
    authStyles: ["query_param_apikey"],
    purpose: "Ticker-specific catalyst receipts",
    rawBackfill: "tiny_live_samples_only",
  },
  {
    name: "press_releases",
    endpoint: "/stable/news/press-releases",
    authStyles: ["query_param_apikey"],
    purpose: "Company-issued catalyst receipts",
    rawBackfill: "tiny_live_samples_only",
  },
] as const;

export const assetUniverseRegistry = [
  {
    assetType: "equity",
    defaultSources: ["FMP Catalyst", "SEC EDGAR", "Google News RSS", "GDELT"],
    historyPolicy: "use_max_available_per_source_without_raw_backfill",
  },
  {
    assetType: "crypto",
    defaultSources: ["CoinGecko", "GDELT", "Google News RSS"],
    historyPolicy: "use_max_available_per_source_without_raw_backfill",
  },
  {
    assetType: "macro",
    defaultSources: ["FRED Macro", "Frankfurter FX"],
    historyPolicy: "use_max_available_per_source_without_raw_backfill",
  },
] as const;

export function registrySafetySummary() {
  return {
    noSecretsReturned: true,
    noFakeProviderSuccess: true,
    noRawHistoryBackfillBeforeR2: true,
    marketReactionPolicy: "bonus_only_not_hard_blocker",
    missingPriceVolumePolicy: "does_not_reject_candidate_by_itself",
    historicalPatternPolicy:
      "use_maximum_available_history_per_source_and_asset_type",
    stage2Policy: "locked_until_proof_and_promotion_score_pass",
  };
}
