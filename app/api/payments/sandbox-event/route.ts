import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";

const SANDBOX_PROVIDERS = new Set(["sandbox", "test", "stripe_test", "paddle_sandbox", "lemonsqueezy_sandbox"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;

type SandboxPaymentEvent = {
  provider?: unknown;
  eventType?: unknown;
  userId?: unknown;
  mode?: unknown;
  payload?: unknown;
};

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export async function POST(request: NextRequest) {
  let body: SandboxPaymentEvent;
  try {
    body = (await request.json()) as SandboxPaymentEvent;
  } catch {
    return NextResponse.json({ ok: false, error: "Request body must be valid JSON." }, { status: 400 });
  }

  const provider = text(body.provider, "sandbox").toLowerCase();
  const mode = text(body.mode, "sandbox").toLowerCase();
  const eventType = text(body.eventType, "sandbox.event.received").slice(0, 120);
  const userId = text(body.userId);

  if (mode === "live" || !SANDBOX_PROVIDERS.has(provider)) {
    return NextResponse.json(
      { ok: false, status: "rejected_live_or_unknown_provider", reason: "Only sandbox/test payment events are accepted by this route." },
      { status: 400 },
    );
  }

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({
      ok: true,
      status: "sandbox/not_configured",
      persisted: false,
      reason: "DATABASE_URL is not configured, so the sandbox event was acknowledged without storage.",
      safeExplanation: "No real charge was made, no live webhook secret was required, and no payment keys were used.",
      requiredEnvVarNames: ["DATABASE_URL", "PAYMENT_SANDBOX_PROVIDER", "PAYMENT_SANDBOX_WEBHOOK_SECRET"],
    });
  }

  try {
    const event = await prisma.paymentEvent.create({
      data: {
        provider,
        eventType,
        userId: UUID_RE.test(userId) ? userId : undefined,
        payload: (body.payload ?? body) as Prisma.InputJsonValue,
      },
      select: { id: true, createdAt: true },
    });

    return NextResponse.json({
      ok: true,
      status: "sandbox/recorded",
      persisted: true,
      eventId: event.id,
      createdAt: event.createdAt.toISOString(),
      safeExplanation: "Sandbox event recorded for entitlement testing only. No real charge was made and no live payment mode was used.",
      requiredEnvVarNames: ["DATABASE_URL", "PAYMENT_SANDBOX_PROVIDER", "PAYMENT_SANDBOX_WEBHOOK_SECRET"],
    });
  } catch {
    return NextResponse.json({ ok: true, status: "sandbox/not_configured", persisted: false, reason: "Sandbox payment storage is unavailable." });
  }
}
