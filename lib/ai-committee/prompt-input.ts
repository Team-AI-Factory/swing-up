import type { AiCommitteeRunOptions, AiCommitteeProviderFailure } from "@/lib/ai-committee/provider";
import { AI_COMMITTEE_REVIEW_MAX_PROMPT_BYTES, reasoningCommitteeModel } from "@/lib/ai-committee/model-policy";

// Advance only when the actual prompt transport or limit policy changes.
// This version applies to proven-zero technical input holds, never completed reviews.
export const AI_COMMITTEE_INPUT_POLICY_REVISION = "utf8-schema-framing-60000-lossless-records-v2";

/** Bound the text the model receives, including role/schema framing. JSON's
 * transport escaping is decoded before tokenization and is not extra input. */
export function committeePromptInputBytes(messages: Array<{ role: string; content: string }>, responseFormat?: unknown) {
  const encoder = new TextEncoder();
  return messages.reduce((total, message) => total + encoder.encode(message.content).byteLength, 0)
    + encoder.encode(JSON.stringify(messages.map(message => ({ ...message, content: "" })))).byteLength
    + (responseFormat ? encoder.encode(JSON.stringify(responseFormat)).byteLength : 0);
}

function promptSectionBytes(messages: Array<{ role: string; content: string }>, responseFormat?: unknown) {
  const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;
  const sections: Record<string, number> = {
    system: messages.filter(message => message.role === "system" || message.role === "developer")
      .reduce((sum, message) => sum + new TextEncoder().encode(message.content).byteLength, 0),
    user: messages.filter(message => message.role === "user")
      .reduce((sum, message) => sum + new TextEncoder().encode(message.content).byteLength, 0),
    responseSchema: responseFormat ? bytes(responseFormat) : 0,
    messageFraming: bytes(messages.map(message => ({ ...message, content: "" }))),
  };
  // Never persist source text or source-authored property names as diagnostics.
  const userMessages = messages.filter(message => message.role === "user");
  if (userMessages.length !== 1) return sections;
  try {
    const user = JSON.parse(userMessages[0].content);
    if (!user || typeof user !== "object" || Array.isArray(user)) return sections;
    for (const key of ["evidencePack", "sharedEvidenceTexts", "sharedEvidenceKeys", "previousResults", "decisionRules"]) {
      if (Object.hasOwn(user, key)) sections[key] = bytes(user[key]);
    }
    const pack = user.evidencePack;
    if (pack && typeof pack === "object" && !Array.isArray(pack)) {
      for (const key of ["financialDiligence", "evidenceSections", "whatHappened", "evidencePriority"]) {
        if (Object.hasOwn(pack, key)) sections[key] = bytes(pack[key]);
      }
      const diligence = pack.financialDiligence;
      if (diligence && typeof diligence === "object" && !Array.isArray(diligence)) {
        if (Object.hasOwn(diligence, "documents")) sections.financialDocuments = bytes(diligence.documents);
        if (Object.hasOwn(diligence, "valuationAudit")) sections.valuationAudit = bytes(diligence.valuationAudit);
      }
      const evidence = pack.evidenceSections;
      if (evidence && typeof evidence === "object" && !Array.isArray(evidence)) {
        for (const key of ["fundamentals", "filing", "news"]) {
          if (Object.hasOwn(evidence, key)) sections[key] = bytes(evidence[key]);
        }
      }
    }
  } catch { /* Non-JSON prompts retain only framing and message byte counts. */ }
  return sections;
}

/** Same pure gate for whole-review admission and each actual provider call. */
export function committeePromptPreflight(options: Pick<AiCommitteeRunOptions, "messages" | "maximumPromptBytes" | "responseSchema"> & { model: string }): AiCommitteeProviderFailure | undefined {
  const reasoning = reasoningCommitteeModel(options.model);
  const configuredPromptLimit = options.maximumPromptBytes ?? (reasoning ? AI_COMMITTEE_REVIEW_MAX_PROMPT_BYTES : undefined);
  if (!Number.isFinite(configuredPromptLimit)) return undefined;
  const maximumPromptBytes = Math.max(1_000, Math.min(reasoning ? AI_COMMITTEE_REVIEW_MAX_PROMPT_BYTES : Infinity, Math.floor(Number(configuredPromptLimit))));
  const messages = options.messages.map(message => reasoning && message.role === "system" ? { ...message, role: "developer" } : message);
  const responseFormat = options.responseSchema ? { type: "json_schema", json_schema: { ...options.responseSchema, strict: true } } : undefined;
  const promptBytes = committeePromptInputBytes(messages, responseFormat);
  return promptBytes > maximumPromptBytes ? { category: "input_limit", stopRemainingAgents: true, promptBytes, maximumPromptBytes,
    promptSectionBytes: promptSectionBytes(messages, responseFormat) } : undefined;
}
