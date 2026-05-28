// pruner.mjs — Supabase Storage Pruner
// Runs nightly. Nulls out raw_metadata on snapshots older than 30 days.
// Keeps: receipt_id, sha384_fingerprint, btc_block, version, ecosystem — forever.
// Drops: raw_metadata (full JSON manifests) — already stored in GitHub archive.
// This gives effectively unlimited capture capacity on the free Supabase plan.
// prechained.com · Built by NextGenRails™

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, context) {
  const startTime = Date.now();
  console.log(`[pruner] starting ${new Date().toISOString()}`);

  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  let totalPruned = 0;
  let errors = 0;

  try {
    // Null out raw_metadata on snapshots older than 30 days
    // that still have raw_metadata (haven't been pruned yet)
    // Process in batches to avoid timeout
    let batchNum = 0;
    while (true) {
      const { data: batch, error: fetchErr } = await supabase
        .from("snapshots")
        .select("id")
        .lt("captured_at", cutoff)
        .not("raw_metadata", "is", null)
        .limit(500);

      if (fetchErr) {
        console.error("[pruner] fetch error:", fetchErr.message);
        errors++;
        break;
      }

      if (!batch || batch.length === 0) break;

      const ids = batch.map(r => r.id);
      const { error: updateErr } = await supabase
        .from("snapshots")
        .update({ raw_metadata: null })
        .in("id", ids);

      if (updateErr) {
        console.error("[pruner] update error:", updateErr.message);
        errors++;
        break;
      }

      totalPruned += ids.length;
      batchNum++;
      console.log(`[pruner] batch ${batchNum}: pruned ${ids.length} rows (total: ${totalPruned})`);

      // If we got less than 500, we're done
      if (ids.length < 500) break;

      // Safety: max 10 batches per run (5000 rows) to stay within timeout
      if (batchNum >= 10) {
        console.log("[pruner] reached batch limit — will continue next run");
        break;
      }
    }

    // Also log current DB usage stats for monitoring
    const { count: totalSnapshots } = await supabase
      .from("snapshots")
      .select("*", { count: "exact", head: true });

    const { count: prunedSnapshots } = await supabase
      .from("snapshots")
      .select("*", { count: "exact", head: true })
      .is("raw_metadata", null);

    const elapsed = Date.now() - startTime;
    console.log(`[pruner] done: ${totalPruned} rows pruned, ${errors} errors, ${elapsed}ms`);
    console.log(`[pruner] db stats: ${totalSnapshots} total snapshots, ${prunedSnapshots} pruned (no raw_metadata)`);

    return new Response(JSON.stringify({
      ok: true,
      pruned_this_run: totalPruned,
      errors,
      elapsed_ms: elapsed,
      db_stats: {
        total_snapshots: totalSnapshots,
        pruned_snapshots: prunedSnapshots,
        with_raw_metadata: (totalSnapshots || 0) - (prunedSnapshots || 0)
      },
      cutoff_date: cutoff,
      timestamp: new Date().toISOString()
    }), { headers: { "Content-Type": "application/json" } });

  } catch(e) {
    console.error("[pruner] fatal error:", e.message);
    return new Response(JSON.stringify({
      ok: false, error: e.message, timestamp: new Date().toISOString()
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
