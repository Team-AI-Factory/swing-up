import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { evaluateRawSignalQualityGate, ruleInputFromPayload, ruleInputFromRawSignal, type RawSignalQualityGateInput } from "@/lib/raw-signal-quality-gate";
import { mockRuleFilterInput } from "@/lib/rule-filter";

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as RawSignalQualityGateInput;
    const rawSignalId = text(body.rawSignalId ?? body.id);

    if (rawSignalId) {
      const rawSignal = await prisma.rawSignal.findUnique({ where: { id: rawSignalId } });
      if (!rawSignal) return NextResponse.json({ ok: false, error: "Raw signal not found." }, { status: 404 });
      return NextResponse.json(await evaluateRawSignalQualityGate(ruleInputFromRawSignal(rawSignal), rawSignal.id));
    }

    return NextResponse.json(await evaluateRawSignalQualityGate(ruleInputFromPayload(body)));
  } catch (error) {
    if (error instanceof SyntaxError) return NextResponse.json({ ok: false, error: "Request body must be valid JSON." }, { status: 400 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2023") return NextResponse.json({ ok: false, error: "rawSignalId must be a valid id." }, { status: 400 });
    return NextResponse.json({ ok: false, error: "Unable to run raw signal quality gate." }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get("mock") === "true") {
    return NextResponse.json(await evaluateRawSignalQualityGate(mockRuleFilterInput));
  }

  return NextResponse.json({ ok: true, message: "POST { rawSignalId } or a raw signal-like JSON payload to safely evaluate duplicate and quality gates without publishing alerts, deleting signals, or calling paid AI." });
}
