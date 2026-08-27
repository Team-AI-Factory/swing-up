export const APPROVED_PR262_RAILWAY_ROLLOUT = Object.freeze({
  projectId: "83d99341-d622-475f-8035-00ef3d0916d1",
  environmentId: "aa17ed61-337a-41e5-a016-a6ad7bca1534",
  environmentName: "swing-up-pr-262",
  branch: "agent/combined-opportunity-engine",
  productionStoragePrefix: "production/pr262/",
});

function normalized(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function isApprovedPr262PremergeProductionRollout(environment = process.env) {
  const runtimeCommit = normalized(environment.RAILWAY_GIT_COMMIT_SHA).toLowerCase();
  const approvedCommit = normalized(environment.SWING_UP_PR262_PREMERGE_APPROVED_COMMIT_SHA).toLowerCase();
  return normalized(environment.SWING_UP_PR262_PREMERGE_PRODUCTION_ROLLOUT).toLowerCase() === "true"
    && normalized(environment.RAILWAY_PROJECT_ID) === APPROVED_PR262_RAILWAY_ROLLOUT.projectId
    && normalized(environment.RAILWAY_ENVIRONMENT_ID) === APPROVED_PR262_RAILWAY_ROLLOUT.environmentId
    && normalized(environment.RAILWAY_ENVIRONMENT_NAME).toLowerCase() === APPROVED_PR262_RAILWAY_ROLLOUT.environmentName
    && normalized(environment.RAILWAY_GIT_BRANCH) === APPROVED_PR262_RAILWAY_ROLLOUT.branch
    && /^[0-9a-f]{40}$/.test(runtimeCommit)
    && approvedCommit === runtimeCommit
    && normalized(environment.SWING_UP_PR262_STORAGE_PREFIX) === APPROVED_PR262_RAILWAY_ROLLOUT.productionStoragePrefix
    && normalized(environment.SWING_UP_R2_WRITE_PREFIX) === APPROVED_PR262_RAILWAY_ROLLOUT.productionStoragePrefix;
}

