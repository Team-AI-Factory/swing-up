import { NextResponse } from "next/server";
import { buildEarRegistry, earRegistrySummary, EAR_LAYERS } from "@/lib/ear-registry";
import { checkR2Health } from "@/lib/r2-warehouse";

export const dynamic = "force-dynamic";

export async function GET() {
  const r2 = await checkR2Health(false);
  const ears = buildEarRegistry().map((ear) => ({
    ...ear,
    r2RawStorageEnabled: ear.r2RawStorageEnabled && r2.connected,
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
      r2WriteAvailable: r2.canWrite && r2.canDelete,
      rawWarehouseWriteUnavailable: !(r2.canWrite && r2.canDelete),
      bucket: r2.bucket,
      nextAction: r2.nextAction,
    },
    layers: EAR_LAYERS,
    summary: earRegistrySummary(),
    ears,
  });
}
