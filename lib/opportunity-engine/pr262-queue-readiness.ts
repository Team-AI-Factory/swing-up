import { readCompanyProfiles } from "@/lib/opportunity-engine/company-profile-cache";
import type { Pr262SensorEvent } from "@/lib/opportunity-engine/pr262-change-sensor";
import { pr262QueueBlocker } from "@/lib/opportunity-engine/pr262-review-blockers";

const DAY_MS = 24 * 60 * 60_000;
const profileWait = (event: Pr262SensorEvent) => /candidate_company_profile_pending/.test(event.queueLastError ?? "");
const authoritative = (event: Pr262SensorEvent) => event.source === "sec" || event.source === "official"
  || /^(issuer_ir_|issuer_sec_)/.test(event.sourceProvider ?? "");

/** Keep blocked research, but do not repeatedly spend the analysis window on it. */
export function planPr262QueueAdmissions(events: Pr262SensorEvent[], verifiedTickers: ReadonlySet<string>, now: Date) {
  const nowMs = now.getTime();
  const candidates = events.filter(event => event.priority >= 80 && event.ticker && event.mappingStatus === "mapped"
    && (event.source !== "sec" || (event.identityMethod === "official_sec_archive_link" && event.cik && event.accession && event.canonicalSecIndexUrl)));
  const readyProfileEventIds = candidates.filter(event => verifiedTickers.has(event.ticker!) && profileWait(event)).map(event => event.id);
  const due = candidates.filter(event => !Number.isFinite(Date.parse(event.queueNextAttemptAt ?? "")) || Date.parse(event.queueNextAttemptAt!) <= nowMs
    || readyProfileEventIds.includes(event.id));
  const ready = due.filter(event => verifiedTickers.has(event.ticker!));
  const blocked = candidates.filter(event => !verifiedTickers.has(event.ticker!));
  const blockerCounts: Record<string, number> = { missing_profile: blocked.length, same_evidence: 0, ai_budget: 0,
    review_capacity: 0, ai_provider: 0, accounting_unavailable: 0, reservation_unclassified: 0, other_scheduled_retry: 0 };
  for (const event of candidates) {
    if (!verifiedTickers.has(event.ticker!) || readyProfileEventIds.includes(event.id)
      || !(Date.parse(event.queueNextAttemptAt ?? "") > nowMs)) continue;
    const category = pr262QueueBlocker(event.queueLastError) ?? "other_scheduled_retry";
    blockerCounts[category] = (blockerCounts[category] ?? 0) + 1;
  }
  const fresh = ready.filter(event => event.queueAttempts === 0 && nowMs - Date.parse(event.observedAt) <= DAY_MS)
    .sort((a, b) => Number(authoritative(b)) - Number(authoritative(a)) || b.priority - a.priority || b.observedAt.localeCompare(a.observedAt));
  const freshAuthoritativeReadyCount = fresh.filter(authoritative).length;
  const readyAges = ready.map(event => nowMs - Date.parse(event.firstQueuedAt ?? event.observedAt)).filter(age => Number.isFinite(age) && age >= 0);
  const retained = ready.filter(event => !fresh.includes(event));
  const ordered: Pr262SensorEvent[] = [];
  // Three fresh cases then one retained case prevents starvation in either lane.
  while (fresh.length || retained.length) {
    ordered.push(...fresh.splice(0, 3));
    const retry = retained.shift();
    if (retry) ordered.push(retry);
  }
  // One bounded discovery attempt still collects evidence for an unknown issuer.
  // The separate profile warmer handles the other missing descriptions.
  const discovery = due.filter(event => !verifiedTickers.has(event.ticker!))
    .sort((a, b) => Number(a.queueAttempts > 0) - Number(b.queueAttempts > 0)
      || b.priority - a.priority || Date.parse(a.queueLastAttemptAt ?? "1970-01-01") - Date.parse(b.queueLastAttemptAt ?? "1970-01-01")
      || b.observedAt.localeCompare(a.observedAt))[0];
  if (discovery) ordered.push(discovery);
  const admittedIds = new Set(ordered.map(event => event.id));
  return {
    status: "checked" as const,
    profileReadyCount: ready.length,
    profileBlockedCount: blocked.length,
    blockerCounts,
    freshAuthoritativeReadyCount,
    oldestProfileReadyAgeMinutes: readyAges.length ? Math.floor(Math.max(...readyAges) / 60_000) : null,
    discoveryAllowance: discovery ? 1 : 0,
    preferredEventIds: ordered.map(event => event.id),
    readyProfileEventIds,
    excludedEventIds: blocked.filter(event => !admittedIds.has(event.id)).map(event => event.id),
    eventsDeleted: 0,
  };
}

export async function readPr262QueueAdmissionPlan(events: Pr262SensorEvent[], now: Date) {
  const profiles = await readCompanyProfiles(events.map(event => ({ ticker: event.ticker, company: event.company, cik: event.cik })), now);
  return planPr262QueueAdmissions(events, new Set(profiles.keys()), now);
}
