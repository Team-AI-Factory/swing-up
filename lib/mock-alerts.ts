export type AlertAction = "BUY" | "WATCH" | "AVOID";
export type FullAlertActionLabel = "Buy Candidate" | "Speculative Buy Candidate" | "Watch" | "Sell Review" | "Avoid" | "No Action";

export type MarketSentimentImpact = {
  overallMarketMood: string;
  macroRiskLevel: string;
  sentimentSupportScore: number;
  macroSupportScore: number;
  profitPotentialAdjustment: number;
  confidenceAdjustment: number;
  explanation: string;
};

export type AlertProofItem = { sourceType: string; explanation: string; freshness?: string; link?: string; strength?: "weak" | "medium" | "strong" };
export type AlertRippleItem = { group: "Direct winner" | "Supplier/customer" | "Competitor pressure" | "Ecosystem link" | "Watchlist only"; explanation: string; tickers?: string[]; proofStrength?: "weak" | "medium" | "strong" };
export type AlertCheckItem = { label: string; status: string; available: boolean };

export type Alert = {
  id: string;
  action: AlertAction;
  actionLabel?: FullAlertActionLabel;
  ticker: string;
  company: string;
  event: string;
  eventDate?: string;
  whatHappened?: string;
  whyItMatters?: string;
  howChecked?: AlertCheckItem[];
  proofFound?: AlertProofItem[];
  historicalPatternDetail?: string;
  pricedInDetail?: string;
  rippleEffects?: AlertRippleItem[];
  swingUpView?: string;
  whatWouldChangeView?: string[];
  sourceHealth?: string;
  patternMatchStrength?: string;
  currentPrice: string;
  targetRange: string;
  potentialMove: string;
  profitScore: number;
  confidenceScore: number;
  riskLevel: "Low" | "Medium" | "High";
  pricedInCheck: string;
  patternMatch: string;
  explanation: string;
  rippleEffect: string;
  risks: string[];
  receipts: string[];
  publicTrackingResult: string;
  publicAlertUrl?: string;
  ledgerStatus?: string;
  latestTrackedResult?: string;
  priceAtAlert?: string;
  marketSentimentImpact?: Partial<MarketSentimentImpact>;
};

const commonChecks: AlertCheckItem[] = [
  { label: "Filing checked", status: "No fresh company filing was available in this preview dataset.", available: false },
  { label: "News checked", status: "Event narrative was checked against stored source receipts.", available: true },
  { label: "Price/volume checked", status: "Recent move and volume context were reviewed where available.", available: true },
  { label: "Fundamentals checked", status: "Revenue, margin, and demand logic were reviewed at a high level.", available: true },
  { label: "Valuation checked", status: "Priced-in and multiple-risk language was included.", available: true },
  { label: "Historical pattern checked", status: "Stored pattern context was compared with the current setup.", available: true },
  { label: "Source health checked", status: "Receipt freshness and source quality were reviewed.", available: true },
];

