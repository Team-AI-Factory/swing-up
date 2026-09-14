import Link from "next/link";

const links = [
  ["Research", "/research"],
  ["Methodology", "/methodology"],
  ["Pricing", "/pricing"],
];

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="shell">
      <header className="nav">
        <div className="nav-inner">
          <Link href="/" className="brand"><span className="logo">↗</span><span>Swing Up</span></Link>
          <nav className="nav-links">{links.map(([label, href]) => <Link key={href} href={href}>{label}</Link>)}</nav>
          <div className="nav-actions"><Link className="button primary" href="/signup">Early access</Link></div>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}
