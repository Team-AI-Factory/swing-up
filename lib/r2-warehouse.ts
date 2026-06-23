import crypto from "node:crypto";
import { prisma } from "@/lib/db/client";

export type R2Health = { connected:boolean; configured:boolean; bucket:string|null; endpointHost:string|null; canRead:boolean; canWrite:boolean; canDelete:boolean; lastChecked:string; missingEnvVars:string[]; errorCategory:string|null; errorMessageSafe:string|null };
const REQUIRED = ["CLOUDFLARE_R2_ACCOUNT_ID","CLOUDFLARE_R2_ACCESS_KEY_ID","CLOUDFLARE_R2_SECRET_ACCESS_KEY","CLOUDFLARE_R2_BUCKET"] as const;
export function getR2Config(){ const missingEnvVars = REQUIRED.filter((k)=>!process.env[k]?.trim()); const accountId=process.env.CLOUDFLARE_R2_ACCOUNT_ID?.trim()||""; const endpoint=(process.env.CLOUDFLARE_R2_ENDPOINT?.trim()|| (accountId?`https://${accountId}.r2.cloudflarestorage.com`:"")).replace(/\/$/,""); const region=process.env.CLOUDFLARE_R2_REGION?.trim()||"auto"; return { accountId, accessKeyId:process.env.CLOUDFLARE_R2_ACCESS_KEY_ID?.trim()||"", secretAccessKey:process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY?.trim()||"", bucket:process.env.CLOUDFLARE_R2_BUCKET?.trim()||"", publicBaseUrl:process.env.CLOUDFLARE_R2_PUBLIC_BASE_URL?.trim()||null, endpoint, region, missingEnvVars, configured:missingEnvVars.length===0 }; }
function hmac(key: crypto.BinaryLike, data:string){ return crypto.createHmac("sha256", key).update(data).digest(); }
function hashHex(data: crypto.BinaryLike){ return crypto.createHash("sha256").update(data).digest("hex"); }
function amzDate(d=new Date()){ return d.toISOString().replace(/[:-]|\.\d{3}/g,""); }
function encodePath(path:string){ return path.split("/").map(encodeURIComponent).join("/"); }
async function signedFetch(method:string, key:string, body?:Buffer|string, contentType="application/octet-stream"){ const c=getR2Config(); if(!c.configured) throw new Error(`R2 not configured: missing ${c.missingEnvVars.join(", ")}`); const url=new URL(`${c.endpoint}/${c.bucket}${key?`/${encodePath(key)}`:""}`); const now=amzDate(); const date=now.slice(0,8); const payloadHash=hashHex(body ? Buffer.from(body) : Buffer.alloc(0)); const headers:Record<string,string>={ host:url.host, "x-amz-content-sha256":payloadHash, "x-amz-date":now }; if(body) headers["content-type"]=contentType; const signedHeaders=Object.keys(headers).sort().join(";"); const canonicalHeaders=Object.keys(headers).sort().map(k=>`${k}:${headers[k]}\n`).join(""); const canonical=[method, url.pathname, url.searchParams.toString(), canonicalHeaders, signedHeaders, payloadHash].join("\n"); const scope=`${date}/${c.region}/s3/aws4_request`; const stringToSign=["AWS4-HMAC-SHA256", now, scope, hashHex(canonical)].join("\n"); const kDate=hmac(`AWS4${c.secretAccessKey}`, date); const kRegion=hmac(kDate,c.region); const kService=hmac(kRegion,"s3"); const kSigning=hmac(kService,"aws4_request"); const signature=crypto.createHmac("sha256", kSigning).update(stringToSign).digest("hex"); headers.authorization=`AWS4-HMAC-SHA256 Credential=${c.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`; return fetch(url, { method, headers, body: body as BodyInit | undefined, cache:"no-store" }); }
export function computeContentHash(payload: unknown){ return hashHex(Buffer.isBuffer(payload)?payload: typeof payload === "string" ? payload : JSON.stringify(payload)); }
function clean(v:unknown, fallback="unknown"){ return String(v ?? fallback).trim().toLowerCase().replace(/[^a-z0-9._=-]+/g,"-").replace(/^-+|-+$/g,"") || fallback; }
function keyDate(v:string){ return clean(v).replace(/[^a-z0-9._=-]+/g,"-"); }
export function buildR2Key(source:string, assetType:string, symbol:string|null, dataType:string, dateKey:string, extraMetadata:Record<string,unknown>={}){
  const s=clean(source); const a=clean(assetType); const sym=symbol?clean(symbol).toUpperCase():"_all"; const d=clean(dataType); const dk=keyDate(dateKey);
  const year=keyDate(String(extraMetadata.year ?? dk)); const quarter=String(extraMetadata.quarter ?? "").replace(/^q/i,"");
  if(s==="fmp" && a==="stocks" && ["profile","quotes","historical-prices","financials","ratios","metrics","analyst-estimates","price-targets"].includes(d)) return `raw/fmp/stocks/${sym}/${d}/${dk}.json`;
  if(s==="fmp" && d==="news") return `raw/fmp/news/${sym}/${dk}.json`;
  if(s==="fmp" && d==="press-releases") return `raw/fmp/press-releases/${sym}/${dk}.json`;
  if(s==="fmp" && d==="transcripts") return `raw/fmp/transcripts/${sym}/${year}/q${quarter || clean(extraMetadata.period ?? "unknown")}.json`;
  if(s==="fmp" && d==="sec-filings") return `raw/fmp/sec-filings/${sym}/${clean(extraMetadata.formType ?? "filing")}/${clean(extraMetadata.accession ?? dk)}.json`;
  if(s==="sec") return `raw/sec/${sym}/${clean(extraMetadata.formType ?? d)}/${clean(extraMetadata.accession ?? dk)}.json`;
  if(s==="marketaux") return `raw/marketaux/news/${sym}/${dk}.json`;
  if(s==="alpha-vantage") return `raw/alpha-vantage/${sym}/${d}/${dk}.json`;
  if(s==="gdelt") return `raw/gdelt/events/${dk}.json`;
  if(s==="fred") return `raw/fred/${sym === "_ALL" ? clean(extraMetadata.seriesId ?? "series") : sym}/${dk}.json`;
  if(s==="frankfurter") return `raw/frankfurter/${sym === "_ALL" ? clean(extraMetadata.baseCurrency ?? "base") : sym}/${dk}.json`;
  if(s==="coingecko") return `raw/coingecko/${sym === "_ALL" ? clean(extraMetadata.assetId ?? "asset") : sym}/${dk}.json`;
  if(s==="openfda") return `raw/openfda/${clean(extraMetadata.category ?? a)}/${dk}.json`;
  return `raw/${s}/${a}/${sym}/${d}/${dk}.json`;
}
function sanitizeForR2(value:unknown, depth=0):unknown{
  if(depth>8) return "[max-depth]";
  if(Array.isArray(value)) return value.map((item)=>sanitizeForR2(item, depth+1));
  if(value && typeof value === "object"){
    const out:Record<string,unknown>={};
    for(const [k,v] of Object.entries(value as Record<string,unknown>)){
      if(/authorization|cookie|set-cookie|x-api-key|api[_-]?key|access[_-]?key|secret|token|password|headers/i.test(k)){ out[k]="[redacted]"; continue; }
      out[k]=sanitizeForR2(v, depth+1);
    }
    return out;
  }
  return value;
}
export async function objectExistsInR2(r2Key:string){ const res=await signedFetch("HEAD", r2Key); if(res.status===404) return false; if(!res.ok) throw new Error(`R2 head failed with status ${res.status}`); return true; }
export async function readRawDataFromR2(r2Key:string){ const res=await signedFetch("GET", r2Key); if(!res.ok) throw new Error(`R2 read failed with status ${res.status}`); return res.text(); }
async function put(r2Key:string, body:Buffer|string, contentType:string, metadata:Record<string,unknown>={}){ const res=await signedFetch("PUT", r2Key, body, contentType); if(!res.ok) throw new Error(`R2 write failed with status ${res.status}`); return indexRawDataObject(r2Key, body, metadata); }
export const saveJsonToR2=(r2Key:string, payload:unknown, metadata:Record<string,unknown>={})=>put(r2Key, JSON.stringify(sanitizeForR2(payload)), "application/json", sanitizeForR2(metadata) as Record<string,unknown>);
export const saveTextToR2=(r2Key:string, payload:string, metadata:Record<string,unknown>={})=>put(r2Key, payload, "text/plain; charset=utf-8", metadata);
export const saveBinaryToR2=(r2Key:string, payload:Buffer, metadata:Record<string,unknown>={})=>put(r2Key, payload, "application/octet-stream", metadata);
export async function saveRawDataToR2(source:string, assetType:string, symbol:string|null, dataType:string, dateKey:string, payload:unknown, metadata:Record<string,unknown>={}){ const r2Key=buildR2Key(source, assetType, symbol, dataType, dateKey, metadata); return saveJsonToR2(r2Key, payload, { ...metadata, source, assetType, symbol, dataType }); }
export async function indexRawDataObject(r2Key:string, body:Buffer|string, metadata:Record<string,unknown>={}){ if(!process.env.DATABASE_URL) return null; const byteSize=Buffer.byteLength(body); const contentHash=computeContentHash(body); const source=String(metadata.source ?? r2Key.split("/")[1] ?? "unknown"); const assetType=String(metadata.assetType ?? r2Key.split("/")[2] ?? "unknown"); const symbol=metadata.symbol ? String(metadata.symbol) : null; const dataType=String(metadata.dataType ?? r2Key.split("/")[4] ?? "unknown"); const recordCount=Array.isArray(metadata.records)?metadata.records.length:(typeof metadata.recordCount==="number"?metadata.recordCount:null); return prisma.rawDataObject.upsert({ where:{ contentHash }, create:{ source, assetType, symbol, normalizedSymbol:symbol?.toUpperCase()??null, dataType, r2Key, contentHash, byteSize, recordCount, status:"stored", providerPlanStatus:String(metadata.providerPlanStatus ?? "unknown"), sourceUrl: metadata.sourceUrl ? String(metadata.sourceUrl) : null, receiptUrl: metadata.receiptUrl ? String(metadata.receiptUrl) : null, metadata: metadata as object }, update:{ storedAt:new Date(), r2Key, byteSize, recordCount, status:"stored", metadata: metadata as object }}); }
function safeMessage(e:unknown){ return e instanceof Error ? e.message.replace(/(secret|key|token|password)=?[^\s&]*/gi,"$1=[redacted]").slice(0,220) : "R2 request failed"; }
export async function checkR2Health(confirmWrite=false):Promise<R2Health>{ const c=getR2Config(); const base={ connected:false, configured:c.configured, bucket:c.bucket||null, endpointHost:c.endpoint ? new URL(c.endpoint).host : null, canRead:false, canWrite:false, canDelete:false, lastChecked:new Date().toISOString(), missingEnvVars:c.missingEnvVars, errorCategory:null, errorMessageSafe:null }; if(!c.configured) return { ...base, errorCategory:"missing_env", errorMessageSafe:"Cloudflare R2 environment variables are incomplete." }; try { const head=await signedFetch("HEAD", ""); if(!head.ok) return { ...base, errorCategory:`bucket_${head.status}`, errorMessageSafe:`R2 bucket check failed with status ${head.status}` }; const health={...base, connected:true, canRead:true}; if(confirmWrite){ const testKey=`logs/r2-health/${Date.now()}.json`; const body=JSON.stringify({ service:"swing-up", kind:"r2-health", checkedAt:new Date().toISOString() }); const write=await signedFetch("PUT", testKey, body, "application/json"); health.canWrite=write.ok; const read=write.ok ? await signedFetch("GET", testKey) : null; const readText=read?.ok ? await read.text().catch(()=>"") : ""; health.canRead=Boolean(read?.ok && readText === body); const del=write.ok ? await signedFetch("DELETE", testKey) : null; health.canDelete=Boolean(del?.ok); health.connected=health.canRead && health.canWrite && health.canDelete; } return health; } catch(e){ return { ...base, errorCategory:"request_error", errorMessageSafe:safeMessage(e) }; } }
export async function getRawWarehouseStatus(){ if(!process.env.DATABASE_URL) return { count:0, latest:null, snapshots:0 }; const [count, latest, snapshots]=await Promise.all([prisma.rawDataObject.count().catch(()=>0), prisma.rawDataObject.findFirst({orderBy:{storedAt:"desc"}}).catch(()=>null), prisma.rawDataObject.count({where:{r2Key:{startsWith:"universe/"}}}).catch(()=>0)]); return { count, latest, snapshots }; }

export async function trySaveRawDataToR2(source:string, assetType:string, symbol:string|null, dataType:string, dateKey:string, payload:unknown, metadata:Record<string,unknown>={}){
  const cfg=getR2Config();
  if(!cfg.configured) return { saved:false, reason:"r2_not_configured", missingEnvVars:cfg.missingEnvVars, r2Key:buildR2Key(source, assetType, symbol, dataType, dateKey, metadata) };
  try { const row=await saveRawDataToR2(source, assetType, symbol, dataType, dateKey, payload, metadata); return { saved:true, r2Key:row?.r2Key ?? buildR2Key(source, assetType, symbol, dataType, dateKey, metadata), rawDataObjectId:row?.id ?? null }; }
  catch(error){ return { saved:false, reason:"r2_save_failed", errorMessageSafe:error instanceof Error ? error.message.slice(0,160) : "R2 save failed", r2Key:buildR2Key(source, assetType, symbol, dataType, dateKey, metadata) }; }
}
