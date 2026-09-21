// US listed-equity sessions, America/New_York (including daylight saving).
// Extraordinary closures can be supplied as dates; unknown exchanges stay closed-safe at the caller.
const dayMs = 86400000;
const parts = (date: Date) => Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
}).formatToParts(date).map(part => [part.type, part.value]));
const key = (date: Date) => date.toISOString().slice(0, 10);
const nth = (year: number, month: number, weekday: number, n: number) => {
  const first = new Date(Date.UTC(year, month, 1));
  return key(new Date(Date.UTC(year, month, 1 + (weekday - first.getUTCDay() + 7) % 7 + (n - 1) * 7)));
};
const observed = (year: number, month: number, day: number, newYear = false) => {
  const date = new Date(Date.UTC(year, month, day));
  if (date.getUTCDay() === 0) date.setUTCDate(day + 1);
  else if (date.getUTCDay() === 6 && !newYear) date.setUTCDate(day - 1);
  return key(date);
};
function easter(year: number) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451), z = h + l - 7 * m + 114;
  return new Date(Date.UTC(year, Math.floor(z / 31) - 1, z % 31 + 1));
}
export function usEquitySession(dateKey: string) {
  const date = new Date(`${dateKey}T12:00:00Z`), year = date.getUTCFullYear();
  const lastMay = new Date(Date.UTC(year, 5, 0));
  lastMay.setUTCDate(lastMay.getUTCDate() - (lastMay.getUTCDay() + 6) % 7);
  const holidays = new Set([observed(year, 0, 1, true), nth(year, 0, 1, 3), nth(year, 1, 1, 3),
    key(new Date(easter(year).getTime() - 2 * dayMs)), key(lastMay), observed(year, 5, 19), observed(year, 6, 4),
    nth(year, 8, 1, 1), nth(year, 10, 4, 4), observed(year, 11, 25),
    ...(process.env.SWING_UP_US_MARKET_EXTRA_CLOSURES ?? "2025-01-09").split(",").map(value => value.trim())]);
  if ([0, 6].includes(date.getUTCDay()) || holidays.has(dateKey)) return null;
  const thanksgivingFriday = key(new Date(Date.parse(`${nth(year, 10, 4, 4)}T12:00:00Z`) + dayMs));
  const early = dateKey === thanksgivingFriday || dateKey.endsWith("-12-24") || dateKey.endsWith("-07-03");
  return { date: dateKey, regularCloseMinute: early ? 13 * 60 : 16 * 60, extendedCloseMinute: early ? 17 * 60 : 20 * 60 };
}
export function usQuoteFreshness(observedAt: string, now: Date) {
  const p = parts(now), dateKey = `${p.year}-${p.month}-${p.day}`, minute = Number(p.hour) * 60 + Number(p.minute);
  const session = usEquitySession(dateKey);
  const observedMs = Date.parse(observedAt), age = now.getTime() - observedMs;
  const marketOpen = Boolean(session && minute >= 4 * 60 && minute < session.extendedCloseMinute);
  if (!Number.isFinite(age) || age < -5 * 60000) return { usable: false, marketOpen, basis: "unavailable" as const };
  if (marketOpen) return { usable: age <= 15 * 60000, marketOpen, basis: "live_or_delayed" as const };
  let prior = new Date(`${dateKey}T12:00:00Z`);
  if (!session || minute < 4 * 60) prior = new Date(prior.getTime() - dayMs);
  for (let i = 0; i < 10; i++, prior = new Date(prior.getTime() - dayMs)) {
    const previousSession = usEquitySession(key(prior));
    if (!previousSession) continue;
    const q = parts(new Date(observedMs));
    const quoteDate = `${q.year}-${q.month}-${q.day}`, quoteMinute = Number(q.hour) * 60 + Number(q.minute);
    return { usable: quoteDate === previousSession.date && quoteMinute >= previousSession.regularCloseMinute - 15
      && quoteMinute <= previousSession.extendedCloseMinute, marketOpen, basis: "last_completed_session" as const };
  }
  return { usable: false, marketOpen, basis: "unavailable" as const };
}
