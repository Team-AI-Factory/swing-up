import crypto from "node:crypto";
import { canonicalEventIdentity, computeEventFirstStrength, eventFirstGate, matchesEquityText as baselineMatchesEquityText, normalizeEquitySymbol, selectBalancedReceipts } from "@/lib/branch-signal-lab-policy";
import type { BranchNewsChannel } from "@/lib/branch-signal-lab-policy";
import { analyzeHistoricalAnalogs, type HistoricalSignalRecord } from "@/lib/equity-signal/historical-analogs";
import type { EquityUniverseEntry, EquityUniverseSnapshot } from "@/lib/equity-signal/universe";
import type { CausalExposureEvidence, EventFamily, EventMagnitudeEvidence, EventMagnitudeMetric, EventReceipt, ImpactCandidate, MacroContext } from "@/lib/equity-signal/types";

type ClassifiedEvent = {
  family: EventFamily;
  direction: "upside" | "downside" | "unknown";
  materiality: number;
  transmission: number;
  rumour: boolean;
  terms: string[];
};

type MappedEvent = {
  receipt: EventReceipt;
  classification: ClassifiedEvent;
  equity: EquityUniverseEntry;
  relationship: "direct" | "second_order" | "third_order";
  mappingConfidence: number;
  causalChain: string[];
  causalExposure: CausalExposureEvidence;
};

const NOISE = /\b(price target|technical analysis|stock picks?|stocks? to buy|should you buy|prediction|opinion|sponsored|top \d+ stocks?|(?:increases?|decreases?|reduces?|raises?|cuts?) (?:its )?(?:stake|position) in)\b/i;
const RUMOUR = /\b(rumou?r|reportedly considering|unconfirmed|sources? say|may be planning|could announce|speculation)\b/i;
const GENERIC_COMPANY_TOKENS = new Set(["american", "capital", "company", "corp", "digital", "energy", "financial", "first", "freedom", "general", "global", "group", "health", "holding", "holdings", "international", "joint", "national", "resources", "royal", "services", "systems", "technology", "technologies", "trust", "united", "world"]);
const ACTIVE_CONFLICT = /\b(military strikes?|airstrikes?|missile (?:attack|launch|strike)|invasion|armed conflict|shipping attack|red sea attack|hostilities|troops? (?:invade|deploy|mobilize)|war (?:erupts|escalates|breaks out|begins|widens|intensifies)|(?:declares?|declaration of) war|ceasefire (?:breaks|collapses)|conflict (?:erupts|escalates|widens|intensifies))\b/i;
const EXPOSURE_LINK = /\b(customer|supplier|vendor|sole[- ]source|depends? on|reliant on|exposure to|derives? (?:about |approximately )?\d+(?:\.\d+)?% (?:of )?(?:its )?revenue from|operations? in|manufactur(?:es|ing) in|sources? from|fuel costs?|input costs?|policy exposure|tariff exposure|commodity exposure)\b/i;
const MAGNITUDE_SENSITIVE_FAMILIES = new Set<EventFamily>(["contract_award", "financing_dilution", "earnings_guidance", "regulatory_enforcement"]);
const EXTERNAL_EXPOSURE_FAMILIES = new Set<EventFamily>(["macro_rates", "macro_inflation", "geopolitical_conflict", "sanctions_trade", "energy_commodity", "supply_chain"]);
const NON_ACTIONABLE_OFFERING = /\b(shelf|at-the-market|ATM program|proposed|planned|plans? to|intends? to|seeks? to|may offer|might offer|could offer|selling stockholder|secondary offering|secondary sale)\b/i;
const ACTIONABLE_OFFERING = /\b(priced|completed|closed|issued|company is issuing|commenced)\b/i;
const PROPOSED_OFFERING = /\b(?:announces?|launches?|proposes?|plans?|intends?|seeks?)\b.{0,100}?\b(?:proposed\s+)?(?:underwritten\s+)?(?:public|primary|share|equity|common stock|ordinary shares?|common shares?|american depositary shares?|ADSs?|pre-funded warrants?)?\s*offering\b|\bproposed\s+(?:underwritten\s+)?(?:public|primary|share|equity|common stock|ordinary shares?|common shares?|american depositary shares?|ADSs?|pre-funded warrants?)?\s*offering\b/i;
const SECONDARY_ONLY_OFFERING = /\b(?:selling (?:stockholders?|shareholders?)|(?:existing|certain) (?:stockholders?|shareholders?)|secondary offering|secondary sale|resale by (?:the )?(?:(?:selling|existing|certain) )?(?:stockholders?|shareholders?)|(?:stockholders?|shareholders?)\s+(?:(?:now|today|currently|reportedly)\s+)?(?:(?:proposes?|plans?|intends?|seeks?)\s+to\s+sell|announces?\s+(?:its\s+)?plans?\s+to\s+sell))\b/i;
const NO_ISSUER_PROCEEDS = /\b(?:we|the company|the issuer)\s+(?:(?:will|would|does|do)\s+not\s+receive\s+(?:(?:any(?:\s+of\s+the)?|the)\s+)?(?:net\s+)?proceeds|(?:will|would)\s+receive\s+(?:no|none\s+of\s+the)\s+(?:net\s+)?proceeds)\b|\b(?:no|none\s+of\s+the)\s+(?:net\s+)?proceeds\s+(?:will|would|are|is)\s+(?:be\s+)?received\s+by\s+(?:us|the company|the issuer)\b/i;
const HOLDER_SCOPED_NO_PROCEEDS = /\b(?:not receive|receive no|none of the)\b.{0,55}\b(?:from|on)\b.{0,65}\b(?:selling|existing|certain|holder|stockholder|shareholder)\b|\bno proceeds\b.{0,65}\b(?:selling|existing|certain|holder|stockholder|shareholder)\b|\b(?:selling|existing|certain|holder|stockholder|shareholder)\b.{0,65}\b(?:no proceeds|not receive)\b/i;
const NEW_ISSUER_EQUITY = /\b(?:newly issued|new)\s+(?:shares?|common stock|ordinary shares?|common shares?|american depositary shares?|ADSs?)\b/gi;
const SEC_EQUITY_PROSPECTUS_FORMS = new Set(["424B5", "424B3"]);
const ISSUER_OFFERING_START = /\b(?:we are offering|the company is offering|the issuer is offering)\b/gi;
const DIRECT_OFFERING_ACTION = /\bto\s+(?:offer|issue|sell)\b/gi;
const DIRECTLY_OFFERED_EQUITY = /\b(?:common stock|ordinary shares?|common shares?|american depositary shares?|ADSs?|equity securities|(?:new\s+)?shares?|convertible preferred stock|pre-funded warrants?|warrants?)\b/i;
const EQUITY_COMPOSED_UNITS = /\bunits?\s*,?\s*(?:(?:with\s+)?each(?:\s+unit)?\s+)?(?:consisting|comprised)\s+of\b.{0,120}\b(?:common stock|ordinary shares?|common shares?|american depositary shares?|ADSs?|shares?|pre-funded warrants?|warrants?)\b/i;
const DIRECTLY_OFFERED_DEBT = /\b(?:(?:convertible|senior|subordinated|secured|unsecured)\s+)*(?:notes?|debentures?|bonds?|debt securities)\b/i;
const EXPLICIT_EQUITY_OFFERING = /\b(?:share|equity|common stock|ordinary shares?|common shares?|american depositary shares?|ADSs?|pre-funded warrants?)\s+offering\b/i;
const CURRENT_ISSUER_EQUITY_OFFERING = /\b(?:common stock|ordinary shares?|common shares?|american depositary shares?|ADSs?|units?|pre-funded warrants?|convertible preferred stock)\b.{0,160}\b(?:are|is|will be)\s+(?:being\s+)?offered by us\b/i;
const NO_CURRENT_ISSUER_SUPPLY = /\b(?:none|no)\s+of\s+the\s+(?:shares|securities|units|common stock|common shares?|ordinary shares?|ADSs?)\s+(?:are|will be)\s+(?:being\s+)?(?:offered|sold)\s+by\s+us\b|\b(?:no|none of the)\s+(?:shares|securities|units|common stock|common shares?|ordinary shares?|ADSs?)\s+(?:are|is|will be)\s+(?:being\s+)?(?:offered|sold)\s+by\s+us\b|\b(?:the\s+)?(?:shares|securities|units|common stock|common shares?|ordinary shares?|ADSs?)\s+(?:are|is|will be)\s+not\s+(?:being\s+)?(?:offered|sold)\s+by\s+us\b|\b(?:we|the company|the issuer)\s+(?:are|is|will)\s+(?:not\s+(?:offering|selling)|offering\s+(?:no|none)\b)/i;
const CURRENT_FINAL_OFFERING = /\b(?:we|the company|the issuer)\s+(?:have|has)?\s*(?:priced|completed|closed)\s+(?:this|the|a|an)\s+(?:public|primary|underwritten|share|common stock)?\s*offering\b|\b(?:this|the|a|an)\s+(?:public|primary|underwritten|share|common stock)?\s*offering\s+(?:has been|was|is)\s+(?:priced|completed|closed)\b/i;
const CURRENT_OFFERING_PRICE_LABEL = /\b(?:combined\s+)?(?:public offering price|price to public|purchase price|subscription price)\b/gi;
const FDA_ADVISORY_VOTE = /\b(?:fda|food and drug administration)\b.{0,180}\b(?:advisory (?:committee|panel)|panel)\b.{0,120}\b(?:votes?|voted|recommends?|recommended)\b|\b(?:fda\s+)?(?:advisory (?:committee|panel)|panel)\b.{0,120}\b(?:votes?|voted|recommends?|recommended)\b/i;
const FDA_ADVISORY_DOWNSIDE = /\b(?:votes?|voted|recommends?|recommended)\s+(?:overwhelmingly\s+)?against\b|\b(?:insufficient|inadequate)\s+evidence\b|\b(?:does|do|did)\s+not\s+(?:support|demonstrate|show)\b|\bnot\s+(?:effective|efficacious)\b/i;
const FDA_ADVISORY_UPSIDE = /\b(?:votes?|voted)\s+(?:overwhelmingly\s+)?in\s+favou?r\b|\brecommends?\s+approval\b|\bevidence\s+(?:supports?|demonstrates?|shows?)\s+(?:effectiveness|efficacy)\b/i;
const FINAL_PRODUCT_REGULATORY_ACTION = /\b(?:fda|food and drug administration|health canada|european commission|ema|mhra)\b(?:\s+(?:has|today|formally|fully|conditionally|grants?\s+accelerated))*\s+(?:approves?|approved|authoriz(?:e|es|ed)|clears?|cleared|grants?\s+(?:accelerated\s+|full\s+|conditional\s+)?approval)\b|\b(?:receives?|received|wins?|won|secures?|secured|granted)\s+(?:(?:accelerated|full|conditional|marketing|emergency)\s+)?(?:approval|authorization|clearance)\s+(?:from|by)\s+(?:the\s+)?(?:fda|food and drug administration|health canada|european commission|ema|mhra)\b|\b(?:receives?|received|wins?|won|secures?|secured)\s+(?:fda|food and drug administration|health canada|ema|mhra)\s+(?:(?:accelerated|full|conditional|marketing|emergency)\s+)?(?:approval|authorization|clearance)\b/i;
const TRIAL_OR_FILING_CLEARANCE_ONLY = /\b(?:clearance|authorization|agreement|alignment)\b.{0,80}\b(?:to\s+)?(?:initiate|begin|start|conduct|proceed with|file|submit|prepare)\b.{0,100}\b(?:trial|study|phase\s+(?:1|2|3|i|ii|iii)|application|submission|nda|nds|bla)\b|\b(?:pre[- ]?(?:nda|nds|bla|submission)|pre-submission)\b|\b(?:targets?|plans?|expects?|intends?)\b.{0,80}\b(?:filing|submission)\b/i;
const NEGATED_FINAL_PRODUCT_ACTION = /\b(?:did|does|has|have|was|were|is|are)\s+not\b.{0,60}\b(?:approv|authoriz|clear|receiv)|\b(?:without|denied|declined|failed to secure|fails? to receive)\b.{0,60}\b(?:approval|authorization|clearance)\b/i;
const POSITIVE_PIVOTAL_RESULT = /\bphase\s+(?:2b?|3|ii|iii)\b.{0,180}\b(?:met\s+(?:(?:its|the)\s+)?(?:(?:pre[- ]?specified|key)\s+)?primary\s+endpoint|positive\s+(?:top[- ]?line|pivotal)\s+results?|statistically\s+significant\s+(?:improvement|benefit).{0,50}\bprimary\s+endpoint)\b/i;
const NON_FINAL_REGULATORY = /\b(investigation|investigating|subpoena|inquiry|proposed (?:fine|penalty|rule|order)|may fine|could fine)\b/i;
const UNCERTAIN_REGULATORY = /\b(?:possible|potential|may|might|could|faces?|seeks?|seeking|considering|discussion|negotiation|under consideration|reportedly|expected to)\b.{0,60}\b(?:charges?|penalt(?:y|ies)|fines?|settlement|lawsuit|class i recall|recall|clinical hold|complete response letter|approval denial|approval denied|rejected application|final (?:enforcement )?order)\b|\b(?:charges?|penalt(?:y|ies)|fines?|settlement|lawsuit|class i recall|recall|clinical hold|complete response letter|approval denial|approval denied|rejected application|final (?:enforcement )?order)\b.{0,40}\b(?:possible|potential|proposed|expected|considered|under discussion|under negotiation|under consideration)\b/i;
const FINAL_REGULATORY = /\b(final (?:enforcement )?(?:order|penalty|fine)|(?:sec|doj|ftc|regulator|government)\s+(?:charged|charges|sues)|lawsuit filed|settlement|agreed to pay|fined|class i recall|recall|clinical hold|complete response letter|approval denied|rejected application)\b/i;
const CATEGORICAL_SEVERE_REGULATORY = /\b(final (?:enforcement )?order|class i recall|recall|clinical hold|complete response letter|approval denied|rejected application|criminal charges? filed|indicted|(?:sec|doj|ftc)\s+(?:charged|charges|sues)|lawsuit filed)\b/i;
const COMPANY_EFFECT_DOWNSIDE = /\b(?:costs?|expenses?|loss(?:es)?|disruption(?: risk)?|shortage|downtime|tariffs?|penalt(?:y|ies)|fine|risk)\b.{0,55}\b(?:increase[sd]?|rise[sn]?|rising|surge[sd]?|widen[sd]?|pressure[sd]?|hurt[sd]?|reduce[sd]?|erode[sd]?|weigh(?:s|ed)? on|threaten[sd]?|adverse)\b|\b(?:increase[sd]?|higher|rising|surging|widening)\b.{0,40}\b(?:costs?|expenses?|loss(?:es)?|risk)\b|\b(?:revenue|sales|demand|profit|earnings|margins?|cash flow)\b.{0,55}\b(?:decrease[sd]?|fall[sn]?|decline[sd]?|drop(?:ped|s)?|contract(?:ed|s)?|pressure[sd]?|hurt[sd]?|reduce[sd]?|erode[sd]?|weigh(?:s|ed)? on)\b|\b(?:disruption risk|negative exposure|revenue at risk|adverse impact)\b/i;
const COMPANY_EFFECT_UPSIDE = /\b(?:revenue|sales|demand|profit|earnings|margins?|cash flow|net interest margin|NIM)\b.{0,55}\b(?:increase[sd]?|rise[sn]?|rising|grow(?:s|th|ing)?|expand(?:s|ed|ing)?|improve[sd]?|benefit(?:s|ed)?|boost(?:s|ed)?)\b|\b(?:increase[sd]?|higher|rising|growing|improving|boost(?:s|ed)?|support(?:s|ed)?|benefit(?:s|ed)?)\b.{0,20}\b(?:revenue|sales|demand|profit|earnings|margins?|cash flow|net interest margin|NIM)\b|\b(?:positive exposure|pricing benefit|higher reali[sz]ed prices?)\b/i;
const SINGLE_TOKEN_ISSUER_ACTIONS = "announces?|appoints?|awards?|closes?|completes?|cuts?|declares?|expands?|files?|guidance|launches?|merges?|raises?|recalls?|reports?|resigns?|secures?|shares?|stock|unveils?|wins?";

function escapedRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasSingleTokenIssuerContext(value: string, name: string) {
  const token = escapedRegExp(name);
  const issuerAction = new RegExp(`\\b${token}(?:['’]s)?\\s+(?:${SINGLE_TOKEN_ISSUER_ACTIONS})\\b`, "i");
  const marketContext = new RegExp(`\\b(?:shares?|stock|equity|ticker|earnings|guidance|filing)\\s+(?:(?:from|of|at|by|for)\\s+)?${token}\\b`, "i");
  return issuerAction.test(value) || marketContext.test(value);
}

function matchesDirectEquityText(value: string, equity: EquityUniverseEntry) {
  if (!baselineMatchesEquityText(value, equity)) return false;
  const ticker = normalizeEquitySymbol(equity.ticker);
  if (!ticker) return false;
  const escapedTicker = escapedRegExp(ticker);
  if (new RegExp(`\\$${escapedTicker}(?:\\b|(?=[.-]))`).test(value)) return true;
  if (new RegExp(`(?:^|[^A-Z0-9])${escapedTicker}(?:$|[^A-Z0-9])`).test(value)
    && /\b(?:shares?|stock|equity|ticker|nasdaq|nyse|earnings|guidance|investors?|filing|company)\b/i.test(value)) return true;

  const normalizedText = ` ${normalizedExact(value)} `;
  const names = [...new Set([equity.name, ...equity.aliases]
    .flatMap((name) => [normalizedExact(name), normalized(name)]))]
    .filter((name) => name.length >= 5)
    .filter((name) => name.includes(" ") || !GENERIC_COMPANY_TOKENS.has(name));
  if (names.some((name) => name.includes(" ") && normalizedText.includes(` ${name} `))) return true;
  return names.some((name) => !name.includes(" ")
    && normalizedText.includes(` ${name} `)
    && hasSingleTokenIssuerContext(value, name));
}

function selectEquityReceipts<T extends EventReceipt>(receipts: T[], limit: number) {
  return selectBalancedReceipts(
    receipts as unknown as Array<T & { channel: BranchNewsChannel }>,
    limit,
  ) as T[];
}

function canonicalEquityEventIdentity(receipt: EventReceipt) {
  return canonicalEventIdentity(receipt as EventReceipt & { channel: BranchNewsChannel });
}

function evidenceWindow(value: string, index: number, length: number) {
  return value.slice(Math.max(0, index - 90), Math.min(value.length, index + length + 90)).replace(/\s+/g, " ").trim();
}

function scaledNumber(raw: string, scale: string | undefined) {
  const value = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(value)) return null;
  const normalizedScale = (scale ?? "").toLowerCase();
  const multiplier = /^(?:billion|bn|b)$/.test(normalizedScale)
    ? 1_000_000_000
    : /^(?:million|mm|m)$/.test(normalizedScale)
      ? 1_000_000
      : /^(?:thousand|k)$/.test(normalizedScale)
        ? 1_000
        : 1;
  return value * multiplier;
}

function hasCurrentFixedOfferingPrice(value: string) {
  const labels = [...value.matchAll(CURRENT_OFFERING_PRICE_LABEL)];
  const label = labels[0];
  if (!label) return false;
  const tailStart = (label.index ?? 0) + label[0].length;
  const nextLabelStart = labels[1]?.index ?? tailStart + 180;
  const rawTail = value.slice(tailStart, Math.min(tailStart + 180, nextLabelStart));
  const sentenceBoundary = rawTail.search(/[.;]\s+/);
  const tail = sentenceBoundary >= 0 ? rawTail.slice(0, sentenceBoundary) : rawTail;
  const firstCurrency = tail.match(/(?:US\$|\$|USD|€|£)/i);
  if (!firstCurrency) return false;
  const currencyIndex = firstCurrency.index ?? 0;
  const afterCurrency = tail.slice(currencyIndex);
  const price = afterCurrency.match(/^(?:US\$|\$|USD\s*|€|£)\s*(\d[\d,]*(?:\.\d+)?)/i);
  if (!price) return false;
  const throughPrice = tail.slice(0, currencyIndex + price[0].length + 50);
  if (/\b(?:between|from|range|up to|vwap|volume-weighted|market price|lower of|greater of|lesser of|formula)\b|%\s+of\b/i.test(throughPrice)) return false;
  if (/^(?:US\$|\$|USD\s*|€|£)\s*\d[\d,]*(?:\.\d+)?\s*(?:-|–|—|to|through|and)\s*(?:US\$|\$|USD\s*|€|£)?\s*\d/i.test(afterCurrency)) return false;
  return true;
}

function offeringObject(value: string, maxLength = 240) {
  const raw = value.slice(0, maxLength);
  // A standard SEC unit description uses a composition comma ("units, each
  // consisting of..."). Preserve only that grammatical comma; reaction and
  // contextual comma clauses still terminate the offered object.
  const boundaryInput = raw.replace(
    /(\bunits?\s*),(?=\s*(?:(?:with\s+)?each(?:\s+unit)?\s+)?(?:consisting|comprised)\s+of\b)/i,
    (_match, units) => `${units} `,
  );
  const boundary = boundaryInput.search(/(?:,(?!\d)|;|[—–]|\.\s+)/);
  return boundary >= 0 ? raw.slice(0, boundary) : raw;
}

function offeredSecurityKind(value: string) {
  const object = offeringObject(value);
  // Notes remain debt even when described as equity-linked, common-stock-linked,
  // or convertible into shares later.
  if (DIRECTLY_OFFERED_DEBT.test(object)) return "debt" as const;
  if (DIRECTLY_OFFERED_EQUITY.test(object) || EQUITY_COMPOSED_UNITS.test(object)) return "equity" as const;
  return "other" as const;
}

function hasAffirmativeCurrentIssuerEquityOffering(value: string) {
  for (const start of value.matchAll(ISSUER_OFFERING_START)) {
    const tailStart = (start.index ?? 0) + start[0].length;
    const tail = value.slice(tailStart, tailStart + 320);
    if (/^\s+(?:no\b|none\b|not\b)/i.test(tail)) continue;
    if (offeredSecurityKind(tail) === "equity") return true;
  }
  return false;
}

