import assert from "node:assert/strict";

// Independent decoder: verify byte-identical serialized evidence, never used in production.
export function restoreCommitteeEvidence(item, payload) {
  if (Array.isArray(item)) return item.map(value => restoreCommitteeEvidence(value, payload));
  if (!item || typeof item !== "object") return item;
  if (Object.keys(item).length === 1 && Object.hasOwn(item, "verbatimRecordList")) {
    const { fields, items } = item.verbatimRecordList;
    assert.ok(Object.hasOwn(payload.sharedEvidenceKeys, fields));
    const keys = payload.sharedEvidenceKeys[fields];
    return items.map(row => {
      if (!Array.isArray(row)) return restoreCommitteeEvidence(row, payload);
      assert.equal(keys.length, row.length);
      return Object.fromEntries(keys.map((key, index) => [key, restoreCommitteeEvidence(row[index], payload)]));
    });
  }
  if (Object.keys(item).length === 1 && Object.hasOwn(item, "verbatimRecord")) {
    const [id, ...values] = item.verbatimRecord;
    assert.ok(Object.hasOwn(payload.sharedEvidenceKeys, id));
    const keys = payload.sharedEvidenceKeys[id];
    assert.equal(keys.length, values.length);
    return Object.fromEntries(keys.map((key, index) => [key, restoreCommitteeEvidence(values[index], payload)]));
  }
  if (Object.keys(item).length === 1 && Object.hasOwn(item, "verbatimValueRef")) {
    assert.ok(Object.hasOwn(payload.sharedEvidenceValues, item.verbatimValueRef));
    return payload.sharedEvidenceValues[item.verbatimValueRef];
  }
  if (Object.keys(item).length === 1 && Object.hasOwn(item, "verbatimTextRef")) {
    assert.ok(Object.hasOwn(payload.sharedEvidenceTexts, item.verbatimTextRef));
    return payload.sharedEvidenceTexts[item.verbatimTextRef];
  }
  if (Object.keys(item).length === 1 && Object.hasOwn(item, "verbatimTextParts")) return item.verbatimTextParts.map(part => restoreCommitteeEvidence(part, payload)).join("");
  return Object.fromEntries(Object.entries(item).map(([key, value]) => [key, restoreCommitteeEvidence(value, payload)]));
}
