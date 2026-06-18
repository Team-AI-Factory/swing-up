import { NextRequest, NextResponse } from "next/server";
import { buildMarketSentimentImpact, loadLatestMarketSentimentSnapshot, mockScoreInput, scoreSwingUpAlert, type ScorePreviewInput } from "@/lib/scoring-engine";

async function score(input: ScorePreviewInput) {
  const sentiment = buildMarketSentimentImpact(await loadLatestMarketSentimentSnapshot());
  return scoreSwingUpAlert(input, sentiment);
}

export async function GET(request: NextRequest) {
  const mock = request.nextUrl.searchParams.get("mock") === "true";
  if (!mock) {
    return NextResponse.json({ ok: false, error: "Use ?mock=true for a safe preview payload, or POST an alert payload." }, { status: 400 });
  }

  return NextResponse.json({ ok: true, mode: "mock_preview", score: await score(mockScoreInput()) });
}

export async function POST(request: NextRequest) {
  let payload: ScorePreviewInput;
  try {
    payload = (await request.json()) as ScorePreviewInput;
  } catch {
    return NextResponse.json({ ok: false, error: "Request body must be valid JSON." }, { status: 400 });
  }

  return NextResponse.json({ ok: true, mode: "preview_only", score: await score(payload) });
}
