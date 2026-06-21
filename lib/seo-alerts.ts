import { Prisma } from "@prisma/client";

export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "https://swing-up-production.up.railway.app").replace(/\/$/, "");

export function slugPart(value: string, fallback = "alert", max = 48) {
  const slug = value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
  return slug || fallback;
}

export function shortId(id: string) {
  return id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 4).toLowerCase() || "0000";
}

export function isoDate(value: Date | string | null | undefined) {
  if (!value) return new Date().toISOString().slice(0, 10);
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return new Date().toISOString().slice(0, 10);
  return date.toISOString().slice(0, 10);
}

export function alertSeoSlug(alert: { id: string; ticker: string; event: string; publishedAt?: Date | string | null }) {
  return `${slugPart(alert.ticker, "ticker", 12)}-${slugPart(alert.event, "market-alert", 42)}-${isoDate(alert.publishedAt)}-${shortId(alert.id)}`;
}

export function canonicalAlertPath(alert: { id: string; ticker: string; event: string; publishedAt?: Date | string | null }, ledgerSlug?: string | null) {
  const existing = ledgerSlug?.trim();
  if (existing && existing.split("-").length >= 4) return `/alerts/${existing}`;
  return `/alerts/${alertSeoSlug(alert)}`;
}

export function absoluteUrl(path: string) {
  return `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

export function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

export function safeText(value: unknown, fallback = "Not available yet") {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (value instanceof Prisma.Decimal) return value.toString();
  return fallback;
}
