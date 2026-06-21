import { NextResponse } from "next/server";
import { buildCoreProductContractAudit } from "@/lib/core-audit/core-product-contract-audit";

export async function GET() {
  const audit = await buildCoreProductContractAudit();
  return NextResponse.json(audit);
}
