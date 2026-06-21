import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, context: Context) {
  const { id } = await context.params;
  if (!process.env.DATABASE_URL) return NextResponse.json({ ok: false, error: "DATABASE_URL is not configured; no AI committee run can be loaded." }, { status: 503 });

  try {
    const run = await prisma.aiCommitteeRun.findUnique({
      where: { id },
      include: { agentResults: { orderBy: { createdAt: "asc" } } },
    });
    if (!run) return NextResponse.json({ ok: false, error: "ai_committee_run_not_found" }, { status: 404 });
    return NextResponse.json({ ok: true, run });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2023") return NextResponse.json({ ok: false, error: "id must be a valid UUID." }, { status: 400 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021") return NextResponse.json({ ok: false, error: "AI committee run persistence table has not been migrated yet." }, { status: 503 });
    return NextResponse.json({ ok: false, error: "ai_committee_run_unavailable" }, { status: 500 });
  }
}
