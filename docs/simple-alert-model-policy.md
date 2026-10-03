# Pilot model routing and cost bounds

Verified against official OpenAI documentation on 3 October 2026. The requested policy uses `gpt-6.1-sol` for deep reviewers, `gpt-6-astra` for the final judge and `gpt-6-luna` for simple/fast roles. The focused plan currently requires deep reviewers and a final judge. The attested pilot sensor launcher sets these exact three role IDs and their matching allowlist in its child process, preventing stale inherited variables from blocking the reviewed policy. Stored Railway variables, profile-only workers and nonpilot launchers are unchanged. There is no automatic downgrade. Historical GPT-4.1 mini receipts remain interpretable at their original rates.

## Request contract

The existing Chat Completions endpoint supports these text-only reviews and strict JSON output. No tools or additional completion choices are enabled. GPT-6 requests use `service_tier: default`, `n: 1`, `reasoning_effort: low`, `verbosity: low`, and `max_completion_tokens: 4096`; incompatible temperature settings and deprecated output-limit parameters are omitted. The output cap includes reasoning and visible JSON together. The visible response stays compact, and an incomplete response cannot acquire approval authority.

Each worker performs one harmless Models catalogue read before its first GPT-6 request. This checks only catalogue visibility, not completion billing or guaranteed access. A Models Read 403 does not prevent an otherwise authorized completion. Diagnostics expose only recognized model IDs, policy/allowlist results, bounded parameters and safe provider error metadata. Credentials, prompts, headers and raw provider error messages are not logged.

GPT-6 calls have a hard 60-second timeout and inherit outer cancellation. The cycle must reserve enough remaining time for every required role before admitting a paid review. This is coordinated with the bounded pilot runtime separately; increasing output headroom is not permission to exceed the cycle deadline.

## Shared accounting

Standard global text prices in USD per million tokens:

| Model | Ordinary input | Cache read | Cache write | Total output |
| --- | ---: | ---: | ---: | ---: |
| GPT-6.1 Sol | 2.00 | 0.10 | 2.50 | 10.00 |
| GPT-6 Astra | 10.00 | 1.00 | 12.50 | 50.00 |
| GPT-6 Luna | 0.10 | 0.01 | 0.125 | 0.50 |

Cache categories are disjoint; the write price replaces the ordinary input price for written tokens. Completion tokens already include reasoning, which is never charged twice. Model-specific receipt totals must reconcile with aggregate counts and the number of observed responses.

The existing 60,000 UTF-8-byte prompt gate includes the JSON schema, with the existing additional 1,000-token framing allowance. The conservative maximum review reservation is five Sol calls plus one Astra call, each bounded to 4,096 total output tokens and maximum cache-write input prices: $1.9346. This is temporary exposure, not spending. The focused plan currently uses at most five total roles, so this six-call amount is deliberately conservative. It contains no retries. The same rolling $10 ledger, 20-review ceiling, concurrency protection and crash-held reservations remain in force.

Actual known model/token receipts determine spending, including failed outputs. Unknown model/tier or inconsistent usage retains a conservative hold. When optional cache-category counts are omitted, only proven output and cache-read components are booked; unclassified input retains a maximum-rate bound. Omission is not a claim of zero cache writes. Existing mini spending and reservation amounts are preserved, not reset or repriced.

## Verification and limits

Offline tests exercise exact routing and API parameters, strict output, read-scope 403 independence, per-model accounting, unknown pricing, absent cache categories, failed-role token preservation, safe logging, old mini history, shared reservations and the $10 cap. Mocked responses are not live API acceptance proof. The earlier 66e89d0 attempt was blocked locally by the old model allowlist, without a paid API call. Live validation is required after the migration and runtime changes deploy.

Official sources: [GPT-6.1 Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol), [GPT-6 Astra](https://developers.openai.com/api/docs/models/gpt-6-astra), [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna), [Chat Completions contract](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create), [GPT-6 migration guide](https://developers.openai.com/api/docs/guides/latest-model), [prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching).
