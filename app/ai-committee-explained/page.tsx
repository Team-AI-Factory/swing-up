const reviewRoles = [
  {
    name: "Filing Agent",
    checks: "Reads filings and official company documents for facts that can be traced back to source material.",
  },
  {
    name: "Accountant Agent",
    checks: "Looks for basic financial meaning, accounting quality, margins, cash flow, debt, and balance-sheet pressure.",
  },
  {
    name: "DCF Agent",
    checks: "Tests whether valuation assumptions are reasonable and whether the story depends on aggressive future expectations.",
  },
  {
    name: "Market Agent",
    checks: "Compares the alert candidate with price action, liquidity, volume, and whether the market may have already reacted.",
  },
  {
    name: "News Agent",
    checks: "Reviews current public news and separates fresh evidence from repeated coverage, commentary, or stale headlines.",
  },
  {
    name: "Macro Agent",
    checks: "Considers rates, inflation, currency, commodity, and broad risk conditions that could change how investors respond.",
  },
  {
    name: "Industry Agent",
    checks: "Compares the company or theme with peers, sector demand, regulation, supply chains, and competitive pressure.",
  },
  {
    name: "Knock-On Agent",
    checks: "Asks who else could be affected, including suppliers, customers, competitors, adjacent sectors, and second-order impacts.",
  },
  {
    name: "Risk Agent",
    checks: "Lists what could break the thesis, delay the outcome, reduce the impact, or make the setup too uncertain.",
  },
  {
    name: "Skeptic Agent",
    checks: "Challenges the strongest claim, looks for missing evidence, and asks whether the candidate is weaker than it first appears.",
  },
  {
    name: "Compliance Agent",
    checks: "Reviews wording for balanced language, missing caveats, unsupported claims, and anything that sounds like personal advice.",
  },
  {
    name: "Explainer Agent",
    checks: "Turns the review into plain English so readers can understand the evidence, uncertainty, and limits.",
  },
  {
    name: "Final Judge",
    checks: "Makes the final publish-or-block decision after the role reviews, evidence checks, risk notes, and wording checks are complete.",
  },
];

const principles = [
  "The AI Committee is a review process, not a guarantee machine.",
  "No paid or user-facing alert should be published until final review approves it.",
  "AI review can reduce weak alerts, but it cannot remove market risk.",
];

export default function AiCommitteeExplainedPage() {
  return (
    <div className="page">
      <section className="hero trust-hero">
        <div>
          <div className="eyebrow">AI Committee explained</div>
          <h1>A calm review process before an alert reaches readers</h1>
          <p>
            Swing Up uses an AI Committee concept to review alert candidates from different angles before publication. The goal is simple: slow down weak ideas, keep receipts attached, and make risk visible.
          </p>
        </div>
        <article className="card risk-callout">
          <span className="badge">Important</span>
          <h2 style={{ marginTop: 14 }}>Review is not certainty</h2>
          <p>{principles[0]}</p>
          <p>{principles[2]}</p>
        </article>
      </section>

      <section className="grid two trust-section">
        <article className="card">
          <span className="badge">What it is</span>
          <h2 style={{ marginTop: 14 }}>What the AI Committee is</h2>
          <p>
            The AI Committee is a structured review workflow. Instead of asking one reviewer to say yes or no, Swing Up breaks the review into roles that each examine a different part of the evidence.
          </p>
          <p>
            Each role is meant to add friction: verify the source, test the logic, surface risks, challenge the conclusion, and make sure the final wording stays careful.
          </p>
        </article>

        <article className="card">
          <span className="badge">Why roles</span>
          <h2 style={{ marginTop: 14 }}>Why Swing Up uses multiple review roles</h2>
          <p>
            Markets are messy. A filing may look positive while the sector is weak. A headline may sound important while the price already reflects it. Multiple roles help the review avoid depending on a single lens.
          </p>
          <p>
            Separate roles also make the review easier to audit because each question has a clear owner: evidence, valuation, market context, risk, compliance, explanation, and final approval.
          </p>
        </article>
      </section>

      <section className="trust-section">
        <div className="eyebrow">Role map</div>
        <h2>What each review role checks</h2>
        <div className="grid two" style={{ marginTop: 18 }}>
          {reviewRoles.map((role) => (
            <article className="card" key={role.name}>
              <span className="badge">Review role</span>
              <h3 style={{ marginTop: 14 }}>{role.name}</h3>
              <p>{role.checks}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="grid two trust-section">
        <article className="card risk-callout">
          <span className="badge">Challenge</span>
          <h2 style={{ marginTop: 14 }}>Why the Skeptic Agent matters</h2>
          <p>
            The Skeptic Agent is there to push back. It asks whether the alert candidate is too optimistic, too thinly sourced, too late, too obvious, or missing a stronger counterpoint.
          </p>
          <p>
            This matters because a useful review should not only explain why something could work. It should also explain why it could fail.
          </p>
        </article>

        <article className="card risk-callout">
          <span className="badge">Wording</span>
          <h2 style={{ marginTop: 14 }}>Why the Compliance Agent matters</h2>
          <p>
            The Compliance Agent checks whether language is balanced, clear, and supported by evidence. It helps prevent hype, unsupported claims, and wording that could confuse research with personal investment advice.
          </p>
          <p>
            Careful wording protects readers by keeping uncertainty visible instead of hiding it behind confident-sounding language.
          </p>
        </article>
      </section>

      <section className="grid two trust-section">
        <article className="card">
          <span className="badge">Final gate</span>
          <h2 style={{ marginTop: 14 }}>Why the Final Judge can block publication</h2>
          <p>{principles[1]}</p>
          <p>
            The Final Judge can block an alert when receipts are weak, risks are missing, the review is incomplete, the wording is not balanced, or the evidence does not support publication.
          </p>
        </article>

        <article className="card">
          <span className="badge">Limits</span>
          <h2 style={{ marginTop: 14 }}>Why AI review does not promise investment results</h2>
          <p>
            Even a careful review cannot know future prices. New information, market mood, liquidity, earnings surprises, policy changes, and investor behavior can all overwhelm the original setup.
          </p>
          <p>
            AI review can improve discipline, but readers still need to make their own decisions and understand that outcomes remain uncertain.
          </p>
        </article>
      </section>

      <section className="trust-section">
        <article className="card">
          <span className="badge">Receipts and risk</span>
          <h2 style={{ marginTop: 14 }}>Why receipts and risk still matter</h2>
          <p>
            Receipts let readers inspect the evidence instead of relying on a summary alone. Risk notes show what could be wrong, delayed, already priced in, or less important than it appears.
          </p>
          <div className="grid two" style={{ marginTop: 18 }}>
            {principles.map((principle) => (
              <div className="metric" key={principle}>
                <span>Principle</span>
                <strong>{principle}</strong>
              </div>
            ))}
          </div>
        </article>
      </section>
    </div>
  );
}
