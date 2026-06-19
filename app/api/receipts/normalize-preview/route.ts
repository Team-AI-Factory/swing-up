import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import {
  mockReceiptInputs,
  normalizeReceipts,
  type NormalizedReceipt,
} from "@/lib/receipt-normalizer";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_SUMMARY_LENGTH = 900;

function persistFlag(payload: unknown) {
  return Boolean(
    payload &&
    typeof payload === "object" &&
    "persist" in payload &&
    (payload as { persist?: unknown }).persist === true,
  );
}

function payloadReceipts(payload: unknown) {
  return payload && typeof payload === "object" && "receipts" in payload
    ? (payload as { receipts: unknown }).receipts
    : payload;
}

function validUuid(value: string | null) {
  return value && uuidPattern.test(value) ? value : null;
}

function collectedAt(receipt: NormalizedReceipt) {
  return receipt.capturedAt ? new Date(receipt.capturedAt) : new Date();
}

function summaryForReceipt(receipt: NormalizedReceipt) {
  const details = [
    receipt.title,
    receipt.capturedSummary,
    receipt.sourceName ? `Source: ${receipt.sourceName}` : null,
    receipt.linkedTicker ? `Ticker: ${receipt.linkedTicker}` : null,
    receipt.linkedCompany ? `Company: ${receipt.linkedCompany}` : null,
    `Reliability: ${receipt.reliabilityScore}/100`,
    receipt.publicReceipt ? "Public receipt: yes" : "Public receipt: no",
    receipt.linkedSignalId ? `Linked signal: ${receipt.linkedSignalId}` : null,
    receipt.linkedHistoricalEventId
      ? `Linked historical event: ${receipt.linkedHistoricalEventId}`
      : null,
    receipt.warnings.length
      ? `Warnings: ${receipt.warnings.join(" | ")}`
      : null,
  ]
    .filter(Boolean)
    .join(" — ");

  return details.length > MAX_SUMMARY_LENGTH
    ? `${details.slice(0, MAX_SUMMARY_LENGTH - 1)}…`
    : details;
}

function duplicateWhere(receipt: NormalizedReceipt, alertId: string | null) {
  if (receipt.sourceUrl) {
    return {
      receiptUrl: receipt.sourceUrl,
      ...(alertId ? { alertId } : {}),
    };
  }

  return {
    sourceType: receipt.sourceType,
    summary: summaryForReceipt(receipt),
    ...(alertId ? { alertId } : {}),
  };
}

async function persistNormalizedReceipts(
  normalizedReceipts: NormalizedReceipt[],
) {
  const saved: Array<{
    id: string;
    receiptUrl: string | null;
    sourceType: string;
    linkedAlertId: string | null;
  }> = [];
  const skipped: Array<{
    sourceUrl: string | null;
    title: string;
    reason: string;
    existingId?: string;
  }> = [];
  const warnings: string[] = [];

  for (const receipt of normalizedReceipts) {
    const alertId = validUuid(receipt.linkedAlertId);
    if (receipt.linkedAlertId && !alertId) {
      warnings.push(
        `Skipped linkedAlertId for ${receipt.title} because it is not a valid UUID.`,
      );
    }

    const duplicate = await prisma.alertSource.findFirst({
      where: duplicateWhere(receipt, alertId),
      select: { id: true },
    });

    if (duplicate) {
      skipped.push({
        sourceUrl: receipt.sourceUrl,
        title: receipt.title,
        reason: "duplicate_existing_receipt",
        existingId: duplicate.id,
      });
      continue;
    }

    const created = await prisma.alertSource.create({
      data: {
        alertId,
        sourceType: receipt.sourceType,
        receiptUrl: receipt.sourceUrl,
        summary: summaryForReceipt(receipt),
        collectedAt: collectedAt(receipt),
      },
      select: { id: true, receiptUrl: true, sourceType: true, alertId: true },
    });

    saved.push({
      id: created.id,
      receiptUrl: created.receiptUrl,
      sourceType: created.sourceType,
      linkedAlertId: created.alertId,
    });
  }

  return {
    savedCount: saved.length,
    skippedCount: skipped.length,
    saved,
    skipped,
    warnings,
  };
}

export async function GET(request: NextRequest) {
  const mock = request.nextUrl.searchParams.get("mock") === "true";
  if (!mock) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "Use ?mock=true for a safe receipts normalization preview, or POST receipt input JSON.",
      },
      { status: 400 },
    );
  }

  return NextResponse.json(normalizeReceipts(mockReceiptInputs));
}

export async function POST(request: NextRequest) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const normalized = normalizeReceipts(payloadReceipts(payload));
  if (!persistFlag(payload)) {
    return NextResponse.json({ ...normalized, persisted: false });
  }

  try {
    const persistence = await persistNormalizedReceipts(
      normalized.normalizedReceipts,
    );
    return NextResponse.json({ ...normalized, persisted: true, persistence });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2003"
    ) {
      return NextResponse.json(
        {
          ...normalized,
          persisted: false,
          error:
            "Receipt normalization succeeded, but persistence failed because a linked record was not found.",
        },
        { status: 409 },
      );
    }

    return NextResponse.json(
      {
        ...normalized,
        persisted: false,
        error:
          "Receipt normalization succeeded, but persistence failed in this environment.",
      },
      { status: 500 },
    );
  }
}
