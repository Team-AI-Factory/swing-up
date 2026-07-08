import { NextRequest, NextResponse } from "next/server";
import { withRedactionMetadata } from "@/lib/redact-secrets";

export const dynamic = "force-dynamic";

const routes = [
  { route: "/api/health", type: "json" },
  { route: "/api/internal/r2-truth-diagnostics", type: "json" },
  { route: "/api/internal/live-alert-cycle-status", type: "json" },
  { route: "/api/internal/engine-start-readiness", type: "json" },
  { route: "/api/internal/pipeline-readiness", type: "json" },
  { route: "/api/internal/ear-registry", type: "json" },
  { route: "/api/ai-committee/agents", type: "json" },
  { route: "/alerts", type: "page" },
  { route: "/ledger", type: "page" },
] as const;

const required = ["ok"];

export async function GET(request: NextRequest) {
  const origin = new URL(request.url).origin;
  const results: Array<Record<string, unknown> & { route: string; type: string; ok: boolean }> = await Promise.all(
    routes.map(async (item) => {
      try {
        const response = await fetch(new URL(item.route, origin), {
          method: "GET",
          cache: "no-store",
        });
        const contentType = response.headers.get("content-type") ?? "";
        if (response.status === 404) {
          return { ...item, status: response.status, ok: false, issue: "404" };
        }
        if (item.type === "page") {
          return {
            ...item,
            status: response.status,
            ok: response.ok,
            routeType: "page",
            loaded: response.ok,
            page_ok: response.ok,
            contentType,
          };
        }
        if (!contentType.includes("application/json")) {
          return {
            ...item,
            status: response.status,
            ok: false,
            issue: "unexpected_non_json",
            contentType,
          };
        }
        const json = (await response.json().catch(() => null)) as Record<
          string,
          unknown
        > | null;
        const missing = required.filter((field) => !(field in (json ?? {})));
        return {
          ...item,
          status: response.status,
          ok: response.ok && missing.length === 0,
          contentType,
          missingRequiredFields: missing,
        };
      } catch (error) {
        return {
          ...item,
          status: "error",
          ok: false,
          issue: "request_failed",
          message: error instanceof Error ? error.message.slice(0, 120) : "Unknown error",
        };
      }
    }),
  );
  const routesReturning404 = results.filter((r) => r["issue"] === "404").map((r) => r.route);
  const routesReturningNonJsonUnexpectedly = results.filter((r) => r["issue"] === "unexpected_non_json").map((r) => r.route);
  const routesMissingRequiredFields = results
    .filter((r) => Array.isArray(r["missingRequiredFields"]) && r["missingRequiredFields"].length > 0)
    .map((r) => ({ route: r.route, missing: r["missingRequiredFields"] }));
  const pageRoutesOk = results.filter((r) => r.type === "page" && r.ok).length;
  const jsonRoutesOk = results.filter((r) => r.type === "json" && r.ok).length;
  const recommendedFixes = [
    ...routesReturning404.map((route) => `Create or restore ${route}.`),
    ...routesReturningNonJsonUnexpectedly.map((route) => `Return JSON from ${route} or mark it as a page route.`),
    ...routesMissingRequiredFields.map((row) => `Add required fields to ${row.route}.`),
  ];

  return NextResponse.json(
    withRedactionMetadata({
      ok:
        routesReturning404.length === 0 &&
        routesReturningNonJsonUnexpectedly.length === 0 &&
        routesMissingRequiredFields.length === 0,
      route: "/api/internal/admin-route-contract-check",
      status: "completed",
      summary: "Safe admin route contract check completed without OpenAI, publish, or Telegram calls.",
      routesChecked: results,
      jsonRoutesOk,
      pageRoutesOk,
      routesReturning404,
      routesReturningNonJsonUnexpectedly,
      routesMissingRequiredFields,
      recommendedFixes,
      noSecretsExposed: true,
      noOpenAI: true,
      noPublish: true,
      noTelegram: true,
      secretsRedacted: true,
    }),
  );
}
