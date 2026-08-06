#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";

const path = "lib/opportunity-engine/us-signal-operations.ts";
let source = await readFile(path, "utf8");
const broken = "async function fetchYahooSeries(async function fetchYahooSeries(";
const fixed = "async function fetchYahooSeries(";
const count = source.split(broken).length - 1;
if (count !== 1) throw new Error(`broken_marker_expected_once_found_${count}`);
source = source.replace(broken, fixed);
await writeFile(path, source, "utf8");
console.log("Fixed the PR #262 Yahoo function marker.");
