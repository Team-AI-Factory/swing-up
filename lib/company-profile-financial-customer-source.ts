/** Bounded, dependency-free SEC annual financial-note customer evidence.
 * No I/O, aliases, revenue inference, Business relabeling, or verification clock.
 * The caller must supply authentic same-filing SEC bytes and metadata from its
 * trusted transport/discovery path. These checks cannot authenticate arbitrary
 * caller-supplied bytes. Cache replay likewise requires a trusted private cache.
 */
type CommonEvidence = Readonly<{
  version: 1;
  sourceUrl: string;
  sourceFiledAt: string;
  cik: string;
  form: "10-K" | "20-F";
  reportPeriod: string;
  quote: string;
}>;
export type FinancialNoteCustomerEvidence = CommonEvidence & (
  Readonly<{section: "financial_notes_accounts_receivable"; taxonomy: "us-gaap:TradeAndOtherAccountsReceivablePolicy"}>
  | Readonly<{section: "financial_notes_revenue_contracts"; taxonomy: "us-gaap:RevenueFromContractWithCustomerTextBlock"}>
);
export type FinancialNoteSourceReference = {
  identity: { cik: string; ticker?: string; company?: string };
  form: string; sourceUrl: string; filedAt: string; now: Date;
};
const IX = "http://www.xbrl.org/2013/inlineXBRL";
const XBRLI = "http://www.xbrl.org/2003/instance";
const XHTML = "http://www.w3.org/1999/xhtml";
const TAXONOMY = "us-gaap:TradeAndOtherAccountsReceivablePolicy" as const;
const SECTION = "financial_notes_accounts_receivable" as const;
const DAY = 86400000;
const MAX_HTML = 12_000_000;
const REVENUE_TAXONOMY = "us-gaap:RevenueFromContractWithCustomerTextBlock" as const;
const REVENUE_SECTION = "financial_notes_revenue_contracts" as const;
// The bounded corroborating paragraphs explicitly name the 2025 annual period.
const SUPPORTED_REPORT_PERIOD = "2025-12-31";
const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
function cik(v: unknown): string | null {
  return typeof v === "string" && /^\d{1,10}$/.test(v) && Number(v) > 0 ? v.padStart(10, "0") : null;
}
function date(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v))
    && new Date(v).toISOString().slice(0, 10) === v;
}
function source(reference: FinancialNoteSourceReference): string | null {
  if (!reference || !reference.identity || !cik(reference.identity.cik) || !date(reference.filedAt)
    || !["10-K", "20-F"].includes(reference.form) || !(reference.now instanceof Date)
    || !Number.isFinite(reference.now.getTime()) || Date.parse(reference.filedAt) > reference.now.getTime()
    || typeof reference.sourceUrl !== "string" || /[%\\\s]/.test(reference.sourceUrl)
    || /(?:^|\/)\.\.?(?:\/|$)/.test(reference.sourceUrl)) return null;
  const c = cik(reference.identity.cik)!;
  try {
    const u = new URL(reference.sourceUrl);
    if (u.protocol !== "https:" || u.hostname !== "www.sec.gov" || u.username || u.password || u.port || u.search || u.hash
      || u.href !== reference.sourceUrl) return null;
    const match = u.pathname.match(new RegExp(`^/Archives/edgar/data/${Number(c)}/(\\d{18})/([A-Za-z0-9][A-Za-z0-9._-]*\\.html?)$`));
    if (!match || match[2].includes("..") || /-index\.html?$/.test(match[2])) return null;
    // The accession's first ten digits are the submitter, not necessarily issuer.
    if (match[1].slice(10, 12) !== reference.filedAt.slice(2, 4)) return null;
    return c;
  } catch { return null; }
}
function decode(s: string): string {
  return s.replace(/&#(x[\da-f]+|\d+);/gi, (whole, encoded: string) => {
    const n = encoded[0].toLowerCase() === "x" ? parseInt(encoded.slice(1), 16) : Number(encoded);
    return n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : whole;
  }).replace(/&(amp|lt|gt|quot|apos|nbsp|lsquo|rsquo|ldquo|rdquo|ndash|mdash);/g, (whole, key: string) =>
    ({ amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: "\u00a0", lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", ndash: "–", mdash: "—" } as Record<string, string>)[key] ?? whole);
}
type Element = { tag: string; local: string; uri: string; attrs: Record<string, string>; ns: Record<string, string>;
  parent: Element | null; children: (Element | string)[]; blocked: boolean; hidden: boolean; closed: boolean };
function isElement(v: Element | string): v is Element { return typeof v !== "string"; }
function ancestor(node: Element, uri: string, local: string): boolean {
  for (let n = node.parent; n; n = n.parent) if (n.uri === uri && n.local === local) return true;
  return false;
}
function expanded(value: string, node: Element): { uri: string; local: string } | null {
  const m = /^([A-Za-z_][\w.-]*):([A-Za-z_][\w.-]*)$/.exec(value);
  return m && node.ns[m[1]] ? { uri: node.ns[m[1]], local: m[2] } : null;
}
function concept(node: Element, namespace: "dei" | "us-gaap", name: string): boolean {
  const q = expanded(node.attrs.name ?? "", node);
  return node.uri === IX && node.local === "nonnumeric" && !!q && q.local === name
    && new RegExp(namespace === "dei" ? "^http://xbrl\\.sec\\.gov/dei/20\\d{2}$" : "^http://fasb\\.org/us-gaap/20\\d{2}$").test(q.uri);
}
function invalidNil(n: Element): boolean {
  return Object.entries(n.attrs).some(([name, value]) => {
    if (!/(?:^|:)nil$/.test(name)) return false;
    const q = expanded(name, n);
    return !q || q.uri !== "http://www.w3.org/2001/XMLSchema-instance" || !/^(?:false|0)$/.test(value);
  });
}
function ownHidden(a: Record<string, string>): boolean {
  const css = (a.style ?? "").replace(/\s+/g, "").toLowerCase();
  return "hidden" in a || "inert" in a || (a["aria-hidden"] ?? "").toLowerCase() === "true" || !!a.class
    || /[\\]|\/\*/.test(css)
    // Conservatively reject presentation capable of computed/animated hiding;
    // bounded source paragraphs need none of these declarations.
    || /(?:^|;)(?:opacity|transform|filter|backdrop-filter|mask(?:-image)?|all|font|animation(?:-[a-z-]+)?|transition(?:-[a-z-]+)?):/.test(css)
    || /(?:calc|min|max|clamp|var|env|expression|rgba|hsla)\(/.test(css)
    || /(?:^|;)position:(?:absolute|fixed)(?:!important)?(?:;|$)/.test(css)
    || /(?:^|;)(?:display:none|visibility:(?:hidden|collapse)|content-visibility:hidden|(?:opacity|font-size|line-height|max-height|height|max-width|width):[-+]?(?:0+(?:\.0*)?|\.0+)(?:[a-z%]*)(?:!important)?(?:;|$)|color:transparent|clip(?:-path)?:)/.test(css);
}
/** A strict XHTML subset, deliberately fail-closed on malformed/truncated HTML,
 * DTD/entity expansion, duplicate attributes/IDs, and CSS stylesheets. A full
 * real closed note and metadata are required; incomplete stream chunks fail.
 */
function parse(html: string): { nodes: Element[]; root: Element } | null {
  if (typeof html !== "string" || !html || html.length > MAX_HTML) return null;
  const nodes: Element[] = [], stack: Element[] = [], roots: Element[] = [], ids = new Set<string>();
  let pos = 0;
  while (pos < html.length) {
    if (html.startsWith("<!--", pos)) {
      const end = html.indexOf("-->", pos + 4); if (end < 0) return null; pos = end + 3; continue;
    }
    if (html.startsWith("<?xml ", pos) && !nodes.length) {
      const end = html.indexOf("?>", pos + 6); if (end < 0) return null; pos = end + 2; continue;
    }
    if (html[pos] !== "<") {
      const end = html.indexOf("<", pos), text = html.slice(pos, end < 0 ? html.length : end);
      if (stack.length) stack[stack.length - 1].children.push(decode(text)); else if (text.trim()) return null;
      pos = end < 0 ? html.length : end; continue;
    }
    const close = /^<\/([A-Za-z_][\w:.-]*)\s*>/.exec(html.slice(pos));
    if (close) {
      const n = stack.pop(); if (!n || n.tag !== close[1]) return null; n.closed = true; pos += close[0].length; continue;
    }
    const open = /^<([A-Za-z_][\w:.-]*)\b/.exec(html.slice(pos));
    if (!open) return null;
    const tag = open[1], attrs: Record<string, string> = Object.create(null);
    pos += open[0].length;
    let self = false, terminated = false;
    for (;;) {
      const space = /^\s*/.exec(html.slice(pos))![0]; pos += space.length;
      if (html.startsWith("/>", pos)) { self = true; terminated = true; pos += 2; break; }
      if (html[pos] === ">") { terminated = true; pos++; break; }
      const a = /^([A-Za-z_][\w:.-]*)\s*=\s*(["'])([\s\S]*?)\2/.exec(html.slice(pos));
      if (!space || !a || /</.test(a[3])) return null;
      const key = a[1].toLowerCase(); if (key in attrs) return null;
      attrs[key] = decode(a[3]); pos += a[0].length;
    }
    if (!terminated || nodes.length >= 100000 || stack.length > 256) return null;
    const parent = stack.at(-1) ?? null;
    const ns: Record<string, string> = { ...(parent?.ns ?? {}) };
    for (const [key, value] of Object.entries(attrs)) if (key === "xmlns") ns[""] = value; else if (key.startsWith("xmlns:")) ns[key.slice(6)] = value;
    const parts = tag.split(":"); if (parts.length > 2) return null;
    const uri = ns[parts.length === 2 ? parts[0] : ""] ?? "", local = parts.at(-1)!.toLowerCase();
    if (attrs.id) { if (ids.has(attrs.id)) return null; ids.add(attrs.id); }
    const blocked = !!parent?.blocked || uri === XHTML && /^(?:script|style|template|noscript|iframe|object|head|blockquote|q)$/.test(local);
    const hidden = !!parent?.hidden || ownHidden(attrs) || uri === XHTML && local === "details" && !("open" in attrs) || uri === IX && /^(?:header|hidden|exclude)$/.test(local);
    const node: Element = { tag, local, uri, attrs, ns, parent, children: [], blocked, hidden, closed: self };
    nodes.push(node); if (parent) parent.children.push(node); else roots.push(node);
    if (uri === XHTML && (local === "style" || local === "link" && /(?:^|\s)stylesheet(?:\s|$)/i.test(attrs.rel ?? ""))) return null;
    // Never tokenize script bodies as HTML/XML facts or evidence.
    if (uri === XHTML && local === "script" && !self) {
      const end = html.indexOf(`</${tag}>`, pos); if (end < 0) return null; pos = end + tag.length + 3; node.closed = true;
    } else if (!self) stack.push(node);
  }
  if (stack.length || roots.length !== 1 || roots[0].uri !== XHTML || roots[0].local !== "html") return null;
  return { nodes, root: roots[0] };
}
function rawText(n: Element): string { return n.children.map(c => typeof c === "string" ? c : rawText(c)).join(""); }
function isMetadata(n: Element): boolean {
  if (n.blocked || !n.closed || n.attrs.continuedat || invalidNil(n)) return false;
  const contentSafe = (el: Element): boolean => el.children.every(ch => typeof ch === "string" || (!ch.blocked
    && !ownHidden(ch.attrs) && !invalidNil(ch) && ch.closed && !ch.attrs.continuedat && contentSafe(ch)));
  if (!contentSafe(n)) return false;
  if (!n.hidden) return true;
  // SEC routinely puts CIK/FY in this real metadata container. A generic hidden
  // div or narrative ix:hidden block is never admissible customer evidence.
  return ancestor(n, IX, "hidden") && ancestor(n, IX, "header");
}
function fact(nodes: Element[], name: string): Element | null {
  const matches = nodes.filter(n => !n.blocked && concept(n, "dei", name));
  // Workiva repeats the identical period-end cover fact. Permit only this
  // equivalent duplicate, with the same format/context and no hidden decoys.
  if (name === "DocumentPeriodEndDate" && matches.length === 2 && matches.every(isMetadata)
    && matches[0].attrs.contextref === matches[1].attrs.contextref && matches[0].attrs.format === matches[1].attrs.format
    && normalize(rawText(matches[0])) === normalize(rawText(matches[1]))) return matches[0];
  return matches.length === 1 && isMetadata(matches[0]) ? matches[0] : null;
}
function reportDate(value: string): string | null {
  value = normalize(value);
  if (date(value)) return value;
  const m = /^(January|February|March|April|May|June|July|August|September|October|November|December) (\d{1,2}), (\d{4})$/.exec(value);
  if (!m) return null;
  const month = ["January","February","March","April","May","June","July","August","September","October","November","December"].indexOf(m[1]) + 1;
  const iso = `${m[3]}-${String(month).padStart(2,"0")}-${m[2].padStart(2,"0")}`;
  return date(iso) ? iso : null;
}
function children(n: Element): Element[] { return n.children.filter(isElement); }
function context(nodes: Element[], id: string, c: string, end: string): boolean {
  const matched = nodes.filter(n => n.attrs.id === id);
  if (matched.length !== 1) return false;
  const n = matched[0];
  if (n.uri !== XBRLI || n.local !== "context" || !n.closed || n.blocked || invalidNil(n) || !ancestor(n, IX, "resources") || !ancestor(n, IX, "header")) return false;
  const direct = children(n);
  if (direct.length !== 2 || direct[0].uri !== XBRLI || direct[0].local !== "entity" || direct[1].uri !== XBRLI || direct[1].local !== "period") return false;
  const entity = children(direct[0]), period = children(direct[1]);
  if ([...direct, ...entity, ...period].some(invalidNil)) return false;
  if (entity.length !== 1 || entity[0].uri !== XBRLI || entity[0].local !== "identifier" || children(entity[0]).length
    || entity[0].attrs.scheme !== "http://www.sec.gov/CIK" || cik(normalize(rawText(entity[0]))) !== c
    || period.length !== 2 || period[0].uri !== XBRLI || period[0].local !== "startdate"
    || period[1].uri !== XBRLI || period[1].local !== "enddate" || children(period[0]).length || children(period[1]).length) return false;
  const start = normalize(rawText(period[0])), finish = normalize(rawText(period[1]));
  const days = (Date.parse(finish) - Date.parse(start)) / DAY + 1;
  return date(start) && finish === end && days >= 330 && days <= 400;
}
function cleanParagraph(n: Element, allowDiv = false): string | null {
  if (n.uri !== XHTML || !(n.local === "p" || allowDiv && n.local === "div") || n.blocked || n.hidden || !n.closed || invalidNil(n)) return null;
  const walk = (el: Element): boolean => el.children.every(ch => typeof ch === "string" || (!ch.hidden && !ch.blocked && ch.closed && !invalidNil(ch)
    && (ch.uri === XHTML && /^(?:span|b|i|em|strong|a|sup|sub|br)$/.test(ch.local)
      || ch.uri === IX && /^(?:nonnumeric|nonfraction)$/.test(ch.local)) && !ch.attrs.continuedat && walk(ch)));
  return walk(n) ? normalize(rawText(n)) : null;
}
/** Intentionally bounded to the observed concrete six-pool disclosure, not a
 * generic receivable/customer classifier. This certifies historical buyers,
 * never revenue amounts, present-day customers, or hypothetical market users.
 */
function validQuote(s: unknown): s is string {
  return typeof s === "string" && /^Accounts receivable mainly consists of amounts due from the Group[’']s customers, which are recorded net of allowance for credit losses\. The Group manages customers by six pools [—–-] domestic PRC OEM customers, domestic PRC other customers, overseas OEM customers, overseas other customers, customers facing operational difficulties and other special customers\.$/.test(s);
}
const AR_POLICY_TAIL = " For the purposes of performing ongoing credit evaluation, the customers are aggregated into two portfolio segments by reviewing their credit rating and assessing allowance for credit loss based on expected credit loss model. Category 1 consists of the first four pools customers who have a relatively low credit risk and no default history. Category 2 is for customers facing operational difficulties and other special circumstances who have a relatively higher credit risk. The Group develops a current expected credit loss (“CECL”) model based on historical collection experience, the age of the accounts receivable balances, current economic conditions, reasonable and supportable forecasts of future economic conditions, and other factors that may affect its ability to collect from customers. Account receivable balances are written off after all collection efforts have been exhausted. The expected credit loss rates for each Category as of December 31, 2024 and 2025 are as follows:";
function quote(block: Element): string | null {
  const significant = block.children.filter(c => typeof c !== "string" || !!c.trim());
  if (significant.length < 2 || significant.length > 3 || !isElement(significant[0]) || !isElement(significant[1])
    || cleanParagraph(significant[0]) !== "Accounts receivable, net") return null;
  if (significant[2] && (!isElement(significant[2]) || !concept(significant[2], "us-gaap", "AccountsReceivableNoncurrentCreditQualityIndicatorTableTextBlock")
    || significant[2].attrs.contextref !== block.attrs.contextref || significant[2].attrs.continuedat || invalidNil(significant[2]))) return null;
  const paragraph = cleanParagraph(significant[1]);
  if (!paragraph) return null;
  const match = /^[^.]+\. [^.]+\./.exec(paragraph);
  return match && validQuote(match[0]) && (paragraph.length === match[0].length || paragraph.slice(match[0].length) === AR_POLICY_TAIL) ? match[0] : null;
}

// Literal, separately located corroboration is never joined into the quote.
const REVENUE_PAYMENT = "Servicing fees for the Financing Vehicles, which primarily involve collecting payments and providing reporting on the loans within the securitization vehicles, are recognized over the service period and the payment is received monthly from the Financing Vehicles. These duties have been considered to be agent responsibilities and does not include acting as a loan servicer. Accordingly, servicing fees are recorded on a net basis.";
const REVENUE_AGREEMENTS = "Revenue from fees is comprised of Network AI fees and Contract fees. Network AI fees can be further broken down into two fee streams: AI integration fees and capital markets execution fees. AI integration fees are earned for the creation and delivery of assets that comprise Network Volume. The Company utilizes multiple funding channels to enable the purchase of network assets from Partners, such as asset backed securitizations (“ABS”), and forward flow arrangements. Capital markets execution fees are earned from the market pricing of ABS transactions, as well as upon the execution of forward flow transactions, while contract fees are management, performance and similar fees. These fees are the result of agreements with customers and are recognized in accordance with FASB Accounting Standards Codification 606, “Revenue from Contracts with Customers” (“ASC 606”).";
const REVENUE_RESPONSIBILITY = "Revenue is recognized in accordance with ASC 606 with revenue recorded on a gross basis when the Company is a principal in the transaction with customers, and recorded on a net basis when the Company is acting as an agent on behalf of another. The Company generally recognizes revenue on a gross basis because the Company is primarily responsible for integrating the various services fulfilled by Partners and is ultimately responsible to the Financing Vehicles for the fulfillment of the related services. To the extent the Company does not meet the criteria for recognizing revenue on a gross basis, the Company records revenue on a net basis.";
const REVENUE_TERMS = "Contract fees include administration and management fees, performances fees, and servicing fees. Contract fees totaled $130.0 million, $88.5 million and $76.8 million for the year ended December 31, 2025, 2024 and 2023, respectively. All of these fees are recognized over the service period for the Financing Vehicles managed or administered by the Company and the payment term is monthly as a fixed percentage of the entity’s assets, except for the portion of management fees that are recognized at the point in time based on contract terms. The Company includes variable consideration in the transaction price only to the extent that it is probable that a significant reversal in the amount of cumulative revenue recognized will not occur; to date, adjustments to these estimates have not resulted in a significant reversal of previously recognized revenue.";

/** Follow only the selected root's uniquely owned complete continuation chain.
 * Nested policy tags remain wrappers in this root's physical subtree; following
 * their separate continuation links would duplicate or import unrelated text.
 */
function continuationChain(root: Element, nodes: Element[]): Element[] | null {
  const chain = [root], seen = new Set<Element>(chain);
  while (chain.at(-1)!.attrs.continuedat) {
    const last = chain.at(-1)!, targetId = last.attrs.continuedat;
    const targets = nodes.filter(n => n.attrs.id === targetId);
    if (targets.length !== 1 || chain.length >= 32) return null;
    const target = targets[0];
    const incoming = nodes.filter(n => !n.blocked && n.uri === IX && n.attrs.continuedat === targetId);
    if (incoming.length !== 1 || incoming[0] !== last || target.uri !== IX || target.local !== "continuation"
      || target.blocked || target.hidden || !target.closed || invalidNil(target) || target.attrs.contextref || target.attrs.name
      || ancestor(target, IX, "continuation") || ancestor(target, IX, "nonnumeric")
      || seen.has(target) || nodes.indexOf(target) <= nodes.indexOf(last)) return null;
    seen.add(target); chain.push(target);
  }
  return chain;
}
function continuationParagraphs(n: Element): string[] | null {
  const result: string[] = [];
  for (const child of n.children) {
    if (typeof child === "string") { if (child.trim()) return null; continue; }
    if (child.uri === IX && child.local === "continuation" && !child.blocked && !child.hidden && child.closed
      && !child.attrs.contextref && !child.attrs.name && !invalidNil(child)) {
      const nested = continuationParagraphs(child); if (!nested) return null; result.push(...nested);
    } else {
      const p = cleanParagraph(child, true); if (p === null) return null; if (p) result.push(p);
    }
  }
  return result;
}
function visibleNarrativeText(n: Element): string | null {
  if (invalidNil(n) || !n.closed) return null;
  // Empty hidden table layout cells carry no narrative. Hidden meaningful
  // content is a hard failure, never text to silently concatenate away.
  if (n.hidden || n.blocked) return normalize(rawText(n)) ? null : "";
  let text = "";
  for (const child of n.children) {
    if (typeof child === "string") { text += child; continue; }
    const part = visibleNarrativeText(child); if (part === null) return null; text += part;
  }
  return text;
}
function revenueQuote(nodes: Element[], ctx: string): string | null {
  const roots = nodes.filter(n => !n.blocked && concept(n, "us-gaap", "RevenueFromContractWithCustomerTextBlock"));
  if (roots.length !== 1) return null;
  const root = roots[0];
  if (root.hidden || !root.closed || root.attrs.contextref !== ctx || root.attrs.escape !== "true"
    || invalidNil(root) || !root.attrs.id || normalize(rawText(root)) !== "REVENUE") return null;
  let heading = root.parent;
  while (heading && !(heading.uri === XHTML && heading.local === "div")) heading = heading.parent;
  if (!heading || heading.hidden || heading.blocked || normalize(rawText(heading)) !== "NOTE 4 - REVENUE") return null;
  const chain = continuationChain(root, nodes);
  // The pinned annual uses root + three complete continuation nodes. Requiring
  // all three prevents truncating at the first convenient customer paragraph.
  if (!chain || chain.length !== 4) return null;
  const paragraphs = continuationParagraphs(chain[1]);
  if (!paragraphs || paragraphs.length !== 8 || paragraphs[0] !== REVENUE_AGREEMENTS
    || paragraphs[1] !== REVENUE_RESPONSIBILITY || paragraphs[2] !== "Network AI Fees"
    || !paragraphs[3].startsWith("Network AI fees, comprised of AI integration fees and capital markets execution fees, totaled $")
    || paragraphs[4] !== "Contract Fees" || paragraphs[5] !== REVENUE_TERMS
    || !paragraphs[6].startsWith("Performance fees are earned when certain Fund Financing Vehicles exceed contractual return thresholds.")
    || paragraphs[7] !== REVENUE_PAYMENT) return null;
  const tail2 = visibleNarrativeText(chain[2]), tail3 = visibleNarrativeText(chain[3]);
  if (tail2 === null || tail3 === null || !normalize(tail2).startsWith("Total Revenue From FeesThe Company determines its contracts generally do not include a significant financing component")
    || !normalize(tail3).startsWith("The timing of the revenue recognition may differ from the timing of payment from customers.")) return null;
  return paragraphs[7];
}

/** The same strict annual metadata checks used for note attestations. This is
 * an optional-cache content gate, not an authenticator for caller-supplied HTML.
 * Trusted SEC discovery/transport and actual EOF are independently required. */
function annualDocumentMetadata(nodes: Element[], input: FinancialNoteSourceReference, c: string, allowFixedBooleanTransforms = false) {
  const names = ["EntityCentralIndexKey", "DocumentType", "DocumentPeriodEndDate", "DocumentFiscalPeriodFocus"];
  const facts = names.map(name => fact(nodes, name));
  if (facts.some(f => !f)) return null;
  const [id, type, period, fiscal] = facts as Element[];
  const end = reportDate(rawText(period));
  if (cik(normalize(rawText(id))) !== c || normalize(rawText(type)) !== input.form || normalize(rawText(fiscal)) !== "FY"
    || !end || Date.parse(end) > Date.parse(input.filedAt)) return null;
  const ctx = id.attrs.contextref;
  if (!ctx || facts.some(f => f!.attrs.contextref !== ctx) || !context(nodes, ctx, c, end)) return null;
  for (const flagName of ["DocumentAnnualReport", "DocumentRegistrationStatement", "DocumentTransitionReport", "DocumentShellCompanyReport"]) {
    const all = nodes.filter(n => !n.blocked && concept(n, "dei", flagName));
    if (!all.length) continue;
    const f = fact(nodes, flagName);
    if (!f || f.attrs.contextref !== ctx) return null;
    let v = normalize(rawText(f));
    if (allowFixedBooleanTransforms && f.attrs.format) {
      const transform = expanded(f.attrs.format, f);
      // Cache identity only: the namespace-qualified registry transformation
      // establishes the boolean regardless of a printed x/o checkbox glyph.
      // https://www.xbrl.org/Specification/inlineXBRL-transformationRegistry/REC-2020-02-12/inlineXBRL-transformationRegistry-REC-2020-02-12.html
      if (!transform) return null;
      if (/^http:\/\/www\.xbrl\.org\/inlineXBRL\/transformation\/(?:2020-02-12|2022-02-16)$/.test(transform.uri)
        && /^fixed-(?:true|false)$/.test(transform.local)) v = transform.local.slice("fixed-".length);
      else if (transform.uri !== "http://www.sec.gov/inlineXBRL/transformation/2015-08-31"
        || transform.local !== "boolballotbox" || !/^[☒☑☐]$/.test(v)) return null;
    }
    if (!(flagName === "DocumentAnnualReport" ? /^(?:true|1|☒|☑)$/i : /^(?:false|0|☐)$/i).test(v)) return null;
  }
  return { cik: c, form: input.form as "10-K" | "20-F", reportPeriod: end, contextRef: ctx };
}
export function inspectAnnualDocumentIdentity(input: FinancialNoteSourceReference & { html: string }) {
  const c = source(input);
  if (!c || typeof input.html !== "string" || !/<\/html>\s*$/.test(input.html)) return null;
  const parsed = parse(input.html);
  return parsed ? annualDocumentMetadata(parsed.nodes, input, c, true) : null;
}

export function extractFinancialNoteCustomerEvidence(input: FinancialNoteSourceReference & { html: string }): FinancialNoteCustomerEvidence | null {
  const c = source(input); if (!c) return null;
  // Cheap fail-closed guard before building a tree for unrelated annual notes.
  if (typeof input.html !== "string" || input.html.length > MAX_HTML || !/<\/html>\s*$/.test(input.html)
    || !/(?:TradeAndOtherAccountsReceivablePolicy|RevenueFromContractWithCustomerTextBlock)/.test(input.html)) return null;
  const parsed = parse(input.html); if (!parsed) return null;
  const { nodes } = parsed;
  const metadata = annualDocumentMetadata(nodes, input, c);
  if (!metadata || metadata.reportPeriod !== SUPPORTED_REPORT_PERIOD) return null;
  const end = metadata.reportPeriod, ctx = metadata.contextRef;
  const candidates: FinancialNoteCustomerEvidence[] = [];
  const common = { version: 1 as const, sourceUrl: input.sourceUrl, sourceFiledAt: input.filedAt,
    cik: c, form: input.form as "10-K" | "20-F", reportPeriod: end };
  const blocks = nodes.filter(n => !n.blocked && concept(n, "us-gaap", "TradeAndOtherAccountsReceivablePolicy"));
  if (blocks.length === 1) {
    const block = blocks[0];
    if (!block.hidden && block.closed && !block.attrs.continuedat && block.attrs.contextref === ctx
      && block.attrs.escape === "true" && !invalidNil(block)) {
      const q = quote(block);
      if (q) candidates.push(Object.freeze({ ...common, section: SECTION, taxonomy: TAXONOMY, quote: q }));
    }
  }
  const revenue = revenueQuote(nodes, ctx);
  if (revenue) candidates.push(Object.freeze({ ...common, section: REVENUE_SECTION, taxonomy: REVENUE_TAXONOMY, quote: revenue }));
  return candidates.length === 1 ? candidates[0] : null;
}
/** Structural revalidation of an already-issued attestation in a TRUSTED PRIVATE
 * cache, bound to its original issuer, source URL, filing date, and annual form.
 * It does not reauthenticate the HTML, refresh source age, or mint verifiedAt.
 * Never expose this as an arbitrary public-payload evidence ingestion endpoint.
 */
export function verifiedFinancialNoteCustomerEvidence(value: unknown, reference: FinancialNoteSourceReference): FinancialNoteCustomerEvidence | null {
  const c = source(reference);
  const keys = ["version","section","sourceUrl","sourceFiledAt","cik","form","reportPeriod","taxonomy","quote"];
  if (!c || !record(value) || Object.keys(value).length !== keys.length || keys.some(k => !Object.hasOwn(value,k))
    || value.version !== 1 || value.sourceUrl !== reference.sourceUrl
    || value.sourceFiledAt !== reference.filedAt || value.cik !== c || value.form !== reference.form
    || !date(value.reportPeriod) || value.reportPeriod !== SUPPORTED_REPORT_PERIOD || Date.parse(value.reportPeriod) > Date.parse(reference.filedAt)) return null;
  if (!(value.section === SECTION && value.taxonomy === TAXONOMY && validQuote(value.quote)
    || value.section === REVENUE_SECTION && value.taxonomy === REVENUE_TAXONOMY && value.quote === REVENUE_PAYMENT)) return null;
  return Object.freeze({ version: 1, section: value.section, sourceUrl: reference.sourceUrl, sourceFiledAt: reference.filedAt,
    cik: c, form: reference.form as "10-K" | "20-F", reportPeriod: value.reportPeriod, taxonomy: value.taxonomy, quote: value.quote }) as FinancialNoteCustomerEvidence;
}
