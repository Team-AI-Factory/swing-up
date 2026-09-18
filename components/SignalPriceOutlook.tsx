import { signalAction, type PriceOutlook } from "@/lib/signal-outlook";

function money(value: number | null, currency: string | null) {
  if (value === null) return "Not yet estimated";
  return currency ? new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 2 }).format(value)
    : `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })} (currency unconfirmed)`;
}
const percent = (value: number | null, showPositiveSign = true) => value === null ? "Not yet estimated" : `${showPositiveSign && value > 0 ? "+" : ""}${value.toFixed(1)}%`;

export function SignalPriceOutlook({ outlook, action }: { outlook: PriceOutlook; action: string }) {
  const sell = signalAction(action) === "sell";
  const buy = signalAction(action) === "buy";
  return <div className="signal-outlook">
    <div className="signal-return"><span>{sell ? "Potential decline to base" : buy ? "Potential gain to base" : "Price move to base"}</span><strong>{percent(sell || buy ? outlook.potentialPercent : outlook.base.changePercent, !sell)}</strong></div>
    <div className="signal-price-grid">
      <div><span>Current recorded price</span><strong>{money(outlook.currentPrice, outlook.currency)}</strong></div>
      {([ ["Conservative case", outlook.conservative], ["Base case (middle)", outlook.base], ["Best case (estimated)", outlook.optimistic] ] as const).map(([label, value]) => <div key={label}><span>{label} · {outlook.basis === "historical_scenarios" ? "price scenario" : "business value"}</span><strong>{money(value.price, outlook.currency)}</strong><small>{percent(value.changePercent)} from current</small></div>)}
    </div>
    <p><strong>Upside:</strong> {percent(outlook.upsidePercent)} · <strong>Downside:</strong> {percent(outlook.downsidePercent)}</p>
    <p><strong>Timeline:</strong> {outlook.horizon}</p>
    {outlook.basis === "historical_scenarios" ? <p className="muted">Scenarios use similar historical events. Prices can move beyond this range.</p> : <p className="muted">Values estimate what the business may be worth. The conservative value is not a worst-case loss estimate.</p>}
    {outlook.horizonBasis === "unavailable" && outlook.assessmentWindow ? <p className="muted">Event assessment window: {outlook.assessmentWindow}. A price target and arrival date still need evidence.</p> : null}
    {sell ? <p className="muted">Selling shares you own can avoid a later decline. A price fall is not automatically a profit; a short-sale return would also depend on costs and execution.</p> : null}
  </div>;
}