function isProposedDilutiveOffering(value: string) {
  const proposal = value.match(PROPOSED_OFFERING);
  if (!proposal) return false;
  const proposalStart = proposal.index ?? 0;
  for (const action of proposal[0].matchAll(DIRECT_OFFERING_ACTION)) {
    const actionKind = offeredSecurityKind(proposal[0].slice((action.index ?? 0) + action[0].length));
    if (actionKind === "debt") return false;
    if (actionKind === "equity") return true;
  }
  const priorStart = Math.max(0, proposalStart - 240);
  const prior = value.slice(priorStart, proposalStart);
  const issuerStarts = [...prior.matchAll(ISSUER_OFFERING_START)];
  const issuerStart = issuerStarts.at(-1);
  if (issuerStart) {
    const afterIssuerStart = prior.slice((issuerStart.index ?? 0) + issuerStart[0].length);
    // Only bind the issuer phrase to this proposal when they are in the same
    // sentence; an older offering elsewhere in the receipt cannot lend it type.
    if (!/[.;]\s+/.test(afterIssuerStart)) {
      return offeredSecurityKind(value.slice(priorStart + (issuerStart.index ?? 0) + issuerStart[0].length)) === "equity";
    }
  }
  const remainder = value.slice(proposalStart + proposal[0].length, proposalStart + proposal[0].length + 180);
  const objectIntroduction = remainder.match(/^\s*(?:(?:of|for)\s+|(?::|-)\s*|to\s+(?:offer|issue|sell)\s+)/i);
  const remainderKind = objectIntroduction
    ? offeredSecurityKind(remainder.slice(objectIntroduction[0].length))
    : "other";
  if (remainderKind === "debt") return false;
  if (EXPLICIT_EQUITY_OFFERING.test(proposal[0])) return true;
  return remainderKind === "equity";
}

function hasExplicitIssuerEquityTranche(value: string) {
  const secondaryHolderIndex = value.search(SECONDARY_ONLY_OFFERING);
  for (const newIssuerEquity of value.matchAll(NEW_ISSUER_EQUITY)) {
    const newIssuerEquityIndex = newIssuerEquity.index ?? 0;
    const prefix = value.slice(Math.max(0, newIssuerEquityIndex - 100), newIssuerEquityIndex);
    const suffix = value.slice(newIssuerEquityIndex, newIssuerEquityIndex + 140);
    const negated = /\b(?:no|not|none|without|neither)\b[^.;,]{0,35}$/i.test(prefix);
    const tiedToIssuerAction = /\b(?:offering\s+of|to\s+(?:offer|issue|sell)|(?:will|would)\s+issue|(?:is|are)\s+issuing)\b[^.;,]{0,90}$/i.test(prefix);
    const assignedToHolder = /\b(?:(?:to be|being)\s+)?(?:sold|offered|resold|held)\s+by\s+(?:(?:selling|existing|certain)\s+)?(?:stockholders?|shareholders?)\b|\bfor resale by\s+(?:(?:selling|existing|certain)\s+)?(?:stockholders?|shareholders?)\b/i.test(suffix);
    // "New shares" overrides a later holder tranche only when an affirmative
    // issuer action owns the phrase. A nearby "no new shares" never does.
    if (!negated
      && !assignedToHolder
      && tiedToIssuerAction
      && (secondaryHolderIndex < 0 || newIssuerEquityIndex < secondaryHolderIndex)) return true;
  }
  for (const action of value.matchAll(/\b(?:(?:to|will|would)\s+issue|(?:is|are)\s+issuing)\b/gi)) {
    const tail = value.slice((action.index ?? 0) + action[0].length);
    if (/^\s+(?:no\b|none\b|not\b|neither\b)/i.test(tail)) continue;
    if (offeredSecurityKind(tail) === "equity") return true;
  }
  return false;
}

function isUnpricedPrimarySecEquityOffering(receipt: EventReceipt, value: string) {
  if (receipt.channel !== "sec_current_filings"
    || !receipt.official
    || !receipt.primarySource
    || !SEC_EQUITY_PROSPECTUS_FORMS.has((receipt.rawEventType ?? "").trim().toUpperCase())) {
    return false;
  }
  // SEC filing details prepend the current prospectus cover. Keep status and
  // price detection inside that bounded current-offering window so old ATM,
  // warrant, par-value, and prior-offering boilerplate cannot finalize it.
  const cover = value.slice(0, 6_000);
  const affirmativeIssuerTranche = hasAffirmativeCurrentIssuerEquityOffering(cover);
  const issuerSupply = affirmativeIssuerTranche || CURRENT_ISSUER_EQUITY_OFFERING.test(cover);
  if (!issuerSupply || (NO_CURRENT_ISSUER_SUPPLY.test(cover) && !affirmativeIssuerTranche)) return false;
  return !hasCurrentFixedOfferingPrice(cover) && !CURRENT_FINAL_OFFERING.test(cover);
}

function explicitCompanyEffectDirection(value: string) {
  const downside = COMPANY_EFFECT_DOWNSIDE.test(value);
  const upside = COMPANY_EFFECT_UPSIDE.test(value);
  if (downside === upside) return null;
  return downside ? "downside" as const : "upside" as const;
}

function regulatoryStatusIsFinal(value: string) {
  if (UNCERTAIN_REGULATORY.test(value)) return false;
  if (FINAL_REGULATORY.test(value)) return true;
  if (NON_FINAL_REGULATORY.test(value)) return false;
  return false;
}

function latestPromotionGradeStatusText(
  receipts: EventReceipt[],
  classifyStatus: (value: string) => "actionable" | "non_actionable" | null,
) {
  const classified = receipts.flatMap((receipt) => {
    const text = `${receipt.title} ${receipt.summary ?? ""}`;
    const status = classifyStatus(text);
    return status ? [{ receipt, text, status }] : [];
  });
  const constructions: Array<{ observedAt: number; text: string; status: "actionable" | "non_actionable" }> = classified
    .filter((item) => item.receipt.primarySource)
    .map((item) => ({ observedAt: Date.parse(item.receipt.publishedAt), text: item.text, status: item.status }));
  for (const status of ["actionable", "non_actionable"] as const) {
    const byPublisher = new Map<string, (typeof classified)[number]>();
    for (const item of classified.filter((value) => !value.receipt.primarySource && value.status === status)) {
      const publisher = item.receipt.publisher.trim().toLowerCase();
      const existing = byPublisher.get(publisher);
      if (!existing || Date.parse(item.receipt.publishedAt) > Date.parse(existing.receipt.publishedAt)) byPublisher.set(publisher, item);
    }
    if (byPublisher.size < 2) continue;
    const corroborated = [...byPublisher.values()];
    constructions.push({
      observedAt: Math.max(...corroborated.map((item) => Date.parse(item.receipt.publishedAt))),
      text: corroborated.map((item) => item.text).join(" "),
      status,
    });
  }
  return constructions
    .filter((item) => Number.isFinite(item.observedAt))
    .sort((left, right) => right.observedAt - left.observedAt)[0]?.text ?? "";
}

function latestFinancingStatusText(receipts: EventReceipt[]) {
  return latestPromotionGradeStatusText(receipts, (value) => {
    if (NON_ACTIONABLE_OFFERING.test(value)) return "non_actionable";
    if (ACTIONABLE_OFFERING.test(value)) return "actionable";
    return null;
  });
}

function latestRegulatoryStatusText(receipts: EventReceipt[]) {
  return latestPromotionGradeStatusText(receipts, (value) => {
    if (regulatoryStatusIsFinal(value)) return "actionable";
    if (NON_FINAL_REGULATORY.test(value) || UNCERTAIN_REGULATORY.test(value)) return "non_actionable";
    return null;
  });
}

