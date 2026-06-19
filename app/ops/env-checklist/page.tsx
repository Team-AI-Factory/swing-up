import type { CSSProperties } from "react";

type EnvCategory = {
  title: string;
  purpose: string;
  examples: string[];
  notes: string[];
};

const envCategories: EnvCategory[] = [
  {
    title: "Database variables",
    purpose: "Connect runtime services to the application database without hard-coding credentials.",
    examples: ["DATABASE_URL", "POSTGRES_URL", "POSTGRES_PRISMA_URL", "POSTGRES_URL_NON_POOLING"],
    notes: ["Store connection strings only in the hosting provider secret manager.", "Keep pooled and direct URLs clearly labeled so migrations do not use the wrong connection."],
  },
  {
    title: "Railway deployment variables",
    purpose: "Describe the deploy environment and app URL used by hosted services.",
    examples: ["RAILWAY_ENVIRONMENT", "RAILWAY_PROJECT_ID", "RAILWAY_SERVICE_ID", "NEXT_PUBLIC_APP_URL"],
    notes: ["Use environment names to separate preview, staging, and production behavior.", "Public URL variables may be visible to the browser; never place secrets in NEXT_PUBLIC names."],
  },
  {
    title: "Source/data provider variables",
    purpose: "Authenticate or tune upstream data feeds used for signals, source checks, and market context.",
    examples: ["SEC_EDGAR_USER_AGENT", "GDELT_API_KEY", "COINGECKO_API_KEY", "FRANKFURTER_API_KEY"],
    notes: ["Provider keys should be scoped to the minimum access needed.", "Document rate-limit owner and renewal process outside the app."],
  },
  {
    title: "AI provider variables",
    purpose: "Enable AI review, scoring support, and model provider calls when those services are intentionally connected.",
    examples: ["OPENAI_API_KEY", "OPENAI_MODEL", "ANTHROPIC_API_KEY", "AI_REVIEW_ENABLED"],
    notes: ["Keep model selection separate from provider keys.", "Use feature flags to disable AI calls without redeploying code."],
  },
  {
    title: "Payment variables",
    purpose: "Support billing provider integration, checkout links, and webhook verification.",
    examples: ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_PRICE_ID", "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"],
    notes: ["Webhook signing secrets are server-only and must never be shown in client bundles.", "Test and live payment variables should be separated by environment."],
  },
  {
    title: "Auth variables",
    purpose: "Control session signing, login providers, and redirect destinations.",
    examples: ["NEXTAUTH_SECRET", "NEXTAUTH_URL", "AUTH_GOOGLE_ID", "AUTH_GOOGLE_SECRET"],
    notes: ["Rotate session secrets carefully because active sessions may be invalidated.", "OAuth client secrets belong only in server-side environment storage."],
  },
  {
    title: "Notification variables",
    purpose: "Configure email, SMS, push, or webhook channels without exposing delivery credentials.",
    examples: ["RESEND_API_KEY", "SENDGRID_API_KEY", "TWILIO_AUTH_TOKEN", "SLACK_WEBHOOK_URL"],
    notes: ["Keep notification senders disabled in preview unless explicitly testing.", "Webhook URLs can act like passwords and should be treated as secrets."],
  },
  {
    title: "Cloud/storage variables",
    purpose: "Connect file storage, object buckets, and signed upload flows.",
    examples: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "S3_BUCKET_NAME", "CLOUDINARY_URL"],
    notes: ["Prefer short-lived or least-privilege credentials where supported.", "Bucket names may be non-secret, but write keys and signing secrets are sensitive."],
  },
];

const safetyRules = [
  "Show names, owners, and setup status only — never show raw values.",
  "Never read process.env or live provider configuration from this page.",
  "Keep server-only secrets out of NEXT_PUBLIC variables and browser-rendered payloads.",
  "Rotate exposed or uncertain credentials immediately through the provider dashboard.",
  "Store real values in Railway or the provider secret manager, not in code, docs, screenshots, or chat.",
];

