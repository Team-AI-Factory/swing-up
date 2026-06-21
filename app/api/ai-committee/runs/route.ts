import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";

function safeLimit(value: string | null) {
  const parsed = Number(value ?? 20);
  return Math.max(1, Math.min(100, Number.isFinite(parsed) ? Math.floor(parsed) : 20));
}

export async function GET(request: NextRequest) {
  const limit = safeLimit(request.nextUrl.searchParams.get("limit"));
  if (!process.env.DATABASE_URL) return NextResponse.json({ ok: true, limit, runs: [], warning: "DATABASE_URL is not configured; no AI committee runs can be loaded." });

  try {
    const runs = await prisma.aiCommitteeRun.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        candidateAlertId: true,
        alertId: true,
        status: true,
        runMode: true,
        dryRun: true,
        agentIds: true,
        finalRecommendation: true,
        selectedActionLabel: true,
        scoreOutputs: true,
        riskLevel: true,
        complianceWarnings: true,
        missingData: true,
        modelProvider: true,
        modelNames: true,
        tokenEstimate: true,
        estimatedCostCents: true,
        startedAt: true,
        finishedAt: true,
        error: true,
        createdAt: true,
        _count: { select: { agentResults: true } },
      },
    });
    return NextResponse.json({ ok: true, limit, runs });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021") return NextResponse.json({ ok: true, limit, runs: [], warning: "AI committee run persistence table has not been migrated yet." });
    return NextResponse.json({ ok: false, error: "ai_committee_runs_unavailable" }, { status: 500 });
  }
}
