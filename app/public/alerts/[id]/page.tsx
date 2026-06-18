import { AlertCard } from "@/components/AlertCard";
import { getAlert } from "@/lib/mock-alerts";

export default async function PublicAlertPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const alert = getAlert(id);
  return <div className="page"><div className="badge">Public ledger view • delayed fields hidden in production</div><AlertCard alert={alert} /></div>;
}
