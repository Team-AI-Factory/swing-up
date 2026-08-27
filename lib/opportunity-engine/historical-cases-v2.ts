import { buildHistoricalOpportunityCases, type HistoricalOpportunityCase } from "./historical-cases";

function periodEnd(row: HistoricalOpportunityCase) {
  const candidate = row.input.fiscalPeriod?.split(":").at(-1) ?? null;
  return candidate && /^\d{4}-\d{2}-\d{2}$/.test(candidate) ? candidate : null;
}

function filingLagDays(row: HistoricalOpportunityCase) {
  const end = periodEnd(row);
  if (!end) return Number.POSITIVE_INFINITY;
  const lag = (Date.parse(`${row.filingDate}T00:00:00Z`) - Date.parse(`${end}T00:00:00Z`)) / 86_400_000;
  return Number.isFinite(lag) ? lag : Number.POSITIVE_INFINITY;
}

export async function buildCleanHistoricalOpportunityCases(tickers: string[], earliest = "2016-01-01") {
  const source = await buildHistoricalOpportunityCases(tickers, earliest);
  const grouped = new Map<string, HistoricalOpportunityCase[]>();
  for (const row of source.cases) {
    const key = `${row.ticker}|${row.accession}`;
    const current = grouped.get(key) ?? [];
    current.push(row);
    grouped.set(key, current);
  }
  const cases = [...grouped.values()].flatMap((rows) => {
    const eligible = rows
      .map((row) => ({ row, lag: filingLagDays(row) }))
      .filter((item) => item.lag >= 0 && item.lag <= 180)
      .sort((left, right) => {
        if (left.lag !== right.lag) return left.lag - right.lag;
        return String(periodEnd(right.row) ?? "").localeCompare(String(periodEnd(left.row) ?? ""));
      });
    return eligible[0] ? [eligible[0].row] : [];
  }).sort((left, right) => `${left.filingDate}:${left.ticker}`.localeCompare(`${right.filingDate}:${right.ticker}`));
  return {
    cases,
    errors: source.errors,
    cleaning: {
      rawCases: source.cases.length,
      cleanCases: cases.length,
      removedDuplicateOrBackwardLookingCases: source.cases.length - cases.length,
      rule: "One latest reported quarter per SEC accession; filing lag must be between 0 and 180 days.",
    },
  };
}
