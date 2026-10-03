import { extractFinancialNoteCustomerEvidence, verifiedFinancialNoteCustomerEvidence, type FinancialNoteCustomerEvidence } from "@/lib/company-profile-financial-customer-source";
import { annualInformationFormBusinessText, secAnnualFilingIndexUrl } from "@/lib/company-profile-annual-source";
import { extractRevenueGeography, revenueGeographyFromQuote, type RevenueGeography } from "@/lib/company-revenue-geography";
/** Company descriptions must be extracts from a dated, identity-verified source. */
export const COMPANY_PROFILE_PARSER_REVISION = 11;
export type CompanyIdentity = { ticker?: unknown; company?: unknown; cik?: unknown };
export type VerifiedCompanyProfile = {
  version: 1; status: "verified"; ticker: string; company: string; cik: string;
  business: string; customers: string; description: string;
  customerType?: "accounts_receivable_customer_pools" | "revenue_contract_counterparties"; customerEvidence?: FinancialNoteCustomerEvidence;
  revenueGeography?: RevenueGeography;
  industry?: string; industrySourceUrl?: string;
  sourceForm?: "10-K" | "20-F" | "40-F"; annualFilingUrl?: string; annualFilingIndexUrl?: string;
  sourceType: "sec_annual_filing"; sourceUrl: string; sourceFiledAt: string; verifiedAt: string;
};
const object = (v: unknown): Record<string, unknown> => v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {};
const text = (v: unknown) => typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "";
export function sameCompanyName(left: unknown, right: unknown) {
  const normalize = (value: unknown) => text(value).toLowerCase()
    // SEC issuer display names may append this legal-jurisdiction marker.
    // Preserve the complete legal name; never strip arbitrary slash aliases.
    .replace(/(\b(?:incorporated|inc|corporation|corp|limited|ltd|plc|llc)\.?)\s+\/de\/$/, "$1")
    .replace(/\s+(?:[-–]\s*)?class\s+[a-z]\b.*$/, "")
    .replace(/[.,]/g, "").replace(/\s+(?:incorporated|inc|corporation|corp|limited|ltd|plc|llc)$/, "")
    .replace(/\s+/g, " ").trim();
  return Boolean(normalize(left)) && normalize(left) === normalize(right);
}
export const profileCik = (v: unknown) => /^\d{1,10}$/.test(String(v ?? "")) && Number(v) > 0 ? String(v).padStart(10, "0") : null;
const placeholder = /not yet been verified|still being collected|is the listed company|is classified in|company profile.*(?:missing|unavailable)/i;
const customerSubjects = "(?:customers?|clients?|consumers?|patients?|subscribers?|end.users?|end.markets?|markets?|customer base|client base|customer segments?|market segments?)";
const customerPredicate = new RegExp(`^(?:(?:our|the company['’]s|a|an|the)\\s+)?(?:(?:primary|principal|main|largest|target|core|professional|DIY|current|diverse)\\s+)?[\"“]?${customerSubjects}[\"”]?\\s+(?:(?:we serve|primarily|mainly|principally|largely|generally|predominantly)\\s+)*(?:include[sd]?|comprise[sd]?|consists? of|range[sd]? from|are|is(?: defined as)?)\\s+(.+)`, "i");
const airCarrierService = /^(?:Together with our [^.]{1,300}, )?our primary business activity is the operation of (?:a|an) [^.!?]{1,100}air carrier, providing scheduled air transportation for passengers(?: and cargo)?\b/i;
const commercialPartnerPopulation = /^We have (?:extensive )?experience partnering with (.+?)\. Our partnership agreements(?: to date)? have (?:commonly )?included: .+near-term payments for access, research, and intellectual property rights.+royalties on net sales of drugs[.!]?$/i;
const customerCaveat = /\b(?:no (?:single )?customer|\d+(?:\.\d+)?%|percent|concentration|accounts? receivable|credit risk|loss of|contracts? with customers|none of our business|mainland China|legal (?:entity|structure))\b/i;
const buyerGroups = /\b(?:persons?|people|individuals?|households?|homeowners?|consumers?|patients?|subscribers?|business(?:es)?|enterprises?|companies|corporations?|dealers?|firms?|organizations?|nonprofits?|governments?|municipalit(?:y|ies)|utilities|institutions?|schools?|universit(?:y|ies)|hospitals?|clinics?|garages?|service stations?|(?:auto(?:mobile)? )?dealerships?|laborator(?:y|ies)|pharmacies|providers?|operators?|manufacturers?|retail(?:ers?| stores?)|wholesalers?|distributors?|merchants?|developers?|contractors?|resellers?|oems?|odms?|banks?|insurers?|agencies|authorities|charterers?|shippers?|carriers?|(?:consumer|industrial|commercial|education|enterprise|government|healthcare|automotive|energy|aerospace) (?:markets?|sectors?|industries))\b/i;
const purposeInfinitive = /^(?:(?:better|fully|more accurately|more effectively|successfully|effectively|efficiently|rapidly|quickly)\s+)*(?:study|assess|analy[sz]e|identify|address|meet|support|help|enable|ensure|improve|enhance|facilitate|create|build|develop|provide|deliver|generate|increase|reduce|achieve|fulfil+l?|perform|determine|offer|benefit|manage|alert|prevent|protect|optimi[sz]e|maintain|expand|promote|understand|evaluate|implement|integrate|connect|drive|detect|track|monitor|process|collect|transform|leverage|empower|automate|streamline|forecast|quantify)\b/i;
const unresolvedRobotContext = /\b(?:competitor|third[- ]party|their robots|another company|other companies|supplier|customer[- ]owned)\b/i;
const filingBoilerplate = /\b(?:registration statement|investment company act|(?:initial|proposed|public) offering|ordinary shares|common stock|incorporat(?:ed|ion)|commenced operations|began operations|securities and exchange|securities act|form (?:f|s|8|10)-\d|taking delivery of (?:our|the|its) first)\b/i;
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
  // A filing may use its issuer's complete brand name without a legal suffix.
  // Do not invent a shortened first-word alias for a multi-word company.
  const brand = name.replace(/,?\s+(?:Inc(?:orporated)?|Corp(?:oration)?|Ltd|Limited|PLC|LLC|L\.P)\.?$/i, "").trim();
  const legal = name.slice(brand.length).replace(/^[,\s]+|\.$/g, "");
  const suffix = /^(?:Corp|Corporation)$/i.test(legal) ? "Corp(?:oration)?"
    : /^(?:Inc|Incorporated)$/i.test(legal) ? "Inc(?:orporated)?"
    : /^(?:Ltd|Limited)$/i.test(legal) ? "(?:Ltd|Limited)" : escape(legal);
  // Only equivalent legal forms of the exact full issuer name qualify.
  const company = brand !== name ? `${escape(brand)},?\\s+${suffix}\\.?` : escape(name);
  const alias = brand !== name && /^[A-Za-z][A-Za-z0-9’' &.-]+$/.test(brand) && !/^(?:the|company|group|holdings)$/i.test(brand) ? `|${escape(brand)}` : "";
  return `(?:we|the company|our company|our business${company ? `|${company}` : ""}${alias})`;
}
function operatingBusiness(sentence: string, identity: CompanyIdentity) {
  // A list introduction is not the list itself. Continue to a complete source
  // sentence instead of publishing a product-free description as verified.
  if (filingBoilerplate.test(sentence) || unresolvedEntity.test(sentence)
    || /:\s*$/.test(sentence)
    || /\b(?:the following|as follows|listed below|described below)\s*[.:]?$/i.test(sentence)) return false;
  if (/\b(?:to|for)\s+(?:our|its|the company['’]s)\s+(?:employees|staff|team members)(?:\s+and\s+their\s+families)?\b/i.test(sentence)) return false;
  if (airCarrierService.test(sentence)) return true;
  if (/^We are (?:a|an) (?:(?:U[.]S[.]-based|[A-Za-z-]+)\s+){0,8}technology company (?:developing(?: and offering)?|offering) .{0,160}\b(?:software|semiconductors?|robotic systems|artificial intelligence)\b/i.test(sentence)) return true;
  if (/^(?:We|The Company) (?:design|designs|sell|sells|provide|provides|operate|operates) (?:our|the|its) (?:products|systems|solutions)\s+(?:to|with|through)\b/i.test(sentence)) return false;
  if (/^Our activities include .{0,100}\b(?:deployment|operation) of .{0,80}\b(?:robotic systems|medical devices|semiconductor systems)\b/i.test(sentence)) return true;
  if (/^We are (?:(?:currently|also) )?developing .{5,180}\b(?:inhibitors?|drugs?|medicines?|therapeutics?|vaccines)\b/i.test(sentence)) return true;
  if (/^(?:We|The Company) develop(?:s)? our .{0,70}business through a combination of organic growth and acquisitions[.!]?$/i.test(sentence)) return false;
  if (/^Our business model centers on licensing our (?:IP|software|technology)\b.{10,180}\bto\b/i.test(sentence)) return true;
  if (/^Our primary product offering is (?:our|a|the)\s+.{0,100}\b(?:software|operating system|platform|semiconductor|devices?)\b/i.test(sentence)) return true;
  if (/^Our (?:software |AI |technology )?platform (?:applies|uses) (?:AI|artificial intelligence) to .{10,160}\b(?:loans?|credit|data|drug|molecules?)\b/i.test(sentence)) return true;
  if (/^We are (?:a|an) [^.!?]{0,80}technology company that (?:deploys|develops|provides) [^.!?]{0,160}\b(?:data science|software|semiconductors?|artificial intelligence|AI-powered technology)\b/i.test(sentence)) return true;
  if (/^We are engaged in developing technologies intended to enable [^.!?]{0,120}\b(?:robotic solutions|semiconductor systems|medical devices)\b/i.test(sentence)) return true;
  if (/^We are using our platform to develop a pipeline of (?:assets|drug candidates)\b.{0,300}\b(?:GPCRs|ion channels|T-cell engagers|antibody medicines)\b/i.test(sentence)) return true;
  // Match dated context without deleting any words from the retained source.
  const statement = sentence.replace(/^(?:As of (?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4},|With a history dating back to \d{4},|Within our reportable segments,|In aggregate,|In addition,)\s+/i, "");
  // A product portfolio can identify the business more precisely than a
  // generic sentence about operating facilities. Keep the whole source text.
  if (/^Our product portfolio\b.{10,220}\b(?:includes?|comprises?|is based on)\s+.{20,}/i.test(statement)
    && !/\b(?:broad|wide|comprehensive|diverse) (?:range|variety|selection) of products and services\b/i.test(statement)) return true;
  if (/^(?:we|the company)\s+(?:also\s+)?(?:manufacture|manufactures|sell|sells|provide|provides|offer|offers)\s+(?:(?:our|its|the) )?products\b/i.test(statement)) return false;
  if (/^(?:we|the company)\s+(?:also\s+)?(?:offer|offers|provide|provides|deliver|delivers)\s+(?:our )?customers?\s+(?:(?:a|an|the|our)\s+)?(?:competitive|differentiated|quality|superior|exceptional|innovative|valuable|high-quality)\b/i.test(statement)) return false;
  // Allow an issuer's parenthetical name or legal-form apposition, but require
  // its main predicate to describe operations, not incorporation or financing.
  const subject = `${issuerSubject(identity)}(?:\\s*\\([^)]{0,180}\\))?(?:,\\s*(?:a|an|the)\\s+(?:[^(),]|\\([^)]{0,180}\\)){1,180},)?\\s+`;
  if (new RegExp(`^${subject}(?:is|are)\\s+(?:a|an)\\s+(?:(?:clinical|preclinical|development|commercial)[- ]stage\\s+)?(?:biopharmaceutical|biotechnology|pharmaceutical|medical device)\\s+compan(?:y|ies)\\b.{0,160}\\b(?:developing|development|discovery|discovering|treatments|therapies|therapeutics|vaccines|medicines)\\b`, "i").test(statement)) return true;
  if (new RegExp(`^${subject}(?:sell|sells)\\s+to\\b`, "i").test(statement)) return false;
  const action = "(?:(?:also|primarily|principally|mainly|currently)\\s+)?(?:manufactures?|designs?|develops?|produces?|provides?|operates?|operated|distributes?|sells?|offers?|delivers?|supplies)\\b";
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
  // Pre-commercial issuers cannot name a buyer population that does not yet
  // exist. Preserve their explicit source statement about product revenue.
  if (new RegExp(`^${issuerSubject(identity)}\\s+have\\s+(?:(?:not(?: yet)? generated (?:any )?revenue from (?:product sales|the sale of (?:our )?products))|(?:no (?:approved|commercially available) products.{0,100}have not generated (?:any )?revenue from product sales))[.!]?$`, "i").test(sentence)) return 1;
  // A stated recipient of a commercial service is a customer population;
  // named buyers and a geography-only passenger count are not required.
  if (airCarrierService.test(sentence)) return 1;
  // Partner categories need adjacent, explicit commercial payment terms.
  // A generic collaboration or a supplier payment cannot satisfy this path.
  const commercialPartners = sentence.match(commercialPartnerPopulation)?.[1];
  if (commercialPartners && buyerGroups.test(commercialPartners) && !/\b(?:we pay|payments by us|we owe|donat|grant|supplier|investor)/i.test(sentence)) return 1;
  const paidPharmaPartners = sentence.match(/^Through our partnerships with (?:leading )?(pharmaceutical companies .{1,250}), we have (?:secured|received) (?:more than |over )?\$[\d,.]+ (?:million|billion) in (?:upfront and (?:progress-based )?milestone|upfront) payments to date(?:,|\.)/i);
  if (paidPharmaPartners && !/\b(?:we pay|payments by us|we owe|equity financing|debt financing|grants?|suppliers?|hypothetical|conditional|not received|non-binding)\b/i.test(sentence)) return 2;
  const robotOrders = sentence.match(/^Our robots start each day .{1,850}[.] Throughout the day, each robot receives a series of delivery orders from (.+)[.]$/i)?.[1];
  if (robotOrders && !unresolvedRobotContext.test(sentence) && /^(?:partnered )?merchants and delivery platforms$/i.test(robotOrders)) return 2;
  const grownCustomers = sentence.match(/^(?:We (?:have )?built this platform .{1,150} and )?we have (?:grown|expanded) our customer base to include (.+)/i)?.[1];
  if (grownCustomers && buyerGroups.test(grownCustomers) && !/\b(?:potential|prospective|target|hypothetical|projections?|forecast|planned|future)\b/i.test(grownCustomers)) return 2;
  const explicitRelationships = sentence.match(/^(?:The majority of our employees are [\w-]+ and many operate alongside their customers daily, )?we have (?:deep trusting|long-standing|established) relationships with (?:unique and discerning )?customers in (.+)/i)?.[1];
  if (explicitRelationships && /\b(?:governments?|government agencies|hospitals?|banks?|manufacturing companies)\b/i.test(explicitRelationships)) return 2;
  const explicit = sentence.match(customerPredicate);
  const currentMarket = sentence.match(/^Our customers operate in (?:diverse |various )?markets, (?:such as|including) (.+)/i)?.[1];
  if (currentMarket && /^(?:manufacturing|automotive(?: manufacturing)?|wholesale(?: and retail)?|retail|food(?: and grocery distribution)?|pharmaceutical(?: and medical distribution)?|medical|construction|mining|utilities|aerospace|vehicle rental|logistics|shipping|transportation|energy|field services)(?=,| and |[.]?$)/i.test(currentMarket)) return 2;
  // These statements explicitly identify a commercial population, rather than
  // inferring one from product usage, partnership names or financing alone.
  const licensedPopulation = sentence.match(/^Our business model centers on licensing our (?:IP|software|technology)\b.{1,220}?\s+to\s+(.+)/i)?.[1]
    ?? sentence.match(/^Our (?:software(?: platform)?|IP(?: platforms?)?|technolog(?:y|ies)) (?:is|are) licensed by (.+)/i)?.[1]
    ?? sentence.match(/^We have licensed our (?:IP|software|technology) to (.+)/i)?.[1];
  const servedCustomerTypes = sentence.match(/^We (?:typically )?fulfill the needs of our (.+?) customers through (?:direct relationships|select distributors)/i)?.[1];
  const feePayers = sentence.match(/^Our revenue consists (?:primarily |mainly )?of fees paid by (.+)/i)?.[1];
  const insurancePayors = sentence.match(/^Our revenue is derived from a (?:diverse )?mix of payors, including (.+)/i)?.[1];
  if (insurancePayors && /\b(?:commercial insurance|managed care|government) payors\b/i.test(insurancePayors)) return 2;
  if (feePayers && /^(?:lending partners|institutional investors)(?= and |,|[.]?$)/i.test(feePayers)
    && !/\b(?:equity securities|stockholders|shareholders|financing|capital contributions|potential|prospective)\b/i.test(feePayers)) return 2;
  const receivingIssuer = /\b(?:to us|for our (?:own )?internal use|for (?:our )?internal administrative use|for our own use|without receiving any license fees|free of charge)\b/i;
  const licensedBuyerStart = /^(?:(?:hundreds|thousands) of )?(?:(?:semiconductor|original equipment|biopharmaceutical|pharmaceutical|industrial|academic|government|medical|research|commercial|technology|software|hardware|and)\s+){0,8}(?:companies|manufacturers?|OEMs?|ODMs?|customers?|institutions?|laboratories|universities|banks?|hospitals?|retailers?)\b/i;
  if (licensedPopulation && licensedBuyerStart.test(licensedPopulation) && !receivingIssuer.test(licensedPopulation)
    && !/\b(?:potential|prospective|target|hypothetical)\b/i.test(licensedPopulation)) return 2;
  const explicitCommercialPopulation = servedCustomerTypes ?? feePayers;
  if (explicitCommercialPopulation && buyerGroups.test(explicitCommercialPopulation)
    && !/\b(?:to us|for our (?:own )?internal use|for (?:our )?internal administrative use|for our own use|without receiving any license fees|free of charge)\b/i.test(explicitCommercialPopulation)
    && !purposeInfinitive.test(explicitCommercialPopulation) && !/\b(?:potential|prospective|target)\b/i.test(explicitCommercialPopulation)
    && !/^(?:no|none|not|neither|without|our|their|able|using|located|based|customers?|clients?)\b/i.test(explicitCommercialPopulation)) return 2;
  const direct = new RegExp(`^${issuerSubject(identity)}\\s+(?:(?:primarily|mainly|principally)\\s+)?(?:serves?\\s+|(?:sells?|provides?|offers?|suppl(?:y|ies)|delivers?)\\s+(?:.{1,220}?\\s+)?to\\s+)(.+)`, "i");
  const relationship = /^We have (?:well-established |established |long-standing )?relationships with (.+?), which we serve\b/i;
  const passiveProducts = /^Our (?:[\w-]+\s+){0,5}(?:products(?: and services)?|services(?: and products)?)\s+are\s+(?:also\s+)?(?:sold|offered|distributed|marketed|supplied)\s+(?:primarily\s+)?(?:through|to)\s+(.+)/i;
  const providerMarkets = new RegExp(`^${issuerSubject(identity)}\\s+(?:is|are)\\s+.{0,100}\\b(?:provider|supplier|manufacturer|distributor)\\b.{0,150}\\bto\\s+customers\\s+in\\s+(.+)`, "i");
  // "For" can explicitly name the commercial service recipient. Require an
  // already-valid issuer operating statement and a concrete population at the
  // start, not a later usage/benefit/geography mention containing a buyer word.
  const forMatch = operatingBusiness(sentence, identity)
    ? sentence.match(/^[^.!?]{0,160}\b(?:provides?|offers?|supplies)\s+.{1,220}?\s+for\s+(.+)/i) : null;
  const forPrefix = forMatch ? forMatch[0].slice(0, forMatch[0].length - forMatch[1].length) : "";
  const earlierPurpose = forPrefix.match(/\bto\s+(.+)/i)?.[1];
  const forValue = earlierPurpose && purposeInfinitive.test(earlierPurpose) ? undefined : forMatch?.[1];
  const forGroup = forValue?.replace(/^our\s+(?=dealers?\b)/i, "");
  const explicitForPopulation = forGroup && /^(?:(?:small|medium|mid-sized|large|commercial|industrial|retail|corporate|financial|asset|wealth|management|automotive|healthcare|education|government|energy|technology|non-profit|and|or)\s+){0,8}(?:organizations?|dealers?|firms?|businesses|enterprises?|companies|corporations?|institutions?|schools?|universities|hospitals?|clinics?|providers?|operators?|manufacturers?|retailers?|wholesalers?|distributors?|developers?|contractors?|banks?|insurers?|agencies)\b/i.test(forGroup) ? forGroup : undefined;
  const contextual = sentence.replace(/^Within our reportable segments,\s*/i, "");
  const directMatch = contextual.match(direct);
  const directPrefix = directMatch ? directMatch[0].slice(0, directMatch[0].length - directMatch[1].length) : "";
  // A purpose infinitive ("to study ... a business solution") does not
  // name a buyer, even when its later words contain a population noun.
  const directPopulation = directMatch && !/\b(?:access|exposure|proximity|introductions?)\s+to\s*$/i.test(directPrefix)
    && !purposeInfinitive.test(directMatch[1]) ? directMatch[1] : undefined;
  const recipient = explicit?.[1] ?? explicitForPopulation ?? directPopulation ?? sentence.match(relationship)?.[1]
    ?? sentence.match(passiveProducts)?.[1] ?? sentence.match(providerMarkets)?.[1];
  if (!recipient) return 0;
  // Some retailers define professional buyers by the businesses receiving
  // products. Keep the full source sentence, and inspect its explicit named
  // buyer groups rather than treating a generic "customers" word as evidence.
  const businessBuyers = recipient.match(/^customers for whom (?:we|the company) (?:deliver|delivers|supply|supplies) (?:our |its )?products to their places of business, including (.+)$/i)?.[1];
  const group = (businessBuyers ?? recipient).replace(/^(?:(?:primarily|mainly|principally|largely|generally|predominantly)\s+)*(?:customers\s+in\s+|in\s+)?/i, "");
  const namedIndustries = /\b(?:biopharma(?:ceutical)?|healthcare|education|government|automotive|aerospace|semiconductor|telecommunications|data center|cloud|industrial|energy|consumer|applied materials)\b/i.test(group)
    && /\b(?:markets?|industries|sectors?)\b/i.test(group);
  // These predicates describe usage, terms, geography or satisfaction, not a
  // customer population. Retain the original sentence when it does qualify.
  if (group.length < 4 || (!buyerGroups.test(group) && !namedIndustries) || /^(?:from|able|likely|using|provided|required|offered|encouraged|expected|invited|eligible|entitled|satisfied|located|based|concentrated|subject|responsible|supported|served|purchasing|important|critical|essential|diverse|highly|intensely|competitive|fragmented|characterized|help|enable|ensure|improve|access|use|store|manage|our\b|their\b|customers?\b|clients?\b|consumers?\s+(?:who|that)\s+(?:use|access))\b/i.test(group)) return 0;
  return explicit ? 2 : 1;
}
export function verifiedCompanyProfile(value: unknown, identity: CompanyIdentity, now = new Date()): VerifiedCompanyProfile | null {
  const p = object(value);
  const ticker = text(identity.ticker).toUpperCase(), cik = profileCik(identity.cik);
  if (!ticker || !cik || !text(identity.company) || p.version !== 1 || p.status !== "verified"
    || p.ticker !== ticker || p.cik !== cik || !sameCompanyName(p.company, identity.company)
    || p.sourceType !== "sec_annual_filing") return null;
  // Decode old cached source extracts before comparing the complete description.
  // Identity, age, provenance and factual predicates still all revalidate below.
  const business = text(decodeSourceEntities(text(p.business))), customers = text(decodeSourceEntities(text(p.customers))), description = text(decodeSourceEntities(text(p.description)));
  const customerEvidence = verifiedFinancialNoteCustomerEvidence(p.customerEvidence, { identity: { cik, ticker, company: text(identity.company) },
    form: text(p.sourceForm), sourceUrl: text(p.sourceUrl), filedAt: text(p.sourceFiledAt), now });
  const evidenceType = customerEvidence?.section === "financial_notes_accounts_receivable" ? "accounts_receivable_customer_pools" : "revenue_contract_counterparties";
  if ((p.customerEvidence != null || p.customerType != null) && (!customerEvidence || p.customerType !== evidenceType || customerEvidence.quote !== customers)) return null;
  const verified = Date.parse(text(p.verifiedAt)), filed = Date.parse(text(p.sourceFiledAt));
  if (!Number.isFinite(verified) || !Number.isFinite(filed) || verified > now.getTime() || filed > verified
    || now.getTime() - verified > 30 * 86400000 || now.getTime() - filed > 550 * 86400000
    || business.length < 60 || customers.length < 25 || description.length > 2400
    || !operatingBusiness(business, { ...identity, company: p.company }) || (!customerDescriptionRank(customers, { ...identity, company: p.company }) && !customerEvidence)
    || description !== (business === customers ? business : `${business} ${customers}`)
    || placeholder.test(description)) return null;
  try {
    const url = new URL(text(p.sourceUrl));
    if (url.protocol !== "https:" || url.hostname !== "www.sec.gov" || url.username || url.password || url.search || url.hash
      || !new RegExp(`^/Archives/edgar/data/${Number(cik)}/\\d{18}/[A-Za-z0-9._-]+\\.html?$`).test(url.pathname)) return null;
  } catch { return null; }
  if (p.sourceForm === "40-F") {
    const cover = text(p.annualFilingUrl), index = text(p.annualFilingIndexUrl);
    if (!cover || cover === text(p.sourceUrl) || secAnnualFilingIndexUrl(cover, cik) !== index
      || secAnnualFilingIndexUrl(text(p.sourceUrl), cik) !== index) return null;
  }
  const industryUrl = `https://data.sec.gov/submissions/CIK${cik}.json`;
  const industry = p.industrySourceUrl === industryUrl && text(p.industry).length >= 3 && text(p.industry).length <= 160
    ? text(p.industry) : undefined;
  const normalized = { ...p, business, customers, description } as VerifiedCompanyProfile;
  if (customerEvidence) { normalized.customerEvidence = customerEvidence; normalized.customerType = evidenceType; }
  else { delete normalized.customerEvidence; delete normalized.customerType; }
  if (industry) { normalized.industry = industry; normalized.industrySourceUrl = industryUrl; }
  else { delete normalized.industry; delete normalized.industrySourceUrl; }
  const geography = revenueGeographyFromQuote(object(p.revenueGeography).quote, text(p.sourceFiledAt));
  if (geography) normalized.revenueGeography = geography;
  else delete normalized.revenueGeography;
  return normalized;
}

export function annualBusinessText(html: string, form: string) {
  if (form === "40-F") return annualInformationFormBusinessText(html);
  // HTML source wrapping is whitespace; only block tags define paragraphs.
  // Plain-text source excerpts already supply their own paragraph boundaries.
  const source = /<[a-z][^>]*>/i.test(html) ? html.replace(/\r?\n/g, " ") : html;
  // Inline tags do not insert whitespace in rendered text. Retain literal
  // source spaces, but do not turn Bus</span><span>iness into "Bus iness".
  // Block/table tags keep their existing paragraph or separating boundaries.
  const inlineJoined = source.replace(/<\/?(?:span|b|strong|em|i|u|font|a|ix:nonNumeric|ix:nonFraction)\b[^>]*>/gi, "");
  const clean = decodeSourceEntities(inlineJoined.replace(/<(?:script|style|ix:header)\b[^>]*>[\s\S]*?<\/(?:script|style|ix:header)>/gi, " ")
    .replace(/<li\b[^>]*>/gi, "\n• ")
    // Keep block boundaries so an unpunctuated section heading cannot become
    // part of the next factual sentence. Inline spans still join with spaces.
    .replace(/<\/(?:p|div|h[1-6]|li|tr)>|<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]+>/g, " "))
    .replace(/[^\S\n]+/g, " ").replace(/\s*\n\s*/g, "\n");
  // A section heading must occupy its own line. In-text cross-references in
  // later Risk Factors can otherwise win the longest-match selection.
  const start = form === "20-F" ? /^[ \t]*Item[ \t]+4[.\s:–-]+Information on the Company[.: \t]*(?=\n|$)/gim
    : /^[ \t]*Item[ \t]+1[.\s:–-]+Business[.: \t]*(?=\n|$)/gim;
  const end = form === "20-F" ? /^[ \t]*Item[ \t]+(?:4A|5)[.\s:–-]/im : /^[ \t]*Item[ \t]+1[A-B][.\s:–-]/im;
  return [...clean.matchAll(start)].map(match => {
    const rest = clean.slice((match.index ?? 0) + match[0].length);
    const stop = rest.search(end);
    return rest.slice(0, stop >= 0 ? stop : 80000).trim();
  }).filter(section => section.length >= 500).sort((a, b) => b.length - a.length)[0]?.slice(0, 80000) ?? "";
}

/** Select whole source sentences. No generated product or customer claims. */
type ProfileExtractionInput = { identity: CompanyIdentity; html: string; form: string; sourceUrl: string; filedAt: string; now: Date; annualFilingUrl?: string; annualFilingIndexUrl?: string; customerEvidence?: unknown };
export function inspectCompanyProfileExtraction(input: ProfileExtractionInput) {
  const section = annualBusinessText(input.html, input.form);
  if (!section) return { profile: null, reason: "company_profile_business_section_missing" };
  const paragraphs = section.split(/\n+/);
  // Join only actual adjacent list items after a customer-list introduction.
  // An empty heading still fails; preserve every word of the source list.
  const sourceParagraphs = paragraphs.map((paragraph, index) => {
    const customerList = /^(?:Our |The company's )?(?:primary |principal |main )?(?:customers|clients|end markets)\s+(?:include|comprise|are|consist of)(?: the following)?\s*:\s*$/i.test(paragraph);
    const businessList = new RegExp(`^${issuerSubject(input.identity)}\\s+(?:provides?|offers?|manufactures?|sells?)\\s+.{0,150}(?:the following|as follows|lines of business)\\s*:\\s*$`, "i").test(paragraph);
    if (!customerList && !businessList) return paragraph;
    const items: string[] = [];
    for (const next of paragraphs.slice(index + 1, index + 9)) {
      if (!/^(?:[•●▪‣-]|\(?[a-z0-9]{1,2}[.)])\s+/i.test(next) || next.length > 180) break;
      items.push(next);
    }
    return items.length ? [paragraph.replace(/:\s*$/, " :"), ...items].join(" ") : paragraph;
  });
  const commercialPartnerQuotes = paragraphs.flatMap((paragraph, index) => {
    if (!/^We have (?:extensive )?experience partnering with .+[.]$/.test(paragraph)) return [];
    const next = paragraphs[index + 1] ?? "";
    if (!/^Our partnership agreements(?: to date)? have (?:commonly )?included:/.test(next)) return [];
    const paymentSentence = next.split(/(?<=[.!?])\s+(?=[A-Z“"])/)[0];
    const quote = `${paragraph} ${paymentSentence}`;
    return commercialPartnerPopulation.test(quote) ? [quote] : [];
  });
  const robotOrderQuotes = paragraphs.flatMap((paragraph, index) => {
    if (!/^Our robots start each day /.test(paragraph) || unresolvedRobotContext.test(paragraph)) return [];
    const next = paragraphs[index + 1] ?? "";
    const order = next.match(/^Throughout the day, each robot receives a series of delivery orders from [^.]+[.]/)?.[0];
    return order ? [`${paragraph} ${order}`] : [];
  });
  const sentences = [...sourceParagraphs.flatMap(paragraph => paragraph
    .replace(/\b(?:Inc|Corp|Co|Ltd|L\.P|L\.L\.C|U\.S|U\.K)\./gi, abbreviation => abbreviation.replace(/\./g, "\uE000"))
    .split(/(?<=[.!?])\s+(?=[A-Z“"])/).map(sentence => sentence.replace(/\uE000/g, ".")))
    .map(text), ...commercialPartnerQuotes, ...robotOrderQuotes].filter(sentence => sentence.length >= 25 && sentence.length <= 1100);
  const reject = /forward.looking|risk factors|may not|no assurance|could adversely|table of contents|incorporated by reference|annual report|securities and exchange|we expect|we believe|we intend/i;
  const useful = sentences.filter(sentence => !reject.test(sentence));
  const business = useful.filter(sentence => sentence.length >= 60 && operatingBusiness(sentence, input.identity))
    .map(sentence => ({ sentence, rank: /^Our (?:product portfolio|primary product offering|business model|activities include)/i.test(sentence) ? 3
      : /^We also offer\b/i.test(sentence) ? 0
      : /\b(?:sell|sells|design|designs|develop|develops|manufacture|manufactures|offer|offers)\b/i.test(sentence) ? 2 : 1 }))
    .sort((a, b) => b.rank - a.rank)[0]?.sentence;
  const businessCustomers = useful.map(sentence => ({ sentence, rank: customerDescriptionRank(sentence, input.identity) }))
    .filter(candidate => candidate.rank > 0).sort((a, b) => b.rank - a.rank)[0]?.sentence;
  // A separately proven financial-note quote must retain its real section and
  // report period. It is never promoted by the Business-section predicates.
  const financialInput = { ...input, identity: { cik: profileCik(input.identity.cik) ?? "", ticker: text(input.identity.ticker), company: text(input.identity.company) } };
  const customerEvidence = business && !businessCustomers
    ? verifiedFinancialNoteCustomerEvidence(input.customerEvidence, financialInput) ?? extractFinancialNoteCustomerEvidence(financialInput) : null;
  const customers = businessCustomers ?? customerEvidence?.quote;
  if (!business || !customers) return { profile: null, reason: !business && !customers ? "company_profile_business_and_customers_not_extracted"
    : !business ? "company_profile_business_not_extracted" : "company_profile_customers_not_extracted" };
  const profile = verifiedCompanyProfile({ version: 1, status: "verified", ticker: text(input.identity.ticker).toUpperCase(), company: text(input.identity.company),
    cik: profileCik(input.identity.cik), business, customers,
    ...(customerEvidence ? { customerEvidence, customerType: customerEvidence.section === "financial_notes_accounts_receivable" ? "accounts_receivable_customer_pools" : "revenue_contract_counterparties" } : {}), revenueGeography: extractRevenueGeography(input.html, input.filedAt), description: business === customers ? business : `${business} ${customers}`,
    sourceType: "sec_annual_filing", sourceForm: input.form, annualFilingUrl: input.annualFilingUrl, annualFilingIndexUrl: input.annualFilingIndexUrl, sourceUrl: input.sourceUrl, sourceFiledAt: input.filedAt, verifiedAt: input.now.toISOString() }, input.identity, input.now);
  return { profile, reason: profile ? null : "company_profile_identity_or_freshness_invalid" };
}

/** Select whole source sentences. No generated product or customer claims. */
export function extractCompanyProfile(input: ProfileExtractionInput) {
  return inspectCompanyProfileExtraction(input).profile;
}
