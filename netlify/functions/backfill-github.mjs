// backfill-github.mjs — Honest, verify-gated archive backfill.
// prechained.com · Built by NextGenRails™
//
// REPLACES the earlier version, which wrote each row's raw_metadata STUB to the
// archive as if it were the manifest. That was unsafe on two counts:
//   1. The stub does not reproduce the row's sha384_fingerprint, so every
//      "backfilled" row would show MISMATCH in verify.html.
//   2. Setting manifest_path removed the only thing protecting these rows from
//      the pruner (which deletes rows >7d old WHERE manifest_path IS NOT NULL),
//      arming it to delete real fingerprint records.
//
// This version recovers content HONESTLY: it re-fetches the manifest from the
// source registry, rebuilds it exactly as the crawler did, recomputes the
// canonical fingerprint, and archives ONLY when it reproduces the stored
// fingerprint. On any mismatch / unfetchable / github row it records a status
// flag and LEAVES manifest_path NULL — so the pruner never touches it and the
// UI can label it honestly. The archive can never be corrupted by this path.
//
// Idempotent & resumable: each processed row gets raw_metadata.recapture_status,
// and the candidate query skips rows already attempted. Hit it repeatedly (or
// cron it) until remaining hits 0 — but run backfill-audit FIRST to confirm the
// recoverable population is worth it.
//
// Trigger manually:  /.netlify/functions/backfill-github

import { supabase, storeManifestInGithub, GITHUB_TOKEN } from "./_shared.js";
import { recaptureAndVerify } from "./_recapture.js";

const PAGE_SIZE = 120;
const CONCURRENCY = 3;
const BATCH_DELAY_MS = 500;
const MAX_RUNTIME_MS = 22000;

async function markStatus(id, existingMeta, fields) {
  const merged = { ...(existingMeta || {}), ...fields, recaptured_at: new Date().toISOString() };
  await supabase.from("snapshots").update({ raw_metadata: merged }).eq("id", id);
}

export default async function handler(req) {
  const CORS = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  if (!GITHUB_TOKEN) {
    return new Response(JSON.stringify({ error: "GITHUB_ARCHIVE_TOKEN not set" }), { status: 500, headers: CORS });
  }

  const started = Date.now();
  const tally = { processed: 0, archived: 0, mismatch: 0, unfetchable: 0, version_gone: 0, unrecoverable: 0, errors: 0 };

  try {
    // Candidates: unarchived, v2 pipeline, not github, not already attempted.
    const { data: rows, error } = await supabase
      .from("snapshots")
      .select("id, version, sha384_fingerprint, captured_at, raw_metadata, ecosystem, packages(name, ecosystem)")
      .is("manifest_path", null)
      .neq("ecosystem", "github")
      .eq("raw_metadata->>fp", "v2")
      .is("raw_metadata->>recapture_status", null)
      .not("sha384_fingerprint", "is", null)
      .limit(PAGE_SIZE);

    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: CORS });

    if (!rows || rows.length === 0) {
      const { count } = await supabase
        .from("snapshots").select("id", { count: "exact", head: true })
        .is("manifest_path", null).neq("ecosystem", "github").eq("raw_metadata->>fp", "v2")
        .is("raw_metadata->>recapture_status", null);
      return new Response(JSON.stringify({ ok: true, message: "No more recoverable candidates.", remaining_candidates: count || 0 }), { headers: CORS });
    }

    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      if (Date.now() - started > MAX_RUNTIME_MS) break;
      const batch = rows.slice(i, i + CONCURRENCY);

      await Promise.all(batch.map(async (row) => {
        tally.processed++;
        const eco = row.ecosystem || row.packages?.ecosystem;
        const name = row.packages?.name;
        if (!name || !eco) { tally.errors++; await markStatus(row.id, row.raw_metadata, { recapture_status: "no-package-ref" }); return; }

        try {
          const r = await recaptureAndVerify({ ecosystem: eco, name, version: row.version, storedFingerprint: row.sha384_fingerprint });

          if (r.status === "verified") {
            // Overlay non-hashed provenance fields for archive fidelity. These
            // are stripped by canonicalize(), so they do not affect the hash.
            const manifest = { ...r.manifest,
              captured_at: row.captured_at || null,
              captured_by: "prechained.com",
              crawler_sha384: row.raw_metadata?.crawler_sha384 || null
            };
            const path = await storeManifestInGithub(eco, name, row.version, manifest);
            if (path) {
              await supabase.from("snapshots").update({
                manifest_path: path,
                raw_metadata: { ...(row.raw_metadata || {}), recapture_status: "verified", recaptured_at: new Date().toISOString() }
              }).eq("id", row.id);
              tally.archived++;
            } else {
              tally.errors++;
              await markStatus(row.id, row.raw_metadata, { recapture_status: "archive-write-failed" });
            }
          } else if (r.status === "mismatch") {
            tally.mismatch++;
            await markStatus(row.id, row.raw_metadata, { recapture_status: "mismatch", recapture_computed_fp: r.computedFp });
          } else if (r.status === "version-gone") {
            tally.version_gone++;
            await markStatus(row.id, row.raw_metadata, { recapture_status: "version-gone" });
          } else if (r.status === "github-unrecoverable") {
            tally.unrecoverable++;
            await markStatus(row.id, row.raw_metadata, { recapture_status: "github-unrecoverable" });
          } else {
            tally.unfetchable++;
            await markStatus(row.id, row.raw_metadata, { recapture_status: r.status || "unfetchable" });
          }
        } catch (e) {
          tally.errors++;
          await markStatus(row.id, row.raw_metadata, { recapture_status: `error:${e.message}`.slice(0, 120) });
        }
      }));

      await new Promise(s => setTimeout(s, BATCH_DELAY_MS));
    }

    const { count: remaining } = await supabase
      .from("snapshots").select("id", { count: "exact", head: true })
      .is("manifest_path", null).neq("ecosystem", "github").eq("raw_metadata->>fp", "v2")
      .is("raw_metadata->>recapture_status", null);

    return new Response(JSON.stringify({
      ok: true,
      ...tally,
      remaining_candidates: remaining || 0,
      elapsed_ms: Date.now() - started,
      note: (remaining || 0) > 0
        ? `Run again to continue. ${remaining} un-attempted candidates remain.`
        : "All recoverable candidates attempted."
    }), { headers: CORS });

  } catch (e) {
    return new Response(JSON.stringify({ error: e.message, ...tally, elapsed_ms: Date.now() - started }), { status: 500, headers: CORS });
  }
}
