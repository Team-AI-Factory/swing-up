/** Company descriptions must be extracts from a dated, identity-verified source. */
export type CompanyIdentity = { ticker?: unknown; company?: unknown; cik?: unknown };
export type VerifiedCompanyProfile = {
  version: 1; status: "verified"; ticker: string; company: string; cik: string;
  business: string; customers: string; description: string;
  sourceType: "sec_annual_filing"; sourceUrl: string; sourceFiledAt: string; verifiedAt: string;
};
const object = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const text = (v: unknown) => typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
export const profileCik = (v: unknown) => /^\d{1,10}$/.test(String(v ?? "")) && Number(v) > 0 ? String(v).padStart(10, "0") : null;
const placeholder = /not yet been verified|still being collected|is the listed company|is classified in|company profile.*(?:missing|unavailable)/i;
const businessWords = /\b(?:manufactur\w*|design\w*|develop\w*|produc\w*|provid\w*|operat\w*|distribut\w*|sell\w*|offer\w*|deliver\w*)\b/i;
const customerSubjects = "(?:customers?|clients?|consumers?|patients?|subscribers?|end.users?|end.markets?|markets?|customer base|client base|customer segments?|market segments?)";
const customerPredicate = new RegExp(`\\b${customerSubjects}\\s+(?:(?:we serve|primarily|mainly|principally|largely|generally|predominantly)\\s+)*(?:include[sd]?|comprise[sd]?|consists? of|range[sd]? from|are|is)\\s+(.+)`, "i");
const customerCaveat = /\b(?:no (?:single )?customer|\d+(?:\.\d+)?%|percent|concentration|accounts? receivable|credit risk|loss of|contracts? with customers)\b/i;

/** A customer mention in a product feature is not a description of who buys it. */
function customerDescriptionRank(sentence: string) {
  if (customerCaveat.test(sentence)) return 0;
  const explicit = sentence.match(customerPredicate);
  const recipient = explicit?.[1] ?? sentence.match(/\b(?:we|the company|our company)\s+(?:(?:primarily|mainly|principally)\s+)?(?:serves?\s+|(?:sells?|provides?|suppl(?:y|ies)|delivers?)\s+.{1,180}?\s+to\s+)(.+)/i)?.[1];
  if (!recipient) return 0;
  const group = recipient.replace(/^(?:(?:primarily|mainly|principally|largely|generally|predominantly)\s+)*(?:in\s+)?/i, "");
  // These predicates describe usage, terms, geography or satisfaction, not a
  // customer population. Retain the original sentence when it does qualify.
  if (group.length < 12 || /^(?:able|using|provided|required|offered|encouraged|expected|invited|eligible|entitled|satisfied|located|based|concentrated|subject|responsible|supported|served|purchasing|important|critical|essential|diverse|highly|intensely|competitive|fragmented|characterized|help|enable|ensure|improve|access|use|store|manage|our\b|their\b|customers?\b|clients?\b|consumers?\s+(?:who|that)\s+(?:use|access))\b/i.test(group)) return 0;
  return explicit ? 2 : 1;
}
export function verifiedCompanyProfile(value: unknown, identity: CompanyIdentity, now = new Date()): VerifiedCompanyProfile | null {
  const p = object(value);
  const ticker = text(identity.ticker).toUpperCase(), cik = profileCik(identity.cik);
  if (!ticker || !cik || !text(identity.company) || p.version !== 1 || p.status !== "verified"
    || p.ticker !== ticker || p.cik !== cik || text(p.company) !== text(identity.company)
    || p.sourceType !== "sec_annual_filing") return null;
  const business = text(p.business), customers = text(p.customers), description = text(p.description);
  const verified = Date.parse(text(p.verifiedAt)), filed = Date.parse(text(p.sourceFiledAt));
  if (!Number.isFinite(verified) || !Number.isFinite(filed) || verified > now.getTime() || filed > verified
    || now.getTime() - verified > 30 * 86400000 || now.getTime() - filed > 550 * 86400000
    || business.length < 60 || customers.length < 40 || description.length > 2400
    || !businessWords.test(business) || !customerDescriptionRank(customers)
    || description !== (business === customers ? business : `${business} ${customers}`)
    || placeholder.test(description)) return null;
  try {
    const url = new URL(text(p.sourceUrl));
    if (url.protocol !== "https:" || url.hostname !== "www.sec.gov" || url.username || url.password || url.search || url.hash
      || !new RegExp(`^/Archives/edgar/data/${Number(cik)}/\\d{18}/[A-Za-z0-9._-]+\\.html?$`).test(url.pathname)) return null;
  } catch { return null; }
  return p as VerifiedCompanyProfile;
}