export default function EnvChecklistPage() {
  const exampleCount = envCategories.reduce((count, category) => count + category.examples.length, 0);

  return (
    <main style={styles.page}>
      <section style={styles.hero}>
        <div>
          <p style={styles.eyebrow}>Internal ops · Build 72</p>
          <h1 style={styles.title}>Environment Variables Checklist</h1>
          <p style={styles.subtitle}>
            A static reference for the categories of environment variables Swing Up may need across deploys, providers, auth, payments, notifications, and storage. This page uses example names only and never reads or reveals real secret values.
          </p>
        </div>
        <aside style={styles.heroCard} aria-label="Checklist summary">
          <span style={styles.badge}>Static / no secrets</span>
          <strong style={styles.metric}>{envCategories.length} categories</strong>
          <p style={styles.cardText}>{exampleCount} example variable names for manual setup review.</p>
        </aside>
      </section>

      <section style={styles.notice} aria-label="Secret handling notice">
        <strong>Safety boundary:</strong> This route is local static content only. It does not call APIs, read environment variables, connect to databases, or display credential values.
      </section>

      <section style={styles.grid} aria-label="Environment variable categories">
        {envCategories.map((category) => (
          <article key={category.title} style={styles.card}>
            <p style={styles.kicker}>Variable category</p>
            <h2 style={styles.cardTitle}>{category.title}</h2>
            <p style={styles.purpose}>{category.purpose}</p>
            <div style={styles.exampleWrap} aria-label={`${category.title} example names`}>
              {category.examples.map((example) => (
                <code key={example} style={styles.codePill}>{example}</code>
              ))}
            </div>
            <ul style={styles.notes}>
              {category.notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </article>
        ))}
      </section>

      <section style={styles.rules} aria-labelledby="safety-rules-heading">
        <div>
          <p style={styles.eyebrow}>Required handling</p>
          <h2 id="safety-rules-heading" style={styles.rulesTitle}>Safety rules for secrets</h2>
        </div>
        <ol style={styles.ruleList}>
          {safetyRules.map((rule) => (
            <li key={rule}>{rule}</li>
          ))}
        </ol>
      </section>
    </main>
  );
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: "100vh", background: "radial-gradient(circle at top left, rgba(14, 165, 233, 0.18), transparent 32rem), linear-gradient(180deg, #05070d 0%, #0b1020 100%)", color: "#eef2ff", padding: "28px 16px 64px", fontFamily: "var(--font-geist-sans), system-ui, sans-serif" },
  hero: { display: "grid", gap: 18, maxWidth: 1120, margin: "0 auto 18px", padding: "24px 0" },
  eyebrow: { margin: 0, color: "#7dd3fc", fontSize: 12, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase" },
  title: { margin: "10px 0", fontSize: "clamp(2.25rem, 11vw, 5rem)", lineHeight: 0.95, letterSpacing: "-0.065em" },
  subtitle: { margin: 0, maxWidth: 790, color: "#b8c4d9", fontSize: "clamp(1rem, 3vw, 1.18rem)", lineHeight: 1.7 },
  heroCard: { border: "1px solid rgba(148, 163, 184, 0.22)", borderRadius: 28, padding: 22, background: "linear-gradient(145deg, rgba(15, 23, 42, 0.94), rgba(15, 23, 42, 0.58))", boxShadow: "0 24px 80px rgba(0,0,0,0.35)" },
  badge: { display: "inline-flex", border: "1px solid rgba(125, 211, 252, 0.32)", borderRadius: 999, padding: "7px 11px", color: "#bae6fd", fontSize: 12, fontWeight: 800 },
  metric: { display: "block", marginTop: 18, fontSize: 34, letterSpacing: "-0.05em" },
  cardText: { margin: "10px 0 0", color: "#aab8cf", lineHeight: 1.6 },
  notice: { maxWidth: 1120, margin: "0 auto 18px", border: "1px solid rgba(251, 191, 36, 0.25)", borderRadius: 22, padding: 16, background: "rgba(113, 63, 18, 0.14)", color: "#fde68a", lineHeight: 1.6 },
  grid: { maxWidth: 1120, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16 },
  card: { border: "1px solid rgba(148, 163, 184, 0.18)", borderRadius: 26, padding: 20, background: "rgba(15, 23, 42, 0.72)", boxShadow: "0 18px 60px rgba(0,0,0,0.25)" },
  kicker: { margin: 0, color: "#93c5fd", fontSize: 11, fontWeight: 800, letterSpacing: "0.14em", textTransform: "uppercase" },
  cardTitle: { margin: "8px 0 10px", fontSize: 24, letterSpacing: "-0.04em" },
  purpose: { margin: 0, color: "#cbd5e1", lineHeight: 1.6 },
  exampleWrap: { display: "flex", flexWrap: "wrap", gap: 8, marginTop: 16 },
  codePill: { border: "1px solid rgba(125, 211, 252, 0.22)", borderRadius: 999, padding: "7px 10px", background: "rgba(2, 6, 23, 0.72)", color: "#e0f2fe", fontSize: 12 },
  notes: { margin: "16px 0 0", paddingLeft: 18, color: "#aab8cf", lineHeight: 1.65 },
  rules: { maxWidth: 1120, margin: "18px auto 0", border: "1px solid rgba(34, 197, 94, 0.22)", borderRadius: 28, padding: 22, background: "linear-gradient(145deg, rgba(6, 78, 59, 0.28), rgba(15, 23, 42, 0.72))" },
  rulesTitle: { margin: "8px 0 0", fontSize: "clamp(1.7rem, 6vw, 3rem)", letterSpacing: "-0.05em" },
  ruleList: { margin: "18px 0 0", paddingLeft: 22, color: "#d1fae5", lineHeight: 1.75 },
};
