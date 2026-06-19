const installSteps = [
  ["Open Swing Up in your mobile browser", "Use Safari on iPhone or Chrome on Android so the install prompt can use the browser's PWA support."],
  ["Choose Add to Home Screen or Install app", "The exact label depends on your device, but the result is a home-screen icon that opens Swing Up in an app-like window."],
  ["Keep notifications off until alerts are ready", "This build explains installation only. Real push notification delivery should stay gated until alert access and account controls are live."],
];

const readinessChecks = ["Manifest and app icons are present", "Offline route exists for basic fallback", "No app-store download is required", "Research-risk language still applies inside the installed app"];

export default function InstallAppPage() {
  return <div className="page">
    <section className="hero trust-hero"><div><div className="eyebrow">Build 96 · Mobile install</div><h1>Add Swing Up to your phone.</h1><p>Install the progressive web app shortcut so Swing Up is easier to open from a phone, without implying that mobile access changes the research-only nature of the product.</p></div><article className="card risk-callout"><span className="badge">PWA note</span><h2>No app store needed.</h2><p>Swing Up can be saved from the browser as a PWA-style shortcut. Browser support, icons, and install wording can vary by device.</p></article></section>
    <section className="grid two trust-section">{installSteps.map(([title, body], index) => <article className="card" key={title}><span className="badge">Step {index + 1}</span><h2>{title}</h2><p>{body}</p></article>)}</section>
    <section className="grid two trust-section"><article className="card"><span className="badge">Readiness</span><h2>What this page confirms</h2><div className="disclaimer-list">{readinessChecks.map((check) => <div className="metric" key={check}><span>{check}</span></div>)}</div></article><article className="card"><span className="badge">Boundary</span><h2>Installed does not mean personalized.</h2><p>Swing Up remains market research and decision-support information only. Users are responsible for their own decisions.</p></article></section>
  </div>;
}