function extractEventMagnitude(receipts: EventReceipt[], family: EventFamily): EventMagnitudeEvidence {
  const metrics: EventMagnitudeMetric[] = [];
  let nonActionableStatus = false;
  for (const receipt of receipts) {
    const value = `${receipt.title} ${receipt.summary ?? ""}`;
    const addMetric = (metric: Omit<EventMagnitudeMetric, "sourceReceiptId" | "sourceUrl" | "sourcePublisher" | "primarySource" | "corroboratingPublishers" | "promotionEvidenceVerified">) => {
      if (!Number.isFinite(metric.value) || metric.value <= 0) return;
      const duplicate = metrics.some((item) => item.sourceReceiptId === receipt.id
        && item.kind === metric.kind
        && item.value === metric.value
        && item.unit === metric.unit
        && item.eventStatus === metric.eventStatus);
      if (!duplicate) metrics.push({
        ...metric,
        sourceReceiptId: receipt.id,
        sourceUrl: receipt.url,
        sourcePublisher: receipt.publisher,
        primarySource: receipt.primarySource,
      });
    };

    if (family === "contract_award") {
      for (const match of value.matchAll(/\b(?:contract|award|purchase order|deal)[^.]{0,120}?\b(?:valued at|worth|committed (?:value )?(?:of )?|total (?:committed )?value (?:of )?)\s*(?:US\$|\$|USD\s*)\s?(\d[\d,]*(?:\.\d+)?)\s*(billion|million|thousand|bn|mm|[bmk])?\b/gi)) {
        const context = evidenceWindow(value, match.index ?? 0, match[0].length);
        const amount = scaledNumber(match[1], match[2]);
        const termMatch = context.match(/\b(\d+(?:\.\d+)?)\s*[- ]year\b/i);
        const ceiling = /\b(up to|ceiling|maximum|not to exceed|indefinite delivery|IDIQ)\b/i.test(context);
        if (ceiling) nonActionableStatus = true;
        if (amount !== null) addMetric({
          kind: "contract_value",
          value: amount,
          unit: "USD",
          evidenceText: context,
          termYears: termMatch ? Number(termMatch[1]) : null,
          eventStatus: ceiling ? "ceiling" : "committed",
        });
      }
      for (const match of value.matchAll(/\b(?:wins?|awarded)\s+(?:a\s+|the\s+)?(?:US\$|\$|USD\s*)\s?(\d[\d,]*(?:\.\d+)?)\s*(billion|million|thousand|bn|mm|[bmk])?\s+(?:contract|award|purchase order)\b/gi)) {
        const context = evidenceWindow(value, match.index ?? 0, match[0].length);
        const amount = scaledNumber(match[1], match[2]);
        const termMatch = context.match(/\b(\d+(?:\.\d+)?)\s*[- ]year\b/i);
        const ceiling = /\b(up to|ceiling|maximum|not to exceed|indefinite delivery|IDIQ)\b/i.test(context);
        if (ceiling) nonActionableStatus = true;
        if (amount !== null) addMetric({
          kind: "contract_value",
          value: amount,
          unit: "USD",
          evidenceText: context,
          termYears: termMatch ? Number(termMatch[1]) : null,
          eventStatus: ceiling ? "ceiling" : "committed",
        });
      }
    }

    if (family === "financing_dilution" || family === "financing_proposal") {
      const nonActionable = NON_ACTIONABLE_OFFERING.test(value);
      const secondaryOnly = SECONDARY_ONLY_OFFERING.test(value);
      const actionable = ACTIONABLE_OFFERING.test(value) && !nonActionable;
      if (nonActionable || !actionable) nonActionableStatus = true;
      for (const match of value.matchAll(/\b(?:priced|completed|closed|issued|primary offering of)[^.]{0,100}?(\d[\d,]*(?:\.\d+)?)\s*(billion|million|thousand|bn|mm|[bmk])?\s+(?:new |primary )?shares?\b/gi)) {
        const shares = scaledNumber(match[1], match[2]);
        if (shares !== null) addMetric({
          kind: "offering_shares",
          value: shares,
          unit: "shares",
          evidenceText: evidenceWindow(value, match.index ?? 0, match[0].length),
          eventStatus: actionable ? "priced" : secondaryOnly ? "secondary" : "proposed",
        });
      }
      for (const match of value.matchAll(/(?:\bdilution (?:of |is )?(\d+(?:\.\d+)?)%(?=\s|[.,;:]|$)|\b(\d+(?:\.\d+)?)%\s+dilution\b)/gi)) {
        const percent = Number(match[1] ?? match[2]);
        if (Number.isFinite(percent)) addMetric({
          kind: "dilution_percent",
          value: percent,
          unit: "percent",
          evidenceText: evidenceWindow(value, match.index ?? 0, match[0].length),
          eventStatus: actionable ? "priced" : secondaryOnly ? "secondary" : "proposed",
        });
      }
    }

    if (family === "earnings_guidance") {
      for (const match of value.matchAll(/\b(?:raises?|increases?|cuts?|reduces?|lowers?)\s+(?:its\s+)?(?:revenue |earnings |profit )?(?:guidance|outlook)\s+by\s+(\d+(?:\.\d+)?)%/gi)) {
        addMetric({ kind: "guidance_change_percent", value: Number(match[1]), unit: "percent", evidenceText: evidenceWindow(value, match.index ?? 0, match[0].length) });
      }
      for (const match of value.matchAll(/\b(?:revenue |earnings |profit )?(?:guidance|outlook)[^.]{0,80}?\bfrom\s+\$?(\d+(?:\.\d+)?)\s*(?:-|to)\s*\$?(\d+(?:\.\d+)?)[^.]{0,80}?\bto\s+\$?(\d+(?:\.\d+)?)\s*(?:-|to)\s*\$?(\d+(?:\.\d+)?)/gi)) {
        const oldMidpoint = (Number(match[1]) + Number(match[2])) / 2;
        const newMidpoint = (Number(match[3]) + Number(match[4])) / 2;
        const change = oldMidpoint > 0 ? Math.abs(((newMidpoint - oldMidpoint) / oldMidpoint) * 100) : 0;
        if (change > 0) addMetric({ kind: "guidance_change_percent", value: change, unit: "percent", evidenceText: evidenceWindow(value, match.index ?? 0, match[0].length) });
      }
    }

    if (family === "merger_acquisition") {
      for (const match of value.matchAll(/\b(?:acquisition|merger|transaction|deal)[^.]{0,100}?\b(?:valued at|worth|for)\s*(?:US\$|\$|USD\s*)\s?(\d[\d,]*(?:\.\d+)?)\s*(billion|million|thousand|bn|mm|[bmk])?\b/gi)) {
        const amount = scaledNumber(match[1], match[2]);
        if (amount !== null) addMetric({ kind: "transaction_value", value: amount, unit: "USD", evidenceText: evidenceWindow(value, match.index ?? 0, match[0].length) });
      }
    }

    if (family === "regulatory_enforcement") {
      const final = regulatoryStatusIsFinal(value);
      if (!final) nonActionableStatus = true;
      for (const match of value.matchAll(/\b(?:final (?:fine|penalty)|fined|penalty of|settlement of|agreed to pay)\s*(?:US\$|\$|USD\s*)\s?(\d[\d,]*(?:\.\d+)?)\s*(billion|million|thousand|bn|mm|[bmk])?\b/gi)) {
        const amount = scaledNumber(match[1], match[2]);
        if (amount !== null) addMetric({
          kind: "fine_value",
          value: amount,
          unit: "USD",
          evidenceText: evidenceWindow(value, match.index ?? 0, match[0].length),
          eventStatus: final ? "final" : "proposed",
        });
      }
    }
  }
  if (family === "contract_award") {
    nonActionableStatus = metrics.some((metric) => metric.kind === "contract_value" && metric.eventStatus === "ceiling")
      && !metrics.some((metric) => metric.kind === "contract_value" && metric.eventStatus === "committed");
  }
  if (family === "financing_dilution") {
    const latestStatus = latestFinancingStatusText(receipts);
    nonActionableStatus = !ACTIONABLE_OFFERING.test(latestStatus) || NON_ACTIONABLE_OFFERING.test(latestStatus);
  }
  if (family === "regulatory_enforcement") {
    const latestStatus = latestRegulatoryStatusText(receipts);
    nonActionableStatus = !regulatoryStatusIsFinal(latestStatus);
  }
  const metricsWithProvenance = metrics.map((metric) => {
    const matching = metrics.filter((other) =>
      other.kind === metric.kind
      && other.value === metric.value
      && other.unit === metric.unit
      && other.eventStatus === metric.eventStatus);
    const corroboratingPublishers = new Set(matching
      .map((item) => item.sourcePublisher?.trim().toLowerCase())
      .filter((value): value is string => Boolean(value))).size;
    return {
      ...metric,
      corroboratingPublishers,
      promotionEvidenceVerified: matching.some((item) => item.primarySource === true) || corroboratingPublishers >= 2,
    };
  });
  const sensitive = MAGNITUDE_SENSITIVE_FAMILIES.has(family);
  return {
    status: nonActionableStatus && sensitive
      ? "non_actionable_status"
      : metrics.length
        ? "absolute_only"
        : sensitive
          ? "unquantified"
          : "not_required",
    metrics: metricsWithProvenance.slice(0, 8),
    relativeToCompany: null,
    materialityBasis: metricsWithProvenance.length
      ? "An explicit event magnitude was extracted from the same evidence construction; company-relative scale is added only from compatible, current SEC facts."
      : sensitive
        ? "No promotion-grade quantitative magnitude was extracted. The finding may be retained for diagnostic outcome tracking, but it cannot become serious yet."
        : "This event family does not require a numeric company-scale denominator; its current categorical evidence is assessed directly.",
  };
}

function directExposure(receipt: EventReceipt, classification: ClassifiedEvent, equity: EquityUniverseEntry): CausalExposureEvidence {
  const value = `${receipt.title}. ${receipt.summary ?? ""}`;
  const exposureSentence = value
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .find((sentence) => EXPOSURE_LINK.test(sentence) && matchesDirectEquityText(sentence, equity));
  const eventSpecific = EXTERNAL_EXPOSURE_FAMILIES.has(classification.family) && Boolean(exposureSentence);
  const exposurePercent = Number(exposureSentence?.match(/\b(\d+(?:\.\d+)?)%(?=\s|[.,;:]|$)/)?.[1] ?? NaN);
  const sensitivityDirection = exposureSentence ? explicitCompanyEffectDirection(exposureSentence) : null;
  const promotionGrade = Boolean(exposureSentence)
    && Boolean(sensitivityDirection)
    && (Number.isFinite(exposurePercent) && exposurePercent >= 10 || /\bsole[- ]source\b/i.test(exposureSentence!));
  if (eventSpecific && exposureSentence) {
    return {
      status: "event_specific",
      exposureType: /\b(customer|revenue from)\b/i.test(exposureSentence)
        ? "customer"
        : /\b(supplier|vendor|sources? from)\b/i.test(exposureSentence)
          ? "supplier"
          : /\b(operations? in|manufactur(?:es|ing) in)\b/i.test(exposureSentence)
            ? "geography"
            : /\b(fuel|input|commodity)\b/i.test(exposureSentence)
              ? "commodity"
              : "policy",
      confidence: promotionGrade ? 96 : 88,
      evidenceText: exposureSentence.slice(0, 500),
      sourceUrl: receipt.url,
      // This flag describes whether the receipt contains promotion-grade
      // exposure evidence. The cluster-level aggregator separately requires
      // either a primary source or two independent publishers.
      eligibleForSeriousSignal: promotionGrade,
      sourceReceiptId: receipt.id,
      publisher: receipt.publisher,
      publishedAt: receipt.publishedAt,
      expiresAt: new Date(Date.parse(receipt.publishedAt) + 180 * 24 * 60 * 60 * 1000).toISOString(),
      sensitivityDirection,
    };
  }
  if (EXTERNAL_EXPOSURE_FAMILIES.has(classification.family)) {
    return {
      status: "generic_sector_proxy",
      exposureType: "sector_proxy",
      confidence: 96,
      evidenceText: `${equity.name} is mentioned in the external event, but the current receipt does not prove a company-specific exposure size and effect direction.`,
      sourceUrl: receipt.url,
      eligibleForSeriousSignal: false,
      sourceReceiptId: receipt.id,
      publisher: receipt.publisher,
      publishedAt: receipt.publishedAt,
      expiresAt: new Date(Date.parse(receipt.publishedAt) + 180 * 24 * 60 * 60 * 1000).toISOString(),
      sensitivityDirection: null,
    };
  }
  return {
    status: "direct_issuer",
    exposureType: "direct",
    confidence: 99,
    evidenceText: `${equity.name} is directly and exactly mapped to the current issuer event.`,
    sourceUrl: receipt.url,
    eligibleForSeriousSignal: true,
    sourceReceiptId: receipt.id,
    publisher: receipt.publisher,
    publishedAt: receipt.publishedAt,
    expiresAt: null,
    sensitivityDirection: classification.direction === "unknown" ? null : classification.direction,
  };
}

