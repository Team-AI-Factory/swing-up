import crypto from "node:crypto";
import { prisma } from "@/lib/db/client";
import { getR2OperationalStatus, saveJsonToR2 } from "@/lib/r2-warehouse";
import { redactSecrets } from "@/lib/redact-secrets";
import { runStoryClusterRun } from "@/lib/story-clustering";

type Json = Record<string, unknown>;
export type SeriousSignalBrainInput = { dryRun?: boolean; confirmRun?: boolean; maxClusters?: number; includeRippleGraph?: boolean; includeContradictionDetector?: boolean; freshnessWindowHours?: number };
const txt=(v:unknown)=>String(v??"").trim();
const arr=(v:unknown)=>Array.isArray(v)?v.map(String).filter(Boolean):[];
const num=(v:unknown,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const uniq=(a:string[])=>[...new Set(a.map(x=>x.trim().toUpperCase()).filter(Boolean))];
const safeDate=()=>new Date().toISOString();
const hash=(s:string)=>crypto.createHash("sha256").update(s).digest("hex");

const OFFICIAL_SOURCES = [
  { type:"SEC filing", re:/sec|edgar|8-k|10-k|10-q|form 4|prospectus/i, next:"SEC EDGAR" },
  { type:"company IR press release", re:/company ir|investor relations|press release|official press|newsroom/i, next:"company IR newsroom" },
  { type:"FDA/openFDA", re:/fda|openfda|clinical|approval|recall|pdufa/i, next:"openFDA" },
  { type:"Federal Reserve", re:/federal reserve|\bfed\b|fomc|powell|testimony/i, next:"Federal Reserve" },
  { type:"Federal Register", re:/federal register/i, next:"Federal Register" },
  { type:"DOJ/FTC enforcement", re:/\bdoj\b|department of justice|\bftc\b|antitrust|enforcement/i, next:"DOJ/FTC" },
  { type:"CourtListener docket", re:/courtlistener|docket|lawsuit|court|litigation/i, next:"CourtListener" },
  { type:"USAspending/SAM contract", re:/usaspending|sam\.gov|contract award|procurement|defense contract/i, next:"USAspending/SAM" },
  { type:"BLS/BEA/Treasury macro", re:/\bbls\b|\bbea\b|treasury|cpi|jobs report|gdp|inflation/i, next:"BLS/BEA/Treasury" },
] as const;

const SECTOR_SEEDS: Record<string, { sector:string; industry:string; etfs:string[]; tickers:string[]; source:string }> = {
  semiconductor: { sector:"Technology", industry:"Semiconductors", etfs:["SMH","SOXX"], tickers:["NVDA","AMD","TSM","ASML","MU"], source:"existing generic-news-triage semiconductor seed list" },
  fda: { sector:"Healthcare", industry:"Biotechnology / pharma / devices", etfs:["XLV","IBB"], tickers:[], source:"existing generic-news-triage health-regulatory seed logic" },
  oil: { sector:"Energy", industry:"Oil and gas", etfs:["XLE"], tickers:["XOM","CVX","OXY"], source:"existing generic-news-triage commodity seed logic" },
  banking: { sector:"Financials", industry:"Banks / credit", etfs:["KRE","HYG"], tickers:[], source:"existing generic-news-triage credit/liquidity seed logic" },
};

async function setup(){
  await prisma.$executeRawUnsafe(`CREATE TABLE IF NOT EXISTS serious_signal_action_queue (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), story_cluster_id uuid, ticker text, event_type text, action_type text NOT NULL, priority integer NOT NULL DEFAULT 50, reason text NOT NULL, required_proof_types jsonb NOT NULL DEFAULT '[]', missing_proof_types jsonb NOT NULL DEFAULT '[]', next_source_to_call text, source_call_budget integer NOT NULL DEFAULT 1, status text NOT NULL DEFAULT 'pending', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS serious_signal_action_queue_cluster_idx ON serious_signal_action_queue(story_cluster_id, status, priority DESC)`);
}

function officialProof(c:Json){
 const hay=`${txt(c.canonical_title)} ${txt(c.canonicalTitle)} ${txt(c.canonical_summary)} ${txt(c.event_type)} ${txt(c.eventType)} ${JSON.stringify(c).slice(0,4000)}`;
 const event=txt(c.event_type)||txt(c.eventType)||"unknown"; const ticker=txt(c.primary_ticker)||txt(c.primaryTicker);
 const needed = !["unknown","opinion_or_noise"].includes(event) || num(c.seriousness_score??c.seriousnessScore)>=50;
 const found = OFFICIAL_SOURCES.find(s=>s.re.test(hay));
 const officialCount=num(c.official_source_count??c.officialSourceCount);
 const available=Boolean(found)||officialCount>0;
 const type=found?.type ?? (officialCount>0?"official source":"none");
 const urls=Array.from(hay.matchAll(/https?:\/\/[^\s"'<>]+/g)).map(m=>m[0]);
 const strength=available ? (ticker?"strong_if_entity_mapped":"medium_mapping_needed") : "missing";
 return { officialProofNeeded: needed, officialProofAvailable: available, officialProofType: type, officialProofSource: found?.next ?? (officialCount>0?"cluster official source":"none"), officialProofUrl: urls.find(u=>found?.re.test(u)) ?? urls[0] ?? null, officialProofStrength: strength, officialProofMissingReason: available?null:(needed?"No SEC/company IR/FDA/Fed/Federal Register/DOJ/FTC/CourtListener/USAspending/SAM/BLS/BEA/Treasury receipt found in the cluster.":"Low-specificity cluster; watch only until a real official proof target exists."), nextOfficialSourceToCall: found?.next ?? routeNextSource(event, hay) };
}
function routeNextSource(event:string, hay:string){ const x=`${event} ${hay}`.toLowerCase(); if(/sec|filing|guidance|earnings|dilution/.test(x)) return "SEC EDGAR"; if(/fda|drug|trial|recall/.test(x)) return "openFDA"; if(/contract|procurement/.test(x)) return "USAspending/SAM"; if(/lawsuit|doj|ftc|court|investigation/.test(x)) return "DOJ/FTC or CourtListener"; if(/fed|cpi|gdp|treasury|inflation/.test(x)) return "BLS/BEA/Treasury/Fed"; return "company IR newsroom"; }

function entityGraph(c:Json){
 const title=`${txt(c.canonical_title)} ${txt(c.canonicalTitle)} ${txt(c.canonical_summary)} ${txt(c.event_type)} ${txt(c.eventType)}`.toLowerCase();
 const direct=uniq([txt(c.primary_ticker), txt(c.primaryTicker), ...arr(c.related_tickers), ...arr(c.relatedTickers)]);
 const seeds=Object.entries(SECTOR_SEEDS).filter(([k])=>title.includes(k));
 const ripple=uniq(seeds.flatMap(([,s])=>[...s.tickers,...s.etfs]).filter(t=>!direct.includes(t)));
 const relationshipConfidence=ripple.length?"medium":"none";
 return { entityGraph: direct.map(t=>({ ticker:t, company:null, aliases:[], sector:null, industry:null, competitors:[], suppliers:[], customers:[], etfs:[], countryExposure:[], currencyExposure:[], relationshipConfidence: direct.includes(t)?"direct_cluster_mapping":"none", relationshipSource:"story cluster ticker/entity metadata" })), directlyAffectedTickers: direct, rippleAffectedTickers: ripple, rippleReason: ripple.length?`Mapped only from existing repo sector/ETF seed logic for ${seeds.map(([,s])=>s.industry).join(", ")}; no supplier/customer relationship was invented.`:null, relationshipConfidence, relationshipSource: seeds.map(([,s])=>s.source), rippleProofNeeded: ripple.length?["official event proof","specific ticker/entity mapping","relationship source stronger than sector seed"]:[] };
}

function contradictions(c:Json, proof:ReturnType<typeof officialProof>){
 const title=`${txt(c.canonical_title)} ${txt(c.canonicalTitle)} ${txt(c.canonical_summary)} ${JSON.stringify(c).slice(0,2000)}`.toLowerCase(); const types:string[]=[]; const reasons:string[]=[]; const follow:string[]=[];
 const rel=num(c.source_reliability_score??c.sourceReliabilityScore); const dup=num(c.duplicate_article_count??c.duplicateArticleCount);
 if(/upgrade|raises|positive|beats|launch|wins|approval/.test(title) && /lawsuit|probe|investigation|recall|sec|dilution|offering|going concern|risk/.test(title)){ types.push("positive_event_with_active_legal_or_regulatory_risk"); reasons.push("Positive language appears near legal/regulatory/dilution risk language."); follow.push("fetch_legal_proof"); }
 if(/guidance|outlook|raises/.test(title) && /weak|decline|loss|cash burn|debt|margin pressure/.test(title)){ types.push("positive_guidance_but_weak_fundamentals"); reasons.push("Guidance language conflicts with weak fundamentals language."); follow.push("fetch_fundamentals"); }
 if(/upgrade|price target|analyst/.test(title) && /sec|offering|dilution|s-3|atm/.test(title)){ types.push("analyst_upgrade_but_sec_dilution_or_risk"); reasons.push("Analyst-positive language conflicts with SEC dilution/risk language."); follow.push("fetch_official_proof"); }
 if(proof.officialProofNeeded && !proof.officialProofAvailable){ types.push("positive_commercial_article_but_official_source_missing"); reasons.push(proof.officialProofMissingReason ?? "Official proof missing."); follow.push("fetch_official_proof"); }
 if(dup>=2){ types.push("duplicated_same_source_hype"); reasons.push("Cluster has repeated duplicate articles from the same/similar source identity."); follow.push("wait_for_more_sources"); }
 if(rel>0 && rel<40 && /positive|surge|soar|moon|breakout|hot/.test(title)){ types.push("sentiment_positive_but_source_reliability_low"); reasons.push("Positive sentiment is coming from a low-reliability source score."); follow.push("wait_for_more_sources"); }
 if(/tariff|sanction|export control|strong dollar|rate hike/.test(title) && /positive|benefit|tailwind/.test(title)){ types.push("macro_headline_positive_but_possible_company_exposure_negative"); reasons.push("Macro wording may help a sector while hurting country/currency/company exposure."); follow.push("fetch_ripple_mapping"); }
 const severity=types.some(t=>/legal|dilution|missing|low|macro/.test(t))? (types.length>=2?"severe":"medium") : types.length?"low":"none";
 return { contradictionDetected: types.length>0, contradictionTypes: types, contradictionSeverity: severity, contradictionReason: reasons.join(" ") || null, requiredFollowUpProof: uniq(follow), blockPromotionReason: severity==="severe"?"Severe contradiction blocks AI review until follow-up proof resolves it.": proof.officialProofAvailable?null:"Official proof missing; watch/proof-needed only." };
}
function actionFor(c:Json, proof:ReturnType<typeof officialProof>, graph:ReturnType<typeof entityGraph>, con:ReturnType<typeof contradictions>){ const ticker=graph.directlyAffectedTickers[0] ?? null; let action="wait_for_more_sources"; if(!proof.officialProofAvailable) action="fetch_official_proof"; else if(con.requiredFollowUpProof[0]) action=con.requiredFollowUpProof[0]; else if(graph.rippleAffectedTickers.length) action="fetch_ripple_mapping"; const missing=[...(proof.officialProofAvailable?[]:[proof.officialProofType==="none"?"official_source":proof.officialProofType]), ...con.requiredFollowUpProof]; return { id: crypto.randomUUID(), story_cluster_id: txt(c.id)||null, ticker, event_type: txt(c.event_type)||txt(c.eventType)||"unknown", action_type: action, priority: con.contradictionSeverity==="severe"?95:proof.officialProofAvailable?70:85, reason: con.blockPromotionReason ?? (proof.officialProofAvailable?"Official proof present; fetch next confirming context.":proof.officialProofMissingReason ?? "Official proof needed."), required_proof_types: ["official_source","ticker_entity_mapping"], missing_proof_types: uniq(missing), next_source_to_call: proof.nextOfficialSourceToCall, source_call_budget: 1, status: action==="reject_noise"?"rejected":"pending", created_at: safeDate(), updated_at: safeDate() }; }

export async function runSeriousSignalBrain(input: SeriousSignalBrainInput={}){
 const dryRun=input.dryRun!==false; const confirmRun=input.confirmRun===true; const max=Math.min(Math.max(num(input.maxClusters,50),1),200); let setupOk=true; try{await setup();}catch{setupOk=false;}
 let clusters:Json[]=[]; try{ clusters=await prisma.$queryRawUnsafe<Json[]>(`SELECT * FROM story_clusters ORDER BY last_seen_at DESC NULLS LAST, created_at DESC LIMIT $1`, max); }catch{ clusters=[]; }
 if(!clusters.length){ const story=await runStoryClusterRun({dryRun:true,confirmRun:false,maxRawSignals:Math.min(max*3,150),freshnessWindowHours:input.freshnessWindowHours??72}).catch(()=>null); clusters=Array.isArray(story?.topStoryClusters)?story.topStoryClusters as Json[]:[]; }
 const outputs=[]; const actions=[]; let rippleCandidatesCreated=0, contradictionsDetectedCount=0, officialProofNeededCount=0, officialProofAvailableCount=0;
 for(const c of clusters.slice(0,max)){ const proof=officialProof(c); const graph=input.includeRippleGraph===false?{directlyAffectedTickers:[],rippleAffectedTickers:[],rippleReason:null,relationshipConfidence:"not_run",rippleProofNeeded:[],entityGraph:[],relationshipSource:[]}:entityGraph(c); const con=input.includeContradictionDetector===false?{contradictionDetected:false,contradictionTypes:[],contradictionSeverity:"not_run",contradictionReason:null,requiredFollowUpProof:[],blockPromotionReason:null}:contradictions(c,proof); const action=actionFor(c,proof,graph,con); actions.push(action); if(proof.officialProofNeeded) officialProofNeededCount++; if(proof.officialProofAvailable) officialProofAvailableCount++; if(graph.rippleAffectedTickers.length) rippleCandidatesCreated++; if(con.contradictionDetected) contradictionsDetectedCount++; outputs.push({storyClusterId:txt(c.id)||txt(c.storyHash)||hash(JSON.stringify(c).slice(0,500)), title:txt(c.canonical_title)||txt(c.canonicalTitle), eventType:action.event_type, ...proof, ...graph, ...con, recommendedAction:action}); }
 if(!dryRun && confirmRun && setupOk){ for(const a of actions){ await prisma.$executeRawUnsafe(`INSERT INTO serious_signal_action_queue(story_cluster_id,ticker,event_type,action_type,priority,reason,required_proof_types,missing_proof_types,next_source_to_call,source_call_budget,status) VALUES ($1::uuid,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9,$10,$11)`, a.story_cluster_id, a.ticker, a.event_type, a.action_type, a.priority, a.reason, JSON.stringify(a.required_proof_types), JSON.stringify(a.missing_proof_types), a.next_source_to_call, a.source_call_budget, a.status); } }
 const r2=await getR2OperationalStatus().catch(()=>null); if(r2?.writeAvailable){ await saveJsonToR2(`raw/serious-signal-brain/${new Date().toISOString().slice(0,10)}/${crypto.randomUUID()}.json`, redactSecrets({input,outputs,actions}), {source:"serious-signal-brain",dataType:"serious-signal-brain-run"}).catch(()=>null); }
 return { ok:true, dryRun, confirmRun, setupOk, seriousSignalBrainSummary:{ ok:true, clustersInspected:outputs.length, officialProofNeededCount, officialProofAvailableCount, rippleCandidatesCreated, contradictionsDetectedCount, actionQueueCreatedCount:actions.length, noOpenAI:true, noPublish:true, noTelegram:true }, clustersInspected:outputs.length, officialProofNeededCount, officialProofAvailableCount, rippleCandidatesCreated, contradictionsDetectedCount, actionQueueCreatedCount: dryRun||!confirmRun?actions.length:actions.length, topSeriousSignalActions: actions.sort((a,b)=>b.priority-a.priority).slice(0,10), nextBestProofCalls: actions.slice(0,10).map(a=>({ticker:a.ticker, actionType:a.action_type, nextSourceToCall:a.next_source_to_call, missingProofTypes:a.missing_proof_types, reason:a.reason})), officialProofRoutingSummary:{officialProofNeededCount,officialProofAvailableCount, commercialNewsWithoutOfficialProofBlockedToWatch:true, sourceHealthCountsAsProof:false}, rippleGraphSummary:{rippleCandidatesCreated, relationshipRule:"only existing cluster metadata and existing repo seed mappings; supplier/customer links are never invented"}, contradictionDetectorSummary:{contradictionsDetectedCount,severeContradictions:outputs.filter(o=>o.contradictionSeverity==="severe").length,severeBlocksAiReview:true}, seriousSignalActionQueueSummary:{createdOrPlannedCount:actions.length,dryRunOnly:dryRun||!confirmRun, table:"serious_signal_action_queue"}, clusters:outputs.slice(0,10), noOpenAI:true, noPublish:true, noTelegram:true, secretsRedacted:true };
}
