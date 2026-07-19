# Combined Opportunity Engine

This branch implements the first isolated version of one Swing Up product with two connected research paths.

## Path A: Foundation discovery

The foundation path can evaluate a company without waiting for a fresh news article. It checks:

- business quality;
- financial momentum;
- valuation support;
- the gap between reported performance and expectations;
- timing and catalysts;
- evidence strength;
- balance-sheet, dilution and valuation risk.

Each company is placed into one of four research buckets:

1. `advance_to_deeper_work`
2. `valuation_or_expectations_gated`
3. `exposure_not_yet_proven`
4. `deprioritized_or_reject`

The output also creates seven falsifiable thesis pillars, rejection reasons, missing proof, kill criteria and the next research workflow.

## Path B: Event-to-thesis updates

The event path does not analyse a headline in isolation. It applies the event to an existing company thesis and decides whether the evidence:

- strengthens the thesis;
- creates a catalyst alert;
- creates a risk warning;
- breaks the thesis;
- or changes nothing yet.

This preserves the original foundation analysis instead of starting again whenever news appears.

## Shared output

Both paths use the same language for:

- company-thesis status;
- security readiness;
- evidence direction;
- candidate bucket;
- alert type;
- proof blockers;
- next research step.

## Safety in this branch

This version is deliberately isolated from PR #261 and `main`.

- The API route is available only on Railway branch `agent/combined-opportunity-engine` in a non-production environment, or during explicitly enabled local testing.
- It performs no database writes.
- It publishes no alerts.
- It sends no Telegram, email or other notifications.
- It performs no payment actions.
- It makes no OpenAI calls.
- GitHub validation refuses to run on `main`.

## Preview API

`POST /api/internal/combined-opportunity-engine`

The request accepts:

- `foundations`: verified company foundation inputs;
- `theses`: previously stored thesis snapshots;
- `events`: new events to apply to those theses.

Foundation decisions are converted into temporary thesis snapshots during the same request. Events can therefore immediately update a newly analysed company without requiring database persistence.

## Next integration stage

After this isolated branch passes its checks and preview testing:

1. connect SEC company facts and company filings as the primary foundation source;
2. connect the existing raw-signal stream to the event path;
3. store theses and evidence append-only;
4. add valuation and scenario review before any user-facing opportunity alert;
5. pass eligible decisions into the existing committee and outcome-tracking systems;
6. merge with PR #261 only after both branches are independently proven.
