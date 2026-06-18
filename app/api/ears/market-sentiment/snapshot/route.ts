import { NextResponse } from "next/server";
import { getMarketSentimentSnapshot } from "@/lib/ears/market-sentiment";

export async function GET() {
  const snapshot = await getMarketSentimentSnapshot();
  return NextResponse.json(snapshot);
}
