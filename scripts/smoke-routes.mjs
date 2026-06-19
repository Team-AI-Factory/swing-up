#!/usr/bin/env node

const DEFAULT_BASE_URL = "http://localhost:3000";
const REQUEST_TIMEOUT_MS = 10_000;

const routes = [
  "/api/health",
  "/install-app",
  "/support",
  "/status",
  "/alert-access",
  "/security",
  "/alerts",
  "/ledger",
  "/methodology",
  "/sources",
  "/disclaimer",
  "/score-glossary",
  "/ops/build-queue",
  "/api/brain/score-preview?mock=true",
  "/api/pattern-matches/preview?mock=true",
  "/api/ai-committee/preview?mock=true",
  "/api/rule-filter/preview?mock=true",
  "/api/mini-ai-scan/preview?mock=true",
  "/api/receipts/normalize-preview?mock=true",
  "/api/price-snapshots/preview?mock=true",
];

function normalizeBaseUrl(value) {
  return (value || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

function buildUrl(baseUrl, route) {
  return new URL(route, `${baseUrl}/`).toString();
}

function classifyStatus(status) {
  if (status >= 200 && status < 400) {
    return { passed: true, reason: "responded successfully" };
  }

  if (status === 401 || status === 403) {
    return { passed: true, reason: "route exists and requires auth" };
  }

  if (status === 404) {
    return { passed: false, reason: "route was not found" };
  }

  if (status >= 500) {
    return { passed: false, reason: "server returned an error" };
  }

  return { passed: false, reason: "unexpected response status" };
}

async function checkRoute(baseUrl, route) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(buildUrl(baseUrl, route), {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
    });
    const result = classifyStatus(response.status);

    return {
      route,
      status: response.status,
      passed: result.passed,
      reason: result.reason,
    };
  } catch (error) {
    return {
      route,
      status: "ERR",
      passed: false,
      reason: error.name === "AbortError" ? "request timed out" : error.message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function printResults(baseUrl, results) {
  console.log(`Route smoke test base URL: ${baseUrl}`);
  console.log("");
  console.log("Route | Status | Result | Reason");
  console.log("--- | --- | --- | ---");

  for (const result of results) {
    console.log(
      `${result.route} | ${result.status} | ${result.passed ? "PASS" : "FAIL"} | ${result.reason}`,
    );
  }
}

const baseUrl = normalizeBaseUrl(process.env.SMOKE_BASE_URL || process.argv[2]);
const results = await Promise.all(routes.map((route) => checkRoute(baseUrl, route)));
const failures = results.filter((result) => !result.passed);

printResults(baseUrl, results);

if (failures.length > 0) {
  console.error("");
  console.error(`Route smoke test failed: ${failures.length} route(s) need attention.`);
  process.exit(1);
}

console.log("");
console.log(`Route smoke test passed: ${results.length} route(s) responded safely.`);
