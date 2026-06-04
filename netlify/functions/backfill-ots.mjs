// backfill-ots.mjs — One-time OTS backfill as a Netlify Background Function.
// Background functions get a 15-minute timeout vs 10 seconds for regular functions.
// Trigger manually: POST https://prechained.com/.netlify/functions/backfill-ots
// Protected by a secret token in the request body.
//
// What it does:
//   PASS 1 — Stamps all v2 rows with no ots_proof (in batches of 500)
//   PASS 2 — Upgrades all rows with ots_proof but no btc_block toward Bitcoin attestation
//
// Run it multiple times. Each run processes up to STAMP_BATCH rows then returns.
// Check progress by re-running the Supabase query:
//   SELECT raw_metadata->>'fp', COUNT(*), SUM(CASE WHEN ots_proof IS NULL THEN 1 ELSE 0 END) no_proof,
//          SUM(CASE WHEN btc_anchored = true THEN 1 ELSE 0 END) anchored
//   FROM snapshots GROUP BY 1;
//
// prechained.com · NextGenRails™

import { createClient } from "@supabase/supabase-js";
import OpenTimestamps from "opentimestamps";
import { createHash } from "crypto";

const { DetachedTimestampFile, Ops, Context, Notary } = OpenTimestamps;

// ─── CONFIG ──────────────────────────────────────────────────────────────────
const STAMP_BATCH   = 500;   // rows to stamp per run (OTS batches into one Merkle root — very efficient)
const UPGRADE_BATCH = 300;   // pending proofs to upgrade per run
const SECRET        = process.env.BACKFILL_SECRET; // set this in Netlify env vars

// ─── SUPABASE ─────────────────────────────────────────────────────────────────
function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key);
}

// ─── OTS HELPERS ──────────────────────────────────────────────────────────────
function digestForFingerprint(fp) {
  return createHash("sha256").update(Buffer.from(fp, "utf8")).digest();
}

function detachedFor(fp) {
  return DetachedTimestampFile.fromHash(new Ops.OpSHA256(), digestForFingerprint(fp));
}

function proofToB64(dtf) {
  return Buffer.from(dtf.serializeToBytes()).toString("base64");
}

function proofFromB64(b64) {
  const ctx = new Context.StreamDeserialization(Buffer.from(b64, "base64"));
  return DetachedTimestampFile.deserialize(ctx);
}

function bitcoinHeight(dtf) {
  for (const [, att] of dtf.timestamp.allAttestations()) {
    if (att instanceof Notary.BitcoinBlockHeaderAttestation) return att.height;
  }
  return null;
}

async function stampBatch(fingerprints) {
  const unique = [...new Set(fingerprints.filter(Boolean))];
  if (!unique.length) return new Map();
  const files = unique.map(detachedFor);
  await OpenTimestamps.stamp(files);
  return new Map(unique.map((fp, i) => [fp, proofToB64(files[i])]));
}

async function upgradeProof(b64) {
  const dtf = proofFromB64(b64);
  let changed = false;
  try { changed = await OpenTimestamps.upgrade(dtf); } catch { /* calendar flaky */ }
  return { proof: changed ? proofToB64(dtf) : b64, btcBlock: bitcoinHeight(dtf), changed };
}

// ─── MAIN HANDLER ─────────────────────────────────────────────────────────────
export default async function handler(req) {
  const start = Date.now();
  console.log("[backfill-ots] start", new Date().toISOString());

  // Auth check
  if (SECRET) {
    let body = {};
    try { body = await req.json(); } catch {}
    if (body.secret !== SECRET) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { "Content-Type": "application/json" }
      });
    }
  }

  const supabase = getSupabase();
  const results = { stamped: 0, stamp_errors: 0, upgraded: 0, advanced: 0, upgrade_errors: 0, elapsed_ms: 0 };

  // ── PASS 1: Stamp unstamped v2 rows ──────────────────────────────────────────
  console.log(`[backfill-ots] fetching up to ${STAMP_BATCH} unstamped v2 rows...`);
  const { data: unstamped, error: uErr } = await supabase
    .from("snapshots")
    .select("id, sha384_fingerprint")
    .is("ots_proof", null)
    .eq("raw_metadata->>fp", "v2")
    .limit(STAMP_BATCH);

  if (uErr) {
    console.error("[backfill-ots] fetch error:", uErr.message);
  } else if (unstamped && unstamped.length > 0) {
    console.log(`[backfill-ots] stamping ${unstamped.length} rows...`);
    try {
      const proofMap = await stampBatch(unstamped.map(r => r.sha384_fingerprint));
      // Write proofs back in parallel batches of 50
      const chunks = [];
      for (let i = 0; i < unstamped.length; i += 50) chunks.push(unstamped.slice(i, i + 50));
      for (const chunk of chunks) {
        await Promise.all(chunk.map(async r => {
          const proof = proofMap.get(r.sha384_fingerprint);
          if (!proof) return;
          const { error } = await supabase.from("snapshots")
            .update({ ots_proof: proof })
            .eq("id", r.id);
          if (error) {
            console.error(`[backfill-ots] write error ${r.id}:`, error.message);
            results.stamp_errors++;
          } else {
            results.stamped++;
          }
        }));
      }
      console.log(`[backfill-ots] stamped ${results.stamped}, errors: ${results.stamp_errors}`);
    } catch (e) {
      console.error("[backfill-ots] stamp batch failed:", e.message);
      results.stamp_errors = unstamped.length;
    }
  } else {
    console.log("[backfill-ots] no unstamped v2 rows found — all stamped!");
  }

  // ── PASS 2: Upgrade pending proofs toward Bitcoin attestation ────────────────
  console.log(`[backfill-ots] fetching up to ${UPGRADE_BATCH} pending proofs...`);
  const { data: pending, error: pErr } = await supabase
    .from("snapshots")
    .select("id, ots_proof")
    .not("ots_proof", "is", null)
    .eq("btc_anchored", false)
    .limit(UPGRADE_BATCH);

  if (pErr) {
    console.error("[backfill-ots] pending fetch error:", pErr.message);
  } else if (pending && pending.length > 0) {
    console.log(`[backfill-ots] upgrading ${pending.length} pending proofs...`);
    for (const row of pending) {
      try {
        const { proof, btcBlock, changed } = await upgradeProof(row.ots_proof);
        if (btcBlock != null) {
          await supabase.from("snapshots").update({
            btc_anchored: true, btc_block: btcBlock, ots_proof: proof
          }).eq("id", row.id);
          results.upgraded++;
          console.log(`[backfill-ots] ANCHORED row ${row.id} → Bitcoin block ${btcBlock}`);
        } else if (changed) {
          await supabase.from("snapshots").update({ ots_proof: proof }).eq("id", row.id);
          results.advanced++;
        }
      } catch (e) {
        console.error(`[backfill-ots] upgrade error ${row.id}:`, e.message);
        results.upgrade_errors++;
      }
    }
    console.log(`[backfill-ots] upgraded: ${results.upgraded}, advanced: ${results.advanced}`);
  } else {
    console.log("[backfill-ots] no pending proofs to upgrade yet");
  }

  results.elapsed_ms = Date.now() - start;
  console.log("[backfill-ots] done", results);

  return new Response(JSON.stringify({ ok: true, ...results }), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}
