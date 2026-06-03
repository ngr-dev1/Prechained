// pruner.mjs — Supabase Working-Set Pruner
// ---------------------------------------------------------------------------
// Supabase is the LIVE INDEX. The permanent record is the GitHub archive
// (github.com/ngr-dev1/prechained-archive). This pruner keeps Supabase small
// by DELETING rows whose manifests are safely in the archive, while never
// deleting anything that exists only in the database.
//
// RETENTION (a row is KEPT if ANY of these is true):
//   1. It has NO manifest_path  → exists only in the DB, never in the archive.
//      Deleting it would lose it forever. ALWAYS KEPT.
//   2. It is FLAGGED            → raw_metadata carries a threat/mutation alert.
//      The live Threat Feed / Incidents pages need it. ALWAYS KEPT.
//   3. It was captured within KEEP_DAYS → recent working set. KEPT.
//   4. It is among the newest KEEP_VERSIONS_PER_PACKAGE versions of its
//      package → preserves visible version history AND gives the mutation
//      detectors prior versions to compare against. KEPT.
//
// Everything else (older, unflagged, archived, and not in the newest-N per
// package) is DELETED from Supabase. Its manifest remains permanently in the
// archive and is still verifiable at prechained.com/verify.
//
// SAFETY: a row is only ever deleted when manifest_path IS NOT NULL. The
// archive is the source of truth; the DB is a cache of the recent working set.
// prechained.com · Built by NextGenRails™
// ---------------------------------------------------------------------------

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const KEEP_DAYS = parseInt(process.env.PRUNE_KEEP_DAYS || "30", 10);
const KEEP_VERSIONS_PER_PACKAGE = parseInt(process.env.PRUNE_KEEP_VERSIONS || "3", 10);
const BATCH_SIZE = 500;
const MAX_BATCHES_PER_RUN = 20; // 20 * 500 = 10k deletions per run, then resume next run
const DRY_RUN = (process.env.PRUNE_DRY_RUN || "true").toLowerCase() === "true"; // SAFE DEFAULT: true

// A row is "flagged" if its raw_metadata carries any alert marker.
function isFlagged(meta) {
  if (!meta || typeof meta !== "object") return false;
  return Boolean(
    meta.diff_alert || meta.threat_flagged ||
    meta.alert_type || meta.alert_severity ||
    (Array.isArray(meta.threat_flags) && meta.threat_flags.length > 0)
  );
}

export default async function handler(req, context) {
  const startTime = Date.now();
  console.log(`[pruner] starting ${new Date().toISOString()} mode=${DRY_RUN ? "DRY_RUN" : "LIVE"} keepDays=${KEEP_DAYS} keepVersions=${KEEP_VERSIONS_PER_PACKAGE}`);

  const cutoff = new Date(Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000).toISOString();
  let totalDeleted = 0;
  let totalProtected = 0;
  let errors = 0;
  let batchNum = 0;

  try {
    // We page through OLD, ARCHIVED, candidate rows only:
    //   captured_at < cutoff  AND  manifest_path IS NOT NULL
    // Rows with null manifest_path are never selected → never deleted.
    // For each candidate we still re-check the flag state and the
    // newest-N-per-package rule before deleting.
    while (batchNum < MAX_BATCHES_PER_RUN) {
      const { data: batch, error: fetchErr } = await supabase
        .from("snapshots")
        .select("id, package_id, version, captured_at, manifest_path, raw_metadata")
        .lt("captured_at", cutoff)
        .not("manifest_path", "is", null)
        .order("captured_at", { ascending: true })
        .limit(BATCH_SIZE);

      if (fetchErr) { console.error("[pruner] fetch error:", fetchErr.message); errors++; break; }
      if (!batch || batch.length === 0) break;

      // Decide per row. Protect flagged rows outright.
      const candidates = [];
      for (const row of batch) {
        if (isFlagged(row.raw_metadata)) { totalProtected++; continue; }
        candidates.push(row);
      }

      // Newest-N-per-package protection: for each package_id in this batch,
      // find that package's newest KEEP_VERSIONS_PER_PACKAGE snapshot ids
      // (across the WHOLE table, not just this batch) and never delete those.
      const pkgIds = [...new Set(candidates.map(r => r.package_id))];
      const protectedIds = new Set();
      for (const pid of pkgIds) {
        const { data: newest, error: nErr } = await supabase
          .from("snapshots")
          .select("id")
          .eq("package_id", pid)
          .order("captured_at", { ascending: false })
          .limit(KEEP_VERSIONS_PER_PACKAGE);
        if (nErr) { console.error("[pruner] newest fetch error:", nErr.message); errors++; continue; }
        for (const n of (newest || [])) protectedIds.add(n.id);
      }

      const toDelete = candidates.filter(r => !protectedIds.has(r.id)).map(r => r.id);
      totalProtected += (candidates.length - toDelete.length);

      if (toDelete.length === 0) {
        // This whole batch was protected; advance past it by raising the cutoff
        // window is exhausted of deletable rows in this slice — stop to avoid a loop.
        console.log(`[pruner] batch ${batchNum + 1}: nothing deletable (all protected)`);
        break;
      }

      if (DRY_RUN) {
        totalDeleted += toDelete.length; // count what WOULD be deleted
        batchNum++;
        console.log(`[pruner][DRY_RUN] batch ${batchNum}: WOULD delete ${toDelete.length} (would-delete total: ${totalDeleted}, protected so far: ${totalProtected})`);
      } else {
        const { error: delErr } = await supabase
          .from("snapshots")
          .delete()
          .in("id", toDelete);
        if (delErr) { console.error("[pruner] delete error:", delErr.message); errors++; break; }
        totalDeleted += toDelete.length;
        batchNum++;
        console.log(`[pruner] batch ${batchNum}: deleted ${toDelete.length} (total deleted: ${totalDeleted}, protected so far: ${totalProtected})`);
      }

      if (batch.length < BATCH_SIZE) break; // reached the end of old rows
    }

    const { count: totalSnapshots } = await supabase
      .from("snapshots").select("*", { count: "exact", head: true });
    const { count: unarchived } = await supabase
      .from("snapshots").select("*", { count: "exact", head: true }).is("manifest_path", null);

    const elapsed = Date.now() - startTime;
    console.log(`[pruner] done: deleted ${totalDeleted}, protected ${totalProtected}, errors ${errors}, ${elapsed}ms`);
    console.log(`[pruner] db now: ${totalSnapshots} snapshots (${unarchived} unarchived/protected)`);

    return new Response(JSON.stringify({
      ok: true,
      dry_run: DRY_RUN,
      deleted_this_run: DRY_RUN ? 0 : totalDeleted,
      would_delete_this_run: DRY_RUN ? totalDeleted : 0,
      protected_seen: totalProtected,
      errors,
      elapsed_ms: elapsed,
      keep_days: KEEP_DAYS,
      keep_versions_per_package: KEEP_VERSIONS_PER_PACKAGE,
      db_stats: { total_snapshots: totalSnapshots, unarchived_protected: unarchived },
      note: totalDeleted >= MAX_BATCHES_PER_RUN * BATCH_SIZE
        ? "Hit per-run delete cap; will continue next run. Run VACUUM FULL snapshots after the backlog clears to reclaim disk."
        : "Backlog cleared for this window.",
      timestamp: new Date().toISOString()
    }), { headers: { "Content-Type": "application/json" } });

  } catch (e) {
    console.error("[pruner] fatal error:", e.message);
    return new Response(JSON.stringify({
      ok: false, error: e.message, timestamp: new Date().toISOString()
    }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
