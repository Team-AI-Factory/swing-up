import { NextRequest, NextResponse } from "next/server";
import { alertVisibilityTier, decideAlertAccess, getAccessDecision } from "@/lib/access-control";

function safeId(value: string | null) {
  const trimmed = value?.trim();
  if (!trimmed) return null;
  return trimmed.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || null;
}

export async function GET(request: NextRequest) {
  const access = await getAccessDecision();
  const requestedId = safeId(request.nextUrl.searchParams.get("alertId") ?? request.nextUrl.searchParams.get("id"));
  const visibilityTier = alertVisibilityTier(request.nextUrl.searchParams.get("tier") ?? request.nextUrl.searchParams.get("visibility"));

  return NextResponse.json(decideAlertAccess(access, requestedId, visibilityTier));
}
