import Link from "next/link";

const signupPromises = [
  {
    title: "Create an account",
    body: "Production signup will identify you before Swing Up saves real preferences. In this preview, no account is created.",
  },
  {
    title: "Choose a watchlist",
    body: "Pick tickers, companies, sectors, or themes you want Swing Up to prioritize when alerts are available.",
  },
  {
    title: "Tune alerts later",
    body: "Risk tolerance, digest cadence, and alert channels can be adjusted after onboarding. Notifications require consent first.",
  },
];

export default function SignupPage() {
  return (
    <div className="page">
      <div className="eyebrow">Signup · preview-only auth</div>
      <div className="hero">
        <div>
          <span className="badge status-not_configured">Preview only — no account created</span>
          <h1 style={{ marginTop: 16 }}>Create your Swing Up account</h1>
          <p>
            This page explains the launch onboarding flow without changing the auth backend. The safe
            path is simple: create an account, choose a watchlist, then decide alert preferences later.
          </p>
          <div className="button-row" aria-label="Signup page actions">
            <Link className="button primary" href="/watchlist">Choose watchlist preview</Link>
            <Link className="button" href="/login">Already have an account?</Link>
          </div>
        </div>

        <form className="form card" aria-label="Preview signup form">
          <h2>Account preview</h2>
          <p className="muted">
            Signup is not wired to production authentication in this build. These fields are disabled
            and do not store names, emails, passwords, payment details, or notification consent.
          </p>
          <input className="input" disabled placeholder="Name" />
          <input className="input" disabled placeholder="Email address" type="email" />
          <button className="button primary" disabled type="button">Preview signup disabled</button>
        </form>
      </div>

      <section className="grid three" aria-label="Signup onboarding steps">
        {signupPromises.map((item, index) => (
          <article className="card" key={item.title}>
            <span className="badge">{index + 1}</span>
            <h3 style={{ marginTop: 12 }}>{item.title}</h3>
            <p>{item.body}</p>
          </article>
        ))}
      </section>
    </div>
  );
}
