import { createHash } from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";

/** Byte cache, not a source authenticator. Only a trusted SEC transport may mint
 * records, after response.status === 200 and actual reader EOF. A private cache
 * must preserve them. A caller must never upgrade old/extracted/truncated text.
 * Binding metadata must first be authenticated against SEC submissions and,
 * for a 40-F AIF, the authenticated wrapper and exact same-accession index.
 * Also require a validated annual document identity/content path before
 * persistence: HTTP 200 SEC error/challenge pages are not filing sources.
 */
export const COMPLETE_SOURCE_VERSION = "sec-annual-complete-bytes-v1" as const;
export const MAX_COMPLETE_SOURCE_BYTES = 12_000_000;
export const MAX_COMPLETE_SOURCE_GZIP_BYTES = 512 * 1024;
const MAX_BASE64_CHARS = 4 * Math.ceil(MAX_COMPLETE_SOURCE_GZIP_BYTES / 3);
const MAX_URL_CHARS = 1024;

export type CompleteSourceBinding = Readonly<{
  cik: string;
  form: "10-K" | "20-F" | "40-F";
  url: string;
  filedAt: string;
  annualFilingUrl?: string;
  annualFilingIndexUrl?: string;
}>;
export type CompleteSourceRecord = Readonly<{
  sourceVersion: typeof COMPLETE_SOURCE_VERSION;
  binding: CompleteSourceBinding;
  accessionNumber: string;
  documentName: string;
  requestUrl: string;
  finalUrl: string;
  status: 200;
  eof: true;
  observedAt: string;
  encoding: "gzip+base64";
  rawByteLength: number;
  compressedByteLength: number;
  sha256: string;
  body: string;
}>;
export type CompleteSourceInput = Readonly<{
  binding: CompleteSourceBinding;
  bytes: Uint8Array;
  requestUrl: string;
  finalUrl: string;
  status: number;
  eof: boolean;
  observedAt: string;
}>;
export type CompleteSourceRead =
  | Readonly<{ status: "missing" | "invalid" }>
  | Readonly<{ status: "valid"; html: string; record: CompleteSourceRecord }>;
type Time = number | Date;
type ObjectValue = Record<string, unknown>;
const invalid = Object.freeze({ status: "invalid" } as const);
const missing = Object.freeze({ status: "missing" } as const);
const isObject = (value: unknown): value is ObjectValue =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function timeValue(now: Time): number {
  return now instanceof Date ? now.getTime() : now;
}
function validDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}
function validObservedAt(value: unknown, filedAt: string, now: Time): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return false;
  const observed = Date.parse(value), current = timeValue(now);
  return Number.isFinite(current) && Number.isFinite(observed)
    && new Date(observed).toISOString() === value && observed <= current
    && observed >= Date.parse(filedAt);
}
function archive(value: unknown, cik: string) {
  // Exact lexical spelling rejects normalization, credentials, ports, escapes,
  // dot-segments, query strings, fragments, viewer URLs and alternate hosts.
  if (typeof value !== "string" || value.length > MAX_URL_CHARS) return null;
  const match = /^https:\/\/www\.sec\.gov\/Archives\/edgar\/data\/([1-9]\d{0,9})\/(\d{18})\/([A-Za-z0-9][A-Za-z0-9._-]{0,199}\.html?)$/.exec(value);
  if (!match || match[1] !== String(Number(cik))) return null;
  const accessionDigits = match[2];
  if (/^0{10}/.test(accessionDigits) || /0{6}$/.test(accessionDigits)) return null;
  return {
    accessionNumber: `${accessionDigits.slice(0, 10)}-${accessionDigits.slice(10, 12)}-${accessionDigits.slice(12)}`,
    year: accessionDigits.slice(10, 12), documentName: match[3],
    directory: value.slice(0, value.lastIndexOf("/") + 1),
  };
}
function canonicalBinding(value: unknown) {
  if (!isObject(value) || typeof value.cik !== "string" || !/^\d{1,10}$/.test(value.cik)
    || Number(value.cik) <= 0 || !["10-K", "20-F", "40-F"].includes(value.form as string)
    || !validDate(value.filedAt)) return null;
  const cik = value.cik.padStart(10, "0"), ref = archive(value.url, cik);
  if (!ref || ref.year !== value.filedAt.slice(2, 4) || /(?:^index|[-_]index)\.html?$/i.test(ref.documentName)) return null;
  let binding: CompleteSourceBinding;
  if (value.form === "40-F") {
    const wrapper = archive(value.annualFilingUrl, cik);
    if (!wrapper || wrapper.directory !== ref.directory || value.annualFilingUrl === value.url
      || /(?:^index|[-_]index)\.html?$/i.test(wrapper.documentName)
      || value.annualFilingIndexUrl !== `${ref.directory}${ref.accessionNumber}-index.html`) return null;
    binding = { cik, form: "40-F", url: value.url as string, filedAt: value.filedAt,
      annualFilingUrl: value.annualFilingUrl as string, annualFilingIndexUrl: value.annualFilingIndexUrl as string };
  } else {
    if (value.annualFilingUrl !== undefined || value.annualFilingIndexUrl !== undefined) return null;
    binding = { cik, form: value.form as "10-K" | "20-F", url: value.url as string, filedAt: value.filedAt };
  }
  return { binding: Object.freeze(binding), ref };
}
function sameBinding(a: CompleteSourceBinding, b: CompleteSourceBinding) {
  return a.cik === b.cik && a.form === b.form && a.url === b.url && a.filedAt === b.filedAt
    && a.annualFilingUrl === b.annualFilingUrl && a.annualFilingIndexUrl === b.annualFilingIndexUrl;
}
function freezeRecord(record: CompleteSourceRecord): CompleteSourceRecord {
  return Object.freeze(record);
}

