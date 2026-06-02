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
    // A snapshot is "flagged" if it has EITHER a mutation alert (diff_alert:true)
    // OR one or more threat_flags (threat_flagged:true). PostgREST's .or() filter
    // mishandles the ->> JSON arrow, so we run two separate reads — each using the
    // .eq("raw_metadata->>key", ...) form that is proven to work elsewhere in this
    // codebase (see anchor-checker.js) — then merge and de-duplicate by id.
    // Hard cap kept small: raw_metadata rows are heavy (threat_flags arrays,
    // detector evidence). Pulling hundreds blew the Lambda response size limit
    // and returned a truncated body Netlify couldn't decode. The feed paginates
    // 25 at a time, so a window of 60 is plenty and stays well under the limit.
    const FETCH_WINDOW = 60;
    const SELECT = "id, receipt_id, version, ecosystem, captured_at, sha384_fingerprint, manifest_path, raw_metadata, packages(name, description)";

    function buildQuery(metaKey) {
      let q = supabase
        .from("snapshots")
        .select(SELECT)
        .eq(`raw_metadata->>${metaKey}`, "true")
        .order("captured_at", { ascending: false })
        .limit(FETCH_WINDOW);
      if (ecosystem) q = q.eq("ecosystem", ecosystem);
      return q;
    }

    const [mutRes, threatRes] = await Promise.all([
      buildQuery("diff_alert"),
      buildQuery("threat_flagged"),
    ]);

    if (mutRes.error) {
      return new Response(JSON.stringify({ error: mutRes.error.message }), { status: 500, headers: HEADERS });
    }
    if (threatRes.error) {
      return new Response(JSON.stringify({ error: threatRes.error.message }), { status: 500, headers: HEADERS });
    }

    // Merge + de-duplicate by snapshot id (a row could carry both markers).
    const seen = new Set();
    const data = [];
    for (const row of [...(mutRes.data || []), ...(threatRes.data || [])]) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      data.push(row);
    }
    // Keep newest-first after merge.
    data.sort((a, b) => new Date(b.captured_at) - new Date(a.captured_at));

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
      window_truncated: (mutRes.data || []).length >= FETCH_WINDOW || (threatRes.data || []).length >= FETCH_WINDOW,
      limit, offset,
    }), { headers: HEADERS });

  } catch (e) {
    console.error("[threats] error:", e.message);
    return new Response(JSON.stringify({ error: "Query failed" }), { status: 500, headers: HEADERS });
  }
}
