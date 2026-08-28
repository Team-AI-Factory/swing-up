export type InternalApiScope =
  | "cron_runtime"
  | "sensor_handoff"
  | "foundation_runtime"
  | "delivery_test_runtime"
  | "automation"
  | "high_privilege"
  | "serious_signal_read";

type AuthEnvironment = Record<string, string | undefined>;

const SERIOUS_SIGNAL_STATUS_PATH = "/api/internal/serious-signal-status";
const VALUATION_WATCHLIST_STATUS_PATH = "/api/internal/valuation-watchlist-status";
const PR262_CRON_PATH = "/api/internal/combined-opportunity-engine/cron-v3";
const PR262_SENSOR_HANDOFF_PATH = "/api/internal/combined-opportunity-engine/cloudflare-sensor-handoff";
const PR262_PRODUCTION_FOUNDATION_PATH = "/api/internal/combined-opportunity-engine/production-foundation";
const PR262_DELIVERY_TEST_PATH = "/api/internal/combined-opportunity-engine/delivery-test";
const COMBINED_ENGINE_PREFIX = "/api/internal/combined-opportunity-engine";

const HIGH_PRIVILEGE_PATHS = [
  "/api/internal/publish-approved-alert",
  "/api/internal/run-live-alert-cycle",
  "/api/internal/e2e-alert-test",
  "/api/internal/full-e2e-telegram-test",
  "/api/internal/candidate-factory-run",
  "/api/internal/ledger-outcome-scheduler",
  "/api/internal/live-outcome-evaluator",
  "/api/internal/railway-branch-signal-lab",
  "/api/candidate-alerts/from-raw-signal",
  "/api/candidate-alerts/persist-analysis",
  "/api/price-snapshots/from-alert",
  "/api/ai-committee/run",
] as const;

function pathMatches(path: string, prefix: string) {
  return path === prefix || path.startsWith(`${prefix}/`);
}

export function requiredInternalApiScope(path: string, method: string): InternalApiScope | null {
  const normalizedMethod = method.trim().toUpperCase();
  if (path === SERIOUS_SIGNAL_STATUS_PATH || path === VALUATION_WATCHLIST_STATUS_PATH) return "serious_signal_read";
  if (path === PR262_CRON_PATH && normalizedMethod === "POST") return "cron_runtime";
  if (path === PR262_SENSOR_HANDOFF_PATH && normalizedMethod === "POST") return "sensor_handoff";
  if (path === PR262_PRODUCTION_FOUNDATION_PATH && normalizedMethod === "POST") return "foundation_runtime";
  if (path === PR262_DELIVERY_TEST_PATH && normalizedMethod === "POST") return "delivery_test_runtime";
  if (HIGH_PRIVILEGE_PATHS.some((prefix) => pathMatches(path, prefix))) return "high_privilege";
  if (pathMatches(path, COMBINED_ENGINE_PREFIX)) return "automation";
  return null;
}

function bearer(headers: Headers) {
  const authorization = headers.get("authorization")?.trim() ?? "";
  return authorization.match(/^Bearer\s+(.+)$/i)?.[1]?.trim() ?? null;
}

function safeEqual(left: string | null | undefined, right: string | null | undefined) {
  if (!left || !right || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function configured(environment: AuthEnvironment, name: string) {
  return environment[name]?.trim() || null;
}

/**
 * Checks one token against one route scope. Tokens are never pooled: a cheap
 * sensor credential cannot authorize publishing, committee runs, or database
 * writes. The internal API token is the explicit break-glass/master token.
 */
export function internalApiScopeAuthorized(
  headers: Headers,
  scope: InternalApiScope,
  environment: AuthEnvironment = process.env,
) {
  const suppliedBearer = bearer(headers);
  const masterExpected = configured(environment, "SWING_UP_INTERNAL_API_TOKEN");
  const masterSupplied = headers.get("x-swing-up-internal-token")?.trim() || suppliedBearer;
  if (safeEqual(masterSupplied, masterExpected)) return true;

  if (scope === "cron_runtime") {
    return safeEqual(
      headers.get("x-swing-up-pr262-cron-token")?.trim(),
      configured(environment, "SWING_UP_PR262_CRON_RUNTIME_TOKEN"),
    );
  }
  if (scope === "sensor_handoff") {
    return safeEqual(
      headers.get("x-swing-up-pr262-sensor-token")?.trim(),
      configured(environment, "SWING_UP_PR262_SENSOR_TOKEN"),
    );
  }
  if (scope === "foundation_runtime") {
    return safeEqual(
      headers.get("x-swing-up-pr262-foundation-token")?.trim(),
      configured(environment, "SWING_UP_PR262_FOUNDATION_RUNTIME_TOKEN"),
    );
  }
  if (scope === "delivery_test_runtime") {
    return safeEqual(
      headers.get("x-swing-up-pr262-delivery-test-token")?.trim(),
      configured(environment, "SWING_UP_PR262_DELIVERY_TEST_RUNTIME_TOKEN"),
    );
  }
  if (scope === "automation") {
    const supplied = headers.get("x-swing-up-automation-token")?.trim() || suppliedBearer;
    return safeEqual(supplied, configured(environment, "SWING_UP_AUTOMATION_TOKEN"));
  }
  if (scope === "serious_signal_read") {
    const supplied = headers.get("x-swing-up-serious-signal-read-token")?.trim() || suppliedBearer;
    return safeEqual(supplied, configured(environment, "SWING_UP_SERIOUS_SIGNAL_READ_TOKEN"));
  }
  return false;
}

export const INTERNAL_API_PATHS = {
  seriousSignalStatus: SERIOUS_SIGNAL_STATUS_PATH,
  valuationWatchlistStatus: VALUATION_WATCHLIST_STATUS_PATH,
  pr262Cron: PR262_CRON_PATH,
  pr262SensorHandoff: PR262_SENSOR_HANDOFF_PATH,
  pr262ProductionFoundation: PR262_PRODUCTION_FOUNDATION_PATH,
  pr262DeliveryTest: PR262_DELIVERY_TEST_PATH,
} as const;
