/** This narrowly supported customer clause needs its adjacent source context.
 * Evidence is retained from trusted source bytes/private cache, not authenticated
 * by this module. Sentence-only cache entries cannot certify this new path.
 */
export type RetailChannelCustomerEvidence = {
  version: 1; section: "business_retail_channel"; cik: string; form: "10-K" | "20-F";
  sourceUrl: string; sourceFiledAt: string; quote: string;
  sectionParagraphCount: number; quoteParagraph: number; contextStartParagraph: number;
  contextParagraphs: string[];
};
type Reference = { cik: string; form: string; sourceUrl: string; filedAt: string };
const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
const buyerClass = "(?:brick-and-mortar retailers|e-commerce platforms|multichannel retailers)";
const quotePattern = new RegExp(`^Our retail channel covers our relationships with ${buyerClass}(?:, ${buyerClass})*(?:,? and ${buyerClass})?[.]$`, "i");
const availability = /^Our (?:core )?retail products are available through (?:a broad network of )?retail partners(?: across global markets)?[.]$/i;
const sentences = (s: string) => s.split(/(?<=[.!?])\s+(?=[A-Z“"])/).map(normalize);
function safeContext(paragraphs: string[], quoteAt: number, quote: string) {
  if (!quotePattern.test(quote) || paragraphs.join(" ").split(quote).length !== 2) return false;
  const current = sentences(paragraphs[quoteAt]);
  // Require affirmative product availability as well as the relationship list.
  // Neither a marketing partnership nor a future channel is enough by itself.
  if (!current.includes(quote) || !current.some(s => availability.test(s))) return false;
  const adverse = /\b(?:free|unpaid|no charge|no (?:product |retail )?sales|zero revenue|no longer|not|never|may|might|could|would|will|expect|intend|plan|prospective|potential|hypothetical|planned|future|contingent|conditional|exploratory|yet to|terminated|ended|ceased|stopped|discontinued|discontinuing|exited|exit|pre[- ]revenue|non[- ]commercial)\b/i;
  const retailScope = /\b(?:retail (?:channel|relationships|products)|(?:these|those|such|all|our) relationships|relationships with (?:our )?retail partners|this channel)\b/i;
  const retailPartnerExit = /\bretail partners\b.{0,100}\b(?:terminated|ended|ceased|discontinued|exited|no longer)\b|\b(?:terminate|terminated|end|ended|cease|ceased|discontinue|discontinued|exit|exited)\b.{0,100}\bretail partners\b/i;
  return !paragraphs.some((paragraph, index) => sentences(paragraph).some(s => {
    if (!adverse.test(s)) return false;
    // A separate DTC transition cannot negate current retail availability.
    // It is exempt only outside the quote paragraph and without a retail exit
    // or anaphoric qualification of these relationships/the retail channel.
    const dtcOnly = /\bdirect[- ]to[- ]consumer\b|\bDTC\b/i.test(s) && !retailScope.test(s) && !retailPartnerExit.test(s);
    return index === quoteAt || !dtcOnly;
  }));
}
export function verifiedRetailChannelCustomerEvidence(value: unknown, reference: Reference): RetailChannelCustomerEvidence | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const e = value as RetailChannelCustomerEvidence;
  if (e.version !== 1 || e.section !== "business_retail_channel" || !/^(?:10-K|20-F)$/.test(e.form)
    || e.cik !== reference.cik || e.form !== reference.form || e.sourceUrl !== reference.sourceUrl || e.sourceFiledAt !== reference.filedAt
    || typeof e.quote !== "string" || !Array.isArray(e.contextParagraphs)
    || !Number.isInteger(e.sectionParagraphCount) || e.sectionParagraphCount < 1 || e.sectionParagraphCount > 80000
    || !Number.isInteger(e.quoteParagraph) || e.quoteParagraph < 0 || e.quoteParagraph >= e.sectionParagraphCount
    || e.contextStartParagraph !== Math.max(0, e.quoteParagraph - 2)
    || e.contextParagraphs.length !== Math.min(e.sectionParagraphCount, e.quoteParagraph + 3) - e.contextStartParagraph
    || e.contextParagraphs.some(p => typeof p !== "string" || !p || normalize(p) !== p || p.length > 3000)
    || e.contextParagraphs.join(" ").length > 8000
    || !safeContext(e.contextParagraphs, e.quoteParagraph - e.contextStartParagraph, e.quote)) return null;
  return { version: 1, section: e.section, cik: e.cik, form: e.form, sourceUrl: e.sourceUrl, sourceFiledAt: e.sourceFiledAt,
    quote: e.quote, sectionParagraphCount: e.sectionParagraphCount, quoteParagraph: e.quoteParagraph,
    contextStartParagraph: e.contextStartParagraph, contextParagraphs: [...e.contextParagraphs] };
}
export function extractRetailChannelCustomerEvidence(section: string, reference: Reference): RetailChannelCustomerEvidence | null {
  if (!/^(?:10-K|20-F)$/.test(reference.form)) return null;
  const paragraphs = section.split(/\n+/).map(normalize).filter(Boolean);
  const matches = paragraphs.flatMap((p, index) => sentences(p).filter(s => quotePattern.test(s)).map(quote => ({ quote, index })));
  if (matches.length !== 1) return null;
  const { quote, index } = matches[0], start = Math.max(0, index - 2);
  return verifiedRetailChannelCustomerEvidence({ version: 1, section: "business_retail_channel", cik: reference.cik,
    form: reference.form, sourceUrl: reference.sourceUrl, sourceFiledAt: reference.filedAt, quote,
    sectionParagraphCount: paragraphs.length, quoteParagraph: index, contextStartParagraph: start,
    contextParagraphs: paragraphs.slice(start, index + 3) }, reference);
}
