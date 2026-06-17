import { AlertCard } from "@/components/AlertCard";
import { mockAlerts } from "@/lib/mock-alerts";

export default function AlertsPage() {
  return <div className="page"><div className="eyebrow">Alert Feed</div><h1>Verified alerts</h1><p>Mock data powers the first product pass while integrations remain stubbed.</p><div className="grid">{mockAlerts.map((alert) => <AlertCard key={alert.id} alert={alert} compact />)}</div></div>;
}
