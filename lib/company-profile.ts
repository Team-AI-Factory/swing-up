/** Company descriptions must be extracts from a dated, identity-verified source. */
export const COMPANY_PROFILE_PARSER_REVISION = 3;
export type CompanyIdentity = { ticker?: unknown; company?: unknown; cik?: unknown };
export type VerifiedCompanyProfile = {
  version: 1; status: "verified"; ticker: string; company: string; cik: string;
  business: string; customers: string; description: string;
  industry?: string; industrySourceUrl?: string;
  sourceType: "sec_annual_filing"; sourceUrl: string; sourceFiledAt: string; verifiedAt: string;
};
const object = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const text = (v: unknown) => typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
export const profileCik = (v: unknown) => /^\d{1,10}$/.test(String(v ?? "")) && Number(v) > 0 ? String(v).padStart(10, "0") : null;
const placeholder = /not yet been verified|still being collected|is the listed company|is classified in|company profile.*(?:missing|unavailable)/i;
const customerSubjects = "(?:customers?|clients?|consumers?|patients?|subscribers?|end.users?|end.markets?|markets?|customer base|client base|customer segments?|market segments?)";
const customerPredicate = new RegExp(`^(?:(?:our|the company['’]s|a|an|the)\\s+)?(?:(?:primary|principal|main|largest|target|core)\\s+)?[\"“]?${customerSubjects}[\"”]?\\s+(?:(?:we serve|primarily|mainly|principally|largely|generally|predominantly)\\s+)*(?:include[sd]?|comprise[sd]?|consists? of|range[sd]? from|are|is(?: defined as)?)\\s+(.+)`, "i");
const customerCaveat = /\b(?:no (?:single )?customer|\d+(?:\.\d+)?%|percent|concentration|accounts? receivable|credit risk|loss of|contracts? with customers|none of our business|mainland China|legal (?:entity|structure))\b/i;
const buyerGroups = /\b(?:persons?|people|individuals?|households?|homeowners?|consumers?|patients?|subscribers?|business(?:es)?|enterprises?|companies|corporations?|firms?|organizations?|nonprofits?|governments?|municipalit(?:y|ies)|utilities|institutions?|schools?|universit(?:y|ies)|hospitals?|clinics?|laborator(?:y|ies)|pharmacies|providers?|operators?|manufacturers?|retail(?:ers?| stores?)|wholesalers?|distributors?|merchants?|developers?|contractors?|resellers?|oems?|banks?|insurers?|agencies|authorities|charterers?|shippers?|carriers?|(?:consumer|industrial|commercial|education|enterprise|government|healthcare|automotive|energy|aerospace) (?:markets?|sectors?|industries))\b/i;
const filingBoilerplate = /\b(?:registration statement|(?:initial|proposed|public) offering|ordinary shares|common stock|incorporat(?:ed|ion)|commenced operations|began operations|securities and exchange|securities act|form (?:f|s|8|10)-\d|taking delivery of (?:our|the|its) first)\b/i;
const unresolvedEntity = /&(?:#\d+|#x[\da-f]+|[a-z]+);/i;
function decodeSourceEntities(value: string) {
  return value.replace(/&#(x[\da-f]+|\d+);/gi, (entity, encoded: string) => {
    const code = encoded[0].toLowerCase() === "x" ? parseInt(encoded.slice(1), 16) : parseInt(encoded, 10);
    return code >= 32 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : entity;
  }).replace(/&(nbsp|quot|apos|lsquo|rsquo|ldquo|rdquo|ndash|mdash|reg|copy|trade|lt|gt|amp);/gi, (_, name: string) => ({ nbsp: " ", quot: '"', apos: "'", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", ndash: "–", mdash: "—", reg: "®", copy: "©", trade: "™", lt: "<", gt: ">", amp: "&" })[name.toLowerCase()] ?? _);
}
function issuerSubject(identity: CompanyIdentity) {
  const name = text(identity.company);
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const company = escape(name);
  // A filing may use its issuer's complete brand name without a legal suffix.
  // Do not invent a shortened first-word alias for a multi-word company.
  const brand = name.replace(/,?\s+(?:Inc(?:orporated)?|Corp(?:oration)?|Ltd|Limited|PLC|LLC|L\.P)\.?$/i, "").trim();
  const alias = brand !== name && /^[A-Za-z][A-Za-z0-9’' &.-]+$/.test(brand) && !/^(?:the|company|group|holdings)$/i.test(brand) ? `|${escape(brand)}` : "";
  return `(?:we|the company|our company|our business${company ? `|${company}` : ""}${alias})`;
}
function operatingBusiness(sentence: string, identity: CompanyIdentity) {
  // A list introduction is not the list itself. Continue to a complete source
  // sentence instead of publishing a product-free description as verified.
  if (filingBoilerplate.test(sentence) || unresolvedEntity.test(sentence)
    || /:\s*$/.test(sentence)
    || /\b(?:the following|as follows|listed below|described below)\s*[.:]?$/i.test(sentence)) return false;
  // Match dated context without deleting any words from the retained source.
  const statement = sentence.replace(/^(?:As of (?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4},|With a history dating back to \d{4},)\s+/i, "");
  // Allow an issuer's parenthetical name or legal-form apposition, but require
  // its main predicate to describe operations, not incorporation or financing.
  const subject = `${issuerSubject(identity)}(?:\\s*\\([^)]{0,180}\\))?(?:,\\s*(?:a|an|the)\\s+[^,]{1,100},)?\\s+`;
  const action = "(?:(?:primarily|principally|mainly|currently)\\s+)?(?:manufactures?|designs?|develops?|produces?|provides?|operates?|operated|distributes?|sells?|offers?|delivers?|supplies)\\b";
  const operator = "(?:is|are)\\s+(?:a\\s+|an\\s+|the\\s+)?[^.!?]{0,120}\\b(?:manufacturer|developer|producer|provider|operator|distributor|retailer|supplier|bank|utility|utilities|insurer|underwriter|roaster)\\b";
  if (new RegExp(`^${subject}(?:${action}|${operator})`, "i").test(statement)) return true;
  // Annual reports may use a shorter issuer name (e.g. American Water). Only
  // complete leading identity words directly followed by operations qualify.
  const name = text(identity.company);
  const words = [...name.matchAll(/[A-Za-z][A-Za-z0-9’'-]*/g)];
  return words.slice(1, Math.min(words.length - 1, 4)).some((_, index) => {
    const last = words[index + 1];
    const shortName = name.slice(0, (last.index ?? 0) + last[0].length).replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    return new RegExp(`^${shortName}\\s+(?:${action}|${operator})`, "i").test(statement);
  });
}

/** A customer mention in a product feature is not a description of who buys it. */
function customerDescriptionRank(sentence: string, identity: CompanyIdentity) {
  if (customerCaveat.test(sentence) || filingBoilerplate.test(sentence) || unresolvedEntity.test(sentence)) return 0;
  const explicit = sentence.match(customerPredicate);
  const direct = new RegExp(`^${issuerSubject(identity)}\\s+(?:(?:primarily|mainly|principally)\\s+)?(?:serves?\\s+|(?:sells?|provides?|offers?|suppl(?:y|ies)|delivers?)\\s+.{1,220}?\\s+to\\s+)(.+)`, "i");
  const relationship = /^We have (?:well-established |established |long-standing )?relationships with (.+?), which we serve\b/i;
  const recipient = explicit?.[1] ?? sentence.match(direct)?.[1] ?? sentence.match(relationship)?.[1];
  if (!recipient) return 0;
  const group = recipient.replace(/^(?:(?:primarily|mainly|principally|largely|generally|predominantly)\s+)*(?:in\s+)?/i, "");
  // These predicates describe usage, terms, geography or satisfaction, not a
  // customer population. Retain the original sentence when it does qualify.
  if (group.length < 4 || !buyerGroups.test(group) || /^(?:from|able|likely|using|provided|required|offered|encouraged|expected|invited|eligible|entitled|satisfied|located|based|concentrated|subject|responsible|supported|served|purchasing|important|critical|essential|diverse|highly|intensely|competitive|fragmented|characterized|help|enable|ensure|improve|access|use|store|manage|our\b|their\b|customers?\b|clients?\b|consumers?\s+(?:who|that)\s+(?:use|access))\b/i.test(group)) return 0;
  return explicit ? 2 : 1;
}
export function verifiedCompanyProfile(value: unknown, identity: CompanyIdentity, now = new Date()): VerifiedCompanyProfile | null {
  const p = object(value);
  const ticker = text(identity.ticker).toUpperCase(), cik = profileCik(identity.cik);
  if (!ticker || !cik || !text(identity.company) || p.version !== 1 || p.status !== "verified"
    || p.ticker !== ticker || p.cik !== cik || text(p.company) !== text(identity.company)
    || p.sourceType !== "sec_annual_filing") return null;
  // Decode old cached source extracts before comparing the complete description.
  // Identity, age, provenance and factual predicates still all revalidate below.
  const business = text(decodeSourceEntities(text(p.business))), customers = text(decodeSourceEntities(text(p.customers))), description = text(decodeSourceEntities(text(p.description)));
  const verified = Date.parse(text(p.verifiedAt)), filed = Date.parse(text(p.sourceFiledAt));
  if (!Number.isFinite(verified) || !Number.isFinite(filed) || verified > now.getTime() || filed > verified
    || now.getTime() - verified > 30 * 86400000 || now.getTime() - filed > 550 * 86400000
    || business.length < 60 || customers.length < 25 || description.length > 2400
    || !operatingBusiness(business, identity) || !customerDescriptionRank(customers, identity)
    || description !== (business === customers ? business : `${business} ${customers}`)
    || placeholder.test(description)) return null;
  try {
    const url = new URL(text(p.sourceUrl));
    if (url.protocol !== "https:" || url.hostname !== "www.sec.gov" || url.username || url.password || url.search || url.hash
      || !new RegExp(`^/Archives/edgar/data/${Number(cik)}/\\d{18}/[A-Za-z0-9._-]+\\.html?$`).test(url.pathname)) return null;
  } catch { return null; }
  const industryUrl = `https://data.sec.gov/submissions/CIK${cik}.json`;
  const industry = p.industrySourceUrl === industryUrl && text(p.industry).length >= 3 && text(p.industry).length <= 160
    ? text(p.industry) : undefined;
  const normalized = { ...p, business, customers, description } as VerifiedCompanyProfile;
  if (industry) { normalized.industry = industry; normalized.industrySourceUrl = industryUrl; }
  else { delete normalized.industry; delete normalized.industrySourceUrl; }
  return normalized;
}

export function annualBusinessText(html: string, form: string) {
  // HTML source wrapping is whitespace; only block tags define paragraphs.
  // Plain-text source excerpts already supply their own paragraph boundaries.
  const source = /<[a-z][^>]*>/i.test(html) ? html.replace(/\r?\n/g, " ") : html;
  const clean = decodeSourceEntities(source.replace(/<(?:script|style|ix:header)\b[^>]*>[\s\S]*?<\/(?:script|style|ix:header)>/gi, " ")
    // Keep block boundaries so an unpunctuated section heading cannot become
    // part of the next factual sentence. Inline spans still join with spaces.
    .replace(/<\/(?:p|div|h[1-6]|li|tr)>|<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
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
  const sentences = section.split(/\n+/).flatMap(paragraph => paragraph
    .replace(/\b(?:Inc|Corp|Co|Ltd|L\.P|L\.L\.C|U\.S|U\.K)\./gi, abbreviation => abbreviation.replace(/\./g, "\uE000"))
    .split(/(?<=[.!?])\s+(?=[A-Z“"])/).map(sentence => sentence.replace(/\uE000/g, ".")))
    .map(text).filter(sentence => sentence.length >= 25 && sentence.length <= 1100);
  const reject = /forward.looking|risk factors|may not|no assurance|could adversely|table of contents|incorporated by reference|annual report|securities and exchange|not yet|we expect|we believe|we intend/i;
  const useful = sentences.filter(sentence => !reject.test(sentence));
  const business = useful.find(sentence => sentence.length >= 60 && operatingBusiness(sentence, input.identity));
  const customers = useful.map(sentence => ({ sentence, rank: customerDescriptionRank(sentence, input.identity) }))
    .filter(candidate => candidate.rank > 0).sort((a, b) => b.rank - a.rank)[0]?.sentence;
  if (!business || !customers) return null;
  return verifiedCompanyProfile({ version: 1, status: "verified", ticker: text(input.identity.ticker).toUpperCase(), company: text(input.identity.company),
    cik: profileCik(input.identity.cik), business, customers, description: business === customers ? business : `${business} ${customers}`,
    sourceType: "sec_annual_filing", sourceUrl: input.sourceUrl, sourceFiledAt: input.filedAt, verifiedAt: input.now.toISOString() }, input.identity, input.now);
}
