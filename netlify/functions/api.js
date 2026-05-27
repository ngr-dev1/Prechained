// api.js — Prechained Public API
// The programmatic interface to the world's pre-compromise software archive
// prechained.com · Built by NextGenRails™
//
// Endpoints:
//   GET /.netlify/functions/api/fingerprint?package=express&version=4.4.1&ecosystem=npm
//   GET /.netlify/functions/api/receipt?id=NGR-PC-MPHQEG6PZ9GYW2
//   GET /.netlify/functions/api/actor?email=x@y.com&username=foo&package=bar
//   GET /.netlify/functions/api/package?name=express&ecosystem=npm
//   GET /.netlify/functions/api/diff?package=express&ecosystem=npm&v1=4.4.0&v2=4.4.1
//   GET /.netlify/functions/api/health

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-API-Key",
  "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
  "X-Powered-By": "Prechained · prechained.com",
};

const NO_CACHE = {
  ...HEADERS,
  "Cache-Control": "no-store",
};

function json(data, status = 200, cache = true) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: cache ? HEADERS : NO_CACHE,
  });
}

function err(message, status = 400) {
  return json({ error: message, docs: "https://prechained.com/api" }, status, false);
}

export default async function handler(req) {
  const url = new URL(req.url);

  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: HEADERS });
  }

  // Route by ?action= or path suffix
  const action = url.searchParams.get("action") || url.pathname.split("/").pop();

  // ── GET /api?action=fingerprint ──────────────────────────────
  // Check if a specific package version has a pre-compromise fingerprint
  // ?package=express&version=4.4.1&ecosystem=npm
  if (action === "fingerprint") {
    const name = url.searchParams.get("package");
    const version = url.searchParams.get("version");
    const ecosystem = url.searchParams.get("ecosystem") || null;

    if (!name) return err("Missing required parameter: package");

    let query = supabase
      .from("snapshots")
      .select(`
        id, version, ecosystem, sha384_fingerprint, receipt_id,
        btc_anchored, btc_block, captured_at, manifest_path,
        packages!inner(name, ecosystem, description, latest_version)
      `)
      .eq("packages.name", name)
      .order("captured_at", { ascending: false });

    if (version) query = query.eq("version", version);
    if (ecosystem) query = query.eq("ecosystem", ecosystem);
    if (!version) query = query.limit(10);
    else query = query.limit(1);

    const { data, error } = await query;
    if (error) return err(error.message, 500);
    if (!data || data.length === 0) {
      return json({
        found: false,
        package: name,
        version: version || null,
        ecosystem: ecosystem || null,
        message: "Not in archive. Capture it at https://prechained.com/capture",
        capture_url: `https://prechained.com/capture?package=${encodeURIComponent(name)}&ecosystem=${ecosystem || "npm"}`,
      }, 404);
    }

    const snap = data[0];
    return json({
      found: true,
      package: snap.packages?.name || name,
      version: snap.version,
      ecosystem: snap.ecosystem,
      sha384: snap.sha384_fingerprint,
      receipt_id: snap.receipt_id,
      btc_anchored: snap.btc_anchored,
      btc_block: snap.btc_block,
      captured_at: snap.captured_at,
      manifest_url: snap.manifest_path
        ? `https://raw.githubusercontent.com/ngr-dev1/prechained-archive/main/${snap.manifest_path}`
        : null,
      archive_url: snap.manifest_path
        ? `https://github.com/ngr-dev1/prechained-archive/blob/main/${snap.manifest_path}`
        : null,
      verify_url: `https://prechained.com/verify.html?receipt=${snap.receipt_id}`,
      all_versions: data.length > 1 ? data.map(s => ({
        version: s.version,
        sha384: s.sha384_fingerprint,
        receipt_id: s.receipt_id,
        btc_block: s.btc_block,
        captured_at: s.captured_at,
      })) : undefined,
    });
  }

  // ── GET /api?action=receipt ──────────────────────────────────
  // Look up a receipt by ID
  // ?id=NGR-PC-MPHQEG6PZ9GYW2
  if (action === "receipt") {
    const id = url.searchParams.get("id");
    if (!id) return err("Missing required parameter: id");

    const { data, error } = await supabase
      .from("snapshots")
      .select(`
        id, version, ecosystem, sha384_fingerprint, receipt_id,
        btc_anchored, btc_block, captured_at, manifest_path,
        packages!inner(name, ecosystem, description)
      `)
      .eq("receipt_id", id)
      .single();

    if (error || !data) return json({ found: false, receipt_id: id }, 404);

    return json({
      found: true,
      receipt_id: data.receipt_id,
      package: data.packages?.name,
      version: data.version,
      ecosystem: data.ecosystem,
      sha384: data.sha384_fingerprint,
      btc_anchored: data.btc_anchored,
      btc_block: data.btc_block,
      captured_at: data.captured_at,
      manifest_url: data.manifest_path
        ? `https://raw.githubusercontent.com/ngr-dev1/prechained-archive/main/${data.manifest_path}`
        : null,
      issued_by: "Prechained · NextGenRails™ · prechained.com",
      note: "Trust is not declared. It is computed.",
    });
  }

  // ── GET /api?action=package ──────────────────────────────────
  // Get full version history for a package
  // ?name=express&ecosystem=npm
  if (action === "package") {
    const name = url.searchParams.get("name");
    const ecosystem = url.searchParams.get("ecosystem") || null;
    if (!name) return err("Missing required parameter: name");

    const { data: pkg, error: pkgErr } = await supabase
      .from("packages")
      .select("*")
      .eq("name", name)
      .eq(ecosystem ? "ecosystem" : "id", ecosystem || "00000000-0000-0000-0000-000000000000")
      .maybeSingle();

    if (pkgErr) return err(pkgErr.message, 500);
    if (!pkg) return json({ found: false, package: name }, 404);

    const { data: snaps, error: snapErr } = await supabase
      .from("snapshots")
      .select("version, sha384_fingerprint, receipt_id, btc_block, btc_anchored, captured_at, manifest_path")
      .eq("package_id", pkg.id)
      .order("captured_at", { ascending: false })
      .limit(100);

    if (snapErr) return err(snapErr.message, 500);

    return json({
      found: true,
      name: pkg.name,
      ecosystem: pkg.ecosystem,
      description: pkg.description,
      latest_version: pkg.latest_version,
      total_versions: pkg.total_versions,
      first_captured_at: pkg.first_captured_at,
      last_captured_at: pkg.last_captured_at,
      snapshots: (snaps || []).map(s => ({
        version: s.version,
        sha384: s.sha384_fingerprint,
        receipt_id: s.receipt_id,
        btc_block: s.btc_block,
        btc_anchored: s.btc_anchored,
        captured_at: s.captured_at,
        manifest_url: s.manifest_path
          ? `https://raw.githubusercontent.com/ngr-dev1/prechained-archive/main/${s.manifest_path}`
          : null,
      })),
    });
  }

  // ── GET /api?action=actor ────────────────────────────────────
  // Check if a maintainer appears in the threat actor index
  // ?email=x@y.com OR ?username=foo OR ?package=bar
  if (action === "actor") {
    const email    = url.searchParams.get("email");
    const username = url.searchParams.get("username");
    const pkg      = url.searchParams.get("package");

    if (!email && !username && !pkg) {
      return err("Provide at least one of: email, username, package");
    }

    let query = supabase.from("actor_index").select("*");
    if (email)    query = query.ilike("email", email);
    if (username) query = query.ilike("username", username);
    if (pkg)      query = query.ilike("package_name", `%${pkg}%`);

    const { data, error } = await query.limit(50);
    if (error) return err(error.message, 500);

    const flagged = (data || []).filter(a => a.flagged);
    const all = data || [];

    return json({
      found: all.length > 0,
      flagged_count: flagged.length,
      total_seen: all.length,
      threat_detected: flagged.length > 0,
      actors: all.map(a => ({
        email: a.email,
        username: a.username,
        package: a.package_name,
        ecosystem: a.ecosystem,
        flagged: a.flagged,
        first_seen_at: a.first_seen_at,
        investigate_url: `https://prechained.com/threat?${email ? `email=${encodeURIComponent(a.email || "")}` : `username=${encodeURIComponent(a.username || "")}`}`,
      })),
    });
  }

  // ── GET /api?action=diff ─────────────────────────────────────
  // Compare two versions of the same package
  // ?package=express&ecosystem=npm&v1=4.4.0&v2=4.4.1
  if (action === "diff") {
    const name = url.searchParams.get("package");
    const ecosystem = url.searchParams.get("ecosystem") || "npm";
    const v1 = url.searchParams.get("v1");
    const v2 = url.searchParams.get("v2");

    if (!name || !v1 || !v2) return err("Required: package, v1, v2");

    const { data, error } = await supabase
      .from("snapshots")
      .select(`
        version, sha384_fingerprint, receipt_id, btc_block, captured_at, manifest_path,
        packages!inner(name)
      `)
      .eq("packages.name", name)
      .eq("ecosystem", ecosystem)
      .in("version", [v1, v2]);

    if (error) return err(error.message, 500);

    const snap1 = (data || []).find(s => s.version === v1);
    const snap2 = (data || []).find(s => s.version === v2);

    return json({
      package: name,
      ecosystem,
      v1: snap1 ? {
        version: v1,
        sha384: snap1.sha384_fingerprint,
        receipt_id: snap1.receipt_id,
        btc_block: snap1.btc_block,
        captured_at: snap1.captured_at,
        manifest_url: snap1.manifest_path ? `https://raw.githubusercontent.com/ngr-dev1/prechained-archive/main/${snap1.manifest_path}` : null,
      } : { version: v1, found: false },
      v2: snap2 ? {
        version: v2,
        sha384: snap2.sha384_fingerprint,
        receipt_id: snap2.receipt_id,
        btc_block: snap2.btc_block,
        captured_at: snap2.captured_at,
        manifest_url: snap2.manifest_path ? `https://raw.githubusercontent.com/ngr-dev1/prechained-archive/main/${snap2.manifest_path}` : null,
      } : { version: v2, found: false },
      fingerprints_match: snap1 && snap2 ? snap1.sha384_fingerprint === snap2.sha384_fingerprint : null,
      note: snap1 && snap2 && snap1.sha384_fingerprint !== snap2.sha384_fingerprint
        ? "Fingerprints differ — these versions have different content."
        : snap1 && snap2
        ? "Fingerprints match — identical content across versions."
        : "One or both versions not in archive.",
    });
  }

  // ── GET /api?action=health ───────────────────────────────────
  if (action === "health" || action === "api") {
    const { count } = await supabase
      .from("snapshots")
      .select("*", { count: "exact", head: false })
      .limit(1);

    return json({
      status: "ok",
      service: "Prechained Public API",
      version: "1.0.0",
      snapshots: count ?? "unknown",
      docs: "https://prechained.com/api",
      endpoints: [
        "GET /api?action=fingerprint&package=express&version=4.4.1&ecosystem=npm",
        "GET /api?action=receipt&id=NGR-PC-XXXXXXXXXXXXXXXX",
        "GET /api?action=package&name=express&ecosystem=npm",
        "GET /api?action=actor&email=x@y.com",
        "GET /api?action=diff&package=express&ecosystem=npm&v1=4.4.0&v2=4.4.1",
        "GET /api?action=health",
      ],
      powered_by: "NextGenRails™ · prechained.com",
      note: "Trust is not declared. It is computed.",
    }, 200, false);
  }

  return err("Unknown action. See https://prechained.com/api for documentation.");
}
