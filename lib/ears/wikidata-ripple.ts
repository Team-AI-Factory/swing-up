import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { writeRawSignal } from "@/lib/raw-signal-writer";

export const WIKIDATA_RIPPLE_SOURCE = "Wikidata";
const WIKIDATA_SPARQL_URL = "https://query.wikidata.org/sparql";
const REQUEST_TIMEOUT_MS = 10_000;
const USER_AGENT = "SwingUp/1.0 (wikidata-ripple; safe public relationship mapping; contact: ops@swingup.local)";

const SAFE_ENTITIES = [
  { qid: "Q312", ticker: "AAPL", name: "Apple Inc." },
  { qid: "Q182477", ticker: "NVDA", name: "Nvidia" },
  { qid: "Q2283", ticker: "MSFT", name: "Microsoft" },
  { qid: "Q128896", ticker: "AMD", name: "Advanced Micro Devices" },
] as const;

const RELATIONSHIP_PROPERTIES = [
  { property: "wdt:P749", wikidataProperty: "P749", relationshipType: "parent company", confidence: "high" },
  { property: "wdt:P355", wikidataProperty: "P355", relationshipType: "subsidiary", confidence: "high" },
  { property: "wdt:P452", wikidataProperty: "P452", relationshipType: "industry", confidence: "medium" },
  { property: "wdt:P1056", wikidataProperty: "P1056", relationshipType: "product/category", confidence: "medium" },
  { property: "wdt:P127", wikidataProperty: "P127", relationshipType: "parent company", confidence: "high" },
] as const;

type WikidataBindingValue = { value?: string };
type WikidataBinding = {
  entity?: WikidataBindingValue;
  entityLabel?: WikidataBindingValue;
  property?: WikidataBindingValue;
  propertyLabel?: WikidataBindingValue;
  related?: WikidataBindingValue;
  relatedLabel?: WikidataBindingValue;
};

type WikidataSparqlResponse = { results?: { bindings?: WikidataBinding[] } };

export type WikidataRelationship = {
  sourceEntityId: string;
  sourceEntityName: string;
  sourceTicker: string | null;
  relationshipType: string;
  confidence: "high" | "medium" | "low";
  relatedEntityId: string;
  relatedEntityName: string;
  wikidataProperty: string;
  wikidataUrl: string;
  notes: string;
};

export type WikidataRippleRunResult = {
  ok: boolean;
  source: typeof WIKIDATA_RIPPLE_SOURCE;
  dryRun: boolean;
  entitiesChecked: number;
  relationshipsFound: number;
  rawSignalsCreated: number;
  duplicatesSkipped: number;
  rejected: number;
  warnings: string[];
  sourceHealthStatus: string;
  relationships: WikidataRelationship[];
};

function entityId(uri?: string) {
  return uri?.match(/Q\d+$/)?.[0] ?? null;
}

function wikidataEntityUrl(qid: string) {
  return `https://www.wikidata.org/wiki/${qid}`;
}

function buildQuery() {
  const entityValues = SAFE_ENTITIES.map((entity) => `wd:${entity.qid}`).join(" ");
  const union = RELATIONSHIP_PROPERTIES.map((relation) => `{ ?entity ${relation.property} ?related . BIND("${relation.wikidataProperty}" AS ?property) }`).join(" UNION ");
  return `SELECT ?entity ?entityLabel ?property ?propertyLabel ?related ?relatedLabel WHERE {
  VALUES ?entity { ${entityValues} }
  ${union}
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
} LIMIT 40`;
}

async function fetchWikidataRelationships() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const url = new URL(WIKIDATA_SPARQL_URL);
  url.searchParams.set("query", buildQuery());
  url.searchParams.set("format", "json");

  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers: { Accept: "application/sparql-results+json", "User-Agent": USER_AGENT },
      signal: controller.signal,
    });

    if (response.status === 429) return { rateLimited: true, bindings: [] as WikidataBinding[] };
    if (!response.ok) throw new Error(`Wikidata SPARQL returned ${response.status}`);

    const json = (await response.json()) as WikidataSparqlResponse;
    return { rateLimited: false, bindings: json.results?.bindings ?? [] };
  } finally {
    clearTimeout(timeout);
  }
}

function mapBindings(bindings: WikidataBinding[]): { relationships: WikidataRelationship[]; rejected: number; duplicatesSkipped: number } {
  const seen = new Set<string>();
  let rejected = 0;
  let duplicatesSkipped = 0;
  const relationships: WikidataRelationship[] = [];

  for (const binding of bindings) {
    const sourceEntityId = entityId(binding.entity?.value);
    const relatedEntityId = entityId(binding.related?.value);
    const property = binding.property?.value;
    const relation = RELATIONSHIP_PROPERTIES.find((item) => item.wikidataProperty === property);
    const sourceEntity = SAFE_ENTITIES.find((entity) => entity.qid === sourceEntityId);
    const relatedEntityName = binding.relatedLabel?.value?.trim();

    if (!sourceEntityId || !relatedEntityId || !relation || !sourceEntity || !relatedEntityName) {
      rejected += 1;
      continue;
    }

    const key = `${sourceEntityId}|${relation.wikidataProperty}|${relatedEntityId}`;
    if (seen.has(key)) {
      duplicatesSkipped += 1;
      continue;
    }
    seen.add(key);

    relationships.push({
      sourceEntityId,
      sourceEntityName: binding.entityLabel?.value?.trim() || sourceEntity.name,
      sourceTicker: sourceEntity.ticker,
      relationshipType: relation.relationshipType,
      confidence: relation.confidence,
      relatedEntityId,
      relatedEntityName,
      wikidataProperty: relation.wikidataProperty,
      wikidataUrl: wikidataEntityUrl(relatedEntityId),
      notes: relation.confidence === "high" ? "Direct Wikidata relationship statement; do not promote without current market evidence." : "Direct Wikidata contextual relationship statement; label as context and verify before use.",
    });
  }

  return { relationships, rejected, duplicatesSkipped };
}

