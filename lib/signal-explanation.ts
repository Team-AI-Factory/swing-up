type Json = Record<string, unknown>;
const object = (v: unknown): Json => v && typeof v === "object" && !Array.isArray(v) ? v as Json : {};
const text = (v: unknown) => typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, 900) : "";
const number = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? v : null;

/** Descriptions explain the stored industry; they never invent a company's products. */
export function explainCompany(company: string, industry?: unknown, sector?: unknown, description?: unknown) {
  const verified = text(description);
  if (verified) return verified;
  const category = text(industry) || text(sector);
  const definitions: Array<[RegExp, string]> = [
    [/semiconductor/i, "the computer-chip industry, supplying chips or the equipment and services needed to make them"],
    [/software/i, "software: programs that help people or businesses carry out tasks"],
    [/bank/i, "banking, where businesses typically earn money from lending and financial services"],
    [/insurance/i, "insurance, collecting payments to cover agreed risks and claims"],
    [/real estate|reit/i, "property, where income can depend on rent, occupancy and property values"],
    [/pharma|biotech/i, "medicines and biotechnology, where research results and regulatory decisions can affect future sales"],
    [/medical|health/i, "healthcare products or services"],
    [/utility|utilities/i, "essential services such as electricity, gas or water"],
    [/alumin|steel|metal/i, "metals used to make buildings, machinery and other products"],
    [/plastic|packag/i, "materials used in packaging or manufactured products"],
    [/retail/i, "retail: selling products to customers"],
    [/oil|gas|energy/i, "energy, where fuel prices and production costs can affect earnings"],
    [/aerospace|defense/i, "aircraft, space or defense products and services"],
    [/transport|railroad|shipping/i, "moving people or goods"],
    [/telecom/i, "communication networks and services"],
    [/food|beverage/i, "food or drinks"],
    [/industrial|machinery/i, "equipment or services used by other businesses"],
  ];
  const definition = definitions.find(([pattern]) => pattern.test(category))?.[1];
  return definition ? `${company} is classified in ${category}. In plain language, this is ${definition}.`
    : category ? `${company} operates in ${category}. A more detailed description of its products and customers is still being collected.`
      : `${company} is the listed company being assessed. Its products and customers have not yet been verified in the available company profile.`;
}

export function explainSignal(input: { company: string; industry?: unknown; sector?: unknown; description?: unknown; kind: "valuation" | "event"; action: string; price?: unknown; fairValue?: unknown; headline?: unknown; whatHappened?: unknown; eventFamily?: unknown; reasons?: unknown; gaps?: unknown }) {
  const price = number(input.price), value = number(input.fairValue);
  const money = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  const companyDoes = explainCompany(input.company, input.industry, input.sector, input.description);
  const gaps = Array.isArray(input.gaps) ? input.gaps.filter((x): x is string => typeof x === "string").slice(0, 8) : [];
  const reasons = Array.isArray(input.reasons) ? input.reasons.filter((x): x is string => typeof x === "string").slice(0, 3) : [];
  if (input.kind === "valuation") {
    const direction = price !== null && value !== null ? value > price ? "higher" : value < price ? "lower" : "unchanged" : null;
    const gap = price !== null && price > 0 && value !== null ? Math.abs((value / price - 1) * 100).toFixed(1) : null;
    return { companyDoes,
      whatHappened: price !== null && value !== null ? `The latest recorded share price is ${money(price)} and the model's base estimate of business value per share is ${money(value)}. This is a price-versus-value finding; a new company announcement has not been established.` : `The company screen identified business or valuation risks. A dependable price or fair-value estimate is still missing.`,
      whyItMatters: `The model estimates what the business could be worth from its financial results and assumptions about its future. A price below that estimate may offer upside; a price above it may leave less room for mistakes. ${reasons.join(" ")}`.trim(),
      whatCouldHappen: gap && direction ? `If the assumptions prove sound and investors price the shares at the model's base value, the share price would be about ${gap}% ${direction}. This is a scenario, not a prediction of the size or timing of a move.` : "Further evidence is needed to estimate the possible direction and size of a price move.",
      whatCouldGoWrong: "The estimate can be wrong if profits, debt, cash generation or the model's assumptions change. A low price can also reflect real problems in the business.",
      missingInformation: gaps,
    };
  }
  const causes: Record<string, string> = {
    earnings_guidance: "A change in sales, costs or expected profits can change how much investors think the business is worth.",
    contract_award: "A contract can add future sales, but its size, delivery costs and profit margin determine how much shareholders benefit.",
    financing_dilution: "Issuing more shares can raise cash for the business while reducing each existing share's ownership percentage.",
    merger_acquisition: "A deal can change the company's value through the price paid, financing costs and the businesses being combined.",
    regulatory_enforcement: "Legal or regulatory problems can create costs, restrict sales or disrupt the business. An allegation is not the same as a proven violation.",
    regulatory_approval: "Regulatory permission may open a route to sales, but customer demand and commercial costs still matter.",
    leadership_change: "A management change may alter business strategy or create uncertainty about execution.",
    cyber_incident: "A technology or security incident can interrupt operations, create recovery costs and damage customer trust.",
    product_launch: "A new product may generate sales if customers adopt it; development and selling costs affect whether profits improve.",
  };
  const direction = /buy|upside/.test(input.action) ? "upward" : /sell|downside/.test(input.action) ? "downward" : "uncertain";
  return { companyDoes,
    whatHappened: text(input.whatHappened) || text(input.headline) || "The system detected a company update that requires further investigation.",
    whyItMatters: causes[text(input.eventFamily)] ?? "The update may affect the company's income, costs, finances or risks. The available evidence does not yet establish the size of that effect.",
    whatCouldHappen: direction === "uncertain" ? "The direction is still unclear. More evidence is needed before describing this as a buying or selling opportunity." : `The evidence points to possible ${direction} pressure on the share price if the expected business effect happens and is not already reflected in the price.`,
    whatCouldGoWrong: "The business effect may be smaller than expected, take longer, or already be reflected in the price. New facts can change the conclusion.",
    missingInformation: gaps,
  };
}

