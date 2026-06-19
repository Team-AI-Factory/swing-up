import type { CSSProperties } from "react";

type ChecklistSection = {
  title: string;
  intent: string;
  items: string[];
};

const checklistSections: ChecklistSection[] = [
  {
    title: "Before merge checklist",
    intent: "Confirm the PR is safe before it enters the deployment path.",
    items: [
      "PR has no conflicts.",
      "GitHub checks are green or have a documented reason before merge.",
      "PR does not touch unexpected risky files such as admin home, global styles, layout files, API routes, backend logic, or database schema.",
      "The build scope matches the brief and any mock or preview label is clear.",
    ],
  },
  {
    title: "GitHub checks checklist",
    intent: "Use GitHub as the first deployment gate, not as a substitute for production checks.",
    items: [
      "Required GitHub checks are green.",
      "The branch is up to date enough to avoid obvious merge surprises.",
      "The final diff contains only expected route, copy, and isolated UI changes.",
      "No generated files, secrets, debug logs, or local-only artifacts were committed unexpectedly.",
    ],
  },
  {
    title: "After merge checklist",
    intent: "Wait for the merged commit to move through Railway before starting dependent work.",
    items: [
      "Merged commit is visible on the target branch.",
      "Railway deployment has started for the merged commit.",
      "No database migration failed during the deploy log review.",
      "Do not start the next dependent backend build yet.",
    ],
  },
  {
    title: "Railway deploy checklist",
    intent: "Verify the platform finished deploying the exact change that was merged.",
    items: [
      "Railway deployment completed successfully.",
      "The active production deployment points at the expected commit.",
      "There are no obvious boot loops, restart storms, or missing environment variable errors.",
      "The new build route or page works after deploy.",
    ],
  },
  {
    title: "Healthcheck checklist",
    intent: "Check the smallest reliable signals before trusting deeper app behavior.",
    items: [
      "/api/health returns ok true.",
      "Existing critical routes still work.",
      "No source health route broke.",
      "No ledger or alert route broke.",
      "Existing ops pages still load.",
    ],
  },
  {
    title: "Rollback warning signs",
    intent: "Stop forward motion when production shows symptoms that could affect users or backend sequencing.",
    items: [
      "Healthcheck returns anything other than ok true.",
      "Critical public, ops, source health, ledger, or alert routes return errors.",
      "Railway shows repeated crashes, failed migrations, or missing runtime configuration.",
      "A supposedly standalone frontend build changed risky backend, schema, layout, navigation, admin, or API files.",
    ],
  },
  {
    title: "When to start the next dependent build",
    intent: "Only proceed when the previous deployment is stable in production.",
    items: [
      "The previous build is merged.",
      "Railway has deployed the merged commit successfully.",
      "/api/health returns ok true in production.",
      "The new route works and existing critical routes still work.",
      "No migration, source health, ledger, alert, or ops regression is visible.",
    ],
  },
  {
    title: "When to stop and fix first",
    intent: "Protect the backend chain by resolving production uncertainty before adding more changes.",
    items: [
      "Any GitHub check is red without an understood non-blocking reason.",
      "The PR has conflicts or unexpected risky file changes.",
      "Railway deployment failed, stalled, or deployed the wrong commit.",
      "/api/health does not return ok true.",
      "A source health, ledger, alert, or existing ops route broke after deploy.",
    ],
  },
];

const priorityChecks = [
  "GitHub checks are green",
  "PR has no conflicts",
  "Railway deployment completed",
  "/api/health returns ok true",
  "New build route/page works",
  "Existing critical routes still work",
];

