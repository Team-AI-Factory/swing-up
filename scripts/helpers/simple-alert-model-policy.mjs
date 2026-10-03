// Keep the attested pilot sensor's deployed routing identical to the reviewed
// price/reservation policy. This changes no stored Railway variables.
export const simpleAlertModelEnvironment = Object.freeze({
  OPENAI_MODEL: "gpt-6.1-sol",
  AI_COMMITTEE_FAST_MODEL: "gpt-6-luna",
  AI_COMMITTEE_DEEP_MODEL: "gpt-6.1-sol",
  AI_COMMITTEE_FINAL_MODEL: "gpt-6-astra",
  AI_COMMITTEE_MODEL_ALLOWLIST: "gpt-6-luna,gpt-6.1-sol,gpt-6-astra",
});
export function applySimpleAlertModelPolicy(env) {
  return { ...env, ...simpleAlertModelEnvironment };
}
