import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash, randomBytes } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import { loadTsModule } from "./helpers/load-typescript-module.mjs";
const { createCompleteSourceRecord: create, readCompleteSourceRecord: read,
  MAX_COMPLETE_SOURCE_BYTES: RAW_MAX, MAX_COMPLETE_SOURCE_GZIP_BYTES: GZIP_MAX,
  COMPLETE_SOURCE_VERSION } = loadTsModule("@/lib/company-profile-complete-source");

const binding = Object.freeze({ cik: "0001836981", form: "10-K", filedAt: "2026-03-02",
  url: "https://www.sec.gov/Archives/edgar/data/1836981/000183698126000018/bbai-20251231.htm" });
const now = Date.parse("2026-10-03T16:00:00.000Z");
const observedAt = "2026-10-02T12:34:56.123Z";
const bytes = new TextEncoder().encode("\uFEFF<html><body>Complete annual report. 金 </body></html>");
const input = { binding, bytes, requestUrl: binding.url, finalUrl: binding.url, status: 200, eof: true, observedAt };
const base = create(input, now);
assert.ok(base);
const clone = value => JSON.parse(JSON.stringify(value));
const hash = value => createHash("sha256").update(value).digest("hex");
const expectInvalid = (value, expectedBinding = binding, clock = now) => assert.equal(read(value, expectedBinding, clock).status, "invalid");

