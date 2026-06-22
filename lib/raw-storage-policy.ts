export const rawStoragePolicy = {
  rawWarehouse: "Cloudflare R2 stores full raw provider bodies when configured; PostgreSQL stores indexes, summaries, scores, and app state only.",
  postgresPolicy: "Do not duplicate huge raw JSON in PostgreSQL. Store r2Key, contentHash, byteSize, counts, dates, receipt/source URLs, and safe metadata in raw_data_objects.",
  dedupePolicy: "Deduplicate raw objects by SHA-256 contentHash.",
  secretPolicy: "Never store secrets, API keys, auth headers, cookies, or raw request headers. Strip sensitive headers before storage.",
  receiptPolicy: "Keep source receipt URLs where allowed and provider response bodies where legally and technically allowed.",
};
export function stripSensitiveStorageMetadata<T extends Record<string, unknown>>(metadata: T): T {
  const blocked = new Set(["authorization", "cookie", "apiKey", "api_key", "apikey", "token", "secret", "password", "headers", "requestHeaders"]);
  return Object.fromEntries(Object.entries(metadata).filter(([key]) => !blocked.has(key) && !/secret|token|password|authorization|cookie|api.?key/i.test(key))) as T;
}
