import { createHash } from "node:crypto";
import { prisma } from "@/lib/db/client";
import { attribution, sameOrigin, smallJson } from "@/lib/growth/validation";
import { allowRequest } from "@/lib/growth/rate-limit";
export const runtime = "nodejs";
export async function POST(request: Request) {
  if (!sameOrigin(request)) return new Response(null, { status: 403 });
  try {
    if (!(await allowRequest(request, "visit", 120))) return new Response(null, { status: 429 });
    const body = await smallJson(request) as { session?: string; source?: string; content?: string };
    if (typeof body.session !== "string" || !/^[a-zA-Z0-9-]{20,80}$/.test(body.session)) return new Response(null, { status: 400 });
    const tags = attribution(body);
    const visitKey = createHash("sha256").update(`${new Date().toISOString().slice(0, 10)}:${body.session}:${tags.source}:${tags.content}`).digest("hex");
    await prisma.growthVisit.upsert({ where: { visitKey }, create: { visitKey, ...tags }, update: tags });
    return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  } catch { return new Response(null, { status: 503 }); }
}
