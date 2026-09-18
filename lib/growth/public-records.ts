import { prisma } from "@/lib/db/client";
import { publicResearchSnapshot } from "@/lib/growth/research";
export async function latestResearch(limit = 12) {
  try {
    const rows = await prisma.socialSignal.findMany({ orderBy: { createdAt: "desc" }, take: limit, select: { id: true, snapshot: true, scheduledAt: true, deliveries: { select: { channel: true, status: true, externalUrl: true } } } });
    return { available: true, rows: rows.flatMap((row) => {
      const snapshot = publicResearchSnapshot(row.snapshot);
      return snapshot ? [{ ...row, snapshot }] : [];
    }) };
  } catch { return { available: false, rows: [] }; }
}
