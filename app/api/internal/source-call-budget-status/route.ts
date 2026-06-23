import { NextResponse } from "next/server";
import { sourceCallBudgetStatus } from "@/lib/source-call-budget";

export async function GET() {
  const budgets = await sourceCallBudgetStatus();
  return NextResponse.json({ ok: true, generatedAt: new Date().toISOString(), budgets });
}
