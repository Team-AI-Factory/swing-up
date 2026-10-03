type IdentityRow = { ticker?: unknown; cik?: unknown; sourceNames?: unknown; aliases?: unknown; name?: unknown };
const names = (value: unknown) => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
const fromDirectory = (row: IdentityRow) => names(row.sourceNames).some(source => source.startsWith("Nasdaq Trader"));
const explicitlyCommon = (row: IdentityRow) => [...names(row.aliases), typeof row.name === "string" ? row.name : ""].some(alias => /\b(?:common stock|ordinary shares?)\b/i.test(alias));
const directoryCommon = (row: IdentityRow) => fromDirectory(row) && explicitlyCommon(row);

/** Exclude proven non-common directory descriptions and conservatively inferred
 * SEC-only derivative siblings. Never pick between two real common share classes.
 * This also sanitizes old caches whose canonical SEC names lost class wording. */
export function sanitizeAuthoritativeEquityEntries<T extends IdentityRow>(entries: T[]): T[] {
  return entries.filter(candidate => {
    const directory = fromDirectory(candidate);
    if (directory && names(candidate.aliases).some(alias => /\s-\swarrants?\b/i.test(alias))) return false;
    if (!candidate.cik || directory || explicitlyCommon(candidate) || typeof candidate.ticker !== "string") return true;
    return !entries.some(other => {
      if (other.cik !== candidate.cik || typeof other.ticker !== "string" || other.ticker === candidate.ticker) return false;
      // Existing SEC-only suffix exclusions stay unchanged.
      if (["W", "WS", "WT", "R", "U"].some(suffix => candidate.ticker === `${other.ticker}${suffix}`)) return true;
      // These additional conventions require independently described primary
      // common shares, not merely a shorter ticker or issuer-name similarity.
      return directoryCommon(other) && ["WW", "-WT"].some(suffix => candidate.ticker === `${other.ticker}${suffix}`);
    });
  });
}
