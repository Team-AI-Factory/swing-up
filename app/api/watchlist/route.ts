import { NextRequest, NextResponse } from "next/server";
import { getAuthReadinessSession } from "@/lib/auth-readiness";
import { addWatchlistItem, listWatchlist, removeWatchlistItem, type WatchlistInput } from "@/lib/watchlist-store";

function responseBody(session: Awaited<ReturnType<typeof getAuthReadinessSession>>, items: unknown[], extra: Record<string, unknown> = {}) {
  return { ok: true, auth: { mode: session.mode, label: session.label, isAuthenticated: session.isAuthenticated }, items, ...extra };
}

export async function GET() {
  const session = await getAuthReadinessSession();
  const items = await listWatchlist(session.ownerId);
  return NextResponse.json(responseBody(session, items));
}

export async function POST(request: NextRequest) {
  const session = await getAuthReadinessSession();
  let payload: WatchlistInput;
  try {
    payload = (await request.json()) as WatchlistInput;
    const item = await addWatchlistItem(session.ownerId, payload);
    return NextResponse.json(responseBody(session, [item], { item }), { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid watchlist payload.";
    return NextResponse.json({ ok: false, error: message, auth: { mode: session.mode, label: session.label } }, { status: 400 });
  }
}

export async function DELETE(request: NextRequest) {
  const session = await getAuthReadinessSession();
  const { searchParams } = request.nextUrl;
  let idOrTicker = searchParams.get("id") ?? searchParams.get("ticker") ?? "";
  if (!idOrTicker) {
    try {
      const payload = (await request.json()) as { id?: string; ticker?: string };
      idOrTicker = payload.id ?? payload.ticker ?? "";
    } catch {}
  }
  const removed = await removeWatchlistItem(session.ownerId, idOrTicker);
  const items = await listWatchlist(session.ownerId);
  return NextResponse.json(responseBody(session, items, { removed }));
}
