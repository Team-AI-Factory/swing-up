export type NotificationRiskPreference = "conservative" | "balanced" | "aggressive" | "any";
export type NotificationAlertActionPreference = "watch" | "informational" | "review" | "any";

export type QuietHoursPreference = {
  enabled: boolean;
  start: string;
  end: string;
  timezone: string;
};

export type NotificationPreferences = {
  emailEnabled: boolean;
  telegramEnabled: boolean;
  pwaEnabled: boolean;
  watchlistOnly: boolean;
  riskLevelPreference: NotificationRiskPreference;
  alertActionPreference: NotificationAlertActionPreference;
  quietHours: QuietHoursPreference;
  updatedAt: string | null;
};

const DEFAULT_PREFERENCES: NotificationPreferences = {
  emailEnabled: false,
  telegramEnabled: false,
  pwaEnabled: false,
  watchlistOnly: true,
  riskLevelPreference: "balanced",
  alertActionPreference: "review",
  quietHours: {
    enabled: false,
    start: "22:00",
    end: "07:00",
    timezone: "UTC",
  },
  updatedAt: null,
};

const preferencesStore = new Map<string, NotificationPreferences>();

function booleanValue(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T) ? (value as T) : fallback;
}

function timeValue(value: unknown, fallback: string) {
  return typeof value === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : fallback;
}

function timezoneValue(value: unknown, fallback: string) {
  return typeof value === "string" && value.length > 0 && value.length <= 64 ? value : fallback;
}

export function defaultNotificationPreferences(): NotificationPreferences {
  return structuredClone(DEFAULT_PREFERENCES);
}

export async function getNotificationPreferences(ownerId: string): Promise<NotificationPreferences> {
  return preferencesStore.get(ownerId) ?? defaultNotificationPreferences();
}

export async function saveNotificationPreferences(ownerId: string, input: Partial<NotificationPreferences>): Promise<NotificationPreferences> {
  const current = await getNotificationPreferences(ownerId);
  const quietHoursInput: Partial<QuietHoursPreference> = input.quietHours ?? {};
  const next: NotificationPreferences = {
    emailEnabled: booleanValue(input.emailEnabled, current.emailEnabled),
    telegramEnabled: booleanValue(input.telegramEnabled, current.telegramEnabled),
    pwaEnabled: booleanValue(input.pwaEnabled, current.pwaEnabled),
    watchlistOnly: booleanValue(input.watchlistOnly, current.watchlistOnly),
    riskLevelPreference: enumValue(input.riskLevelPreference, ["conservative", "balanced", "aggressive", "any"] as const, current.riskLevelPreference),
    alertActionPreference: enumValue(input.alertActionPreference, ["watch", "informational", "review", "any"] as const, current.alertActionPreference),
    quietHours: {
      enabled: booleanValue(quietHoursInput.enabled, current.quietHours.enabled),
      start: timeValue(quietHoursInput.start, current.quietHours.start),
      end: timeValue(quietHoursInput.end, current.quietHours.end),
      timezone: timezoneValue(quietHoursInput.timezone, current.quietHours.timezone),
    },
    updatedAt: new Date().toISOString(),
  };
  preferencesStore.set(ownerId, next);
  return next;
}

export function enabledPreferenceChannels(preferences: NotificationPreferences) {
  return [
    preferences.emailEnabled ? "email" : null,
    preferences.telegramEnabled ? "telegram" : null,
    preferences.pwaEnabled ? "pwa" : null,
  ].filter((channel): channel is string => Boolean(channel));
}
