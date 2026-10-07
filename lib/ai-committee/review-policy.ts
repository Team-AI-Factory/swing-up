/** A saved review must prove that every role in its versioned plan completed. */
type Json = Record<string, unknown>;
const object = (v: unknown): Json => v && typeof v === "object" && !Array.isArray(v) ? v as Json : {};
export const FOCUSED_REVIEW_POLICY = "focused_v1";
export const FOCUSED_CORE_ROLES = ["analyst_agent", "skeptic_agent", "final_judge"] as const;
const focusedRoles = new Set<string>([...FOCUSED_CORE_ROLES, "accountant_agent", "valuation_dcf_agent", "industry_agent"]);

/** Shared proof for admission release and unobserved dollar exposure. */
export function committeeRoleProvesNoUsage(value: unknown) {
  const role = object(value);
  if (role.usageReported !== undefined && role.usageReported !== false) return false;
  if (role.error !== undefined && role.error !== null && typeof role.error !== "string") return false;
  if (role.providerFailure !== undefined && role.providerFailure !== null
    && (typeof role.providerFailure !== "object" || Array.isArray(role.providerFailure))) return false;
  const httpStatus = object(role.providerFailure).httpStatus;
  if (httpStatus !== undefined && httpStatus !== null && (typeof httpStatus !== "number"
    || !Number.isInteger(httpStatus) || httpStatus < 100 || httpStatus > 599)) return false;
  // Unattempted roles can inherit a typed failure from an earlier call.
  if (role.status === "blocked" || role.status === "planned") return true;
  if (role.status !== "failed") return false;
  // A local pre-call label cannot override an observed or malformed response.
  if (httpStatus !== undefined && httpStatus !== null) {
    return typeof httpStatus === "number" && [400, 401, 403, 404, 422, 429].includes(httpStatus);
  }
  return typeof role.error === "string"
    && ["not_configured", "disabled", "confirmation_required", "model_not_configured", "model_not_allowed", "prompt_too_large"].includes(role.error);
}

export function committeeRequestsRejectedWithoutUsage(value: unknown) {
  const summary = object(object(object(value).output).modelUsageSummary);
  const roles = Array.isArray(summary.roleDiagnostics) ? summary.roleDiagnostics.map(object) : [];
  const actual = object(summary.actualOpenAiUsage);
  // Explicit zero plus definite rejections is required before deleting a paid
  // admission. Missing optional legacy breakdowns are allowed; contradictory or
  // malformed receipts must keep the hold, including partial reviews.
  const zeroTokens = actual.tokens === undefined || (actual.tokens !== null && typeof actual.tokens === "object"
    && !Array.isArray(actual.tokens) && Object.values(actual.tokens).every(count => count === 0));
  const noModelReceipts = actual.byModel === undefined || (actual.byModel !== null && typeof actual.byModel === "object"
    && !Array.isArray(actual.byModel) && Object.keys(actual.byModel).length === 0);
  return actual.responsesWithUsage === 0 && zeroTokens && noModelReceipts && roles.some(role => role.status === "failed")
    && roles.every(committeeRoleProvesNoUsage);
}

export function completeCommitteeReview(value: unknown) {
  const committee = object(value);
  if (committee.ok !== true || Number(committee.agentsFailed) !== 0) return false;
  const summary = object(object(committee.output).modelUsageSummary);
  const plan = object(summary.reviewPlan);
  if (plan.policy === undefined) return Number(committee.agentsCompleted) === 14;
  if (plan.policy !== FOCUSED_REVIEW_POLICY || !Array.isArray(plan.agentIds)) return false;
  const ids = plan.agentIds;
  if (ids.length < 3 || ids.length > 6 || new Set(ids).size !== ids.length
    || ids.some(id => typeof id !== "string" || !focusedRoles.has(id))
    || FOCUSED_CORE_ROLES.some(id => !ids.includes(id))
    || Number(committee.agentsCompleted) !== ids.length) return false;
  const roles = Array.isArray(summary.roleDiagnostics) ? summary.roleDiagnostics.map(object) : [];
  return roles.length === ids.length && ids.every(id => roles.filter(r => r.agentId === id && r.status === "completed").length === 1);
}
