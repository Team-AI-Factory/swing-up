import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { getR2OperationalStatus, readRawDataFromR2, saveJsonToR2 } from "@/lib/r2-warehouse";
import { withRedactionMetadata } from "@/lib/redact-secrets";

export const dynamic = "force-dynamic";

type MemoryIndexItem = {
  ticker: string | null;
  eventDate: string | null;
  eventType: string | null;
  proofTypes: string[];
  catalystType: string | null;
  source: string | null;
  title: string | null;
  sourceUrl: string | null;
  greatSignalScore: number | null;
  signalGrade: string | null;
};

function rec(v: unknown): Record<string, unknown> { return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : {}; }
function str(v: unknown) { return typeof v === "string" && v.trim() ? v.trim() : null; }
function num(v: unknown) { return typeof v === "number" && Number.isFinite(v) ? v : null; }
function strings(v: unknown) { return Array.isArray(v) ? v.map(String).filter(Boolean) : []; }

function itemFromCandidate(raw: unknown): MemoryIndexItem {
  const r = rec(raw);
  const payload = rec(r.payload);
  return {
    ticker: str(r.ticker) ?? str(payload.ticker),
    eventDate: str(r.receivedAt) ?? str(payload.publishedAt) ?? str(payload.date),
    eventType: str(payload.eventType) ?? str(payload.type) ?? str(payload.category) ?? "raw_signal",
    proofTypes: strings(payload.proofTypes),
    catalystType: str(payload.catalystType) ?? str(payload.catalyst),
    source: str(r.source) ?? str(payload.source),
    title: str(r.title) ?? str(payload.title),
    sourceUrl: str(r.sourceUrl) ?? str(payload.url) ?? str(payload.sourceUrl),
    greatSignalScore: num(payload.greatSignalScore) ?? num(payload.finalGreatSignalScore),
    signalGrade: str(payload.signalGrade),
  };
}

async function buildIndexFromStage1Objects(r2WriteConfirmed: boolean) {
  if (!process.env.DATABASE_URL) return { stage1ObjectsFound: 0, index: [] as MemoryIndexItem[], indexObjectKey: null as string | null };
  const stage1Objects = await prisma.rawDataObject.findMany({
    where: { r2Key: { startsWith: "raw/stage1/" } },
    orderBy: { storedAt: "desc" },
    take: 50,
  }).catch(() => []);
  const candidateObjects = stage1Objects.filter((o) => o.r2Key.startsWith("raw/stage1/candidates/"));
  const index: MemoryIndexItem[] = [];
  for (const object of candidateObjects.slice(0, 20)) {
    const text = await readRawDataFromR2(object.r2Key).catch(() => null);
    if (!text) continue;
    const parsed = JSON.parse(text) as unknown;
    const rawSignals = Array.isArray(rec(parsed).rawSignals) ? rec(parsed).rawSignals as unknown[] : [];
    index.push(...rawSignals.map(itemFromCandidate));
  }
  let indexObjectKey: string | null = null;
  if (r2WriteConfirmed && index.length) {
    indexObjectKey = `historical-memory/foundation-index/${new Date().toISOString().slice(0, 10)}/${Date.now()}.json`;
    await saveJsonToR2(indexObjectKey, { createdAt: new Date().toISOString(), outcomeLabelsCreated: false, index }, { source: "historical-memory", assetType: "foundation", dataType: "memory-index", recordCount: index.length }).catch(() => null);
  }
  return { stage1ObjectsFound: stage1Objects.length, index, indexObjectKey };
}

export async function GET() {
  const r2 = await getR2OperationalStatus();
  const built = await buildIndexFromStage1Objects(r2.writeAvailable);
  const memoryIndexObjectsFound = process.env.DATABASE_URL ? await prisma.rawDataObject.count({ where: { r2Key: { startsWith: "historical-memory/foundation-index/" } } }).catch(() => 0) : 0;
  const tickersWithMemory = Array.from(new Set(built.index.map((i) => i.ticker).filter(Boolean) as string[]));
  const eventTypesWithMemory = Array.from(new Set(built.index.map((i) => i.eventType).filter(Boolean) as string[]));
  const sampleSizeWarnings = [built.index.length < 25 ? "Small sample: foundation index is not enough for historical pattern matching yet." : null, "No outcome labels created; real price history is required before outcome labels."].filter(Boolean);
  return NextResponse.json(withRedactionMetadata({
    ok: true,
    r2Available: r2.connected || r2.canRead,
    r2WriteConfirmed: r2.writeAvailable,
    stage1ObjectsFound: built.stage1ObjectsFound,
    memoryIndexObjectsFound,
    tickersWithMemory,
    eventTypesWithMemory,
    readyForHistoricalPatternMatching: r2.writeAvailable && built.index.length >= 25,
    sampleSizeWarnings,
    latestIndexObjectKey: built.indexObjectKey,
    outcomeLabelsCreated: false,
  }));
}
