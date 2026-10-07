# Pilot source capacity: bounded timing repair

This timing-only repair retains the existing admission, quota and freshness controls. No live recovery is established by local tests.

The two 7 October exact-runtime sensor passes checked 9 and 10 SEC issuers. Their inter-snapshot intervals averaged 3.104375 and 2.745 seconds respectively. Each uncached exact-CIK check performs a snapshot read, provider-ledger read, conditional reservation write, SEC request/body read, and snapshot write, sequentially. The existing 28-second SEC slice therefore cannot reliably complete the configured 13 checks. The actual split between network and R2 latency is unknown; these intervals are not per-stage measurements.

The test's 8,003ms preceding-work assumption is inferred from the second pass's 31,997ms direct allocation: 45,000ms outer window minus 5,000ms registry reserve minus 31,997ms equals 8,003ms. The same calculation gives 7,622ms for the first pass. Both allocations were below the old 35-second direct cap, so the outer deadline was binding. These are elapsed-envelope inferences, not individually timed storage calls.

## Timing change

After early delivery recovery and initial provider-ledger loading, calculate the source deadline as the earlier of:

- sensor start plus 60 seconds;
- processing deadline minus the unchanged 335-second paid-admission minimum and a 10-second preparation reserve.

The processing deadline remains cycle start plus 480 seconds, less 45 seconds for delivery and 15 seconds for reporting. Thus the source deadline cannot exceed cycle start plus 75 seconds. Full use of the 30-second early recovery allowance leaves at most 45 seconds for sources; unused early-recovery time can increase this to 60 seconds. Delayed ledger loading reduces the allowance further. A past deadline stays past and cannot manufacture positive headroom.

Direct collection gets at most 45 seconds, SEC gets at most 42 seconds, and the existing five-second registry finalization reserve is retained. All are clipped to the caller's absolute source deadline. Standalone V3 callers without an orchestrator deadline retain the conservative 45-second outer allowance.

The deadline bounds direct collection and its registry finalization. It is **not a hard whole-sensor wall-clock deadline**: preceding exposure/universe/valuation storage and subsequent queue/cadence persistence retain their existing bounds and durability order. In particular, this patch does not shorten an event queue write after a source registry update. The new `sourceWindow` diagnostic reports the allocated collection window, its absolute deadline, and the sensor's actual elapsed time, which may exceed the allocation.

Additional source work can delay paid admission. The 10-second preparation reserve is planning headroom, not proof that mapping, queue persistence, evidence preparation, or earlier unpaid candidate work completes within ten seconds. The unchanged check immediately before a paid call requires at least 335 seconds remaining; it defers a candidate when that minimum is unavailable. No paid role timeout or cycle/HTTP/watchdog bound is raised.

## Preserved controls

No provider-ledger read, CAS, ambiguity recovery, count or cadence logic changes. The per-cycle 13-check maximum, sequential one-second request pacing, rolling 3,500/day guard, 29-minute per-CIK floor, source snapshot validation/freshness, original timestamps, partial-observation persistence qualifiers, 15-minute schedule, eight-minute cycle and eleven-minute watchdog remain. No provider/model validation calls, ledger reset, configuration change, or publication is part of local verification.

## Coverage interpretation

Completing 13 then 12 successful checks can make all 25 issuer snapshots current at a completed scheduled cycle. With a 29-minute freshness threshold and 15-minute cron, an issuer normally revisited every two cycles still has an approximately one-minute stale interval before its 30-minute revisit. This proposal cannot guarantee continuously 95% current coverage. The third original-code cycle's temporary 24/25 peak likewise does not establish sustained coverage: older snapshots expire before the next scheduled pass.

## Deterministic verification

`simple-alert-source-capacity-smoke.mjs` uses the real monitor and unchanged budget implementation with a clock that advances cancellation deadlines together with mocked I/O. It makes no external calls.

- Reproduces 10 and 9 successful SEC checks under the old 28-second bottleneck.
- Completes 13/13 with the reclaimed allowance for both observed mean intervals, varying modeled R2 latency from 200 to 650ms per operation. Registry completion occurs about 44–50 seconds after sensor entry. These decompositions are sensitivity scenarios, not measured stage latencies.
- Keeps the allocation at 45 seconds after a full 30-second early recovery; source coverage remains honestly partial when insufficient time remains.
- Covers late starts, zero/past headroom, hung registry reads/writes/conflict-winner reads, admitted network hangs, no repeated provider work, source-attempt denominators, and unpersisted observations.
- Verifies 25 current snapshots after two successful rotating passes, then demonstrates the between-cycle freshness gap without relabeling snapshots.

The orchestrator regression checks the actual 60/55/45-second deadlines delivered to the sensor, including the clamp transition and delayed initial ledger loading that leaves zero or past headroom. It consumes the allocated source time and subsequent evidence-preparation time before invoking the real paid-admission callback: exactly 335,000ms remaining permits a mocked reservation, while 334,999ms blocks it before reservation. The 335/45/15-second reserves remain. Existing issuer-coverage, source-storage-deadline and registry-finalization tests continue to cover cache identity, original dates, quotas, cancellation, and ambiguous persistence.

After deployment, validate actual allocated/elapsed windows, SEC success counts, registry persistence, completed-cycle coverage, source errors and paid-time deferrals across scheduled cycles. A test pass does not establish the upstream latency distribution, continuous coverage, or production recovery.
