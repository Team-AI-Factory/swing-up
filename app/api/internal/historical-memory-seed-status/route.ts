import { NextResponse } from "next/server";
import { getHistoricalMemorySeedStatus } from "@/lib/historical-memory-seed";
import { withRedactionMetadata } from "@/lib/redact-secrets";
export const dynamic = "force-dynamic";
export async function GET() { const result = await getHistoricalMemorySeedStatus().catch((e) => ({ enabled: false, r2Available: false, storedRawSignalsAvailable: false, storedEventsFound: 0, eventsWithOutcomeLabels: 0, tickersWithMemory: [], sampleSizeWarnings: [e instanceof Error ? e.message.slice(0, 120) : "status_failed"], secretsRedacted: true, redactionMode: "metadata_only_safe_errors" })); return NextResponse.json(withRedactionMetadata({ ok: true, ...result })); }
