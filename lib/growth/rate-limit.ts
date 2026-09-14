import { createHmac } from "node:crypto";
import { prisma } from "@/lib/db/client";
export async function allowRequest(request: Request, scope: string, maximum: number) {
  const secret = process.env.EARLY_ACCESS_RATE_SECRET || process.env.DATABASE_URL;
  if (!secret) return false;
  const now = Date.now();
  const bucket = Math.floor(now / 3_600_000);
  const ip = request.headers.get("x-real-ip") || request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() || "unknown";
  const key = `${scope}:${bucket}:` + createHmac("sha256", secret).update(ip).digest("hex");
  const row = await prisma.growthRateLimit.upsert({ where: { key }, create: { key, expiresAt: new Date(now + 86_400_000) }, update: { count: { increment: 1 } } });
  return row.count <= maximum;
}
