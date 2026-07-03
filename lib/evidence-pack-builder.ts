import crypto from "node:crypto";
import { prisma } from "@/lib/db/client";
import { getR2OperationalStatus, saveJsonToR2 } from "@/lib/r2-warehouse";
import { redactSecrets } from "@/lib/redact-secrets";
import { runStoryClusterRun } from "@/lib/story-clustering";

type Json = Record<string, unknown>;
export type EvidencePackBuildInput = { dryRun?: boolean; confirmRun?: boolean; maxClusters?: number; freshnessWindowHours?: number };
const text=(v:unknown)=>String(v??"").trim();
const num=(v:unknown,d=0)=>Number.isFinite(Number(v))?Number(v):d;
const arr=(v:unknown)=>Array.isArray(v)?v.map(String).filter(Boolean):[];
const clamp=(n:number)=>Math.max(0,Math.min(100,Math.round(n)));
const uniq=(a:string[])=>[...new Set(a.map(x=>x.trim()).filter(Boolean))];
const id=()=>crypto.randomUUID();

async function safeSetup(){
  const statements=[
    `CREATE TABLE IF NOT EXISTS evidence_packs (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), story_cluster_id uuid, ticker text, company text, event_type text, headline text, summary text, official_proof_count integer NOT NULL DEFAULT 0, commercial_news_count integer NOT NULL DEFAULT 0, independent_source_count integer NOT NULL DEFAULT 0, price_volume_proof_count integer NOT NULL DEFAULT 0, fundamentals_proof_count integer NOT NULL DEFAULT 0, transcript_proof_count integer NOT NULL DEFAULT 0, risk_proof_count integer NOT NULL DEFAULT 0, contradiction_count integer NOT NULL DEFAULT 0, missing_proof_types jsonb NOT NULL DEFAULT '[]', proof_score integer NOT NULL DEFAULT 0, confidence_score integer NOT NULL DEFAULT 0, stage_recommendation text NOT NULL DEFAULT 'radar_item', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`,
    `CREATE TABLE IF NOT EXISTS evidence_pack_items (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), evidence_pack_id uuid REFERENCES evidence_packs(id) ON DELETE CASCADE, proof_type text NOT NULL, source_name text, source_url text, source_reliability integer NOT NULL DEFAULT 0, proof_strength integer NOT NULL DEFAULT 0, value_summary text, raw_storage_ref text, created_at timestamptz NOT NULL DEFAULT now())`,
    `CREATE INDEX IF NOT EXISTS evidence_packs_cluster_idx ON evidence_packs(story_cluster_id, updated_at DESC)`,
    `CREATE INDEX IF NOT EXISTS evidence_packs_stage_idx ON evidence_packs(stage_recommendation, proof_score DESC)`,
    `CREATE INDEX IF NOT EXISTS evidence_pack_items_pack_idx ON evidence_pack_items(evidence_pack_id)`
  ];
  for(const sql of statements) await prisma.$executeRawUnsafe(sql);
}

