import { NextResponse } from "next/server";
import { AI_COMMITTEE_AGENTS } from "@/lib/ai-committee/agents";
import { getAiCommitteeProviderStatus } from "@/lib/ai-committee/provider";

export async function GET() {
  const providerStatus = getAiCommitteeProviderStatus();

  return NextResponse.json({
    ok: true,
    agents: AI_COMMITTEE_AGENTS,
    providerConfigured: providerStatus.configured,
    committeeEnabled: providerStatus.enabled,
    modelEnvStatus: providerStatus.modelEnvStatus,
    dryRunDefault: providerStatus.dryRunDefault,
    maxCostUsdPerRunConfigured: providerStatus.maxCostUsdPerRunConfigured,
  });
}
