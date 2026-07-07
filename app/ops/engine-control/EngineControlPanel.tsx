"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };
type JsonRecord = { [key: string]: JsonValue };

type StageKey =
  | "initial"
  | "refresh"
  | "stage1"
  | "stage2"
  | "stage3"
  | "r2"
  | "source"
  | "fmp"
  | "article"
  | "liveSource"
  | "liveEvent"
  | "freeProof";

type StageResult = {
  stage: string;
  route: string;
  method: "GET" | "POST";
  status: string;
  result: string;
  signalFound: boolean | null;
  aiCommitteeRan: boolean | null;
  approved: boolean | null;
  published: boolean | null;
  publicAlertUrl: string | null;
  publicLedgerUrl: string | null;
  blockers: string[];
  warnings: string[];
  nextAction: string;
  discovery: {
    inspected: number | null;
    selectedFailed: string;
    nextSource: string;
    bestDirectTickerCandidate: string;
    proofCompletionSummary: string;
    fmpProvider403Note: string;
    stage2Allowed: boolean | null;
    storageMode: string;
  };
  catalyst: {
    configured: string;
    attempted: string;
    found: number;
    inspected: number;
    top: string;
    notes: string;
    diagnostics: string;
    impact: string;
    specificity: string;
    nextAction: string;
  };
  proofEnrichment: {
    attempted: boolean | null;
    added: number;
    receipts: string;
    urls: string;
    missing: string;
    best: string;
    accepted: string;
    rejected: string;
    rejectedReasons: string;
    matchScore: string;
  };
  json: JsonValue | null;
};

const SAFE_HEADERS = { "Content-Type": "application/json" };
const RUN_ROUTE = "/api/internal/run-live-alert-cycle";

const r2ResultFields = [
  "configured",
  "connected",
  "bucket",
  "canRead",
  "canWrite",
  "canDelete",
  "writeAttempted",
  "readAfterWriteAttempted",
  "deleteAttempted",
  "sourceOfTruth",
  "storageMode",
  "lastConfirmedWriteAt",
  "lastConfirmedDeleteAt",
  "errorCategory",
  "errorMessageSafe",
  "suspectedCause",
  "nextAction",
] as const;

const startupChecks: Array<{ key: StageKey; label: string; route: string }> = [
  { key: "initial", label: "Health", route: "/api/health" },
  {
    key: "initial",
    label: "Engine readiness",
    route: "/api/internal/engine-start-readiness",
  },
  {
    key: "initial",
    label: "Pipeline readiness",
    route: "/api/internal/pipeline-readiness",
  },
  {
    key: "initial",
    label: "AI Committee agents",
    route: "/api/ai-committee/agents",
  },
  {
    key: "initial",
    label: "Live cycle status",
    route: "/api/internal/live-alert-cycle-status",
  },
  {
    key: "initial",
    label: "7-layer ear registry",
    route: "/api/internal/ear-registry",
  },
  { key: "initial", label: "Alerts page", route: "/alerts" },
  { key: "initial", label: "Ledger page", route: "/ledger" },
];

const runPayloads = {
  stage1: {
    dryRun: true,
    confirmRun: false,
    confirmPublish: false,
    confirmSend: false,
    maxAlertsToPublish: 1,
    allowTelegram: false,
    maxRawSignalsToInspect: 50,
    maxFreshPullPerSource: 3,
    freshnessWindowHours: 72,
    includeLiveEars: true,
    includeStoryClustering: true,
    includeSeriousSignalBrain: true,
    universeMode: "global",
    maxAssetsToScanNow: 50,
    maxDeepScans: 5,
    includeOfficialAnnouncements: true,
    includeSmartSourcePull: true,
    includeLiveEventCalendar: true,
    includeAutonomousSourceEngine: true,
    includeEvidencePackBuilder: true,
    includeFreeProofRecovery: true,
    includeR2TruthCheck: true,
    includeFundamentalsFallback: true,
    includeOfficialProof: true,
    includeHistoricalMemory: true,
    includeRiskDetector: true,
    includeImprovedPriceVolume: true,
  },
  stage2: {
    dryRun: false,
    confirmRun: true,
    confirmPublish: false,
    confirmSend: false,
    maxAlertsToPublish: 1,
    allowTelegram: false,
  },
  stage3: {
    dryRun: false,
    confirmRun: true,
    confirmPublish: true,
    confirmSend: false,
    maxAlertsToPublish: 1,
    allowTelegram: false,
  },
} as const;

function isRecord(value: JsonValue | unknown): value is JsonRecord {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function textList(value: JsonValue | undefined): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item : JSON.stringify(item)))
    .filter(Boolean);
}

function findBoolean(value: JsonValue | null, names: string[]): boolean | null {
  if (!isRecord(value)) return null;
  for (const name of names) {
    if (typeof value[name] === "boolean") return value[name];
  }
  return null;
}

function findString(value: JsonValue | null, names: string[]): string | null {
  if (!isRecord(value)) return null;
  for (const name of names) {
    if (typeof value[name] === "string" && value[name].trim())
      return value[name];
  }
  return null;
}

function catalystSummary(json: JsonValue | null) {
  const summary =
    isRecord(json) && isRecord(json.catalystSummary)
      ? json.catalystSummary
      : null;
  const configured =
    summary && Array.isArray(summary.configuredProviders)
      ? summary.configuredProviders.map(String).join(", ") || "—"
      : "—";
  const attempted =
    summary && Array.isArray(summary.attemptedProviders)
      ? summary.attemptedProviders.map(String).join(", ") || "—"
      : "—";
  const found =
    summary && typeof summary.catalystSignalsFound === "number"
      ? summary.catalystSignalsFound
      : 0;
  const inspected =
    summary && typeof summary.catalystSignalsInspected === "number"
      ? summary.catalystSignalsInspected
      : 0;
  const top =
    summary && Array.isArray(summary.topCatalystCandidates)
      ? summary.topCatalystCandidates
          .slice(0, 3)
          .map((item) =>
            isRecord(item)
              ? `${item.source ?? "source"}: ${item.title ?? "untitled"}`
              : String(item),
          )
          .join(" | ") || "—"
      : "—";
  const missing =
    summary && Array.isArray(summary.missingCatalystKeys)
      ? summary.missingCatalystKeys.map(String)
      : [];
  const degraded =
    summary && Array.isArray(summary.degradedCatalystProviders)
      ? summary.degradedCatalystProviders.map(String)
      : [];
  const failed =
    summary && Array.isArray(summary.failedCatalystProviders)
      ? summary.failedCatalystProviders.map(String)
      : [];
  const diagnostics =
    summary && Array.isArray(summary.providerDiagnostics)
      ? summary.providerDiagnostics
          .map((item) =>
            isRecord(item)
              ? `${item.source}:${item.status}:${item.sourceHealthStatus}:${Array.isArray(item.errors) ? item.errors.slice(0, 2).join(",") : ""}`
              : String(item),
          )
          .join(" | ") || "—"
      : "—";
  const impacts =
    summary && Array.isArray(summary.topCatalystCandidates)
      ? summary.topCatalystCandidates
          .map((item) =>
            isRecord(item) && isRecord(item.catalystImpact)
              ? String(
                  item.catalystImpact.catalystImpactScore ??
                    item.catalystImpact.promotionScore ??
                    "—",
                )
              : "—",
          )
          .join(" | ")
      : "—";
  const specificity =
    summary && Array.isArray(summary.topCatalystCandidates)
      ? summary.topCatalystCandidates
          .map((item) =>
            isRecord(item) && isRecord(item.catalystImpact)
              ? String(item.catalystImpact.stockSpecificityScore ?? "—")
              : "—",
          )
          .join(" | ")
      : "—";
  const nextAction =
    findString(json, ["nextRecommendedAction", "nextAction"]) ??
    "Run Stage 1 first.";
  return {
    configured,
    attempted,
    found,
    inspected,
    top,
    notes:
      [
        ...missing.map((item) => `missing ${item}`),
        ...degraded.map((item) => `degraded ${item}`),
        ...failed.map((item) => `failed ${item}`),
      ].join(" | ") || "—",
    diagnostics,
    impact: impacts,
    specificity,
    nextAction,
  };
}