function classifyItem(row:Json){
  const hay=`${text(row.source_name)} ${text(row.source_type)} ${text(row.url)} ${text(row.title_hash)}`.toLowerCase();
  if(/sec|edgar|official|investor relations|company ir|fda|federal|doj|ftc|courtlistener|sam\.gov|usaspending/.test(hay)) return "official_proof";
  if(/transcript|conference call|earnings call|benzinga/.test(hay)) return "transcript_proof";
  if(/lawsuit|investigation|probe|recall|enforcement|risk|court/.test(hay)) return "risk_proof";
  return "commercial_news";
}
function routeMissing(missing:string[], event:string){
  const first=missing[0]||"official_proof"; const e=event.toLowerCase();
  const call = first==="official_proof" ? "fetch_official_proof" : first==="price_volume_proof" ? "fetch_price_volume" : first==="fundamentals_proof" ? "fetch_fundamentals" : first==="transcript_proof" ? "fetch_transcript" : first==="risk_proof" ? "fetch_legal_proof" : "fetch_ripple_mapping";
  const source = call==="fetch_official_proof" ? (/fda|clinical|recall/.test(e)?"openFDA / FDA official pages":/contract|award/.test(e)?"USAspending.gov / SAM.gov":/legal|lawsuit|investigation/.test(e)?"DOJ/FTC/CourtListener":"SEC EDGAR or company IR newsroom") : call==="fetch_price_volume" ? "FMP price/volume endpoint" : call==="fetch_fundamentals" ? "FMP fundamentals/ratios endpoint" : call==="fetch_transcript" ? "Benzinga or FMP transcript endpoint" : call==="fetch_legal_proof" ? "DOJ/FTC/CourtListener official/legal source" : "Wikidata/official relationship mapping";
  return { missingProofTypes: missing, nextBestProofCall: call, nextBestSource: source, whyThisSource: `This is the highest-value missing proof for a ${event||"unknown"} story without inventing evidence.`, estimatedCallCostLowMediumHigh: call==="fetch_price_volume"?"low":"medium", canRunNow: true };
}
function scoreAndStage(p:{official:number;commercial:number;independent:number;price:number;fundamentals:number;transcript:number;risk:number;contradictions:number;severe:boolean;missing:string[]}){
 const officialProofScore=clamp(p.official*35), independentSourceScore=clamp(p.independent*18), priceVolumeScore=clamp(p.price*14), fundamentalsScore=clamp(p.fundamentals*14), transcriptScore=clamp(p.transcript*12), riskPenalty=clamp(p.risk*8), contradictionPenalty=clamp(p.contradictions*(p.severe?30:12)), missingProofPenalty=clamp(p.missing.length*8);
 const proofScore=clamp(officialProofScore+priceVolumeScore+fundamentalsScore+transcriptScore+Math.min(20,independentSourceScore)-riskPenalty-contradictionPenalty-missingProofPenalty);
 const confidenceScore=clamp(independentSourceScore+officialProofScore*0.7+priceVolumeScore+fundamentalsScore+transcriptScore-contradictionPenalty-missingProofPenalty);
 const cleanTypes=[p.official>0,p.price>0,p.fundamentals>0,p.transcript>0,p.risk>0].filter(Boolean).length;
 let stage="radar_item"; if(proofScore<25) stage="rejected_noise"; else if(p.severe) stage="proof_needed"; else if(cleanTypes>=3 && p.independent>=2 && p.commercial===0) stage="watch_candidate"; else if(cleanTypes>=3 && p.independent>=2 && p.official>0) stage="ai_review_ready"; else if(p.missing.length) stage="proof_needed"; else if(proofScore>=45) stage="watch_candidate";
 if(p.commercial>0 && p.official===0 && p.price===0 && p.fundamentals===0 && p.transcript===0) stage="proof_needed";
 return {proofScore,confidenceScore,officialProofScore,independentSourceScore,priceVolumeScore,fundamentalsScore,transcriptScore,riskPenalty,contradictionPenalty,missingProofPenalty,stageRecommendation:stage};
}

