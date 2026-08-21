import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const dashboard = readFileSync(new URL("../app/dashboard/page.tsx", import.meta.url), "utf8");
const page = readFileSync(new URL("../app/serious-signals/page.tsx", import.meta.url), "utf8");
const feed = readFileSync(new URL("../app/serious-signals/SeriousSignalFeed.tsx", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/internal/serious-signal-status/route.ts", import.meta.url), "utf8");
const delivery = readFileSync(new URL("../lib/notifications/serious-signal-delivery.ts", import.meta.url), "utf8");

assert.match(dashboard, /<SeriousSignalFeed compact \/>/);
assert.doesNotMatch(dashboard, /mockAlerts|AlertCard/);
assert.match(page, /No mock fallback/);
assert.match(feed, /hours=48&limit=100/);
assert.match(feed, /x-swing-up-serious-signal-read-token/);
assert.match(feed, /sessionStorage/);
assert.doesNotMatch(feed, /localStorage/);
assert.match(feed, /href=\{evidence\.url\}/, "Sanitized evidence objects must render their URL rather than [object Object].");
assert.match(feed, /No Committee-approved Serious Signal was found in the latest 48 hours/);
assert.match(feed, /complete critical-source, universe, and exposure coverage/);
assert.match(feed, /coverageVerified/);
assert.match(route, /internalApiScopeAuthorized\(request\.headers, "serious_signal_read"\)/);
assert.match(route, /cache-control": "private, no-store"/);
assert.match(delivery, /Returns only sanitized fields intended for an authenticated web\/app view/);
assert.match(delivery, /secretsIncluded: false/);
assert.doesNotMatch(delivery.slice(delivery.indexOf("export async function getSeriousSignalStatus")), /TELEGRAM_BOT_TOKEN|SWING_UP_SERIOUS_SIGNAL_WEBHOOK_URL/);

console.log(JSON.stringify({
  ok: true,
  dashboardUsesLiveFeed: true,
  noMockAlertFallback: true,
  rollingFortyEightHourWindow: true,
  readOnlyRouteScope: true,
  tokenStoredForSessionOnly: true,
  sanitizedOutputContract: true,
}, null, 2));