/** Returns null for inadmissible/oversize data or optional compression failures.
 * Supply the original response bytes and observation timestamp, never html
 * re-encoded after replacement decoding, extracted sections or cache read time.
 * The explicit now argument is solely a validation clock. No TTL is imposed.
 */
export function createCompleteSourceRecord(input: CompleteSourceInput, now: Time): CompleteSourceRecord | null {
  try {
    if (!isObject(input)) return null;
    const canonical = canonicalBinding(input.binding);
    if (!canonical || input.status !== 200 || input.eof !== true
      || input.requestUrl !== canonical.binding.url || input.finalUrl !== canonical.binding.url
      || !validObservedAt(input.observedAt, canonical.binding.filedAt, now)
      || !(input.bytes instanceof Uint8Array) || input.bytes.byteLength < 1
      || input.bytes.byteLength > MAX_COMPLETE_SOURCE_BYTES) return null;
    // Snapshot before hash/compression so later caller mutations cannot alter it.
    const bytes = Buffer.from(input.bytes);
    const compressed = gzipSync(bytes, { level: 9, maxOutputLength: MAX_COMPLETE_SOURCE_GZIP_BYTES });
    if (compressed.byteLength > MAX_COMPLETE_SOURCE_GZIP_BYTES) return null;
    return freezeRecord({
      sourceVersion: COMPLETE_SOURCE_VERSION, binding: canonical.binding,
      accessionNumber: canonical.ref.accessionNumber, documentName: canonical.ref.documentName,
      requestUrl: input.requestUrl, finalUrl: input.finalUrl, status: 200, eof: true,
      observedAt: input.observedAt, encoding: "gzip+base64", rawByteLength: bytes.byteLength,
      compressedByteLength: compressed.byteLength, sha256: sha256(bytes), body: compressed.toString("base64"),
    });
  } catch { return null; }
}

/** Strict private-cache decode. Neither this nor create authenticates a forged
 * record or transport assertion. Validation never renews observedAt/filing date,
 * and an old record may be valid here but expired under the caller's TTL.
 */
export function readCompleteSourceRecord(value: unknown, binding: CompleteSourceBinding, now: Time): CompleteSourceRead {
  if (value === null || value === undefined) return missing;
  try {
    const expected = canonicalBinding(binding);
    if (!expected || !isObject(value)) return invalid;
    const stored = canonicalBinding(value.binding);
    if (!stored || !sameBinding(stored.binding, expected.binding)
      || value.sourceVersion !== COMPLETE_SOURCE_VERSION || value.encoding !== "gzip+base64"
      || value.accessionNumber !== stored.ref.accessionNumber || value.documentName !== stored.ref.documentName
      || value.requestUrl !== stored.binding.url || value.finalUrl !== stored.binding.url
      || value.status !== 200 || value.eof !== true
      || !validObservedAt(value.observedAt, stored.binding.filedAt, now)
      || !Number.isSafeInteger(value.rawByteLength) || (value.rawByteLength as number) < 1
      || (value.rawByteLength as number) > MAX_COMPLETE_SOURCE_BYTES
      || !Number.isSafeInteger(value.compressedByteLength) || (value.compressedByteLength as number) < 1
      || (value.compressedByteLength as number) > MAX_COMPLETE_SOURCE_GZIP_BYTES
      || typeof value.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(value.sha256)
      || typeof value.body !== "string" || value.body.length < 4 || value.body.length > MAX_BASE64_CHARS
      || value.body.length !== 4 * Math.ceil((value.compressedByteLength as number) / 3)) return invalid;
    // Buffer's base64 decoder is permissive; exact round-trip also rejects
    // whitespace, URL-safe alphabet, missing padding and nonzero pad bits.
    const compressed = Buffer.from(value.body, "base64");
    if (compressed.byteLength !== value.compressedByteLength || compressed.toString("base64") !== value.body) return invalid;
    // zlib's output cap is enforced during decompression, before allocation of
    // an unbounded result. The declared raw length is an additional tighter cap.
    // Node returns {buffer, engine} for info:true; some @types/node versions
    // still declare only Buffer for this supported zlib option.
    const inflated = gunzipSync(compressed, { info: true,
      maxOutputLength: Math.min(value.rawByteLength as number, MAX_COMPLETE_SOURCE_BYTES),
    }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
    const bytes = inflated.buffer;
    if (inflated.engine.bytesWritten !== compressed.byteLength
      || bytes.byteLength !== value.rawByteLength || sha256(bytes) !== value.sha256) return invalid;
    const record = freezeRecord({
      sourceVersion: COMPLETE_SOURCE_VERSION, binding: stored.binding,
      accessionNumber: stored.ref.accessionNumber, documentName: stored.ref.documentName,
      requestUrl: value.requestUrl as string, finalUrl: value.finalUrl as string, status: 200, eof: true,
      observedAt: value.observedAt, encoding: "gzip+base64", rawByteLength: bytes.byteLength,
      compressedByteLength: compressed.byteLength, sha256: value.sha256, body: value.body,
    });
    // Same default UTF-8 replacement/BOM handling as a streaming TextDecoder
    // plus its final flush. The hash still covers exact original bytes.
    return Object.freeze({ status: "valid", html: new TextDecoder().decode(bytes), record });
  } catch { return invalid; }
}
