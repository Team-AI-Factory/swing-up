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
    [/semiconductor/i, "computer chips, or the equipment used to make them"],
    [/air freight|courier|logistic/i, "moving packages and cargo for customers"],
    [/investment bank|broker/i, "helping customers trade investments or raise money"],
    [/asset management|investment manager/i, "managing investments for customers"],
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
    [/restaurant/i, "preparing and selling food to customers"],
    [/apparel|footwear|textile/i, "clothing, footwear or the materials used to make them"],
    [/auto|motor vehicle/i, "vehicles, vehicle parts or related services"],
    [/construction|homebuild|building/i, "building homes or other structures, or supplying building products"],
    [/chemical/i, "chemicals used to make other products"],
    [/electronic|electrical/i, "electronic or electrical equipment"],
    [/oil|gas|energy/i, "energy, where fuel prices and production costs can affect earnings"],
    [/aerospace|defense/i, "aircraft, space or defense products and services"],
    [/transport|railroad|shipping/i, "moving people or goods"],
    [/telecom/i, "communication networks and services"],
    [/food|beverage/i, "food or drinks"],
    [/industrial|machinery/i, "equipment or services used by other businesses"],
  ];
  const definition = definitions.find(([pattern]) => pattern.test(category))?.[1];
  return definition ? `${company} works in ${definition}.`
    : category ? `${company} operates in ${category}. A more detailed description of its products and customers is still being collected.`
      : `${company} is the listed company being assessed. Its products and customers have not yet been verified in the available company profile.`;
}

const filingBoilerplate = /official (?:filing content|source)|securities and exchange commission|\b(?:8-k|10-k|10-q|6-k|424b\d)\b|\b(?:cik|edgar|registrant|accession|prospectus|exhibit\s+\d)|filed pursuant|commission file number|\.htm\b|sec\.gov|item\s+\d+\.\d+/i;

/** Translate known event facts; never put a filing header into a customer explanation. */
export function plainEventSummary(company: string, raw: unknown, headline?: unknown, family?: unknown) {
  const value = typeof raw === "string" ? raw.replace(/\s+/g, " ").trim().slice(0, 60_000) : "";
  if (value && !filingBoilerplate.test(value) && value.length <= 700) return value;
  const offering = value.match(/(?:we (?:are offering|offered)|offering of)\s+([\d,]+)\s+shares[\s\S]{0,450}?offering price of\s*(\$[\d,.]+)\s+per share/i);
  if (offering) return `${company} is offering ${offering[1]} shares at ${offering[2]} each. This would raise money for the business and increase the number of shares in circulation.`;
  const title = text(headline);
  if (title && !filingBoilerplate.test(title) && !/new (?:filing|company update)|issuer update|material event confirmed/i.test(title)) return title;
  const summaries: Record<string, string> = {
    earnings_guidance: "An update about sales, profits or the business outlook is being assessed. The size and direction of the change still need confirmation.",
    financing_dilution: "A financing update is being assessed for its effect on the company's cash, debt and number of shares.",
    contract_award: "A contract update is being assessed for its effect on future sales and profits.",
    merger_acquisition: "A business deal is being assessed for its effect on the company's value, costs and debt.",
    leadership_change: "A leadership update is being assessed for its effect on the company's plans and ability to deliver them.",
    regulatory_enforcement: "A legal or regulatory update is being assessed for possible costs or limits on the business.",
    regulatory_approval: "A regulatory decision is being assessed for whether it could change the company's ability to sell its products.",
    cyber_incident: "A technology or security incident is being assessed for disruption, recovery costs and customer impact.",
    product_launch: "A product update is being assessed for its effect on future customer demand and profits.",
  };
  return summaries[String(family)] ?? `An update involving ${company} is under review. The available evidence has not yet established a specific change to its business or the effect on its share price.`;
}

