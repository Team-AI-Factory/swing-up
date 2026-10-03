import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";
import { companyProfileFixture } from "./helpers/company-profile-fixture.mjs";
const { sameCompanyName, verifiedCompanyProfile, extractCompanyProfile } = loadTsModule("@/lib/company-profile");
const now = new Date("2026-10-03T15:00:00Z");
const issuer = { ticker: "SERV", company: "Serve Robotics Inc. /DE/", cik: "0001832483" };
const cohort = { ...issuer, company: "Serve Robotics Inc." };
assert.equal(sameCompanyName(issuer.company, cohort.company), true);
assert.equal(sameCompanyName("SERVE ROBOTICS INC /DE/", cohort.company), true);
for (const other of ["Other Robotics Inc. /DE/", "Serve Robotics Holdings Inc. /DE/", "Serve Robotics Inc. /NV/", "Serve Robotics Inc. /DE/ Other", "Serve Robotics/DE/", "Serve Robotics Inc./alias/"]) {
  assert.equal(sameCompanyName(other, cohort.company), false, other);
}
// Synthetic source words keep the identity regression independent of any
// broadened product/customer grammar. Only the observed SEC suffix varies.
const profile = companyProfileFixture(cohort, now);
profile.company = issuer.company;
profile.business = "We develop and provide inventory management software and related support services for operating businesses.";
profile.description = `${profile.business} ${profile.customers}`;
assert.ok(verifiedCompanyProfile(profile, cohort, now));
assert.equal(verifiedCompanyProfile(profile, { ...cohort, cik: "0001832484" }, now), null);
assert.equal(verifiedCompanyProfile(profile, { ...cohort, ticker: "OTHER" }, now), null);
assert.equal(verifiedCompanyProfile(profile, { ...cohort, company: "Other Robotics Inc." }, now), null);
assert.equal(verifiedCompanyProfile({ ...profile, company: "Serve Robotics Inc. /NV/" }, cohort, now), null);
if (process.env.SERV_PROFILE_FIXTURE) {
  const cases = JSON.parse(readFileSync(new URL("./fixtures/company-profile-cohort-extracts.json", import.meta.url)));
  const source = cases.find(row => row.identity.ticker === "SERV"), bytes = readFileSync(process.env.SERV_PROFILE_FIXTURE);
  assert.equal(createHash("sha256").update(bytes).digest("hex"), source.sourceSha256);
  const live = extractCompanyProfile({ ...source, identity: issuer, html: bytes.toString(), now });
  assert.ok(live); assert.ok(verifiedCompanyProfile(live, cohort, now));
  assert.equal(live.company, issuer.company, "Retain original SEC issuer display name as provenance");
}
console.log("SEC legal name: observed trailing /DE/ matches full issuer name; different names, CIKs, tickers and arbitrary aliases still reject.");
