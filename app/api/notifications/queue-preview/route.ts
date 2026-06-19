import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";

const CHANNELS_CONSIDERED = ["email", "telegram", "pwa"] as const;
const DELIVERABLE_ALERT_STATUS = "published";

type QueuePreviewPayload = {
  alertId?: unknown;
  dryRun?: unknown;
};

type BlockedReasonCounts = Record<string, number>;

type CandidatePreview = {
  userRef: string;
  alertId: string;
  ticker: string;
  company: string;
  action: string;
  channels: string[];
  reason: string;
};

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function boolValue(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeTicker(value: string) {
  return value.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "").slice(0, 12);
}

function addReason(reasons: BlockedReasonCounts, reason: string) {
  reasons[reason] = (reasons[reason] ?? 0) + 1;
}

function safeUserRef(index: number) {
  return `matched-user-${index + 1}`;
}

function enabledChannelsForUser(match: {
  user: {
    notificationChannels: { channelType: string; destination: string; isEnabled: boolean }[];
    telegramAccounts: { telegramUserId: string | null; linkedAt: Date | null }[];
  } | null;
}) {
  const channels = new Set<string>();
  const user = match.user;
  if (!user) return [];

  for (const channel of user.notificationChannels) {
    const channelType = channel.channelType.toLowerCase();
    if (!CHANNELS_CONSIDERED.includes(channelType as (typeof CHANNELS_CONSIDERED)[number])) continue;
    if (!channel.isEnabled || !channel.destination.trim()) continue;
    if (channelType === "telegram") {
      const linkedTelegram = user.telegramAccounts.some((account) => account.telegramUserId && account.linkedAt);
      if (!linkedTelegram) continue;
    }
    channels.add(channelType);
  }

  return Array.from(channels).sort();
}

export async function POST(request: NextRequest) {
  let payload: QueuePreviewPayload = {};
  try {
    payload = (await request.json()) as QueuePreviewPayload;
  } catch {
    payload = {};
  }

  const dryRun = boolValue(payload.dryRun, true);
  const alertId = text(payload.alertId);
  const blockedReasons: BlockedReasonCounts = {};
  const warnings: string[] = [];

  if (!alertId) {
    return NextResponse.json(
      {
        ok: false,
        error: "alertId is required.",
        alertId: null,
        dryRun,
        matchedUsersCount: 0,
        queuedCount: 0,
        blockedCount: 1,
        blockedReasons: { missing_alert_id: 1 },
        channelsConsidered: CHANNELS_CONSIDERED,
        sampleNotificationPreview: null,
        warnings: ["No notifications were queued or sent."],
      },
      { status: 400 },
    );
  }

  if (!process.env.DATABASE_URL) {
    return NextResponse.json({
      ok: true,
      alertId,
      dryRun: true,
      requestedDryRun: dryRun,
      matchedUsersCount: 0,
      queuedCount: 0,
      blockedCount: 0,
      blockedReasons: {},
      channelsConsidered: CHANNELS_CONSIDERED,
      sampleNotificationPreview: null,
      warnings: [
        "DATABASE_URL is not configured, so this dry-run used an empty safe preview.",
        "No email, Telegram, or browser push messages were sent.",
        "Private destinations and user identifiers are intentionally omitted from the response.",
      ],
    });
  }

  try {
    const alert = await prisma.alert.findUnique({
      where: { id: alertId },
      select: { id: true, ticker: true, company: true, action: true, event: true, status: true, publishedAt: true },
    });

    if (!alert) {
      return NextResponse.json(
        {
          ok: false,
          error: "Alert not found.",
          alertId,
          dryRun,
          matchedUsersCount: 0,
          queuedCount: 0,
          blockedCount: 1,
          blockedReasons: { alert_not_found: 1 },
          channelsConsidered: CHANNELS_CONSIDERED,
          sampleNotificationPreview: null,
          warnings: ["No notifications were queued or sent."],
        },
        { status: 404 },
      );
    }

    const ticker = normalizeTicker(alert.ticker);
    if (!ticker) addReason(blockedReasons, "missing_alert_ticker");
    if (alert.status.toLowerCase() !== DELIVERABLE_ALERT_STATUS || !alert.publishedAt) addReason(blockedReasons, "alert_not_published");

    const matches = ticker
      ? await prisma.watchlist.findMany({
          where: { ticker, status: "active" },
          select: {
            id: true,
            userId: true,
            previewOwnerId: true,
            alertPreference: true,
            user: {
              select: {
                notificationChannels: { select: { channelType: true, destination: true, isEnabled: true } },
                telegramAccounts: { select: { telegramUserId: true, linkedAt: true } },
              },
            },
          },
        })
      : [];

    const userIds = Array.from(new Set(matches.map((match) => match.userId).filter((id): id is string => Boolean(id))));
    const previewCandidates: CandidatePreview[] = [];
    const queuedUserIds = new Set<string>();
    let blockedCount = 0;

    if (!matches.length) addReason(blockedReasons, "no_matching_active_watchlists");

    matches.forEach((match) => {
      if (!match.userId || !match.user) {
        blockedCount += 1;
        addReason(blockedReasons, match.previewOwnerId ? "preview_owner_watchlist_not_delivery_eligible" : "watchlist_has_no_user");
        return;
      }

      if (match.alertPreference === "preview_only") {
        blockedCount += 1;
        addReason(blockedReasons, "watchlist_preview_only");
        return;
      }

      const channels = enabledChannelsForUser(match);
      if (!channels.length) {
        blockedCount += 1;
        addReason(blockedReasons, "no_consented_enabled_channels");
        return;
      }

      if (alert.status.toLowerCase() !== DELIVERABLE_ALERT_STATUS || !alert.publishedAt) {
        blockedCount += 1;
        return;
      }

      queuedUserIds.add(match.userId);
      if (previewCandidates.length < 3) {
        previewCandidates.push({
          userRef: safeUserRef(previewCandidates.length),
          alertId: alert.id,
          ticker,
          company: alert.company,
          action: alert.action,
          channels,
          reason: `Active watchlist match for ${ticker} with at least one consented enabled channel.`,
        });
      }
    });

    if (!dryRun) warnings.push("Real delivery is disabled for this route; it only creates a dry-run preview.");
    warnings.push("No email, Telegram, or browser push messages were sent.");
    warnings.push("Private destinations and user identifiers are intentionally omitted from the response.");

    return NextResponse.json({
      ok: true,
      alertId: alert.id,
      dryRun: true,
      requestedDryRun: dryRun,
      matchedUsersCount: userIds.length,
      queuedCount: queuedUserIds.size,
      blockedCount,
      blockedReasons,
      channelsConsidered: CHANNELS_CONSIDERED,
      sampleNotificationPreview: previewCandidates[0] ?? null,
      warnings,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to create notification queue preview.";
    return NextResponse.json(
      {
        ok: false,
        error: message,
        alertId,
        dryRun: true,
        matchedUsersCount: 0,
        queuedCount: 0,
        blockedCount: 1,
        blockedReasons: { queue_preview_error: 1 },
        channelsConsidered: CHANNELS_CONSIDERED,
        sampleNotificationPreview: null,
        warnings: ["No notifications were queued or sent."],
      },
      { status: 500 },
    );
  }
}
