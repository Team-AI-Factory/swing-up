import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { normalizeReceipts, type NormalizedReceipt } from "@/lib/receipt-normalizer";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
const MAX_SUMMARY_LENGTH = 900;
const candidateStatuses = ["candidate", "draft", "queued", "review", "ready_for_review"];

type AttachReceiptPayload = {
  candidateAlertId?: unknown;
  alertId?: unknown;
  receiptSourceId?: unknown;
  sourceId?: unknown;
  receiptId?: unknown;
  receipt?: unknown;
  receipts?: unknown;
};

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function validUuid(value: unknown) {
  const parsed = text(value);
  return parsed && uuidPattern.test(parsed) ? parsed : null;
}

function receiptInput(payload: AttachReceiptPayload) {
  if (payload.receipt) return payload.receipt;
  if (payload.receipts) return Array.isArray(payload.receipts) ? payload.receipts[0] : payload.receipts;
  return null;
}

function receiptSourceId(payload: AttachReceiptPayload) {
  return validUuid(payload.receiptSourceId) ?? validUuid(payload.sourceId) ?? validUuid(payload.receiptId);
}

function summaryForReceipt(receipt: NormalizedReceipt) {
  const weakLabel = receipt.reliabilityScore < 50 ? "Evidence label: weak" : null;
  const details = [
    receipt.title,
    receipt.capturedSummary,
    receipt.sourceName ? `Source: ${receipt.sourceName}` : null,
    receipt.linkedTicker ? `Ticker: ${receipt.linkedTicker}` : null,
    receipt.linkedCompany ? `Company: ${receipt.linkedCompany}` : null,
    `Reliability: ${receipt.reliabilityScore}/100`,
    weakLabel,
    receipt.publicReceipt ? "Public receipt: yes" : "Public receipt: no",
    receipt.warnings.length ? `Warnings: ${receipt.warnings.join(" | ")}` : null,
  ].filter(Boolean).join(" — ");

  return details.length > MAX_SUMMARY_LENGTH ? `${details.slice(0, MAX_SUMMARY_LENGTH - 1)}…` : details;
}

function validateReceipt(receipt: NormalizedReceipt) {
  const missing: string[] = [];
  if (!receipt.sourceName || receipt.sourceName === "Unknown source") missing.push("sourceName");
  if (!receipt.sourceType || receipt.sourceType === "unknown") missing.push("sourceType");
  if (!receipt.title || receipt.title === "Untitled receipt") missing.push("title");
  if (!receipt.capturedSummary || receipt.capturedSummary === "No receipt summary was provided.") missing.push("capturedSummary");
  return missing;
}

function confidenceImpact(reliabilityScore: number, duplicate: boolean) {
  if (duplicate) return { label: "duplicate_skipped", estimatedDelta: 0 };
  if (reliabilityScore >= 80) return { label: "strong", estimatedDelta: 8 };
  if (reliabilityScore >= 60) return { label: "moderate", estimatedDelta: 5 };
  if (reliabilityScore >= 40) return { label: "weak", estimatedDelta: 2 };
  return { label: "weak", estimatedDelta: 0 };
}

async function findCandidateAlert(alertId: string) {
  return prisma.alert.findFirst({
    where: {
      id: alertId,
      OR: candidateStatuses.map((status) => ({ status: { equals: status, mode: "insensitive" } })),
    },
    include: {
      scores: { orderBy: { createdAt: "desc" }, take: 1 },
      sources: { select: { id: true, receiptUrl: true }, orderBy: { collectedAt: "desc" } },
    },
  });
}

export async function POST(request: NextRequest) {
  let payload: AttachReceiptPayload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Request body must be valid JSON." }, { status: 400 });
  }

  const alertId = validUuid(payload.candidateAlertId) ?? validUuid(payload.alertId);
  if (!alertId) {
    return NextResponse.json({ ok: false, error: "candidateAlertId or alertId must be a valid UUID." }, { status: 400 });
  }

  const alert = await findCandidateAlert(alertId);
  if (!alert) {
    return NextResponse.json({ ok: false, error: "Candidate alert was not found or is not in a candidate review status." }, { status: 404 });
  }

  const existingSourceId = receiptSourceId(payload);
  if (existingSourceId) {
    const source = await prisma.alertSource.findUnique({ where: { id: existingSourceId } });
    if (!source) return NextResponse.json({ ok: false, error: "Receipt source was not found." }, { status: 404 });

    const duplicate = Boolean(source.receiptUrl && alert.sources.some((item) => item.receiptUrl === source.receiptUrl));
    if (duplicate || source.alertId === alertId) {
      return NextResponse.json({ ok: true, attached: false, duplicate: true, receiptCount: alert.sources.length, evidenceConfidenceImpact: confidenceImpact(0, true) });
    }

    if (source.alertId && source.alertId !== alertId) {
      return NextResponse.json({ ok: false, error: "Receipt source is already linked to a different alert." }, { status: 409 });
    }

    await prisma.alertSource.update({ where: { id: source.id }, data: { alertId } });
    return NextResponse.json({ ok: true, attached: true, duplicate: false, receiptCount: alert.sources.length + 1, evidenceConfidenceImpact: { label: "existing_receipt_attached", estimatedDelta: null } });
  }

  const normalized = normalizeReceipts(receiptInput(payload));
  const receipt = normalized.normalizedReceipts[0];
  if (!receipt) return NextResponse.json({ ok: false, error: "receipt or receiptSourceId is required." }, { status: 400 });

  const missingFields = validateReceipt(receipt);
  if (missingFields.length) {
    return NextResponse.json({ ok: false, error: "Receipt is missing required evidence fields.", missingFields, normalizedReceipt: receipt }, { status: 422 });
  }

  const duplicate = receipt.sourceUrl ? await prisma.alertSource.findFirst({ where: { alertId, receiptUrl: receipt.sourceUrl }, select: { id: true } }) : null;
  if (duplicate) {
    return NextResponse.json({ ok: true, attached: false, duplicate: true, receiptCount: alert.sources.length, evidenceConfidenceImpact: confidenceImpact(receipt.reliabilityScore, true), normalizedReceipt: receipt });
  }

  try {
    const created = await prisma.alertSource.create({
      data: {
        alertId,
        sourceType: receipt.sourceType,
        receiptUrl: receipt.sourceUrl,
        summary: summaryForReceipt(receipt),
        collectedAt: receipt.capturedAt ? new Date(receipt.capturedAt) : new Date(),
      },
      select: { id: true, receiptUrl: true, sourceType: true },
    });

    return NextResponse.json({
      ok: true,
      attached: true,
      duplicate: false,
      receiptCount: alert.sources.length + 1,
      evidenceConfidenceImpact: {
        ...confidenceImpact(receipt.reliabilityScore, false),
        currentEvidenceConfidence: alert.scores[0]?.evidenceConfidence ?? null,
        reliabilityScore: receipt.reliabilityScore,
      },
      receipt: created,
      normalizedReceipt: receipt,
      warnings: normalized.warnings,
    }, { status: 201 });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2003") {
      return NextResponse.json({ ok: false, error: "Receipt could not be attached because a linked record was not found." }, { status: 409 });
    }
    return NextResponse.json({ ok: false, error: "Receipt could not be attached in this environment." }, { status: 500 });
  }
}
