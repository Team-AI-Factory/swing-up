import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { buildProofBundleForRawSignal } from "@/lib/proof/proof-bundle-builder";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function GET(request: NextRequest) {
  const rawSignalId = text(request.nextUrl.searchParams.get("rawSignalId") ?? request.nextUrl.searchParams.get("raw_signal_id"));
  if (!rawSignalId) return NextResponse.json({ ok: false, error: "rawSignalId is required." }, { status: 400 });
  if (!uuidPattern.test(rawSignalId)) return NextResponse.json({ ok: false, error: "rawSignalId must be a valid id." }, { status: 400 });

  try {
    const bundle = await buildProofBundleForRawSignal(rawSignalId);
    if (!bundle) return NextResponse.json({ ok: false, error: "Raw signal not found." }, { status: 404 });
    return NextResponse.json(bundle);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2023") return NextResponse.json({ ok: false, error: "rawSignalId must be a valid id." }, { status: 400 });
    return NextResponse.json({ ok: false, error: "Unable to build proof bundle preview." }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  let body: { rawSignalId?: unknown; raw_signal_id?: unknown };
  try {
    body = (await request.json()) as { rawSignalId?: unknown; raw_signal_id?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "Request body must be valid JSON." }, { status: 400 });
  }

  const rawSignalId = text(body.rawSignalId ?? body.raw_signal_id);
  if (!rawSignalId) return NextResponse.json({ ok: false, error: "rawSignalId is required." }, { status: 400 });
  if (!uuidPattern.test(rawSignalId)) return NextResponse.json({ ok: false, error: "rawSignalId must be a valid id." }, { status: 400 });

  try {
    const bundle = await buildProofBundleForRawSignal(rawSignalId);
    if (!bundle) return NextResponse.json({ ok: false, error: "Raw signal not found." }, { status: 404 });
    return NextResponse.json(bundle);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2023") return NextResponse.json({ ok: false, error: "rawSignalId must be a valid id." }, { status: 400 });
    return NextResponse.json({ ok: false, error: "Unable to build proof bundle preview." }, { status: 500 });
  }
}
