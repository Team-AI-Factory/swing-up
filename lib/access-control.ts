import { headers } from "next/headers";
import { prisma } from "@/lib/db/client";

export type AccessUserMode = "anonymous" | "preview" | "authenticated";
export type AccessTier = "free" | "trial" | "paid" | "admin_internal";

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
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;
const PAID_STATUSES = new Set(["active", "paid", "current", "trialing", "sandbox_active"]);
const TRIAL_STATUSES = new Set(["trial", "trialing", "sandbox_trial"]);
const PAID_PLAN_CODES = new Set(["starter", "plus", "pro", "elite", "desk", "enterprise", "paid"]);
const ADMIN_ROLES = new Set(["admin", "internal", "owner", "staff"]);

function normalize(value: string | null | undefined) {
  return value?.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "") ?? "";
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
  const canUseWatchlist = userMode !== "anonymous";
  const canViewPaidAlerts = tier === "paid" || tier === "admin_internal";
  return {
    ok: true,
    userMode,
    tier,
    canViewFreeAlerts: true,
    canViewDelayedAlerts: true,
    canViewPaidAlerts,
    canUseWatchlist,
    canReceiveNotifications: false,
    reason,
    safeExplanation: canViewPaidAlerts
      ? "Sandbox access check only: paid alert access is allowed by safe entitlement state, but no payment is charged and notifications remain disabled."
      : "Sandbox access check only: free and delayed alert surfaces are allowed; paid alerts stay hidden until a safe paid or internal entitlement exists.",
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
  if (!process.env.DATABASE_URL) return decision("free", "authenticated", "database_not_configured_safe_free");

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
      return periodOk && (PAID_STATUSES.has(status) || PAID_PLAN_CODES.has(planCode));
    });

    if (activeSubscription) {
      const status = normalize(activeSubscription.status);
      return decision(TRIAL_STATUSES.has(status) ? "trial" : "paid", "authenticated", `subscription_${status || "active"}`);
    }

    return decision("free", "authenticated", "no_active_subscription_safe_free");
  } catch {
    return decision("free", "authenticated", "access_lookup_unavailable_safe_free");
  }
}
