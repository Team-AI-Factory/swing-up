type Json = Record<string, unknown>;
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

export const SHARED_EVIDENCE_RECORD_INSTRUCTIONS = "Each verbatimRecord is one unchanged financial fact object: its first array entry names the ordered field names in sharedEvidenceKeys in this same prompt; pair those names with the remaining array entries in order. A verbatimRecordList preserves one original array: fields names its sharedEvidenceKeys entry; each array in items is one fact's ordered values, while object items remain individual context objects. Preserve item order. Every value, including null, date, unit, source URL and qualifier, is literal and unchanged. Read each reconstructed object at its original evidence position; repeated placement is not an independent source.";

export const SHARED_EVIDENCE_VALUE_INSTRUCTIONS = "Within financial record rows, each verbatimValueRef points to the complete unchanged string in sharedEvidenceValues in this same prompt. Substitute that string before pairing values with field names. This includes full source URLs and qualifiers; preserve every character and field context. Other values remain literal. A repeated value is not an independent source.";

/** Factor repeated financial field names and exact repeated strings. Every
 * value remains readable in this same prompt, never summarized or truncated. */
export function referenceFinancialEvidenceRecords(value: Json) {
  const original = JSON.parse(JSON.stringify(value)) as Json;
  const unchanged = { evidencePack: original, sharedEvidenceKeys: {} as Record<string, string[]>, records: 0,
    sharedEvidenceValues: {} as Record<string, string>, valueReferences: 0 };
  const groups = new Map<string, { keys: string[]; records: Json[] }>();
  let collision = false;
  const eligible = (item: Json) => ["metric", "value", "unit", "periodEnd", "sourceUrl"].every(key => Object.hasOwn(item, key))
    && Object.values(item).every(child => child === null || ["string", "number", "boolean"].includes(typeof child));
  const visit = (item: unknown) => {
    if (Array.isArray(item)) item.forEach(visit);
    else if (item && typeof item === "object") {
      const record = item as Json;
      if (["verbatimRecord", "verbatimRecordList", "sharedEvidenceKeys", "verbatimValueRef", "sharedEvidenceValues"].some(key => Object.hasOwn(record, key))) collision = true;
      if (eligible(record)) {
        const keys = Object.keys(record), signature = JSON.stringify(keys);
        const group = groups.get(signature) ?? { keys, records: [] };
        group.records.push(record);
        groups.set(signature, group);
      } else Object.values(record).forEach(visit);
    }
  };
  visit(original);
  if (collision) return unchanged;
  const ids = new Map<string, string>(), sharedEvidenceKeys: Record<string, string[]> = {};
  for (const [signature, group] of groups) {
    const id = `fields_${ids.size + 1}`;
    const encoded = group.records.map(record => ({ verbatimRecord: [id, ...group.keys.map(key => record[key])] }));
    if (group.records.length < 2 || bytes(encoded) + bytes({ [id]: group.keys }) >= bytes(group.records)) continue;
    ids.set(signature, id);
    sharedEvidenceKeys[id] = group.keys;
  }
  if (!ids.size) return unchanged;
  // Count only scalar strings belonging to rows that will actually be encoded.
  // Do not infer common fragments or change non-financial context/previousResults.
  const counts = new Map<string, number>();
  for (const [signature, group] of groups) {
    if (!ids.has(signature)) continue;
    for (const record of group.records) for (const item of Object.values(record)) {
      if (typeof item === "string") counts.set(item, (counts.get(item) ?? 0) + 1);
    }
  }
  const valueIds = new Map<string, string>(), sharedEvidenceValues: Record<string, string> = {};
  for (const [item, count] of counts) {
    const id = `value_${valueIds.size + 1}`;
    if (count < 2 || count * bytes({ verbatimValueRef: id }) + bytes({ [id]: item }) >= count * bytes(item)) continue;
    valueIds.set(item, id);
    sharedEvidenceValues[id] = item;
  }
  let records = 0, valueReferences = 0;
  const replaceValue = (item: unknown): unknown => {
    const id = typeof item === "string" ? valueIds.get(item) : undefined;
    if (!id) return item;
    valueReferences++;
    return { verbatimValueRef: id };
  };
  const replace = (item: unknown): unknown => {
    if (Array.isArray(item)) {
      const replaced = item.map(replace);
      // Mixed context/fact arrays retain every original position. Only arrays
      // originally containing objects can use bare arrays as financial rows.
      if (!item.every(child => child && typeof child === "object" && !Array.isArray(child))) return replaced;
      const rowIds = replaced.flatMap(child => child && typeof child === "object" && !Array.isArray(child)
        && Object.hasOwn(child, "verbatimRecord") ? [(child as { verbatimRecord: unknown[] }).verbatimRecord[0]] : []);
      if (rowIds.length < 2 || new Set(rowIds).size !== 1) return replaced;
      const grouped = { verbatimRecordList: { fields: rowIds[0], items: replaced.map(child => child && typeof child === "object"
        && !Array.isArray(child) && Object.hasOwn(child, "verbatimRecord")
        ? (child as { verbatimRecord: unknown[] }).verbatimRecord.slice(1) : child) } };
      return bytes(grouped) < bytes(replaced) ? grouped : replaced;
    }
    if (!item || typeof item !== "object") return item;
    const record = item as Json, keys = Object.keys(record);
    const id = eligible(record) ? ids.get(JSON.stringify(keys)) : undefined;
    if (id) {
      records++;
      return { verbatimRecord: [id, ...keys.map(key => replaceValue(record[key]))] };
    }
    return Object.fromEntries(Object.entries(record).map(([key, child]) => [key, replace(child)]));
  };
  let evidencePack = replace(original) as Json;
  // Account for the entire dictionary and decoding instruction, not just rows.
  // If value sharing costs more, rebuild the rows with literal values.
  if (valueReferences) {
    const withValues = evidencePack;
    valueIds.clear();
    records = 0;
    const literalValues = replace(original) as Json;
    if (bytes({ evidencePack: withValues, sharedEvidenceKeys, sharedEvidenceValues }) + bytes(SHARED_EVIDENCE_VALUE_INSTRUCTIONS) + 16
      < bytes({ evidencePack: literalValues, sharedEvidenceKeys })) evidencePack = withValues;
    else {
      evidencePack = literalValues;
      valueReferences = 0;
    }
  }
  const dictionary = valueReferences ? { sharedEvidenceValues } : {};
  const instructions = SHARED_EVIDENCE_RECORD_INSTRUCTIONS + (valueReferences ? ` ${SHARED_EVIDENCE_VALUE_INSTRUCTIONS}` : "");
  if (bytes({ evidencePack, sharedEvidenceKeys, ...dictionary }) + bytes(instructions) + 16 >= bytes({ evidencePack: original })) return unchanged;
  return { evidencePack, sharedEvidenceKeys, records, sharedEvidenceValues: valueReferences ? sharedEvidenceValues : {}, valueReferences };
}
