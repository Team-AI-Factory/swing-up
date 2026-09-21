import { readVersionedTextFromR2, writeVersionedJsonToR2 } from "@/lib/r2-warehouse";
import { pr262StorageKey } from "@/lib/opportunity-engine/pr262-storage";

type Json = Record<string, unknown>;
const object = (value: unknown): Json => value && typeof value === "object" && !Array.isArray(value) ? value as Json : {};
const KEY = pr262StorageKey("runtime/openai-billing-audit-v1.json");

/** Official billed-cost audit. Requires an admin credential and the Committee's
 * API key ID; never attributes organization-wide spending to this application.
 * Costs have daily buckets/reporting lag, so immediate admission uses actual
 * response token receipts and separate, bounded in-flight reservations. */
export async function readOpenAiBillingAudit(now = new Date(), fetchImpl: typeof fetch = fetch): Promise<Json> {
  const admin = process.env.OPENAI_ADMIN_KEY?.trim();
  const apiKeyId = process.env.SWING_UP_OPENAI_COMMITTEE_API_KEY_ID?.trim();
  if (!admin || !apiKeyId) return { status: "access_not_configured", platform: "OpenAI", requires: ["OPENAI_ADMIN_KEY", "SWING_UP_OPENAI_COMMITTEE_API_KEY_ID"], invoiceVerified: false };
  try {
    const current = await readVersionedTextFromR2(KEY);
    const prior = current.found && current.text ? object(JSON.parse(current.text)) : {};
    if (prior.apiKeyId === apiKeyId && now.getTime() - Date.parse(String(prior.checkedAt)) < 3600000) return object(prior.result);
    const start = new Date(now.getTime() - 30 * 86400000);
    start.setUTCHours(0, 0, 0, 0);
    const daily: Array<{ startAt: string; endAt: string; amountUsd: number }> = [];
    let page: string | null = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const url = new URL("https://api.openai.com/v1/organization/costs");
      url.searchParams.set("start_time", String(Math.floor(start.getTime() / 1000)));
      url.searchParams.set("end_time", String(Math.floor(now.getTime() / 1000)));
      url.searchParams.set("bucket_width", "1d");
      url.searchParams.set("limit", "31");
      url.searchParams.append("api_key_ids", apiKeyId);
      url.searchParams.append("group_by", "api_key_id");
      if (page) url.searchParams.set("page", page);
      const response = await fetchImpl(url, { headers: { Authorization: `Bearer ${admin}`, Accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error(`openai_billing_http_${response.status}`);
      const body = object(await response.json());
      if (!Array.isArray(body.data)) throw new Error("openai_billing_invalid_response");
      for (const value of body.data) {
        const bucket = object(value);
        if (!Array.isArray(bucket.results) || typeof bucket.start_time !== "number" || typeof bucket.end_time !== "number") throw new Error("openai_billing_invalid_bucket");
        let amountUsd = 0;
        for (const resultValue of bucket.results) {
          const result = object(resultValue), amount = object(result.amount);
          if (result.api_key_id !== apiKeyId || amount.currency !== "usd" || typeof amount.value !== "number" || !Number.isFinite(amount.value)) throw new Error("openai_billing_scope_or_currency_unverified");
          amountUsd += amount.value;
        }
        daily.push({ startAt: new Date(bucket.start_time * 1000).toISOString(), endAt: new Date(bucket.end_time * 1000).toISOString(), amountUsd });
      }
      if (body.has_more !== true) { page = null; break; }
      if (typeof body.next_page !== "string" || !body.next_page) throw new Error("openai_billing_invalid_pagination");
      page = body.next_page;
    }
    if (page) throw new Error("openai_billing_incomplete_pagination");
    const result = { status: "reported", platform: "OpenAI", checkedAt: now.toISOString(), requestedStartAt: start.toISOString(), requestedEndAt: now.toISOString(),
      scope: "configured Committee API key; any other use of that key is also included", bucketWidth: "1d", dailyCosts: daily,
      reportedCostUsd: daily.reduce((sum, bucket) => sum + bucket.amountUsd, 0), invoiceVerified: false,
      reportingLagPossible: true, rollingBudgetSource: "actual_response_tokens_and_separate_inflight_reservations" };
    await writeVersionedJsonToR2(KEY, { version: 1, checkedAt: now.toISOString(), apiKeyId, result }, current.etag ? { expectedEtag: current.etag } : { createOnly: true });
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return { status: "unavailable", platform: "OpenAI", reason: /^openai_billing_[a-z0-9_]+$/.test(message) ? message : "openai_billing_request_failed", invoiceVerified: false };
  }
}
