# Simple Alerts delivery and runtime controls

The pilot sensor cycle has a eight-minute hard application deadline (previously six minutes; initially three and a half). Event admissions stop early enough to retain 45 seconds for delivery and persistence, followed by a 15-second reporting reserve. A bounded durable-delivery recovery pass runs before discovery and paid reviews so existing approvals cannot be starved by an event backlog. Fresh approvals still use their immediate delivery path. A paid review is admitted only with at least 335 seconds remaining after source collection: five 60-second model calls, a bounded compatibility read and persistence headroom. Otherwise it waits for the next scheduled cycle without reserving money or counting as a technical failure. Provider budgets, all evidence/Committee gates and the single shared $10 rolling-24-hour AI fuse are unchanged.

The worker's loopback HTTP request permits 520 seconds. Startup permits 45 seconds, isolated controls permit 60 seconds, and a eleven-minute process watchdog kills the worker group before the next 15-minute sensor schedule. Event leases retain their existing five-minute expiry and renewal heartbeat. The separate profile worker retains its own bounded workload, five-minute lease and five-minute process watchdog. More time is not a promise that every event will finish: remaining work retains durable retry state.

Before each sensor cycle, the existing internal delivery-test route verifies a stable, commit-scoped synthetic test. Its short-lived token exists only in the loopback-bound child process, never in stored Railway configuration. Exact project, environment, branch, role and pilot namespace must match, and external delivery must be disabled. The route checks:

- A labelled positive test produces a durable receipt in the isolated test namespace, then reads that receipt back.
- Repeating the same test suppresses duplicate delivery.
- A labelled negative test with an unapproved final decision is rejected before creating a delivery job or receipt.
- Neither test creates a live Serious Signals feed pointer.

Test-only quote timestamps satisfy the existing market-calendar validation, including weekends; they are synthetic control data and never market findings. No real evidence, price, approval or freshness gate is relaxed. Tests make no paid model calls and send no Telegram/webhook messages. An isolated receipt proves the internal delivery path, not external delivery or a live Serious Alert. Controls are excluded from all live-case and alert counts. Missing receipt or failed control is visible as a failed worker execution.

Validation: the focused control regression covers wrong auth, wrong branch/environment/role, external-channel denial, positive/negative delivery, duplicate suppression, immutable receipt reuse and missing-receipt failure. The orchestrator regression proves recovery precedes a time-consuming event, runs once, preserves reserves, and clamps an oversized requested runtime to six minutes. Typecheck, lint, production build, the reliability suite and both pilot suites must pass on the integrated revision before publication.
