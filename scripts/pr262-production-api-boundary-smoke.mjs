const baseUrl = (process.env.SWING_UP_PRODUCTION_COMPAT_BASE_URL || "http://127.0.0.1:3011").replace(/\/$/, "");
const internalToken = process.env.SWING_UP_INTERNAL_API_TOKEN || "ci-pr262-internal-token";
const readToken = process.env.SWING_UP_SERIOUS_SIGNAL_READ_TOKEN || "ci-pr262-read-token";

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

for (const path of ["/dashboard", "/serious-signals"]) {
  const response = await fetch(`${baseUrl}${path}`, { signal: AbortSignal.timeout(5_000) });
  const html = await response.text();
  if (!response.ok) throw new Error(`live_serious_signal_surface_unavailable:${path}:${response.status}`);
  if (path === "/dashboard" && !html.includes("Latest verified results")) throw new Error("dashboard_missing_live_serious_signal_feed");
  if (path === "/serious-signals" && !html.includes("Connect the live Serious Signal feed")) throw new Error("serious_signal_page_missing_read_only_connection");
}

const unauthenticatedFeed = await request("/api/internal/serious-signal-status?hours=48&limit=100");
if (unauthenticatedFeed.response.status !== 404 || unauthenticatedFeed.body?.error !== "not_found") {
  throw new Error(`serious_signal_feed_exposed_without_token:${unauthenticatedFeed.response.status}`);
}

const wrongScopeFeed = await request("/api/internal/serious-signal-status?hours=48&limit=100", {
  headers: { "x-swing-up-pr262-sensor-token": "sensor-token-cannot-read-feed" },
});
if (wrongScopeFeed.response.status !== 404 || wrongScopeFeed.body?.error !== "not_found") {
  throw new Error(`sensor_token_crossed_into_alert_feed:${wrongScopeFeed.response.status}`);
}

const authenticatedFeed = await request("/api/internal/serious-signal-status?hours=48&limit=100", {
  headers: { "x-swing-up-serious-signal-read-token": readToken },
});
if (authenticatedFeed.response.status === 404 && authenticatedFeed.body?.error === "not_found") {
  throw new Error("valid_read_token_did_not_cross_feed_boundary");
}
if (![200, 503].includes(authenticatedFeed.response.status)) {
  throw new Error(`unexpected_serious_signal_feed_status:${authenticatedFeed.response.status}`);
}

const protectedRoutes = [
  "/api/internal/publish-approved-alert",
  "/api/internal/candidate-factory-run",
  "/api/internal/ledger-outcome-scheduler",
  "/api/internal/combined-opportunity-engine/cron-v3",
  "/api/internal/combined-opportunity-engine/cloudflare-sensor-handoff",
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
  liveSeriousSignalSurfacesAvailable: true,
  readTokenCrossesOnlyFeedBoundary: true,
  missingR2FailsHonestlyWith503: authenticatedFeed.response.status === 503,
  branchWideProductionApiShutdown: false,
}, null, 2));
