import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db/client";

const MATCHABLE_ALERT_STATUSES = new Set(["approved", "candidate"]);

type MockWatchlist = {
  ticker?: unknown;
  userId?: unknown;
  previewOwnerId?: unknown;
  status?: unknown;
  notificationChannels?: unknown;
};

type MatchRequest = {
  alertId?: unknown;
  dryRun?: unknown;
  alert?: {
    id?: unknown;
    ticker?: unknown;
    status?: unknown;
  } | null;
  watchlists?: MockWatchlist[];
};

type MatchResponse = {
  ok: true;
  alertId: string;
  ticker: string;
  matchedWatchlists: number;
  matchedUsers: number;
  deliveryEligible: number;
  blockedReasons: string[];
  dryRun: boolean;
};

function text(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function boolValue(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeTicker(value: unknown) {
  return text(value).toUpperCase().replace(/[^A-Z0-9.-]/g, "").slice(0, 12);
}

function unique(values: string[]) {
  return Array.from(new Set(values));
}

function channelEligible(value: unknown) {
  if (!Array.isArray(value)) return false;
  return value.some((channel) => {
    if (!channel || typeof channel !== "object") return false;
    const candidate = channel as { isEnabled?: unknown; channelType?: unknown };
    return candidate.isEnabled === true && Boolean(text(candidate.channelType));
  });
}

function mockWatchlists(input: MockWatchlist[] | undefined, ticker: string): MockWatchlist[] {
  if (input?.length) return input;
  return [
    { ticker, userId: "mock-user-1", status: "active", notificationChannels: [{ channelType: "email", isEnabled: true }] },
    { ticker, previewOwnerId: "preview-owner", status: "active", notificationChannels: [] },
    { ticker: "MSFT", userId: "mock-user-2", status: "active", notificationChannels: [{ channelType: "email", isEnabled: true }] },
  ];
}

async function matchFromDatabase(alertId: string, dryRun: boolean): Promise<MatchResponse | { ok: false; status: number; error: string; blockedReasons: string[]; dryRun: boolean }> {
  const blockedReasons: string[] = [];
  const alert = await prisma.alert.findUnique({ where: { id: alertId }, select: { id: true, ticker: true, status: true } });
  if (!alert) return { ok: false, status: 404, error: "Alert not found.", blockedReasons: ["alert_not_found"], dryRun };

  const ticker = normalizeTicker(alert.ticker);
  if (!ticker) blockedReasons.push("missing_alert_ticker");
  if (!MATCHABLE_ALERT_STATUSES.has(alert.status.toLowerCase())) blockedReasons.push(`alert_status_not_matchable:${alert.status}`);

  const isMatchableStatus = MATCHABLE_ALERT_STATUSES.has(alert.status.toLowerCase());
  const matches = ticker && isMatchableStatus
    ? await prisma.watchlist.findMany({
        where: { ticker, status: "active" },
        select: {
          id: true,
          userId: true,
          previewOwnerId: true,
          user: { select: { notificationChannels: { select: { channelType: true, isEnabled: true } } } },
        },
      })
    : [];

  const matchedUserIds = unique(matches.map((match) => match.userId).filter((id): id is string => Boolean(id)));
  const deliveryEligibleUserIds = unique(
    matches
      .filter((match) => match.userId && channelEligible(match.user?.notificationChannels))
      .map((match) => match.userId as string),
  );

  if (!matches.length) blockedReasons.push("no_matching_active_watchlists");
  if (matches.some((match) => !match.userId && match.previewOwnerId)) blockedReasons.push("preview_owner_watchlists_not_delivery_eligible");
  if (matchedUserIds.length && !deliveryEligibleUserIds.length) blockedReasons.push("no_enabled_notification_channels");
  blockedReasons.push("match_only_no_notifications_sent");
  if (dryRun) blockedReasons.push("dry_run_no_notifications_sent");

  return { ok: true, alertId: alert.id, ticker, matchedWatchlists: matches.length, matchedUsers: matchedUserIds.length, deliveryEligible: deliveryEligibleUserIds.length, blockedReasons: unique(blockedReasons), dryRun };
}

function matchFromMock(payload: MatchRequest, dryRun: boolean): MatchResponse {
  const alertId = text(payload.alert?.id ?? payload.alertId, "mock-alert");
  const ticker = normalizeTicker(payload.alert?.ticker) || "AAPL";
  const status = text(payload.alert?.status, "candidate").toLowerCase();
  const blockedReasons: string[] = [];
  const isMatchableStatus = MATCHABLE_ALERT_STATUSES.has(status);
  if (!isMatchableStatus) blockedReasons.push(`alert_status_not_matchable:${status}`);

  const matches = isMatchableStatus ? mockWatchlists(payload.watchlists, ticker).filter((item) => text(item.status, "active") === "active" && normalizeTicker(item.ticker) === ticker) : [];
  const userIds = unique(matches.map((match) => text(match.userId)).filter(Boolean));
  const deliveryEligibleUserIds = unique(matches.filter((match) => text(match.userId) && channelEligible(match.notificationChannels)).map((match) => text(match.userId)));

  if (!matches.length) blockedReasons.push("no_matching_active_watchlists");
  if (matches.some((match) => !text(match.userId) && text(match.previewOwnerId))) blockedReasons.push("preview_owner_watchlists_not_delivery_eligible");
  if (userIds.length && !deliveryEligibleUserIds.length) blockedReasons.push("no_enabled_notification_channels");
  blockedReasons.push("match_only_no_notifications_sent");
  if (dryRun) blockedReasons.push("dry_run_no_notifications_sent");

  return { ok: true, alertId, ticker, matchedWatchlists: matches.length, matchedUsers: userIds.length, deliveryEligible: deliveryEligibleUserIds.length, blockedReasons: unique(blockedReasons), dryRun };
}

export async function POST(request: NextRequest) {
  let payload: MatchRequest = {};
  try {
    payload = (await request.json()) as MatchRequest;
  } catch {
    payload = {};
  }

  const dryRun = boolValue(payload.dryRun, true);
  const alertId = text(payload.alertId);
  const useDatabase = Boolean(process.env.DATABASE_URL && alertId && !payload.alert);

  try {
    const result = useDatabase ? await matchFromDatabase(alertId, dryRun) : matchFromMock(payload, dryRun);
    if (!result.ok) return NextResponse.json({ ok: false, error: result.error, blockedReasons: result.blockedReasons, dryRun: result.dryRun }, { status: result.status });
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to match alert to watchlists.";
    return NextResponse.json({ ok: false, error: message, blockedReasons: ["match_engine_error"], dryRun }, { status: 500 });
  }
}
