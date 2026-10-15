/** Conservative SEC 40-F -> same-accession annual information form support.
 * The caller authenticates the issuer through SEC submissions and uses its
 * existing budgeted transport. These helpers perform no I/O or source fallback.
 */
export type SecAnnualFilingReference = { url: string; form: string; filedAt: string };
export type SecAnnualInformationFormReference = SecAnnualFilingReference & {
  form: "40-F"; cik: string; accessionNumber: string;
  annualFilingUrl: string; annualFilingIndexUrl: string; reportPeriod: string;
};
const normalize = (value: string) => value.replace(/\s+/g, " ").trim();
function entities(value: string) {
  return value.replace(/&#(x[\da-f]+|\d+);/gi, (entity, encoded: string) => {
    const code = encoded[0].toLowerCase() === "x" ? parseInt(encoded.slice(1), 16) : parseInt(encoded, 10);
    return code >= 32 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? String.fromCodePoint(code) : entity;
  }).replace(/&(nbsp|amp|quot|apos|lsquo|rsquo|ldquo|rdquo|ndash|mdash);/gi, (entity, key: string) =>
    ({nbsp:" ",amp:"&",quot:'"',apos:"'",lsquo:"‘",rsquo:"’",ldquo:"“",rdquo:"”",ndash:"–",mdash:"—"} as Record<string,string>)[key.toLowerCase()] ?? entity);
}
function visible(value: string) {
  return entities(value.replace(/<(?:script|style|ix:header)\b[^>]*>[\s\S]*?<\/(?:script|style|ix:header)>/gi, " ")
    .replace(/<[^>]*>/g, ""));
}
function attribute(tag: string, name: string) {
  return entities(tag.match(new RegExp(`\\b${name}\\s*=\\s*(["'])([\\s\\S]*?)\\1`, "i"))?.[2] ?? "");
}
function archive(url: string, cik: string) {
  if (!/^\d{1,10}$/.test(cik) || Number(cik) <= 0) return null;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.hostname !== "www.sec.gov" || parsed.port || parsed.username || parsed.password
      || parsed.search || parsed.hash || /[%\\]/.test(url) || /(?:^|\/)\.\.?(?:\/|$)/.test(url)) return null;
    const match = parsed.pathname.match(new RegExp(`^/Archives/edgar/data/${Number(cik)}/(\\d{18})/([A-Za-z0-9._-]+\\.html?)$`));
    if (!match) return null;
    const accession = `${match[1].slice(0,10)}-${match[1].slice(10,12)}-${match[1].slice(12)}`;
    return { cik: cik.padStart(10,"0"), directory: `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${match[1]}/`, accession };
  } catch { return null; }
}
/** Derive only the SEC index for the authenticated filing's exact accession. */
export function secAnnualFilingIndexUrl(filingUrl: string, cik: string): string | null {
  const reference = archive(filingUrl, cik);
  return reference ? `${reference.directory}${reference.accession}-index.html` : null;
}
function documentLink(href: string, directory: string, allowInlineViewer = false): string | null {
  if (!href || /[%\\\s]/.test(href) || href.startsWith("//") || /(?:^|\/)\.\.?(?:\/|$)/.test(href)) return null;
  if (allowInlineViewer && /^\/ix\?doc=\/Archives\//.test(href) && !/[&#]/.test(href)) href = href.slice("/ix?doc=".length);
  try {
    const parsed = new URL(href, directory);
    if (parsed.search || parsed.hash || parsed.username || parsed.password || parsed.port || parsed.origin !== "https://www.sec.gov") return null;
    const name = parsed.href.slice(directory.length);
    return parsed.href.startsWith(directory) && /^[A-Za-z0-9._-]+\.html?$/.test(name) ? parsed.href : null;
  } catch { return null; }
}
function rows(html: string) {
  return [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(match => [...match[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(cell => cell[1]));
}
function hrefs(html: string) {
  return [...html.matchAll(/<a\b[^>]*>/gi)].map(match => attribute(match[0],"href")).filter(Boolean);
}
function fact(html: string, name: string) {
  const found = [...html.matchAll(/<ix:nonNumeric\b([^>]*)>/gi)]
    .filter(match => attribute(match[1],"name") === `dei:${name}`);
  if (found.length !== 1) return null;
  if (attribute(found[0][1],"continuedAt") || /^(?:true|1)$/i.test(attribute(found[0][1],"nil"))) return null;
  // The report-period fact can contain a nested fiscal month/day fact.
  const start = (found[0].index ?? 0) + found[0][0].length;
  const tags = /<\/?ix:nonNumeric\b[^>]*>/gi;
  tags.lastIndex = start;
  let depth = 1;
  for (let tag = tags.exec(html); tag; tag = tags.exec(html)) {
    depth += /^<\//.test(tag[0]) ? -1 : 1;
    if (depth === 0) return { value: normalize(visible(html.slice(start,tag.index))), format: attribute(found[0][1],"format") };
  }
  return null;
}
const dateText = "(?:\\d{4}-\\d{2}-\\d{2}|(?:January|February|March|April|May|June|July|August|September|October|November|December)\\s+\\d{1,2},?\\s+\\d{4})";
function calendarDate(value: string): string | null {
  const names = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const named = /^(\w+) (\d{1,2}),? (\d{4})$/i.exec(normalize(value));
  const month = named ? names.findIndex(name => name.toLowerCase() === named[1].toLowerCase()) + 1 : 0;
  const iso = named && month ? `${named[3]}-${String(month).padStart(2,"0")}-${named[2].padStart(2,"0")}` : value;
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) && Number.isFinite(Date.parse(iso))
    && new Date(iso).toISOString().slice(0,10) === iso ? iso : null;
}
function yearEndedPeriod(value: string): string | null {
  const found = [...normalize(value).matchAll(new RegExp(`\\b(?:fiscal )?year ended\\s+(${dateText})\\b`,"gi"))];
  return found.length === 1 ? calendarDate(found[0][1]) : null;
}
/** An authenticated reporting period is a real calendar date, not metadata
 * inferred from a filename or signature/filing date. */
export function validAnnualInformationFormPeriod(value: unknown, filedAt: string): value is string {
  return typeof value === "string" && calendarDate(value) === value && calendarDate(filedAt) === filedAt && value <= filedAt;
}
function trueFact(html: string, name: string) {
  const f = fact(html,name);
  return Boolean(f && !/fixed-false$/i.test(f.format) && !/^(?:false|0|☐)$/i.test(f.value)
    && (/fixed-true$/i.test(f.format) || /^(?:true|1|☒|☑)$/i.test(f.value)));
}
/** Require the annual 40-F cover, its explicit AIF exhibit description, and
 * the matching EX-99.1 row in its SEC filing index. EX-99.1 alone is not an AIF.
 * filedAt is the submissions/index filing date, never the AIF's signature date.
 */
export function resolve40FAnnualInformationForm(input: {
  cik: string; filing: SecAnnualFilingReference; annualHtml: string; indexHtml: string;
}): SecAnnualInformationFormReference | null {
  const {cik,filing,annualHtml,indexHtml} = input;
  const reference = archive(filing.url,cik);
  if (!reference || filing.form !== "40-F" || !/^\d{4}-\d{2}-\d{2}$/.test(filing.filedAt)
    || !Number.isFinite(Date.parse(filing.filedAt)) || new Date(filing.filedAt).toISOString().slice(0,10) !== filing.filedAt) return null;
  if (fact(annualHtml,"DocumentType")?.value !== "40-F" || !trueFact(annualHtml,"DocumentAnnualReport")
    || trueFact(annualHtml,"DocumentRegistrationStatement") || !trueFact(annualHtml,"AnnualInformationForm")
    || fact(annualHtml,"EntityCentralIndexKey")?.value !== reference.cik) return null;
  const indexText = normalize(visible(indexHtml.replace(/<\/div>|<\/span>/gi," ")));
  const periodFact = fact(annualHtml,"DocumentPeriodEndDate");
  if (periodFact?.format && !/^(?:[\w.-]+:)?date-(?:monthname-day-year-en|year-month-day)$/.test(periodFact.format)) return null;
  const reportPeriod = calendarDate(periodFact?.value ?? "");
  const indexPeriods = [...indexText.matchAll(/\bPeriod of Report\s+(\d{4}-\d{2}-\d{2})\b/g)];
  if (!reportPeriod || reportPeriod > filing.filedAt || indexPeriods.length !== 1 || indexPeriods[0][1] !== reportPeriod) return null;
  if (!indexText.includes(reference.accession)
    || !indexText.includes(`Filing Date ${filing.filedAt}`)
    || !new RegExp(`CIK\\s*:\\s*0*${Number(cik)}\\b`).test(indexText)) return null;
  const indexRows = rows(indexHtml);
  const primaryRows = indexRows.filter(row => normalize(visible(row[3] ?? "")) === "40-F");
  if (primaryRows.length !== 1) return null;
  const primary = primaryRows.flatMap(row => hrefs(row[2] ?? "").map(href => documentLink(href,reference.directory,true))).filter(Boolean);
  if (primary.length !== 1 || primary[0] !== filing.url) return null;
  const exhibitRows = indexRows.filter(row => normalize(visible(row[3] ?? "")) === "EX-99.1");
  if (exhibitRows.length !== 1) return null;
  const indexed = exhibitRows.flatMap(row => hrefs(row[2] ?? "").map(href => documentLink(href,reference.directory))).filter(Boolean);
  const declaredRows = rows(annualHtml).filter(row => /^(?:EX-)?99\.1$/i.test(normalize(visible(row[0] ?? ""))));
  if (declaredRows.length !== 1 || !/^Annual Information Form\b/i.test(normalize(visible(declaredRows[0][1] ?? "")))) return null;
  if (yearEndedPeriod(visible(declaredRows[0][1] ?? "")) !== reportPeriod) return null;
  // Filing generators can split one exhibit caption into adjacent anchors.
  // Require one distinct authenticated document, not one HTML anchor; reject
  // every unsafe or conflicting target rather than filtering it away.
  const declaredLinks = [...(declaredRows[0][1] ?? "").matchAll(/<a\b[^>]*>/gi)]
    .map(match => documentLink(attribute(match[0],"href"),reference.directory));
  if (!declaredLinks.length || declaredLinks.some(link => !link)) return null;
  const declared = [...new Set(declaredLinks)];
  if (indexed.length !== 1 || declared.length !== 1 || indexed[0] !== declared[0] || indexed[0] === filing.url) return null;
  return {url:indexed[0]!,form:"40-F",filedAt:filing.filedAt,cik:reference.cik,accessionNumber:reference.accession,reportPeriod,
    annualFilingUrl:filing.url,annualFilingIndexUrl:`${reference.directory}${reference.accession}-index.html`};
}
/** Exact AIF business section only; never risk factors, general product uses,
 * or financial note sections. A cache replay may supply this exact heading.
 * Conservative initial format support: standalone DESCRIPTION OF THE BUSINESS.
 */
function annualInformationFormText(html: string): string {
  const source = /<[a-z][^>]*>/i.test(html) ? html.replace(/\r?\n/g," ") : html;
  const clean = visible(source.replace(/<li\b[^>]*>/gi,"\n• ")
    .replace(/<\/(?:p|div|h[1-6]|li|tr)>|<br\s*\/?\s*>/gi,"\n").replace(/<\/(?:td|th)>/gi," "))
    .replace(/[^\S\n]+/g," ").replace(/\s*\n\s*/g,"\n").trim();
  return clean;
}
/** Apply to newly fetched raw AIF bytes before extraction/caching. Cache-only
 * replay intentionally uses annualInformationFormBusinessText instead. */
export function isAnnualInformationFormDocument(html: string, expectedPeriod?: string): boolean {
  const start = annualInformationFormText(html).slice(0,5000);
  const titles = [...start.matchAll(/^ANNUAL INFORMATION FORM[.:]?\s*$/gim)];
  const titlePeriod = titles.length === 1 ? yearEndedPeriod(start.slice((titles[0].index ?? 0) + titles[0][0].length,
    (titles[0].index ?? 0) + titles[0][0].length + 500)) : null;
  return titles.length === 1 && (expectedPeriod === undefined || (calendarDate(expectedPeriod) === expectedPeriod && titlePeriod === expectedPeriod))
    && annualInformationFormBusinessText(html).length >= 500;
}
export function annualInformationFormBusinessText(html: string): string {
  const clean = annualInformationFormText(html);
  const starts = [...clean.matchAll(/^DESCRIPTION OF THE BUSINESS[.:]?\s*$/gim)];
  return starts.map(match => {
    const rest=clean.slice((match.index ?? 0)+match[0].length).trim();
    const stop=rest.search(/^(?:RISK FACTORS|DIVIDENDS AND DISTRIBUTIONS|DESCRIPTION OF CAPITAL STRUCTURE|FINANCIAL STATEMENTS)[.:]?\s*$/im);
    return rest.slice(0,stop >= 0 ? stop : 80000).trim();
  }).filter(section=>section.length>=500).sort((a,b)=>b.length-a.length)[0]?.slice(0,80000) ?? "";
}
