const thirtySecondPitch =
  "Swing Up is an AI market radar with receipts. It watches filings, news, prices, macro data, source reliability, and historical patterns, then turns serious signals into simple research alerts. Every serious alert must show why it matters, what can go wrong, and where the evidence came from.";

const demoSections = [
  {
    title: "2-minute product explanation",
    label: "Core story",
    items: [
      "Swing Up is built for people who want market context without chasing every headline or social post.",
      "The product gathers market signals, filters out weak or noisy inputs, and turns the strongest research moments into calm alert cards.",
      "Each alert is designed to answer three practical questions: what changed, why it may matter, and what evidence supports the signal.",
      "The experience is intentionally conservative: alerts support research, not automatic decisions or personalized financial advice.",
    ],
  },
  {
    title: "Demo flow",
    label: "Suggested order",
    items: [
      "Start with the pitch so the audience understands the promise: market radar plus receipts.",
      "Show an alert card next, because it is the simplest way to explain the user-facing value.",
      "Open the receipts or evidence area to show that the product is not asking users to trust a black box.",
      "Move to public tracking or ledger concepts to explain accountability over time.",
      "Close with the risk language so the demo ends with responsible expectations.",
    ],
  },
  {
    title: "What to show first",
    label: "Opening screen",
    items: [
      "Show a clean alert or example alert feed before showing deeper methodology pages.",
      "Explain that Swing Up is most useful when a user asks, ‘Is this signal worth researching further?’",
      "Point out the calm language, evidence links, and risk notes before discussing scores or sentiment.",
    ],
  },
  {
    title: "How to explain an alert card",
    label: "Alert anatomy",
    items: [
      "An alert card is a research summary, not a trading command.",
      "The headline should make the market event understandable without exaggerating certainty.",
      "The why-it-matters section explains the possible research angle in plain English.",
      "The risk section shows what could be wrong, incomplete, temporary, or already priced in.",
    ],
  },
  {
    title: "How to explain receipts",
    label: "Evidence trail",
    items: [
      "Receipts are the sources, timestamps, and evidence snippets that support a research alert.",
      "They help users inspect the signal instead of relying on a summary alone.",
      "A strong alert should make it easy to separate observed facts from interpretation.",
    ],
  },
  {
    title: "How to explain public tracking",
    label: "Accountability",
    items: [
      "Public tracking is the idea that serious alerts should remain reviewable after they are published.",
      "The goal is to preserve what Swing Up said at the time, what evidence was attached, and how the situation evolved later.",
      "This creates accountability without implying that every alert will be correct or profitable.",
    ],
  },
  {
    title: "How to explain market sentiment",
    label: "Context layer",
    items: [
      "Market sentiment is context about tone, attention, and pressure around an asset or market theme.",
      "It can help users understand whether a story is gaining attention, cooling off, or becoming crowded.",
      "Sentiment is not a prediction by itself and should be paired with receipts, risk notes, and price context.",
    ],
  },
  {
    title: "How to explain risk",
    label: "Guardrails",
    items: [
      "Risk is shown because every market signal can be wrong, late, noisy, overfit, or already reflected in price.",
      "Good demos should say uncertainty out loud instead of hiding it behind a score.",
      "Swing Up should help users slow down, inspect the evidence, and avoid treating alerts as certainty.",
    ],
  },
  {
    title: "Questions users may ask",
    label: "Discovery prompts",
    items: [
      "Where did this alert come from?",
      "Why is this signal important now?",
      "What evidence can I inspect myself?",
      "What could make this alert wrong?",
      "How often are alerts reviewed or tracked later?",
      "Is this financial advice or a recommendation?",
    ],
  },
  {
    title: "Safe answers to common questions",
    label: "Recommended wording",
    items: [
      "If asked whether to buy or sell: Swing Up does not tell users what trade to make; it helps organize research signals and evidence.",
      "If asked whether the AI is predicting the next move: the AI summarizes and challenges signals, but it does not know the future.",
      "If asked whether alerts are guaranteed: no market research alert is guaranteed, and every serious alert should include risk context.",
      "If asked what makes Swing Up different: the product combines signal detection with receipts, risk notes, and accountability language.",
    ],
  },
  {
    title: "What not to say",
    label: "Restricted language",
    items: [
      "Do not say Swing Up guarantees returns.",
      "Do not say alerts are trade instructions.",
      "Do not say AI knows the next move.",
      "Do not promise that a stock will go up.",
      "Do not describe scores, sentiment, or pattern matches as certainty.",
    ],
  },
];

