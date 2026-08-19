const baseUrl = (process.env.SWING_UP_PRODUCTION_COMPAT_BASE_URL || "http://127.0.0.1:3011").replace(/\/$/, "");
const internalToken = process.env.SWING_UP_INTERNAL_API_TOKEN || "ci-pr262-internal-token";

async function waitForHealth() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error("production_compat_app_health_timeout");
}

async function request(path, init) {
  const response = await fetch(`${baseUrl}${path}`, { ...init, signal: AbortSignal.timeout(5_000) });
  const body = await response.json().catch(() => null);
  return { response, body };
}

await waitForHealth();

const publicApi = await request("/api/ai-committee/agents");
if (!publicApi.response.ok) throw new Error(`normal_public_api_was_blocked:${publicApi.response.status}`);

const protectedRoutes = [
  "/api/internal/publish-approved-alert",
  "/api/internal/candidate-factory-run",
  "/api/internal/ledger-outcome-scheduler",
  "/api/internal/combined-opportunity-engine/cron-v3",
  "/api/candidate-alerts/from-raw-signal",
  "/api/candidate-alerts/persist-analysis",
  "/api/price-snapshots/from-alert",
  "/api/ai-committee/run",
];

for (const path of protectedRoutes) {
  const result = await request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: "{}",
  });
  if (result.response.status !== 404 || result.body?.error !== "not_found") {
    throw new Error(`protected_route_exposed:${path}:${result.response.status}`);
  }
}

const authenticated = await request("/api/internal/publish-approved-alert", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    authorization: `Bearer ${internalToken}`,
  },
  body: "{}",
});
if (authenticated.response.status === 404 && authenticated.body?.error === "not_found") {
  throw new Error("valid_internal_token_did_not_cross_production_boundary");
}

console.log(JSON.stringify({
  ok: true,
  productionPublicApiAvailable: true,
  protectedRoutesHiddenWithoutToken: protectedRoutes.length,
  internalTokenCrossesBoundary: true,
  branchWideProductionApiShutdown: false,
}, null, 2));
