import { NextRequest, NextResponse } from "next/server";
import { runLiveSourceContractTest } from "@/lib/live-source-contracts";
import { withRedactionMetadata } from "@/lib/redact-secrets";
export const dynamic = "force-dynamic";
export async function POST(request: NextRequest) { const body = await request.json().catch(() => ({})); return NextResponse.json(withRedactionMetadata(await runLiveSourceContractTest(body))); }
