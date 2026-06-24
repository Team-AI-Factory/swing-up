import { NextResponse } from "next/server";
import { buildEarRegistry, earRegistrySummary, EAR_LAYERS } from "@/lib/ear-registry";
import { getR2OperationalStatus } from "@/lib/r2-warehouse";

export const dynamic = "force-dynamic";

export async function GET() {
  const r2 = await getR2OperationalStatus();
  const ears = buildEarRegistry().map((ear) => ({
    ...ear,
    r2RawStorageEnabled: ear.r2RawStorageEnabled && r2.writeAvailable,
  }));
  return NextResponse.json({
    ok: true,
    model: "7-layer ear model",
    productRule: "Market reaction is bonus confirmation only; lack of price movement can indicate early_signal_possible.",
    safetyRules: {
      noAutomaticPublish: true,
      noTelegram: true,
      noOpenAIWhenConfirmRunFalse: true,
      noFakeProof: true,
      noFakeHistory: true,
      noWeakForcedAlerts: true,
    },
    rawWarehouse: {
      r2Connected: r2.connected,
      r2WriteAvailable: r2.writeAvailable,
      rawWarehouseWriteUnavailable: !r2.writeAvailable,
      bucket: r2.rawHealth.bucket,
      storageMode: r2.storageMode,
      lastConfirmedWriteAt: r2.lastConfirmedWriteAt,
      lastConfirmedDeleteAt: r2.lastConfirmedDeleteAt,
      sourceOfTruth: r2.sourceOfTruth,
      detectedEnvNames: r2.rawHealth.detectedEnvNames,
      accessKeyIdFingerprint: r2.rawHealth.accessKeyIdFingerprint,
      nextAction: r2.rawHealth.nextAction,
    },
    layers: EAR_LAYERS,
    summary: earRegistrySummary(),
    ears,
  });
}
