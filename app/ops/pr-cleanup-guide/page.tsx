import type { CSSProperties } from "react";

const guidanceSections = [
  {
    title: "What a stale PR is",
    description:
      "A stale PR is an older branch that no longer represents the safest or clearest path to ship. It may be technically mergeable, but its context has aged past the current build queue.",
    signals: [
      "It was opened before newer builds changed the same area.",
      "Its purpose is now unclear from the title, body, or diff.",
      "It has failing checks, unresolved conflicts, or old review comments.",
      "Main already appears to contain the user-facing feature it tried to add.",
    ],
  },
  {
    title: "What a replacement PR is",
    description:
      "A replacement PR is a newer, cleaner branch that intentionally supersedes an older PR. The old PR should usually be closed once the replacement has merged and deployed successfully.",
    signals: [
      "The newer PR mentions the same build goal or page route.",
      "The replacement is narrower, safer, or avoids risky shared files.",
      "The replacement has fresher checks and a cleaner deployment history.",
      "The older PR would reintroduce code that the newer build deliberately avoided.",
    ],
  },
  {
    title: "When to merge",
    description:
      "Merge only when the PR is still the source of truth, checks are green, deploy confidence is high, and the diff does not overwrite newer work.",
    signals: [
      "The branch implements a feature that is not already on main.",
      "It does not touch high-risk files without a current reason.",
      "GitHub checks, Railway deploy, and healthcheck have passed.",
      "The diff matches the build brief and has no accidental backend, schema, auth, payment, layout, or navigation changes.",
    ],
  },
  {
    title: "When to close",
    description:
      "Close when the PR is duplicate, superseded, stale, unsafe, or no longer aligned with the live app. Closing is safer than merging unclear old work.",
    signals: [
      "Main already contains the feature or an improved version of it.",
      "A replacement PR has merged and passed deployment checks.",
      "The branch conflicts with newer builds or shared files.",
      "The PR touches risky files for a non-core or copy-only goal.",
    ],
  },
  {
    title: "When to ask Codex to audit first",
    description:
      "Ask for an audit before merging or closing when the decision depends on code history, file risk, or whether newer work already covers the branch.",
    signals: [
      "The PR touches admin, global CSS, layouts, navigation, schema, scoring, payment, or auth files.",
      "The branch has both useful changes and risky drift.",
      "The PR title sounds obsolete, but the diff may contain one still-needed fix.",
      "You are not sure whether main already contains the feature.",
    ],
  },
];

const warningSigns = [
  "Large diffs that mix frontend copy with backend, schema, auth, payment, or scoring changes.",
  "Old branches that edit shared layout or navigation files after newer standalone pages were merged.",
  "PRs with failing checks that someone still wants to merge because the idea sounds useful.",
  "Branches that undo newer styling, route structure, or safety copy without explaining why.",
  "Duplicate PRs with similar titles where only one has fresh deploy evidence.",
];

const riskyFiles = [
  "app/admin/page.tsx",
  "app/globals.css",
  "database/schema files",
  "shared layout files",
  "shared navigation files",
  "scoring engine files",
  "payment/auth files",
];

const checklist = [
  "Does main already contain this feature?",
  "Does the PR touch risky files?",
  "Does it conflict with newer builds?",
  "Did GitHub checks pass?",
  "Did Railway deploy pass?",
  "Did healthcheck pass?",
  "Is this a replacement PR?",
];

export default function PrCleanupGuidePage() {
  return (
    <main style={styles.page}>
      <section style={styles.hero}>
        <p style={styles.eyebrow}>Internal ops guide</p>
        <h1 style={styles.title}>Dead PR + Old Branch Cleanup</h1>
        <p style={styles.subtitle}>
          A calm, static decision guide for identifying stale duplicate PRs, replacement branches, stuck work, and safe close-or-merge choices after newer builds have already landed.
        </p>
        <div style={styles.noticeGrid}>
          <div style={styles.noticeCard}>
            <span style={styles.badge}>No integrations</span>
            <p style={styles.noticeText}>This page does not call GitHub APIs, query a database, or automate PR actions.</p>
          </div>
          <div style={styles.noticeCard}>
            <span style={styles.badge}>Safe route</span>
            <p style={styles.noticeText}>Use it as a checklist before merging or closing old branches that may overlap newer work.</p>
          </div>
        </div>
      </section>

      <section style={styles.grid} aria-label="PR cleanup guidance">
        {guidanceSections.map((section) => (
          <article key={section.title} style={styles.card}>
            <h2 style={styles.cardTitle}>{section.title}</h2>
            <p style={styles.cardCopy}>{section.description}</p>
            <ul style={styles.list}>
              {section.signals.map((signal) => (
                <li key={signal} style={styles.listItem}>{signal}</li>
              ))}
            </ul>
          </article>
        ))}
      </section>

      <section style={styles.splitSection}>
        <article style={styles.panel}>
          <p style={styles.eyebrow}>Warning signs</p>
          <h2 style={styles.heading}>High-risk PRs deserve an audit before action.</h2>
          <ul style={styles.list}>
            {warningSigns.map((warning) => (
              <li key={warning} style={styles.listItem}>{warning}</li>
            ))}
          </ul>
        </article>

        <article style={styles.panel}>
          <p style={styles.eyebrow}>Risky files to watch</p>
          <h2 style={styles.heading}>Treat these paths as merge blockers until reviewed.</h2>
          <div style={styles.fileList}>
            {riskyFiles.map((file) => (
              <code key={file} style={styles.filePill}>{file}</code>
            ))}
          </div>
        </article>
      </section>

      <section style={styles.checklistSection} aria-labelledby="checklist-heading">
        <div>
          <p style={styles.eyebrow}>Safe decision checklist</p>
          <h2 id="checklist-heading" style={styles.heading}>Answer every question before merge or close.</h2>
          <p style={styles.cardCopy}>If any answer is unclear, pause and ask Codex to audit the diff against main before taking action.</p>
        </div>
        <ol style={styles.checklist}>
          {checklist.map((item) => (
            <li key={item} style={styles.checkItem}>{item}</li>
          ))}
        </ol>
      </section>
    </main>
  );
}

