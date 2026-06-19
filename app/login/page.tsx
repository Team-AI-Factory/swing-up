import Link from "next/link";

const onboardingSteps = [
  "Sign in when production authentication is connected.",
  "Choose the companies, funds, or themes you want on your watchlist.",
  "Set alert preferences later from your account settings.",
];

export default function LoginPage() {
  return (
    <div className="page">
      <div className="eyebrow">Login · preview-only auth</div>
      <div className="hero">
        <div>
          <span className="badge status-not_configured">Preview only — no real session</span>
          <h1 style={{ marginTop: 16 }}>Welcome back to Swing Up</h1>
          <p>
            Login is shown here as an onboarding preview so you can see the intended path from
            account access to watchlist setup. Production authentication is not connected in this build.
          </p>
          <div className="button-row" aria-label="Login page next steps">
            <Link className="button primary" href="/watchlist">Preview watchlist</Link>
            <Link className="button" href="/signup">Create account preview</Link>
          </div>
        </div>

        <form className="form card" aria-label="Preview login form">
          <h2>Login preview</h2>
          <p className="muted">
            These fields are disabled for safety. Do not enter a real password here: this page does not
            submit credentials, store real data, or create an authenticated session.
          </p>
          <input className="input" disabled placeholder="Email address" type="email" />
          <input className="input" disabled placeholder="Password" type="password" />
          <button className="button primary" disabled type="button">Preview login disabled</button>
        </form>
      </div>

      <section className="grid three" aria-label="Onboarding path after login">
        {onboardingSteps.map((step, index) => (
          <article className="card" key={step}>
            <span className="badge">Step {index + 1}</span>
            <h3 style={{ marginTop: 12 }}>{step}</h3>
            <p className="muted">
              Notifications are never sent automatically. Email, push, or SMS alerts require explicit
              consent before delivery can happen.
            </p>
          </article>
        ))}
      </section>
    </div>
  );
}
