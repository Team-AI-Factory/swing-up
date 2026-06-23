import { NextResponse } from "next/server";
import { checkR2Health, getRawWarehouseStatus } from "@/lib/r2-warehouse";

const sourceBackfillStatus = {
  fmp: "planned", sec: "planned", marketaux: "planned", alphaVantage: "planned", coingecko: "planned", frankfurter: "planned", fred: "planned", openfda: "planned", gdelt: "planned", googleNewsRss: "planned",
};

export async function GET() {
  const [r2, warehouse] = await Promise.all([checkR2Health(false), getRawWarehouseStatus()]);
  return NextResponse.json({ ok: true, rawWarehouseAvailable: r2.connected, r2Bucket: r2.bucket, latestObjectStored: warehouse.latest?.r2Key ?? null, sourceBackfillStatus, historyPolicy: "historical comparison should use max available history per source and asset type", backfillPolicy: r2.connected ? "incremental backfills may be planned per source" : "do not start huge raw full-history backfills until R2 is connected", maxHistoryStoredInR2: warehouse.latest ? "indexed objects present" : "none indexed yet", maxHistoryAvailableFromProvider: "provider-and-plan-dependent; use each source maximum honestly", gapBetweenAvailableAndStored: warehouse.count > 0 ? "needs source-by-source gap audit" : "all configured sources need initial R2 backfill", rawDataObjectCount: warehouse.count });
}
