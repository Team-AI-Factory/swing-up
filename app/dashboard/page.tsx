import { AlertCard } from "@/components/AlertCard";
import { mockAlerts } from "@/lib/mock-alerts";

export default function DashboardPage() { return <div className="page"><div className="eyebrow">Dashboard</div><h1>Command center</h1><div className="grid three"><div className="card"><span className="muted">Open alerts</span><div className="kpi">12</div></div><div className="card"><span className="muted">Avg confidence</span><div className="kpi">79</div></div><div className="card"><span className="muted">Tracked hit rate</span><div className="kpi">64%</div></div></div><h2 style={{marginTop:28}}>Priority alert</h2><AlertCard alert={mockAlerts[1]} compact /></div>; }
