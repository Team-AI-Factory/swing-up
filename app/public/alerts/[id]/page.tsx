import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getPublicAlertDetail } from "@/lib/public-alert-detail";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: true },
};

export default async function PublicAlertPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getPublicAlertDetail(id);
  redirect(detail.canonicalPath ?? `/alerts/${id}`);
}
