# Swing Up

Swing Up is a receipt-first market research and decision-support application. It turns market signals into scored research views with evidence confidence, risk context, historical pattern matching, and public tracking. It is not a trading system, does not provide personalized financial advice, and does not guarantee returns.

## Tech stack

- **Framework:** Next.js App Router
- **Language:** TypeScript
- **UI:** React
- **Database tooling:** Prisma
- **Package manager:** npm with `package-lock.json`
- **Linting:** ESLint
- **Deployment target:** Railway

## Important scripts

Run scripts from the repository root:

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start the local Next.js development server. |
| `npm run typecheck` | Generate the Prisma client, then run TypeScript with `tsc --noEmit`. |
| `npm run lint` | Run ESLint with zero warnings allowed. |
| `npm run build` | Generate the Prisma client, then create a production Next.js build. |
| `npm run start` | Start the production Next.js server after a build. |
| `npm run db:generate` | Generate the Prisma client. |
| `npm run db:migrate` | Apply deployed Prisma migrations. |
| `npm run db:studio` | Open Prisma Studio. |
| `npm run db:seed` | Run the seed script. |
| `npm run smoke:routes` | Run route smoke checks against the default local base URL or a configured base URL. |
| `npm run audit:mock-labels` | Audit mock/live labeling language. |

## Healthcheck route

The primary healthcheck route is:

```text
GET /api/health
```

Expected healthy response shape:

```json
{ "ok": true, "service": "swing-up", "status": "healthy" }
```

## Key production URL

The production Railway URL used by public metadata is:

```text
https://swing-up-production.up.railway.app/
```

Use the production healthcheck URL during deploy verification:

```text
https://swing-up-production.up.railway.app/api/health
```

## Build and check process

Use npm's deterministic install path when a lockfile is present:

```bash
npm ci
npm run typecheck
npm run lint
npm run build
```

The GitHub Actions build workflow installs dependencies, then runs typecheck, lint, and build. Keeping `package-lock.json` committed allows CI to use `npm ci` instead of falling back to `npm install`.

## Environment variable categories

Do not commit real secret values. Configure environment variables through the deployment platform or a local ignored environment file.

Common categories include:

- **Database:** connection strings and database URLs used by Prisma and runtime database access.
- **External market/data sources:** API keys, base URLs, or service credentials for live source integrations.
- **Application runtime:** environment mode, public base URL, or deployment-specific settings.
- **Operations and checks:** optional base URLs or tokens used by smoke tests, monitoring, or deploy verification.
- **Provider credentials:** any third-party account credentials needed for production-only integrations.

When documenting environment variables, describe purpose and required/optional status without exposing actual values.

## Safe wording principle

Swing Up copy should stay calm, compliant, evidence-first, and uncertainty-aware. Use decision-support wording such as research candidate, review, evidence, receipts, risk, and context. Avoid urgent, promotional, certain, or directive language such as guaranteed returns, risk-free outcomes, or direct commands to buy or sell.

## Mock vs live data principle

Mock or preview data is for product review, education, layout checks, and workflow validation. It must not be presented as a real market alert. Live data should come from production records or real source outputs and should be backed by traceable receipts, source status, timestamps, and reviewable evidence.

## Railway deploy verification checklist

Before marking a Railway deploy as safe:

1. Confirm the Railway build completed successfully.
2. Confirm the app boots without runtime errors.
3. Open the production URL and verify the home page loads.
4. Check `GET /api/health` and verify it returns `{ "ok": true, "service": "swing-up", "status": "healthy" }`.
5. Run or review typecheck, lint, and build results for the deployed commit.
6. Verify database migrations were applied only when the build intentionally includes schema changes.
7. Confirm no real secrets appear in logs, pages, docs, or client-exposed environment variables.
8. Confirm mock or preview data is clearly labeled and not represented as live research.
9. Confirm safe wording remains decision-support oriented and does not imply guaranteed returns.
10. Record any healthcheck links, smoke-test notes, and follow-up issues in the PR or deploy notes.
