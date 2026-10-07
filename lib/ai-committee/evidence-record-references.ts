type Json = Record<string, unknown>;
const bytes = (value: unknown) => new TextEncoder().encode(JSON.stringify(value)).byteLength;

export const SHARED_EVIDENCE_RECORD_INSTRUCTIONS = "Each verbatimRecord is one unchanged financial fact object: its first array entry names the ordered field names in sharedEvidenceKeys in this same prompt; pair those names with the remaining array entries in order. A verbatimRecordList preserves one original array: fields names its sharedEvidenceKeys entry; each array in items is one fact's ordered values, while object items remain individual context objects. Preserve item order. Every value, including null, date, unit, source URL and qualifier, is literal and unchanged. Read each reconstructed object at its original evidence position; repeated placement is not an independent source.";

/** Factor only repeated field names. Keep all financial values, dates and URLs
 * directly visible, in order, without changing the stored evidence or gates. */
export function referenceFinancialEvidenceRecords(value: Json) {
  const original = JSON.parse(JSON.stringify(value)) as Json;
  const unchanged = { evidencePack: original, sharedEvidenceKeys: {} as Record<string, string[]>, records: 0 };
  const groups = new Map<string, { keys: string[]; records: Json[] }>();
  let collision = false;
  const eligible = (item: Json) => ["metric", "value", "unit", "periodEnd", "sourceUrl"].every(key => Object.hasOwn(item, key))
    && Object.values(item).every(child => child === null || ["string", "number", "boolean"].includes(typeof child));
  const visit = (item: unknown) => {
    if (Array.isArray(item)) item.forEach(visit);
    else if (item && typeof item === "object") {
      const record = item as Json;
      if (["verbatimRecord", "verbatimRecordList", "sharedEvidenceKeys"].some(key => Object.hasOwn(record, key))) collision = true;
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
  let records = 0;
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
      return { verbatimRecord: [id, ...keys.map(key => record[key])] };
    }
    return Object.fromEntries(Object.entries(record).map(([key, child]) => [key, replace(child)]));
  };
  const evidencePack = replace(original) as Json;
  if (bytes({ evidencePack, sharedEvidenceKeys }) + bytes(SHARED_EVIDENCE_RECORD_INSTRUCTIONS) + 16 >= bytes({ evidencePack: original })) return unchanged;
  return { evidencePack, sharedEvidenceKeys, records };
}
