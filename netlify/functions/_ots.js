// _ots.js — OpenTimestamps: batched calendar stamping + Bitcoin upgrade.
// Isolated from _shared.js so functions that never anchor (api.js, og-image.js)
// don't bundle the dependency.
//
// opentimestamps is CommonJS with dynamic require() of node built-ins, which
// esbuild cannot inline into ESM. It MUST stay external — see
// `external_node_modules = ["opentimestamps"]` in netlify.toml. Verified: with
// that flag the function bundles to <1KB and runs; without it the ESM bundle
// throws `Dynamic require of "util" is not supported` at runtime.
//
// OTS commits to a 32-byte SHA-256 digest (no SHA-384 op exists). We stamp
// sha256(fingerprintHex), where fingerprintHex is the reproducible SHA-384 of
// the canonical manifest. A verifier re-derives both from the manifest alone.

import OpenTimestamps from "opentimestamps";
import { createHash } from "crypto";

const { DetachedTimestampFile, Ops, Context, Notary } = OpenTimestamps;

function digestForFingerprint(fingerprintHex) {
  return createHash("sha256").update(Buffer.from(fingerprintHex, "utf8")).digest();
}

function detachedFor(fingerprintHex) {
  return DetachedTimestampFile.fromHash(new Ops.OpSHA256(), digestForFingerprint(fingerprintHex));
}

function proofToB64(dtf) {
  return Buffer.from(dtf.serializeToBytes()).toString("base64");
}

function proofFromB64(b64) {
  const ctx = new Context.StreamDeserialization(Buffer.from(b64, "base64"));
  return DetachedTimestampFile.deserialize(ctx);
}

// Read the confirmed Bitcoin block height from a proof, or null if still pending.
function bitcoinHeight(dtf) {
  for (const [, att] of dtf.timestamp.allAttestations()) {
    if (att instanceof Notary.BitcoinBlockHeaderAttestation) return att.height;
  }
  return null;
}

// Stamp many fingerprints in ONE calendar submission (single Merkle root per
// run). Returns Map<fingerprintHex, base64 .ots>. Network call to calendars;
// throws on total failure so the caller can leave ots_proof null for retry.
export async function stampFingerprints(fingerprints) {
  const unique = [...new Set(fingerprints.filter(Boolean))];
  if (!unique.length) return new Map();
  const files = unique.map(detachedFor);
  await OpenTimestamps.stamp(files);            // aggregates + submits once
  return new Map(unique.map((fp, i) => [fp, proofToB64(files[i])]));
}

// Try to advance a pending proof toward a Bitcoin attestation.
// Returns { proof, btcBlock, changed }. btcBlock != null ⇒ confirmed.
export async function upgradeProofB64(b64) {
  const dtf = proofFromB64(b64);
  let changed = false;
  try { changed = await OpenTimestamps.upgrade(dtf); } catch { /* calendar flaky; keep old proof */ }
  return { proof: changed ? proofToB64(dtf) : b64, btcBlock: bitcoinHeight(dtf), changed };
}

// For a row that has no proof yet (legacy/crawler-inline capture), create one.
export async function stampOne(fingerprintHex) {
  const m = await stampFingerprints([fingerprintHex]);
  return m.get(fingerprintHex) || null;
}
