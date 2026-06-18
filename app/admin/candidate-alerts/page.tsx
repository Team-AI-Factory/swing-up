import Link from "next/link";
import { prisma } from "@/lib/db/client";

export const dynamic = "force-dynamic";

const NOT_AVAILABLE = "Not available yet";
const SAFE_ACTIONS = ["Buy Candidate", "Speculative Buy Candidate", "Watch", "Sell Review", "Avoid", "No Action"] as const;
const SAFE_STATUSES = ["draft", "review", "approved", "rejected", "published"] as const;
const MOCK_PREVIEW_ENABLED = process.env.CANDIDATE_ALERTS_MOCK_PREVIEW === "true";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;
type SafeAction = (typeof SAFE_ACTIONS)[number];
type CandidateStatus = (typeof SAFE_STATUSES)[number];

type CandidateAlert = {
  id: string;
  action: SafeAction;
  ticker: string;
  company: string;
  eventSummary: string;
  sourceCount: number | null;
  profitPotentialScore: number | null;
  evidenceConfidenceScore: number | null;
  riskLevel: string;
  historicalPatternMatch: string;
  marketSentimentImpact: string;
  marketSentimentMood: string;
  pricedInCheck: string;
  status: CandidateStatus;
  createdTime: string;
  warningBadges: string[];
  isMockPreview?: boolean;
};

