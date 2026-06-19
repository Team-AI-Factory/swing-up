const readinessSections = [
  {
    title: "Product foundation",
    status: "in progress",
    why: "A public launch needs the core research experience, language, navigation, and trust pages to feel coherent before any user relies on Swing Up.",
    todo: "Confirm the public user journey, remove confusing preview-only paths, finish copy review, and verify every core page explains that Swing Up is research support only.",
    healthcheck: "Future placeholder: public route smoke test and copy safety review.",
  },
  {
    title: "Source health readiness",
    status: "in progress",
    why: "Signal quality depends on knowing whether sources are reachable, fresh, licensed for the intended use, and clearly labeled when degraded.",
    todo: "Finish source uptime policies, freshness thresholds, fallback rules, and user-facing source health labels.",
    healthcheck: "Future placeholder: source status dashboard and provider freshness check.",
  },
  {
    title: "Raw signal readiness",
    status: "in progress",
    why: "Raw market inputs need deduping, noise control, receipt capture, and safe filtering before they can support any alert workflow.",
    todo: "Validate ingestion quality, duplicate handling, ticker mapping, receipt normalization, and false-positive review paths.",
    healthcheck: "Future placeholder: raw signal volume, duplicate rate, and receipt coverage check.",
  },
  {
    title: "Scoring readiness",
    status: "not started",
    why: "Scores must be explainable, conservative, and framed as research estimates instead of promises or personalized recommendations.",
    todo: "Lock score definitions, test edge cases, document score limits, and add review gates for high-risk or low-evidence signals.",
    healthcheck: "Future placeholder: scoring regression and safe wording audit.",
  },
  {
    title: "Historical pattern readiness",
    status: "in progress",
    why: "Historical context helps users compare current setups with prior examples without implying that past outcomes predict future returns.",
    todo: "Expand historical samples, verify outcome labels, document selection rules, and keep pattern language non-promissory.",
    healthcheck: "Future placeholder: pattern coverage and outcome-label integrity check.",
  },
  {
    title: "AI committee readiness",
    status: "not started",
    why: "Any AI-assisted review should challenge weak evidence, summarize uncertainty, and avoid turning research into trading instructions.",
    todo: "Define committee roles, refusal rules, confidence language, audit logs, and human review expectations before public exposure.",
    healthcheck: "Future placeholder: AI review queue, prompt safety, and hallucination spot-check.",
  },
  {
    title: "Public ledger readiness",
    status: "in progress",
    why: "A public ledger keeps alerts accountable by preserving what was shown, when it was shown, and what evidence supported it.",
    todo: "Finalize ledger fields, immutable receipt display, outcome timing, correction policy, and public explanation copy.",
    healthcheck: "Future placeholder: ledger entry completeness and outcome tracking check.",
  },
  {
    title: "Payment readiness",
    status: "blocked",
    why: "Payments should only arrive after the product, safety language, support expectations, and data licensing are ready for real customers.",
    todo: "Choose billing flow, define plans, confirm vendor licensing, add refund/support policy, and complete compliance review.",
    healthcheck: "Future placeholder: billing sandbox and entitlement smoke test.",
  },
  {
    title: "Notification readiness",
    status: "not started",
    why: "Notifications can create urgency, so they need conservative language, quiet defaults, unsubscribe controls, and clear evidence links.",
    todo: "Design notification templates, rate limits, delivery preferences, unsubscribe flows, and alert-safety copy.",
    healthcheck: "Future placeholder: notification template audit and delivery preference test.",
  },
  {
    title: "Compliance/safe wording readiness",
    status: "in progress",
    why: "Swing Up must consistently present market research and decision-support, not financial advice, guaranteed returns, or personalized instructions.",
    todo: "Review all launch copy, disclaimers, score labels, examples, marketing pages, and onboarding language before public launch.",
    healthcheck: "Future placeholder: restricted-phrase scan and disclaimer placement review.",
  },
  {
    title: "User onboarding readiness",
    status: "in progress",
    why: "New users need to understand what alerts, receipts, scores, risks, and limitations mean before they interpret any signal.",
    todo: "Finalize onboarding sequence, glossary links, examples, risk explanations, and first-session education prompts.",
    healthcheck: "Future placeholder: onboarding completion and comprehension checklist.",
  },
  {
    title: "Remaining launch blockers",
    status: "blocked",
    why: "A launch should wait until core trust, reliability, safety, payments, support, and operational workflows are clear enough to maintain.",
    todo: "Resolve production data readiness, legal/compliance review, payment policy, support process, monitoring, incident response, and final go/no-go ownership.",
    healthcheck: "Future placeholder: launch-blocker checklist with owner, status, and evidence.",
  },
];

const statusClassNames: Record<string, string> = {
  "not started": "outcome-unknown",
  "in progress": "status-stubbed",
  ready: "status-connected",
  blocked: "status-blocked",
};

export default function LaunchReadinessPage() {
  return (
    <div className="page">
      <section className="hero trust-hero">
        <div>
          <div className="eyebrow">Static preview data</div>
          <h1>Launch readiness preview</h1>
          <p>
            A standalone planning page that summarizes what Swing Up still needs before a real public launch.
            This page is informational only and does not run automated checks.
          </p>
        </div>
        <div className="card risk-callout">
          <span className="badge">Preview only</span>
          <h2>Not a launch approval</h2>
          <p>
            Status labels below are static placeholders for planning. Swing Up should not be considered
            launch-ready from this page unless a future launch process explicitly marks it ready.
          </p>
        </div>
      </section>

      <section className="grid two trust-section" aria-label="Launch readiness preview sections">
        {readinessSections.map((section) => (
          <article className="card" key={section.title}>
            <span className={`badge ${statusClassNames[section.status]}`}>Static status: {section.status}</span>
            <h3>{section.title}</h3>
            <div className="metric">
              <span>Why it matters</span>
              <strong>{section.why}</strong>
            </div>
            <div className="metric">
              <span>What still needs to be done</span>
              <strong>{section.todo}</strong>
            </div>
            <div className="metric">
              <span>Related healthcheck placeholder</span>
              <strong>{section.healthcheck}</strong>
            </div>
          </article>
        ))}
      </section>
    </div>
  );
}
