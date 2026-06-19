import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";

export type WatchlistStatus = "active" | "removed";
export type WatchlistItem = {
  id: string;
  ownerId: string;
  ticker: string;
  company: string | null;
  assetType: string;
  sectorTheme: string | null;
  riskPreference: string;
  alertPreference: string;
  createdAt: string;
  status: WatchlistStatus;
};

export type WatchlistInput = {
  ticker?: unknown;
  company?: unknown;
  assetType?: unknown;
  sectorTheme?: unknown;
  sector?: unknown;
  theme?: unknown;
  riskPreference?: unknown;
  alertPreference?: unknown;
};

const memoryStore = new Map<string, WatchlistItem[]>();

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function toItem(row: { id: string; userId: string | null; previewOwnerId: string | null; ticker: string; company: string | null; assetType: string; sectorTheme: string | null; riskPreference: string; alertPreference: string; createdAt: Date; status: string }, ownerId: string): WatchlistItem {
  return { id: row.id, ownerId: row.userId ?? row.previewOwnerId ?? ownerId, ticker: row.ticker, company: row.company, assetType: row.assetType, sectorTheme: row.sectorTheme, riskPreference: row.riskPreference, alertPreference: row.alertPreference, createdAt: row.createdAt.toISOString(), status: row.status === "removed" ? "removed" : "active" };
}

export function normalizeWatchlistInput(input: WatchlistInput) {
  const ticker = text(input.ticker).toUpperCase().replace(/[^A-Z0-9.-]/g, "").slice(0, 12);
  if (!ticker) throw new Error("ticker is required");
  return {
    ticker,
    company: text(input.company, ticker).slice(0, 120),
    assetType: text(input.assetType, "equity").slice(0, 40),
    sectorTheme: text(input.sectorTheme ?? input.sector ?? input.theme, "Unspecified").slice(0, 80),
    riskPreference: text(input.riskPreference, "balanced").slice(0, 40),
    alertPreference: text(input.alertPreference, "preview_only").slice(0, 80),
  };
}

export async function listWatchlist(ownerId: string): Promise<WatchlistItem[]> {
  if (!process.env.DATABASE_URL) return memoryStore.get(ownerId)?.filter((item) => item.status === "active") ?? [];
  const rows = await prisma.watchlist.findMany({ where: { previewOwnerId: ownerId, status: "active" }, orderBy: { createdAt: "desc" } });
  return rows.map((row) => toItem(row, ownerId));
}

export async function addWatchlistItem(ownerId: string, input: WatchlistInput): Promise<WatchlistItem> {
  const data = normalizeWatchlistInput(input);
  if (!process.env.DATABASE_URL) {
    const item: WatchlistItem = { id: crypto.randomUUID(), ownerId, ...data, createdAt: new Date().toISOString(), status: "active" };
    memoryStore.set(ownerId, [item, ...(memoryStore.get(ownerId) ?? []).filter((existing) => existing.ticker !== item.ticker)]);
    return item;
  }
  const row = await prisma.watchlist.create({ data: { previewOwnerId: ownerId, ...data } });
  return toItem(row, ownerId);
}

export async function removeWatchlistItem(ownerId: string, idOrTicker: string): Promise<number> {
  const value = idOrTicker.trim();
  if (!value) return 0;
  if (!process.env.DATABASE_URL) {
    const items = memoryStore.get(ownerId) ?? [];
    let removed = 0;
    memoryStore.set(ownerId, items.map((item) => {
      if (item.id === value || item.ticker === value.toUpperCase()) {
        removed += item.status === "active" ? 1 : 0;
        return { ...item, status: "removed" };
      }
      return item;
    }));
    return removed;
  }
  const where = Prisma.validator<Prisma.WatchlistWhereInput>()({ previewOwnerId: ownerId, status: "active", OR: [{ id: value }, { ticker: value.toUpperCase() }] });
  const result = await prisma.watchlist.updateMany({ where, data: { status: "removed" } });
  return result.count;
}
