import crypto from "node:crypto";
import { setTimeout as pause } from "node:timers/promises";
import { readVersionedTextFromR2, writeVersionedJsonToR2 } from "@/lib/r2-warehouse";
import { pr262StorageKey } from "@/lib/opportunity-engine/pr262-storage";
import { isSimpleAlertPilot } from "@/lib/simple-alert-pilot-runtime";
import { pilotCompanies } from "@/lib/simple-alert-pilot-scope";
import { ensureCompanyProfile } from "@/lib/opportunity-engine/company-profile-cache";
import { profileCik, verifiedCompanyProfile } from "@/lib/company-profile";
import { loadEquityUniverse } from "@/lib/equity-signal/universe";
import { createPr262SensorBudgetedFetch } from "@/lib/opportunity-engine/pr262-sensor-fetch-budget";

type Row = Record<string, unknown>;
const object = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
export const PROFILE_DAILY_TARGET = 500;
const MAX_ATTEMPTS_PER_DAY = 2500;
const MAX_ATTEMPTS_PER_RUN = 100;
const profilesKey = () => pr262StorageKey("research-evidence/company-profiles-v1.json");
async function read(key: string) {
  const saved = await readVersionedTextFromR2(key);
  return { saved, value: saved.found && saved.text ? object(JSON.parse(saved.text)) : {} };
}
const dayOf = (date: Date) => new Date(date.getTime() + 7 * 3600_000).toISOString().slice(0, 10);

/** Counts first-time VERIFIED identities, never refreshes or attempts. */
export function profileBatchPlan(listings: Row[], entries: Row[], now: Date, limit: number) {
  const day = dayOf(now);
  const valid = new Map(entries.filter(row => verifiedCompanyProfile(row.profile, row, now))
    .map(row => [`${row.ticker}:${profileCik(row.cik)}`, row]));
  const newlyVerifiedToday = [...valid.values()].filter(row => typeof row.firstVerifiedAt === "string"
    && Number.isFinite(Date.parse(row.firstVerifiedAt)) && dayOf(new Date(row.firstVerifiedAt)) === day).length;
  const stored = new Map(entries.map(row => [`${row.ticker}:${profileCik(row.cik)}`, row]));
  const cohort = new Set(pilotCompanies().map(row => row.ticker));
  const seen = new Set<string>();
  const due = listings.flatMap(row => {
    const ticker = String(row.ticker ?? ""), cik = profileCik(row.cik), company = String(row.name ?? row.company ?? "");
    if (!cik || !company || !/^[A-Z0-9.-]{1,12}$/.test(ticker)
      || !Array.isArray(row.sourceNames) || !row.sourceNames.includes("SEC company_tickers_exchange")) return [];
    const key = `${ticker}:${cik}`, previous = stored.get(key);
    if (seen.has(key) || valid.has(key) || Date.parse(String(previous?.nextAttemptAt ?? "")) > now.getTime()) return [];
    seen.add(key);
    return [{ ticker, cik, company, lastAttempt: Date.parse(String(previous?.updatedAt ?? "")) || 0 }];
  }).sort((a, b) => Number(cohort.has(b.ticker)) - Number(cohort.has(a.ticker)) || a.lastAttempt - b.lastAttempt || a.ticker.localeCompare(b.ticker));
  return { newlyVerifiedToday, due: due.slice(0, Math.max(0, Math.min(limit, PROFILE_DAILY_TARGET - newlyVerifiedToday))), eligible: due.length };
}

