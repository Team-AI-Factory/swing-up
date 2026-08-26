export const PR262_ROLLOUT_RUNTIME = Object.freeze({
  projectId: "83d99341-d622-475f-8035-00ef3d0916d1",
  environmentId: "aa17ed61-337a-41e5-a016-a6ad7bca1534",
  environmentName: "swing-up-pr-262",
  branch: "agent/combined-opportunity-engine",
  productionStoragePrefix: "production/pr262/",
});

type RuntimeEnvironment = Record<string, string | undefined>;

function normalized(value: string | undefined) {
  return value?.trim() ?? "";
}

/**
 * PR #262 may exercise its three production job roles before merge only in
 * the already-isolated Railway PR environment. The operator must attest the
 * exact deployed commit, and both the logical namespace and the generic R2
 * mutation fence must remain fixed to production/pr262/.
 *
 * This is deliberately stricter than a generic feature flag: copying only the
 * flag to another service, environment, project, branch, or commit does not
 * unlock production writes.
 */
export function isPr262ApprovedPremergeProductionRollout(
  environment: RuntimeEnvironment = process.env,
) {
  const runtimeCommit = normalized(environment.RAILWAY_GIT_COMMIT_SHA).toLowerCase();
  const approvedCommit = normalized(environment.SWING_UP_PR262_PREMERGE_APPROVED_COMMIT_SHA).toLowerCase();
  return normalized(environment.SWING_UP_PR262_PREMERGE_PRODUCTION_ROLLOUT).toLowerCase() === "true"
    && normalized(environment.RAILWAY_PROJECT_ID) === PR262_ROLLOUT_RUNTIME.projectId
    && normalized(environment.RAILWAY_ENVIRONMENT_ID) === PR262_ROLLOUT_RUNTIME.environmentId
    && normalized(environment.RAILWAY_ENVIRONMENT_NAME).toLowerCase() === PR262_ROLLOUT_RUNTIME.environmentName
    && normalized(environment.RAILWAY_GIT_BRANCH) === PR262_ROLLOUT_RUNTIME.branch
    && /^[0-9a-f]{40}$/.test(runtimeCommit)
    && approvedCommit === runtimeCommit
    && normalized(environment.SWING_UP_PR262_STORAGE_PREFIX) === PR262_ROLLOUT_RUNTIME.productionStoragePrefix
    && normalized(environment.SWING_UP_R2_WRITE_PREFIX) === PR262_ROLLOUT_RUNTIME.productionStoragePrefix;
}

