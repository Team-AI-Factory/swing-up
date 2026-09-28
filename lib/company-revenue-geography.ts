/** Deliberately narrow: country-level total-revenue statements, never headquarters,
 * regional sales, customer concentration, segment revenue or inferred geography. */
export type RevenueGeography = { country: string; percent: number; year: number; quote: string };
const countries = "United States|United Kingdom|China|Japan|Germany|France|Canada|Australia|India|Brazil|Mexico|Taiwan|South Korea|Singapore|Switzerland|Netherlands|Ireland|Italy|Spain";
const statement = new RegExp(`^(?:In (20\\d{2}),? )?(?:we generated|we earned) ([0-9]{1,3}(?:\\.[0-9]+)?)% of our (?:total |consolidated )?(?:revenue|revenues|net sales) (?:from customers |from sales )?in (?:the )?(${countries})(?: in (20\\d{2}))?\\.$`, "i");

export function revenueGeographyFromQuote(value: unknown, filedAt: string): RevenueGeography | null {
  if (typeof value !== "string") return null;
  const quote = value.replace(/\s+/g, " ").trim();
  const match = quote.match(statement);
  if (!match || (match[1] && match[4] && match[1] !== match[4])) return null;
  const percent = Number(match[2]), year = Number(match[1] ?? match[4]);
  const filedYear = new Date(filedAt).getUTCFullYear();
  if (!Number.isFinite(filedYear) || !(percent > 50 && percent <= 100) || !Number.isInteger(year) || year > filedYear || year < filedYear - 2) return null;
  const country = countries.split("|").find(country => country.toLowerCase() === match[3].toLowerCase())!;
  return { country, percent, year, quote };
}

export function extractRevenueGeography(html: string, filedAt: string) {
  const clean = html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/\s+/g, " ");
  // Keep a whole explicit sentence. More complex disclosures require reviewed
  // extraction; no partial sentence or table arithmetic is guessed here.
  const candidates = clean.match(/(?:In 20\d{2},? )?We (?:generated|earned) [^.?!]{1,250}(?:\.\d+[^.?!]{1,200})?\./gi) ?? [];
  return candidates.map(quote => revenueGeographyFromQuote(quote, filedAt)).find(Boolean) ?? undefined;
}