const styles: Record<string, CSSProperties> = {
  page: { minHeight: "100vh", background: "radial-gradient(circle at top left, rgba(37, 99, 235, 0.18), transparent 34%), #05070d", color: "#eef2ff", padding: "28px 16px 64px", fontFamily: "var(--font-geist-sans), system-ui, sans-serif" },
  hero: { maxWidth: 1120, margin: "0 auto 28px", padding: "22px 0 8px" },
  eyebrow: { margin: 0, color: "#93c5fd", fontSize: 12, fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase" },
  title: { margin: "10px 0 12px", fontSize: "clamp(2.25rem, 12vw, 5.25rem)", lineHeight: 0.92, letterSpacing: "-0.07em" },
  subtitle: { margin: 0, maxWidth: 820, color: "#bac7dc", fontSize: "clamp(1rem, 3vw, 1.22rem)", lineHeight: 1.7 },
  noticeGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14, marginTop: 24 },
  noticeCard: { border: "1px solid rgba(148, 163, 184, 0.22)", borderRadius: 24, padding: 18, background: "rgba(15, 23, 42, 0.72)", boxShadow: "0 24px 80px rgba(0,0,0,0.24)" },
  badge: { display: "inline-flex", color: "#bfdbfe", background: "rgba(59, 130, 246, 0.15)", border: "1px solid rgba(147, 197, 253, 0.22)", borderRadius: 999, padding: "7px 10px", fontSize: 12, fontWeight: 800 },
  noticeText: { margin: "12px 0 0", color: "#cbd5e1", lineHeight: 1.6 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16, maxWidth: 1120, margin: "0 auto 18px" },
  card: { border: "1px solid rgba(148, 163, 184, 0.18)", borderRadius: 28, padding: 22, background: "linear-gradient(145deg, rgba(15, 23, 42, 0.92), rgba(15, 23, 42, 0.58))" },
  cardTitle: { margin: 0, fontSize: "1.25rem", letterSpacing: "-0.03em" },
  cardCopy: { color: "#b6c2d9", lineHeight: 1.7, margin: "10px 0 0" },
  list: { display: "grid", gap: 10, margin: "16px 0 0", padding: 0, listStyle: "none" },
  listItem: { color: "#dbe7ff", lineHeight: 1.55, paddingLeft: 16, borderLeft: "2px solid rgba(96, 165, 250, 0.45)" },
  splitSection: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, maxWidth: 1120, margin: "0 auto 18px" },
  panel: { border: "1px solid rgba(148, 163, 184, 0.2)", borderRadius: 30, padding: 24, background: "rgba(2, 6, 23, 0.66)" },
  heading: { margin: "10px 0 0", fontSize: "clamp(1.45rem, 5vw, 2.25rem)", lineHeight: 1.05, letterSpacing: "-0.05em" },
  fileList: { display: "flex", flexWrap: "wrap", gap: 10, marginTop: 18 },
  filePill: { border: "1px solid rgba(248, 113, 113, 0.24)", borderRadius: 999, padding: "9px 11px", color: "#fecaca", background: "rgba(127, 29, 29, 0.18)", fontSize: 13 },
  checklistSection: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 18, maxWidth: 1120, margin: "0 auto", border: "1px solid rgba(148, 163, 184, 0.22)", borderRadius: 32, padding: 24, background: "linear-gradient(145deg, rgba(15, 23, 42, 0.9), rgba(30, 41, 59, 0.52))" },
  checklist: { display: "grid", gap: 10, margin: 0, paddingLeft: 22 },
  checkItem: { color: "#eef2ff", lineHeight: 1.55, paddingLeft: 6 },
};
