# Nine-minute pilot sensor cycle

Based on live commit `f9f418fa95ee1984d1773efb4c020bdd195c1534`. Local synthetic verification is not evidence of production recovery.

## Scope and timing

Only two executable policy values change: the pilot orchestrator maximum/default goes from 480,000 to 540,000ms, and the pilot sensor worker's HTTP allowance goes from 520,000 to 580,000ms. The orchestrator still clamps callers to its maximum. Its nonpilot default/maximum remains 210,000ms. The cron route does not introduce a second timeout or a caller-controlled override. The separate generic cron script's 390,000ms HTTP timeout is unchanged and is not the pilot sensor entry point selected by `railway.sensor.json`.

Within the nine-minute request:

- Early delivery recovery retains its 30,000ms bound.
- Collection retains its independent 60,000ms maximum. The source helper receives the later processing deadline but still applies that cap and the 10,000ms minimum preparation reserve. Direct collection, SEC collection and registry finalization retain their existing bounds and source quotas.
- Processing ends at cycle start plus 480,000ms, preserving 45,000ms for delivery and 15,000ms for reporting.
- Every paid admission still needs at least 335,000ms remaining before any dollar reservation. That covers five 60,000ms sequential roles, a 5,000ms compatibility read and 30,000ms for reservation/reconciliation persistence.
- Full early recovery plus full source allocation now leaves up to 55,000ms for preparation before the paid-admission boundary. Unpaid storage/evidence work may use more; if so, the paid review stays deferred.

This does not promise that every queued company can receive a paid review in one cycle. A later candidate must independently meet the same floor after earlier work has consumed time. No gate, timeout per model, cost budget, review count, cohort, dedupe rule or delivery criterion is relaxed.

## Worker, HTTP and cadence bounds

The 660,000ms worker watchdog and 900,000ms cron cadence remain unchanged. Startup health polling is nominally 45,000ms; a final in-flight health request can add just under 2,000ms. Delivery controls retain their separate 60,000ms timeout. Thus successful bounded work plus cleanup fits below:

`47,000 + 60,000 + 540,000 + 3,000 = 650,000ms < 660,000ms < 900,000ms`.

The HTTP allowance starts after health/control work. It is not added to the watchdog: with delayed startup/control and a hung request, the 660,000ms watchdog can fire before the HTTP deadline. It kills the worker process group and exits, leaving 240,000ms before the next scheduled cycle. The successful slow-start fixture finishes after 649,980ms, including cleanup. This is bounded timing arithmetic, not a guarantee against arbitrary OS event-loop stalls.

The separate profile worker retains admission/work/persistence/count/summary/HTTP bounds of 100/140/160/175/235/240 seconds and its 300-second watchdog. No profile code or configuration changes are required.

## Unchanged controls checked

The active event lease is still five minutes and renews every minute throughout active work. Model requests remain bounded at 60 seconds. The shared rolling dollar cap is $10, the review ceiling is 20, and the fixed cohort is 25. Existing source quotas, terminal review dedupe, evidence quality, cost accounting and delivery gates retain their existing code.

## Local regression evidence

`pr262-analysis-only-orchestrator-smoke.mjs` runs the real orchestrator with mocked I/O and advances time through early recovery, initial provider-ledger reads, source work and evidence preparation. It checks:

- Actual first observed admission: 315,978ms is denied under the 480-second cycle and becomes 375,978ms, admitted under the 540-second cycle.
- Actual second observed admission: 284,815ms is denied under the old cycle and becomes 344,815ms, admitted under the new cycle.
- After an admitted candidate consumes a simulated 60-second model step, the next candidate has 315,978ms remaining and performs zero reservations and zero model calls.
- Exactly 335,000ms permits reservation; 334,999ms denies it. The floor remains 335,000ms in telemetry.
- Delayed source startup progressively clips 60 seconds to 55 seconds, then zero/past headroom. It never increases the source cap.
- Late initial work stops event admissions, and the cycle rejects at or beyond 540,000ms. The caller clamp and nonpilot maximum remain enforced.

`simple-alert-sensor-timing-smoke.mjs` executes the real worker script with a fake clock and explicit mocks for process, timers and fetch. It verifies slow startup/control completion, HTTP boundary cancellation, watchdog process-group termination during a hung response, health failure before cycle dispatch, cron nonoverlap, and the independent profile timings. It makes no network requests or real subprocesses.

`simple-alert-source-capacity-smoke.mjs` verifies the new available headroom with the real bounded source helper/monitor and mocked storage/network, including hung operations and expired windows. Existing event-job, model-policy, provider-guardrail, cost-fuse, issuer-coverage, source-storage, profile-persistence, auth, dedupe and delivery regressions cover the unchanged controls.

No publication, live models, provider validation, live storage mutations or service configuration changes are part of this work.
