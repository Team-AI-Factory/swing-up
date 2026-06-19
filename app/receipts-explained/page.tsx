const strongReceipts = [
  "SEC filing",
  "Company press release",
  "Regulator or exchange source",
  "Reliable financial data provider",
  "Direct company source",
];

const weakReceipts = [
  "Vague social media post",
  "Unattributed rumour",
  "Copied article with no original source",
  "Stale or broken link",
  "Source with unclear reliability",
];

const reliabilitySignals = [
  "How close the source is to the original event",
  "Whether the source is official, named, and checkable",
  "Whether the information is current enough to support the alert",
  "Whether another reliable source can support the same claim",
];

export default function ReceiptsExplainedPage() {
  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <section className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-5 py-10 sm:px-6 sm:py-14 lg:px-8">
        <div className="rounded-[2rem] border border-cyan-400/20 bg-[radial-gradient(circle_at_top_left,rgba(34,211,238,0.18),transparent_38%),linear-gradient(135deg,rgba(15,23,42,0.98),rgba(2,6,23,0.98))] p-6 shadow-2xl shadow-cyan-950/40 sm:p-10">
          <p className="mb-4 text-xs font-semibold uppercase tracking-[0.28em] text-cyan-300">
            Receipts explained
          </p>
          <div className="grid gap-8 lg:grid-cols-[1.4fr_0.8fr] lg:items-end">
            <div>
              <h1 className="max-w-3xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                What receipts mean inside Swing Up alerts
              </h1>
              <p className="mt-5 max-w-2xl text-base leading-8 text-slate-300 sm:text-lg">
                Receipts are the visible evidence links, records, or source notes that help explain why a market alert exists. Receipts help users check why an alert exists.
              </p>
            </div>
            <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-5">
              <p className="text-sm leading-7 text-slate-300">
                Receipts improve evidence quality, but they do not guarantee returns. They are a trust layer for research review, not a promise about future performance.
              </p>
            </div>
          </div>
        </div>

        <section className="grid gap-4 md:grid-cols-2">
          <InfoCard eyebrow="Meaning" title="What a receipt means in Swing Up">
            A receipt is a checkable source attached to an alert: a filing, release, data reference, exchange notice, or other evidence item that supports the reason the alert was created.
          </InfoCard>
          <InfoCard eyebrow="Evidence first" title="Why every serious alert needs receipts">
            Serious alerts should be explainable. Receipts make it easier to inspect the claim, judge the evidence quality, and separate source-backed information from unsupported market noise.
          </InfoCard>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <ListCard eyebrow="Strong receipts" title="Examples of strong receipts" items={strongReceipts} tone="strong" />
          <ListCard eyebrow="Weak receipts" title="Examples of weak receipts" items={weakReceipts} tone="weak" />
        </section>

        <section className="rounded-[2rem] border border-white/10 bg-white/[0.04] p-6 sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.24em] text-cyan-300">
            Source reliability
          </p>
          <h2 className="mt-3 text-2xl font-semibold text-white">What source reliability means</h2>
          <p className="mt-4 max-w-3xl leading-8 text-slate-300">
            Source reliability describes how much confidence a user should place in a receipt as evidence for an alert. It depends on source proximity, clarity, freshness, and whether the source can be checked independently.
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            {reliabilitySignals.map((signal) => (
              <div className="rounded-2xl border border-white/10 bg-slate-950/60 p-4 text-sm text-slate-300" key={signal}>
                {signal}
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          <InfoCard eyebrow="Labels" title="Why weak receipts are not hidden">
            Weak or incomplete receipts should be labelled, not hidden. Showing them with clear context helps users see where evidence is thin instead of pretending uncertainty does not exist.
          </InfoCard>
          <InfoCard eyebrow="Public trust" title="How receipts support public trust">
            Receipts give users a path to verify the alert trail. That transparency supports calmer review, better questions, and a clearer record of what evidence was available.
          </InfoCard>
          <InfoCard eyebrow="Limits" title="Why receipts do not guarantee future returns">
            A receipt can support why an alert exists, but markets can still move against the evidence. Receipts improve evidence quality, but they do not guarantee returns.
          </InfoCard>
        </section>
      </section>
    </main>
  );
}

function InfoCard({ eyebrow, title, children }: { eyebrow: string; title: string; children: React.ReactNode }) {
  return (
    <article className="rounded-[1.5rem] border border-white/10 bg-white/[0.04] p-6 shadow-xl shadow-slate-950/30">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300">{eyebrow}</p>
      <h2 className="mt-3 text-xl font-semibold text-white">{title}</h2>
      <p className="mt-4 leading-7 text-slate-300">{children}</p>
    </article>
  );
}

function ListCard({ eyebrow, title, items, tone }: { eyebrow: string; title: string; items: string[]; tone: "strong" | "weak" }) {
  const accent = tone === "strong" ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-200" : "border-amber-400/25 bg-amber-400/10 text-amber-200";

  return (
    <article className="rounded-[1.5rem] border border-white/10 bg-white/[0.04] p-6 shadow-xl shadow-slate-950/30 sm:p-7">
      <p className="text-xs font-semibold uppercase tracking-[0.22em] text-cyan-300">{eyebrow}</p>
      <h2 className="mt-3 text-2xl font-semibold text-white">{title}</h2>
      <div className="mt-5 grid gap-3">
        {items.map((item) => (
          <div className={`rounded-2xl border px-4 py-3 text-sm font-medium ${accent}`} key={item}>
            {item}
          </div>
        ))}
      </div>
    </article>
  );
}
