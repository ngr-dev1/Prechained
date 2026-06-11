// backfill-audit.mjs — READ-ONLY. Writes nothing to Supabase or GitHub.
// prechained.com · Built by NextGenRails™
//
// Answers the only question that matters before mass-running a backfill:
// of the rows whose manifest never made it to the archive, how many can
// actually be recovered? It (1) counts unarchived rows per ecosystem and
// (2) re-fetches a live sample per ecosystem, rebuilds the manifest, and
// reports how many reproduce their stored fingerprint.
//
// Trigger manually:  /.netlify/functions/backfill-audit
// Optional:          ?sample=12   (rows sampled per ecosystem, default 8)

import { supabase } from "./_shared.js";
import { recaptureAndVerify, LOW_YIELD, UNRECOVERABLE } from "./_recapture.js";

const ECOSYSTEMS = ["npm", "pypi", "cargo", "nuget", "maven", "rubygems", "packagist", "github"];
const MAX_RUNTIME_MS = 24000;

async function countUnarchived(eco) {
  const { count } = await supabase
    .from("snapshots")
    .select("id", { count: "exact", head: true })
    .is("manifest_path", null)
    .eq("ecosystem", eco);
  return count || 0;
}

export default async function handler(req) {
  const CORS = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };
  const url = new URL(req.url);
  const samplePerEco = Math.min(parseInt(url.searchParams.get("sample") || "8", 10) || 8, 25);
  const started = Date.now();

  try {
    const report = {};
    let totalUnarchived = 0;

    for (const eco of ECOSYSTEMS) {
      const unarchived = await countUnarchived(eco);
      totalUnarchived += unarchived;
      report[eco] = {
        unarchived,
        class: UNRECOVERABLE.has(eco) ? "unrecoverable" : LOW_YIELD.has(eco) ? "low-yield" : "recoverable",
        sampled: 0, verified: 0, mismatch: 0, unfetchable: 0, version_gone: 0, other: 0,
        sample_match_rate: null
      };
    }

    // Live sample per ecosystem (github excluded from re-fetch — counted only).
    for (const eco of ECOSYSTEMS) {
      if (UNRECOVERABLE.has(eco) || report[eco].unarchived === 0) continue;
      if (Date.now() - started > MAX_RUNTIME_MS) { report[eco].note = "skipped (time budget)"; continue; }

      const { data: rows } = await supabase
        .from("snapshots")
        .select("id, version, sha384_fingerprint, packages(name, ecosystem)")
        .is("manifest_path", null)
        .eq("ecosystem", eco)
        .not("sha384_fingerprint", "is", null)
        .limit(samplePerEco);

      for (const row of rows || []) {
        if (Date.now() - started > MAX_RUNTIME_MS) break;
        const name = row.packages?.name;
        if (!name) { report[eco].other++; continue; }
        const r = await recaptureAndVerify({
          ecosystem: eco, name, version: row.version, storedFingerprint: row.sha384_fingerprint
        });
        report[eco].sampled++;
        if (r.status === "verified") report[eco].verified++;
        else if (r.status === "mismatch") report[eco].mismatch++;
        else if (r.status === "unfetchable") report[eco].unfetchable++;
        else if (r.status === "version-gone") report[eco].version_gone++;
        else report[eco].other++;
        await new Promise(s => setTimeout(s, 150)); // gentle on registries
      }
      report[eco].sample_match_rate = report[eco].sampled
        ? +(report[eco].verified / report[eco].sampled).toFixed(3) : null;
    }

    // Project recoverable population from sampled match rates.
    let projectedRecoverable = 0;
    for (const eco of ECOSYSTEMS) {
      const r = report[eco];
      if (r.sample_match_rate != null) projectedRecoverable += Math.round(r.unarchived * r.sample_match_rate);
    }

    return new Response(JSON.stringify({
      ok: true,
      generated_at: new Date().toISOString(),
      total_unarchived: totalUnarchived,
      projected_recoverable: projectedRecoverable,
      projected_unrecoverable: totalUnarchived - projectedRecoverable,
      sample_per_ecosystem: samplePerEco,
      note: "Read-only. Projection extrapolates each ecosystem's live sample match-rate across its unarchived count. github is unrecoverable by design (volatile stars/forks/commit data were hashed).",
      by_ecosystem: report,
      elapsed_ms: Date.now() - started
    }, null, 2), { headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: e.message, elapsed_ms: Date.now() - started }), { status: 500, headers: CORS });
  }
}