function firstParam(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function cleanFilter(value: string | string[] | undefined) {
  return firstParam(value)?.trim() ?? "";
}

function formatDate(value: Date | null | undefined) {
  if (!value) return NOT_AVAILABLE;
  return new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(value);
}

function safeAction(value: string): SafeAction {
  return SAFE_ACTIONS.find((action) => action.toLowerCase() === value.toLowerCase()) ?? "Watch";
}

function safeStatus(value: string): CandidateStatus {
  const normalized = value.toLowerCase();
  return SAFE_STATUSES.find((status) => status === normalized) ?? "draft";
}

function displayValue(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return NOT_AVAILABLE;
  return String(value);
}

function scoreInRange(score: number | null, range: string) {
  if (!range) return true;
  if (score === null) return range === "missing";
  if (range === "0-39") return score <= 39;
  if (range === "40-69") return score >= 40 && score <= 69;
  if (range === "70-100") return score >= 70;
  return true;
}

function sourceCountMatches(sourceCount: number | null, minimum: string) {
  if (!minimum) return true;
  if (minimum === "missing") return sourceCount === null;
  const count = Number(minimum);
  return Number.isFinite(count) && sourceCount !== null ? sourceCount >= count : true;
}

function contains(value: string, expected: string) {
  return !expected || value.toLowerCase().includes(expected.toLowerCase());
}

async function getCandidateAlerts(): Promise<CandidateAlert[]> {
  try {
    const alerts = await prisma.alert.findMany({
      orderBy: { id: "desc" },
      take: 50,
      include: {
        sources: { select: { id: true } },
        scores: { orderBy: { createdAt: "desc" }, take: 1 },
        patternMatches: { orderBy: { id: "desc" }, take: 1, select: { confidenceLabel: true, matchReason: true, matchScore: true, similarity: true } },
      },
    });

    return alerts.map((alert) => {
      const latestScore = alert.scores[0];
      const latestPattern = alert.patternMatches[0];
      const warningBadges = [
        latestScore ? null : "Scores pending",
        alert.sources.length ? null : "Sources pending",
        latestPattern ? null : "Pattern check pending",
        alert.status.toLowerCase() === "published" ? "Published record — read-only" : null,
      ].filter((badge): badge is string => Boolean(badge));

      return {
        id: alert.id,
        action: safeAction(alert.action),
        ticker: alert.ticker || NOT_AVAILABLE,
        company: alert.company || NOT_AVAILABLE,
        eventSummary: alert.event || NOT_AVAILABLE,
        sourceCount: alert.sources.length,
        profitPotentialScore: latestScore?.profitPotential ?? null,
        evidenceConfidenceScore: latestScore?.evidenceConfidence ?? null,
        riskLevel: latestScore?.riskLevel ?? NOT_AVAILABLE,
        historicalPatternMatch: latestPattern
          ? `${latestPattern.confidenceLabel ?? "Match"}${latestPattern.matchReason ? ` — ${latestPattern.matchReason}` : ""}`
          : NOT_AVAILABLE,
        marketSentimentImpact: NOT_AVAILABLE,
        marketSentimentMood: NOT_AVAILABLE,
        pricedInCheck: latestScore?.pricedInCheck ?? NOT_AVAILABLE,
        status: safeStatus(alert.status),
        createdTime: formatDate(latestScore?.createdAt ?? null),
        warningBadges,
      };
    });
  } catch {
    return [];
  }
}

function mockPreviewAlerts(): CandidateAlert[] {
  if (!MOCK_PREVIEW_ENABLED) return [];
  return [
    {
      id: "mock-preview-shop",
      action: "Watch",
      ticker: "SHOP",
      company: "Shopify",
      eventSummary: "Mock preview: margin commentary and source receipts are awaiting operator review.",
      sourceCount: 2,
      profitPotentialScore: 68,
      evidenceConfidenceScore: 62,
      riskLevel: "medium",
      historicalPatternMatch: "Moderate similarity to prior margin reset events",
      marketSentimentImpact: "Neutral market mood in mock preview",
      marketSentimentMood: "neutral",
      pricedInCheck: "Partially priced in",
      status: "review",
      createdTime: "Mock preview data",
      warningBadges: ["Mock preview data", "Do not publish"],
      isMockPreview: true,
    },
  ];
}

export default async function CandidateAlertsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const status = cleanFilter(params.status);
  const ticker = cleanFilter(params.ticker);
  const action = cleanFilter(params.action);
  const risk = cleanFilter(params.risk);
  const scoreRange = cleanFilter(params.scoreRange);
  const sourceCount = cleanFilter(params.sourceCount);
  const mood = cleanFilter(params.mood);

  const existingAlerts = await getCandidateAlerts();
  const allAlerts = existingAlerts.length ? existingAlerts : mockPreviewAlerts();
  const alerts = allAlerts.filter((alert) => {
    if (!contains(alert.status, status)) return false;
    if (!contains(`${alert.ticker} ${alert.company}`, ticker)) return false;
    if (!contains(alert.action, action)) return false;
    if (!contains(alert.riskLevel, risk)) return false;
    if (!scoreInRange(alert.profitPotentialScore, scoreRange)) return false;
    if (!sourceCountMatches(alert.sourceCount, sourceCount)) return false;
    if (!contains(alert.marketSentimentMood, mood)) return false;
    return true;
  });

  return (
    <div className="page">
      <div className="raw-signal-header">
        <div>
          <div className="eyebrow">Admin / Candidate alerts</div>
          <h1>Candidate Alerts Review</h1>
          <p>Read-only review for candidate alerts before any publication workflow is added.</p>
        </div>
        <div className="button-row">
          <Link className="button" href="/admin">Back to admin</Link>
          <button className="button primary" type="button" disabled>Approve later</button>
          <button className="button" type="button" disabled>Reject later</button>
        </div>
      </div>

      <section className="card raw-signal-filter-card">
        <h2>Filters</h2>
        <form className="raw-signal-filters">
          <select className="input" name="status" defaultValue={status} aria-label="Status">
            <option value="">All statuses</option>
            {SAFE_STATUSES.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <input className="input" name="ticker" placeholder="Ticker or company" defaultValue={ticker} />
          <select className="input" name="action" defaultValue={action} aria-label="Action">
            <option value="">All actions</option>
            {SAFE_ACTIONS.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
          <input className="input" name="risk" placeholder="Risk level" defaultValue={risk} />
          <select className="input" name="scoreRange" defaultValue={scoreRange} aria-label="Score range">
            <option value="">All score ranges</option>
            <option value="0-39">0-39</option>
            <option value="40-69">40-69</option>
            <option value="70-100">70-100</option>
            <option value="missing">Missing scores</option>
          </select>
          <select className="input" name="sourceCount" defaultValue={sourceCount} aria-label="Source count">
            <option value="">Any source count</option>
            <option value="1">At least 1 source</option>
            <option value="2">At least 2 sources</option>
            <option value="3">At least 3 sources</option>
            <option value="missing">Missing sources</option>
          </select>
          <input className="input" name="mood" placeholder="Market sentiment mood" defaultValue={mood} />
          <button className="button primary" type="submit">Apply filters</button>
          <Link className="button" href="/admin/candidate-alerts">Reset</Link>
        </form>
      </section>

      <section className="card raw-signal-card trust-section">
        <div className="raw-signal-header">
          <div>
            <h2>Review queue</h2>
            <p>{alerts.length ? `${alerts.length} visible of ${allAlerts.length} candidate alert records.` : "No candidate alerts match the current view."}</p>
          </div>
          <span className="badge">Read-only</span>
        </div>

        {alerts.length === 0 ? (
          <div className="raw-signal-empty">
            <span className="badge">Empty state</span>
            <h3>No candidate alerts to review yet</h3>
            <p>Candidate alerts will appear here after upstream scoring and review data exists. Missing fields will show “Not available yet”.</p>
          </div>
        ) : (
          <div className="raw-signal-review-list">
            {alerts.map((alert) => (
              <article className="raw-signal-review-item" key={alert.id}>
                <div className="raw-signal-review-topline">
                  <span className={`badge status-${alert.status}`}>{alert.status}</span>
                  <span className="badge">{alert.action}</span>
                  {alert.isMockPreview ? <span className="badge">Mock preview data</span> : null}
                </div>
                <h3>{alert.ticker} / {alert.company}</h3>
                <p>{alert.eventSummary}</p>
                <div className="raw-signal-fields">
                  <div><span>Source count</span><strong>{displayValue(alert.sourceCount)}</strong></div>
                  <div><span>Profit Potential Score</span><strong>{displayValue(alert.profitPotentialScore)}</strong></div>
                  <div><span>Evidence Confidence Score</span><strong>{displayValue(alert.evidenceConfidenceScore)}</strong></div>
                  <div><span>Risk Level</span><strong>{displayValue(alert.riskLevel)}</strong></div>
                  <div><span>Historical Pattern Match</span><strong>{displayValue(alert.historicalPatternMatch)}</strong></div>
                  <div><span>Market Sentiment Impact</span><strong>{displayValue(alert.marketSentimentImpact)}</strong></div>
                  <div><span>Market Sentiment Mood</span><strong>{displayValue(alert.marketSentimentMood)}</strong></div>
                  <div><span>Priced-In Check</span><strong>{displayValue(alert.pricedInCheck)}</strong></div>
                  <div><span>Created time</span><strong>{displayValue(alert.createdTime)}</strong></div>
                  <div><span>Warning badges</span><strong>{alert.warningBadges.length ? alert.warningBadges.join(", ") : NOT_AVAILABLE}</strong></div>
                </div>
                <div className="button-row">
                  <button className="button primary" type="button" disabled>Approve placeholder</button>
                  <button className="button" type="button" disabled>Reject placeholder</button>
                  <button className="button" type="button" disabled>Publish disabled</button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
