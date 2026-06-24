import { NextRequest, NextResponse } from "next/server";
import { runHistoricalMemorySeed } from "@/lib/historical-memory-seed";
import { withRedactionMetadata } from "@/lib/redact-secrets";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) { const body = await request.json().catch(() => ({})); const result = await runHistoricalMemorySeed(body).catch((e) => ({ ok: false, enabled: false, dryRun: body.dryRun !== false, confirmRun: body.confirmRun === true, error: e instanceof Error ? e.message.slice(0, 160) : "seed_failed", secretsRedacted: true, redactionMode: "metadata_only_safe_errors", safety: { callsOpenAI: false, publishesAlerts: false, sendsTelegram: false } })); return NextResponse.json(withRedactionMetadata(result)); }