function classify(receipt: EventReceipt): ClassifiedEvent {
  const titleValue = `${receipt.title} ${receipt.rawEventType ?? ""}`.toLowerCase();
  const summary = (receipt.summary ?? "").toLowerCase();
  const filingMarker = "official filing content:";
  const filingContentIndex = summary.indexOf(filingMarker);
  // Detailed SEC receipts can contain thousands of characters of footnotes,
  // risk factors, and historical disclosures after the current event. Keep
  // classification anchored to the filing introduction and the beginning of
  // the event exhibit. Magnitude extraction still receives the full receipt.
  const classificationSummary = receipt.channel === "sec_current_filings" && filingContentIndex >= 0
    ? `${summary.slice(0, filingContentIndex)} ${summary.slice(filingContentIndex + filingMarker.length, filingContentIndex + filingMarker.length + 6_000)}`
    : summary;
  const value = `${titleValue} ${classificationSummary}`;
  // Regulatory decisions are especially vulnerable to boilerplate. A filing
  // about preparing an application can later mention already-approved drugs or
  // an old clearance to start a trial. Only the current lead section may prove
  // a final product decision or a genuinely positive pivotal readout.
  const regulatoryLead = `${titleValue} ${classificationSummary.slice(0, 3_500)}`;
  const pivotalResultLead = `${titleValue} ${classificationSummary.slice(0, 1_500)}`;
  const finalProductAction = regulatoryLead.match(FINAL_PRODUCT_REGULATORY_ACTION);
  const finalActionContext = finalProductAction?.index === undefined
    ? ""
    : regulatoryLead.slice(Math.max(0, finalProductAction.index - 100), finalProductAction.index + finalProductAction[0].length + 260);
  const rumour = RUMOUR.test(value) && !receipt.primarySource;
  const hit = (pattern: RegExp) => pattern.test(value);
  const titleHit = (pattern: RegExp) => pattern.test(titleValue);
  if (isUnpricedPrimarySecEquityOffering(receipt, value)) return { family: "financing_proposal", direction: "downside", materiality: 75, transmission: 80, rumour, terms: ["current issuer equity supply with final price terms still unobserved"] };
  const proposedDilutiveOffering = isProposedDilutiveOffering(value);
  if (proposedDilutiveOffering) {
    const explicitIssuerTranche = hasExplicitIssuerEquityTranche(value);
    const secondaryHolderMention = hit(SECONDARY_ONLY_OFFERING);
    const issuerNoProceeds = hit(NO_ISSUER_PROCEEDS);
    const holderScopedNoProceeds = hit(HOLDER_SCOPED_NO_PROCEEDS);
    if ((!secondaryHolderMention || explicitIssuerTranche)
      && (!issuerNoProceeds || (explicitIssuerTranche && holderScopedNoProceeds))) {
      return { family: "financing_proposal", direction: "downside", materiality: 75, transmission: 80, rumour, terms: ["potential new share supply before final terms"] };
    }
  }
  if (hit(/\b(primary offering|secondary offering|public offering|share offering|shelf offering|shelf registration|at-the-market offering|dilution|bankruptcy|chapter 11)\b/)) return { family: "financing_dilution", direction: "downside", materiality: 88, transmission: 91, rumour, terms: ["new supply or solvency pressure"] };
  if (hit(/\b(cyberattack|ransomware|data breach|security breach|systems? outage|hack(?:ed|ing)?)\b/)) return { family: "cyber_incident", direction: "downside", materiality: 82, transmission: 84, rumour, terms: ["operational disruption", "remediation and trust cost"] };
  if (hit(FDA_ADVISORY_VOTE)) {
    const direction = hit(FDA_ADVISORY_DOWNSIDE) ? "downside" : hit(FDA_ADVISORY_UPSIDE) ? "upside" : "unknown";
    return { family: "regulatory_advisory", direction, materiality: 90, transmission: 90, rumour, terms: ["material FDA advisory vote before a final agency decision"] };
  }
  if ((finalProductAction && !TRIAL_OR_FILING_CLEARANCE_ONLY.test(finalActionContext) && !NEGATED_FINAL_PRODUCT_ACTION.test(finalActionContext))
    || POSITIVE_PIVOTAL_RESULT.test(pivotalResultLead)) {
    return { family: "regulatory_approval", direction: "upside", materiality: 92, transmission: 94, rumour, terms: ["official product approval or positive pivotal result"] };
  }
  if (hit(/\b(recall|clinical hold|complete response letter|approval denied|rejected application)\b/)) return { family: "regulatory_enforcement", direction: "downside", materiality: 90, transmission: 93, rumour, terms: ["regulatory setback or recall"] };
  // A signed transaction is the primary event even when an attached earnings
  // release also discusses litigation or other historical expenses.
  if (hit(/\b(acquisition completed|merger approved|definitive (?:merger|acquisition) agreement|to be acquired|acquire[sd]? for \$)\b/)) return { family: "merger_acquisition", direction: "upside", materiality: 89, transmission: 86, rumour, terms: ["transaction value crystallisation"] };
  if (hit(/\b(beat(?:s|ing)? expectations|raises? guidance|guidance raised|record revenue|profit surge|better than expected|upgrades? outlook)\b/)) return { family: "earnings_guidance", direction: "upside", materiality: 82, transmission: 88, rumour, terms: ["earnings or guidance positive surprise"] };
  if (hit(/\b(miss(?:es|ed)? expectations|cuts? guidance|guidance cut|profit warning|revenue warning|worse than expected|downgrades? outlook)\b/)) return { family: "earnings_guidance", direction: "downside", materiality: 84, transmission: 89, rumour, terms: ["earnings or guidance negative surprise"] };
  // A headline that is plainly about issuer earnings or guidance must not be
  // reclassified by an incidental tariff, sanctions, or macro sentence in the
  // article summary. A range without a verified raise/cut remains directionless.
  if (titleHit(/\b(?:forecasts?|guides?|provides?|updates?|reaffirms?|reports?)\b.{0,90}\b(?:adjusted\s+)?(?:eps|earnings|revenue|sales|organic growth|guidance|outlook)\b|\b(?:eps|earnings|revenue|sales|guidance|outlook)\b.{0,70}\b(?:forecast|range|guidance|outlook)\b/)
    || hit(/\b(?:reports?|announces?)\b.{0,100}\b(?:(?:first|second|third|fourth)\s+quarter|quarterly|fiscal|financial|operating)\b.{0,70}\bresults\b/)) {
    return { family: "earnings_guidance", direction: "unknown", materiality: 72, transmission: 78, rumour, terms: ["issuer earnings or guidance range without a verified directional change"] };
  }
  if (hit(/\b(sec (?:charges?|charged)|doj (?:charges?|charged)|ftc sues|investigation|subpoena|enforcement action|final (?:enforcement )?order|antitrust suit|fine[ds]?|penalt(?:y|ies)|settlement|sanctioned)\b/)) return { family: "regulatory_enforcement", direction: "downside", materiality: 82, transmission: 85, rumour, terms: ["enforcement or legal burden"] };
  if (hit(/\b(contract award|awarded (?:a |the )?contract|wins? contract|selected by|purchase order|multi-year deal)\b|\b(?:wins?|awarded)\s+(?:a\s+|the\s+)?(?:US\$|\$|USD\s*)\s?\d[\d,]*(?:\.\d+)?\s*(?:billion|million|thousand|bn|mm|[bmk])?\s+(?:contract|award|purchase order)\b/)) return { family: "contract_award", direction: "upside", materiality: 77, transmission: 84, rumour, terms: ["incremental contracted revenue"] };
  if (hit(/\b(product launch|launches|unveils|announces? (?:a )?new (?:product|platform|model|chip)|keynote|developer conference|investor day)\b/)) return { family: hit(/conference|keynote|investor day/) ? "live_conference" : "product_launch", direction: "upside", materiality: 68, transmission: 72, rumour, terms: ["new product or commercial catalyst"] };
  if (hit(/\b(ai breakthrough|artificial intelligence breakthrough|new ai model|foundation model|quantum breakthrough|technology breakthrough|scientific breakthrough)\b/)) return { family: hit(/\bai\b|artificial intelligence/) ? "ai_breakthrough" : "technology_breakthrough", direction: "upside", materiality: 76, transmission: 78, rumour, terms: ["technical capability improvement", "potential demand or cost advantage"] };
  if (hit(/\b(ceo resigns?|chief executive resigns?|cfo resigns?|removes? (?:its )?ceo|leadership shakeup)\b/)) return { family: "leadership_change", direction: "downside", materiality: 67, transmission: 72, rumour, terms: ["leadership uncertainty"] };
  if (hit(/\b(federal reserve|fomc|interest rate|rate hike|rate cut|treasury yields?)\b/)) {
    const direction = hit(/\b(rate hike|raises? rates?|higher for longer|hawkish|yield(?:s)? (?:jump|surge|rise))\b/) ? "downside" : hit(/\b(rate cut|cuts? rates?|dovish|yield(?:s)? (?:fall|drop))\b/) ? "upside" : "unknown";
    return { family: "macro_rates", direction, materiality: 82, transmission: 78, rumour, terms: ["discount-rate and financing-cost transmission"] };
  }
  if (hit(/\b(cpi|pce|inflation|consumer prices?|producer prices?)\b/)) {
    const direction = hit(/\b(hotter|accelerat|above expectations|inflation rises?|prices? surge)\b/) ? "downside" : hit(/\b(cooler|decelerat|below expectations|inflation falls?|disinflation)\b/) ? "upside" : "unknown";
    return { family: "macro_inflation", direction, materiality: 78, transmission: 73, rumour, terms: ["inflation surprise", "policy-rate repricing"] };
  }
  if (hit(/\b(payrolls?|jobs report|unemployment|jobless claims?|employment report)\b/)) return { family: "macro_employment", direction: "unknown", materiality: 72, transmission: 65, rumour, terms: ["growth and policy expectations"] };
  if (hit(ACTIVE_CONFLICT)) return { family: "geopolitical_conflict", direction: "downside", materiality: 88, transmission: 82, rumour, terms: ["risk-off shock", "energy and logistics disruption"] };
  if (hit(/\b(sanctions?|export controls?|tariffs?|trade restrictions?|import ban|capital controls?)\b/)) return { family: "sanctions_trade", direction: "downside", materiality: 83, transmission: 80, rumour, terms: ["market-access or supply-chain restriction"] };
  if (hit(/\b(oil|crude|opec|natural gas|lng|pipeline)\b.*\b(surge|spike|cut|disruption|embargo|shortage)\b/)) return { family: "energy_commodity", direction: "upside", materiality: 80, transmission: 82, rumour, terms: ["commodity price and input-cost shock"] };
  if (receipt.official && ["white_house", "treasury", "federal_register"].includes(receipt.channel)) return { family: "government_announcement", direction: "unknown", materiality: 65, transmission: 60, rumour: false, terms: ["official government action"] };
  if (receipt.rawEventType === "4" || /\bform 4\b/.test(value)) return { family: "insider_ownership", direction: "unknown", materiality: 55, transmission: 55, rumour: false, terms: ["insider transaction filing"] };
  return { family: "other_material", direction: "unknown", materiality: 45, transmission: 45, rumour, terms: [] };
}