export default function DeployVerificationPage() {
  return (
    <main style={styles.page}>
      <section style={styles.hero}>
        <div style={styles.heroCopy}>
          <p style={styles.eyebrow}>Internal ops · deployment gate</p>
          <h1 style={styles.title}>Deployment Verification Checklist</h1>
          <p style={styles.subtitle}>
            A calm, static checklist for verifying every Railway deployment before the next dependent backend build begins.
          </p>
        </div>
        <aside style={styles.gateCard} aria-label="Primary deployment rule">
          <span style={styles.badge}>Required sequence</span>
          <p style={styles.gateText}>
            Do not start the next dependent backend build until the previous build is merged, deployed, and healthchecked.
          </p>
        </aside>
      </section>

      <section style={styles.priorityPanel} aria-labelledby="priority-heading">
        <div>
          <p style={styles.eyebrow}>Fast pass</p>
          <h2 id="priority-heading" style={styles.heading}>Minimum checks before handoff</h2>
        </div>
        <div style={styles.priorityGrid}>
          {priorityChecks.map((check) => (
            <div key={check} style={styles.priorityItem}>
              <span style={styles.checkmark}>✓</span>
              <span>{check}</span>
            </div>
          ))}
        </div>
      </section>

      <section style={styles.sections} aria-label="Deployment verification sections">
        {checklistSections.map((section) => (
          <article key={section.title} style={styles.card}>
            <div style={styles.cardHeader}>
              <p style={styles.sectionKicker}>Verify</p>
              <h2 style={styles.cardTitle}>{section.title}</h2>
              <p style={styles.intent}>{section.intent}</p>
            </div>
            <ul style={styles.list}>
              {section.items.map((item) => (
                <li key={item} style={styles.listItem}>
                  <span style={styles.dot} aria-hidden="true" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </article>
        ))}
      </section>
    </main>
  );
}

const styles: Record<string, CSSProperties> = {
  page: {
    minHeight: "100vh",
    background: "radial-gradient(circle at top left, rgba(20, 184, 166, 0.18), transparent 34rem), #071014",
    color: "#e5f3f1",
    padding: "32px 18px 56px",
    fontFamily: "Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  hero: {
    display: "grid",
    gap: 20,
    maxWidth: 1120,
    margin: "0 auto 22px",
  },
  heroCopy: { maxWidth: 760 },
  eyebrow: {
    margin: "0 0 10px",
    color: "#7dd3fc",
    fontSize: 12,
    fontWeight: 800,
    letterSpacing: "0.14em",
    textTransform: "uppercase",
  },
  title: {
    margin: 0,
    fontSize: "clamp(2.25rem, 8vw, 5rem)",
    lineHeight: 0.92,
    letterSpacing: "-0.07em",
  },
  subtitle: {
    margin: "18px 0 0",
    maxWidth: 680,
    color: "#b6c9c6",
    fontSize: "clamp(1rem, 3vw, 1.25rem)",
    lineHeight: 1.6,
  },
  gateCard: {
    border: "1px solid rgba(125, 211, 252, 0.26)",
    borderRadius: 28,
    background: "linear-gradient(145deg, rgba(14, 116, 144, 0.22), rgba(15, 23, 42, 0.82))",
    boxShadow: "0 24px 70px rgba(0, 0, 0, 0.34)",
    padding: 24,
  },
  badge: {
    display: "inline-flex",
    border: "1px solid rgba(45, 212, 191, 0.36)",
    borderRadius: 999,
    color: "#99f6e4",
    padding: "7px 11px",
    fontSize: 12,
    fontWeight: 800,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
  },
  gateText: { margin: "18px 0 0", fontSize: 22, lineHeight: 1.35, fontWeight: 800 },
  priorityPanel: {
    maxWidth: 1120,
    margin: "0 auto 22px",
    border: "1px solid rgba(148, 163, 184, 0.18)",
    borderRadius: 28,
    background: "rgba(15, 23, 42, 0.72)",
    padding: 22,
  },
  heading: { margin: 0, fontSize: "clamp(1.4rem, 5vw, 2.3rem)", letterSpacing: "-0.04em" },
  priorityGrid: { display: "grid", gap: 12, marginTop: 18 },
  priorityItem: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    borderRadius: 18,
    background: "rgba(8, 47, 73, 0.45)",
    padding: "14px 15px",
    color: "#d9fffb",
    fontWeight: 700,
  },
  checkmark: { color: "#5eead4", fontWeight: 900 },
  sections: { display: "grid", gap: 16, maxWidth: 1120, margin: "0 auto" },
  card: {
    border: "1px solid rgba(148, 163, 184, 0.16)",
    borderRadius: 26,
    background: "rgba(2, 6, 23, 0.68)",
    padding: 22,
  },
  cardHeader: { marginBottom: 16 },
  sectionKicker: { margin: "0 0 6px", color: "#5eead4", fontSize: 12, fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.12em" },
  cardTitle: { margin: 0, fontSize: "clamp(1.25rem, 5vw, 1.85rem)", letterSpacing: "-0.035em" },
  intent: { margin: "10px 0 0", color: "#adc2bf", lineHeight: 1.55 },
  list: { display: "grid", gap: 10, margin: 0, padding: 0, listStyle: "none" },
  listItem: { display: "grid", gridTemplateColumns: "10px 1fr", gap: 12, alignItems: "start", color: "#d5e6e3", lineHeight: 1.5 },
  dot: { width: 8, height: 8, borderRadius: 999, background: "#22d3ee", marginTop: 8, boxShadow: "0 0 18px rgba(34, 211, 238, 0.7)" },
};
