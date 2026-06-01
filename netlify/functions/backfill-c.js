// backfill-c.js — Parallel backfill worker C.
// Processes rubygems and cargo rows specifically — the two largest ecosystems
// (rubygems: 15,503 rows, cargo: 15,178 rows = 30k combined).
// Runs simultaneously with backfill.js and backfill-b.js for 3x throughput.
// prechained.com · Built by NextGenRails™

import {
  supabase,
  storeManifestInGithub,
  canonicalFingerprint,
  GITHUB_TOKEN,
} from "./_shared.js";

const TIMEOUT = 8500;
const BATCH = 50;
const ARCHIVE_REPO = process.env.GITHUB_ARCHIVE_REPO || "ngr-dev1/prechained-archive";
const LEGACY_FILTER = "raw_metadata->>fp.is.null,raw_metadata->>fp.neq.v2,raw_metadata.is.null";

async function fetchRubygemsManifest(pkgName, version) {
  const [gemRes, versionRes, ownersRes] = await Promise.all([
    fetch(`https://rubygems.org/api/v1/gems/${encodeURIComponent(pkgName)}.json`),
    fetch(`https://rubygems.org/api/v2/rubygems/${encodeURIComponent(pkgName)}/versions/${encodeURIComponent(version)}.json`),
    fetch(`https://rubygems.org/api/v1/gems/${encodeURIComponent(pkgName)}/owners.json`)
  ]);
  if (!gemRes.ok) throw new Error(`rubygems ${gemRes.status}`);
  const gemData = await gemRes.json();
  const vData = versionRes.ok ? await versionRes.json() : null;
  const gemOwners = ownersRes.ok ? await ownersRes.json() : [];
  return {
    name: pkgName, version, ecosystem: "rubygems",
    description: gemData.info, license: vData?.licenses?.[0] || null,
    sha256: vData?.sha ? "sha256:" + vData.sha : null, platform: vData?.platform || "ruby",
    ruby_version: vData?.ruby_version || null, rubygems_version: vData?.rubygems_version || null,
    authors: gemData.authors,
    owners: (Array.isArray(gemOwners) ? gemOwners : []).map(o => ({ id: o.id, handle: o.handle, email: o.email || null, mfa_level: o.mfa_level || null })),
    homepage_uri: gemData.homepage_uri, source_code_uri: gemData.source_code_uri,
    changelog_uri: gemData.changelog_uri || null, publishedAt: vData?.created_at || null,
    downloads: gemData.downloads, version_downloads: vData?.downloads_count || null,
  };
}

async function fetchCargoManifest(pkgName, version) {
  const headers = { "User-Agent": "prechained.com/1.0" };
  const [crateRes, depsRes] = await Promise.all([
    fetch(`https://crates.io/api/v1/crates/${encodeURIComponent(pkgName)}`, { headers }),
    fetch(`https://crates.io/api/v1/crates/${encodeURIComponent(pkgName)}/${encodeURIComponent(version)}/dependencies`, { headers })
  ]);
  if (!crateRes.ok) throw new Error(`cargo ${crateRes.status}`);
  const data = await crateRes.json();
  const vData = (data.versions || []).find(v => v.num === version);
  const depsData = depsRes.ok ? await depsRes.json() : { dependencies: [] };
  const cargoDeps = (depsData.dependencies || []).map(d => ({ name: d.crate_id, req: d.req, kind: d.kind, optional: d.optional }));
  const krate = data.crate || {};
  return {
    name: pkgName, version, ecosystem: "cargo",
    description: krate.description, license: vData?.license || null,
    checksum: vData?.checksum, features: vData?.features || {},
    downloads: vData?.downloads, yanked: vData?.yanked || false,
    repository: krate.repository, homepage: krate.homepage,
    keywords: (data.keywords || []).map(k => k.keyword),
    categories: (data.categories || []).map(c => c.category),
    dependencies: cargoDeps,
    published_by: vData?.published_by ? { id: vData.published_by.id, login: vData.published_by.login, name: vData.published_by.name || null } : null,
    publishedAt: vData?.created_at || null,
  };
}

async function fetchManifestFromArchive(manifestPath) {
  const url = `https://raw.githubusercontent.com/${ARCHIVE_REPO}/main/${manifestPath}`;
  const headers = GITHUB_TOKEN ? { Authorization: `token ${GITHUB_TOKEN}` } : {};
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`archive ${res.status}`);
  return res.json();
}

export default async function handler(req, context) {
  const start = Date.now();
  console.log("[backfill-c] start", new Date().toISOString());

  let done = 0, failed = 0;

  // Process rubygems and cargo — the two largest legacy ecosystems
  const { data: rows } = await supabase
    .from("snapshots")
    .select("id, version, ecosystem, manifest_path, package_id")
    .or(LEGACY_FILTER)
    .in("ecosystem", ["rubygems", "cargo"])
    .order("id", { ascending: true })
    .limit(BATCH);

  const ids = [...new Set((rows || []).map(r => r.package_id))];
  const { data: pkgs } = ids.length
    ? await supabase.from("packages").select("id, name, ecosystem").in("id", ids)
    : { data: [] };
  const pkgMap = new Map((pkgs || []).map(p => [p.id, p]));

  for (const row of rows || []) {
    if (Date.now() - start > TIMEOUT) break;
    const pkg = pkgMap.get(row.package_id);
    if (!pkg) { failed++; continue; }
    try {
      let manifest;
      let manifestPath = row.manifest_path;

      if (manifestPath) {
        try {
          manifest = await fetchManifestFromArchive(manifestPath);
        } catch {
          manifest = null;
        }
      }

      if (!manifest) {
        manifest = row.ecosystem === "rubygems"
          ? await fetchRubygemsManifest(pkg.name, row.version)
          : await fetchCargoManifest(pkg.name, row.version);
        try {
          manifestPath = await storeManifestInGithub(row.ecosystem, pkg.name, row.version, manifest);
        } catch {}
      }

      const fingerprint = canonicalFingerprint(manifest);
      const { error } = await supabase.from("snapshots").update({
        sha384_fingerprint: fingerprint,
        raw_metadata: { fp: "v2", backfilled: true, source: manifestPath === row.manifest_path ? "archive" : "registry" },
        ...(manifestPath && !row.manifest_path ? { manifest_path: manifestPath } : {})
      }).eq("id", row.id);
      if (error) throw new Error(error.message);
      done++;
    } catch (e) {
      console.warn(`[backfill-c] ${pkg?.name}@${row.version}: ${e.message}`);
      failed++;
    }
  }

  const { count: remaining } = await supabase
    .from("snapshots")
    .select("id", { count: "exact", head: true })
    .or(LEGACY_FILTER);

  const elapsed = Date.now() - start;
  console.log(`[backfill-c] done=${done} failed=${failed} remaining=${remaining} ${elapsed}ms`);

  return new Response(JSON.stringify({
    ok: true, worker: "c", done, failed, remaining,
    elapsed_ms: elapsed, timestamp: new Date().toISOString()
  }), { headers: { "Content-Type": "application/json" } });
}
