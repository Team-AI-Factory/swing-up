export function ReceiptList({ receipts }: { receipts: string[] }) {
  return <ul className="receipts">{receipts.map((receipt) => <li key={receipt}>{receipt}</li>)}</ul>;
}
