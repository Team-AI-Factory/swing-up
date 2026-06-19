import { NextRequest, NextResponse } from "next/server";
import { getAuthReadinessSession } from "@/lib/auth-readiness";
import { getNotificationPreferences, saveNotificationPreferences, type NotificationPreferences } from "@/lib/notification-preferences-store";

function authSummary(session: Awaited<ReturnType<typeof getAuthReadinessSession>>) {
  return { mode: session.mode, label: session.label, isAuthenticated: session.isAuthenticated };
}

export async function GET() {
  const session = await getAuthReadinessSession();
  const preferences = await getNotificationPreferences(session.ownerId);
  return NextResponse.json({ ok: true, auth: authSummary(session), preferences });
}

export async function POST(request: NextRequest) {
  const session = await getAuthReadinessSession();
  try {
    const payload = (await request.json()) as Partial<NotificationPreferences>;
    const preferences = await saveNotificationPreferences(session.ownerId, payload);
    return NextResponse.json({ ok: true, auth: authSummary(session), preferences });
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid notification preference payload.", auth: authSummary(session) }, { status: 400 });
  }
}