// These tests simulate transport assertions. They cannot authenticate an arbitrary
// caller lying about EOF/status, and never migrate old text into a real cache.
test("complete bytes round-trip, exact hash/length, immutable snapshots and no proof renewal", () => {
  assert.equal(base.sourceVersion, COMPLETE_SOURCE_VERSION);
  assert.equal(base.sha256, hash(bytes));
  assert.equal(base.rawByteLength, bytes.byteLength);
  assert.deepEqual(gunzipSync(Buffer.from(base.body, "base64")), Buffer.from(bytes));
  const result = read(clone(base), binding, now + 365 * 86400000);
  assert.equal(result.status, "valid");
  assert.equal(result.html, new TextDecoder().decode(bytes));
  assert.equal(result.record.observedAt, observedAt);
  assert.equal(result.record.binding.filedAt, binding.filedAt);
  assert.deepEqual(result.record, base);
  assert.ok(Object.isFrozen(result)); assert.ok(Object.isFrozen(result.record)); assert.ok(Object.isFrozen(result.record.binding));
  assert.throws(() => { result.record.observedAt = "2026-10-03T16:00:00.000Z"; }, TypeError);
  assert.throws(() => { result.record.binding.filedAt = "2026-10-03"; }, TypeError);
  const mutableBinding = { ...binding }, mutableBytes = Uint8Array.from(bytes);
  const record = create({ ...input, binding: mutableBinding, bytes: mutableBytes }, new Date(now));
  mutableBinding.url = "changed"; mutableBytes.fill(0);
  assert.deepEqual(record, base, "record keeps byte and binding snapshots");
  assert.notEqual(result.record, base, "decoded records never expose arbitrary input object references");
});
test("UTF-8 decoding matches stream boundaries, replacement and final flush; hash preserves invalid bytes", () => {
  const invalidUtf8 = Uint8Array.from([0xef,0xbb,0xbf,65,0xf0,0x9f,0x8e,0x89,0xff,0xe2,0x82]);
  const decoder = new TextDecoder();
  let streamed = "";
  for (const byte of invalidUtf8) streamed += decoder.decode(Uint8Array.of(byte), { stream: true });
  streamed += decoder.decode();
  const record = create({ ...input, bytes: invalidUtf8 }, now);
  assert.ok(record); assert.equal(record.sha256, hash(invalidUtf8));
  assert.equal(read(record, binding, now).html, streamed);
  assert.notEqual(hash(new TextEncoder().encode(streamed)), record.sha256);
});
test("null/undefined is missing; legacy text, partial caches and malformed shapes are invalid", () => {
  for (const value of [null, undefined]) assert.equal(read(value, binding, now).status, "missing");
  for (const value of [false, 1, "", "old business text", [], {}, { html: "truncated" }, { ...base, sourceVersion: undefined }, { ...base, sourceVersion: "v0" }]) expectInvalid(value);
  const throwing = Object.defineProperty({}, "sourceVersion", { get() { throw Error("bad property"); } });
  expectInvalid(throwing);
  assert.equal(create(null, now), null);
});
test("genuine 200 + same request/final URL + literal EOF are mandatory, including cache reads", () => {
  for (const status of [0, 206, 301, 302, 304, 404, 500, "200"]) {
    assert.equal(create({ ...input, status }, now), null);
    expectInvalid({ ...base, status });
  }
  for (const eof of [false, undefined, null, 0, "true"]) {
    assert.equal(create({ ...input, eof }, now), null); expectInvalid({ ...base, eof });
  }
  for (const field of ["requestUrl", "finalUrl"]) {
    for (const url of [undefined, binding.url + "?raw=1", binding.url.replace("bbai-20251231.htm", "other.htm"), binding.url.replace("www.sec.gov", "sec.gov")]) {
      assert.equal(create({ ...input, [field]: url }, now), null); expectInvalid({ ...base, [field]: url });
    }
  }
});
test("canonical issuer URL, filing date/year, form and document are bound without submitter==issuer", () => {
  const otherSubmitter = { ...binding, url: binding.url.replace("000183698126000018", "000162828026000018") };
  const record = create({ ...input, binding: otherSubmitter, requestUrl: otherSubmitter.url, finalUrl: otherSubmitter.url }, now);
  assert.ok(record); assert.equal(read(record, otherSubmitter, now).status, "valid");
  assert.equal(record.accessionNumber, "0001628280-26-000018");
  assert.equal(read(base, { ...binding, cik: "1836981" }, now).status, "valid");
  const changed = [{ cik: "0001836982" }, { cik: "0" }, { cik: " 1836981" }, { cik: "01836981a" }, { cik: 1836981 },
    { form: "20-F" }, { form: "10-K/A" }, { form: "10-k" }, { form: "8-K" }, { filedAt: "2026-03-03" },
    { filedAt: "2026-02-30" }, { filedAt: "2025-03-02" }, { filedAt: "2026-3-2" }, { filedAt: "2026-03-02T00:00:00.000Z" }];
  for (const change of changed) {
    expectInvalid(base, { ...binding, ...change });
    expectInvalid({ ...base, binding: { ...binding, ...change } });
  }
  for (const url of [binding.url.replace("https:", "http:"), binding.url.replace("www.sec.gov", "WWW.SEC.GOV"),
    binding.url.replace("www.sec.gov", "sec.gov"), binding.url.replace("www.sec.gov", "evil.example"),
    binding.url.replace("www.sec.gov", "www.sec.gov:443"), binding.url.replace("www.sec.gov", "user@www.sec.gov"),
    binding.url.replace("https://", "https:////"), binding.url.replace("/data/", "/data//"),
    binding.url.replace("/1836981/", "/01836981/"), binding.url.replace("/1836981/", "/1836982/"),
    binding.url.replace("bbai-", "../bbai-"), binding.url.replace("bbai-", "%62bai-"), binding.url + "?x=1", binding.url + "#p1",
    binding.url.replace("000183698126000018", "000183698125000018"), binding.url.replace("bbai-20251231.htm", "0001836981-26-000018-index.html"),
    binding.url.replace("bbai-20251231.htm", "index.html"), binding.url.replace(".htm", ".pdf"), binding.url + " "] ) {
    const badBinding = { ...binding, url };
    assert.equal(create({ ...input, binding: badBinding, requestUrl: url, finalUrl: url }, now), null, url);
    expectInvalid(base, badBinding);
  }
  expectInvalid({ ...base, accessionNumber: "0001628280-26-000018" });
  expectInvalid({ ...base, documentName: "other.htm" });
  expectInvalid(base, { ...binding, url: binding.url.replace("bbai-20251231.htm", "other.htm") });
});
test("40-F AIF is bound to distinct wrapper and exact same-accession SEC index", () => {
  const directory = "https://www.sec.gov/Archives/edgar/data/1993344/000162828026022512/";
  const aif = { cik: "0001993344", form: "40-F", filedAt: "2026-04-01", url: directory + "a991-alliedx2026aif.htm",
    annualFilingUrl: directory + "aaue-20251231.htm", annualFilingIndexUrl: directory + "0001628280-26-022512-index.html" };
  const record = create({ ...input, binding: aif, requestUrl: aif.url, finalUrl: aif.url }, now);
  assert.ok(record); assert.equal(read(record, aif, now).status, "valid");
  for (const change of [{ annualFilingUrl: undefined }, { annualFilingIndexUrl: undefined }, { annualFilingUrl: aif.url },
    { annualFilingUrl: aif.annualFilingIndexUrl }, { annualFilingUrl: aif.annualFilingUrl.replace("022512", "022513") },
    { annualFilingIndexUrl: aif.annualFilingIndexUrl.replace("022512-index", "022513-index") },
    { annualFilingUrl: aif.annualFilingUrl.replace("1993344", "1993345") }, { annualFilingIndexUrl: aif.annualFilingIndexUrl + "?raw=1" },
    { annualFilingIndexUrl: aif.annualFilingIndexUrl.replace(".html", ".htm") }, { annualFilingUrl: aif.annualFilingUrl.replace("www.sec.gov", "evil.example") }]) {
    const badBinding = { ...aif, ...change };
    assert.equal(create({ ...input, binding: badBinding, requestUrl: aif.url, finalUrl: aif.url }, now), null);
    expectInvalid(record, badBinding); expectInvalid({ ...record, binding: badBinding }, aif);
  }
  // A different same-accession wrapper is structurally plausible, but is a
  // different authenticated identity: it must never reuse the original record.
  expectInvalid(record, { ...aif, annualFilingUrl: directory + "different.htm" });
  assert.equal(create({ ...input, binding: { ...binding, annualFilingUrl: binding.url } }, now), null);
});
test("calendar-valid original observedAt must be at/after filing and not in the future", () => {
  for (const date of ["2026-10-03T16:00:00.001Z", "2026-03-01T23:59:59.999Z", "2026-02-30T00:00:00.000Z",
    "2026-10-02", "2026-10-02T12:34:56Z", "2026-10-02T12:34:56.123+00:00", "2026-10-02T24:00:00.000Z", "invalid", undefined]) {
    assert.equal(create({ ...input, observedAt: date }, now), null, String(date)); expectInvalid({ ...base, observedAt: date });
  }
  const atFiling = binding.filedAt + "T00:00:00.000Z";
  assert.ok(create({ ...input, observedAt: atFiling }, now));
  for (const badClock of [NaN, Infinity, -Infinity, new Date("invalid"), "2026-10-03"]) {
    assert.equal(create(input, badClock), null); expectInvalid(base, binding, badClock);
  }
  expectInvalid(base, binding, Date.parse(observedAt) - 1);
});
test("canonical base64 and exact declared sizes are enforced before bounded inflation", () => {
  for (const body of ["", "!!!!", base.body + "\n", base.body.slice(0, -4), base.body.slice(1), base.body.replace(/[A-Za-z]/, "-"),
    "A".repeat(4 * Math.ceil(GZIP_MAX / 3) + 4)]) expectInvalid({ ...base, body });
  for (const field of ["rawByteLength", "compressedByteLength"]) {
    for (const length of [undefined, 0, -1, 1.5, "50", NaN, Infinity, Number.MAX_SAFE_INTEGER, base[field] + 1, base[field] - 1]) expectInvalid({ ...base, [field]: length });
  }
  for (const sha256 of [undefined, "x".repeat(64), "0".repeat(64), base.sha256.toUpperCase(), base.sha256.slice(1)]) expectInvalid({ ...base, sha256 });
  expectInvalid({ ...base, encoding: "raw" });
  // Force a one-byte gzip length remainder so canonical padding has unused bits.
  let paddingRecord;
  for (let n = 1; n < 80 && !paddingRecord; n++) { const r = create({ ...input, bytes: randomBytes(n) }, now); if (r.body.endsWith("==")) paddingRecord = r; }
  assert.ok(paddingRecord);
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const index = paddingRecord.body.length - 3;
  const old = alphabet.indexOf(paddingRecord.body[index]);
  const noncanonical = paddingRecord.body.slice(0, index) + alphabet[old | 1] + "==";
  assert.deepEqual(Buffer.from(noncanonical, "base64"), Buffer.from(paddingRecord.body, "base64"));
  expectInvalid({ ...paddingRecord, body: noncanonical });
  expectInvalid({ ...paddingRecord, body: paddingRecord.body.replace(/=+$/, "") });
});
test("corrupt, truncated gzip and changed decoded bytes fail closed", () => {
  const compressed = Buffer.from(base.body, "base64");
  const mutated = Buffer.from(compressed); mutated[mutated.length - 5] ^= 0xff;
  for (const data of [compressed.subarray(0, compressed.length - 1), compressed.subarray(0, Math.floor(compressed.length / 2)), mutated,
    Buffer.from("this is not gzip"), gzipSync(Buffer.from("replacement body")), Buffer.concat([compressed, Buffer.from([0])])]) {
    expectInvalid({ ...base, body: data.toString("base64"), compressedByteLength: data.byteLength });
  }
  const changed = Uint8Array.from(bytes); changed[4] ^= 1;
  const compressedChanged = gzipSync(changed);
  expectInvalid({ ...base, body: compressedChanged.toString("base64"), compressedByteLength: compressedChanged.byteLength });
});
test("raw and gzip caps handle exact boundaries and bombs without throwing", () => {
  assert.equal(create({ ...input, bytes: new Uint8Array(0) }, now), null);
  assert.equal(create({ ...input, bytes: new Uint8Array(RAW_MAX + 1) }, now), null);
  assert.equal(create({ ...input, bytes: "old HTML" }, now), null);
  assert.equal(create({ ...input, bytes: randomBytes(GZIP_MAX * 2) }, now), null, "optional compressed oversize fallback");
  const maximum = create({ ...input, bytes: new Uint8Array(RAW_MAX).fill(65) }, now);
  assert.ok(maximum); assert.equal(read(maximum, binding, now).status, "valid");
  const bombBytes = Buffer.alloc(RAW_MAX + 1, 65), bomb = gzipSync(bombBytes);
  assert.ok(bomb.byteLength < GZIP_MAX);
  expectInvalid({ ...base, rawByteLength: RAW_MAX, compressedByteLength: bomb.byteLength, sha256: hash(bombBytes), body: bomb.toString("base64") });
  const tighterBomb = gzipSync(Buffer.alloc(100_000, 65));
  expectInvalid({ ...base, rawByteLength: 10, compressedByteLength: tighterBomb.byteLength, body: tighterBomb.toString("base64") });
  const large = randomBytes(GZIP_MAX + 1);
  expectInvalid({ ...base, compressedByteLength: large.byteLength, body: large.toString("base64") });
});