export function annualBusinessText(html: string, form: string) {
  // HTML source wrapping is whitespace; only block tags define paragraphs.
  // Plain-text source excerpts already supply their own paragraph boundaries.
  const source = /<[a-z][^>]*>/i.test(html) ? html.replace(/\r?\n/g, " ") : html;
  const clean = source.replace(/<(?:script|style|ix:header)\b[^>]*>[\s\S]*?<\/(?:script|style|ix:header)>/gi, " ")
    // Keep block boundaries so an unpunctuated section heading cannot become
    // part of the next factual sentence. Inline spans still join with spaces.
    .replace(/<\/(?:p|div|h[1-6]|li|tr)>|<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " ").replace(/&#(?:160|xA0);|&nbsp;/gi, " ").replace(/&amp;/g, "&")
    .replace(/&quot;|&#34;/g, '"').replace(/&#(?:8217|x2019);|&rsquo;/gi, "’")
    .replace(/&#(?:8211|x2013);/gi, "–").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/[^\S\n]+/g, " ").replace(/\s*\n\s*/g, "\n");
  const start = form === "20-F" ? /\bItem\s+4[.\s:–-]+Information on the Company\b/gi : /\bItem\s+1[.\s:–-]+Business\b/gi;
  const end = form === "20-F" ? /\bItem\s+(?:4A|5)[.\s:–-]/i : /\bItem\s+1[A-B][.\s:–-]/i;
  return [...clean.matchAll(start)].map(match => {
    const rest = clean.slice((match.index ?? 0) + match[0].length);
    const stop = rest.search(end);
    return rest.slice(0, stop >= 0 ? stop : 80000).trim();
  }).filter(section => section.length >= 500).sort((a, b) => b.length - a.length)[0]?.slice(0, 80000) ?? "";
}

/** Select whole source sentences. No generated product or customer claims. */
export function extractCompanyProfile(input: { identity: CompanyIdentity; html: string; form: string; sourceUrl: string; filedAt: string; now: Date }) {
  const section = annualBusinessText(input.html, input.form);
  const sentences = section.split(/\n+/).flatMap(paragraph => paragraph.match(/[^.!?]+(?:[.!?](?=\s+[A-Z“"]|$)|$)/g) ?? [])
    .map(text).filter(sentence => sentence.length >= 40 && sentence.length <= 1100);
  const reject = /forward.looking|risk factors|may not|no assurance|could adversely|table of contents|incorporated by reference|annual report|securities and exchange|not yet|we expect|we believe|we intend/i;
  const useful = sentences.filter(sentence => !reject.test(sentence));
  const business = useful.find(sentence => sentence.length >= 60 && businessWords.test(sentence)
    && (/\b(?:we|our|company|corporation|business)\b/i.test(sentence) || sentence.toLowerCase().includes(text(input.identity.company).toLowerCase())));
  const customers = useful.map(sentence => ({ sentence, rank: customerDescriptionRank(sentence) }))
    .filter(candidate => candidate.rank > 0).sort((a, b) => b.rank - a.rank)[0]?.sentence;
  if (!business || !customers) return null;
  return verifiedCompanyProfile({ version: 1, status: "verified", ticker: text(input.identity.ticker).toUpperCase(), company: text(input.identity.company),
    cik: profileCik(input.identity.cik), business, customers, description: business === customers ? business : `${business} ${customers}`,
    sourceType: "sec_annual_filing", sourceUrl: input.sourceUrl, sourceFiledAt: input.filedAt, verifiedAt: input.now.toISOString() }, input.identity, input.now);
}
