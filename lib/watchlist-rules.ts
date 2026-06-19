export type WatchlistRiskPreference = "conservative" | "balanced" | "aggressive" | "any";
export type WatchlistActionType = "watch" | "informational" | "review" | "buy" | "sell" | "avoid";
export type PlanTier = "free" | "plus" | "pro" | "enterprise";
export type DeliveryChannel = "in_app" | "email" | "telegram" | "push";

type WatchlistInput = {
  tickers?: unknown;
  sectors?: unknown;
  assetTypes?: unknown;
  riskPreference?: unknown;
  actionTypes?: unknown;
  planTier?: unknown;
  notificationsEnabled?: unknown;
  dailyLimit?: unknown;
  alertsSentToday?: unknown;
  deliveryChannels?: unknown;
};

type UserInput = {
  id?: unknown;
  userId?: unknown;
  watchlist?: WatchlistInput | null;
  planTier?: unknown;
  notificationsEnabled?: unknown;
  dailyLimit?: unknown;
  alertsSentToday?: unknown;
  deliveryChannels?: unknown;
};

type AlertInput = {
  id?: unknown;
  alertId?: unknown;
  ticker?: unknown;
  sector?: unknown;
  assetType?: unknown;
  riskLevel?: unknown;
  actionType?: unknown;
};

export type WatchlistRulesInput = {
  user?: UserInput | null;
  watchlist?: WatchlistInput | null;
  alert?: AlertInput | null;
};

export type WatchlistRulesPreview = {
  ok: true;
  userId: string;
  alertId: string;
  matched: boolean;
  matchReasons: string[];
  blockReasons: string[];
  suggestedDeliveryChannels: DeliveryChannel[];
  simpleExplanation: string;
  warnings: string[];
};

const VALID_PLAN_TIERS: PlanTier[] = ["free", "plus", "pro", "enterprise"];
const RISK_ORDER: Exclude<WatchlistRiskPreference, "any">[] = ["conservative", "balanced", "aggressive"];
const DEFAULT_CHANNELS: DeliveryChannel[] = ["in_app"];

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function normalized(value: unknown) {
  return text(value).toLowerCase();
}

function stringList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => normalized(item)).filter(Boolean);
}

function numberValue(value: unknown, fallback: number) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolValue(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}

function planTier(value: unknown): PlanTier {
  const tier = normalized(value);
  return VALID_PLAN_TIERS.includes(tier as PlanTier) ? (tier as PlanTier) : "free";
}

function riskAllowed(preference: string, alertRisk: string) {
  if (!preference || preference === "any") return true;
  if (!alertRisk) return false;
  const preferenceIndex = RISK_ORDER.indexOf(preference as Exclude<WatchlistRiskPreference, "any">);
  const alertIndex = RISK_ORDER.indexOf(alertRisk as Exclude<WatchlistRiskPreference, "any">);
  if (preferenceIndex === -1 || alertIndex === -1) return false;
  return alertIndex <= preferenceIndex;
}

function channels(value: unknown, notificationsEnabled: boolean): DeliveryChannel[] {
  if (!notificationsEnabled) return [];
  const requested = stringList(value).filter((item): item is DeliveryChannel => ["in_app", "email", "telegram", "push"].includes(item));
  return requested.length ? unique(requested) as DeliveryChannel[] : DEFAULT_CHANNELS;
}

export function mockWatchlistRulesInput(): WatchlistRulesInput {
  return {
    user: {
      id: "mock-user-33",
      planTier: "plus",
      notificationsEnabled: true,
      dailyLimit: 5,
      alertsSentToday: 1,
      deliveryChannels: ["in_app", "email"],
      watchlist: {
        tickers: ["SHOP", "MSFT"],
        sectors: ["technology", "consumer cyclical"],
        assetTypes: ["equity"],
        riskPreference: "balanced",
        actionTypes: ["watch", "informational", "review"],
      },
    },
    alert: {
      id: "mock-alert-33",
      ticker: "SHOP",
      sector: "technology",
      assetType: "equity",
      riskLevel: "balanced",
      actionType: "watch",
    },
  };
}