function proofEnrichmentSummary(json: JsonValue | null) {
  const summary =
    isRecord(json) && isRecord(json.proofEnrichmentSummary)
      ? json.proofEnrichmentSummary
      : null;
  const best =
    summary && isRecord(summary.bestProofBundle)
      ? summary.bestProofBundle
      : null;
  return {
    attempted:
      summary && typeof summary.attempted === "boolean"
        ? summary.attempted
        : null,
    added:
      summary && typeof summary.proofAddedCount === "number"
        ? summary.proofAddedCount
        : 0,
    receipts:
      summary && Array.isArray(summary.receiptsAdded)
        ? summary.receiptsAdded.map(String).join(" | ") || "—"
        : "—",
    urls:
      summary && Array.isArray(summary.urlsAdded)
        ? summary.urlsAdded.map(String).join(" | ") || "—"
        : "—",
    missing:
      summary && Array.isArray(summary.stillMissingProof)
        ? summary.stillMissingProof.map(String).join(" | ") || "—"
        : "—",
    best: best
      ? JSON.stringify({
          rawSignalId: best.rawSignalId,
          safeToPromote: best.safeToPromote,
          proofAddedTypes: best.proofAddedTypes,
        })
      : "—",
    accepted:
      summary && Array.isArray(summary.acceptedProofItems)
        ? summary.acceptedProofItems
            .map((item) => JSON.stringify(item))
            .join(" | ") || "—"
        : "—",
    rejected:
      summary && Array.isArray(summary.rejectedProofItems)
        ? summary.rejectedProofItems
            .map((item) => JSON.stringify(item))
            .join(" | ") || "—"
        : "—",
    rejectedReasons:
      summary && Array.isArray(summary.rejectedProofReasons)
        ? summary.rejectedProofReasons.map(String).join(" | ") || "—"
        : "—",
    matchScore:
      summary && typeof summary.proofMatchScore === "number"
        ? String(summary.proofMatchScore)
        : "—",
  };
}

function discoverySummary(json: JsonValue | null) {
  const summary =
    isRecord(json) && isRecord(json.candidateDiscoverySummary)
      ? json.candidateDiscoverySummary
      : null;
  const ranked =
    summary && Array.isArray(summary.rankedCandidates)
      ? summary.rankedCandidates
      : [];
  const selected = ranked.find(
    (item) =>
      isRecord(item) &&
      item.rawSignalId === (isRecord(json) ? json.selectedRawSignalId : null),
  );
  const bestDirect =
    summary && isRecord(summary.bestDirectTickerCandidate)
      ? summary.bestDirectTickerCandidate
      : null;
  const proofSummary =
    isRecord(json) && isRecord(json.proofEnrichmentSummary)
      ? json.proofEnrichmentSummary
      : null;
  const proofCompletion =
    summary && isRecord(summary.proofCompletionSummary)
      ? summary.proofCompletionSummary
      : proofSummary && isRecord(proofSummary.proofCompletionSummary)
        ? proofSummary.proofCompletionSummary
        : null;
  const catalyst =
    isRecord(json) && isRecord(json.catalystSummary)
      ? json.catalystSummary
      : null;
  const fmpProvider403 =
    catalyst?.fmpProvider403 === true ||
    /provider_403|plan_key_blocked|check fmp key/i.test(
      JSON.stringify(catalyst ?? ""),
    );
  const selectedReasons =
    isRecord(selected) && Array.isArray(selected.blockedReasons)
      ? selected.blockedReasons.map(String).join(" | ")
      : "—";
  const passCount =
    summary && typeof summary.passCount === "number" ? summary.passCount : 0;
  const publishable = isRecord(json) && json.publishable === true;
  const approvedForAiReview = isRecord(json) && json.stage2Allowed === true;
  const proofClean =
    proofSummary && typeof proofSummary.proofMatchingClean === "boolean"
      ? proofSummary.proofMatchingClean
      : false;
  const hasUnsafeMismatch = ranked.some(
    (item) => isRecord(item) && item.unsafeProofMismatchWarning === true,
  );
  const stage2Allowed =
    isRecord(json) && typeof json.stage2Allowed === "boolean"
      ? json.stage2Allowed &&
        passCount >= 1 &&
        (publishable || approvedForAiReview) &&
        proofClean &&
        !hasUnsafeMismatch &&
        findBoolean(json, ["published"]) !== true
      : false;
  return {
    inspected:
      summary && typeof summary.rawSignalsInspected === "number"
        ? summary.rawSignalsInspected
        : null,
    selectedFailed: selectedReasons || "—",
    nextSource:
      summary && typeof summary.recommendedNextSource === "string"
        ? summary.recommendedNextSource
        : "—",
    bestDirectTickerCandidate: bestDirect ? JSON.stringify(bestDirect) : "—",
    proofCompletionSummary: proofCompletion
      ? JSON.stringify(proofCompletion)
      : "—",
    fmpProvider403Note: fmpProvider403
      ? "FMP plan/key blocked — Check FMP key, account activation, or plan access."
      : "—",
    stage2Allowed,
    storageMode:
      isRecord(json) && typeof json.storageMode === "string"
        ? json.storageMode
        : "—",
  };
}

function summarize(
  stage: string,
  route: string,
  method: "GET" | "POST",
  httpStatus: number | "error",
  json: JsonValue | null,
): StageResult {
  const blockers = isRecord(json)
    ? [
        ...textList(json.blockers),
        ...textList(json.blockedReasons),
        ...textList(json.missingRequiredItems),
      ]
    : [];
  const warnings = isRecord(json)
    ? [...textList(json.warnings), ...textList(json.missingOptionalItems)]
    : [];
  const ok = findBoolean(json, [
    "ok",
    "readyToStartEngine",
    "readyForFirstPublicAlert",
  ]);
  const published = findBoolean(json, [
    "published",
    "didPublish",
    "alertPublished",
  ]);
  const approved = findBoolean(json, [
    "approved",
    "publishable",
    "readyForFirstPublicAlert",
    "approvedForPublish",
  ]);
  const aiCommitteeRan = findBoolean(json, [
    "aiCommitteeRan",
    "committeeRan",
    "ranAICommittee",
    "aiReviewRan",
  ]);
  const signalFound = findBoolean(json, [
    "signalFound",
    "foundSignal",
    "candidateFound",
    "hasCandidate",
    "hasApprovedSignal",
  ]);
  const publicAlertUrl = findString(json, ["publicAlertUrl", "alertUrl"]);
  const publicLedgerUrl = findString(json, ["publicLedgerUrl", "ledgerUrl"]);
  const nextAction =
    findString(json, ["nextRecommendedAction", "nextAction"]) ??
    (blockers.length
      ? "Resolve blockers before continuing."
      : "Continue to the next safe stage when ready.");
  const result =
    httpStatus === "error"
      ? "Request failed"
      : ok === false
        ? "Blocked or not ready"
        : ok === true
          ? "OK"
          : "Loaded";

  return {
    stage,
    route,
    method,
    status: String(httpStatus),
    result,
    signalFound,
    aiCommitteeRan,
    approved,
    published,
    publicAlertUrl,
    publicLedgerUrl,
    blockers,
    warnings,
    nextAction,
    discovery: discoverySummary(json),
    proofEnrichment: proofEnrichmentSummary(json),
    catalyst: catalystSummary(json),
    json,
  };
}

async function readResponse(response: Response): Promise<JsonValue> {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json"))
    return (await response.json()) as JsonValue;
  return {
    ok: response.ok,
    contentType,
    note: "Route returned non-JSON content and loaded without crashing.",
  };
}

function yesNo(value: boolean | null) {
  if (value === null) return "—";
  return value ? "yes" : "no";
}

function resultValue(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return "—";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number" || typeof value === "string")
    return String(value);
  return JSON.stringify(value, null, 2);
}

function registryPanel(row: StageResult | undefined) {
  const json = row?.json;
  const summary =
    isRecord(json) && isRecord(json.summary) ? json.summary : null;
  const rawWarehouse =
    isRecord(json) && isRecord(json.rawWarehouse) ? json.rawWarehouse : null;
  const ears = isRecord(json) && Array.isArray(json.ears) ? json.ears : [];
  const blocked = ears.filter(
    (ear) =>
      isRecord(ear) &&
      (ear.status === "blocked" ||
        ear.status === "planned" ||
        ear.status === "not_configured"),
  );
  return {
    summary,
    rawWarehouse,
    tier1: ears.filter((ear) => isRecord(ear) && ear.tier === "Tier 1").length,
    tier2: ears.filter((ear) => isRecord(ear) && ear.tier === "Tier 2").length,
    blockedPlanned: blocked.map((ear) =>
      isRecord(ear)
        ? `${ear.earName}: ${ear.status} — ${ear.howToSolve ?? ear.blocker ?? "review"}`
        : String(ear),
    ),
  };
}

