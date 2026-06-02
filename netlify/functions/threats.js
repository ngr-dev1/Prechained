// threats.js — Unified supply-chain threat feed.
// Returns snapshots carrying a confirmed, evidence-backed finding:
//   • FINGERPRINT_MISMATCH  — same version, different fingerprint (mutation)
//   • INSTALL_HOOK_ADDED    — install hook introduced vs. clean prior history
//   • PUBLISHER_CHANGE      — publisher differs from all prior versions
//   • SIZE_SPIKE            — unpacked size jumps >=10x and >=1MB vs. prior median
//
// Every finding was written at capture time by a detector that compared the new
// version against the package's OWN prior history. Nothing here is inferred at
// read time. Each row links to verifiable receipts so a reader can confirm it.
// prechained.com · Built by NextGenRails™

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

export default async function handler(req) {
  const url = new URL(req.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "30"), 100);
  const offset = parseInt(url.searchParams.get("offset") || "0");
  const ecosystem = url.searchParams.get("ecosystem") || null;
  const typeFilter = url.searchParams.get("type") || null; // optional single type

  try {
    // A snapshot is "flagged" if it has EITHER a mutation alert (diff_alert)
    // OR one or more threat_flags. We query the union via two filtered reads
    // and merge, because the two markers live under different raw_metadata keys.
    // Both reads are ordered newest-first and bounded.

    // Pull a generous window of recently-flagged rows, then unify + paginate
    // in memory. Bounded by FETCH_WINDOW so this stays cheap.
    const FETCH_WINDOW = 500;

    let base = supabase
      .from("snapshots")
      .select("id, receipt_id, version, ecosystem, captured_at, sha384_fingerprint, manifest_path, raw_metadata, packages(name, description)")
      .order("captured_at", { ascending: false })
      .limit(FETCH_WINDOW);

    if (ecosystem) base = base.eq("ecosystem", ecosystem);

    // Supabase 'or' across JSON keys: diff_alert true OR threat_flagged true
    base = base.or("raw_metadata->>diff_alert.eq.true,raw_metadata->>threat_flagged.eq.true");

    const { data, error } = await base;
    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: HEADERS });
    }

    // Normalise every flagged snapshot into a flat list of findings.
    const findings = [];
    for (const row of data || []) {
      const meta = row.raw_metadata || {};
      const pkg = row.packages?.name || "unknown";
      const common = {
        receipt_id: row.receipt_id,
        package: pkg,
        description: row.packages?.description || null,
        version: row.version,
        ecosystem: row.ecosystem,
        captured_at: row.captured_at,
        fingerprint: row.sha384_fingerprint,
        manifest_path: row.manifest_path || null,
      };

      // Mutation finding
      if (meta.diff_alert === true) {
        findings.push({
          ...common,
          type: "FINGERPRINT_MISMATCH",
          severity: meta.alert_severity || "HIGH",
          detail: `Same version recaptured with a different fingerprint. Prior: ${meta.prior_fingerprint ? meta.prior_fingerprint.slice(0,16)+"…" : "unknown"}`,
          evidence: {
            prior_fingerprint: meta.prior_fingerprint || null,
            prior_receipt_id: meta.prior_receipt_id || null,
            prior_captured_at: meta.prior_captured_at || null,
          },
        });
      }

      // Detector findings (array of structured flags)
      if (Array.isArray(meta.threat_flags)) {
        for (const f of meta.threat_flags) {
          findings.push({
            ...common,
            type: f.type,
            severity: f.severity,
            detail: f.detail,
            evidence: f.evidence || {},
          });
        }
      }
    }

    // Optional type filter applied after normalisation.
    let filtered = typeFilter
      ? findings.filter(f => f.type === typeFilter)
      : findings;

    const total = filtered.length;
    const page = filtered.slice(offset, offset + limit);

    // Counts by type across the fetched window (for the stats bar).
    const counts = {};
    for (const f of filtered) counts[f.type] = (counts[f.type] || 0) + 1;
    const ecosystems = [...new Set(filtered.map(f => f.ecosystem).filter(Boolean))];

    return new Response(JSON.stringify({
      findings: page,
      total,
      counts,
      ecosystems_affected: ecosystems.length,
      window: FETCH_WINDOW,
      window_truncated: (data || []).length >= FETCH_WINDOW,
      limit, offset,
    }), { headers: HEADERS });

  } catch (e) {
    console.error("[threats] error:", e.message);
    return new Response(JSON.stringify({ error: "Query failed" }), { status: 500, headers: HEADERS });
  }
}
