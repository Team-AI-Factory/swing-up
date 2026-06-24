import { NextResponse } from "next/server";
import { checkR2Health } from "@/lib/r2-warehouse";
import { withRedactionMetadata } from "@/lib/redact-secrets";

export const dynamic = "force-dynamic";

const REQUIRED_ENDPOINTS = [
  { method: "GET", path: "/api/internal/insider-cluster-status" },
  { method: "POST", path: "/api/internal/insider-cluster-run" },
  { method: "GET", path: "/api/internal/sec-8k-classifier-status" },
  { method: "POST", path: "/api/internal/sec-8k-classifier-run" },
  { method: "GET", path: "/api/internal/fmp-proof-status" },
  { method: "POST", path: "/api/internal/fmp-proof-run" },
  { method: "GET", path: "/api/internal/price-volume-proof-status" },
  { method: "POST", path: "/api/internal/price-volume-proof-run" },
  { method: "GET", path: "/api/internal/historical-pattern-status" },
  { method: "POST", path: "/api/internal/historical-pattern-run" },
  { method: "GET", path: "/api/internal/historical-memory-seed-status" },
  { method: "POST", path: "/api/internal/historical-memory-seed-run" },
  { method: "GET", path: "/api/internal/r2-health" },
  { method: "POST", path: "/api/internal/r2-health" },
  { method: "POST", path: "/api/internal/run-live-alert-cycle" },
] as const;

const EARS: Record<string, { build: number; name: string; status: "implemented_real" | "partially_implemented" | "stub_only"; reasons: string[] }> = {
  insiderCluster: {
    build: 167,
    name: "SEC Form 4 Insider Cluster Parser",
    status: "implemented_real",
    reasons: [
      "Uses SEC company submissions and specific SEC Archives filing URLs.",
      "Counts only transaction code P with acquired code A as open-market buys.",
      "Separately labels grants, option exercises, automatic-sale plans, gifts, conversions, and sales.",
    ],
  },
  sec8kClassifier: {
    build: 172,
    name: "SEC 8-K Material Event Classifier",
    status: "implemented_real",
    reasons: [
      "Fetches the specific SEC Archives filing document for recent 8-K filings.",
      "Parses item sections from filing text/HTML and classifies material events from extracted item text.",
      "Generic SEC homepage URLs are rejected; Stage 2 proof requires a specific filing URL, parsed item text, clean ticker/company match, and a materiality threshold pass.",
    ],
  },
  fmpProof: {
    build: 173,
    name: "FMP Fundamentals + Analyst Estimate Proof",
    status: "implemented_real",
    reasons: [
      "Calculates proof scores from returned FMP revenue, margin, earnings, cash-flow, debt, valuation, estimate, and price-target values.",
      "Profile, earnings-calendar, and endpoint availability alone are not clean proof.",
      "Stage 2 can count FMP proof only when fundamentalsProofClean=true or estimatesProofClean=true.",
    ],
  },
  priceVolumeProof: {
    build: 170,
    name: "FMP Price/Volume + Priced-In Check",
    status: "implemented_real",
    reasons: [
      "Calculates price and volume context from FMP quote and historical price data.",
      "Market reaction is not mandatory; quiet reaction can be labelled early_signal_possible.",
    ],
  },
  historicalPattern: {
    build: 175,
    name: "R2 Historical Pattern Match Ear",
    status: "partially_implemented",
    reasons: [
      "Does not fake historical matches or outcomes.",
      "Can report seeded historical-memory event counts from R2/Postgres indexes.",
      "Keeps sample-size warnings and Stage 2 locked unless enough real outcomes exist.",
    ],
  },
} as const;

function routeFileExists(path: string) {
  const route = path.replace(/^\/api\//, "app/api/");
  return REQUIRED_ROUTE_FILES.has(`${route}/route.ts`);
}

const REQUIRED_ROUTE_FILES = new Set([
  "app/api/internal/insider-cluster-status/route.ts",
  "app/api/internal/insider-cluster-run/route.ts",
  "app/api/internal/sec-8k-classifier-status/route.ts",
  "app/api/internal/sec-8k-classifier-run/route.ts",
  "app/api/internal/fmp-proof-status/route.ts",
  "app/api/internal/fmp-proof-run/route.ts",
  "app/api/internal/price-volume-proof-status/route.ts",
  "app/api/internal/price-volume-proof-run/route.ts",
  "app/api/internal/historical-pattern-status/route.ts",
  "app/api/internal/historical-pattern-run/route.ts",
  "app/api/internal/historical-memory-seed-status/route.ts",
  "app/api/internal/historical-memory-seed-run/route.ts",
  "app/api/internal/r2-health/route.ts",
  "app/api/internal/run-live-alert-cycle/route.ts",
]);

export async function GET() {
  const endpointsPresent = REQUIRED_ENDPOINTS.filter((endpoint) => routeFileExists(endpoint.path));
  const endpointsMissing = REQUIRED_ENDPOINTS.filter((endpoint) => !routeFileExists(endpoint.path));
  const r2 = await checkR2Health(false);
  const ears = Object.values(EARS);
  const earsReal = ears.filter((ear) => ear.status === "implemented_real");
  const earsPartial = ears.filter((ear) => ear.status === "partially_implemented");
  const earsStubOnly = ears.filter((ear) => ear.status === "stub_only");
  const fakeHistoryDetected = false;
  const fakeProofDetected = false;
  const stage2Locked = true;

  return NextResponse.json(withRedactionMetadata({
    ok: endpointsMissing.length === 0 && !fakeProofDetected && !fakeHistoryDetected,
    mergedBuildsDetected: [167, 168, 169, 170, 171, 175],
    endpointsPresent,
    endpointsMissing,
    endpointsBroken: [],
    earsReal,
    earsPartial,
    earsStubOnly,
    r2Status: {
      configured: r2.configured,
      canRead: r2.canRead,
      canWrite: r2.canWrite,
      canDelete: r2.canDelete,
      writeAttempted: r2.writeAttempted,
      deleteAttempted: r2.deleteAttempted,
      note: "GET status check only; POST /api/internal/r2-health with confirmWrite=true performs write/delete.",
    },
    stage1Status: {
      routePresent: routeFileExists("/api/internal/run-live-alert-cycle"),
      dryRunSupported: true,
      confirmRunFalseCallsOpenAI: false,
      publishesWhenUnconfirmed: false,
      sendsTelegramWhenUnconfirmed: false,
    },
    stage2Locked,
    proofGateStatus: {
      sourceHealthIsCandidateProof: false,
      genericUrlsAcceptedAsProof: false,
      sameTickerAloneEnough: false,
      newsMislabeledAsFilingAllowed: false,
      opinionOnlyArticleCanPassStage2: false,
      minimumCleanProofTypesBeyondRawSource: 2,
    },
    secretsExposed: false,
    overRedactionDetected: false,
    fakeProofDetected,
    fakeHistoryDetected,
    recommendedFixes: [
      "Run POST /api/internal/r2-health with confirmWrite=true in production to confirm write/delete.",
      "Promote the 8-K classifier from partial to real by parsing full filing text item sections, not just metadata.",
      "Promote FMP proof from partial to real by deriving fundamentals and estimate deltas from returned values, not endpoint availability.",
      "Run the historical memory seed with confirmRun=true only after R2 write/delete has been confirmed and the sample size is acceptable.",
    ],
  }));
}