function normalized(value: string) {
  return value.toLowerCase().replace(/\b(?:incorporated|inc|corporation|corp|company|co|limited|ltd|plc|holdings?|group)\b/g, " ").replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function normalizedExact(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function companyKeys(value: string) {
  return [...new Set([normalizedExact(value), normalized(value)])]
    .filter((key) => key.length >= 5)
    .filter((key) => key.includes(" ") || !GENERIC_COMPANY_TOKENS.has(key));
}

function buildIndex(entries: EquityUniverseEntry[]) {
  const ticker = new Map(entries.map((entry) => [entry.ticker, entry]));
  const cik = new Map<string, EquityUniverseEntry[]>();
  const aliases = new Map<string, EquityUniverseEntry[]>();
  const tokens = new Map<string, EquityUniverseEntry[]>();
  for (const entry of entries) {
    if (entry.cik) cik.set(entry.cik, [...(cik.get(entry.cik) ?? []), entry]);
    for (const alias of [entry.name, ...entry.aliases]) {
      for (const key of companyKeys(alias)) aliases.set(key, [...(aliases.get(key) ?? []), entry]);
      const first = normalizedExact(alias).split(" ").find((token) => token.length >= 4 && !GENERIC_COMPANY_TOKENS.has(token));
      if (first) tokens.set(first, [...(tokens.get(first) ?? []), entry]);
    }
  }
  return { ticker, cik, aliases, tokens };
}

function mapDirect(receipt: EventReceipt, index: ReturnType<typeof buildIndex>) {
  const mapped = new Map<string, { equity: EquityUniverseEntry; confidence: number }>();
  for (const hint of receipt.symbolHints) {
    const symbol = normalizeEquitySymbol(hint);
    const equity = symbol ? index.ticker.get(symbol) : null;
    if (equity) mapped.set(equity.ticker, { equity, confidence: 99 });
  }
  // Structured ticker hints are more specific than shared issuer names. Once a
  // known ticker is present, do not fan the receipt out to preferred shares,
  // notes, or similarly named securities through the looser alias scan.
  if (mapped.size > 0) return [...mapped.values()];
  const structuredCikHints = receipt.companyHints.flatMap((hint) => hint.match(/^CIK(\d{10})$/i)?.[1] ?? []);
  for (const cik of structuredCikHints) {
    const cikEntries = index.cik.get(cik) ?? [];
    const primaryEntries = cikEntries.filter((candidate) => !cikEntries.some((other) =>
      other.ticker !== candidate.ticker
      && ["W", "WS", "WT", "R", "U"].some((suffix) => candidate.ticker === `${other.ticker}${suffix}`)));
    for (const equity of primaryEntries) mapped.set(equity.ticker, { equity, confidence: 100 });
  }
  // The SEC CIK identifies the filer authoritatively. Text inside the filing
  // can name customers, targets, vendors, products, and competitors; none of
  // those mentions makes another listed company a direct issuer.
  if (receipt.channel === "sec_current_filings" && receipt.official && receipt.primarySource && structuredCikHints.length > 0) {
    return [...mapped.values()];
  }
  for (const hint of receipt.companyHints) {
    const cikMatch = hint.match(/^CIK(\d{10})$/i)?.[1];
    if (cikMatch) continue;
    for (const key of companyKeys(hint)) for (const equity of index.aliases.get(key) ?? []) mapped.set(equity.ticker, { equity, confidence: 98 });
  }
  // Structured company identities are stronger than free-text mentions. Stop
  // before scanning the article or filing body once any exact identity maps.
  // An official SEC filing with an unrecognized filer also fails closed: its
  // body can never donate direct-issuer status to a merely mentioned company.
  if (mapped.size > 0 || (receipt.channel === "sec_current_filings" && receipt.official && receipt.primarySource)) return [...mapped.values()];
  const sourceText = `${receipt.title} ${receipt.summary ?? ""}`;
  const sourceTokens = new Set(normalized(sourceText).split(" ").filter((token) => token.length >= 4));
  const possible = new Map<string, EquityUniverseEntry>();
  for (const token of sourceTokens) for (const equity of index.tokens.get(token) ?? []) possible.set(equity.ticker, equity);
  for (const equity of possible.values()) if (matchesDirectEquityText(sourceText, equity)) mapped.set(equity.ticker, { equity, confidence: Math.max(mapped.get(equity.ticker)?.confidence ?? 0, 96) });
  return [...mapped.values()];
}

const RIPPLE_RULES: Array<{ families: EventFamily[]; require?: RegExp; tickers: string[]; direction: "upside" | "downside"; chain: string[] }> = [
  { families: ["geopolitical_conflict"], tickers: ["XOM", "CVX", "COP", "OXY", "LMT", "NOC", "RTX", "GD"], direction: "upside", chain: ["conflict escalation", "energy/defence demand and risk premium", "producer/contractor earnings sensitivity"] },
  { families: ["geopolitical_conflict", "energy_commodity"], tickers: ["DAL", "UAL", "AAL", "CCL", "RCL"], direction: "downside", chain: ["energy or route disruption", "fuel/logistics cost increase", "transport and travel margin pressure"] },
  { families: ["energy_commodity"], tickers: ["XOM", "CVX", "COP", "OXY", "EOG", "SLB", "HAL"], direction: "upside", chain: ["oil/gas supply shock", "higher realised commodity price", "energy cash-flow sensitivity"] },
  { families: ["sanctions_trade"], require: /\b(chip|semiconductor|china|taiwan|export control)\b/i, tickers: ["NVDA", "AMD", "AVGO", "QCOM", "MU", "AMAT", "LRCX", "KLAC", "TSM", "ASML"], direction: "downside", chain: ["technology trade restriction", "addressable-market or supply constraint", "semiconductor revenue/cost exposure"] },
  { families: ["sanctions_trade"], require: /\b(steel|aluminum|tariff|import)\b/i, tickers: ["NUE", "STLD", "CLF", "X"], direction: "upside", chain: ["import restriction", "domestic pricing support", "producer margin sensitivity"] },
  { families: ["macro_rates", "macro_inflation"], tickers: ["NVDA", "AMD", "CRM", "SNOW", "PLTR", "TSLA"], direction: "downside", chain: ["higher expected rates", "higher discount rate", "long-duration valuation pressure"] },
  { families: ["macro_rates", "macro_inflation"], tickers: ["JPM", "BAC", "WFC", "C", "GS", "MS"], direction: "upside", chain: ["higher expected rates", "net-interest-margin repricing", "large-bank earnings sensitivity"] },
  { families: ["cyber_incident"], require: /\b(widespread|critical infrastructure|government|multiple companies|supply chain)\b/i, tickers: ["CRWD", "PANW", "FTNT", "ZS", "OKTA"], direction: "upside", chain: ["broad cyber incident", "security spending urgency", "cybersecurity demand sensitivity"] },
  { families: ["ai_breakthrough", "technology_breakthrough"], require: /\b(ai|artificial intelligence|data center|accelerator|model)\b/i, tickers: ["NVDA", "AMD", "AVGO", "TSM", "ASML", "MU", "ANET", "VRT"], direction: "upside", chain: ["AI capability or adoption catalyst", "compute/network/power demand", "infrastructure supplier revenue sensitivity"] },
];

function rippleMappings(receipt: EventReceipt, classification: ClassifiedEvent, index: ReturnType<typeof buildIndex>) {
  const value = `${receipt.title} ${receipt.summary ?? ""}`;
  return RIPPLE_RULES.flatMap((rule): MappedEvent[] => {
    if (!rule.families.includes(classification.family) || (rule.require && !rule.require.test(value))) return [];
    const genericExposure = (ticker: string): CausalExposureEvidence => ({
      status: "generic_sector_proxy",
      exposureType: "sector_proxy",
      confidence: 70,
      evidenceText: `${ticker} is included only by a broad sector-sensitivity rule; no current company-specific exposure receipt was found.`,
      sourceUrl: receipt.url,
      eligibleForSeriousSignal: false,
    });
    if (classification.family === "macro_rates" || classification.family === "macro_inflation") {
      if (classification.direction === "unknown") return [];
      const direction = classification.direction === "downside" ? rule.direction : rule.direction === "upside" ? "downside" : "upside";
      return rule.tickers.flatMap((ticker) => index.ticker.get(ticker) ? [{ receipt, classification: { ...classification, direction }, equity: index.ticker.get(ticker)!, relationship: "second_order", mappingConfidence: 80, causalChain: rule.chain, causalExposure: genericExposure(ticker) }] : []);
    }
    return rule.tickers.flatMap((ticker) => index.ticker.get(ticker) ? [{ receipt, classification: { ...classification, direction: rule.direction }, equity: index.ticker.get(ticker)!, relationship: "second_order", mappingConfidence: 80, causalChain: rule.chain, causalExposure: genericExposure(ticker) }] : []);
  });
}

function eventTokens(receipt: EventReceipt) {
  return new Set(normalized(receipt.title).split(" ").filter((token) => token.length > 3 && !["announces", "company", "after", "with", "from", "will", "that"].includes(token)));
}

function explicitEventIdentifiers(receipt: EventReceipt) {
  const value = `${receipt.url} ${receipt.title} ${receipt.summary ?? ""} ${receipt.rawEventType ?? ""}`;
  const identifiers = new Set<string>();
  for (const match of value.matchAll(/\b\d{10}-\d{2}-\d{6}\b/g)) identifiers.add(`sec:${match[0]}`);
  for (const match of value.matchAll(/(?:\/|^)(\d{18})(?:\/|$)/g)) {
    const compact = match[1];
    identifiers.add(`sec:${compact.slice(0, 10)}-${compact.slice(10, 12)}-${compact.slice(12)}`);
  }
  for (const match of value.matchAll(/\bFDA-\d{4}-[A-Z]-\d{4,}\b/gi)) identifiers.add(`fda:${match[0].toUpperCase()}`);
  for (const match of value.matchAll(/\bNCT\d{8}\b/gi)) identifiers.add(`trial:${match[0].toUpperCase()}`);
  const rawReference = receipt.rawEventType?.trim().toLowerCase();
  if (rawReference && rawReference.split(/[-_:]/).filter(Boolean).length >= 3) identifiers.add(`source:${rawReference}`);
  return identifiers;
}

function quantifiedEventFacts(receipt: EventReceipt, family: EventFamily) {
  return new Set(extractEventMagnitude([receipt], family).metrics.map((metric) => [
    metric.kind,
    metric.value,
    metric.unit,
    metric.eventStatus ?? "unspecified",
    metric.termYears ?? "no-term",
  ].join(":")));
}

const SUBJECT_SENSITIVE_ROOT_FAMILIES = new Set<EventFamily>(["contract_award", "merger_acquisition", "regulatory_enforcement"]);
const GENERIC_EVENT_SUBJECT_TOKENS = new Set([
  "acquire", "acquired", "acquisition", "agreed", "agreement", "announce", "announced", "award", "awarded",
  "billion", "committed", "company", "complete", "completed", "contract", "corporation", "deal", "final",
  "fine", "hundred", "million", "penalty", "service", "services", "settlement", "transaction", "valued", "worth",
]);

function eventSubjectTokens(receipt: EventReceipt, equity: EquityUniverseEntry) {
  const issuerTokens = new Set([
    equity.ticker.toLowerCase(),
    ...normalized(equity.name).split(" "),
    ...equity.aliases.flatMap((alias) => normalized(alias).split(" ")),
  ]);
  return new Set(normalized(receipt.title)
    .split(" ")
    .filter((token) => token.length >= 4)
    .filter((token) => !issuerTokens.has(token) && !GENERIC_EVENT_SUBJECT_TOKENS.has(token)));
}

function intersects(left: Set<string>, right: Set<string>) {
  return [...left].some((value) => right.has(value));
}

function similarity(left: EventReceipt, right: EventReceipt) {
  const a = eventTokens(left);
  const b = eventTokens(right);
  const common = [...a].filter((token) => b.has(token)).length;
  return common / Math.max(1, new Set([...a, ...b]).size);
}

function related(left: MappedEvent, right: MappedEvent) {
  if (left.equity.ticker !== right.equity.ticker
    || left.classification.family !== right.classification.family
    || left.classification.direction !== right.classification.direction
    || Math.abs(Date.parse(left.receipt.publishedAt) - Date.parse(right.receipt.publishedAt)) > 18 * 60 * 60 * 1000) return false;

  const leftIdentifiers = explicitEventIdentifiers(left.receipt);
  const rightIdentifiers = explicitEventIdentifiers(right.receipt);
  // Two explicit but different filing, docket, or trial IDs are different
  // events even when the issuer, family, day, and boilerplate are identical.
  if (leftIdentifiers.size && rightIdentifiers.size) return intersects(leftIdentifiers, rightIdentifiers);

  const leftFacts = quantifiedEventFacts(left.receipt, left.classification.family);
  const rightFacts = quantifiedEventFacts(right.receipt, right.classification.family);
  // Matching normalized facts (for example, $20m versus $20 million) are a
  // stronger syndication signal than publisher wording. Conflicting facts are
  // kept separate so two same-day contracts or offerings are not collapsed.
  if (leftFacts.size && rightFacts.size) {
    if (!intersects(leftFacts, rightFacts)) return false;
    if (SUBJECT_SENSITIVE_ROOT_FAMILIES.has(left.classification.family)) {
      return intersects(eventSubjectTokens(left.receipt, left.equity), eventSubjectTokens(right.receipt, right.equity));
    }
    return true;
  }

  return similarity(left.receipt, right.receipt) >= 0.28;
}

function canonicalRootEventIdentity(cluster: MappedEvent[], eventMagnitude: EventMagnitudeEvidence) {
  const receipts = [...new Map(cluster.map((item) => [item.receipt.id, item.receipt])).values()];
  const identifiers = new Set(receipts.flatMap((receipt) => [...explicitEventIdentifiers(receipt)]));
  const authorityIdentifiers = [...identifiers].filter((value) => !value.startsWith("source:"));
  if (authorityIdentifiers.length === 1) return `official-id|${authorityIdentifiers[0]}`;
  const sourceIdentifiers = [...identifiers].filter((value) => value.startsWith("source:"));
  if (!authorityIdentifiers.length && sourceIdentifiers.length === 1) return `source-id|${sourceIdentifiers[0]}`;

  const factSupport = new Map<string, number>();
  for (const receipt of receipts) {
    for (const fact of quantifiedEventFacts(receipt, cluster[0].classification.family)) {
      factSupport.set(fact, (factSupport.get(fact) ?? 0) + 1);
    }
  }
  const verifiedFacts = new Set(eventMagnitude.metrics
    .filter((metric) => metric.promotionEvidenceVerified)
    .map((metric) => [
      metric.kind,
      metric.value,
      metric.unit,
      metric.eventStatus ?? "unspecified",
      metric.termYears ?? "no-term",
    ].join(":")));
  const supportedFact = [...factSupport.entries()]
    .filter(([fact, count]) => count >= 2 || verifiedFacts.has(fact))
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0];
  if (supportedFact) {
    let subject = "";
    if (SUBJECT_SENSITIVE_ROOT_FAMILIES.has(cluster[0].classification.family)) {
      const subjectSets = receipts.map((receipt) => eventSubjectTokens(receipt, cluster[0].equity));
      subject = subjectSets.length >= 2
        ? [...subjectSets[0]].filter((token) => subjectSets.slice(1).every((tokens) => tokens.has(token))).sort()[0] ?? ""
        : "";
      // An amount alone is not enough to identify a contract, transaction, or
      // enforcement action. Without a shared subject or official ID, retain the
      // conservative receipt-specific identity.
      if (!subject) {
        const primary = receipts.filter((receipt) => receipt.primarySource);
        const anchor = [...(primary.length ? primary : receipts)]
          .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt))[0];
        return canonicalEquityEventIdentity(anchor);
      }
    }
    const observedDates = receipts
      .map((receipt) => Date.parse(receipt.publishedAt))
      .filter(Number.isFinite)
      .sort((left, right) => left - right);
    const eventDay = observedDates.length ? new Date(observedDates[0]).toISOString().slice(0, 10) : "unknown-day";
    return `issuer|${cluster[0].equity.ticker}|${cluster[0].classification.family}|${eventDay}|${supportedFact}|${subject}`;
  }

  const primary = receipts.filter((receipt) => receipt.primarySource);
  const anchor = [...(primary.length ? primary : receipts)]
    .sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt))[0];
  return canonicalEquityEventIdentity(anchor);
}

