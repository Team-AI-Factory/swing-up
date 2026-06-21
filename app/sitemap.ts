import type { MetadataRoute } from "next";
import { prisma } from "@/lib/db/client";
import { absoluteUrl, canonicalAlertPath } from "@/lib/seo-alerts";

export const dynamic = "force-dynamic";

async function alertUrls(): Promise<MetadataRoute.Sitemap> {
  if (!process.env.DATABASE_URL) return [];
  try {
    const alerts = await prisma.alert.findMany({
      where: { status: { equals: "published", mode: "insensitive" }, publishedAt: { not: null } },
      orderBy: { publishedAt: "desc" },
      take: 500,
      include: { publicLedger: { orderBy: { createdAt: "desc" }, take: 1 } },
    });
    return alerts.map((alert) => ({ url: absoluteUrl(canonicalAlertPath(alert, alert.publicLedger[0]?.publicSlug)), lastModified: alert.publishedAt ?? new Date(), changeFrequency: "daily" as const, priority: 0.8 }));
  } catch { return []; }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const staticUrls: MetadataRoute.Sitemap = ["/", "/alerts", "/ledger", "/public-ledger", "/methodology"].map((path) => ({ url: absoluteUrl(path), lastModified: new Date(), changeFrequency: "daily", priority: path === "/" ? 1 : 0.7 }));
  return [...staticUrls, ...(await alertUrls())];
}
