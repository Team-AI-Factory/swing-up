# Codex Prompt Safety Library

This library provides reusable prompt blocks for Swing Up builds and audits. It is documentation only and does not change application behavior.

Use these blocks to reduce merge conflicts, protect shared files, and keep each task scoped to one pull request.

## Core backend build

```text
Start from latest main before making changes.

Task type: Core backend build.

Scope:
- Implement only the backend functionality requested in this build.
- Keep changes focused and avoid unrelated refactors.
- Do not edit frontend pages unless required by the task.
- Do not edit app/admin/page.tsx unless required.
- Do not edit app/globals.css unless required.
- Do not edit shared navigation unless required.
- Do not change database schema unless required.

Safety:
- If a protected or shared file must be edited, explain why in the PR body.
- Do not mix unrelated UI, copy, or styling work into this backend build.
- Open one PR only.

Validation:
- Run npm run typecheck.
- Run npm run lint.
- Run npm run build.
```

## Non-core standalone page build

```text
Start from latest main before making changes.

Task type: Non-core standalone page build.

Scope:
- Build only the requested standalone page or documentation-adjacent UI.
- Avoid shared layout, global styling, backend logic, API routes, and schema changes.
- Do not edit app/admin/page.tsx unless required.
- Do not edit app/globals.css unless required.
- Do not edit shared navigation unless required.
- Do not change database schema unless required.

Safety:
- Prefer page-local components, page-local copy, and existing design tokens.
- If the page needs navigation exposure, call that out instead of editing shared navigation unless required.
- Open one PR only.

Validation:
- Run npm run typecheck.
- Run npm run lint.
- Run npm run build.
```

## Ops page build

```text
Start from latest main before making changes.

Task type: Ops page build.

Scope:
- Implement only the requested ops/admin-facing page functionality.
- Keep operational tooling isolated from user-facing pages.
- Do not edit app/admin/page.tsx unless required.
- Do not edit app/globals.css unless required.
- Do not edit shared navigation unless required.
- Do not change database schema unless required.

Safety:
- Avoid changing backend behavior unless the ops page explicitly requires it.
- Avoid changes to existing admin surfaces that are not part of this build.
- Open one PR only.

Validation:
- Run npm run typecheck.
- Run npm run lint.
- Run npm run build.
```

## Bug fix build

```text
Start from latest main before making changes.

Task type: Bug fix build.

Scope:
- Fix only the reported bug and the smallest directly related code path.
- Add or update tests only when they are directly relevant to the fix.
- Do not edit app/admin/page.tsx unless required.
- Do not edit app/globals.css unless required.
- Do not edit shared navigation unless required.
- Do not change database schema unless required.

Safety:
- Avoid opportunistic refactors, copy changes, or visual redesigns.
- Document the root cause and the fix in the PR body.
- Open one PR only.

Validation:
- Run npm run typecheck.
- Run npm run lint.
- Run npm run build.
```

## PR replacement build

```text
Start from latest main before making changes.

Task type: PR replacement build.

Scope:
- Replace the prior PR with a clean implementation of the same requested outcome.
- Do not cherry-pick unsafe, conflicted, or unrelated changes from the old PR.
- Do not edit app/admin/page.tsx unless required.
- Do not edit app/globals.css unless required.
- Do not edit shared navigation unless required.
- Do not change database schema unless required.

Safety:
- Treat the old PR as reference material only.
- Preserve the intended product behavior while reducing file overlap and conflict risk.
- Clearly state that this PR replaces the previous PR and identify what was intentionally omitted.
- Open one PR only.

Validation:
- Run npm run typecheck.
- Run npm run lint.
- Run npm run build.
```

## PR audit task