const PERMISSION_GATE_KEYS = [
  "verifiedEventTruth",
  "reliableTickerMapping",
  "materialEvent",
  "causalTransmission",
  "freshEvidence",
  "primaryOrIndependentProof",
  "noSevereContradiction",
  "notRumour",
  "knockOnCausalPathVerified",
  "eventMagnitudeActionable",
  "currentEvidenceScoreAtLeast72",
] as const;

function magnitudeAdjustedMateriality(base: number, magnitude: EventMagnitudeEvidence) {
  const directPercent = magnitude.metrics
    .filter((item) => item.promotionEvidenceVerified
      && (item.kind === "dilution_percent" || item.kind === "guidance_change_percent"))
    .map((item) => item.value)
    .sort((left, right) => right - left)[0];
  if (directPercent === undefined) return base;
  const measured = directPercent >= 10 ? 95 : directPercent >= 5 ? 88 : directPercent >= 2 ? 80 : directPercent >= 0.5 ? 70 : 55;
  return Math.round((base + measured) / 2);
}

function eventMagnitudeActionable(family: EventFamily, magnitude: EventMagnitudeEvidence, receipts: EventReceipt[]) {
  if (family === "contract_award") {
    const contract = magnitude.metrics
      .filter((metric) => metric.promotionEvidenceVerified
        && metric.kind === "contract_value"
        && metric.eventStatus === "committed")
      .sort((left, right) => right.value - left.value)[0];
    const relative = magnitude.relativeToCompany;
    if (!contract || !relative || relative.metric !== "annual_revenue" || contract.eventStatus !== "committed") return false;
    if (relative.eventValue !== contract.value || relative.eventMetricSourceReceiptId !== contract.sourceReceiptId) return false;
    const annualizedRatio = contract.termYears && contract.termYears > 1
      ? relative.ratioPercent / contract.termYears
      : relative.ratioPercent;
    return annualizedRatio >= 5;
  }
  if (family === "financing_dilution") {
    const latestStatus = latestFinancingStatusText(receipts);
    if (NON_ACTIONABLE_OFFERING.test(latestStatus) || !ACTIONABLE_OFFERING.test(latestStatus)) return false;
    const explicitDilution = magnitude.metrics
      .filter((metric) => metric.promotionEvidenceVerified
        && metric.kind === "dilution_percent"
        && ["priced", "completed"].includes(metric.eventStatus ?? ""))
      .some((metric) => metric.value >= 5);
    const shareRatio = magnitude.relativeToCompany?.metric === "shares_outstanding"
      ? magnitude.relativeToCompany.ratioPercent
      : null;
    const verifiedShareMetric = magnitude.relativeToCompany?.metric === "shares_outstanding"
      && magnitude.metrics.some((metric) => metric.promotionEvidenceVerified
        && metric.kind === "offering_shares"
        && metric.value === magnitude.relativeToCompany?.eventValue
        && metric.sourceReceiptId === magnitude.relativeToCompany?.eventMetricSourceReceiptId);
    return explicitDilution || (verifiedShareMetric && shareRatio !== null && shareRatio >= 5);
  }
  if (family === "earnings_guidance") {
    return magnitude.metrics
      .filter((metric) => metric.promotionEvidenceVerified && metric.kind === "guidance_change_percent")
      .some((metric) => metric.value >= 3);
  }
  if (family === "regulatory_enforcement") {
    const latestStatus = latestRegulatoryStatusText(receipts);
    if (!regulatoryStatusIsFinal(latestStatus)) return false;
    if (CATEGORICAL_SEVERE_REGULATORY.test(latestStatus)) return true;
    const fine = magnitude.metrics
      .filter((metric) => metric.promotionEvidenceVerified
        && metric.kind === "fine_value"
        && metric.eventStatus === "final")
      .sort((left, right) => right.value - left.value)[0];
    const relative = magnitude.relativeToCompany;
    return Boolean(fine
      && relative?.metric === "annual_revenue"
      && relative.eventValue === fine.value
      && relative.eventMetricSourceReceiptId === fine.sourceReceiptId
      && relative.ratioPercent >= 1);
  }
  return true;
}

function trackingDisposition(candidate: Pick<ImpactCandidate, "eventTruth" | "mappingConfidence" | "materiality" | "transmissionConfidence" | "evidenceIndependence" | "score" | "gateChecks" | "eventMagnitude">) {
  const failedGateChecks = PERMISSION_GATE_KEYS.filter((key) => candidate.gateChecks[key] !== true);
  const hardSafetyChecksPass = candidate.gateChecks.freshEvidence === true
    && candidate.gateChecks.primaryOrIndependentProof === true
    && candidate.gateChecks.noSevereContradiction === true
    && candidate.gateChecks.notRumour === true
    && candidate.gateChecks.verifiedEventTruth === true
    && candidate.gateChecks.reliableTickerMapping === true
    && candidate.gateChecks.knockOnCausalPathVerified === true;
  const softFailures = failedGateChecks.filter((key) => ["materialEvent", "causalTransmission", "eventMagnitudeActionable", "currentEvidenceScoreAtLeast72"].includes(key));
  const shadowEligible = hardSafetyChecksPass
    && candidate.eventTruth >= 75
    && candidate.mappingConfidence >= 95
    && candidate.materiality >= 55
    && candidate.transmissionConfidence >= 60
    && candidate.evidenceIndependence >= 70
    && candidate.score >= 65
    && candidate.eventMagnitude.status !== "non_actionable_status"
    && failedGateChecks.length === softFailures.length
    && softFailures.length === 1;
  return {
    failedGateChecks,
    disposition: failedGateChecks.length === 0
      ? "qualified" as const
      : shadowEligible
        ? "shadow_near_miss" as const
        : "rejected" as const,
  };
}

function candidateFromCluster(cluster: MappedEvent[], macro: MacroContext, historicalSignals: HistoricalSignalRecord[], now: Date): ImpactCandidate {
  const primaryItems = cluster.filter((item) => item.receipt.primarySource);
  const anchor = [...(primaryItems.length ? primaryItems : cluster)]
    .sort((left, right) => Date.parse(right.receipt.publishedAt) - Date.parse(left.receipt.publishedAt))[0];
  const allReceipts = [...new Map(cluster.map((item) => [item.receipt.id, item.receipt])).values()];
  const latestReceipt = [...allReceipts].sort((left, right) => Date.parse(right.publishedAt) - Date.parse(left.publishedAt))[0];
  const receipts = [...new Map([
    ...(latestReceipt ? [[latestReceipt.id, latestReceipt] as const] : []),
    ...selectEquityReceipts(allReceipts, 12).map((receipt) => [receipt.id, receipt] as const),
  ]).values()].slice(0, 12);
  const publishers = new Set(receipts.map((receipt) => receipt.publisher.toLowerCase()));
  const primarySource = receipts.some((receipt) => receipt.primarySource);
  const classification = anchor.classification;
  const eventTruth = primarySource ? 96 : publishers.size >= 3 ? 90 : publishers.size >= 2 ? 82 : 58;
  const evidenceIndependence = primarySource && publishers.size >= 2 ? 100 : primarySource ? 88 : publishers.size >= 3 ? 92 : publishers.size >= 2 ? 78 : 35;
  const fresh = now.getTime() - Math.max(...receipts.map((receipt) => Date.parse(receipt.publishedAt))) <= 24 * 60 * 60 * 1000;
  const mappingConfidence = Math.max(...cluster.map((item) => item.mappingConfidence));
  const eventMagnitude = extractEventMagnitude(receipts, classification.family);
  const materiality = magnitudeAdjustedMateriality(Math.max(...cluster.map((item) => item.classification.materiality)), eventMagnitude);
  const transmissionConfidence = Math.max(...cluster.map((item) => item.classification.transmission));
  const rumour = cluster.every((item) => item.classification.rumour);
  const promotionGradeExposures = cluster.filter((item) =>
    item.causalExposure.status === "event_specific"
    && item.causalExposure.eligibleForSeriousSignal);
  const exposurePublishers = new Set(promotionGradeExposures
    .map((item) => item.receipt.publisher.toLowerCase()));
  const primaryExposure = promotionGradeExposures.find((item) => item.receipt.primarySource);
  const selectedExposure = primaryExposure
    ?? promotionGradeExposures[0]
    ?? cluster.find((item) => item.causalExposure.status === "event_specific")
    ?? anchor;
  const causalExposure: CausalExposureEvidence = selectedExposure.causalExposure.status === "event_specific"
    ? {
        ...selectedExposure.causalExposure,
        eligibleForSeriousSignal: Boolean(primaryExposure) || exposurePublishers.size >= 2,
        evidenceText: `${selectedExposure.causalExposure.evidenceText} Exposure proof publishers: ${exposurePublishers.size}; primary-source proof: ${Boolean(primaryExposure)}.`,
      }
    : selectedExposure.causalExposure;
  const relationship = causalExposure.status === "event_specific"
    ? "second_order" as const
    : anchor.relationship;
  const causalChain = causalExposure.status === "event_specific"
    ? selectedExposure.causalChain
    : anchor.causalChain;
  const rootEventKey = crypto.createHash("sha256")
    .update(`${classification.family}|${canonicalRootEventIdentity(cluster, eventMagnitude)}`)
    .digest("hex")
    .slice(0, 20);
  const historicalAnalog = analyzeHistoricalAnalogs({
    eventKey: rootEventKey,
    eventFamily: classification.family,
    direction: anchor.classification.direction === "downside" ? "downside" : "upside",
    relationship,
    causalChain,
    macroRegime: macro.regime,
    asOf: now.toISOString(),
    featuresAsOf: now.toISOString(),
  }, historicalSignals);
  // Historical outcomes are optional supporting context. They must never block a
  // current verified event or turn absence of history into contradictory evidence.
  const contradiction = 0;
  const historicalSupport = historicalAnalog.historicalSupport;
  const pricedInPenalty = 0;
  const gate = eventFirstGate({ eventTruth, mappingConfidence, materiality, transmissionConfidence, fresh, primarySource, independentPublishers: publishers.size, unresolvedSevereContradiction: false, rumour });
  const score = computeEventFirstStrength({ eventTruth, mappingConfidence, materiality, transmissionConfidence, historicalSupport, evidenceIndependence, contradictionPenalty: contradiction, pricedInPenalty, rumour });
  const direction = anchor.classification.direction === "downside" ? "downside" : "upside";
  const knockOnCausalPathVerified = relationship === "direct"
    || (causalExposure.eligibleForSeriousSignal
      && mappingConfidence >= 95
      && transmissionConfidence >= 75
      && causalChain.length >= 3);
  const gateChecks = {
    ...gate.checks,
    knockOnCausalPathVerified,
    eventMagnitudeActionable: eventMagnitudeActionable(classification.family, eventMagnitude, receipts),
    currentEvidenceScoreAtLeast72: score >= 72,
    historicalComparisonRequired: false,
  };
  const disposition = trackingDisposition({ eventTruth, mappingConfidence, materiality, transmissionConfidence, evidenceIndependence, score, gateChecks, eventMagnitude });
  return {
    ticker: anchor.equity.ticker,
    company: anchor.equity.name,
    cik: anchor.equity.cik,
    rootEventKey,
    eventFamily: classification.family,
    direction,
    relationship,
    eventHeadline: anchor.receipt.title,
    whatHappened: `${anchor.receipt.primarySource ? "Official source" : `${publishers.size} independent publisher(s)`}: ${anchor.receipt.summary || anchor.receipt.title}`,
    eventObservedAt: anchor.receipt.publishedAt,
    receipts,
    primarySource,
    independentPublishers: publishers.size,
    mappingConfidence,
    eventTruth,
    materiality,
    transmissionConfidence,
    historicalSupport,
    evidenceIndependence,
    contradictionPenalty: contradiction,
    pricedInPenalty,
    rumour,
    causalChain,
    causalExposure,
    eventMagnitude,
    falsifiers: ["The official event is corrected, withdrawn, or shown to be immaterial.", "The stated causal link does not affect revenue, costs, financing, or valuation in the expected horizon.", "Fresh market data shows the opportunity was already fully repriced before a safe entry."],
    timeHorizon: anchor.relationship === "direct" ? "hours_to_10_trading_days" : "1_to_20_trading_days",
    score,
    gateChecks,
    gatePassed: disposition.disposition === "qualified",
    trackingDisposition: disposition.disposition,
    failedGateChecks: disposition.failedGateChecks,
    quote: null,
    fundamentals: null,
    historicalAnalog: { ...historicalAnalog, source: "Cloudflare R2 point-in-time forward outcome memory" },
    priceForecast: { status: "insufficient_history", horizon: null, probabilityDirectionCorrectPercent: null, sampleSize: historicalAnalog.sampleSize, medianReturnPercent: null, pessimisticReturnPercent: null, optimisticReturnPercent: null, medianPrice: null, lowPrice: null, highPrice: null, forecastExpiresAt: null, basedOnMarketRelativeOutcomes: false, warning: "No numeric target is shown until real, leakage-safe historical outcomes are available." },
  };
}

