// anchor-checker.js — OpenTimestamps upgrader.
// Runs every 10 min. Two passes:
//   1. UPGRADE: rows that already carry a pending .ots proof but no Bitcoin
//      attestation yet. Ask the calendars whether the commitment has been
//      confirmed in a Bitcoin block. Only when a real
//      BitcoinBlockHeaderAttestation exists do we set btc_anchored/btc_block —
//      never before.
//   2. BACK-STAMP: canonical (raw_metadata.fp = "v2") rows that have no proof
//      yet — e.g. a crawler-inline capture, or a drainer run whose batch stamp
//      failed. Stamp them so pass 1 can upgrade them on a later run.
//
// This replaces the old behaviour, which blindly stamped every unanchored row
// with the *current* block height — a number that proved nothing.
// prechained.com · Built by NextGenRails™

import { supabase } from "./_shared.js";
import { upgradeProofB64, stampFingerprints } from "./_ots.js";

const TIMEOUT = 9000;
const UPGRADE_LIMIT = 100;   // pending proofs to probe per run
const STAMP_LIMIT = 200;     // unstamped v2 rows to back-stamp per run

export default async function handler(req, context) {
  const start = Date.now();
  console.log("[anchor-checker] start", new Date().toISOString());

  let probed = 0, upgraded = 0, advanced = 0, stamped = 0;

  // ── PASS 1: upgrade pending proofs toward a Bitcoin attestation ──
  const { data: pending, error: pErr } = await supabase
    .from("snapshots")
    .select("id, ots_proof")
    .not("ots_proof", "is", null)
    .eq("btc_anchored", false)
    .limit(UPGRADE_LIMIT);

  if (pErr) console.error("[anchor-checker] pending query:", pErr.message);

  for (const row of pending || []) {
    if (Date.now() - start > TIMEOUT) break;
    probed++;
    try {
      const { proof, btcBlock, changed } = await upgradeProofB64(row.ots_proof);
      if (btcBlock != null) {
        // Real, independently verifiable Bitcoin attestation. Promote the row.
        await supabase.from("snapshots").update({
          btc_anchored: true, btc_block: btcBlock, ots_proof: proof
        }).eq("id", row.id);
        upgraded++;
      } else if (changed) {
        // Proof advanced but isn't in a Bitcoin block yet — persist progress.
        await supabase.from("snapshots").update({ ots_proof: proof }).eq("id", row.id);
        advanced++;
      }
    } catch (e) {
      console.error(`[anchor-checker] upgrade ${row.id}:`, e.message);
    }
  }

  // ── PASS 2: back-stamp unstamped canonical rows ─────────────
  // Only fp:"v2" rows — legacy rows have non-reproducible fingerprints, so
  // stamping them would anchor a value no one can recompute. Those are handled
  // by the quarantine migration + verify.html, not here.
  if (Date.now() - start < TIMEOUT) {
    const { data: unstamped, error: uErr } = await supabase
      .from("snapshots")
      .select("id, sha384_fingerprint")
      .is("ots_proof", null)
      .eq("raw_metadata->>fp", "v2")
      .limit(STAMP_LIMIT);

    if (uErr) console.error("[anchor-checker] unstamped query:", uErr.message);

    if (unstamped && unstamped.length) {
      try {
        const proofs = await stampFingerprints(unstamped.map(r => r.sha384_fingerprint));
        await Promise.all(unstamped.map(async r => {
          const proof = proofs.get(r.sha384_fingerprint);
          if (!proof) return;
          const { error } = await supabase.from("snapshots")
            .update({ ots_proof: proof }).eq("id", r.id);
          if (!error) stamped++;
        }));
      } catch (e) {
        console.error("[anchor-checker] back-stamp failed:", e.message);
      }
    }
  }

  const elapsed = Date.now() - start;
  console.log(`[anchor-checker] done: probed ${probed}, upgraded ${upgraded}, advanced ${advanced}, stamped ${stamped}, ${elapsed}ms`);

  return new Response(JSON.stringify({
    ok: true, probed, upgraded, advanced, stamped,
    elapsed_ms: elapsed, timestamp: new Date().toISOString()
  }), { headers: { "Content-Type": "application/json" } });
}