async function updateSourceHealth(status: "connected" | "degraded" | "error", startedAt: number, errorMessage: string | null) {
  if (!process.env.DATABASE_URL) return "not_configured";
  const now = new Date();
  await prisma.sourceHealth.upsert({
    where: { source: WIKIDATA_RIPPLE_SOURCE },
    create: { source: WIKIDATA_RIPPLE_SOURCE, status, checkedAt: now, lastSuccessAt: status === "error" ? null : now, responseTimeMs: Date.now() - startedAt, errorMessage, usage: "Public Wikidata relationship mapping ear for ripple-effect context", notes: "Uses tiny SPARQL samples with no API key. Relationship facts are context only and never publish alerts." },
    update: { status, checkedAt: now, lastSuccessAt: status === "error" ? undefined : now, responseTimeMs: Date.now() - startedAt, errorMessage, usage: "Public Wikidata relationship mapping ear for ripple-effect context", notes: "Uses tiny SPARQL samples with no API key. Relationship facts are context only and never publish alerts." },
  });
  return status;
}

export async function runWikidataRippleIngestion(options: { dryRun?: boolean } = {}): Promise<WikidataRippleRunResult> {
  const startedAt = Date.now();
  const dryRun = options.dryRun ?? true;
  const warnings: string[] = [];
  let rawSignalsCreated = 0;
  let rawDuplicatesSkipped = 0;

  try {
    const fetched = await fetchWikidataRelationships();
    if (fetched.rateLimited) {
      warnings.push("Wikidata returned HTTP 429; no retry was attempted and no data was written.");
      const sourceHealthStatus = await updateSourceHealth("degraded", startedAt, "Wikidata rate limited request with HTTP 429");
      return { ok: true, source: WIKIDATA_RIPPLE_SOURCE, dryRun, entitiesChecked: SAFE_ENTITIES.length, relationshipsFound: 0, rawSignalsCreated, duplicatesSkipped: 0, rejected: 0, warnings, sourceHealthStatus, relationships: [] };
    }

    const mapped = mapBindings(fetched.bindings);
    if (!mapped.relationships.length) warnings.push("No direct supported Wikidata relationships were found in the tiny safe sample.");
    warnings.push("No dedicated relationship/ripple persistence model exists yet; returning mapped relationships and writing raw signals only when dryRun=false.");
    warnings.push("Supplier/customer and competitor/ecosystem links are omitted unless Wikidata provides a supported direct statement in this adapter.");

    if (!dryRun) {
      for (const relationship of mapped.relationships) {
        const result = await writeRawSignal({
          sourceName: WIKIDATA_RIPPLE_SOURCE,
          sourceType: "other",
          ticker: relationship.sourceTicker,
          company: relationship.sourceEntityName,
          eventType: "relationship_mapping",
          title: `${relationship.sourceEntityName} Wikidata relationship: ${relationship.relationshipType} → ${relationship.relatedEntityName}`,
          summary: `Wikidata maps ${relationship.sourceEntityName} to ${relationship.relatedEntityName} as ${relationship.relationshipType}. This is ripple context only, not a promoted stock signal.`,
          url: relationship.wikidataUrl,
          detectedAt: new Date(),
          duplicateKey: `${WIKIDATA_RIPPLE_SOURCE}|${relationship.sourceEntityId}|${relationship.wikidataProperty}|${relationship.relatedEntityId}`,
          qualityHints: { importanceHint: relationship.confidence === "high" ? "medium" : "low", confidence: relationship.confidence === "high" ? 0.8 : 0.55, sourceQuality: "medium", useful: true, reasons: ["relationship_mapping", relationship.relationshipType] },
          rawPayload: { wikidataRipple: relationship } as Prisma.InputJsonObject,
          dryRun,
        });
        if (result.status === "saved") rawSignalsCreated += 1;
        else if (result.status === "skipped" && result.reason === "duplicate") rawDuplicatesSkipped += 1;
      }
    }

    const sourceHealthStatus = await updateSourceHealth(mapped.relationships.length ? "connected" : "degraded", startedAt, null);
    return { ok: true, source: WIKIDATA_RIPPLE_SOURCE, dryRun, entitiesChecked: SAFE_ENTITIES.length, relationshipsFound: mapped.relationships.length, rawSignalsCreated, duplicatesSkipped: mapped.duplicatesSkipped + rawDuplicatesSkipped, rejected: mapped.rejected, warnings, sourceHealthStatus, relationships: mapped.relationships };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 180) : "Wikidata relationship mapping failed";
    warnings.push(message);
    const sourceHealthStatus = await updateSourceHealth("error", startedAt, message);
    return { ok: true, source: WIKIDATA_RIPPLE_SOURCE, dryRun, entitiesChecked: SAFE_ENTITIES.length, relationshipsFound: 0, rawSignalsCreated, duplicatesSkipped: 0, rejected: 0, warnings, sourceHealthStatus, relationships: [] };
  }
}
