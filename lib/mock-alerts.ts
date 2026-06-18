export type AlertAction = "BUY" | "WATCH" | "AVOID";

export type Alert = {
  id: string;
  action: AlertAction;
  ticker: string;
  company: string;
  event: string;
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
};

export const mockAlerts: Alert[] = [
  {
    id: "nvda-supply-ripple",
    action: "WATCH",
    ticker: "NVDA",
    company: "NVIDIA Corporation",
    event: "Supplier channel checks point to accelerated rack shipments.",
    currentPrice: "$124.80",
    targetRange: "$138–$146",
    potentialMove: "+10.6% to +17.0%",
    profitScore: 86,
    confidenceScore: 78,
    riskLevel: "Medium",
    pricedInCheck: "Partially priced in after sector momentum, but downstream suppliers have not fully repriced.",
    patternMatch: "82% similarity to prior AI infrastructure reorder cycles with 2–5 week follow-through.",
    explanation: "The alert is watch-rated until confirmation from a second logistics receipt clears the confidence threshold.",
    rippleEffect: "Verified ripple: power systems, cooling vendors, and high-bandwidth memory suppliers show correlated volume spikes.",
    risks: ["Crowded positioning", "Export control headlines", "Supplier lead-time noise"],
    receipts: ["Mock import-volume receipt", "Mock supplier job-posting delta", "Mock options-flow anomaly"],
    publicTrackingResult: "Open: tracking from $124.80 with 30-day review window."
  },
  {
    id: "shop-margin-reset",
    action: "BUY",
    ticker: "SHOP",
    company: "Shopify Inc.",
    event: "Merchant take-rate mix and fulfillment cost data imply margin reset.",
    currentPrice: "$68.25",
    targetRange: "$76–$81",
    potentialMove: "+11.4% to +18.7%",
    profitScore: 81,
    confidenceScore: 84,
    riskLevel: "Medium",
    pricedInCheck: "Not fully priced in; consensus revisions lag operating leverage signals.",
    patternMatch: "76% match to SaaS margin-revision setups after two consecutive positive data receipts.",
    explanation: "Multiple independent mock receipts align on improving contribution margin before analyst revisions.",
    rippleEffect: "Verified ripple: payment attach rate, app marketplace revenue, and fulfillment utilization all moved together.",
    risks: ["Consumer spending slowdown", "FX pressure", "Multiple compression"],
    receipts: ["Mock merchant survey", "Mock app-store ranking receipt", "Mock fulfillment utilization index"],
    publicTrackingResult: "Hit checkpoint 1: +4.1% since publication."
  },
  {
    id: "ford-ev-inventory",
    action: "AVOID",
    ticker: "F",
    company: "Ford Motor Company",
    event: "EV inventory days and incentive intensity deteriorate versus peers.",
    currentPrice: "$11.10",
    targetRange: "$9.40–$10.20",
    potentialMove: "-8.1% to -15.3%",
    profitScore: 62,
    confidenceScore: 73,
    riskLevel: "High",
    pricedInCheck: "Mostly not priced in for a downside scenario; dividend support may slow the move.",
    patternMatch: "69% match to legacy auto incentive cycles with delayed earnings impact.",
    explanation: "Avoid rating because downside receipts are strong but catalyst timing is uncertain.",
    rippleEffect: "Verified ripple: dealer incentives, floorplan financing costs, and regional inventory density worsened together.",
    risks: ["Labor agreement surprise", "Rate cuts", "Truck segment resilience"],
    receipts: ["Mock dealer inventory scrape", "Mock incentive index", "Mock regional financing spread"],
    publicTrackingResult: "Open: downside thesis invalidates above $12.35."
  }
];

export function getAlert(id: string) {
  return mockAlerts.find((alert) => alert.id === id) ?? mockAlerts[0];
}
