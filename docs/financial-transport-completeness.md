# Financial response completeness

A saved `readComplete` retrieval flag does not establish that a historical response was HTTP 200 and read through EOF. This change preserves raw cache rows and their existing scheduling/identity behavior, while exposing legacy proof as unknown to reviewers and publication checks. It does not claim that any live cached filing was partial.

Only an ordinary successful exact-200 read through EOF creates a new transport attestation, bound to the selected document metadata and exact retained excerpts. HTTP 206 is rejected before body consumption for both issuer indexes and filings. Capped reads remain partial. Transport completeness means the response body was consumed; selected excerpt windows do not establish complete financial-note or topic coverage.

Current publication checks require that proof when documents are applicable. Numeric company facts cannot satisfy a document dependency. Completed historical approvals, rejections, requests for information, genuine zero confidence, paid keys and uncertain-use holds remain intact. New sealed decisions retain whether documents were required and whether they were explicitly requested. Old decisions whose dependency is unknowable remain approved historically but cannot establish current publication eligibility. Explicit existing requests survive paid persistence and aliases; unknown legacy proof does not itself create a new collection task.

The delivery consumer repeats the pure eligibility check before a new send. Existing receipts and delivered historical entries remain recorded; the status feed labels a held historical approval separately from current eligibility. Delivery identity and duplicate suppression do not change.

No cache refresh, migration write, new source call, paid reopening, quota, cadence, concurrency or prompt-cap expansion is introduced. Natural future writes include small additive proof/requirement metadata and pure validation work. Identical hosting bills are not established. This is a local candidate and requires the existing deployment/cost conditions to be resolved before release.

Validation uses real collector, runner, journal, event-job, read projection and delivery code with synthetic storage/transport/provider responses. A separate baseline comparison verifies raw cache rows, fetch/write traces and evidence identities. No live affected document, queued outbox or production repair is claimed from those fixtures.