export function evaluateWatchlistRules(input: WatchlistRulesInput = {}): WatchlistRulesPreview {
  const user = input.user ?? {};
  const watchlist = input.watchlist ?? user.watchlist ?? {};
  const alert = input.alert ?? {};
  const matchReasons: string[] = [];
  const blockReasons: string[] = [];
  const warnings: string[] = ["Preview only: no email, Telegram, push, or in-app notification was sent.", "This matching contract is not investment advice and does not publish real alerts."];

  const userId = text(user.id ?? user.userId, "mock-user");
  const alertId = text(alert.id ?? alert.alertId, "mock-alert");
  const ticker = normalized(alert.ticker).toUpperCase();
  const sector = normalized(alert.sector);
  const assetType = normalized(alert.assetType);
  const actionType = normalized(alert.actionType);
  const alertRisk = normalized(alert.riskLevel);
  const followedTickers = stringList(watchlist.tickers).map((item) => item.toUpperCase());
  const followedSectors = stringList(watchlist.sectors);
  const followedAssetTypes = stringList(watchlist.assetTypes);
  const allowedActions = stringList(watchlist.actionTypes);
  const preference = normalized(watchlist.riskPreference) || "any";
  const tier = planTier(watchlist.planTier ?? user.planTier);
  const notificationsEnabled = boolValue(watchlist.notificationsEnabled ?? user.notificationsEnabled, true);
  const dailyLimit = numberValue(watchlist.dailyLimit ?? user.dailyLimit, 3);
  const alertsSentToday = numberValue(watchlist.alertsSentToday ?? user.alertsSentToday, 0);

  if (!input.user && !input.watchlist) warnings.push("Missing user/watchlist data; default mock-safe placeholders were used.");
  if (!input.alert) warnings.push("Missing alert data; default mock-safe placeholders were used.");

  if (ticker && followedTickers.includes(ticker)) matchReasons.push(`followed_ticker:${ticker}`);
  if (sector && followedSectors.includes(sector)) matchReasons.push(`followed_sector:${sector}`);
  if (assetType && followedAssetTypes.includes(assetType)) matchReasons.push(`followed_asset_type:${assetType}`);
  if (!ticker && !sector && !assetType) blockReasons.push("missing_alert_target");
  if (!followedTickers.length && !followedSectors.length && !followedAssetTypes.length) blockReasons.push("empty_watchlist");

  if (riskAllowed(preference, alertRisk)) matchReasons.push(`risk_preference_allows:${preference}`);
  else blockReasons.push(`risk_preference_blocks:${preference || "unknown"}`);

  if (!allowedActions.length || allowedActions.includes(actionType)) matchReasons.push(`action_type_allowed:${actionType || "unspecified"}`);
  else blockReasons.push(`action_type_blocked:${actionType || "unspecified"}`);

  if (tier === "free") warnings.push("Plan tier placeholder is free; future builds may apply tighter routing rules.");
  else matchReasons.push(`plan_tier_placeholder:${tier}`);

  if (!notificationsEnabled) blockReasons.push("notifications_disabled_placeholder");
  if (alertsSentToday >= dailyLimit) blockReasons.push("daily_limit_reached_placeholder");

  const hasTargetMatch = matchReasons.some((reason) => reason.startsWith("followed_"));
  if (!hasTargetMatch) blockReasons.push("no_followed_ticker_sector_or_asset_type_match");

  const matched = hasTargetMatch && blockReasons.length === 0;
  const suggestedDeliveryChannels = matched ? channels(watchlist.deliveryChannels ?? user.deliveryChannels, notificationsEnabled) : [];

  return {
    ok: true,
    userId,
    alertId,
    matched,
    matchReasons: unique(matchReasons),
    blockReasons: unique(blockReasons),
    suggestedDeliveryChannels,
    simpleExplanation: matched
      ? "The mock alert matches the mock watchlist contract. This preview did not send or publish any notification and is not investment advice."
      : `The mock alert does not match this watchlist contract because: ${unique(blockReasons).join(", ") || "no matching rule passed"}. No notification was sent.`,
    warnings,
  };
}