export default function DemoScriptPage() {
  return (
    <main
      style={{
        minHeight: "100vh",
        background:
          "radial-gradient(circle at top left, rgba(75, 105, 255, 0.18), transparent 34rem), #070a12",
        color: "#eef3ff",
        padding: "32px 18px 56px",
      }}
    >
      <div style={{ margin: "0 auto", maxWidth: "1080px" }}>
        <section
          style={{
            border: "1px solid rgba(148, 163, 184, 0.22)",
            borderRadius: "28px",
            background: "linear-gradient(135deg, rgba(15, 23, 42, 0.94), rgba(17, 24, 39, 0.74))",
            boxShadow: "0 24px 80px rgba(0, 0, 0, 0.32)",
            padding: "clamp(24px, 6vw, 56px)",
          }}
        >
          <p style={{ color: "#93c5fd", fontSize: "0.78rem", fontWeight: 700, letterSpacing: "0.18em", textTransform: "uppercase" }}>
            Internal founder demo script
          </p>
          <h1 style={{ fontSize: "clamp(2.2rem, 11vw, 5.8rem)", letterSpacing: "-0.08em", lineHeight: 0.92, margin: "14px 0 18px" }}>
            Explain Swing Up clearly, calmly, and safely.
          </h1>
          <p style={{ color: "#cbd5e1", fontSize: "clamp(1rem, 3vw, 1.25rem)", lineHeight: 1.75, maxWidth: "760px" }}>
            A standalone script for demos, investor conversations, and user testing. This page uses static content only and avoids live user, payment, notification, or market data.
          </p>
        </section>

        <section style={{ display: "grid", gap: "18px", marginTop: "18px" }}>
          <article
            style={{
              border: "1px solid rgba(125, 211, 252, 0.34)",
              borderRadius: "24px",
              background: "rgba(8, 47, 73, 0.42)",
              padding: "24px",
            }}
          >
            <p style={{ color: "#7dd3fc", fontSize: "0.76rem", fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase" }}>
              30-second pitch
            </p>
            <blockquote style={{ borderLeft: "4px solid #38bdf8", color: "#f8fafc", fontSize: "clamp(1.1rem, 4vw, 1.65rem)", lineHeight: 1.55, margin: "18px 0 0", paddingLeft: "18px" }}>
              “{thirtySecondPitch}”
            </blockquote>
          </article>

          <div style={{ display: "grid", gap: "18px", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
            {demoSections.map((section) => (
              <article
                key={section.title}
                style={{
                  border: "1px solid rgba(148, 163, 184, 0.18)",
                  borderRadius: "22px",
                  background: "rgba(15, 23, 42, 0.78)",
                  padding: "22px",
                }}
              >
                <p style={{ color: "#a5b4fc", fontSize: "0.72rem", fontWeight: 800, letterSpacing: "0.15em", textTransform: "uppercase" }}>
                  {section.label}
                </p>
                <h2 style={{ fontSize: "1.32rem", letterSpacing: "-0.03em", margin: "10px 0 14px" }}>{section.title}</h2>
                <ul style={{ color: "#dbeafe", display: "grid", gap: "10px", lineHeight: 1.6, margin: 0, paddingLeft: "20px" }}>
                  {section.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}