```text
Start from latest main before making changes.

Task type: PR audit task.

Scope:
- Review the target PR for correctness, safety, scope control, and merge conflict risk.
- Do not implement product changes unless explicitly requested.
- Do not edit app/admin/page.tsx unless required.
- Do not edit app/globals.css unless required.
- Do not edit shared navigation unless required.
- Do not change database schema unless required.

Safety:
- Identify risky shared-file edits, schema changes, API changes, and navigation/global style edits.
- Recommend whether to merge, revise, replace, or close the PR.
- If changes are requested as part of the audit, keep them minimal and open one PR only.

Validation:
- Run npm run typecheck.
- Run npm run lint.
- Run npm run build.
```

## Healthcheck audit task

```text
Start from latest main before making changes.

Task type: Healthcheck audit task.

Scope:
- Audit repository health, build health, type health, lint health, and obvious runtime risks.
- Do not make application behavior changes unless explicitly requested.
- Do not edit app/admin/page.tsx unless required.
- Do not edit app/globals.css unless required.
- Do not edit shared navigation unless required.
- Do not change database schema unless required.

Safety:
- Report findings with severity, affected files, and recommended next actions.
- Keep any optional fixes isolated and minimal.
- If fixes are requested, open one PR only.

Validation:
- Run npm run typecheck.
- Run npm run lint.
- Run npm run build.
```

## Merge conflict repair task

```text
Start from latest main before making changes.

Task type: Merge conflict repair task.

Scope:
- Repair only the merge conflicts and directly necessary compile or lint fallout.
- Preserve the accepted behavior from main and the feature branch wherever compatible.
- Do not edit app/admin/page.tsx unless required.
- Do not edit app/globals.css unless required.
- Do not edit shared navigation unless required.
- Do not change database schema unless required.

Safety:
- Do not add new product scope while resolving conflicts.
- Prefer the smallest conflict resolution that restores a clean build.
- Document which conflicts were resolved and how.
- Open one PR only.

Validation:
- Run npm run typecheck.
- Run npm run lint.
- Run npm run build.
```

## When not to run builds in parallel

Do not run builds in parallel when two or more tasks are likely to touch the same shared surface. Avoid parallel execution when any build may need to edit:

- `app/admin/page.tsx`.
- `app/globals.css`.
- Shared navigation, shared layout, or global providers.
- Database schema or migrations.
- API routes used by multiple features.
- Authentication, authorization, billing, or permissions logic.
- The same frontend page or route group.
- The same backend module, service, or data-access layer.

Also avoid parallel builds when product requirements are still changing, when one build depends on another build's merged output, or when a failing typecheck/lint/build on main has not been resolved.

## Safe parallel build rules

Use parallel builds only when each build has a clearly isolated scope and an independent file set.

Rules:

1. Start every parallel build from latest main.
2. Assign each build a non-overlapping ownership area before work begins.
3. Keep shared files off limits unless explicitly required.
4. Do not edit `app/admin/page.tsx` unless required.
5. Do not edit `app/globals.css` unless required.
6. Do not edit shared navigation unless required.
7. Do not change database schema unless required.
8. Do not combine unrelated fixes into a parallel build.
9. Run `npm run typecheck`, `npm run lint`, and `npm run build` in every PR.
10. Open one PR only for each build.
11. If a build discovers it must edit a shared file, pause and reassess whether the work should remain parallel.
12. Prefer documentation-only, standalone page, or isolated component work for parallel execution.

## Replacement PR rules

Use a replacement PR when an existing PR is too conflicted, too broad, unsafe, or based on stale assumptions.

Rules:

1. Start from latest main.
2. Re-implement the intended outcome cleanly instead of merging the old branch.
3. Use the old PR only as reference material.
4. Do not carry forward unrelated file changes.
5. Do not edit `app/admin/page.tsx` unless required.
6. Do not edit `app/globals.css` unless required.
7. Do not edit shared navigation unless required.
8. Do not change database schema unless required.
9. Run `npm run typecheck`, `npm run lint`, and `npm run build`.
10. Open one PR only.
11. In the PR body, state which PR is being replaced and summarize the safer scope.
12. Close or supersede the old PR only after the replacement PR is ready for review.
