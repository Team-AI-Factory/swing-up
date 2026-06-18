import { AlertCard } from "@/components/AlertCard";
import { getAlert } from "@/lib/mock-alerts";

export default async function AlertDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <div className="page"><AlertCard alert={getAlert(id)} /></div>;
}