export function buildImpactCandidates(receipts: EventReceipt[], universe: EquityUniverseSnapshot, macro: MacroContext, now: Date, historicalSignals: HistoricalSignalRecord[] = []) {
  const index = buildIndex(universe.entries);
  const mapped: MappedEvent[] = [];
  let noiseRejected = 0;
  let directionUnknown = 0;
  let unmapped = 0;
  for (const receipt of receipts) {
    if (NOISE.test(receipt.title) && !receipt.primarySource) { noiseRejected += 1; continue; }
    const classification = classify(receipt);
    const direct = mapDirect(receipt, index);
    if (classification.direction !== "unknown") {
      for (const value of direct) {
        const causalExposure = directExposure(receipt, classification, value.equity);
        const relationship = causalExposure.status === "direct_issuer" ? "direct" as const : "second_order" as const;
        const mappedClassification = causalExposure.status === "event_specific" && causalExposure.sensitivityDirection
          ? { ...classification, direction: causalExposure.sensitivityDirection }
          : classification;
        mapped.push({
          receipt,
          classification: mappedClassification,
          equity: value.equity,
          relationship,
          mappingConfidence: Math.min(value.confidence, causalExposure.confidence),
          causalChain: relationship === "direct"
            ? [classification.terms[0] || "verified company event", "revenue/cost/capital or valuation impact", `${value.equity.ticker} expected ${classification.direction} sensitivity`]
            : [classification.terms[0] || "verified external event", causalExposure.evidenceText, `${value.equity.ticker} explicitly evidenced ${mappedClassification.direction} company effect`],
          causalExposure,
        });
      }
      const ripples = rippleMappings(receipt, classification, index);
      mapped.push(...ripples);
      if (!direct.length && !ripples.length) unmapped += 1;
    } else directionUnknown += 1;
    if (classification.direction === "unknown" && !direct.length) unmapped += 1;
  }
  const clusters: MappedEvent[][] = [];
  for (const item of mapped) {
    const existing = clusters.find((cluster) => related(cluster[0], item));
    if (existing) existing.push(item); else clusters.push([item]);
  }
  const candidates = clusters.map((cluster) => candidateFromCluster(cluster, macro, historicalSignals, now));
  for (const candidate of candidates) {
    const severeContradiction = candidates.some((other) => other !== candidate
      && other.ticker === candidate.ticker
      && other.eventFamily === candidate.eventFamily
      && other.direction !== candidate.direction
      && other.mappingConfidence >= 95
      && other.causalExposure.status !== "generic_sector_proxy"
      && Math.abs(Date.parse(other.eventObservedAt) - Date.parse(candidate.eventObservedAt)) <= 18 * 60 * 60 * 1000);
    if (!severeContradiction) continue;
    candidate.contradictionPenalty = 70;
    candidate.gateChecks.noSevereContradiction = false;
    candidate.gatePassed = false;
    candidate.score = computeEventFirstStrength({ eventTruth: candidate.eventTruth, mappingConfidence: candidate.mappingConfidence, materiality: candidate.materiality, transmissionConfidence: candidate.transmissionConfidence, historicalSupport: candidate.historicalSupport, evidenceIndependence: candidate.evidenceIndependence, contradictionPenalty: candidate.contradictionPenalty, pricedInPenalty: candidate.pricedInPenalty, rumour: candidate.rumour });
    candidate.gateChecks.currentEvidenceScoreAtLeast72 = candidate.score >= 72;
    const disposition = trackingDisposition(candidate);
    candidate.trackingDisposition = disposition.disposition;
    candidate.failedGateChecks = disposition.failedGateChecks;
  }
  const uniqueAll = [...new Map(candidates.map((candidate) => [`${candidate.ticker}|${candidate.direction}|${candidate.eventFamily}|${canonicalEquityEventIdentity(candidate.receipts[0])}`, candidate])).values()]
    .sort((left, right) => right.score - left.score || right.eventTruth - left.eventTruth);
  const findingAuditLedger = uniqueAll.map((candidate) => ({
    ticker: candidate.ticker,
    company: candidate.company,
    rootEventKey: candidate.rootEventKey,
    eventFamily: candidate.eventFamily,
    direction: candidate.direction,
    relationship: candidate.relationship,
    eventHeadline: candidate.eventHeadline,
    eventObservedAt: candidate.eventObservedAt,
    score: candidate.score,
    gatePassed: candidate.gatePassed,
    trackingDisposition: candidate.trackingDisposition,
    failedGateChecks: candidate.failedGateChecks,
    gateChecks: candidate.gateChecks,
    eventMagnitude: candidate.eventMagnitude,
    causalExposure: candidate.causalExposure,
    receiptIds: candidate.receipts.map((receipt) => receipt.id),
  }));
  const findingReceiptProofDictionary = Object.fromEntries(receipts.map((receipt) => [receipt.id, {
    id: receipt.id,
    title: receipt.title.slice(0, 500),
    summary: receipt.summary?.slice(0, 1_000) ?? null,
    publisher: receipt.publisher.slice(0, 200),
    url: receipt.url,
    publishedAt: receipt.publishedAt,
    channel: receipt.channel,
    official: receipt.official,
    primarySource: receipt.primarySource,
    symbolHints: receipt.symbolHints.slice(0, 20),
    companyHints: receipt.companyHints.slice(0, 20),
    rawEventType: receipt.rawEventType,
  }]));
  const unique = uniqueAll.slice(0, 100);
  return {
    candidates: unique,
    findingAuditLedger,
    findingReceiptProofDictionary,
    diagnostics: { receiptsConsidered: receipts.length, noiseRejected, directionUnknown, unmapped, mappedRelationships: mapped.length, eventClusters: clusters.length, directCandidates: unique.filter((candidate) => candidate.relationship === "direct").length, rippleCandidates: unique.filter((candidate) => candidate.relationship !== "direct").length, gatePassed: unique.filter((candidate) => candidate.gatePassed).length },
  };
}

export function reassessCandidateAfterFundamentals(candidate: ImpactCandidate | null, now: Date) {
  if (!candidate) return null;
  const relative = candidate.eventMagnitude.relativeToCompany;
  if (relative && MAGNITUDE_SENSITIVE_FAMILIES.has(candidate.eventFamily)) {
    const ratio = relative.ratioPercent;
    candidate.materiality = ratio >= 10 ? 95 : ratio >= 5 ? 90 : ratio >= 2 ? 82 : ratio >= 0.5 ? 72 : 55;
    candidate.eventMagnitude.materialityBasis = `${candidate.eventMagnitude.materialityBasis} Measured event scale is ${ratio}% of ${relative.metric.replace(/_/g, " ")}.`;
  }
  const magnitudeVerified = eventMagnitudeActionable(candidate.eventFamily, candidate.eventMagnitude, candidate.receipts);
  if (MAGNITUDE_SENSITIVE_FAMILIES.has(candidate.eventFamily) && candidate.eventMagnitude.relativeToCompany) {
    candidate.eventMagnitude.status = magnitudeVerified ? "verified_material" : "verified_below_threshold";
  }
  const fresh = now.getTime() - Math.max(...candidate.receipts.map((receipt) => Date.parse(receipt.publishedAt))) <= 24 * 60 * 60 * 1000;
  const gate = eventFirstGate({
    eventTruth: candidate.eventTruth,
    mappingConfidence: candidate.mappingConfidence,
    materiality: candidate.materiality,
    transmissionConfidence: candidate.transmissionConfidence,
    fresh,
    primarySource: candidate.primarySource,
    independentPublishers: candidate.independentPublishers,
    unresolvedSevereContradiction: candidate.contradictionPenalty >= 50,
    rumour: candidate.rumour,
  });
  candidate.score = computeEventFirstStrength({
    eventTruth: candidate.eventTruth,
    mappingConfidence: candidate.mappingConfidence,
    materiality: candidate.materiality,
    transmissionConfidence: candidate.transmissionConfidence,
    historicalSupport: candidate.historicalSupport,
    evidenceIndependence: candidate.evidenceIndependence,
    contradictionPenalty: candidate.contradictionPenalty,
    pricedInPenalty: candidate.pricedInPenalty,
    rumour: candidate.rumour,
  });
  candidate.gateChecks = {
    ...candidate.gateChecks,
    ...gate.checks,
    knockOnCausalPathVerified: candidate.relationship === "direct"
      || (candidate.causalExposure.eligibleForSeriousSignal
        && candidate.mappingConfidence >= 95
        && candidate.transmissionConfidence >= 75
        && candidate.causalChain.length >= 3),
    eventMagnitudeActionable: magnitudeVerified,
    currentEvidenceScoreAtLeast72: candidate.score >= 72,
    historicalComparisonRequired: false,
  };
  const disposition = trackingDisposition(candidate);
  candidate.gatePassed = disposition.disposition === "qualified";
  candidate.trackingDisposition = disposition.disposition;
  candidate.failedGateChecks = disposition.failedGateChecks;
  return candidate;
}

export function fingerprintCandidate(candidate: ImpactCandidate) {
  return crypto.createHash("sha256").update(`${candidate.ticker}|${candidate.direction}|${candidate.eventFamily}|${canonicalEquityEventIdentity(candidate.receipts[0])}`).digest("hex").slice(0, 20);
}
