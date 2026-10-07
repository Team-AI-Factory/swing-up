import { pilotCohortStoragePrefix } from "@/lib/simple-alert-pilot-cohort";
import { isSimpleAlertPilot, SIMPLE_PILOT_PREFIX, SIMPLE_PILOT_MAIN_PREFIX, pilotSharedReference } from "@/lib/simple-alert-pilot-runtime";
import {
  isPr262ApprovedPremergeProductionRollout,
  PR262_ROLLOUT_RUNTIME,
} from "@/lib/opportunity-engine/pr262-runtime";

const PREVIEW_PREFIX = "branch-labs/pr-262/";
const PRODUCTION_PREFIX = PR262_ROLLOUT_RUNTIME.productionStoragePrefix;
const PR262_BRANCH = PR262_ROLLOUT_RUNTIME.branch;

type StorageEnvironment = Record<string, string | undefined>;

function normalizePrefix(value: string) {
  const prefix = value.trim();
  if (!prefix
    || prefix.startsWith("/")
    || !prefix.endsWith("/")
    || prefix.includes("\\")
    || prefix.slice(0, -1).split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new Error("pr262_storage_prefix_invalid");
  }
  return prefix;
}

function isPreviewBranch(environment: StorageEnvironment) {
  return (environment.RAILWAY_GIT_BRANCH ?? "").trim() === PR262_BRANCH;
}

function isProductionRuntime(environment: StorageEnvironment) {
  if (isPr262ApprovedPremergeProductionRollout(environment)) return true;
  if (isPreviewBranch(environment)) return false;
  const railwayEnvironment = (environment.RAILWAY_ENVIRONMENT_NAME ?? "").trim().toLowerCase();
  const branch = (environment.RAILWAY_GIT_BRANCH ?? "").trim().toLowerCase();
  return railwayEnvironment === "production" || branch === "main";
}

export function resolvePr262StoragePrefix(environment: StorageEnvironment = process.env) {
  if (isSimpleAlertPilot(environment)) return SIMPLE_PILOT_PREFIX;
  const configured = environment.SWING_UP_PR262_STORAGE_PREFIX?.trim()
    || "";
  const prefix = configured
    ? normalizePrefix(configured)
    : isProductionRuntime(environment) ? PRODUCTION_PREFIX : PREVIEW_PREFIX;

  const approvedPremergeRollout = isPr262ApprovedPremergeProductionRollout(environment);
  if (isPreviewBranch(environment) && !approvedPremergeRollout && prefix !== PREVIEW_PREFIX) {
    throw new Error("pr262_preview_storage_prefix_mismatch");
  }
  if (!isProductionRuntime(environment) && prefix === PRODUCTION_PREFIX) {
    throw new Error("pr262_nonproduction_storage_prefix_mismatch");
  }
  if (isProductionRuntime(environment) && prefix !== PRODUCTION_PREFIX) {
    throw new Error("pr262_production_storage_prefix_mismatch");
  }
  return prefix;
}

export function pr262StorageKey(relativeKey: string, environment: StorageEnvironment = process.env) {
  const relative = relativeKey.trim().replace(/^\/+/, "");
  if (!relative
    || relative.endsWith("/")
    || relative.includes("\\")
    || relative.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new Error("pr262_storage_key_invalid");
  }
  const prefix = resolvePr262StoragePrefix(environment);
  if (isSimpleAlertPilot(environment)) {
    if (pilotSharedReference(relative)) return `${SIMPLE_PILOT_MAIN_PREFIX}${relative}`;
    // Profile preparation and paid-review count/cooldown have one allowance
    // across cohorts, in addition to the unchanged global dollar ledger.
    // Private queues/audits/metrics are versioned; old records stay untouched.
    const sharedProfileDay = /^pilot\/profile-builder\/\d{4}-\d{2}-\d{2}\.json$/.test(relative);
    const sharedReviewAllowance = relative === "event-job/runtime/committee-budgets-v1.json";
    const sharedTerminalEvidence = relative === "terminal-reviews-v1" || relative.startsWith("terminal-reviews-v1/")
      || relative === "serious-signal/evidence-delivery-v1" || relative.startsWith("serious-signal/evidence-delivery-v1/");
    return `${sharedProfileDay || sharedReviewAllowance || sharedTerminalEvidence ? prefix : pilotCohortStoragePrefix(prefix)}${relative}`;
  }
  return `${prefix}${relative}`;
}

export const PR262_STORAGE_PREFIXES = {
  preview: PREVIEW_PREFIX,
  production: PRODUCTION_PREFIX,
} as const;
