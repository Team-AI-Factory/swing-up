const requiredDisclosure =
  "Swing Up provides market research and decision-support information. It does not guarantee returns. Investing involves risk, including possible loss of capital. Users are responsible for their own decisions.";

const faqs = [
  {
    question: "What is Swing Up?",
    answer:
      "Swing Up is a receipt-first market research app that helps users review market signals, evidence, risk context, scores, and tracked outcomes in one calm workflow.",
  },
  {
    question: "Is Swing Up financial advice?",
    answer:
      "No. Swing Up is not financial advice, portfolio guidance, or a personal recommendation service. It helps organize research, but each user remains responsible for deciding what fits their own goals, risk tolerance, and financial situation.",
  },
  {
    question: "What is a Buy Candidate?",
    answer:
      "A Buy Candidate is a research idea that has enough signal quality to be reviewed further. It is not an instruction to trade, and it should be checked against your own research before any decision is made.",
  },
  {
    question: "What is Profit Potential Score?",
    answer:
      "Profit Potential Score summarizes how attractive a setup may look after reviewing the signal, possible catalyst, price context, and upside factors. It is a research input, not a prediction of profit.",
  },
  {
    question: "What is Evidence Confidence Score?",
    answer:
      "Evidence Confidence Score describes the quality of the receipts behind an alert, including clarity, freshness, source relevance, and consistency across supporting information.",
  },
  {
    question: "What does Risk Level mean?",
    answer:
      "Risk Level highlights concerns that may affect the setup, such as volatility, weak evidence, crowded sentiment, unclear catalysts, or broader market stress. It helps users slow down and review the downside.",
  },
  {
    question: "What does Market Sentiment Impact mean?",
    answer:
      "Market Sentiment Impact describes whether the broader environment appears supportive, cautious, stressed, or mixed for the research idea. It gives context without removing uncertainty.",
  },
  {
    question: "Why does Swing Up show receipts?",
    answer:
      "Receipts make the research easier to inspect. They help users see what information supported an alert, question the evidence, and review the original context later.",
  },
  {
    question: "Why does Swing Up track alerts publicly?",
    answer:
      "Public tracking keeps the product accountable. Instead of only showing attractive examples, Swing Up can record what happened after alerts were published so users can review outcomes over time.",
  },
  {
    question: "Can alerts be wrong?",
    answer:
      "Yes. Alerts can be wrong, incomplete, early, late, or affected by new information. Markets are uncertain, and even well-supported research can lead to losses.",
  },
  {
    question: "What happens if a source is broken or rate-limited?",
    answer:
      "Swing Up is designed to treat source problems as part of the research context. A broken, delayed, unavailable, or rate-limited source can reduce confidence and should be shown clearly rather than hidden.",
  },
  {
    question: "Will Swing Up have Telegram/email alerts later?",
    answer:
      "Telegram and email alerts are planned as later notification options. The current public FAQ does not require live notification services or backend calls.",
  },
  {
    question: "Will Swing Up have paid plans later?",
    answer:
      "Paid plans may be added later as the product matures. Any paid plan should preserve clear risk language, receipt visibility, and accountable research boundaries.",
  },
];

const principles = ["Receipt-first", "Research support", "Public tracking", "Clear risk language"];

export default function FAQPage() {
  return (
    <div className="page">
      <section className="hero trust-hero">
        <div>
          <div className="eyebrow">Product FAQ</div>
          <h1>Clear answers before you use Swing Up.</h1>
          <p>
            Learn what Swing Up is, how its scores work, why receipts matter, and where the
            product draws the line between research support and personal investing decisions.
          </p>
        </div>
        <aside className="card risk-callout" aria-label="Important Swing Up disclosure">
          <span className="badge">Important</span>
          <h2>Proof, risk, and public tracking included.</h2>
          <p>{requiredDisclosure}</p>
        </aside>
      </section>

      <section className="grid four trust-section" aria-label="Swing Up principles">
        {principles.map((principle) => (
          <div className="card metric" key={principle}>
            <span>{principle}</span>
          </div>
        ))}
      </section>

      <section className="grid two trust-section" aria-label="Frequently asked questions">
        {faqs.map((faq) => (
          <article className="card" key={faq.question}>
            <span className="badge">FAQ</span>
            <h2>{faq.question}</h2>
            <p>{faq.answer}</p>
          </article>
        ))}
      </section>
    </div>
  );
}