export async function runEvidencePackBuild(input:EvidencePackBuildInput={}){
 const dryRun=input.dryRun!==false, confirmRun=input.confirmRun===true, max=Math.min(Math.max(num(input.maxClusters,50),1),200); let setupOk=true, setupError:string|null=null;
 try{ await safeSetup(); }catch(e){ setupOk=false; setupError=e instanceof Error?e.message.slice(0,140):"evidence_pack_setup_failed"; }
 let clusters:Json[]=[]; try{ clusters=await prisma.$queryRawUnsafe<Json[]>(`SELECT * FROM story_clusters ORDER BY seriousness_score DESC NULLS LAST, last_seen_at DESC NULLS LAST LIMIT $1`, max); }catch{ clusters=[]; }
 if(!clusters.length){ const story=await runStoryClusterRun({dryRun:true,confirmRun:false,maxRawSignals:Math.min(max*3,150),freshnessWindowHours:input.freshnessWindowHours??72}).catch(()=>null); clusters=Array.isArray(story?.topStoryClusters)?story.topStoryClusters as Json[]:[]; }
 const r2=await getR2OperationalStatus().catch(()=>null); const packs:Json[]=[]; let created=0, r2Stored=0;
 for(const c of clusters.slice(0,max)){
  const cid=text(c.id)||null; let items:Json[]=[]; if(cid){ items=await prisma.$queryRawUnsafe<Json[]>(`SELECT * FROM story_cluster_items WHERE story_cluster_id=$1::uuid ORDER BY created_at DESC LIMIT 50`, cid).catch(()=>[]); }
  const independent=new Set<string>(), urls=new Set<string>(); let official=0, commercial=0, transcript=0, risk=0;
  const packItems:Json[]=[];
  for(const it of items){ const u=text(it.url)||text(it.article_url_hash); const source=text(it.source_name)||"unknown"; const key=u||`${source}|${text(it.title_hash)}`; if(urls.has(key)) continue; urls.add(key); independent.add(source.toLowerCase()); const proof=classifyItem(it); if(proof==="official_proof") official++; else if(proof==="transcript_proof") transcript++; else if(proof==="risk_proof") risk++; else commercial++; packItems.push({proofType:proof,sourceName:source,sourceUrl:text(it.url)||null,sourceReliability:num(it.reliability_weight),proofStrength: proof==="official_proof"?90:proof==="transcript_proof"?70:proof==="risk_proof"?65:45,valueSummary:`${proof.replace(/_/g," ")} from ${source}`,rawStorageRef:null}); }
  const hay=`${text(c.canonical_title)||text(c.canonicalTitle)} ${text(c.canonical_summary)||text(c.summary)} ${JSON.stringify(c).slice(0,1500)}`.toLowerCase();
  const price=/price|volume|shares traded|market reaction|gap up|gap down/.test(hay)?1:0, fundamentals=/revenue|eps|margin|cash flow|debt|guidance|earnings/.test(hay)?1:0;
  const severe=/severe|dilution|going concern|fraud|halt|bankruptcy/.test(hay) && /positive|upgrade|beats|approval|wins/.test(hay); const contradictionCount=(severe?1:0)+(/but|however|despite|although/.test(hay)?1:0);
  const missing=uniq([official?"":"official_proof",price?"":"price_volume_proof",fundamentals?"":"fundamentals_proof",transcript?"":"transcript_proof"].filter(Boolean));
  const scores=scoreAndStage({official,commercial,independent:independent.size,price,fundamentals,transcript,risk,contradictions:contradictionCount,severe,missing});
  let rawRef:null|string=null; if(r2?.writeAvailable){ rawRef=await saveJsonToR2(`raw/evidence-packs/${new Date().toISOString().slice(0,10)}/${id()}.json`, redactSecrets({cluster:c,packItems,scores,missing}), {source:"evidence-pack-builder",dataType:"evidence-pack"}).then(x=>x?.r2Key??null).catch(()=>null); if(rawRef) r2Stored++; }
  const pack={id:id(),storyClusterId:cid,ticker:text(c.primary_ticker)||text(c.primaryTicker)||null,company:arr(c.companies)[0]||null,eventType:text(c.event_type)||text(c.eventType)||"unknown",headline:text(c.canonical_title)||text(c.canonicalTitle),summary:text(c.canonical_summary)||text(c.summary)||text(c.articleMemorySummary),officialProofCount:official,commercialNewsCount:commercial,independentSourceCount:independent.size,priceVolumeProofCount:price,fundamentalsProofCount:fundamentals,transcriptProofCount:transcript,riskProofCount:risk,contradictionCount,missingProofTypes:missing,...scores,articleMemorySummary:text(c.articleMemorySummary)||null,contradictions: contradictionCount?[{severity:severe?"severe":"medium",blocksAiReview:severe,summary:"Potential contradiction detected from cluster wording; requires proof before AI review."}]:[],missingProofRouter:routeMissing(missing,text(c.event_type)||text(c.eventType)||"unknown"),items:packItems.map(x=>({...x,rawStorageRef:rawRef}))};
  if(!dryRun && confirmRun && setupOk){ await prisma.$executeRawUnsafe(`INSERT INTO evidence_packs(id,story_cluster_id,ticker,company,event_type,headline,summary,official_proof_count,commercial_news_count,independent_source_count,price_volume_proof_count,fundamentals_proof_count,transcript_proof_count,risk_proof_count,contradiction_count,missing_proof_types,proof_score,confidence_score,stage_recommendation) VALUES ($1::uuid,$2::uuid,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,$17,$18,$19)`,pack.id,pack.storyClusterId,pack.ticker,pack.company,pack.eventType,pack.headline,pack.summary,official,commercial,independent.size,price,fundamentals,transcript,risk,contradictionCount,JSON.stringify(missing),scores.proofScore,scores.confidenceScore,scores.stageRecommendation); for(const it of packItems){ await prisma.$executeRawUnsafe(`INSERT INTO evidence_pack_items(evidence_pack_id,proof_type,source_name,source_url,source_reliability,proof_strength,value_summary,raw_storage_ref) VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8)`,pack.id,it.proofType,it.sourceName,it.sourceUrl,it.sourceReliability,it.proofStrength,it.valueSummary,rawRef); } }
  created++; packs.push(pack);
 }
 return {ok:true,dryRun,confirmRun,setupOk,setupError,evidencePackBuilderSummary:{ok:true,setupOk,setupError,evidencePacksCreated:created,aiReviewReadyEvidencePacks:packs.filter(p=>p.stageRecommendation==="ai_review_ready").length,severeContradictions:packs.filter(p=>Array.isArray(p.contradictions)&&p.contradictions.some((x:Json)=>x.severity==="severe")).length,duplicateSourcesNotCounted:true,sourceHealthCountsAsProof:false,noFakeProof:true,rawStoredInR2Count:r2Stored},evidencePacksCreated:created,topEvidencePacks:packs.sort((a,b)=>num(b.proofScore)-num(a.proofScore)).slice(0,10),aiReviewReadyEvidencePacks:packs.filter(p=>p.stageRecommendation==="ai_review_ready").slice(0,10),missingProofRouterSummary:packs.slice(0,10).map(p=>p.missingProofRouter),noOpenAI:true,noPublish:true,noTelegram:true,secretsRedacted:true};
}
