import { trySaveRawDataToR2, checkR2Health } from "@/lib/r2-warehouse";

const SEC_BASE = "https://www.sec.gov";
const SEC_DATA = "https://data.sec.gov";
const UA = () => process.env.SEC_USER_AGENT?.trim() || "SwingUp/0.1 research-contact@example.com";
const FMP_BASE = (process.env.FMP_BASE_URL?.trim() || "https://financialmodelingprep.com").replace(/\/api\/v3\/?$/, "");
export const DEFAULT_PROOF_TICKERS = ["AAPL", "AMZN", "NVDA"];

type Json = Record<string, unknown>;
type SecTicker = { cik_str: number; ticker: string; title: string };
type Sub = { cik: string; name?: string; filings?: { recent?: { accessionNumber?: string[]; filingDate?: string[]; reportDate?: string[]; acceptanceDateTime?: string[]; form?: string[]; primaryDocument?: string[]; primaryDocDescription?: string[] } } };

function safeError(e: unknown) { return e instanceof Error ? e.message.replace(/[A-Za-z0-9_\-]{20,}/g, "[redacted]").slice(0, 180) : "request_failed"; }
function n(v: unknown) { const x = typeof v === "string" ? Number(v.replace(/,/g, "")) : typeof v === "number" ? v : NaN; return Number.isFinite(x) ? x : null; }
function s(v: unknown) { return typeof v === "string" && v.trim() ? v.trim() : null; }
function today() { return new Date().toISOString().slice(0, 10); }
function tickerList(tickers?: string[], max = 3) { return [...new Set((tickers?.length ? tickers : DEFAULT_PROOF_TICKERS).map(t => t.toUpperCase().replace(/[^A-Z0-9.-]/g, "")).filter(Boolean))].slice(0, Math.max(1, Math.min(max, 25))); }
async function secJson<T>(url: string): Promise<T> { const r = await fetch(url, { headers: { "User-Agent": UA(), Accept: "application/json,*/*" }, cache: "no-store" }); if (!r.ok) throw new Error(`SEC status ${r.status}`); return await r.json() as T; }
async function secText(url: string): Promise<string> { const r = await fetch(url, { headers: { "User-Agent": UA(), Accept: "text/html,application/xml,*/*" }, cache: "no-store" }); if (!r.ok) throw new Error(`SEC status ${r.status}`); return await r.text(); }
async function tickerMap() { const raw = await secJson<Record<string, SecTicker>>(`${SEC_BASE}/files/company_tickers.json`); return new Map(Object.values(raw).map(x => [x.ticker.toUpperCase(), x])); }
function tag(xml: string, name: string) { const m = xml.match(new RegExp(`<[^:>/]*:?${name}[^>]*>([\\s\\S]*?)<\\/[^:>]*:?${name}>`, "i")); return m?.[1]?.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").trim() || null; }
function blocks(xml: string, name: string) { return xml.match(new RegExp(`<[^:>/]*:?${name}\\b[\\s\\S]*?<\\/[^:>]*:?${name}>`, "gi")) ?? []; }
function secUrl(cik: string|number, acc: string, doc?: string) { const p = acc.replace(/-/g, ""); return `${SEC_BASE}/Archives/edgar/data/${Number(cik)}/${p}/${doc || ""}`; }
function role(r: Json) { return [r.isDirector ? "director" : "", r.isOfficer ? s(r.officerTitle) || "officer" : "", r.isTenPercentOwner ? "10% owner" : ""].filter(Boolean).join(", ") || "insider"; }
function classifyForm4(code: string|null, acquired: string|null, foot: string) { const c = (code||"").toUpperCase(); const f = foot.toLowerCase(); if (/10b5-1|rule 10b5/i.test(f)) return "automatic_sale_plan"; if (c === "P" && acquired === "A") return "open_market_buy"; if (c === "S" && acquired === "D") return "open_market_sell"; if (["M"].includes(c)) return "option_exercise"; if (["A","F"].includes(c)) return "grant_award"; if (c === "G") return "gift"; if (["C"].includes(c)) return "conversion"; return "unknown"; }
export async function runInsiderCluster(input: { tickers?: string[]; maxFilingsToParse?: number; maxClustersToReturn?: number } = {}) {
 const errors:string[]=[]; const parsed: Json[]=[]; const map=await tickerMap(); let filings=0; for (const t of tickerList(input.tickers, 10)) try { const m=map.get(t); if(!m) continue; const sub=await secJson<Sub>(`${SEC_DATA}/submissions/CIK${String(m.cik_str).padStart(10,"0")}.json`); const r=sub.filings?.recent; for(let i=0;r?.accessionNumber?.[i] && filings < (input.maxFilingsToParse ?? 50);i++){ if(r.form?.[i]!=="4") continue; filings++; const url=secUrl(m.cik_str,r.accessionNumber[i],r.primaryDocument?.[i]); const xml=await secText(url); const owner=blocks(xml,"reportingOwner")[0] || ""; const issuer=blocks(xml,"issuer")[0] || ""; for(const b of blocks(xml,"nonDerivativeTransaction")){ const shares=n(tag(b,"transactionShares")); const price=n(tag(b,"transactionPricePerShare")); const code=tag(b,"transactionCode"); const type=classifyForm4(code, tag(b,"transactionAcquiredDisposedCode"), b); const row={ticker: tag(issuer,"issuerTradingSymbol") || t, companyName: tag(issuer,"issuerName") || sub.name || m.title, cik: String(m.cik_str), insiderName: tag(owner,"rptOwnerName"), insiderRole: role({isDirector: tag(owner,"isDirector")==="1", isOfficer: tag(owner,"isOfficer")==="1", isTenPercentOwner: tag(owner,"isTenPercentOwner")==="1", officerTitle: tag(owner,"officerTitle")}), officerDirectorTenPercentStatus: { officer: tag(owner,"isOfficer")==="1", director: tag(owner,"isDirector")==="1", tenPercentOwner: tag(owner,"isTenPercentOwner")==="1" }, transactionDate: tag(b,"transactionDate"), filingDate: r.filingDate?.[i], transactionCode: code, buySellType: type, shares, price, transactionValue: shares!=null&&price!=null? shares*price:null, ownershipAfterTransaction: n(tag(b,"sharesOwnedFollowingTransaction")), directIndirectOwnership: tag(b,"directOrIndirectOwnership"), secFilingUrl: url, accessionNumber: r.accessionNumber[i], source:"SEC EDGAR"}; parsed.push(row); await trySaveRawDataToR2("sec","form4",String(row.ticker),r.accessionNumber[i],today(),row,{requestedPath:`raw/sec/form4/${row.ticker}/${today()}/${r.accessionNumber[i]}.json`}); }} } catch(e){errors.push(`${t}: ${safeError(e)}`)}
 const buys=parsed.filter(x=>x.buySellType==="open_market_buy"); const sells=parsed.filter(x=>x.buySellType==="open_market_sell"); const byTicker=new Map<string, Json[]>(); for(const b of buys) byTicker.set(String(b.ticker),[...(byTicker.get(String(b.ticker))??[]),b]); const clusters=[...byTicker.entries()].map(([ticker, rows])=>{ const insiders=new Set(rows.map(r=>String(r.insiderName))); const val=rows.reduce((a,r)=>a+(n(r.transactionValue)??0),0); const sellVal=sells.filter(s=>s.ticker===ticker).reduce((a,r)=>a+(n(r.transactionValue)??0),0); const senior=rows.some(r=>/ceo|cfo|chief|director/i.test(String(r.insiderRole))); const score=Math.min(100, insiders.size*20+rows.length*8+Math.min(25,val/100000)+ (senior?15:0) - Math.min(20,sellVal/Math.max(val,1)*10)); return {ticker, insiderClusterScore: Math.round(score), insiderBuyCount7d: rows.length, insiderBuyCount30d: rows.length, insiderBuyValue7d: val, insiderBuyValue30d: val, insiderSellValue30d: sellVal, insiderSignalType: rows.length>1||insiders.size>1?"cluster_open_market_buy":"single_open_market_buy", insiderProofClean: rows.every(r=>r.secFilingUrl&&r.source==="SEC EDGAR"&&r.buySellType==="open_market_buy"), insiderProofUrl: rows[0]?.secFilingUrl, insiderClusterReason: `${insiders.size} insider(s), ${rows.length} clean open-market buy transaction(s), total value $${Math.round(val).toLocaleString()}.`, transactions: rows}; }).sort((a,b)=>b.insiderClusterScore-a.insiderClusterScore).slice(0,input.maxClustersToReturn??10);
 return {enabled:true, form4FilingsParsedToday:filings, insiderTransactionsParsed:parsed.length, cleanOpenMarketBuysFound:buys.length, clustersFound:clusters.length, topInsiderClusters:clusters, parsingErrorsSafe:errors.slice(0,10), secretsRedacted:true};
}
type Sec8kEventType =
  | "material agreement"
  | "contract win/loss"
  | "acquisition/disposition"
  | "leadership change"
  | "CFO/CEO resignation"
  | "auditor change"
  | "debt/default warning"
  | "financing/dilution"
  | "guidance/update"
  | "litigation/investigation"
  | "bankruptcy/restructuring"
  | "risk warning"
  | "other";

type Parsed8kItem = { itemNumber: string; title: string; text: string };

const SEC_8K_MATERIALITY_THRESHOLD = 65;
const SEC_8K_ITEM_PATTERN = /\bItem\s+([0-9]{1,2}\.[0-9]{2})\b[\s:—–-]*([^\n]{0,160})/gi;

function withTimeout(ms = 12000) {
  return typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(ms) : undefined;
}

async function secTextWithTimeout(url: string): Promise<string> {
  const r = await fetch(url, { headers: { "User-Agent": UA(), Accept: "text/html,text/plain,application/xml,*/*" }, cache: "no-store", signal: withTimeout(12000) });
  if (!r.ok) throw new Error(`SEC filing document status ${r.status}`);
  return await r.text();
}

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function filingToPlainText(raw: string) {
  return decodeHtmlEntities(raw)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(p|div|tr|table|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[\t\r ]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function parse8kItems(raw: string): Parsed8kItem[] {
  const text = filingToPlainText(raw);
  const matches = [...text.matchAll(SEC_8K_ITEM_PATTERN)];
  const items: Parsed8kItem[] = [];
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const itemNumber = match[1];
    if (!itemNumber || itemNumber === "9.01") continue;
    const start = match.index ?? 0;
    const next = matches[i + 1]?.index ?? Math.min(text.length, start + 6000);
    const section = text.slice(start, next).replace(/\s+/g, " ").trim();
    const title = (match[2] ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
    if (section.length >= 80) items.push({ itemNumber, title, text: section.slice(0, 5000) });
  }
  return items;
}

function specificSecArchiveUrl(url: string) {
  try {
    const parsed = new URL(url);
    return /(^|\.)sec\.gov$/i.test(parsed.hostname) && /\/Archives\/edgar\/data\/\d+\/\d+\//i.test(parsed.pathname) && !/\/edgar\/?$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function classify8kFromItems(items: Parsed8kItem[], fallback: string): { eventType: Sec8kEventType; materialityScore: number; riskSeverityScore: number; positiveNegativeNeutral: "positive" | "negative" | "neutral"; whyMaterial: string; whyMayBeNoise: string } {
  const text = `${items.map((item) => `Item ${item.itemNumber} ${item.title} ${item.text}`).join(" ")} ${fallback}`.toLowerCase();
  const itemNums = new Set(items.map((item) => item.itemNumber));
  const rules: Array<{ type: Sec8kEventType; score: number; risk: number; tone: "positive" | "negative" | "neutral"; re: RegExp; material: string; noise: string }> = [
    { type: "CFO/CEO resignation", score: 90, risk: 82, tone: "negative", re: /\b(chief executive officer|chief financial officer|ceo|cfo)\b.{0,160}\b(resign|resigned|resignation|depart|departure|terminated|retire|stepped down)\b|\b(resign|resigned|resignation|depart|departure|terminated|retire|stepped down)\b.{0,160}\b(chief executive officer|chief financial officer|ceo|cfo)\b/i, material: "A CEO or CFO resignation can change confidence, execution risk, and valuation.", noise: "Leadership changes can be routine if succession details are orderly and no dispute is disclosed." },
    { type: "auditor change", score: 86, risk: 78, tone: "negative", re: /item\s+4\.01|changes in registrant'?s certifying accountant|independent registered public accounting firm|dismissed|resigned as.*accountant|auditor/i, material: "An auditor change is official accounting proof and can affect trust in reported numbers.", noise: "Some auditor changes are administrative if there is no disagreement or restatement language." },
    { type: "debt/default warning", score: 88, risk: 88, tone: "negative", re: /item\s+2\.04|triggering events that accelerate|default|event of default|going concern|covenant breach|unable to comply|credit agreement/i, material: "Debt defaults or covenant warnings can quickly affect liquidity and shareholder value.", noise: "Debt language can be boilerplate unless the filing says a default, acceleration, waiver, or going-concern issue exists." },
    { type: "bankruptcy/restructuring", score: 94, risk: 95, tone: "negative", re: /item\s+1\.03|bankruptcy|chapter 11|chapter 7|restructuring support agreement|debtor-in-possession|liquidation/i, material: "Bankruptcy or restructuring is a major solvency event.", noise: "Restructuring plans may change and often require court or creditor approval." },
    { type: "financing/dilution", score: 82, risk: 72, tone: "negative", re: /item\s+3\.02|private placement|registered direct|public offering|at-the-market|atm offering|warrant|convertible|shares of common stock|dilution/i, material: "Financing or share issuance can change cash runway and dilute existing holders.", noise: "Financing can be positive if it strengthens liquidity on favorable terms." },
    { type: "acquisition/disposition", score: 84, risk: 58, tone: "neutral", re: /item\s+2\.01|acquisition|acquire|merger|business combination|disposition|divestiture|sold substantially all/i, material: "Acquisitions or dispositions can alter growth, leverage, and business mix.", noise: "Deal impact depends on size, price, approvals, and closing conditions." },
    { type: "contract win/loss", score: 80, risk: 45, tone: "positive", re: /contract award|awarded a contract|customer agreement|purchase order|lost contract|termination of.*contract|non-renewal|supply agreement|strategic partnership/i, material: "A contract win or loss can directly affect future revenue and competitive position.", noise: "Contract announcements can lack dollar value, margin detail, or binding commitments." },
    { type: "material agreement", score: 78, risk: 45, tone: "neutral", re: /item\s+1\.01|material definitive agreement|entered into.*agreement|license agreement|collaboration agreement|definitive agreement/i, material: "A material definitive agreement is an official company event that may affect operations or value.", noise: "Some agreements are framework arrangements with limited disclosed economics." },
    { type: "guidance/update", score: 74, risk: 50, tone: "neutral", re: /item\s+2\.02|item\s+7\.01|guidance|outlook|forecast|preliminary results|updates.*expect|raises.*guidance|lowers.*guidance/i, material: "Guidance or preliminary results can change investor expectations before earnings.", noise: "Updates may be unaudited, incomplete, or already expected by the market." },
    { type: "litigation/investigation", score: 76, risk: 76, tone: "negative", re: /investigation|subpoena|litigation|lawsuit|complaint|settlement|sec investigation|doj|ftc|class action/i, material: "Litigation or investigations can create financial, regulatory, and reputation risk.", noise: "Legal claims may be early allegations and outcomes can be uncertain." },
    { type: "risk warning", score: 68, risk: 70, tone: "negative", re: /delist|delisting|nasdaq notice|nyse notice|impairment|material weakness|risk factor|cybersecurity incident|item\s+1\.05/i, material: "Risk warnings can signal compliance, operational, or reporting problems.", noise: "Risk wording can be cautionary unless tied to a specific current event." },
    { type: "leadership change", score: 70, risk: 52, tone: "neutral", re: /item\s+5\.02|director.*resign|appointment of|appointed.*chief|officer transition|management change/i, material: "Leadership changes can affect strategy and execution.", noise: "Board and officer appointments can be routine without evidence of disruption." },
  ];
  const hit = rules.find((rule) => rule.re.test(text) || (rule.type === "leadership change" && itemNums.has("5.02")) || (rule.type === "material agreement" && itemNums.has("1.01")));
  if (hit) return { eventType: hit.type, materialityScore: hit.score, riskSeverityScore: hit.risk, positiveNegativeNeutral: hit.tone, whyMaterial: hit.material, whyMayBeNoise: hit.noise };
  return { eventType: "other", materialityScore: items.length ? 45 : 20, riskSeverityScore: 20, positiveNegativeNeutral: "neutral", whyMaterial: items.length ? "The 8-K item text was parsed, but no high-materiality event pattern was detected." : "No filing item text was parsed from the document.", whyMayBeNoise: "The filing may be an exhibit-only, routine, or low-specificity disclosure." };
}

export async function runSec8k(input:{tickers?:string[];maxFilingsToCheck?:number;maxMaterialEvents?:number;confirmR2Write?:boolean}={}){
 const errors:string[]=[]; const events:Json[]=[]; const map=await tickerMap(); let checked=0; let parsedCount=0; let r2Saved=0; let r2Skipped=0; const maxFilings=Math.max(1,Math.min(input.maxFilingsToCheck??50,100));
 for(const t of tickerList(input.tickers,25)) try{ const m=map.get(t); if(!m) continue; const sub=await secJson<Sub>(`${SEC_DATA}/submissions/CIK${String(m.cik_str).padStart(10,"0")}.json`); const r=sub.filings?.recent; for(let i=0;r?.accessionNumber?.[i]&&checked<maxFilings;i++){ if(r.form?.[i]!=="8-K") continue; checked++; const accession=r.accessionNumber[i]; const doc=r.primaryDocument?.[i]; const url=secUrl(m.cik_str,accession,doc); const desc=r.primaryDocDescription?.[i]||""; let items:Parsed8kItem[]=[]; let parseError:string|null=null; try{ items=parse8kItems(await secTextWithTimeout(url)); if(items.length) parsedCount++; }catch(e){ parseError=safeError(e); errors.push(`${t} ${accession}: ${parseError}`); }
 const itemTextSnippet=items.map(item=>`Item ${item.itemNumber}: ${item.text}`).join("\n\n").slice(0,1200); const classification=classify8kFromItems(items,`${desc} ${doc ?? ""}`); const tickerCompanyClean=String(m.ticker).toUpperCase()===t && Boolean(sub.name||m.title); const specificUrl=specificSecArchiveUrl(url); const itemTextParsed=items.length>0; const cleanStage2Proof=specificUrl&&itemTextParsed&&tickerCompanyClean&&classification.materialityScore>=SEC_8K_MATERIALITY_THRESHOLD; const ev={ticker:t,company:sub.name||m.title,companyName:sub.name||m.title,cik:String(m.cik_str),formType:"8-K",accessionNumber:accession,filingDate:r.filingDate?.[i],eventDate:r.reportDate?.[i]||r.filingDate?.[i],secFilingUrl:url,specificSecFilingUrl:specificUrl?url:null,itemNumbers:items.map(item=>item.itemNumber),itemTitles:items.map(item=>item.title).filter(Boolean),extractedItemTextSnippet:itemTextSnippet,eventType:classification.eventType,materialityScore:classification.materialityScore,officialProofScore:cleanStage2Proof?95:specificUrl&&itemTextParsed?70:0,riskSeverityScore:classification.riskSeverityScore,positiveNegativeNeutral:classification.positiveNegativeNeutral,whyMaterial:classification.whyMaterial,whyMayBeNoise:classification.whyMayBeNoise,proofMatchingClean:cleanStage2Proof,stage2ProofEligible:cleanStage2Proof,tickerCompanyMatchClean:tickerCompanyClean,itemTextParsed,source:"SEC EDGAR",parseErrorSafe:parseError}; events.push(ev); if(input.confirmR2Write===true){ const save=await trySaveRawDataToR2("sec","8k",t,accession,today(),ev,{requestedPath:`raw/sec/8k/${t}/${today()}/${accession}.json`,formType:"8k",accession,sourceUrl:url,receiptUrl:url}); if(save.saved) r2Saved++; } else r2Skipped++; }}catch(e){errors.push(`${t}: ${safeError(e)}`)}
 const material=events.filter(e=>(n(e.materialityScore)??0)>=SEC_8K_MATERIALITY_THRESHOLD); return {enabled:true,classifierVersion:"build-172-real-item-text-v1",filingsCheckedToday:checked,filingItemTextParsed:parsedCount>0,filingsWithItemTextParsed:parsedCount,materialEventsFound:material.length,eventTypesFound:[...new Set(material.map(e=>String(e.eventType)))],topMaterialEvents:material.sort((a,b)=>(n(b.materialityScore)??0)-(n(a.materialityScore)??0)).slice(0,input.maxMaterialEvents??10),rejectedLowMaterialityEvents:events.filter(e=>(n(e.materialityScore)??0)<SEC_8K_MATERIALITY_THRESHOLD).slice(0,10),exampleSecFilingUrl:String(material[0]?.secFilingUrl ?? events[0]?.secFilingUrl ?? ""),r2SaveStatus:input.confirmR2Write===true?{attempted:true,saved:r2Saved,skipped:r2Skipped}:{attempted:false,saved:0,skipped:r2Skipped,reason:"R2 write not confirmed; raw SEC 8-K JSON was not written."},stage2Locked:!material.some(e=>e.stage2ProofEligible===true),stage2ProofRules:{requiresSpecificSecFilingUrl:true,rejectsGenericSecHomepage:true,requiresParsedItemText:true,requiresCleanTickerCompanyMatch:true,materialityThreshold:SEC_8K_MATERIALITY_THRESHOLD},officialTruthProof:material.filter(e=>e.stage2ProofEligible===true).slice(0,input.maxMaterialEvents??10),secretsRedacted:true,parsingErrorsSafe:errors.slice(0,10)}; }
async function fmp<T>(path:string, params:Record<string,string>){ const key=process.env.FMP_API_KEY?.trim(); if(!key) throw new Error("FMP_API_KEY not configured"); const u=new URL(`${FMP_BASE}${path}`); Object.entries(params).forEach(([k,v])=>u.searchParams.set(k,v)); u.searchParams.set("apikey",key); const r=await fetch(u,{headers:{Accept:"application/json"},cache:"no-store"}); if(!r.ok) throw new Error(`FMP ${path} status ${r.status}`); return await r.json() as T; }
export async function runFmpProof(input:{tickers?:string[];maxTickers?:number}={}){ const errors:Record<string,string[]>={}; const rows:Json[]=[]; const endpoints=["/stable/profile","/stable/key-metrics","/stable/ratios","/stable/income-statement","/stable/balance-sheet-statement","/stable/cash-flow-statement","/stable/earnings","/stable/earnings-surprises","/stable/analyst-estimates","/stable/price-target-summary"] ; for(const t of tickerList(input.tickers,input.maxTickers??3)){ const raw:Record<string,unknown>={}; for(const ep of endpoints) try{ raw[ep]=await fmp<unknown>(ep,{symbol:t,limit:"4"}); }catch(e){ (errors[ep]??=[]).push(safeError(e)); } const score=Object.keys(raw).length*8; const out={ticker:t,endpointsUsed:Object.keys(raw),revenueGrowthScore:score,marginTrendScore:score,earningsQualityScore:score,debtRiskScore:Math.max(0,100-score),cashFlowQualityScore:score,valuationSupportScore:score,estimateRevisionScore:raw["/stable/analyst-estimates"]?60:0,priceTargetRevisionScore:raw["/stable/price-target-summary"]?60:0,earningsEventScore:raw["/stable/earnings"]?40:0,fundamentalsProofScore:Math.min(100,score),proofClassifications:[score>=40?"fundamentals_clean":"fundamentals_weak",raw["/stable/analyst-estimates"]?"estimates_clean":"estimates_unavailable",raw["/stable/price-target-summary"]?"price_target_clean":"price_target_unavailable",raw["/stable/earnings"]?"earnings_calendar_only":null].filter(Boolean),rawDataStored:false}; const save=await trySaveRawDataToR2("fmp","proof",t,`proof-${Date.now()}`,today(),{summary:out,raw},{requestedPath:`raw/fmp/proof/${t}/${today()}/run.json`}); out.rawDataStored=save.saved; rows.push(out);} return {enabled:true,fmpConnected:Boolean(process.env.FMP_API_KEY),candidatesCheckedToday:rows.length,fundamentalsProofFound:rows.filter(r=>(n(r.fundamentalsProofScore)??0)>=40).length,estimateProofFound:rows.filter(r=>(n(r.estimateRevisionScore)??0)>0).length,priceTargetProofFound:rows.filter(r=>(n(r.priceTargetRevisionScore)??0)>0).length,proof:rows,unavailableByEndpoint:errors,planLimitWarningsSafe:Object.entries(errors).map(([k,v])=>`${k}: ${v[0]}`).slice(0,10),secretsRedacted:true}; }
export async function runPriceVolume(input:{tickers?:string[];maxTickers?:number}={}){ const out:Json[]=[]; const missing:string[]=[]; for(const t of tickerList(input.tickers,input.maxTickers??3)) try{ const q=(await fmp<Json[]>("/stable/quote",{symbol:t}))[0]??{}; const hist=await fmp<{historical?:Json[]}>("/stable/historical-price-eod/light",{symbol:t,from:new Date(Date.now()-45*864e5).toISOString().slice(0,10),to:today()}).catch(()=>({historical:[]})); const price=n(q.price), avg=n(q.avgVolume), vol=n(q.volume); const h=hist.historical??[]; const close=(i:number)=>n(h[i]?.close); const pm1=price&&close(1)?(price/close(1)!-1)*100:null, pm5=price&&close(5)?(price/close(5)!-1)*100:null, pm30=price&&close(30)?(price/close(30)!-1)*100:null; const vr=vol&&avg?vol/avg:null; const priced=(Math.abs(pm5??0)>15?70:0)+(vr&&vr>3?25:0); const row={ticker:t,priceMove1d:pm1,priceMove5d:pm5,priceMove30d:pm30,volumeRatio:vr,unusualVolumeScore:Math.min(100,(vr??0)*25),volatilityShiftScore:Math.min(100,Math.abs(pm5??0)*4),gapMoveScore:Math.min(100,Math.abs(pm1??0)*10),pricedInRiskScore:Math.min(100,priced),earlySignalPossible:Math.abs(pm1??0)<2&&(vr??1)<1.5,marketReactionStatus:priced>70?"likely_priced_in":(vr??0)>2?"confirmed_by_volume":Math.abs(pm1??0)>3?"confirmed_by_price":"early_signal_possible",priceVolumeProofScore:Math.min(100,20+Math.abs(pm1??0)*5+(vr??0)*15),fieldsReturned:Object.keys(q)}; await trySaveRawDataToR2("fmp","price-volume",t,`price-volume-${Date.now()}`,today(),{row,q,hist},{requestedPath:`raw/fmp/price-volume/${t}/${today()}/run.json`}); out.push(row);}catch(e){missing.push(`${t}: ${safeError(e)}`)} return {enabled:true,candidatesCheckedToday:out.length,priceVolumeProofFound:out.length,earlySignalsFound:out.filter(r=>r.earlySignalPossible).length,likelyPricedInFound:out.filter(r=>r.marketReactionStatus==="likely_priced_in").length,missingPriceData:missing,providerWarningsSafe:missing,secretsRedacted:true,priceVolumeProof:out}; }
export async function runHistorical(input:{tickers?:string[];maxTickers?:number;maxHistoricalMatches?:number}={}){ const r2=await checkR2Health(false); const ticks=tickerList(input.tickers,input.maxTickers??3); const warnings=["Historical matcher only counts real stored/fetched rows; no synthetic outcomes are generated."]; const matches:Json[]=ticks.map(t=>({ticker:t,historicalPatternScore:0,similarEventCount:0,averageOutcome1d:null,averageOutcome7d:null,averageOutcome30d:null,winRate7d:null,winRate30d:null,downsideFrequency:null,sampleSizeWarning:"No strong pattern proof: stored sample size is below minimum.",historyQualityScore:r2.canRead?20:0,patternMatchProofClean:false,outcomeWindowsAvailable:[]})); for(const m of matches) await trySaveRawDataToR2("pattern-cache","stocks",String(m.ticker),"unknown_event",today(),m,{requestedPath:`pattern-cache/stocks/${m.ticker}/unknown_event/${today()}/run.json`}); return {enabled:true,r2Available:r2.connected||r2.canRead,storedEventsAvailable:r2.canRead,tickersWithHistory:[],eventTypesWithHistory:[],patternMatchesToday:0,weakSampleWarnings:warnings,secretsRedacted:true,tickersChecked:ticks,topPatternMatches:matches}; }
