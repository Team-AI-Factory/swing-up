import Link from "next/link";

const links = [
  ["Dashboard", "/dashboard"],
  ["Alerts", "/alerts"],
  ["Health", "/source-health"],
  ["Pricing", "/pricing"],
  ["Admin", "/admin"],
];

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="shell">
      <header className="nav">
        <div className="nav-inner">
          <Link href="/" className="brand"><span className="logo">↗</span><span>Swing Up</span></Link>
          <nav className="nav-links">{links.map(([label, href]) => <Link key={href} href={href}>{label}</Link>)}</nav>
          <div className="nav-actions"><Link className="button" href="/login">Log in</Link><Link className="button primary" href="/signup">Join</Link></div>
        </div>
      </header>
      <main>{children}</main>
    </div>
  );
}
