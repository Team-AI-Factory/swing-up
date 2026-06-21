import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";
import { absoluteUrl, canonicalAlertPath, SITE_URL } from "@/lib/seo-alerts";

async function publishedUrls() {
  const urls = [absoluteUrl("/alerts"), absoluteUrl("/ledger"), absoluteUrl("/public-ledger")];
  if (!process.env.DATABASE_URL) return urls;
  const alerts = await prisma.alert.findMany({ where: { status: { equals: "published", mode: "insensitive" }, publishedAt: { not: null } }, take: 100, include: { publicLedger: { orderBy: { createdAt: "desc" }, take: 1 } } });
  urls.push(...alerts.map((alert) => absoluteUrl(canonicalAlertPath(alert, alert.publicLedger[0]?.publicSlug))));
  return urls;
}

export async function GET(request: NextRequest) { return submit(request); }
export async function POST(request: NextRequest) { return submit(request); }

async function submit(request: NextRequest) {
  const dryRun = request.nextUrl.searchParams.get("dryRun") !== "false";
  const key = process.env.INDEXNOW_KEY;
  const urls = await publishedUrls();
  if (!key) return NextResponse.json({ ok: true, status: "not_configured", dryRun: true, urlCount: urls.length, urls });
  if (dryRun) return NextResponse.json({ ok: true, status: "dry_run", dryRun, urlCount: urls.length, urls });
  const response = await fetch("https://api.indexnow.org/indexnow", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ host: new URL(SITE_URL).host, key, keyLocation: `${SITE_URL}/indexnow-key`, urlList: urls }) });
  return NextResponse.json({ ok: response.ok, status: response.ok ? "submitted" : "submit_failed", httpStatus: response.status, urlCount: urls.length });
}
