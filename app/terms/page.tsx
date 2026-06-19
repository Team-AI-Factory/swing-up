const requiredTermsDisclosure =
  "Swing Up provides market research and decision-support information. It does not guarantee returns. Investing involves risk, including possible loss of capital. Users are responsible for their own decisions.";

const termSections = [
  {
    eyebrow: "Research boundary",
    title: "Research tool, not financial adviser",
    body:
      "Swing Up helps organize market research, evidence, alerts, and decision-support context. It does not provide personalized investment advice, portfolio management, tax guidance, legal guidance, or instructions to trade.",
  },
  {
    eyebrow: "Outcome limits",
    title: "No guaranteed returns",
    body:
      "Research signals, scores, alerts, examples, and educational content are informational only. They should not be interpreted as promises, predictions, or assurances about future performance.",
  },
  {
    eyebrow: "Your judgment",
    title: "User responsibility",
    body:
      "Users are responsible for reviewing information, checking sources, considering personal risk tolerance, and deciding whether any market idea fits their own circumstances before taking action.",
  },
  {
    eyebrow: "Risk notice",
    title: "Market risk",
    body:
      "Markets can move quickly because of news, earnings, liquidity, volatility, macro events, company-specific developments, and changing investor sentiment. Any investment decision can lose money.",
  },
  {
    eyebrow: "Billing placeholder",
    title: "Paid subscription terms placeholder",
    body:
      "If Swing Up offers paid subscriptions, the applicable pricing, renewal, cancellation, refund, trial, and account-access terms will be presented before purchase and incorporated into these terms when published.",
  },
  {
    eyebrow: "Use standard",
    title: "Acceptable use",
    body:
      "Users may use Swing Up for lawful personal research and evaluation. Users may not interfere with the service, attempt unauthorized access, scrape at harmful volumes, or use the service to violate laws or third-party rights.",
  },
  {
    eyebrow: "Alert integrity",
    title: "No misuse of alerts",
    body:
      "Alerts and research summaries should not be republished in misleading ways, presented as personalized advice, stripped of risk context, or used to pressure others into making financial decisions.",
  },
  {
    eyebrow: "Legal placeholder",
    title: "Limitation of liability placeholder",
    body:
      "To the fullest extent permitted by applicable law, Swing Up's liability for use of the service will be limited. Detailed limitation, warranty, and damages language will be added as the formal legal terms are completed.",
  },
  {
    eyebrow: "Updates",
    title: "Changes to terms",
    body:
      "Swing Up may update these terms as the product, legal requirements, or operating practices change. Continued use after updated terms are posted means the updated terms apply going forward.",
  },
  {
    eyebrow: "Support placeholder",
    title: "Contact/support placeholder",
    body:
      "Questions about these terms, account access, or support can be directed to the published Swing Up support channel when it is available. A formal contact method will be added before public launch.",
  },
];

const quickNotes = [
  "Information only",
  "No personalized advice",
  "No return promises",
  "Risk remains with the user",
];

export default function TermsPage() {
  return (
    <div className="page">
      <section className="hero trust-hero">
        <div>
          <div className="eyebrow">Terms of Use</div>
          <h1>Clear boundaries for using Swing Up.</h1>
          <p>{requiredTermsDisclosure}</p>
        </div>
        <aside className="card risk-callout" aria-label="Terms summary">
          <span className="badge">Plain-language summary</span>
          <h2>Use Swing Up as research support.</h2>
          <p>
            These terms describe the product role as research-only support, user responsibility, market risk, acceptable use, and placeholders for future subscription and legal details.
          </p>
          <div className="disclaimer-list">
            {quickNotes.map((note) => (
              <div className="metric" key={note}>
                <span>{note}</span>
              </div>
            ))}
          </div>
        </aside>
      </section>

      <section className="trust-section card">
        <span className="badge">Required wording</span>
        <h2>Core disclosure</h2>
        <p>{requiredTermsDisclosure}</p>
      </section>

      <section className="grid two trust-section">
        {termSections.map((section) => (
          <article className="card" key={section.title}>
            <span className="badge">{section.eyebrow}</span>
            <h2>{section.title}</h2>
            <p>{section.body}</p>
          </article>
        ))}
      </section>
    </div>
  );
}
