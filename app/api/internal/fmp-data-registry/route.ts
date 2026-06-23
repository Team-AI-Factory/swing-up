import { NextResponse } from "next/server";

const FMP_REGISTRY = [
  { endpoint: "/stable/profile", assetType: "stocks", purpose: "company profile diagnostics", smokeTest: true },
  { endpoint: "/stable/search-symbol", assetType: "stocks", purpose: "symbol search diagnostics", smokeTest: true },
  { endpoint: "/stable/stock-list", assetType: "stocks", purpose: "stock universe discovery diagnostics", smokeTest: true },
  { endpoint: "/stable/news/stock", assetType: "stocks", purpose: "stock catalyst news", writesFinalAlerts: false },
  { endpoint: "/stable/news/press-releases", assetType: "stocks", purpose: "company press-release catalysts", writesFinalAlerts: false },
  { endpoint: "/stable/quote", assetType: "stocks", purpose: "bonus price/volume context only", hardGate: false },
  { endpoint: "/stable/earnings", assetType: "stocks", purpose: "earnings-calendar context", writesFinalAlerts: false },
];

export async function GET() {
  return NextResponse.json({
    ok: true,
    source: "fmp",
    stableEndpointDiagnosticsPreserved: true,
    supportedAuthentication: ["query-param apikey", "header apikey"],
    blockedNextAction: "Check FMP key, account activation, or plan access.",
    registry: FMP_REGISTRY,
    safety: { noFakeSuccess: true, publishesAlerts: false, callsOpenAI: false, sendsTelegram: false },
  });
}
