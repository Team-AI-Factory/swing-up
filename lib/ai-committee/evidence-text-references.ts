type Json = Record<string, unknown>;
const MIN_SHARED_TEXT_BYTES = 512;

/** Preserve every serialized fact and its field context; share only identical
 * long strings. This is a readable within-prompt reference, never a summary. */
export function referenceRepeatedEvidenceText(value: Json) {
  // Match the existing JSON prompt's serialization semantics before comparing.
  const original = JSON.parse(JSON.stringify(value)) as Json;
  const counts = new Map<string, number>();
  let referenceCollision = false;
  const visit = (item: unknown) => {
    if (typeof item === "string") {
      // Keep source URLs directly visible in their original fields.
      if (!/^https?:\/\//i.test(item) && new TextEncoder().encode(item).byteLength >= MIN_SHARED_TEXT_BYTES) counts.set(item, (counts.get(item) ?? 0) + 1);
    } else if (Array.isArray(item)) item.forEach(visit);
    else if (item && typeof item === "object") {
      if (Object.hasOwn(item, "verbatimTextRef")) referenceCollision = true;
      Object.values(item).forEach(visit);
    }
  };
  visit(original);
  const unchanged = { evidencePack: original, sharedEvidenceTexts: {} as Record<string, string>, references: 0 };
  // Source content must never be confused with our own reference syntax.
  if (referenceCollision) return unchanged;
  const ids = new Map<string, string>();
  const sharedEvidenceTexts: Record<string, string> = {};
  for (const [text, count] of counts) {
    if (count < 2) continue;
    const id = `verbatim_${ids.size + 1}`;
    ids.set(text, id);
    sharedEvidenceTexts[id] = text;
  }
  if (!ids.size) return unchanged;
  let references = 0;
  const replace = (item: unknown): unknown => {
    if (typeof item === "string" && ids.has(item)) {
      references++;
      return { verbatimTextRef: ids.get(item)! };
    }
    if (Array.isArray(item)) return item.map(replace);
    if (item && typeof item === "object") return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, replace(child)]));
    return item;
  };
  const evidencePack = replace(original) as Json;
  const bytes = (item: unknown) => new TextEncoder().encode(JSON.stringify(item)).byteLength;
  // Include the readable reference instruction and framing in the saving.
  if (bytes({ evidencePack, sharedEvidenceTexts }) + bytes(SHARED_EVIDENCE_TEXT_INSTRUCTIONS) + 16 >= bytes({ evidencePack: original })) return unchanged;
  return { evidencePack, sharedEvidenceTexts, references };
}

export const SHARED_EVIDENCE_TEXT_INSTRUCTIONS = "Each verbatimTextRef points to the complete, unchanged text under sharedEvidenceTexts in this same prompt. Read that text at every referenced field in its original role-specific context. Source links, dates, conditions, contradictions and missing-data flags remain alongside their fields. A reference is not missing evidence; repeated placement is not another independent source.";
