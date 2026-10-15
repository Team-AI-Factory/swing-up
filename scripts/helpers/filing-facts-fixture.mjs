import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { gunzipSync } from 'node:zlib';
export const filingFixtureManifest = JSON.parse(fs.readFileSync(new URL('../fixtures/filing-facts/manifest.json', import.meta.url), 'utf8'));
export function filingFixture(record) {
  const raw = gunzipSync(fs.readFileSync(new URL(`../fixtures/filing-facts/${record.fixture}`, import.meta.url)));
  assert.equal(raw.byteLength, record.rawBytes);
  assert.equal(crypto.createHash('sha256').update(raw).digest('hex'), record.sha256);
  return raw.toString('utf8');
}
