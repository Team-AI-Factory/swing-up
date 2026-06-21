import { Prisma } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";
import { buildAiCommitteeEvidencePack } from "@/lib/ai-committee/evidence-pack";

export async function GET(request: NextRequest) {
  const candidateAlertId = request.nextUrl.searchParams.get("candidateAlertId")?.trim() ?? "";
  const dryRun = request.nextUrl.searchParams.get("dryRun") !== "false";

  if (!candidateAlertId) {
    return NextResponse.json({ ok: false, dryRun: true, candidateAlertId: null, evidencePack: null, missingRequiredEvidence: ["candidateAlertId"], warnings: ["candidateAlertId query parameter is required."], readyForCommittee: false, error: "candidateAlertId is required." }, { status: 400 });
  }

  if (!dryRun) {
    return NextResponse.json({ ok: false, dryRun: true, candidateAlertId, evidencePack: null, missingRequiredEvidence: [], warnings: ["Only dryRun=true is supported. No committee calls, publishing, or notifications are performed."], readyForCommittee: false, error: "dryRun must be true." }, { status: 400 });
  }

  try {
    const result = await buildAiCommitteeEvidencePack(candidateAlertId);
    return NextResponse.json(result, { status: result.ok ? 200 : result.error === "candidate_alert_not_found" ? 404 : 400 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2023") {
      return NextResponse.json({ ok: false, dryRun: true, candidateAlertId, evidencePack: null, missingRequiredEvidence: ["valid candidateAlertId"], warnings: ["candidateAlertId must be a valid id."], readyForCommittee: false, error: "invalid_candidateAlertId" }, { status: 400 });
    }
    return NextResponse.json({ ok: false, dryRun: true, candidateAlertId, evidencePack: null, missingRequiredEvidence: [], warnings: ["Unable to build evidence pack safely."], readyForCommittee: false, error: "evidence_pack_preview_failed" }, { status: 500 });
  }
}
