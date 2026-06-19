#!/usr/bin/env node

const DEFAULT_BASE_URL = "https://swing-up-production.up.railway.app";
const REQUEST_TIMEOUT_MS = 15_000;

const routes = [
  "/api/health",
  "/",
  "/alerts",
  "/ledger",
  "/methodology",
  "/sources",
  "/disclaimer",
  "/score-glossary",
  "/ops/build-queue",
  "/api/brain/score-preview?mock=true",
  "/api/pattern-matches/preview?mock=true",
  "/api/ai-committee/queue?limit=20",
  "/api/receipts/normalize-preview?mock=true",
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
    return { passed: false, reason: "route requires auth or is blocked" };
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
  const url = buildUrl(baseUrl, route);

  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "manual",
      signal: controller.signal,
    });
    const result = classifyStatus(response.status);

    return {
      route,
      url,
      status: response.status,
      passed: result.passed,
      reason: result.reason,
    };
  } catch (error) {
    return {
      route,
      url,
      status: "ERR",
      passed: false,
      reason: error.name === "AbortError" ? "request timed out" : error.message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function printResults(baseUrl, results) {
  console.log(`Production smoke base URL: ${baseUrl}`);
  console.log(`Routes checked with safe GET requests only: ${results.length}`);
  console.log("");
  console.log("Result | Status | Route | Reason");
  console.log("--- | --- | --- | ---");

  for (const result of results) {
    console.log(
      `${result.passed ? "PASS" : "FAIL"} | ${result.status} | ${result.route} | ${result.reason}`,
    );
  }
}

const baseUrl = normalizeBaseUrl(process.env.PRODUCTION_SMOKE_BASE_URL || process.env.SMOKE_BASE_URL || process.argv[2]);
const results = await Promise.all(routes.map((route) => checkRoute(baseUrl, route)));
const failures = results.filter((result) => !result.passed);

printResults(baseUrl, results);

if (failures.length > 0) {
  console.error("");
  console.error(`Production smoke failed: ${failures.length} route(s) need attention.`);

  for (const failure of failures) {
    console.error(`- ${failure.route} (${failure.status}): ${failure.reason}`);
  }

  process.exit(1);
}

console.log("");
console.log(`Production smoke passed: ${results.length} route(s) responded safely.`);
