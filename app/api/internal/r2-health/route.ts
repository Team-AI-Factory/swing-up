import { NextRequest, NextResponse } from "next/server";
import { checkR2Health } from "@/lib/r2-warehouse";
import { withRedactionMetadata } from "@/lib/redact-secrets";

export async function GET() {
  const health = await checkR2Health(false);
  return NextResponse.json(
    withRedactionMetadata({
      ...health,
      message:
        "This is read-only health. Use POST with confirmWrite=true to test write/delete.",
    }),
  );
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const confirmWrite = body?.confirmWrite === true;

  if (!confirmWrite) {
    const health = await checkR2Health(false);
    return NextResponse.json(
      withRedactionMetadata({
        ...health,
        sourceOfTruth: "route_did_not_receive_confirmWrite",
        errorCategory: "route_did_not_receive_confirmWrite",
        errorMessageSafe:
          "POST body must include confirmWrite=true to run the R2 write/delete test.",
        message:
          "This POST did not run write/delete. Send JSON body {\"confirmWrite\":true}.",
      }),
      { status: 400 },
    );
  }

  return NextResponse.json(withRedactionMetadata(await checkR2Health(true)));
}