export async function runSimpleAlertProfileBuilder(now = new Date(), fetchImpl: typeof fetch = fetch) {
  if (!isSimpleAlertPilot() || process.env.SWING_UP_SIMPLE_PILOT_ROLE !== "profiles") throw new Error("simple_pilot_profile_role_required");
  const signal = AbortSignal.timeout(175_000);
  const day = dayOf(now), key = pr262StorageKey(`pilot/profile-builder/${day}.json`), owner = crypto.randomUUID();
  const loaded = await read(key);
  if (Date.parse(String(loaded.value.leaseUntil ?? "")) > now.getTime()) return { ok: true, status: "busy", target: PROFILE_DAILY_TARGET };
  const alreadyReserved = Number(loaded.value.attemptsReserved) || 0;
  const count = Math.max(0, Math.min(MAX_ATTEMPTS_PER_RUN, MAX_ATTEMPTS_PER_DAY - alreadyReserved));
  if (!count) return { ok: true, status: "daily_attempt_limit", target: PROFILE_DAILY_TARGET, attemptsReserved: alreadyReserved };
  const state: Row = { ...loaded.value, version: 1, day, owner, leaseUntil: new Date(now.getTime() + 5 * 60000).toISOString(),
    attemptsReserved: alreadyReserved + count, target: PROFILE_DAILY_TARGET, updatedAt: now.toISOString() };
  const claim = await writeVersionedJsonToR2(key, state, loaded.saved.etag ? { expectedEtag: loaded.saved.etag } : { createOnly: true });
  if (!claim.written || claim.conflict) return { ok: true, status: "busy", target: PROFILE_DAILY_TARGET };
  let nextRequest = 0, requests = 0, requestFailures = 0, circuitOpen = false;
  const paced: typeof fetch = async (request, init) => {
    if (circuitOpen) throw new Error("simple_profile_source_cooldown");
    signal.throwIfAborted();
    await pause(Math.max(0, nextRequest - Date.now()), undefined, { signal });
    nextRequest = Date.now() + 1000;
    requests++;
    try {
      const response = await fetchImpl(request, { ...init, signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal });
      if (!response.ok) requestFailures++;
      if ([403, 429].includes(response.status)) circuitOpen = true;
      return response;
    } catch (error) { requestFailures++; throw error; }
  };
  let attempted = 0, verified = 0, before = 0, after = 0, status = "completed", failure: string | null = null;
  try {
    const provider = await createPr262SensorBudgetedFetch({ now, fetchImpl: paced, signal });
    const universe = await loadEquityUniverse(provider.fetchImpl, now);
    if (now.getTime() - Date.parse(universe.snapshot.refreshedAt) > 86400_000) throw new Error("simple_profile_universe_stale");
    const cache = await read(profilesKey());
    const entries = Array.isArray(cache.value.entries) ? cache.value.entries.map(object) : [];
    const plan = profileBatchPlan(universe.snapshot.entries, entries, now, count);
    before = plan.newlyVerifiedToday;
    status = before >= PROFILE_DAILY_TARGET ? "target_reached" : plan.due.length ? "completed" : "no_due_profiles";
    for (const identity of plan.due) {
      if (signal.aborted || circuitOpen) break;
      attempted++;
      if (await ensureCompanyProfile(identity, provider.fetchImpl, new Date(), { signal })) verified++;
    }
    const fresh = await read(profilesKey());
    after = profileBatchPlan(universe.snapshot.entries, Array.isArray(fresh.value.entries) ? fresh.value.entries.map(object) : [], new Date(), 0).newlyVerifiedToday;
    if (circuitOpen) status = "source_cooldown";
    else if (signal.aborted) status = "time_budget_reached";
    else if (after >= PROFILE_DAILY_TARGET) status = "target_reached";
    await provider.flush();
  } catch (error) {
    status = "failed"; failure = error instanceof Error ? error.message.slice(0, 250) : "profile_builder_failed";
  }
  const summary = { ok: status !== "failed", checkedAt: new Date().toISOString(), status, target: PROFILE_DAILY_TARGET,
    attempted, unverifiedThisRun: attempted - verified, verificationYieldPercent: attempted ? verified / attempted * 100 : null, newlyVerifiedThisRun: verified, newlyVerifiedToday: after || before, remaining: Math.max(0, PROFILE_DAILY_TARGET - (after || before)),
    requests, requestFailures, failureRatePercent: requests ? requestFailures / requests * 100 : null,
    modelCalls: 0, failure, guarantees500: false };
  const current = await read(key);
  if (current.value.owner !== owner) throw new Error("simple_profile_lease_lost");
  const saved = await writeVersionedJsonToR2(key, { ...state, ...summary, leaseUntil: null,
    // Unused reserved slots can be safely returned once this process settles.
    attemptsReserved: alreadyReserved + attempted, totalAttempts: (Number(state.totalAttempts) || 0) + attempted,
    totalVerified: (Number(state.totalVerified) || 0) + verified }, { expectedEtag: current.saved.etag! });
  if (!saved.written || saved.conflict) throw new Error("simple_profile_summary_not_saved");
  console.info(`[simple-profile-builder] ${JSON.stringify(summary)}`);
  return summary;
}
