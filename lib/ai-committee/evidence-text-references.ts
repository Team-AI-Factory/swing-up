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
      if (Object.hasOwn(item, "verbatimTextRef") || Object.hasOwn(item, "verbatimTextParts")) referenceCollision = true;
      Object.values(item).forEach(visit);
    }
  };
  visit(original);
  const unchanged = { evidencePack: original, sharedEvidenceTexts: {} as Record<string, string>, references: 0, embeddedReferences: 0 };
  // Source content must never be confused with our own reference syntax.
  if (referenceCollision) return unchanged;
  const ids = new Map<string, string>();
  const sharedEvidenceTexts: Record<string, string> = {};
  for (const [text, count] of counts) {
    // A complete field may also occur inside a source-prefixed or qualified
    // field. Reuse that exact text, never a guessed common fragment.
    const repeatedInWrapper = count < 2 && [...counts.keys()].some(other => other !== text && other.includes(text));
    if (count < 2 && !repeatedInWrapper) continue;
    const id = `verbatim_${ids.size + 1}`;
    ids.set(text, id);
    sharedEvidenceTexts[id] = text;
  }
  if (!ids.size) return unchanged;
  let references = 0;
  let embeddedReferences = 0;
  // The runner embeds a receipt's complete summary in whatHappened with a
  // source prefix and causal-path suffix. Keep those literals exactly, while
  // reusing only a text already shared by at least two complete fields.
  const shared = [...ids.entries()].sort(([left], [right]) => right.length - left.length);
  const referenceEmbeddedText = (item: string): unknown => {
    if (/^https?:\/\//i.test(item)) return item;
    const parts: Array<string | { verbatimTextRef: string }> = [];
    let offset = 0;
    while (offset < item.length) {
      let match: { at: number; text: string; id: string } | null = null;
      for (const [text, id] of shared) {
        const at = item.indexOf(text, offset);
        if (at >= 0 && (!match || at < match.at)) match = { at, text, id };
      }
      if (!match) break;
      if (match.at > offset) parts.push(item.slice(offset, match.at));
      parts.push({ verbatimTextRef: match.id });
      references++;
      embeddedReferences++;
      offset = match.at + match.text.length;
    }
    if (!parts.length) return item;
    if (offset < item.length) parts.push(item.slice(offset));
    return { verbatimTextParts: parts };
  };
  const replace = (item: unknown): unknown => {
    if (typeof item === "string" && ids.has(item)) {
      references++;
      return { verbatimTextRef: ids.get(item)! };
    }
    if (typeof item === "string") return referenceEmbeddedText(item);
    if (Array.isArray(item)) return item.map(replace);
    if (item && typeof item === "object") return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, replace(child)]));
    return item;
  };
  const evidencePack = replace(original) as Json;
  const bytes = (item: unknown) => new TextEncoder().encode(JSON.stringify(item)).byteLength;
  // Include the readable reference instruction and framing in the saving.
  const instructions = SHARED_EVIDENCE_TEXT_INSTRUCTIONS + (embeddedReferences ? ` ${SHARED_EVIDENCE_TEXT_PARTS_INSTRUCTIONS}` : "");
  if (bytes({ evidencePack, sharedEvidenceTexts }) + bytes(instructions) + 16 >= bytes({ evidencePack: original })) return unchanged;
  return { evidencePack, sharedEvidenceTexts, references, embeddedReferences };
}

export const SHARED_EVIDENCE_TEXT_INSTRUCTIONS = "Each verbatimTextRef points to the complete, unchanged text under sharedEvidenceTexts in this same prompt. Read that text at every referenced field in its original role-specific context. Source links, dates, conditions, contradictions and missing-data flags remain alongside their fields. A reference is not missing evidence; repeated placement is not another independent source.";
export const SHARED_EVIDENCE_TEXT_PARTS_INSTRUCTIONS = "A verbatimTextParts array is one original string: concatenate its literal strings and referenced texts in order, with no added spaces or changes.";
