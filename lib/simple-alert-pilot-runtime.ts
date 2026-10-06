/** The user-authorized live experiment. Ordinary PR previews stay inert. */
export const SIMPLE_PILOT_PREFIX = "branch-labs/simple-alerts/";
export const SIMPLE_PILOT_MAIN_PREFIX = "production/pr262/";
type Environment = Record<string, string | undefined>;
export function isSimpleAlertPilot(environment: Environment = process.env) {
  return environment.SWING_UP_SIMPLE_PILOT_ENABLED === "true"
    && environment.RAILWAY_GIT_BRANCH === "pilot-simple-alerts"
    && environment.RAILWAY_PROJECT_ID === "83d99341-d622-475f-8035-00ef3d0916d1"
    && environment.RAILWAY_ENVIRONMENT_ID === "87afb8d7-c4fc-4f84-92b6-5d2820a689b6"
    && environment.SWING_UP_PR262_STORAGE_PREFIX === SIMPLE_PILOT_PREFIX
    && environment.SWING_UP_R2_WRITE_PREFIX === SIMPLE_PILOT_PREFIX;
}

// One cost ledger and provider allowance across main and the pilot. Verified
// profiles are reusable company facts, never candidate approval or queue state.
const SHARED_WRITABLE = new Set([
  "serious-signal/ai-cost-v1.json", "sensor/provider-budgets-v1.json",
  "event-job/runtime/provider-budgets-v1.json", "equity-universe/v1.json",
  "research-evidence/company-profiles-v1.json",
]);
export function pilotSharedWritable(relative: string) {
  return SHARED_WRITABLE.has(relative)
    || /^research-evidence\/company-profile-sources\/\d{10}\/[A-Za-z0-9._-]+\.json$/.test(relative);
}
export function pilotSharedReference(relative: string) {
  return pilotSharedWritable(relative) || relative === "value-investing/resumable"
    || relative.startsWith("value-investing/resumable/");
}
export function pilotSharedMutationAllowed(method: string, key: string, environment: Environment = process.env) {
  return method.toUpperCase() === "PUT" && isSimpleAlertPilot(environment)
    && key.startsWith(SIMPLE_PILOT_MAIN_PREFIX)
    && pilotSharedWritable(key.slice(SIMPLE_PILOT_MAIN_PREFIX.length));
}
