import { existsSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";
import { withRedactionMetadata } from "@/lib/redact-secrets";

export const dynamic = "force-dynamic";

const ROOT = process.cwd();

function routeExists(route: string) {
  return existsSync(
    path.join(ROOT, "app", ...route.split("/").filter(Boolean), "route.ts"),
  );
}

function buildStatus(expectedEndpoints: string[]) {
  const missingEndpoints = expectedEndpoints.filter(
    (endpoint) => !routeExists(endpoint),
  );
  return {
    status: missingEndpoints.length ? "fail" : "pass",
    missingEndpoints,
  };
}

export async function GET() {
  const builds = [
    {
      build: "197E",
      name: "Stage 1 R2 Truth Regression + Proof Scoring Sync Fix",
      expectedEndpoints: [
        "/api/internal/r2-health",
        "/api/internal/r2-truth-diagnostics",
        "/api/internal/run-live-alert-cycle",
      ],
    },
    {
      build: "198",
      name: "Free Price/Volume Recovery + Market Snapshot Ear",
      expectedEndpoints: [
        "/api/internal/price-volume-diagnostics",
        "/api/internal/market-snapshot-ear-run",
        "/api/internal/price-volume-proof-run",
      ],
    },
  ].map((build) => {
    const result = buildStatus(build.expectedEndpoints);
    return {
      ...build,
      status: result.status,
      missingEndpoints: result.missingEndpoints,
      notes: result.missingEndpoints.length
        ? "One or more expected route files are missing."
        : "Expected compact/internal route files are present; run endpoint checks for live data health.",
    };
  });
  return NextResponse.json(
    withRedactionMetadata({
      ok: true,
      builds,
      nextBestFix: builds.some((build) => build.status !== "pass")
        ? "Restore missing internal verification routes before testing Stage 1."
        : "Run compact Stage 1 verification and fix the highest-count remaining blocker.",
    }),
  );
}
