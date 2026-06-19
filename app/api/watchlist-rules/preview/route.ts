import { NextRequest, NextResponse } from "next/server";
import { evaluateWatchlistRules, mockWatchlistRulesInput, type WatchlistRulesInput } from "@/lib/watchlist-rules";

export async function GET(request: NextRequest) {
  const mock = request.nextUrl.searchParams.get("mock") === "true";
  if (!mock) {
    return NextResponse.json(
      { ok: false, error: "Use ?mock=true for a safe watchlist rules preview, or POST mock user/watchlist/alert data." },
      { status: 400 },
    );
  }

  return NextResponse.json(evaluateWatchlistRules(mockWatchlistRulesInput()));
}

export async function POST(request: NextRequest) {
  let payload: WatchlistRulesInput;
  try {
    payload = (await request.json()) as WatchlistRulesInput;
  } catch {
    return NextResponse.json({ ok: false, error: "Request body must be valid JSON." }, { status: 400 });
  }

  return NextResponse.json(evaluateWatchlistRules(payload));
}