export function explainSignal(input: { company: string; industry?: unknown; sector?: unknown; description?: unknown; kind: "valuation" | "event"; action: string; price?: unknown; fairValue?: unknown; headline?: unknown; whatHappened?: unknown; eventFamily?: unknown; reasons?: unknown; gaps?: unknown; fundamentals?: unknown }) {
  const price = number(input.price), value = number(input.fairValue);
  const money = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  const companyDoes = explainCompany(input.company, input.industry, input.sector, input.description);
  const gaps = Array.isArray(input.gaps) ? input.gaps.filter((x): x is string => typeof x === "string").slice(0, 8) : [];
  const facts = object(input.fundamentals);
  const salesGrowth = number(facts.revenueGrowthTtmPercent), margin = number(facts.netMarginPercent);
  const businessFacts = [salesGrowth !== null ? `Sales over the latest 12 months ${salesGrowth >= 0 ? "grew" : "fell"} ${Math.abs(salesGrowth).toFixed(1)}%.` : "",
    margin !== null ? margin >= 0 ? `The business kept about ${margin.toFixed(1)}% of sales as profit.` : `The business lost about ${Math.abs(margin).toFixed(1)} for every 100 in sales.` : ""].filter(Boolean).join(" ");
  if (input.kind === "valuation") {
    const direction = price !== null && value !== null ? value > price ? "higher" : value < price ? "lower" : "unchanged" : null;
    const gap = price !== null && price > 0 && value !== null ? Math.abs((value / price - 1) * 100).toFixed(1) : null;
    return { companyDoes,
      whatHappened: price !== null && value !== null ? `The latest recorded share price is ${money(price)} and the model's base estimate of business value per share is ${money(value)}. This is a price-versus-value finding; a new company announcement has not been established.` : `The company screen identified business or valuation risks. A dependable price or fair-value estimate is still missing.`,
      whyItMatters: `${businessFacts} The model compares the share price with what the business may be worth, using its earnings, assets or cash generation. ${direction === "higher" ? "A lower share price could offer an opportunity if the business can sustain those results." : direction === "lower" ? "The current price asks investors to pay more than the model supports. If future results do not justify that price, the shares could fall." : "More evidence is needed to establish a dependable gap."}`.trim(),
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
    whatHappened: plainEventSummary(input.company, input.whatHappened, input.headline, input.eventFamily),
    whyItMatters: causes[text(input.eventFamily)] ?? "The update may affect the company's income, costs, finances or risks. The available evidence does not yet establish the size of that effect.",
    whatCouldHappen: direction === "uncertain" ? "The direction is still unclear. More evidence is needed before describing this as a buying or selling opportunity." : `The evidence points to possible ${direction} pressure on the share price if the expected business effect happens and is not already reflected in the price.`,
    whatCouldGoWrong: "The business effect may be smaller than expected, take longer, or already be reflected in the price. New facts can change the conclusion.",
    missingInformation: gaps,
  };
}

export function explainCandidate(candidate: Json, analysis?: Json) {
  const explanation = explainSignal({ company: text(candidate.company) || text(candidate.ticker), industry: analysis?.industry ?? candidate.industry, sector: analysis?.sector ?? candidate.sector,
    description: analysis?.businessDescription ?? candidate.businessDescription, kind: candidate.eventFamily === "valuation_gap" ? "valuation" : "event", action: text(candidate.direction),
    price: object(candidate.quote).price, fairValue: object(analysis?.fairValue ?? candidate.valuationRange).baseValue, headline: candidate.eventHeadline,
    whatHappened: candidate.whatHappened, eventFamily: candidate.eventFamily, gaps: candidate.failedGateChecks, fundamentals: analysis?.fundamentals });
  const reviewed = object(candidate.plainLanguageExplanation);
  for (const key of ["companyDoes", "whatHappened", "whyItMatters", "whatCouldHappen", "whatCouldGoWrong"] as const) {
    if (text(reviewed[key]) && !filingBoilerplate.test(text(reviewed[key]))) explanation[key] = text(reviewed[key]);
  }
  return explanation;
}

/** Also clean older saved alerts on read, without rewriting their historical review. */
export function publicExplanation(explanation: unknown, context: { company: string; industry?: unknown; sector?: unknown; headline?: unknown; eventFamily?: unknown }) {
  const saved = object(explanation);
  const companyDoes = text(saved.companyDoes);
  return {
    companyDoes: !companyDoes || filingBoilerplate.test(companyDoes) || (/not yet been verified|still being collected|is classified in/.test(companyDoes) && (context.industry || context.sector))
      ? explainCompany(context.company, context.industry, context.sector) : companyDoes,
    whatHappened: plainEventSummary(context.company, saved.whatHappened, context.headline, context.eventFamily),
    whyItMatters: filingBoilerplate.test(text(saved.whyItMatters)) ? "The effect on the company's income, costs and risks is still being assessed." : text(saved.whyItMatters),
    whatCouldHappen: filingBoilerplate.test(text(saved.whatCouldHappen)) ? "The possible price move still needs a supported explanation." : text(saved.whatCouldHappen),
    whatCouldGoWrong: filingBoilerplate.test(text(saved.whatCouldGoWrong)) ? "New facts or weaker business results could change this assessment." : text(saved.whatCouldGoWrong),
    missingInformation: plainEvidenceGaps(Array.isArray(saved.missingInformation) ? saved.missingInformation.filter((v): v is string => typeof v === "string") : []),
  };
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
    if (/budget|paid call|openai|capacity|same.event.*lock/i.test(gap)) return "The next AI review is waiting for the current review allowance to become available.";
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
