const preparationStages = ["submissions_snapshot_read", "provider_budget_reservation", "submissions_snapshot_persistence"] as const;
export type Pr262SourcePreparationStage = typeof preparationStages[number];
const storageBoundaries = ["r2_read", "r2_write", "unknown"] as const;
type Provenance = { version: 1; stage: Pr262SourcePreparationStage | "unknown";
  storageBoundary: typeof storageBoundaries[number]; errorName: string; message: string };
const safe = (text: unknown, maximum: number) => typeof text === "string"
  ? text.replace(/https?:\/\/[^\s]+/gi, "[url]").replace(/[\u0000-\u001f\u007f\ud800-\udfff;]/g, " ").slice(0, maximum) : "unknown";

function provenance(error: unknown, fallbackStage?: Pr262SourcePreparationStage): Provenance {
  const value = error && typeof error === "object" ? error as Record<string, unknown> : {};
  return { version: 1,
    stage: preparationStages.find(stage => stage === value.sourcePreparationStage) ?? fallbackStage ?? "unknown",
    storageBoundary: value.storageDomain === "r2_state" && value.storageOperation === "read" ? "r2_read"
      : value.storageDomain === "r2_state" && value.storageOperation === "write" ? "r2_write" : "unknown",
    errorName: safe(value.name, 40), message: safe(value.message, 160) };
}
function describe(value: Provenance) {
  return `stage=${value.stage};storage_boundary=${value.storageBoundary};error=${safe(value.errorName, 40)};message=${safe(value.message, 160)}`;
}

// Diagnostic boundaries, not claims about the failed physical HTTP operation:
// a conditional storage write may also contain a reconciliation read.
export function pr262SourcePreparationProvenance(error: unknown, fallbackStage?: Pr262SourcePreparationStage) {
  return describe(provenance(error, fallbackStage));
}

export function encodePr262SourcePreparationProvenance(error: unknown, stage: Pr262SourcePreparationStage) {
  return encodeURIComponent(JSON.stringify(provenance(error, stage)));
}

export function decodePr262SourcePreparationProvenance(encoded: string | null) {
  const unknown = () => describe(provenance(null));
  if (!encoded || encoded.length > 2_000) return unknown();
  try {
    const value: unknown = JSON.parse(decodeURIComponent(encoded));
    if (!value || typeof value !== "object" || Array.isArray(value)) return unknown();
    const row = value as Record<string, unknown>;
    const stage = preparationStages.find(stage => stage === row.stage) ?? (row.stage === "unknown" ? "unknown" : null);
    const storageBoundary = storageBoundaries.find(boundary => boundary === row.storageBoundary);
    if (row.version !== 1 || !stage || !storageBoundary || typeof row.errorName !== "string" || typeof row.message !== "string") return unknown();
    return describe({ version: 1, stage, storageBoundary, errorName: row.errorName, message: row.message });
  } catch { return unknown(); }
}
