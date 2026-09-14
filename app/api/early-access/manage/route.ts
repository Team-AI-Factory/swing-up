import { createHash } from "node:crypto";
import { prisma } from "@/lib/db/client";
import { allowRequest } from "@/lib/growth/rate-limit";
import { sameOrigin, smallJson } from "@/lib/growth/validation";
export const runtime = "nodejs";
export async function POST(request: Request) {
  const headers = { "Cache-Control": "no-store" };
  if (!sameOrigin(request)) return Response.json({ error: "Use your private Swing Up link." }, { status: 403, headers });
  try {
    if (!(await allowRequest(request, "manage", 20))) return Response.json({ error: "Please try again later." }, { status: 429, headers });
    const body = await smallJson(request) as { token?: string };
    if (typeof body.token !== "string" || !/^[a-f0-9]{64}$/.test(body.token)) return Response.json({ error: "This private link is invalid." }, { status: 400, headers });
    await prisma.earlyAccessLead.deleteMany({ where: { manageHash: createHash("sha256").update(body.token).digest("hex") } });
    return Response.json({ ok: true, message: "Any signup associated with this link has been deleted and will receive no early-access updates." }, { headers });
  } catch { return Response.json({ error: "Unable to complete deletion. Try again shortly." }, { status: 503, headers }); }
}