export const mockAlerts: Alert[] = [
  {
    id: "nvda-supply-ripple", action: "WATCH", actionLabel: "Watch", ticker: "NVDA", company: "NVIDIA Corporation",
    event: "AI rack shipment signals improved across supplier checks.", eventDate: "June 12, 2026", currentPrice: "$124.80", priceAtAlert: "$124.80", targetRange: "$138–$146", potentialMove: "+10.6% to +17.0%", profitScore: 86, confidenceScore: 78, riskLevel: "Medium",
    pricedInCheck: "Partially priced in after sector momentum, but downstream suppliers have not fully repriced.", patternMatch: "82% similarity to prior AI infrastructure reorder cycles with 2–5 week follow-through.", patternMatchStrength: "Strong", sourceHealth: "Receipts available; one logistics confirmation still pending.",
    whatHappened: "Supplier channel checks point to faster AI rack shipments, while related power, cooling, and memory signals also improved.",
    whyItMatters: "If rack shipments are accelerating, NVIDIA may see stronger data-center demand and related suppliers may see better order visibility. The market logic is revenue pull-forward, improved sentiment toward AI infrastructure, and possible estimate revisions if the signal is confirmed.",
    howChecked: commonChecks,
    proofFound: [{ sourceType: "Supplier receipt", explanation: "Mock import-volume receipt showed stronger rack movement.", freshness: "Recent preview receipt", strength: "medium" }, { sourceType: "Labor/operations signal", explanation: "Mock supplier job-posting delta improved in AI infrastructure roles.", freshness: "Recent preview receipt", strength: "medium" }, { sourceType: "Market signal", explanation: "Mock options-flow anomaly and correlated supplier volume supported the setup.", freshness: "Recent preview receipt", strength: "weak" }],
    historicalPatternDetail: "Similar AI infrastructure reorder cycles previously produced 2–5 week follow-through in this mock dataset. The pattern is a winner historically, but it still needs a second logistics receipt before confidence moves higher.",
    pricedInDetail: "Current and alert price are both shown as $124.80 in this preview. The sector has already moved, so part of the good news may be priced in; volume in related suppliers suggests the ripple may not be fully reflected yet.",
    rippleEffects: [{ group: "Direct winner", tickers: ["NVDA"], explanation: "Direct demand signal if AI rack shipments continue improving.", proofStrength: "medium" }, { group: "Supplier/customer", explanation: "Power systems, cooling vendors, and high-bandwidth memory suppliers showed correlated volume spikes.", proofStrength: "medium" }, { group: "Watchlist only", explanation: "Broader AI hardware names should be watched only; proof is weaker outside the named supply-chain receipts.", proofStrength: "weak" }],
    explanation: "The alert is watch-rated until confirmation from a second logistics receipt clears the confidence threshold.", swingUpView: "This is a Watch because the signal is interesting and evidence is improving, but part of the move may already be priced in and one logistics confirmation is still missing.", whatWouldChangeView: ["Stronger volume confirmation", "New filing or company guidance confirmation", "Second logistics receipt", "Valuation cools down"],
    rippleEffect: "Verified ripple: power systems, cooling vendors, and high-bandwidth memory suppliers show correlated volume spikes.", risks: ["Already priced in", "Export control headlines", "Supplier lead-time noise", "Crowded positioning"], receipts: ["Mock import-volume receipt", "Mock supplier job-posting delta", "Mock options-flow anomaly"], publicTrackingResult: "Open: tracking from $124.80 with 30-day review window.", publicAlertUrl: "/alerts/nvda-supply-ripple", ledgerStatus: "Open", latestTrackedResult: "Still tracking",
    marketSentimentImpact: { overallMarketMood: "Neutral", macroRiskLevel: "Medium", sentimentSupportScore: 58, macroSupportScore: 54, profitPotentialAdjustment: 0, confidenceAdjustment: 2, explanation: "Market sentiment is neutral. It slightly improves confidence but does not remove the risk." }
  },
  {
    id: "shop-margin-reset", action: "BUY", actionLabel: "Buy Candidate", ticker: "SHOP", company: "Shopify Inc.", event: "Merchant mix and fulfillment data point to margin improvement.", eventDate: "June 10, 2026", currentPrice: "$68.25", priceAtAlert: "$68.25", targetRange: "$76–$81", potentialMove: "+11.4% to +18.7%", profitScore: 81, confidenceScore: 84, riskLevel: "Medium", pricedInCheck: "Not fully priced in; consensus revisions lag operating leverage signals.", patternMatch: "76% match to SaaS margin-revision setups after two consecutive positive data receipts.", patternMatchStrength: "Medium", sourceHealth: "Multiple independent preview receipts available.", whatHappened: "Merchant take-rate mix improved while fulfillment utilization data suggested costs were becoming easier to absorb.", whyItMatters: "Better take-rate mix and fulfillment efficiency can support margins, earnings revisions, and sentiment toward operating leverage.", howChecked: commonChecks, proofFound: [{ sourceType: "Survey", explanation: "Mock merchant survey showed healthier mix.", freshness: "Recent preview receipt", strength: "medium" }, { sourceType: "App ecosystem", explanation: "Mock app-store ranking receipt supported merchant activity.", freshness: "Recent preview receipt", strength: "medium" }, { sourceType: "Operations", explanation: "Mock fulfillment utilization index improved.", freshness: "Recent preview receipt", strength: "strong" }], historicalPatternDetail: "The setup resembles SaaS margin-revision patterns after repeated positive data receipts. Prior examples were mixed-to-positive over 7D and stronger by 30D when revisions followed.", pricedInDetail: "Price at alert was $68.25. The check says revisions may lag the operating data, so the market may not have fully reflected the margin reset yet.", rippleEffects: [{ group: "Direct winner", tickers: ["SHOP"], explanation: "Direct margin and sentiment beneficiary if the data is confirmed.", proofStrength: "strong" }, { group: "Ecosystem link", explanation: "Payment attach rate and app marketplace revenue moved with merchant activity.", proofStrength: "medium" }], explanation: "Multiple independent mock receipts align on improving contribution margin before analyst revisions.", swingUpView: "This is a Buy Candidate because several independent receipts point in the same direction, while consumer spending and valuation risk still need monitoring.", whatWouldChangeView: ["Better earnings guidance", "Additional merchant data", "Valuation cools down", "Consumer spending remains stable"], rippleEffect: "Verified ripple: payment attach rate, app marketplace revenue, and fulfillment utilization all moved together.", risks: ["Consumer spending slowdown", "FX pressure", "Multiple compression"], receipts: ["Mock merchant survey", "Mock app-store ranking receipt", "Mock fulfillment utilization index"], publicTrackingResult: "Hit checkpoint 1: +4.1% since publication.", publicAlertUrl: "/alerts/shop-margin-reset", ledgerStatus: "Open", latestTrackedResult: "+4.1% checkpoint 1"
  },
  {
    id: "ford-ev-inventory", action: "AVOID", actionLabel: "Avoid", ticker: "F", company: "Ford Motor Company", event: "EV inventory and incentive signals weakened versus peers.", eventDate: "June 7, 2026", currentPrice: "$11.10", priceAtAlert: "$11.10", targetRange: "$9.40–$10.20", potentialMove: "-8.1% to -15.3%", profitScore: 62, confidenceScore: 73, riskLevel: "High", pricedInCheck: "Mostly not priced in for a downside scenario; dividend support may slow the move.", patternMatch: "69% match to legacy auto incentive cycles with delayed earnings impact.", patternMatchStrength: "Medium", sourceHealth: "Dealer and financing preview receipts available.", whatHappened: "EV inventory days rose and incentive intensity worsened versus peers, suggesting demand may be weaker than production plans assumed.", whyItMatters: "Higher incentives can pressure margins, signal demand softness, and create earnings risk if inventory has to be cleared at lower prices.", howChecked: commonChecks, proofFound: [{ sourceType: "Dealer inventory", explanation: "Mock dealer scrape showed higher EV inventory density.", freshness: "Recent preview receipt", strength: "medium" }, { sourceType: "Pricing", explanation: "Mock incentive index worsened.", freshness: "Recent preview receipt", strength: "medium" }, { sourceType: "Credit/financing", explanation: "Mock regional financing spread moved against affordability.", freshness: "Recent preview receipt", strength: "weak" }], historicalPatternDetail: "Legacy auto incentive cycles often hurt earnings with a delay. This pattern is mixed because dividend support and truck resilience can offset EV weakness for a time.", pricedInDetail: "Price at alert was $11.10. The downside setup may not be fully priced in, but dividend support could slow or reduce the market reaction.", rippleEffects: [{ group: "Competitor pressure", explanation: "Legacy auto peers may be watched if incentives spread across the sector.", proofStrength: "weak" }, { group: "Watchlist only", explanation: "Battery and EV suppliers are watchlist only because this preview does not prove direct order cuts.", proofStrength: "weak" }], explanation: "Avoid rating because downside receipts are strong but catalyst timing is uncertain.", swingUpView: "This is an Avoid because inventory and incentive evidence is negative, but timing is uncertain and stronger truck demand could soften the impact.", whatWouldChangeView: ["Inventory normalizes", "Incentives fall", "Management confirms stronger demand", "Macro rate pressure eases"], rippleEffect: "Verified ripple: dealer incentives, floorplan financing costs, and regional inventory density worsened together.", risks: ["Labor agreement surprise", "Rate cuts", "Truck segment resilience", "Catalyst timing uncertainty"], receipts: ["Mock dealer inventory scrape", "Mock incentive index", "Mock regional financing spread"], publicTrackingResult: "Open: downside thesis invalidates above $12.35.", publicAlertUrl: "/alerts/ford-ev-inventory", ledgerStatus: "Open", latestTrackedResult: "Still tracking"
  }
];

export function getAlert(id: string) {
  return mockAlerts.find((alert) => alert.id === id) ?? mockAlerts[0];
}
