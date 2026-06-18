import Link from "next/link";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/client";
import { mockHistoricalEvents } from "@/lib/historical-events";
import styles from "./patterns.module.css";

export const dynamic = "force-dynamic";

const NOT_AVAILABLE = "Not available yet";
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

type EventRow = {
  id: string;
  ticker: string;
  company: string;
  eventDate: string;
  eventType: string;
  sector: string;
  patternTags: string[];
  outcome: string;
  maxGain: string;
  maxDrawdown: string;
  sourceReceiptsCount: number | null;
  patternStrength: string;
  mockPreview?: boolean;
};

type MatchPreview = {
  id: string;
  ticker: string;
  similarityScore: string;
  matchedHistoricalEvent: string;
  explanation: string;
  features: string[];
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function clean(value: string | string[] | undefined) {
  return firstParam(value)?.trim() ?? "";
}

function text(value: unknown, fallback = NOT_AVAILABLE) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function jsonStrings(value: unknown) {
  return Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean) : [];
}

function receiptCount(value: unknown) {
  return Array.isArray(value) ? value.length : null;
}

function formatDate(value: unknown) {
  if (!value) return NOT_AVAILABLE;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return NOT_AVAILABLE;
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" }).format(date);
}

function percent(value: unknown) {
  if (value === null || value === undefined || value === "") return NOT_AVAILABLE;
  const numeric = value instanceof Prisma.Decimal ? value.toNumber() : Number(value);
  if (!Number.isFinite(numeric)) return NOT_AVAILABLE;
  return `${(numeric * 100).toFixed(1)}%`;
}

function score(value: unknown) {
  if (value === null || value === undefined || value === "") return NOT_AVAILABLE;
  const numeric = value instanceof Prisma.Decimal ? value.toNumber() : Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(0) : NOT_AVAILABLE;
}

async function getEvents() {
  try {
    const events = await prisma.historicalEvent.findMany({
      orderBy: [{ eventDate: "desc" }, { createdAt: "desc" }],
      take: 100,
      include: { patternMatches: { select: { matchScore: true, similarity: true }, orderBy: { createdAt: "desc" }, take: 5 } },
    });

    return events.map<EventRow>((event) => {
      const best = event.patternMatches.reduce<number | null>((current, match) => {
        const raw = match.matchScore ?? match.similarity;
        const numeric = raw instanceof Prisma.Decimal ? raw.toNumber() : Number(raw);
        return Number.isFinite(numeric) ? Math.max(current ?? numeric, numeric) : current;
      }, null);

      return {
        id: event.id,
        ticker: text(event.ticker),
        company: text(event.companyName),
        eventDate: formatDate(event.eventDate),
        eventType: text(event.eventType),
        sector: text(event.sector),
        patternTags: jsonStrings(event.patternTags),
        outcome: text(event.outcomeLabel),
        maxGain: percent(event.maxGain),
        maxDrawdown: percent(event.maxDrawdown),
        sourceReceiptsCount: receiptCount(event.sourceReceipts),
        patternStrength: best === null ? NOT_AVAILABLE : best.toFixed(0),
      };
    });
  } catch {
    return [];
  }
}

async function getLatestMatches() {
  try {
    const matches = await prisma.patternMatch.findMany({
      orderBy: { createdAt: "desc" },
      take: 3,
      include: { historicalEvent: { select: { ticker: true, title: true, eventType: true } } },
    });
    return matches.map<MatchPreview>((match) => ({
      id: match.id,
      ticker: text(match.ticker ?? match.historicalEvent?.ticker),
      similarityScore: score(match.matchScore ?? match.similarity),
      matchedHistoricalEvent: text(match.historicalEvent?.title ?? match.historicalEvent?.eventType),
      explanation: text(match.matchReason, "Rule-based similarity preview from stored pattern match data."),
      features: jsonStrings(match.matchedFeatures),
    }));
  } catch {
    return [];
  }
}

function toMockRows(): EventRow[] {
  return mockHistoricalEvents.map((event, index) => ({
    id: `mock-${index}`,
    ticker: text(event.ticker),
    company: text(event.company),
    eventDate: formatDate(event.eventDate),
    eventType: text(event.eventType),
    sector: text(event.sector),
    patternTags: jsonStrings(event.patternTags),
    outcome: text(event.outcome),
    maxGain: percent(event.maxGain),
    maxDrawdown: percent(event.maxDrawdown),
    sourceReceiptsCount: receiptCount(event.sourceReceipts),
    patternStrength: NOT_AVAILABLE,
    mockPreview: true,
  }));
}

function applyFilters(events: EventRow[], filters: Record<string, string>) {
  return events.filter((event) => {
    const hasReceipt = event.sourceReceiptsCount !== null && event.sourceReceiptsCount > 0;
    return (!filters.ticker || event.ticker.toLowerCase().includes(filters.ticker.toLowerCase()))
      && (!filters.sector || event.sector.toLowerCase().includes(filters.sector.toLowerCase()))
      && (!filters.eventType || event.eventType === filters.eventType)
      && (!filters.outcome || event.outcome === filters.outcome)
      && (!filters.patternTag || event.patternTags.some((tag) => tag.toLowerCase().includes(filters.patternTag.toLowerCase())))
      && (!filters.receipts || (filters.receipts === "yes" ? hasReceipt : !hasReceipt));
  });
}

function unique(values: string[]) {
  return [...new Set(values.filter((value) => value && value !== NOT_AVAILABLE))].sort();
}

export default async function HistoricalPatternsAdminPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const storedEvents = await getEvents();
  const usingMockPreview = storedEvents.length === 0;
  const allEvents = usingMockPreview ? toMockRows() : storedEvents;
  const filters = {
    ticker: clean(params.ticker),
    sector: clean(params.sector),
    eventType: clean(params.eventType),
    outcome: clean(params.outcome),
    patternTag: clean(params.patternTag),
    receipts: clean(params.receipts),
  };
  const events = applyFilters(allEvents, filters);
  const latestMatches = await getLatestMatches();
  const eventTypes = unique(allEvents.map((event) => event.eventType));
  const outcomes = unique(allEvents.map((event) => event.outcome));

  return (
    <div className={`page ${styles.shell}`}>
      <div className={styles.header}>
        <div>
          <div className="eyebrow">Admin / Historical Patterns</div>
          <h1>Historical patterns</h1>
          <p>Inspect stored historical events and read-only pattern evidence. This page does not approve alerts or change scoring.</p>
        </div>
        <div className={styles.actions}>
          <Link className="button" href="/api/historical-events?limit=25">Historical JSON</Link>
          <Link className="button" href="/api/pattern-matches?limit=10">Pattern JSON</Link>
          <Link className="button" href="/admin">Back to admin</Link>
        </div>
      </div>

      <section className="card trust-section risk-callout">
        <h2>Evidence-first review</h2>
        <p>Historical patterns are context for research only. Missing fields show as “Not available yet,” and mock preview rows are clearly labelled.</p>
      </section>

      {latestMatches.length > 0 ? (
        <section className={`card trust-section ${styles.preview}`}>
          <div>
            <h2>Latest pattern match preview</h2>
            <p>Read-only preview from the pattern matching API store when available.</p>
          </div>
          {latestMatches.map((match) => (
            <div className={styles.previewItem} key={match.id}>
              <strong>{match.ticker}</strong> · Similarity score: {match.similarityScore}
              <p>Matched historical event: {match.matchedHistoricalEvent}</p>
              <p>{match.explanation}</p>
              <div className={styles.tags}>{match.features.length ? match.features.map((feature) => <span className={styles.tag} key={feature}>{feature}</span>) : <span className={styles.tag}>{NOT_AVAILABLE}</span>}</div>
            </div>
          ))}
        </section>
      ) : null}

      <section className="card trust-section">
        <h2>Filters</h2>
        <form className={styles.filters}>
          <label>Ticker<input name="ticker" defaultValue={filters.ticker} placeholder="NVDA" /></label>
          <label>Sector<input name="sector" defaultValue={filters.sector} placeholder="Technology" /></label>
          <label>Event type<select name="eventType" defaultValue={filters.eventType}><option value="">Any</option>{eventTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
          <label>Outcome<select name="outcome" defaultValue={filters.outcome}><option value="">Any</option>{outcomes.map((outcome) => <option key={outcome} value={outcome}>{outcome}</option>)}</select></label>
          <label>Pattern tag<input name="patternTag" defaultValue={filters.patternTag} placeholder="guidance" /></label>
          <label>Source receipt<select name="receipts" defaultValue={filters.receipts}><option value="">Any</option><option value="yes">Available</option><option value="no">Not available yet</option></select></label>
          <button className="button primary" type="submit">Apply filters</button>
          <Link className="button" href="/admin/patterns">Clear</Link>
        </form>
      </section>

      <section className="card trust-section">
        <h2>Historical events</h2>
        <p>{usingMockPreview ? "Showing clearly labelled mock preview data because no stored historical events are available in this environment." : `${events.length} stored historical events shown.`}</p>
        {events.length === 0 ? <div className={styles.empty}>No historical events match these filters. Empty database and missing fields are safe on this page.</div> : null}
        <div className={styles.grid}>
          {events.map((event) => (
            <article className={styles.eventCard} key={event.id}>
              <div className={styles.eventTop}>
                <div><div className={styles.ticker}>{event.ticker}</div><div className={styles.company}>{event.company}</div></div>
                {event.mockPreview ? <span className={styles.mockTag}>Mock preview data</span> : null}
              </div>
              <div className={styles.tags}>{event.patternTags.length ? event.patternTags.map((tag) => <span className={styles.tag} key={tag}>{tag}</span>) : <span className={styles.tag}>{NOT_AVAILABLE}</span>}</div>
              <div className={styles.metaGrid}>
                <div className={styles.metric}><div className={styles.label}>Event date</div><div className={styles.value}>{event.eventDate}</div></div>
                <div className={styles.metric}><div className={styles.label}>Event type</div><div className={styles.value}>{event.eventType}</div></div>
                <div className={styles.metric}><div className={styles.label}>Sector</div><div className={styles.value}>{event.sector}</div></div>
                <div className={styles.metric}><div className={styles.label}>Outcome</div><div className={styles.value}>{event.outcome}</div></div>
                <div className={styles.metric}><div className={styles.label}>Max gain</div><div className={styles.value}>{event.maxGain}</div></div>
                <div className={styles.metric}><div className={styles.label}>Max drawdown</div><div className={styles.value}>{event.maxDrawdown}</div></div>
                <div className={styles.metric}><div className={styles.label}>Source receipts</div><div className={styles.value}>{event.sourceReceiptsCount ?? NOT_AVAILABLE}</div></div>
                <div className={styles.metric}><div className={styles.label}>Pattern strength</div><div className={styles.value}>{event.patternStrength}</div></div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
