export type AlertAccessPlan = "free" | "starter" | "pro" | "elite" | "community" | "api";

export type AlertSection =
  | "action"
  | "ticker/company"
  | "event summary"
  | "current price"
  | "target range"
  | "Profit Potential Score"
  | "Evidence Confidence Score"
  | "Risk Level"
  | "Historical Pattern Match"
  | "DCF details"
  | "source receipts"
  | "public ledger tracking"
  | "priority alert timing";

export type AlertTierAccessInput = {
  user?: { plan?: unknown; planTier?: unknown } | null;
  userPlan?: unknown;
  alert?: { id?: unknown; alertId?: unknown; isPriority?: unknown } | null;
  alertId?: unknown;
};

export type AlertTierAccessPreview = {
  ok: true;
  userPlan: AlertAccessPlan;
  alertId: string;
  allowed: boolean;
  visibleSections: AlertSection[];
  hiddenSections: AlertSection[];
  upgradeReason: string | null;
  delayStatus: string;
  simpleExplanation: string;
  warnings: string[];
};

const ALL_SECTIONS: AlertSection[] = [
  "action",
  "ticker/company",
  "event summary",
  "current price",
  "target range",
  "Profit Potential Score",
  "Evidence Confidence Score",
  "Risk Level",
  "Historical Pattern Match",
  "DCF details",
  "source receipts",
  "public ledger tracking",
  "priority alert timing",
];

const PLAN_SECTIONS: Record<AlertAccessPlan, AlertSection[]> = {
  free: ["ticker/company", "event summary", "source receipts", "public ledger tracking"],
  starter: ["action", "ticker/company", "event summary", "current price", "source receipts", "public ledger tracking"],
  pro: [
    "action",
    "ticker/company",
    "event summary",
    "current price",
    "target range",
    "Profit Potential Score",
    "Evidence Confidence Score",
    "Risk Level",
    "Historical Pattern Match",
    "DCF details",
    "source receipts",
    "public ledger tracking",
  ],
  elite: ALL_SECTIONS,
  community: ["ticker/company", "event summary", "source receipts", "public ledger tracking"],
  api: ["ticker/company", "event summary", "source receipts", "public ledger tracking"],
};

const PLAN_LABELS: Record<AlertAccessPlan, string> = {
  free: "Free delayed alerts, public ledger, and limited watchlist preview",
  starter: "Starter watchlist alerts preview",
  pro: "Pro full alert cards with DCF, pattern match, and Profit Potential Score preview",
  elite: "Elite priority alerts and full radar preview",
  community: "Community feed preview",
  api: "API use preview",
};

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function plan(value: unknown): AlertAccessPlan {
  const normalized = text(value).toLowerCase().replace(/[^a-z]/g, "");
  if (normalized === "starter" || normalized === "plus") return "starter";
  if (normalized === "pro") return "pro";
  if (normalized === "elite" || normalized === "enterprise") return "elite";
  if (normalized === "community") return "community";
  if (normalized === "api") return "api";
  return "free";
}

function bool(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

export function mockAlertTierAccessInput(): AlertTierAccessInput {
  return {
    userPlan: "pro",
    alert: { id: "mock-alert-tier-35", isPriority: true },
  };
}

export function previewAlertTierAccess(input: AlertTierAccessInput = {}): AlertTierAccessPreview {
  const userPlan = plan(input.userPlan ?? input.user?.plan ?? input.user?.planTier);
  const alertId = text(input.alertId ?? input.alert?.id ?? input.alert?.alertId, "mock-alert-tier");
  const isPriority = bool(input.alert?.isPriority, true);
  const visibleSections = PLAN_SECTIONS[userPlan];
  const visibleSet = new Set(visibleSections);
  const hiddenSections = ALL_SECTIONS.filter((section) => !visibleSet.has(section));
  const allowed = visibleSections.length > 0;
  const warnings = [
    "Preview contract only: no real alert page is blocked by this response.",
    "No billing provider, payment status, database schema, or real entitlement was changed.",
    "Mock user plan and mock alert data only; do not use this as production access enforcement.",
  ];

  const delayStatus = userPlan === "free"
    ? "delayed_alerts_preview"
    : userPlan === "elite" && isPriority
      ? "priority_timing_preview"
      : "standard_timing_preview";

  const upgradeReason = hiddenSections.length
    ? `Upgrade from ${userPlan} to see: ${hiddenSections.join(", ")}.`
    : null;

  return {
    ok: true,
    userPlan,
    alertId,
    allowed,
    visibleSections,
    hiddenSections,
    upgradeReason,
    delayStatus,
    simpleExplanation: `${PLAN_LABELS[userPlan]} can preview ${visibleSections.length} of ${ALL_SECTIONS.length} alert sections for ${alertId}. This does not charge users or enforce access control.`,
    warnings,
  };
}