function stage1ResultPanel(row: StageResult | undefined) {
  const json = row?.json;
  const discovery =
    isRecord(json) && isRecord(json.candidateDiscoverySummary)
      ? json.candidateDiscoverySummary
      : null;
  const proof =
    isRecord(json) && isRecord(json.proofEnrichmentSummary)
      ? json.proofEnrichmentSummary
      : null;
  const catalyst =
    isRecord(json) && isRecord(json.catalystSummary)
      ? json.catalystSummary
      : null;
  const ranked =
    discovery && Array.isArray(discovery.rankedCandidates)
      ? discovery.rankedCandidates
      : [];
  const bestCandidate =
    discovery && discovery.bestDirectTickerCandidate
      ? discovery.bestDirectTickerCandidate
      : (ranked.find(
          (item) => isRecord(item) && item.eligibleForBest === true,
        ) ?? null);
  const stage2Unlocked =
    isRecord(json) && typeof json.stage2Allowed === "boolean"
      ? json.stage2Allowed
      : (row?.discovery.stage2Allowed ?? null);

  return [
    { label: "ok", value: isRecord(json) ? json.ok : undefined },
    {
      label: "readyToStartEngine",
      value: findBoolean(json ?? null, [
        "readyToStartEngine",
        "readyForFirstPublicAlert",
      ]),
    },
    {
      label: "sourcesAttempted",
      value:
        discovery?.sourcesInspected ??
        catalyst?.attemptedProviders ??
        catalyst?.configuredProviders,
    },
    {
      label: "rawWarehouseAvailable",
      value: isRecord(json) ? json.rawWarehouseAvailable : undefined,
    },
    {
      label: "rawWarehouseWriteUnavailable",
      value: isRecord(json) ? json.rawWarehouseWriteUnavailable : undefined,
    },
    {
      label: "rawDataStored",
      value: isRecord(json) ? json.rawDataStored : undefined,
    },
    {
      label: "storageMode",
      value: isRecord(json) ? json.storageMode : row?.discovery.storageMode,
    },
    {
      label: "reasonStorageFallback",
      value: isRecord(json) ? json.reasonStorageFallback : undefined,
    },
    {
      label: "rawSignalsFound",
      value:
        discovery?.catalystSignalsFound ??
        catalyst?.catalystSignalsFound ??
        (row?.signalFound === true ? 1 : row?.signalFound === false ? 0 : null),
    },
    {
      label: "catalystSignalsFound",
      value: catalyst?.catalystSignalsFound ?? discovery?.catalystSignalsFound,
    },
    { label: "catalystSignalsSaved", value: catalyst?.catalystSignalsSaved },
    { label: "candidatesInspected", value: discovery?.rawSignalsInspected },
    { label: "candidatesPassed", value: discovery?.passCount },
    { label: "bestCandidate", value: bestCandidate },
    {
      label: "missingProof",
      value:
        discovery?.blockedReasonsBySignal ??
        proof?.enrichmentBlockedReasons ??
        row?.blockers,
    },
    {
      label: "articleReaderSummary",
      value: isRecord(json) ? json.articleReaderSummary : undefined,
    },
    {
      label: "articleMemoryReusedCount",
      value: isRecord(json) ? json.articleMemoryReusedCount : undefined,
    },
    {
      label: "articleReadAttemptedCount",
      value: isRecord(json) ? json.articleReadAttemptedCount : undefined,
    },
    { label: "proofMatchingClean", value: proof?.proofMatchingClean },
    {
      label: "cleanAcceptedProofCount",
      value: Array.isArray(proof?.acceptedProofItems)
        ? proof?.acceptedProofItems.length
        : 0,
    },
    { label: "proofAccepted", value: proof?.acceptedProofItems },
    { label: "proofRejected", value: proof?.rejectedProofItems },
    {
      label: "aiCommitteeRan",
      value:
        findBoolean(json ?? null, [
          "aiCommitteeRan",
          "committeeRan",
          "aiCommitteeCalled",
        ]) ?? false,
    },
    { label: "published", value: row?.published ?? false },
    {
      label: "sentToTelegram",
      value:
        findBoolean(json ?? null, ["sentToTelegram", "telegramSent"]) ?? false,
    },
    {
      label: "bestEarlySignalCandidate",
      value: discovery?.sevenLayerEvidenceModel ?? null,
    },
    {
      label: "stage2Unlocked",
      value:
        isRecord(json) && typeof json.stage2Unlocked === "boolean"
          ? json.stage2Unlocked
          : stage2Unlocked,
    },
    {
      label: "reasonStage2Locked",
      value:
        stage2Unlocked === true
          ? "—"
          : (row?.nextAction ??
            "Stage 1 has not found a candidate strong enough for Stage 2."),
    },
    {
      label: "finalRecommendation",
      value: isRecord(json) ? json.finalRecommendation : undefined,
    },
  ];
}

