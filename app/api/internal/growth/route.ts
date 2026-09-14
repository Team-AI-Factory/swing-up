import { prisma } from "@/lib/db/client";
import { internalApiScopeAuthorized } from "@/lib/internal-api-auth";
import { bufferConfiguration } from "@/lib/growth/buffer";
import { growthEnabled } from "@/lib/growth/runtime";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!internalApiScopeAuthorized(request.headers, "serious_signal_read")) return Response.json({ error: "Owner research access key required" }, { status: 401, headers });
  try {
    const since = new Date(Date.now() - 14 * 86_400_000);
    const [leads, visits, deliveries, runtime, recent, verified] = await Promise.all([
      prisma.earlyAccessLead.groupBy({ by: ["source", "planIntent"], where: { createdAt: { gte: since } }, _count: true }),
      prisma.growthVisit.groupBy({ by: ["source"], where: { createdAt: { gte: since } }, _count: true }),
      prisma.socialDelivery.groupBy({ by: ["channel", "status"], where: { createdAt: { gte: since } }, _count: true }),
      prisma.growthRuntime.findUnique({ where: { key: "publisher" }, select: { status: true, detail: true, checkedAt: true } }),
      prisma.socialSignal.findMany({ take: 15, orderBy: { createdAt: "desc" }, select: { id: true, ticker: true, scheduledAt: true, snapshot: true, deliveries: { select: { channel: true, status: true, failure: true, externalUrl: true, caption: true } } } }),
      prisma.earlyAccessLead.count({ where: { verifiedAt: { not: null }, createdAt: { gte: since } } }),
    ]);
    return Response.json({ ok: true, periodDays: 14, generatedAt: new Date(), schedulerEnabled: growthEnabled(), configuration: bufferConfiguration(), runtime, leads, visits, deliveries, recent, verifiedEmails: verified, paymentsCollected: 0, limitations: ["Signup addresses are unverified; duplicates are merged.", "Pilot interest is a stated preference, not a purchase.", "Visits are browser-session counts and can include bots or returning people.", "Social publication requires connected accounts; preparing a card does not mean it was posted."] }, { headers });
  } catch { return Response.json({ error: "Growth report is temporarily unavailable" }, { status: 503, headers }); }
}
