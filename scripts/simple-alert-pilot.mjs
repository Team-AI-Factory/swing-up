import { readFile } from "node:fs/promises";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";

const cohort = JSON.parse(await readFile(new URL("../config/simple-alert-pilot.json", import.meta.url), "utf8"));
const { assessSimpleAlertPilot } = loadTsModule("@/lib/simple-alert-pilot", { "@/config/simple-alert-pilot.json": cohort });
const args = process.argv.slice(2);
let snapshot;
if (args.length === 1 && args[0] === "--live") {
  // One public, read-only request. No credentials, providers, model calls or writes.
  const response = await fetch("https://swing-up-production.up.railway.app/api/public/valuation-watchlist?limit=1000", { signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`pilot_snapshot_http_${response.status}`);
  snapshot = await response.json();
} else if (args.length === 2 && args[0] === "--snapshot") {
  snapshot = JSON.parse(await readFile(args[1], "utf8"));
} else throw new Error("Use --live or --snapshot <saved-public-snapshot.json>");
console.log(JSON.stringify(assessSimpleAlertPilot(snapshot), null, 2));
