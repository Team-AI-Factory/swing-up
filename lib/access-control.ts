import { headers } from "next/headers";
import { prisma } from "@/lib/db/client";

export type AccessUserMode = "anonymous" | "preview" | "authenticated";
export type AccessTier = "free" | "trial" | "paid" | "admin_internal";
export type AlertVisibilityTier = "free" | "delayed" | "paid";

export type AccessDecision = {
  ok: true;
  userMode: AccessUserMode;
  tier: AccessTier;
  canViewFreeAlerts: boolean;
  canViewDelayedAlerts: boolean;
  canViewPaidAlerts: boolean;
  canUseWatchlist: boolean;
  canReceiveNotifications: boolean;
  reason: string;
  safeExplanation: string;
  config: {
    auth: "configured" | "not_configured";
    payment: "configured" | "not_configured";
    database: "configured" | "not_configured";
    mode: "preview" | "configured";
  };
};

export type AlertAccessDecision = AccessDecision & {
  alert: {
    requestedId: string | null;
    visibilityTier: AlertVisibilityTier;
    canView: boolean;
    redaction: "none" | "paid_only_hidden";
    reason: string;
  };
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
const PAID_STATUSES = new Set(["active", "paid", "current", "sandbox_active"]);
const TRIAL_STATUSES = new Set(["trial", "trialing", "sandbox_trial"]);
const PAID_PLAN_CODES = new Set(["starter", "plus", "pro", "elite", "desk", "enterprise", "paid"]);
const ADMIN_ROLES = new Set(["admin", "internal", "owner", "staff"]);

function normalize(value: string | null | undefined) {
  return value?.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "") ?? "";
}

function isConfigured(keys: string[]) {
  return keys.some((key) => Boolean(process.env[key]?.trim()));
}

function configState() {
  const auth = isConfigured(["AUTH_SECRET", "NEXTAUTH_SECRET", "CLERK_SECRET_KEY", "SWING_UP_AUTH_CONFIGURED"])
    ? "configured"
    : "not_configured";
  const payment = isConfigured(["STRIPE_SECRET_KEY", "PAYMENT_PROVIDER_SECRET", "SWING_UP_PAYMENT_CONFIGURED"])
    ? "configured"
    : "not_configured";
  const database = process.env.DATABASE_URL?.trim() ? "configured" : "not_configured";

  return {
    auth,
    payment,
    database,
    mode: auth === "configured" && payment === "configured" && database === "configured" ? "configured" : "preview",
  } as const;
}

function safeTier(value: string | null | undefined): AccessTier | null {
  const normalized = normalize(value).replace(/-/g, "_");
  if (["admin", "internal", "admin_internal", "staff", "owner"].includes(normalized)) return "admin_internal";
  if (["paid", "pro", "starter", "plus", "elite", "desk", "enterprise"].includes(normalized)) return "paid";
  if (["trial", "trialing"].includes(normalized)) return "trial";
  if (normalized === "free") return "free";
  return null;
}

function decision(tier: AccessTier, userMode: AccessUserMode, reason: string): AccessDecision {
  const config = configState();
  const canUseWatchlist = userMode !== "anonymous" && config.auth === "configured";
  const canViewPaidAlerts = tier === "trial" || tier === "paid" || tier === "admin_internal";
  const configuredForNotifications = config.auth === "configured" && config.payment === "configured";
  const canReceiveNotifications = configuredForNotifications && (tier === "paid" || tier === "admin_internal");
  const notConfigured = config.mode === "preview";

  return {
    ok: true,
    userMode: notConfigured && userMode === "authenticated" ? "preview" : userMode,
    tier,
    canViewFreeAlerts: true,
    canViewDelayedAlerts: true,
    canViewPaidAlerts,
    canUseWatchlist,
    canReceiveNotifications,
    reason: notConfigured && !reason.includes("not_configured") ? `${reason}_preview_not_configured` : reason,
    safeExplanation: canViewPaidAlerts
      ? "Sandbox access check only: paid alert access is allowed by safe entitlement state, but no payment is charged and notification sending remains gated."
      : "Sandbox access check only: free and delayed alert surfaces are allowed; paid alerts stay hidden until a safe trial, paid, or internal entitlement exists.",
    config,
  };
}

export function alertVisibilityTier(value: string | null | undefined): AlertVisibilityTier {
  const normalized = normalize(value);
  if (["paid", "premium", "priority", "subscriber"].includes(normalized)) return "paid";
  if (["delayed", "delay", "standard"].includes(normalized)) return "delayed";
  return "free";
}

export function decideAlertAccess(access: AccessDecision, requestedId: string | null, visibilityTier: AlertVisibilityTier): AlertAccessDecision {
  const canView = visibilityTier === "paid" ? access.canViewPaidAlerts : visibilityTier === "delayed" ? access.canViewDelayedAlerts : access.canViewFreeAlerts;
  return {
    ...access,
    alert: {
      requestedId,
      visibilityTier,
      canView,
      redaction: canView ? "none" : "paid_only_hidden",
      reason: canView ? `can_view_${visibilityTier}_alert` : "paid_alert_hidden_for_current_access",
    },
  };
}

export async function getAccessDecision(): Promise<AccessDecision> {
  const requestHeaders = await headers();
  const mockTier = safeTier(requestHeaders.get("x-swing-up-mock-tier"));
  if (mockTier) return decision(mockTier, "preview", `mock_${mockTier}`);

  const userId = requestHeaders.get("x-swing-up-user-id")?.trim();
  const roleHint = normalize(requestHeaders.get("x-swing-up-role"));
  if (ADMIN_ROLES.has(roleHint)) return decision("admin_internal", userId && UUID_RE.test(userId) ? "authenticated" : "preview", "admin_internal_header_preview");

  if (!userId || !UUID_RE.test(userId)) return decision("free", "anonymous", "anonymous_no_auth_connected");
  if (!process.env.DATABASE_URL) return decision("free", "preview", "database_not_configured_safe_free");

  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: { subscriptions: { include: { plan: true }, orderBy: { currentPeriodEnd: "desc" } } },
    });

    if (!user) return decision("free", "authenticated", "user_not_found_safe_free");
    if (ADMIN_ROLES.has(normalize(user.role))) return decision("admin_internal", "authenticated", "admin_internal_role");

    const activeSubscription = user.subscriptions.find((subscription) => {
      const status = normalize(subscription.status);
      const planCode = normalize(subscription.plan?.code);
      const periodOk = !subscription.currentPeriodEnd || subscription.currentPeriodEnd.getTime() > Date.now();
      return periodOk && (PAID_STATUSES.has(status) || TRIAL_STATUSES.has(status) || PAID_PLAN_CODES.has(planCode));
    });

    if (activeSubscription) {
      const status = normalize(activeSubscription.status);
      return decision(TRIAL_STATUSES.has(status) ? "trial" : "paid", "authenticated", `subscription_${status || "active"}`);
    }

    return decision("free", "authenticated", "no_active_subscription_safe_free");
  } catch {
    return decision("free", "preview", "access_lookup_unavailable_safe_free");
  }
}
