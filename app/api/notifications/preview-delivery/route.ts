import { NextRequest, NextResponse } from "next/server";
import { getAuthReadinessSession } from "@/lib/auth-readiness";
import { enabledPreferenceChannels, getNotificationPreferences } from "@/lib/notification-preferences-store";
import { listWatchlist } from "@/lib/watchlist-store";

type PreviewDeliveryPayload = {
  dryRun?: boolean;
  ticker?: string;
  riskLevel?: string;
  action?: string;
  message?: string;
};

const SAFE_REAL_DELIVERY_ENV = "SWING_UP_ENABLE_REAL_NOTIFICATIONS";
const EMAIL_ENV = "SWING_UP_EMAIL_PROVIDER_CONFIGURED";
const TELEGRAM_ENV = "TELEGRAM_BOT_TOKEN";
const PWA_ENV = "SWING_UP_WEB_PUSH_CONFIGURED";

function authSummary(session: Awaited<ReturnType<typeof getAuthReadinessSession>>) {
  return { mode: session.mode, label: session.label, isAuthenticated: session.isAuthenticated };
}

function normalizeTicker(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim().toUpperCase().slice(0, 12) : "NVDA";
}

function normalizeText(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 240) : fallback;
}

export async function POST(request: NextRequest) {
  const session = await getAuthReadinessSession();
  let payload: PreviewDeliveryPayload = {};
  try {
    payload = (await request.json()) as PreviewDeliveryPayload;
  } catch {
    payload = {};
  }

  const dryRun = payload.dryRun !== false;
  const preferences = await getNotificationPreferences(session.ownerId);
  const enabledChannels = enabledPreferenceChannels(preferences);
  const ticker = normalizeTicker(payload.ticker);
  const watchlist = await listWatchlist(session.ownerId);
  const matchedWatchlist = watchlist.some((item) => item.ticker.toUpperCase() === ticker);
  const watchlistAllowed = !preferences.watchlistOnly || matchedWatchlist;
  const riskAllowed = preferences.riskLevelPreference === "any" || preferences.riskLevelPreference === normalizeText(payload.riskLevel, preferences.riskLevelPreference);
  const actionAllowed = preferences.alertActionPreference === "any" || preferences.alertActionPreference === normalizeText(payload.action, preferences.alertActionPreference);
  const deliveryAllowed = enabledChannels.length > 0 && watchlistAllowed && riskAllowed && actionAllowed;

  const realDeliveryConfigured = process.env[SAFE_REAL_DELIVERY_ENV] === "true" && (process.env[EMAIL_ENV] === "true" || Boolean(process.env[TELEGRAM_ENV]) || process.env[PWA_ENV] === "true");
  const realDeliveryBlockedReasons = [
    session.isAuthenticated ? null : "real_auth_not_connected",
    deliveryAllowed ? null : "user_preferences_do_not_allow_delivery",
    preferences.updatedAt ? null : "no_saved_preference_control",
    realDeliveryConfigured ? null : "safe_delivery_environment_not_configured",
  ].filter((reason): reason is string => Boolean(reason));

  return NextResponse.json({
    ok: true,
    dryRun,
    auth: authSummary(session),
    preview: {
      ticker,
      riskLevel: normalizeText(payload.riskLevel, "balanced"),
      action: normalizeText(payload.action, "review"),
      message: normalizeText(payload.message, `Swing Up research alert preview for ${ticker}. Review receipts and preferences before acting.`),
      channelsConsidered: ["email", "telegram", "pwa"],
      enabledPreferenceChannels: enabledChannels,
      matchedWatchlist,
      watchlistOnly: preferences.watchlistOnly,
      deliveryAllowed,
      notificationLogCreated: false,
    },
    safety: {
      defaultMode: "dryRun",
      realDeliveryAttempted: !dryRun,
      realDeliverySent: false,
      realDeliveryBlockedReasons: dryRun ? ["dry_run_mode"] : realDeliveryBlockedReasons,
      requiredEnvironmentNamesForRealDelivery: [SAFE_REAL_DELIVERY_ENV, EMAIL_ENV, TELEGRAM_ENV, PWA_ENV],
      note: "This MVP never sends paid-only alerts and does not send real email, Telegram, or browser push messages in preview mode.",
    },
  });
}
