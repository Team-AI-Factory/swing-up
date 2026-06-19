import type { CSSProperties } from "react";

type ChecklistStatus = "not started" | "checking" | "done" | "blocked";

type ChecklistItem = {
  task: string;
  why: string;
  status: ChecklistStatus;
  healthcheck?: string;
};

type ChecklistSection = {
  title: string;
  summary: string;
  items: ChecklistItem[];
};

const checklistSections: ChecklistSection[] = [
  {
    title: "Before merging a PR",
    summary: "Confirm the branch is isolated, reviewed, and safe to merge without disrupting core backend work.",
    items: [
      {
        task: "Review changed files against the build brief",
        why: "Keeps standalone frontend builds from drifting into admin, layout, global style, API, or schema work.",
        status: "not started",
      },
      {
        task: "Confirm required checks have passed locally",
        why: "Type, lint, and build failures are cheaper to catch before the branch reaches deploy.",
        status: "checking",
        healthcheck: "/api/health",
      },
      {
        task: "Read the PR diff for accidental automation",
        why: "Founder ops pages should guide decisions without triggering GitHub, Railway, payment, or database actions.",
        status: "not started",
      },
    ],
  },
  {
    title: "After Railway deploy",
    summary: "Use a calm post-deploy pass to verify the public app is reachable before sharing anything wider.",
    items: [
      {
        task: "Open the deployed app homepage",
        why: "A successful build is not enough; the production route must respond for real users.",
        status: "not started",
      },
      {
        task: "Run the base health endpoint",
        why: "The simplest API heartbeat catches broken runtime configuration quickly.",
        status: "checking",
        healthcheck: "/api/health",
      },
      {
        task: "Spot-check recent standalone ops pages",
        why: "Parallel non-core pages should remain reachable after deploy even when backend work is ongoing.",
        status: "not started",
        healthcheck: "/ops/build-queue",
      },
    ],
  },
  {
    title: "Source health checks",
    summary: "Make sure the source layer is understandable and observable before trusting downstream signals.",
    items: [
      {
        task: "Open source health overview",
        why: "Source uptime and freshness issues can create false confidence in downstream alerts.",
        status: "not started",
        healthcheck: "/source-health",
      },
      {
        task: "Check source reliability language",
        why: "Public trust depends on clear limits around source quality and coverage.",
        status: "not started",
        healthcheck: "/source-reliability",
      },
      {
        task: "Confirm data coverage copy is still accurate",
        why: "Coverage gaps should be visible before pre-launch users interpret signals.",
        status: "not started",
        healthcheck: "/data-coverage",
      },
    ],
  },
  {
    title: "Alert safety checks",
    summary: "Keep alert language conservative, explainable, and free of investment-advice framing.",
    items: [
      {
        task: "Review alert examples for safe wording",
        why: "Examples set user expectations and must stay educational rather than directive.",
        status: "not started",
        healthcheck: "/alert-examples",
      },
      {
        task: "Open the alert anatomy page",
        why: "Users should be able to understand each part of an alert before acting on it.",
        status: "not started",
        healthcheck: "/alert-anatomy",
      },
      {
        task: "Check false-signal explanation",
        why: "Pre-launch users need a clear reminder that signals can be wrong or incomplete.",
        status: "not started",
        healthcheck: "/false-signals",
      },
    ],
  },
  {
    title: "Public ledger checks",
    summary: "Verify the ledger remains accessible, transparent, and separate from private admin review work.",
    items: [
      {
        task: "Open public ledger route",
        why: "The ledger is a core trust surface for showing what the system has recorded publicly.",
        status: "not started",
        healthcheck: "/public-ledger",
      },
      {
        task: "Compare ledger language with receipts guide",
        why: "Receipt and ledger explanations should describe evidence consistently.",
        status: "not started",
        healthcheck: "/receipts-guide",
      },
      {
        task: "Confirm no private admin assumptions leak into public copy",
        why: "Pre-launch transparency should not expose internal workflows or sensitive review details.",
        status: "not started",
      },
    ],
  },
  {
    title: "Scoring checks",
    summary: "Confirm scoring copy explains confidence and limits without implying certainty.",
    items: [
      {
        task: "Open score glossary",
        why: "Users need plain-language definitions for score components before they compare alerts.",
        status: "not started",
        healthcheck: "/score-glossary",
      },
      {
        task: "Review methodology page",
        why: "Methodology should align with the current scoring story and avoid overpromising precision.",
        status: "not started",
        healthcheck: "/methodology",
      },
      {
        task: "Check market weather framing",
        why: "Market context should support caution, not create a recommendation signal on its own.",
        status: "not started",
        healthcheck: "/market-weather",
      },
    ],
  },
  {
    title: "Admin review checks",
    summary: "Use admin surfaces carefully and avoid starting parallel work that changes shared admin routing.",
    items: [
      {
        task: "Confirm admin homepage is not part of this build",
        why: "The admin index is a frequent conflict point and should remain untouched for standalone pages.",
        status: "done",
      },
      {
        task: "Open candidate alert review if relevant",
        why: "Founder review should happen on the intended admin surface before launch decisions.",
        status: "not started",
        healthcheck: "/admin/candidate-alerts",
      },
      {
        task: "Check raw signal review if relevant",
        why: "Raw signal visibility helps catch bad inputs before they become public-facing explanations.",
        status: "not started",
        healthcheck: "/admin/raw-signals",
      },
    ],
  },
  {
    title: "Payment readiness checks",
    summary: "Keep payment messaging honest until live billing and support flows are intentionally connected.",
    items: [
      {
        task: "Open pricing page",
        why: "Pricing copy should match the current launch promise and avoid unsupported claims.",
        status: "not started",
        healthcheck: "/pricing",
      },
      {
        task: "Review paid data plan language",
        why: "Paid data expectations must be clear before customers are asked to trust the product.",
        status: "not started",
        healthcheck: "/paid-data-plan",
      },
      {
        task: "Confirm no payment automation was added accidentally",
        why: "This checklist is static and should not connect to billing providers or customer records.",
        status: "not started",
      },
    ],
  },
  {
    title: "Notification readiness checks",
    summary: "Validate notification previews and expectations before any live notification channel is enabled.",
    items: [
      {
        task: "Open notification preview",
        why: "Preview copy should be calm, concise, and aligned with alert safety language.",
        status: "not started",
        healthcheck: "/notification-preview",
      },
      {
        task: "Confirm notification actions are not automated",
        why: "Pre-launch notification work should not send email, SMS, push, or webhooks unexpectedly.",
        status: "not started",
      },
      {
        task: "Review onboarding preview expectations",
        why: "Users should understand when notifications are informational and when they are unavailable.",
        status: "not started",
        healthcheck: "/onboarding-preview",
      },
    ],
  },
  {
    title: "Launch readiness checks",
    summary: "Perform a final founder-level pass before inviting users or announcing wider availability.",
    items: [
      {
        task: "Read risk disclaimer",
        why: "Risk language must be visible and consistent before users evaluate market information.",
        status: "not started",
        healthcheck: "/risk-disclaimer",
      },
      {
        task: "Open help page",
        why: "Users need a low-friction place to understand the product and its limitations.",
        status: "not started",
        healthcheck: "/help",
      },
      {
        task: "Confirm build queue is current",
        why: "Launch should not happen while conflicting backend chain work is unclear or mid-deploy.",
        status: "checking",
        healthcheck: "/ops/build-queue",
      },
    ],
  },
];

