import { NextResponse } from "next/server";
import { withRedactionMetadata } from "@/lib/redact-secrets";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(
    withRedactionMetadata({
      ok: true,
      buttonExpectedRoute: "/api/internal/run-live-alert-cycle",
      method: "POST",
      dryRunPayloadSupported: true,
      freeProofRecoveryPayloadSupported: true,
      noOpenAI: true,
      noPublish: true,
      noTelegram: true,
      secretsRedacted: true,
    }),
  );
}
