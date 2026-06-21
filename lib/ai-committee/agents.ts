export type AiCommitteeModelTier = "fast" | "deep" | "final";

export type AiCommitteeAgentDefinition = {
  id: string;
  displayName: string;
  purpose: string;
  inputRequirements: string[];
  outputSchema: Record<string, string>;
  modelTierPreference: AiCommitteeModelTier;
  required: boolean;
  maxOutputTokens: number;
};

const standardOutputSchema = {
  verdict: "pass | concern | fail | needs_more_data",
  confidence: "number from 0 to 100",
  findings: "short array of evidence-based findings",
  risks: "short array of relevant risks or blockers",
  missingData: "short array of missing inputs needed before publication",
};

export const AI_COMMITTEE_AGENTS: AiCommitteeAgentDefinition[] = [
  {
    id: "filing_agent",
    displayName: "Filing Agent",
    purpose: "Checks filings, disclosures, SEC events, Form 4/13F context, and other issuer or regulatory receipts.",
    inputRequirements: ["ticker or asset", "company or issuer name", "filing/disclosure receipts", "event timestamp", "source URLs"],
    outputSchema: standardOutputSchema,
    modelTierPreference: "deep",
    required: true,
    maxOutputTokens: 700,
  },
  {
    id: "accountant_agent",
    displayName: "Accountant Agent",
    purpose: "Checks revenue, margins, earnings quality, guidance, balance-sheet risk, and other fundamentals.",
    inputRequirements: ["financial metrics", "earnings/guidance context", "historical comparison", "source receipts"],
    outputSchema: standardOutputSchema,
    modelTierPreference: "deep",
    required: true,
    maxOutputTokens: 700,
  },
  {
    id: "valuation_dcf_agent",
    displayName: "Valuation / DCF Agent",
    purpose: "Checks valuation, target range support, upside/downside logic, and whether the catalyst is already priced in.",
    inputRequirements: ["current valuation", "peer or historical multiples", "upside/downside assumptions", "priced-in checks"],
    outputSchema: standardOutputSchema,
    modelTierPreference: "deep",
    required: true,
    maxOutputTokens: 750,
  },
  {
    id: "market_agent",
    displayName: "Market Agent",
    purpose: "Checks price, volume, reaction, trend, volatility, and market confirmation.",
    inputRequirements: ["price change", "volume data", "trend/volatility metrics", "market sentiment snapshot"],
    outputSchema: standardOutputSchema,
    modelTierPreference: "fast",
    required: true,
    maxOutputTokens: 550,
  },
  {
    id: "news_agent",
    displayName: "News Agent",
    purpose: "Checks whether the news is a real catalyst or headline noise.",
    inputRequirements: ["headline", "article/source receipts", "publication time", "known duplicates or contradictions"],
    outputSchema: standardOutputSchema,
    modelTierPreference: "fast",
    required: true,
    maxOutputTokens: 550,
  },
  {
    id: "macro_agent",
    displayName: "Macro Agent",
    purpose: "Checks rates, inflation, liquidity, GDP, FX, and sector pressure.",
    inputRequirements: ["macro snapshot", "sector exposure", "FX/rates context", "time horizon"],
    outputSchema: standardOutputSchema,
    modelTierPreference: "fast",
    required: false,
    maxOutputTokens: 500,
  },
  {
    id: "whale_flow_agent",
    displayName: "Whale / Flow Agent",
    purpose: "Checks large-position movement, crypto whale movement if available, and institutional or short pressure if available.",
    inputRequirements: ["flow/ownership data", "short interest if available", "large wallet or institutional movement", "availability caveats"],
    outputSchema: standardOutputSchema,
    modelTierPreference: "fast",
    required: false,
    maxOutputTokens: 500,
  },
  {
    id: "industry_agent",
    displayName: "Industry Agent",
    purpose: "Checks sector, competitors, supply chain, and industry cycle.",
    inputRequirements: ["sector", "competitor set", "supply-chain context", "industry-cycle indicators"],
    outputSchema: standardOutputSchema,
    modelTierPreference: "deep",
    required: true,
    maxOutputTokens: 650,
  },
  {
    id: "knock_on_ripple_agent",
    displayName: "Knock-On / Ripple Agent",
    purpose: "Checks suppliers, customers, competitors, ecosystem links, and ripple effects.",
    inputRequirements: ["supplier/customer links", "competitors", "ecosystem entities", "verified relationship receipts"],
    outputSchema: standardOutputSchema,
    modelTierPreference: "deep",
    required: false,
    maxOutputTokens: 650,
  },
  {
    id: "risk_agent",
    displayName: "Risk Agent",
    purpose: "Checks what could go wrong before any alert can advance.",
    inputRequirements: ["risk scores", "bear-case evidence", "contradictions", "known uncertainty"],
    outputSchema: standardOutputSchema,
    modelTierPreference: "deep",
    required: true,
    maxOutputTokens: 700,
  },
  {
    id: "skeptic_agent",
    displayName: "Skeptic Agent",
    purpose: "Challenges the alert and finds reasons it may be wrong.",
    inputRequirements: ["committee findings", "source receipts", "bull thesis", "risk and contradiction list"],
    outputSchema: standardOutputSchema,
    modelTierPreference: "deep",
    required: true,
    maxOutputTokens: 700,
  },
  {
    id: "compliance_agent",
    displayName: "Compliance Agent",
    purpose: "Blocks hype, unsafe wording, investment-advice style wording, and missing risk language.",
    inputRequirements: ["draft alert copy", "committee findings", "risk disclosures", "safe-action label"],
    outputSchema: { ...standardOutputSchema, blockedPhrases: "array of unsafe words or phrases to remove" },
    modelTierPreference: "deep",
    required: true,
    maxOutputTokens: 650,
  },
  {
    id: "explainer_agent",
    displayName: "Explainer Agent",
    purpose: "Turns committee output into simple plain English.",
    inputRequirements: ["committee findings", "final risk summary", "target audience", "safe-action label"],
    outputSchema: { summary: "plain-English summary", riskSummary: "plain-English risk summary", confidence: "number from 0 to 100" },
    modelTierPreference: "fast",
    required: true,
    maxOutputTokens: 550,
  },
  {
    id: "final_judge",
    displayName: "Final Judge",
    purpose: "Makes the final approval, reject, or needs_more_data decision before publishing.",
    inputRequirements: ["all required agent outputs", "source receipts", "compliance result", "cost/run metadata"],
    outputSchema: { decision: "approved | rejected | needs_more_data | blocked", rationale: "short evidence-based rationale", requiredFollowUp: "array of follow-up items", confidence: "number from 0 to 100" },
    modelTierPreference: "final",
    required: true,
    maxOutputTokens: 800,
  },
];
