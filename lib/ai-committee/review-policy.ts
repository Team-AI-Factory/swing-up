/** A saved review must prove that every role in its versioned plan completed. */
type Json = Record<string, unknown>;
const object = (v: unknown): Json => v && typeof v === "object" && !Array.isArray(v) ? v as Json : {};
export const FOCUSED_REVIEW_POLICY = "focused_v1";
export const FOCUSED_CORE_ROLES = ["analyst_agent", "skeptic_agent", "final_judge"] as const;
const focusedRoles = new Set<string>([...FOCUSED_CORE_ROLES, "accountant_agent", "valuation_dcf_agent", "industry_agent"]);

export function committeeRequestsRejectedWithoutUsage(value: unknown) {
  const summary = object(object(object(value).output).modelUsageSummary);
  const roles = Array.isArray(summary.roleDiagnostics) ? summary.roleDiagnostics.map(object) : [];
  return Number(object(summary.actualOpenAiUsage).responsesWithUsage) === 0 && roles.some(role => role.status === "failed")
    && roles.every(role => ["blocked", "planned"].includes(String(role.status)) ||
      [400, 401, 403, 404, 422, 429].includes(Number(object(role.providerFailure).httpStatus)) ||
      ["not_configured", "disabled", "confirmation_required", "model_not_configured", "model_not_allowed", "prompt_too_large"].includes(String(role.error)));
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