export default function EngineControlPanel() {
  const [secret, setSecret] = useState("");
  const [confirmPublish, setConfirmPublish] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [rows, setRows] = useState<StageResult[]>([]);
  const [message, setMessage] = useState(
    "Load the startup status, then run stages in order. Nothing here sends Telegram.",
  );

  const stage1AllowsStage2 = useMemo(
    () =>
      rows.some(
        (row) =>
          row.stage === "Stage 1 dry run" &&
          row.signalFound === true &&
          row.discovery.stage2Allowed === true &&
          row.published !== true,
      ),
    [rows],
  );
  const stage2Approved = useMemo(
    () =>
      rows.some(
        (row) =>
          row.stage === "Stage 2 real AI review, no publish" &&
          row.approved === true &&
          row.signalFound === true &&
          row.published !== true,
      ),
    [rows],
  );
  const latestStage1Row = useMemo(
    () => rows.find((row) => row.stage === "Stage 1 dry run"),
    [rows],
  );
  const registryRow = useMemo(
    () => rows.find((row) => row.stage === "7-layer ear registry"),
    [rows],
  );
  const latestR2Row = useMemo(
    () =>
      rows.find(
        (row) =>
          row.stage === "Test R2 Write/Delete" ||
          row.stage === "Check R2 health",
      ),
    [rows],
  );
  const latestFmpContractRow = useMemo(
    () => rows.find((row) => row.stage === "Run FMP Provider Contract Test"),
    [rows],
  );
  const fmpContractResults = useMemo(() => {
    const json = isRecord(latestFmpContractRow?.json)
      ? latestFmpContractRow.json
      : {};
    return Array.isArray(json.results) ? json.results.filter(isRecord) : [];
  }, [latestFmpContractRow]);

  function headers() {
    return secret.trim()
      ? { ...SAFE_HEADERS, "x-internal-api-secret": secret.trim() }
      : SAFE_HEADERS;
  }

  async function callGet(label: string, route: string) {
    try {
      const response = await fetch(route, {
        method: "GET",
        headers: headers(),
        cache: "no-store",
      });
      const json = await readResponse(response);
      return summarize(label, route, "GET", response.status, json);
    } catch (error) {
      return summarize(label, route, "GET", "error", {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  async function callPost(label: string, route: string, payload: JsonRecord) {
    try {
      const response = await fetch(route, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(payload),
        cache: "no-store",
      });
      const json = await readResponse(response);
      return summarize(label, route, "POST", response.status, json);
    } catch (error) {
      return summarize(label, route, "POST", "error", {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
    }
  }

  async function loadStartup() {
    setBusy("startup");
    setMessage("Checking live app routes from this browser session…");
    const nextRows = await Promise.all(
      startupChecks.map((check) => callGet(check.label, check.route)),
    );
    setRows((current) => [
      ...nextRows,
      ...current.filter(
        (row) => !startupChecks.some((check) => check.label === row.stage),
      ),
    ]);
    setMessage(
      "Startup status loaded. Missing optional routes are reported without crashing.",
    );
    setBusy(null);
  }

  async function refreshSourceHealth() {
    setBusy("source-health");
    const row = await callGet("Refresh source health", "/api/source-health");
    setRows((current) => [
      row,
      ...current.filter((item) => item.stage !== row.stage),
    ]);
    setMessage("Source health refreshed.");
    setBusy(null);
  }

  async function checkR2Health(confirmWrite: boolean) {
    setBusy(confirmWrite ? "r2-write" : "r2-health");
    setMessage(
      confirmWrite
        ? "Testing R2 write/delete… this may take a few seconds."
        : "Checking read-only R2 health…",
    );
    try {
      const response = await fetch("/api/internal/r2-health", {
        method: confirmWrite ? "POST" : "GET",
        headers: headers(),
        body: confirmWrite ? JSON.stringify({ confirmWrite: true }) : undefined,
        cache: "no-store",
      });
      const json = await readResponse(response);
      const row = summarize(
        confirmWrite ? "Test R2 Write/Delete" : "Check R2 health",
        "/api/internal/r2-health",
        confirmWrite ? "POST" : "GET",
        response.status,
        json,
      );
      setRows((current) => [
        row,
        ...current.filter((item) => item.stage !== row.stage),
      ]);
      setMessage(
        confirmWrite
          ? "R2 write/delete health test completed."
          : "R2 read-only health refreshed.",
      );
    } catch (error) {
      const row = summarize(
        confirmWrite ? "Test R2 Write/Delete" : "Check R2 health",
        "/api/internal/r2-health",
        confirmWrite ? "POST" : "GET",
        "error",
        {
          ok: false,
          error: error instanceof Error ? error.message : "Unknown error",
        },
      );
      setRows((current) => [
        row,
        ...current.filter((item) => item.stage !== row.stage),
      ]);
      setMessage("R2 health request failed.");
    }
    setBusy(null);
  }


  async function runFreeProofRecovery() {
    setBusy("freeProof");
    setMessage("Running R2 truth check plus free proof recovery in dry-run mode…");
    const row = await callPost(
      "Run R2 + Free Proof Recovery",
      "/api/internal/free-proof-recovery-run",
      {
        dryRun: true,
        confirmRun: false,
        maxCandidates: 20,
        includeR2TruthCheck: true,
        includeFundamentalsFallback: true,
        includeOfficialProof: true,
        includeHistoricalMemory: true,
        includeRiskDetector: true,
        includeImprovedPriceVolume: true,
      },
    );
    setRows((current) => [
      row,
      ...current.filter((item) => item.stage !== row.stage),
    ]);
    setMessage("Free proof recovery dry-run completed. No OpenAI, publish, or Telegram calls were made.");
    setBusy(null);
  }

  async function refreshReadiness() {
    setBusy("refresh");
    const row = await callGet(
      "Refresh engine readiness",
      "/api/internal/engine-start-readiness",
    );
    setRows((current) => [
      row,
      ...current.filter((item) => item.stage !== row.stage),
    ]);
    setMessage("Engine readiness refreshed.");
    setBusy(null);
  }

  async function runArticleReaderTest() {
    setBusy("article-reader");
    try {
      const response = await fetch("/api/internal/article-reader-test", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          dryRun: true,
          maxArticles: 5,
          confirmRun: false,
        }),
        cache: "no-store",
      });
      const json = await readResponse(response);
      const row = summarize(
        "Test Article Reader",
        "/api/internal/article-reader-test",
        "POST",
        response.status,
        json,
      );
      setRows((current) => [
        row,
        ...current.filter((item) => item.stage !== row.stage),
      ]);
      setMessage(
        "Article reader test completed. No OpenAI, publish, or Telegram permission was allowed.",
      );
    } catch (error) {
      const row = summarize(
        "Test Article Reader",
        "/api/internal/article-reader-test",
        "POST",
        "error",
        {
          ok: false,
          error: error instanceof Error ? error.message : "Unknown error",
        },
      );
      setRows((current) => [
        row,
        ...current.filter((item) => item.stage !== row.stage),
      ]);
      setMessage("Article reader test failed safely.");
    }
    setBusy(null);
  }

  async function runFmpProviderContractTest() {
    setBusy("fmp-contract");
    try {
      const response = await fetch("/api/internal/provider-contract-test", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          dryRun: true,
          provider: "FMP",
          symbols: ["NVDA", "AMD", "MSFT", "GOOGL"],
          confirmRun: false,
        }),
        cache: "no-store",
      });
      const json = await readResponse(response);
      const row = summarize(
        "Run FMP Provider Contract Test",
        "/api/internal/provider-contract-test",
        "POST",
        response.status,
        json,
      );
      setRows((current) => [
        row,
        ...current.filter((item) => item.stage !== row.stage),
      ]);
      setMessage(
        "FMP provider contract test completed safely. No publish, Telegram, or OpenAI call was allowed.",
      );
    } catch (error) {
      const row = summarize(
        "Run FMP Provider Contract Test",
        "/api/internal/provider-contract-test",
        "POST",
        "error",
        {
          ok: false,
          error: error instanceof Error ? error.message : "Unknown error",
        },
      );
      setRows((current) => [
        row,
        ...current.filter((item) => item.stage !== row.stage),
      ]);
      setMessage("FMP provider contract test failed safely.");
    }
    setBusy(null);
  }

  async function testLiveSourceContracts() {
    setBusy("live-source-contract-test");
    try {
      const response = await fetch("/api/internal/live-source-contract-test", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          dryRun: true,
          confirmRun: false,
          maxSources: 20,
          symbols: ["NVDA", "AMD", "MSFT", "GOOGL"],
          keywords: [
            "product launch",
            "guidance",
            "FDA approval",
            "contract award",
            "lawsuit",
            "investigation",
          ],
        }),
        cache: "no-store",
      });
      const json = await readResponse(response);
      const row = summarize(
        "Test Live Source Contracts",
        "/api/internal/live-source-contract-test",
        "POST",
        response.status,
        json,
      );
      setRows((current) => [
        row,
        ...current.filter((item) => item.stage !== row.stage),
      ]);
      setMessage(
        "Live source contracts tested in dry-run mode. No OpenAI, publish, Telegram, social scraping, or unconfirmed source calls were allowed.",
      );
    } catch (error) {
      const row = summarize(
        "Test Live Source Contracts",
        "/api/internal/live-source-contract-test",
        "POST",
        "error",
        {
          ok: false,
          error: error instanceof Error ? error.message : "Unknown error",
        },
      );
      setRows((current) => [
        row,
        ...current.filter((item) => item.stage !== row.stage),
      ]);
      setMessage("Live source contract test failed safely.");
    }
    setBusy(null);
  }
  async function runLiveEarsV1() {
    setBusy("live-ear-run");
    try {
      const response = await fetch("/api/internal/live-ear-run", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          dryRun: true,
          confirmRun: false,
          maxSources: 20,
          maxItemsPerSource: 20,
          priorityMode: "balanced",
          symbols: ["NVDA", "AMD", "MSFT", "GOOGL"],
          keywords: [
            "product launch",
            "guidance",
            "FDA approval",
            "contract award",
            "lawsuit",
            "investigation",
            "revenue",
            "partnership",
          ],
        }),
        cache: "no-store",
      });
      const json = await readResponse(response);
      const row = summarize(
        "Run Live Ears v1",
        "/api/internal/live-ear-run",
        "POST",
        response.status,
        json,
      );
      setRows((current) => [
        row,
        ...current.filter((item) => item.stage !== row.stage),
      ]);
      setMessage(
        "Live Ears v1 ran safely: no OpenAI, publish, Telegram, or social chatter calls.",
      );
    } catch (error) {
      const row = summarize(
        "Run Live Ears v1",
        "/api/internal/live-ear-run",
        "POST",
        "error",
        {
          ok: false,
          error: error instanceof Error ? error.message : "Unknown error",
        },
      );
      setRows((current) => [
        row,
        ...current.filter((item) => item.stage !== row.stage),
      ]);
      setMessage("Live Ears v1 failed safely.");
    }
    setBusy(null);
  }

  async function runBenzingaEar() {
    setBusy("benzinga-ear-run");
    try {
      const response = await fetch("/api/internal/benzinga-ear-run", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          dryRun: true,
          confirmRun: false,
          symbols: ["NVDA", "AMD", "MSFT", "GOOGL"],
          keywords: [
            "guidance",
            "earnings",
            "FDA",
            "product launch",
            "lawsuit",
            "investigation",
          ],
          maxItemsPerEndpoint: 20,
        }),
        cache: "no-store",
      });
      const json = await readResponse(response);
      const row = summarize(
        "Run Benzinga Ear",
        "/api/internal/benzinga-ear-run",
        "POST",
        response.status,
        json,
      );
      setRows((current) => [
        row,
        ...current.filter((item) => item.stage !== row.stage),
      ]);
      setMessage(
        "Benzinga Ear ran safely: no OpenAI, publish, or Telegram calls were allowed.",
      );
    } catch (error) {
      const row = summarize(
        "Run Benzinga Ear",
        "/api/internal/benzinga-ear-run",
        "POST",
        "error",
        {
          ok: false,
          error: error instanceof Error ? error.message : "Unknown error",
        },
      );
      setRows((current) => [
        row,
        ...current.filter((item) => item.stage !== row.stage),
      ]);
      setMessage("Benzinga Ear failed safely.");
    }
    setBusy(null);
  }

  async function runStoryClustering() {
    setBusy("story-cluster-run");
    try {
      const response = await fetch("/api/internal/story-cluster-run", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          dryRun: true,
          confirmRun: false,
          maxRawSignals: 100,
          freshnessWindowHours: 72,
        }),
        cache: "no-store",
      });
      const json = await readResponse(response);
      const row = summarize(
        "Run Story Clustering",
        "/api/internal/story-cluster-run",
        "POST",
        response.status,
        json,
      );
      setRows((current) => [
        row,
        ...current.filter((item) => item.stage !== row.stage),
      ]);
      setMessage(
        "Story clustering ran safely: no OpenAI, publish, or Telegram calls were allowed.",
      );
    } catch (error) {
      const row = summarize(
        "Run Story Clustering",
        "/api/internal/story-cluster-run",
        "POST",
        "error",
        {
          ok: false,
          error: error instanceof Error ? error.message : "Unknown error",
        },
      );
      setRows((current) => [
        row,
        ...current.filter((item) => item.stage !== row.stage),
      ]);
      setMessage("Story clustering failed safely.");
    }
    setBusy(null);
  }
  async function runSeriousSignalBrain() {
    setBusy("serious-signal-brain-run");
    try {
      const response = await fetch("/api/internal/serious-signal-brain-run", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          dryRun: true,
          confirmRun: false,
          maxClusters: 50,
          includeRippleGraph: true,
          includeContradictionDetector: true,
        }),
        cache: "no-store",
      });
      const json = await readResponse(response);
      const row = summarize(
        "Run Serious Signal Brain",
        "/api/internal/serious-signal-brain-run",
        "POST",
        response.status,
        json,
      );
      setRows((current) => [
        row,
        ...current.filter((item) => item.stage !== row.stage),
      ]);
      setMessage(
        "Serious Signal Brain ran safely: no OpenAI, publish, or Telegram calls were allowed.",
      );
    } catch (error) {
      const row = summarize(
        "Run Serious Signal Brain",
        "/api/internal/serious-signal-brain-run",
        "POST",
        "error",
        {
          ok: false,
          error: error instanceof Error ? error.message : "Unknown error",
        },
      );
      setRows((current) => [
        row,
        ...current.filter((item) => item.stage !== row.stage),
      ]);
      setMessage("Serious Signal Brain failed safely.");
    }
    setBusy(null);
  }

  async function showLiveSourceSchedulerPlan() {
    setBusy("live-source-scheduler-plan");
    const row = await callGet(
      "Show Live Source Scheduler Plan",
      "/api/internal/live-source-scheduler-plan",
    );
    setRows((current) => [
      row,
      ...current.filter((item) => item.stage !== row.stage),
    ]);
    setMessage(
      "Live source scheduler plan loaded. This is a plan only; no automatic pulling started.",
    );
    setBusy(null);
  }

  async function runOfficialAnnouncements() {
    setBusy("official-announcements");
    try {
      const response = await fetch("/api/internal/official-announcement-run", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          dryRun: true,
          confirmRun: false,
          symbols: ["NVDA", "AMD", "MSFT", "GOOGL"],
          companyNames: [
            "NVIDIA",
            "Advanced Micro Devices",
            "Microsoft",
            "Alphabet",
          ],
          keywords: [
            "product launch",
            "guidance",
            "contract",
            "lawsuit",
            "investigation",
            "approval",
            "recall",
          ],
          maxItemsPerSource: 20,
        }),
        cache: "no-store",
      });
      const json = await readResponse(response);
      const row = summarize(
        "Run Official Announcements",
        "/api/internal/official-announcement-run",
        "POST",
        response.status,
        json,
      );
      setRows((current) => [
        row,
        ...current.filter((item) => item.stage !== row.stage),
      ]);
      setMessage(
        "Official announcement dry run completed. It did not publish, send Telegram, or call OpenAI.",
      );
    } catch (error) {
      const row = summarize(
        "Run Official Announcements",
        "/api/internal/official-announcement-run",
        "POST",
        "error",
        {
          ok: false,
          error: error instanceof Error ? error.message : "Unknown error",
        },
      );
      setRows((current) => [
        row,
        ...current.filter((item) => item.stage !== row.stage),
      ]);
      setMessage("Official announcement dry run failed safely.");
    }
    setBusy(null);
  }

  async function runEvidencePackBuilder() {
    setBusy("evidence-pack-build-run");
    try {
      const response = await fetch("/api/internal/evidence-pack-build-run", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          dryRun: true,
          confirmRun: false,
          maxClusters: 50,
        }),
        cache: "no-store",
      });
      const json = await readResponse(response);
      const row = summarize(
        "Build Evidence Packs",
        "/api/internal/evidence-pack-build-run",
        "POST",
        response.status,
        json,
      );
      setRows((current) => [
        row,
        ...current.filter((item) => item.stage !== row.stage),
      ]);
      setMessage(
        "Evidence pack builder ran safely: no OpenAI, publish, or Telegram calls were allowed.",
      );
    } catch (error) {
      const row = summarize(
        "Build Evidence Packs",
        "/api/internal/evidence-pack-build-run",
        "POST",
        "error",
        {
          ok: false,
          error: error instanceof Error ? error.message : "Unknown error",
        },
      );
      setRows((current) => [
        row,
        ...current.filter((item) => item.stage !== row.stage),
      ]);
      setMessage("Evidence pack builder failed safely.");
    }
    setBusy(null);
  }

  async function testSourceCoverage() {
    setBusy("source-coverage-test");
    try {
      const response = await fetch("/api/internal/source-coverage-test", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          dryRun: true,
          confirmRun: false,
          providers: [
            "FMP",
            "Marketaux",
            "Benzinga",
            "SEC",
            "Fed",
            "FederalRegister",
            "openFDA",
            "USAspending",
            "SAM",
          ],
          symbols: ["NVDA", "AMD", "MSFT", "GOOGL"],
          keywords: [
            "product launch",
            "guidance",
            "FDA approval",
            "contract award",
            "lawsuit",
            "investigation",
          ],
          maxEndpointsPerProvider: 30,
          maxItemsPerEndpoint: 5,
        }),
        cache: "no-store",
      });
      const json = await readResponse(response);
      const row = summarize(
        "Test Source Coverage",
        "/api/internal/source-coverage-test",
        "POST",
        response.status,
        json,
      );
      setRows((current) => [
        row,
        ...current.filter((item) => item.stage !== row.stage),
      ]);
      setMessage(
        "Source coverage test completed safely. No publish, Telegram, or OpenAI calls were allowed.",
      );
    } catch (error) {
      const row = summarize(
        "Test Source Coverage",
        "/api/internal/source-coverage-test",
        "POST",
        "error",
        {
          ok: false,
          error: error instanceof Error ? error.message : "Unknown error",
        },
      );
      setRows((current) => [
        row,
        ...current.filter((item) => item.stage !== row.stage),
      ]);
    }
    setBusy(null);
  }

  async function showSourcePullPlan() {
    setBusy("source-pull-plan");
    try {
      const response = await fetch("/api/internal/source-pull-plan", {
        cache: "no-store",
      });
      const json = await readResponse(response);
      const row = summarize(
        "Show Source Pull Plan",
        "/api/internal/source-pull-plan",
        "GET",
        response.status,
        json,
      );
      setRows((current) => [
        row,
        ...current.filter((item) => item.stage !== row.stage),
      ]);
      setMessage("Source pull plan loaded.");
    } catch (error) {
      const row = summarize(
        "Show Source Pull Plan",
        "/api/internal/source-pull-plan",
        "GET",
        "error",
        {
          ok: false,
          error: error instanceof Error ? error.message : "Unknown error",
        },
      );
      setRows((current) => [
        row,
        ...current.filter((item) => item.stage !== row.stage),
      ]);
    }
    setBusy(null);
  }

  async function runSmartSourcePull() {
    setBusy("smart-source-pull-run");
    try {
      const response = await fetch("/api/internal/smart-source-pull-run", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          dryRun: true,
          confirmRun: false,
          mode: "balanced",
          symbols: ["NVDA", "AMD", "MSFT", "GOOGL"],
          keywords: [
            "product launch",
            "guidance",
            "FDA approval",
            "contract award",
            "lawsuit",
            "investigation",
          ],
          maxProviders: 10,
          maxEndpoints: 50,
          maxCallsTotal: 100,
        }),
        cache: "no-store",
      });
      const json = await readResponse(response);
      const row = summarize(
        "Run Smart Source Pull",
        "/api/internal/smart-source-pull-run",
        "POST",
        response.status,
        json,
      );
      setRows((current) => [
        row,
        ...current.filter((item) => item.stage !== row.stage),
      ]);
      setMessage("Smart source pull dry run completed safely.");
    } catch (error) {
      const row = summarize(
        "Run Smart Source Pull",
        "/api/internal/smart-source-pull-run",
        "POST",
        "error",
        {
          ok: false,
          error: error instanceof Error ? error.message : "Unknown error",
        },
      );
      setRows((current) => [
        row,
        ...current.filter((item) => item.stage !== row.stage),
      ]);
    }
    setBusy(null);
  }


  async function showAutonomousSourceEngineStatus() {
    setBusy("autonomous-source-engine-status");
    try {
      const response = await fetch("/api/internal/autonomous-source-engine-status", { cache: "no-store" });
      const json = await readResponse(response);
      const row = summarize("Autonomous Source Engine Status", "/api/internal/autonomous-source-engine-status", "GET", response.status, json);
      setRows((current) => [row, ...current.filter((item) => item.stage !== row.stage)]);
      setMessage("Autonomous source engine status loaded.");
    } catch (error) {
      const row = summarize("Autonomous Source Engine Status", "/api/internal/autonomous-source-engine-status", "GET", "error", { ok: false, error: error instanceof Error ? error.message : "Unknown error" });
      setRows((current) => [row, ...current.filter((item) => item.stage !== row.stage)]);
    }
    setBusy(null);
  }
  async function showQuotaBatchingStatus() {
    setBusy("source-quota-and-batching-status");
    try {
      const response = await fetch("/api/internal/source-quota-and-batching-status", { cache: "no-store" });
      const json = await readResponse(response);
      const row = summarize("Quota + Batching Status", "/api/internal/source-quota-and-batching-status", "GET", response.status, json);
      setRows((current) => [row, ...current.filter((item) => item.stage !== row.stage)]);
      setMessage("Quota and batching status loaded.");
    } catch (error) {
      const row = summarize("Quota + Batching Status", "/api/internal/source-quota-and-batching-status", "GET", "error", { ok: false, error: error instanceof Error ? error.message : "Unknown error" });
      setRows((current) => [row, ...current.filter((item) => item.stage !== row.stage)]);
    }
    setBusy(null);
  }

  async function runLiveEventCalendar() {
    setBusy("live-event-calendar-run");
    try {
      const response = await fetch("/api/internal/live-event-calendar-run", { method: "POST", headers: headers(), body: JSON.stringify({ dryRun: true, confirmRun: false, symbols: ["NVDA", "AMD", "MSFT", "GOOGL"], lookAheadHours: 72, lookBackHours: 24, maxEvents: 100 }), cache: "no-store" });
      const json = await readResponse(response);
      const row = summarize("Run Live Event Calendar", "/api/internal/live-event-calendar-run", "POST", response.status, json);
      setRows((current) => [row, ...current.filter((item) => item.stage !== row.stage)]);
      setMessage("Live event calendar dry run completed safely. No OpenAI, publish, or Telegram calls were allowed.");
    } catch (error) {
      const row = summarize("Run Live Event Calendar", "/api/internal/live-event-calendar-run", "POST", "error", { ok: false, error: error instanceof Error ? error.message : "Unknown error" });
      setRows((current) => [row, ...current.filter((item) => item.stage !== row.stage)]);
      setMessage("Live event calendar failed safely.");
    }
    setBusy(null);
  }

  async function showListenHarderPlan() {
    setBusy("listen-harder-plan");
    const row = await callGet("Show Listen-Harder Plan", "/api/internal/listen-harder-plan");
    setRows((current) => [row, ...current.filter((item) => item.stage !== row.stage)]);
    setMessage("Listen-harder plan loaded. This is focused on related events only.");
    setBusy(null);
  }

  async function runAutonomousSourceEngine() {
    setBusy("autonomous-source-engine-run");
    try {
      const response = await fetch("/api/internal/autonomous-source-engine-run", {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          dryRun: true,
          confirmRun: false,
          mode: "balanced",
          maxCallsTotal: 150,
          maxProviders: 10,
          maxEndpoints: 80,
          maxAssetsPerCycle: 500,
          universeMode: "global",
          includeStocks: true,
          includeETFs: true,
          includeCrypto: true,
          includeFX: true,
          includeCommodities: true,
          includeMacro: true,
        }),
        cache: "no-store",
      });
      const json = await readResponse(response);
      const row = summarize("Run Autonomous Source Engine", "/api/internal/autonomous-source-engine-run", "POST", response.status, json);
      setRows((current) => [row, ...current.filter((item) => item.stage !== row.stage)]);
      setMessage("Autonomous source engine dry run completed safely.");
    } catch (error) {
      const row = summarize("Run Autonomous Source Engine", "/api/internal/autonomous-source-engine-run", "POST", "error", { ok: false, error: error instanceof Error ? error.message : "Unknown error" });
      setRows((current) => [row, ...current.filter((item) => item.stage !== row.stage)]);
    }
    setBusy(null);
  }

  async function runStage(stage: "stage1" | "stage2" | "stage3") {
    const labels = {
      stage1: "Stage 1 dry run",
      stage2: "Stage 2 real AI review, no publish",
      stage3: "Stage 3 publish one approved website alert",
    } as const;
    setBusy(stage);
    try {
      const route =
        stage === "stage1" && typeof window !== "undefined"
          ? `${window.location.origin}${RUN_ROUTE}`
          : RUN_ROUTE;
      const response = await fetch(route, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(runPayloads[stage]),
        cache: "no-store",
      });
      if (response.status === 404) {
        const row = summarize(labels[stage], RUN_ROUTE, "POST", 404, {
          ok: false,
          blockers: ["Live alert cycle route is missing."],
          nextRecommendedAction:
            "A backend route is required before this browser control can run the live alert cycle.",
        });
        setRows((current) => [
          row,
          ...current.filter((item) => item.stage !== row.stage),
        ]);
        setMessage(
          "Live alert cycle route is missing. A backend route is required.",
        );
      } else {
        const json = await readResponse(response);
        const row = summarize(
          labels[stage],
          route,
          "POST",
          response.status,
          json,
        );
        setRows((current) => [
          row,
          ...current.filter((item) => item.stage !== row.stage),
        ]);
        setMessage(
          stage === "stage3"
            ? "Publish request completed. Confirm returned public URLs before sharing."
            : "Safe stage completed without publish/send permissions.",
        );
      }
    } catch (error) {
      const row = summarize(labels[stage], RUN_ROUTE, "POST", "error", {
        ok: false,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      setRows((current) => [
        row,
        ...current.filter((item) => item.stage !== row.stage),
      ]);
      setMessage(
        "Request failed in the browser. No fake route or fake alert was created.",
      );
    }
    setBusy(null);
  }

  async function copyJson(row: StageResult) {
    await navigator.clipboard.writeText(JSON.stringify(row.json, null, 2));
  }

  return (
    <main style={styles.page}>
      <section style={styles.hero}>
        <p style={styles.eyebrow}>
          Internal ops · first real website alert control
        </p>
        <h1 style={styles.title}>Founder Engine Control Panel</h1>
        <p style={styles.subtitle}>
          Browser-only controls for checking readiness and running one safe
          website alert cycle from the deployed app. This page is noindex,
          unlinked, and never grants Telegram send permission.
        </p>
        <div style={styles.notice}>{message}</div>
      </section>

      <section style={styles.card}>
        <label style={styles.label}>
          Internal secret
          <input
            style={styles.input}
            type="password"
            value={secret}
            onChange={(event) => setSecret(event.target.value)}
            placeholder="Sent only as a request header; not stored or displayed"
            autoComplete="off"
          />
        </label>
        <div style={styles.links}>
          <Link href="/alerts">Open /alerts</Link>
          <Link href="/ledger">Open /ledger</Link>
        </div>
      </section>

      <section style={styles.actions}>
        <button
          style={styles.button}
          disabled={busy !== null}
          onClick={loadStartup}
        >
          Load current status
        </button>
        <button
          style={styles.button}
          disabled={busy !== null}
          onClick={() => checkR2Health(false)}
        >
          Check R2 Health
        </button>
        <button
          style={styles.button}
          disabled={busy !== null}
          onClick={() => checkR2Health(true)}
        >
          Test R2 Write/Delete
        </button>
        <button
          style={styles.button}
          disabled={busy !== null}
          onClick={() => runStage("stage1")}
        >
          Run Stage 1 Dry Run
        </button>
        <button
          style={styles.button}
          disabled={busy !== null}
          onClick={testSourceCoverage}
        >
          Test Source Coverage
        </button>
        <button
          style={styles.button}
          disabled={busy !== null}
          onClick={showSourcePullPlan}
        >
          Show Source Pull Plan
        </button>
        <button
          style={styles.button}
          disabled={busy !== null}
          onClick={runSmartSourcePull}
        >
          Run Smart Source Pull
        </button>
        <button
          style={styles.button}
          disabled={busy !== null}
          onClick={showAutonomousSourceEngineStatus}
        >
          Autonomous Source Engine Status
        </button>
        <button
          style={styles.button}
          disabled={busy !== null}
          onClick={showQuotaBatchingStatus}
        >
          Show Quota + Batching Status
        </button>

        <button
          style={styles.button}
          disabled={busy !== null}
          onClick={runLiveEventCalendar}
        >
          Run Live Event Calendar
        </button>
        <button
          style={styles.button}
          disabled={busy !== null}
          onClick={showListenHarderPlan}
        >
          Show Listen-Harder Plan
        </button>
        <button
          style={styles.button}
          disabled={busy !== null}
          onClick={runAutonomousSourceEngine}
        >
          Run Autonomous Source Engine
        </button>
        <button
          style={styles.button}
          disabled={busy !== null}
          onClick={runOfficialAnnouncements}
        >
          Run Official Announcements
        </button>
        <button
          style={styles.button}
          disabled={busy !== null}
          onClick={runArticleReaderTest}
        >
          Test Article Reader
        </button>
        <button
          style={styles.button}
          disabled={busy !== null}
          onClick={runFmpProviderContractTest}
        >
          Run FMP Provider Contract Test
        </button>
        <button
          style={styles.button}
          disabled={busy !== null}
          onClick={testLiveSourceContracts}
        >
          Test Live Source Contracts
        </button>
        <button
          style={styles.button}
          disabled={busy !== null}
          onClick={showLiveSourceSchedulerPlan}
        >
          Show Live Source Scheduler Plan
        </button>
        <button
          style={styles.button}
          disabled={busy !== null}
          onClick={runLiveEarsV1}
        >
          Run Live Ears v1
        </button>
        <button
          style={styles.button}
          disabled={busy !== null}
          onClick={runBenzingaEar}
        >
          Run Benzinga Ear
        </button>
        <button
          style={styles.button}
          disabled={busy !== null}
          onClick={runStoryClustering}
        >
          Run Story Clustering
        </button>
        <button
          style={styles.button}
          disabled={busy !== null}
          onClick={runSeriousSignalBrain}
        >
          Run Serious Signal Brain
        </button>
        <button
          style={styles.button}
          disabled={busy !== null}
          onClick={runEvidencePackBuilder}
        >
          Build Evidence Packs
        </button>

        <button
          style={styles.button}
          disabled={busy !== null}
          onClick={runFreeProofRecovery}
        >
          Run R2 + Free Proof Recovery
        </button>
        <button
          style={styles.button}
          disabled={busy !== null}
          onClick={refreshSourceHealth}
        >
          Refresh Source Health
        </button>
        <button
          style={styles.button}
          disabled={busy !== null}
          onClick={refreshReadiness}
        >
          Refresh Engine Readiness
        </button>
        <button
          title={
            !stage1AllowsStage2
              ? "Stage 1 must find one candidate strong enough for AI review before Stage 2 is enabled."
              : undefined
          }
          style={styles.button}
          disabled={busy !== null || !stage1AllowsStage2}
          onClick={() => runStage("stage2")}
        >
          Stage 2 Real AI Review, No Publish
        </button>
        <label style={styles.checkbox}>
          <input
            type="checkbox"
            checked={confirmPublish}
            onChange={(event) => setConfirmPublish(event.target.checked)}
          />{" "}
          I understand this will publish at most 1 approved alert to the public
          website.
        </label>
        <button
          title={
            !stage2Approved
              ? "Stage 2 must approve one real publishable signal before Stage 3 is enabled."
              : !confirmPublish
                ? "Check the confirmation box to publish at most one approved website alert."
                : undefined
          }
          style={{ ...styles.button, ...styles.danger }}
          disabled={busy !== null || !stage2Approved || !confirmPublish}
          onClick={() => runStage("stage3")}
        >
          Stage 3 Publish One Approved Website Alert
        </button>
      </section>

      {busy === "r2-write" ? (
        <section style={styles.card}>
          <h2 style={styles.heading}>R2 Write/Delete Test</h2>
          <p style={styles.small}>
            Testing R2 write/delete… this may take a few seconds.
          </p>
        </section>
      ) : null}

      <section style={styles.card}>
        <h2 style={styles.heading}>R2 Write/Delete result</h2>
        <p style={styles.small}>
          The button calls POST /api/internal/r2-health with{" "}
          {`{"confirmWrite":true}`}. This panel only shows safe health fields
          and never displays access keys, secret keys, tokens, or unredacted
          environment values.
        </p>
        <div style={styles.resultGrid}>
          {r2ResultFields.map((field) => (
            <div key={field} style={styles.resultItem}>
              <strong>{field}</strong>
              <pre style={styles.resultValue}>
                {resultValue(
                  isRecord(latestR2Row?.json)
                    ? latestR2Row.json[field]
                    : undefined,
                )}
              </pre>
            </div>
          ))}
        </div>
      </section>

      <section style={styles.card}>
        <h2 style={styles.heading}>7-layer ear status</h2>
        <p style={styles.small}>
          Shows Tier 1/Tier 2 ears, blocked/planned ears with how to solve, and
          R2 raw storage status from /api/internal/ear-registry.
        </p>
        <pre style={styles.resultValue}>
          {JSON.stringify(registryPanel(registryRow), null, 2)}
        </pre>
      </section>

      <section style={styles.card}>
        <h2 style={styles.heading}>FMP Provider Contract Test</h2>
        <p style={styles.small}>
          Calls POST /api/internal/provider-contract-test for NVDA, AMD, MSFT,
          and GOOGL. It shows safe endpoint status only and never displays API
          keys or full provider URLs.
        </p>
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                {[
                  "symbol",
                  "quote works?",
                  "quote-short works?",
                  "stock-price-change works?",
                  "historical EOD works?",
                  "income statement works?",
                  "balance sheet works?",
                  "cash flow works?",
                  "key metrics works?",
                  "ratios works?",
                  "Stage 1 attach works?",
                  "failure reason",
                ].map((head) => (
                  <th key={head} style={styles.th}>
                    {head}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {fmpContractResults.map((row, index) => {
                const endpoints = Array.isArray(row.endpointDiagnostics)
                  ? row.endpointDiagnostics.filter(isRecord)
                  : [];
                const works = (name: string) =>
                  yesNo(
                    endpoints.some(
                      (endpoint) =>
                        endpoint.endpointName === name &&
                        endpoint.hasUsableValues === true,
                    ),
                  );
                const comparison = isRecord(row.comparison)
                  ? row.comparison
                  : {};
                return (
                  <tr key={`${String(row.symbol ?? index)}-fmp-contract`}>
                    <td style={styles.td}>{resultValue(row.symbol)}</td>
                    <td style={styles.td}>{works("quote")}</td>
                    <td style={styles.td}>{works("quote-short")}</td>
                    <td style={styles.td}>{works("stock-price-change")}</td>
                    <td style={styles.td}>
                      {works("historical-price-eod/full")}
                    </td>
                    <td style={styles.td}>{works("income-statement")}</td>
                    <td style={styles.td}>
                      {works("balance-sheet-statement")}
                    </td>
                    <td style={styles.td}>{works("cash-flow-statement")}</td>
                    <td style={styles.td}>{works("key-metrics")}</td>
                    <td style={styles.td}>{works("ratios")}</td>
                    <td style={styles.td}>
                      {yesNo(
                        comparison.stage1PriceVolumeWorks === true ||
                          comparison.stage1FundamentalsWorks === true,
                      )}
                    </td>
                    <td style={styles.td}>
                      {resultValue(
                        comparison.mismatchReason ??
                          endpoints.find(
                            (endpoint) => endpoint.hasUsableValues !== true,
                          )?.rejectionReason,
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section style={styles.card}>
        <h2 style={styles.heading}>Stage 1 Dry Run result</h2>
        <p style={styles.small}>
          Click the visible Stage 1 Dry Run button above to POST the safe
          dry-run payload. This panel stays explicit about publish, Telegram,
          and AI committee status.
        </p>
        <div style={styles.resultGrid}>
          {stage1ResultPanel(latestStage1Row).map((item) => (
            <div key={item.label} style={styles.resultItem}>
              <strong>{item.label}</strong>
              <pre style={styles.resultValue}>{resultValue(item.value)}</pre>
            </div>
          ))}
        </div>
      </section>

      <section style={styles.card}>
        <h2 style={styles.heading}>Run table</h2>
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead>
              <tr>
                {[
                  "stage",
                  "route",
                  "HTTP status",
                  "result",
                  "signal found",
                  "signals inspected",
                  "catalyst configured",
                  "catalyst attempted",
                  "catalyst found",
                  "catalyst inspected",
                  "top catalyst candidates",
                  "catalyst notes",
                  "provider diagnostics",
                  "impact score",
                  "stock specificity",
                  "best direct ticker candidate",
                  "selected failure",
                  "proof completion summary",
                  "FMP provider_403 note",
                  "next source",
                  "proof enrichment",
                  "proof added",
                  "accepted proof",
                  "rejected proof",
                  "rejected proof reasons",
                  "proof match score",
                  "proof URLs",
                  "proof still missing",
                  "Stage 2 unlocked",
                  "AI Committee ran",
                  "approved",
                  "published",
                  "public alert URL",
                  "public ledger URL",
                  "blockers",
                  "warnings",
                  "next action",
                ].map((head) => (
                  <th key={head} style={styles.th}>
                    {head}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.stage}-${row.route}`}>
                  <td style={styles.td}>{row.stage}</td>
                  <td style={styles.td}>
                    {row.method} {row.route}
                  </td>
                  <td style={styles.td}>{row.status}</td>
                  <td style={styles.td}>{row.result}</td>
                  <td style={styles.td}>{yesNo(row.signalFound)}</td>
                  <td style={styles.td}>{row.discovery.inspected ?? "—"}</td>
                  <td style={styles.td}>{row.catalyst.configured}</td>
                  <td style={styles.td}>{row.catalyst.attempted}</td>
                  <td style={styles.td}>{row.catalyst.found}</td>
                  <td style={styles.td}>{row.catalyst.inspected}</td>
                  <td style={styles.td}>{row.catalyst.top}</td>
                  <td style={styles.td}>{row.catalyst.notes}</td>
                  <td style={styles.td}>{row.catalyst.diagnostics}</td>
                  <td style={styles.td}>{row.catalyst.impact}</td>
                  <td style={styles.td}>{row.catalyst.specificity}</td>
                  <td style={styles.td}>
                    {row.discovery.bestDirectTickerCandidate}
                  </td>
                  <td style={styles.td}>{row.discovery.selectedFailed}</td>
                  <td style={styles.td}>
                    {row.discovery.proofCompletionSummary}
                  </td>
                  <td style={styles.td}>{row.discovery.fmpProvider403Note}</td>
                  <td style={styles.td}>{row.discovery.nextSource}</td>
                  <td style={styles.td}>
                    {yesNo(row.proofEnrichment.attempted)}
                  </td>
                  <td style={styles.td}>{row.proofEnrichment.added}</td>
                  <td style={styles.td}>{row.proofEnrichment.accepted}</td>
                  <td style={styles.td}>{row.proofEnrichment.rejected}</td>
                  <td style={styles.td}>
                    {row.proofEnrichment.rejectedReasons}
                  </td>
                  <td style={styles.td}>{row.proofEnrichment.matchScore}</td>
                  <td style={styles.td}>{row.proofEnrichment.urls}</td>
                  <td style={styles.td}>{row.proofEnrichment.missing}</td>
                  <td style={styles.td}>
                    {yesNo(row.discovery.stage2Allowed)}
                  </td>
                  <td style={styles.td}>{yesNo(row.aiCommitteeRan)}</td>
                  <td style={styles.td}>{yesNo(row.approved)}</td>
                  <td style={styles.td}>{yesNo(row.published)}</td>
                  <td style={styles.td}>
                    {row.publicAlertUrl ? (
                      <a href={row.publicAlertUrl}>{row.publicAlertUrl}</a>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td style={styles.td}>
                    {row.publicLedgerUrl ? (
                      <a href={row.publicLedgerUrl}>{row.publicLedgerUrl}</a>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td style={styles.td}>{row.blockers.join(" | ") || "—"}</td>
                  <td style={styles.td}>{row.warnings.join(" | ") || "—"}</td>
                  <td style={styles.td}>{row.nextAction}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section style={styles.jsonGrid}>
        {rows.map((row) => (
          <details key={`${row.stage}-json`} style={styles.details}>
            <summary>
              {row.stage} JSON{" "}
              <button
                style={styles.copy}
                onClick={(event) => {
                  event.preventDefault();
                  void copyJson(row);
                }}
              >
                Copy JSON
              </button>
            </summary>
            <pre style={styles.pre}>{JSON.stringify(row.json, null, 2)}</pre>
          </details>
        ))}
      </section>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    padding: "32px 18px 56px",
    background: "#071014",
    color: "#e5f3f1",
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
  },
  hero: { maxWidth: 1180, margin: "0 auto 20px" },
  eyebrow: {
    color: "#7dd3fc",
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: "0.14em",
    textTransform: "uppercase",
  },
  title: {
    margin: 0,
    fontSize: "clamp(2.2rem, 7vw, 4.6rem)",
    letterSpacing: "-0.06em",
  },
  subtitle: { maxWidth: 880, color: "#b6c9c6", lineHeight: 1.6 },
  notice: {
    border: "1px solid rgba(125,211,252,.3)",
    borderRadius: 18,
    padding: 16,
    background: "rgba(14,116,144,.16)",
  },
  card: {
    maxWidth: 1180,
    margin: "0 auto 18px",
    border: "1px solid rgba(148,163,184,.22)",
    borderRadius: 24,
    padding: 18,
    background: "rgba(15,23,42,.72)",
  },
  label: { display: "grid", gap: 8, color: "#cbd5e1", fontWeight: 800 },
  input: {
    maxWidth: 520,
    borderRadius: 12,
    border: "1px solid rgba(148,163,184,.32)",
    padding: 12,
    background: "#020617",
    color: "#e5f3f1",
  },
  links: { display: "flex", gap: 14, flexWrap: "wrap", marginTop: 14 },
  actions: {
    maxWidth: 1180,
    margin: "0 auto 18px",
    display: "flex",
    gap: 12,
    flexWrap: "wrap",
    alignItems: "center",
  },
  button: {
    border: "1px solid rgba(45,212,191,.36)",
    borderRadius: 999,
    padding: "11px 15px",
    background: "#0f766e",
    color: "white",
    fontWeight: 800,
    cursor: "pointer",
  },
  danger: { background: "#991b1b", borderColor: "rgba(252,165,165,.5)" },
  checkbox: { color: "#fef3c7", display: "flex", gap: 8, alignItems: "center" },
  heading: { marginTop: 0 },
  small: { color: "#b6c9c6", lineHeight: 1.5 },
  resultGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
    gap: 12,
  },
  resultItem: {
    border: "1px solid rgba(148,163,184,.18)",
    borderRadius: 16,
    padding: 12,
    background: "rgba(2,6,23,.42)",
  },
  resultValue: {
    margin: "8px 0 0",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
    color: "#bbf7d0",
    fontSize: 12,
  },
  tableWrap: { overflowX: "auto" },
  table: { width: "100%", minWidth: 1400, borderCollapse: "collapse" },
  th: {
    textAlign: "left",
    padding: 10,
    borderBottom: "1px solid rgba(148,163,184,.28)",
    color: "#93c5fd",
    fontSize: 12,
    textTransform: "uppercase",
  },
  td: {
    verticalAlign: "top",
    padding: 10,
    borderBottom: "1px solid rgba(148,163,184,.16)",
    color: "#dbeafe",
    fontSize: 13,
  },
  jsonGrid: { maxWidth: 1180, margin: "0 auto", display: "grid", gap: 12 },
  details: {
    border: "1px solid rgba(148,163,184,.2)",
    borderRadius: 18,
    padding: 14,
    background: "rgba(2,6,23,.76)",
  },
  copy: { marginLeft: 10, borderRadius: 999, padding: "4px 9px" },
  pre: { overflowX: "auto", whiteSpace: "pre-wrap", color: "#bbf7d0" },
};
