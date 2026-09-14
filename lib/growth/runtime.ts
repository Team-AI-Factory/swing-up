import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { getValuationWatchlistStatus } from "@/lib/opportunity-engine/valuation-watchlist-feed";
import { CHANNELS, SLOT_ACTIONS, candidateProblem, captionFor, makeSnapshot, publicBaseUrl, slotsForDay, type Channel, type ResearchSnapshot } from "@/lib/growth/research";
import { bufferConfiguration, BufferError, deliveryState, findBufferPost, publishBufferImage, readBufferPost, verifyBufferChannels } from "@/lib/growth/buffer";

export function growthEnabled() {
  return process.env.SWING_UP_GROWTH_ENABLED === "true" && process.env.RAILWAY_ENVIRONMENT_NAME === "production" && process.env.RAILWAY_SERVICE_ID === "d02bf6e1-4140-418f-aa5c-b67dcc2d8d15";
}
async function prepareSignal(key: string, at: Date, action: typeof SLOT_ACTIONS[number], now: Date) {
  const existing = await prisma.socialSignal.findUnique({ where: { scheduleKey: key } });
  if (existing) return existing;
  const [feed, recent] = await Promise.all([
    getValuationWatchlistStatus({ limit: 200, action }),
    prisma.socialSignal.findMany({ where: { scheduledAt: { gte: new Date(now.getTime() - 24 * 3_600_000) } }, select: { ticker: true } }),
  ]);
  const used = new Set(recent.map((row) => row.ticker));
  const candidate = feed.candidates.find((item) => !used.has(item.ticker) && !candidateProblem(item, now));
  if (!candidate) throw new Error(`Held ${action}: no fresh, complete, non-repeated candidate`);
  const snapshot = makeSnapshot(candidate, now);
  return prisma.$transaction(async (tx) => {
    const signal = await tx.socialSignal.create({ data: { scheduleKey: key, ticker: candidate.ticker, sourceId: candidate.id, snapshot: snapshot as unknown as Prisma.InputJsonValue, scheduledAt: at } });
    await tx.socialDelivery.createMany({ data: CHANNELS.map((channel) => ({ signalId: signal.id, channel, caption: captionFor(snapshot, channel, signal.id, publicBaseUrl()), status: key.startsWith("preview-") ? "preview" : "awaiting_connection" })) });
    return signal;
  });
}
async function deliver(signalId: string, now: Date) {
  const rows = await prisma.socialDelivery.findMany({ where: { signalId, status: "awaiting_connection" }, include: { signal: true } });
  for (const row of rows) {
    const snapshot = row.signal.snapshot as unknown as ResearchSnapshot;
    if (now.getTime() - Date.parse(snapshot.priceObservedAt) > 90 * 60_000) {
      await prisma.socialDelivery.update({ where: { id: row.id }, data: { status: "held", failure: "Snapshot price expired before publication" } }); continue;
    }
    const claimed = await prisma.socialDelivery.updateMany({ where: { id: row.id, status: "awaiting_connection" }, data: { status: "sending", checkedAt: now } });
    if (claimed.count !== 1) continue;
    try {
      const post = await publishBufferImage(row.channel as Channel, row.caption, `${publicBaseUrl()}/api/public/social-image/${signalId}`);
      await prisma.socialDelivery.update({ where: { id: row.id }, data: { status: deliveryState(post), providerPostId: post.id, externalUrl: post.externalLink, checkedAt: new Date(), failure: null } });
    } catch (error) {
      // Even a successful provider call followed by a DB failure is ambiguous. Never blindly resend.
      await prisma.socialDelivery.update({ where: { id: row.id }, data: { status: error instanceof BufferError && !error.uncertain ? "failed" : "unknown", failure: error instanceof BufferError ? error.message : "Publication outcome unknown; reconciliation required", checkedAt: new Date() } });
    }
  }
}
async function reconcile(now: Date) {
  const rows = await prisma.socialDelivery.findMany({ where: { status: { in: ["scheduled", "sending", "unknown"] }, OR: [{ checkedAt: null }, { checkedAt: { lt: new Date(now.getTime() - 60 * 60_000) } }] }, orderBy: { updatedAt: "asc" }, take: 12 });
  for (const row of rows) {
    try {
      const post = row.providerPostId ? await readBufferPost(row.providerPostId) : await findBufferPost(row.channel as Channel, `/go/${row.channel}/${row.signalId}`, new Date(row.createdAt.getTime() - 60_000));
      await prisma.socialDelivery.update({ where: { id: row.id }, data: post ? { status: deliveryState(post), providerPostId: post.id, externalUrl: post.externalLink, checkedAt: now } : { status: "unknown", checkedAt: now, failure: "No matching provider post found. Automatic resend is disabled to avoid duplicates." } });
    } catch { await prisma.socialDelivery.update({ where: { id: row.id }, data: { checkedAt: now, failure: "Provider status unavailable; will check again" } }); }
  }
}
export async function runGrowthTick(now = new Date()) {
  if (!growthEnabled()) return { status: "disabled" };
  await prisma.growthRuntime.upsert({ where: { key: "publisher" }, create: { key: "publisher", leaseUntil: new Date(0) }, update: { key: "publisher" } });
  const leaseId = randomUUID();
  const claimed = await prisma.growthRuntime.updateMany({ where: { key: "publisher", leaseUntil: { lt: now } }, data: { leaseId, leaseUntil: new Date(now.getTime() + 5 * 60_000), checkedAt: now } });
  if (!claimed.count) return { status: "busy" };
  let status = "ready"; let detail = "Three daily slots: 02:00, 10:00, 16:00 UTC (09:00, 17:00, 23:00 Bangkok).";
  try {
    // A single initial pack is publicly reviewable before any social account is connected.
    for (const action of SLOT_ACTIONS) {
      try { await prepareSignal(`preview-${action}`, now, action, now); }
      catch (error) { detail = error instanceof Error ? error.message : "Preview preparation failed"; }
    }
    const configuration = bufferConfiguration();
    if (!configuration.ready) { status = "awaiting_connection"; detail = "Research generation is active. Social publishing needs the three Swing Up accounts connected through Buffer."; }
    const slots = slotsForDay(now).filter((slot) => now >= slot.at && now.getTime() - slot.at.getTime() < 20 * 60_000);
    for (const slot of slots) {
      try {
        const signal = await prepareSignal(slot.key, slot.at, slot.action, now);
        if (configuration.ready && await prisma.socialDelivery.count({ where: { signalId: signal.id, status: "awaiting_connection" } })) {
          await verifyBufferChannels();
          await deliver(signal.id, now);
        }
      } catch (error) { status = "held"; detail = error instanceof Error ? error.message : "The scheduled slot is held"; }
    }
    if (configuration.ready) await reconcile(now);
    // Never release a backlog of stale financial posts after a connection or restart.
    await prisma.socialDelivery.updateMany({ where: { status: "awaiting_connection", signal: { scheduledAt: { lt: new Date(now.getTime() - 20 * 60_000) } } }, data: { status: "held", failure: "Scheduled window passed; no stale catch-up publication" } });
    const cleanupKey = `cleanup-${now.toISOString().slice(0, 10)}`;
    if (!(await prisma.growthRuntime.findUnique({ where: { key: cleanupKey } }))) {
      await prisma.growthRateLimit.deleteMany({ where: { expiresAt: { lt: now } } });
      await prisma.growthVisit.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 90 * 86_400_000) } } });
      await prisma.earlyAccessLead.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 365 * 86_400_000) } } });
      await prisma.growthRuntime.create({ data: { key: cleanupKey, status: "complete" } });
    }
  } catch (error) { status = "error"; detail = error instanceof BufferError ? error.message : "Growth runtime could not complete this check; it will retry automatically"; }
  finally {
    await prisma.growthRuntime.updateMany({ where: { key: "publisher", leaseId }, data: { status, detail: detail.slice(0, 500), checkedAt: new Date(), leaseUntil: new Date(0), leaseId: "" } });
  }
  return { status, detail };
}
const globalGrowth = globalThis as unknown as { swingUpGrowthTimer?: ReturnType<typeof setInterval> };
export function startGrowthRuntime() {
  if (!growthEnabled() || globalGrowth.swingUpGrowthTimer) return;
  const tick = () => { void runGrowthTick().catch(() => console.error("Swing Up growth check failed; retrying on the next interval")); };
  const first = setTimeout(tick, 15_000); first.unref();
  globalGrowth.swingUpGrowthTimer = setInterval(tick, 60_000);
  globalGrowth.swingUpGrowthTimer.unref();
}