const statusStyles: Record<ChecklistStatus, CSSProperties> = {
  "not started": { background: "rgba(148, 163, 184, 0.14)", color: "#cbd5e1", borderColor: "rgba(148, 163, 184, 0.2)" },
  checking: { background: "rgba(59, 130, 246, 0.18)", color: "#bfdbfe", borderColor: "rgba(96, 165, 250, 0.28)" },
  done: { background: "rgba(34, 197, 94, 0.16)", color: "#bbf7d0", borderColor: "rgba(74, 222, 128, 0.25)" },
  blocked: { background: "rgba(248, 113, 113, 0.16)", color: "#fecaca", borderColor: "rgba(248, 113, 113, 0.25)" },
};

export default function OpsChecklistPage() {
  const itemCount = checklistSections.reduce((total, section) => total + section.items.length, 0);

  return (
    <main style={styles.page}>
      <section style={styles.hero}>
        <div>
          <p style={styles.eyebrow}>Founder ops</p>
          <h1 style={styles.title}>Swing Up Safety Checklist</h1>
          <p style={styles.subtitle}>
            A static, standalone operating guide for build and pre-launch checks. No automation, no backend calls, no database data, and no connections to GitHub or Railway.
          </p>
        </div>
        <aside style={styles.heroCard} aria-label="Checklist scope">
          <span style={styles.badge}>Static guide only</span>
          <strong style={styles.heroMetric}>{itemCount} checks</strong>
          <p style={styles.cardText}>Use this page as a calm founder pass before merges, deploys, public review, payment readiness, notifications, and launch.</p>
        </aside>
      </section>

      <section style={styles.notice} aria-label="Operating rules">
        <p style={styles.noticeText}>Do not automate these actions yet. Follow the links manually when relevant, then update the real source of truth outside this static page.</p>
      </section>

      <section style={styles.grid} aria-label="Founder operations checklist">
        {checklistSections.map((section) => (
          <article key={section.title} style={styles.sectionCard}>
            <div style={styles.sectionHeader}>
              <p style={styles.eyebrow}>Checklist section</p>
              <h2 style={styles.heading}>{section.title}</h2>
              <p style={styles.summary}>{section.summary}</p>
            </div>
            <div style={styles.itemList}>
              {section.items.map((item) => (
                <div key={item.task} style={styles.itemCard}>
                  <div style={styles.itemTopline}>
                    <h3 style={styles.itemTitle}>{item.task}</h3>
                    <span style={{ ...styles.status, ...statusStyles[item.status] }}>{item.status}</span>
                  </div>
                  <p style={styles.why}>{item.why}</p>
                  {item.healthcheck ? (
                    <a style={styles.healthcheckLink} href={item.healthcheck}>
                      Related check: {item.healthcheck}
                    </a>
                  ) : (
                    <span style={styles.noLink}>No related healthcheck</span>
                  )}
                </div>
              ))}
            </div>
          </article>
        ))}
      </section>
    </main>
  );
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: "100vh", background: "radial-gradient(circle at top left, rgba(30, 64, 175, 0.22), transparent 32rem), #05070d", color: "#eef2ff", padding: "28px 16px 64px", fontFamily: "var(--font-geist-sans), system-ui, sans-serif" },
  hero: { display: "grid", gap: 18, maxWidth: 1180, margin: "0 auto 18px", padding: "24px 0" },
  eyebrow: { margin: 0, color: "#93c5fd", fontSize: 12, fontWeight: 850, letterSpacing: "0.16em", textTransform: "uppercase" },
  title: { margin: "10px 0", fontSize: "clamp(2.2rem, 10vw, 4.8rem)", lineHeight: 0.95, letterSpacing: "-0.06em" },
  subtitle: { margin: 0, maxWidth: 760, color: "#b6c2d9", fontSize: "clamp(1rem, 3vw, 1.2rem)", lineHeight: 1.7 },
  heroCard: { border: "1px solid rgba(148, 163, 184, 0.22)", borderRadius: 28, padding: 22, background: "linear-gradient(145deg, rgba(15, 23, 42, 0.96), rgba(15, 23, 42, 0.62))", boxShadow: "0 24px 80px rgba(0,0,0,0.35)" },
  badge: { display: "inline-flex", border: "1px solid rgba(147, 197, 253, 0.3)", borderRadius: 999, padding: "7px 11px", color: "#bfdbfe", fontSize: 12, fontWeight: 850 },
  heroMetric: { display: "block", marginTop: 18, fontSize: 36, letterSpacing: "-0.05em" },
  cardText: { margin: "10px 0 0", color: "#aab8cf", lineHeight: 1.6 },
  notice: { maxWidth: 1180, margin: "0 auto 18px", border: "1px solid rgba(251, 191, 36, 0.24)", borderRadius: 22, padding: 16, background: "rgba(113, 63, 18, 0.16)" },
  noticeText: { margin: 0, color: "#fde68a", lineHeight: 1.6, fontWeight: 700 },
  grid: { maxWidth: 1180, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))", gap: 16 },
  sectionCard: { border: "1px solid rgba(148, 163, 184, 0.18)", borderRadius: 28, padding: 18, background: "rgba(15, 23, 42, 0.76)", boxShadow: "0 18px 70px rgba(0, 0, 0, 0.2)" },
  sectionHeader: { marginBottom: 16 },
  heading: { margin: "8px 0 0", fontSize: "clamp(1.35rem, 5vw, 2rem)", letterSpacing: "-0.04em" },
  summary: { margin: "10px 0 0", color: "#aab8cf", lineHeight: 1.6 },
  itemList: { display: "grid", gap: 12 },
  itemCard: { border: "1px solid rgba(148, 163, 184, 0.14)", borderRadius: 20, padding: 14, background: "rgba(2, 6, 23, 0.44)" },
  itemTopline: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  itemTitle: { margin: 0, color: "#f8fafc", fontSize: 16, lineHeight: 1.3, letterSpacing: "-0.02em" },
  status: { flexShrink: 0, border: "1px solid", borderRadius: 999, padding: "6px 9px", fontSize: 11, fontWeight: 850, textTransform: "capitalize", whiteSpace: "nowrap" },
  why: { margin: "10px 0 12px", color: "#cbd5e1", lineHeight: 1.55 },
  healthcheckLink: { color: "#93c5fd", fontWeight: 800, textDecoration: "none" },
  noLink: { color: "#64748b", fontSize: 13, fontWeight: 750 },
};
