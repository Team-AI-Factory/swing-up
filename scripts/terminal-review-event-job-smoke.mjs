import assert from "node:assert/strict";
import { terminalHarness } from "./terminal-review-runner-smoke.mjs";
import { inSimpleAlertPilot } from "./helpers/simple-alert-pilot-fixture.mjs";

const outboxes = h => [...h.objects].filter(([key]) => key.includes("/outbox/event-job/"));
const countReservations = h => h.objects.get(h.modules.eventJob.PR262_EVENT_JOB_KEYS.COMMITTEE_BUDGET_KEY)?.value.reservations ?? [];

await inSimpleAlertPilot(async () => {
  for (const eventMode of ["valuation", "sec"]) {
    for (const [verdict, outcome] of [["positive", "approved"], ["negative", "rejected"], ["needs_more_data", "needs_more_data"]]) {
      const h = terminalHarness({ eventMode }); h.state.verdict = verdict; h.state.conflictJournalWrites = 1;
      const first = await h.runJob();
      assert.equal(first.result.openAiCalled, true, JSON.stringify(first));
      assert.equal(h.journal.decisions[0].outcome, outcome);
      assert.equal(h.journal.pending.length, 0);
      assert.equal(countReservations(h).length, 1);
      const paidCalls = h.state.roleCalls, moneyCalls = h.state.moneyCalls;
      const firstOutbox = first.result.outboxKey;
      if (outcome === "approved" && eventMode === "sec") {
        assert.equal(first.result.seriousSignalFound, true, JSON.stringify(first));
        assert.ok(firstOutbox);
        const receiptIndex = h.writes.findIndex(row => row.key.includes("terminal-reviews-v1/attempts/") && row.value.decision?.outcome === "approved");
        const journalIndex = h.writes.findIndex(row => row.key === h.journalKey && row.value.decisions.length === 1);
        const outboxIndex = h.writes.findIndex(row => row.key === firstOutbox);
        assert.ok(receiptIndex >= 0 && receiptIndex < journalIndex && journalIndex < outboxIndex,
          "Immutable completion receipt and CAS journal decision must precede the first outbox");
      } else {
        if (outcome !== "approved") assert.equal(first.result.seriousSignalFound, false);
        assert.equal(outboxes(h).length, 0);
      }
      h.advance(13 * 3600000); h.reload();
      const expired = await h.runJob();
      assert.equal(expired.result.openAiCalled, false, `${outcome}: expiring the 12-hour fingerprint reservation is not evidence`);
      h.advance(24 * 3600000); h.reload();
      const daily = await h.runJob();
      assert.equal(daily.result.openAiCalled, false, `${outcome}: new daily IDs and a process reload are not evidence`);
      assert.equal(h.state.roleCalls, paidCalls); assert.equal(h.state.moneyCalls, moneyCalls);
      assert.equal(h.journal.decisions.length, 1);
      assert.equal(outboxes(h).length, outcome === "approved" && eventMode === "sec" ? 1 : 0, "Daily aliases cannot create duplicate alerts");
      if (outcome === "approved" && eventMode === "sec") {
        assert.equal(expired.result.outboxKey, firstOutbox, "Fresh same-source replay reuses the original outbox");
        assert.equal(daily.result.outboxKey, null, "A source older than 24 hours cannot republish the retained approval");
      }
      if (outcome === "needs_more_data") {
        assert.equal(daily.result.nonterminal, true, "Completed needs_more_data may still collect missing evidence");
        assert.equal(daily.result.r2Persistence.nonterminalAuditWritten, false, "An unpaid collection is not another paid audit");
      }
    }
  }

  const market = terminalHarness({ eventMode: "sec" }); await market.runJob();
  const originalOutbox = outboxes(market)[0][0];
  market.advance(60000); market.state.price = 60;
  const repriced = await market.runJob();
  assert.equal(repriced.result.openAiCalled, true, JSON.stringify(repriced));
  assert.equal(market.journal.decisions.length, 2);
  assert.equal(outboxes(market).length, 2);
  market.advance(60000); market.state.price = 50;
  const calls = market.state.roleCalls, moneyCalls = market.state.moneyCalls;
  const returnToA = await market.runJob();
  assert.equal(returnToA.result.openAiCalled, false, "A→B→A retains the first decision even after a newer completed review");
  assert.equal(returnToA.result.outboxKey, originalOutbox);
  assert.equal(market.state.roleCalls, calls); assert.equal(market.state.moneyCalls, moneyCalls);
  assert.equal(outboxes(market).length, 2);
  market.advance(25 * 3600000); market.state.factsRevision++;
  const newFacts = await market.runJob();
  assert.equal(newFacts.result.openAiCalled, true, "Changed dated financial source facts admit a new actual event-job review");
  assert.equal(market.journal.decisions.length, 3);
  market.advance(25 * 3600000); market.state.sourceRevision++; market.state.sourcePublishedAt = market.state.now.toISOString(); market.newEvent();
  assert.equal((await market.runJob()).result.openAiCalled, true, "A genuinely new exact-issuer SEC accession is new source evidence");
  assert.equal(market.journal.decisions.length, 4);

  const failure = terminalHarness({ eventMode: "sec" }); failure.state.failJournalAppend = true;
  await assert.rejects(() => failure.runJob(), /fixture_terminal_append_failed/);
  const attempts = [...failure.objects].filter(([key]) => key.includes("terminal-reviews-v1/attempts/"));
  assert.equal(attempts.length, 1); assert.equal(attempts[0][1].value.decision.outcome, "approved");
  assert.equal(failure.journal.decisions.length, 0); assert.equal(failure.journal.pending.length, 1);
  assert.equal(outboxes(failure).length, 0, "A failed terminal append cannot publish an outbox");
  assert.equal(countReservations(failure).length, 1, "Append failure preserves the paid count hold");
  const beforeRecovery = await failure.modules.money.getPr262AiDailyBudgetStatus(failure.state.now);
  assert.ok(beforeRecovery.reservedUsd > 0, "Append failure preserves unaccounted dollar exposure");
  const callsBeforeRecovery = failure.state.roleCalls, moneyBeforeRecovery = failure.state.moneyCalls;
  failure.state.failJournalAppend = false; failure.reload();
  const recovered = await failure.runJob();
  assert.equal(recovered.result.openAiCalled, false, "Receipt recovery does not repeat the paid Committee");
  assert.equal(recovered.result.seriousSignalFound, true, JSON.stringify(recovered));
  assert.equal(failure.journal.decisions.length, 1); assert.equal(failure.journal.pending.length, 0);
  assert.equal(failure.state.roleCalls, callsBeforeRecovery); assert.equal(failure.state.moneyCalls, moneyBeforeRecovery);
  assert.equal(outboxes(failure).length, 1);
  assert.equal(countReservations(failure).length, 1);

  const technical = terminalHarness(); technical.state.failRole = "skeptic_agent";
  const partial = await technical.runJob();
  assert.equal(partial.result.openAiCalled, true); assert.equal(partial.result.nonterminal, true);
  assert.equal(partial.report.committee.ok, false);
  assert.ok(partial.report.committee.agentsCompleted > 0, "The fixture must really fail after a successful paid role");
  assert.ok(partial.report.committee.agentsFailed > 0);
  assert.equal(technical.journal.decisions.length, 0, "Partial technical failures cannot terminalize an economic outcome");
  assert.equal(technical.journal.pending.length, 0, "Known technical reports release only the journal recovery lock");
  assert.equal(countReservations(technical).length, 1);
  assert.equal(outboxes(technical).length, 0);
  const spent = await technical.modules.money.getPr262AiDailyBudgetStatus(technical.state.now);
  assert.ok(spent.spentUsd > 0 && spent.pendingUsageUpperBoundUsd > 0, "Observed spend and uncertain failed-role exposure survive journal release");
  const partialCalls = technical.state.roleCalls;
  technical.state.now = new Date(technical.state.now.getTime() + 5 * 60000); technical.reload();
  assert.equal((await technical.runJob()).result.openAiCalled, false);
  assert.equal(technical.state.roleCalls, partialCalls);
  assert.equal(countReservations(technical).length, 1);
  const stillHeld = await technical.modules.money.getPr262AiDailyBudgetStatus(technical.state.now);
  assert.equal(stillHeld.spentUsd, spent.spentUsd); assert.equal(stillHeld.pendingUsageUpperBoundUsd, spent.pendingUsageUpperBoundUsd);
  technical.advance(25 * 3600000); technical.state.failRole = null; technical.reload();
  const retried = await technical.runJob();
  assert.equal(retried.result.openAiCalled, true, "An incomplete technical attempt can recover after ordinary budget cooldown");
  assert.equal(retried.result.seriousSignalFound, true, JSON.stringify(retried));
  assert.equal(technical.journal.decisions.length, 1);
  console.log("Terminal event-job integration: real runner/journal/R2 CAS, no daily replay or duplicate alert, material evidence, receipt-before-outbox ordering, append recovery, and partial-failure money/count holds passed.");
});
