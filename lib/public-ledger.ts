import { mockAlerts, type Alert } from "@/lib/mock-alerts";

export type LedgerStatus = "open" | "win" | "loss" | "neutral";

export type PublicLedgerEntry = {
  id: string;
  date: string;
  action: string;
  ticker: string;
  company: string;
  event: string;
  alertPrice: string;
  result: string;
  oneDay: string;
  sevenDay: string;
  thirtyDay: string;
  status: LedgerStatus;
  source: "mock-preview";
  alert: Alert;
};

const statusByAction: Record<Alert["action"], LedgerStatus> = {
  BUY: "open",
  WATCH: "neutral",
  AVOID: "open",
};

function formatAction(action: Alert["action"]) {
  if (action === "BUY") return "Buy candidate";
  if (action === "AVOID") return "Avoid";
  return "Watch";
}

function formatDate(eventDate: string | undefined) {
  return eventDate ?? "Preview date pending";
}

export function getPublicLedgerEntries(): PublicLedgerEntry[] {
  return mockAlerts.map((alert) => ({
    id: alert.id,
    date: formatDate(alert.eventDate),
    action: formatAction(alert.action),
    ticker: alert.ticker,
    company: alert.company,
    event: alert.event,
    alertPrice: alert.currentPrice,
    result: alert.publicTrackingResult,
    oneDay: "Preview pending",
    sevenDay: "Preview pending",
    thirtyDay: "Preview pending",
    status: statusByAction[alert.action],
    source: "mock-preview",
    alert,
  }));
}

export function getPublicLedgerEntry(id: string) {
  return getPublicLedgerEntries().find((entry) => entry.id === id);
}
