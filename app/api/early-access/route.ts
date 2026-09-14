import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { allowRequest } from "@/lib/growth/rate-limit";
import { sameOrigin, smallJson, validateSignup } from "@/lib/growth/validation";
import { CONSENT_VERSION, PILOT_PRICE_CENTS } from "@/lib/growth/research";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "no-store" };
export async function POST(request: Request) {
  if (!sameOrigin(request)) return Response.json({ error: "Please use the signup form on Swing Up." }, { status: 403, headers });
  try {
    if (!(await allowRequest(request, "signup", 8))) return Response.json({ error: "Too many attempts. Please try again in an hour." }, { status: 429, headers });
    let input;
    try { input = validateSignup(await smallJson(request)); }
    catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Please check the form." }, { status: 400, headers }); }
    const token = randomBytes(32).toString("hex");
    const manageHash = createHash("sha256").update(token).digest("hex");
    try {
      await prisma.earlyAccessLead.create({ data: { ...input, manageHash, consentVersion: CONSENT_VERSION, priceCents: input.planIntent === "paid_pilot" ? PILOT_PRICE_CENTS : 0 } });
    } catch (error) {
      // An anonymous repeat submission cannot change consent, intent or a deletion credential.
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) throw error;
    }
    // Identical response for existing addresses. Never return the existing lead's private token.
    return Response.json({ ok: true, manageUrl: `/signup/manage#${token}`, message: "Your request is recorded. If you already joined, your original preferences and private link remain in place. No payment has been taken." }, { headers });
  } catch {
    return Response.json({ error: "We could not save your request. Please try again shortly." }, { status: 503, headers });
  }
}