export function explainCandidate(candidate: Json, analysis?: Json) {
  const explanation = explainSignal({ company: text(candidate.company) || text(candidate.ticker), industry: analysis?.industry ?? candidate.industry, sector: analysis?.sector ?? candidate.sector,
    description: analysis?.businessDescription, kind: candidate.eventFamily === "valuation_gap" ? "valuation" : "event", action: text(candidate.direction),
    price: object(candidate.quote).price, fairValue: object(analysis?.fairValue).baseValue, headline: candidate.eventHeadline,
    whatHappened: candidate.whatHappened, eventFamily: candidate.eventFamily, gaps: candidate.failedGateChecks });
  const reviewed = object(candidate.plainLanguageExplanation);
  for (const key of ["companyDoes", "whatHappened", "whyItMatters", "whatCouldHappen", "whatCouldGoWrong"] as const) {
    if (text(reviewed[key])) explanation[key] = text(reviewed[key]);
  }
  return explanation;
}

export function committeeExplanation(findings: string[]) {
  const labels = { "Company:": "companyDoes", "What happened:": "whatHappened", "Why it matters:": "whyItMatters", "Possible outcome:": "whatCouldHappen", "Risks:": "whatCouldGoWrong" };
  const result: Record<string, string> = {};
  for (const finding of findings) for (const [prefix, key] of Object.entries(labels)) {
    if (finding.toLowerCase().startsWith(prefix.toLowerCase())) result[key] = text(finding.slice(prefix.length));
  }
  return result;
}

export function plainEvidenceGaps(gaps: string[]) {
  return [...new Set(gaps.map(gap => {
    if (/exhibit|source.*incomplete|sourceDocument|eventTruth/i.test(gap)) return "The complete original document or an attachment is still needed.";
    if (/price|quote|market.*fresh/i.test(gap)) return "A current share price is still needed.";
    if (/halt/i.test(gap)) return "We still need to confirm whether trading in this stock is paused.";
    if (/direction|causal|transmission/i.test(gap)) return "The effect on the business and share price is not yet clear.";
    if (/fundamental|financial|magnitude|material|valuationConfidence|EvidenceScore/i.test(gap)) return "More financial evidence is needed to judge the size or reliability of the opportunity.";
    if (/fresh|age|currentFoundation/i.test(gap)) return "Some evidence needs a more recent update.";
    if (/^[A-Za-z0-9_:.]+$/.test(gap)) return "The Committee needs another evidence check before approval.";
    return gap.replace(/_/g, " ").slice(0, 400);
  }))].slice(0, 6);
}
