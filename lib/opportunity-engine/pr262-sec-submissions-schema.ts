/** Parse only an actual SEC acceptance timestamp, never a filing-date fallback. */
export function pr262SecAcceptanceTime(value: unknown): number | null {
  if (typeof value !== "string") return null;
  // SEC compact acceptance-header clocks are not declared UTC. Preserve only
  // explicit-zone JSON timestamps here; never append a guessed timezone.
  // https://www.sec.gov/about/webmaster-frequently-asked-questions
  const timestamp = value;
  const parts = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.exec(timestamp);
  if (!parts || Number(parts[2]) > 23 || Number(parts[3]) > 59 || Number(parts[4]) > 59) return null;
  const calendarDay = Date.parse(parts[1]);
  const milliseconds = Date.parse(timestamp);
  return Number.isFinite(calendarDay) && new Date(calendarDay).toISOString().slice(0, 10) === parts[1]
    && Number.isFinite(milliseconds) ? milliseconds : null;
}

/** A complete root index is required before reusing it or certifying a check.
 * Annual-profile excerpts and partial HTTP representations cannot satisfy this.
 * Non-empty rows require actual acceptance timestamps; filing dates alone do
 * not establish an intraday event time. Empty aligned indexes are valid.
 * Official historical rows may have primaryDocument="". Those rows remain
 * part of the complete index, but are not eligible for filing events. */
export function completePr262SecSubmissionsRoot(value: unknown, identity: { cik: string; ticker: string }) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  if (String(body.cik ?? "").padStart(10, "0") !== identity.cik
    || !Array.isArray(body.tickers) || !body.tickers.includes(identity.ticker)) return false;
  const filings = body.filings as { recent?: unknown } | null;
  if (!filings?.recent || typeof filings.recent !== "object" || Array.isArray(filings.recent)) return false;
  const recent = filings.recent as Record<string, unknown>;
  const names = ["accessionNumber", "form", "filingDate", "primaryDocument"] as const;
  if (!names.every(name => Array.isArray(recent[name]))) return false;
  const size = (recent.accessionNumber as unknown[]).length;
  if (!names.every(name => (recent[name] as unknown[]).length === size)) return false;
  const acceptance = recent.acceptanceDateTime;
  if (size === 0) return acceptance === undefined || (Array.isArray(acceptance) && acceptance.length === 0);
  if (!Array.isArray(acceptance) || acceptance.length !== size) return false;
  return Array.from({ length: size }, (_, index) => index).every(index => {
    const accession = (recent.accessionNumber as unknown[])[index];
    const form = (recent.form as unknown[])[index];
    const filingDate = (recent.filingDate as unknown[])[index];
    const document = (recent.primaryDocument as unknown[])[index];
    const accepted = acceptance[index];
    if (typeof accession !== "string" || !/^\d{10}-\d{2}-\d{6}$/.test(accession)
      || typeof form !== "string" || !form.trim()
      || typeof document !== "string" || (document !== "" && !document.trim())
      || typeof filingDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(filingDate)
      || !Number.isFinite(Date.parse(filingDate)) || new Date(filingDate).toISOString().slice(0, 10) !== filingDate
      || pr262SecAcceptanceTime(accepted) === null) return false;
    return true;
  });
}
