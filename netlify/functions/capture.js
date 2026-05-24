// capture.js — On-demand package capture endpoint
// POST /.netlify/functions/capture { "package": "name", "ecosystem": "npm" }
// prechained.com · Built by NextGenRails™

import {
  supabase, upsertPackage, captureVersion, sha384,
  storeManifestInGithub, getCurrentBtcBlock, GITHUB_TOKEN
} from "./_shared.js";
import { readFileSync } from "fs";

const CRAWLER_SHA384 = (() => {
  try { return sha384(readFileSync(new URL(import.meta.url).pathname, "utf8")); } catch(e) { return null; }
})();

const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

// ── RATE LIMITING ─────────────────────────────────────────────
// Max 10 requests per IP per hour using Supabase
async function checkRateLimit(ip) {
  const windowStart = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  const { count } = await supabase
    .from("capture_requests")
    .select("*", { count: "exact", head: true })
    .eq("ip_hash", sha384(ip || "unknown").substring(0, 32))
    .gte("created_at", windowStart);
  return (count || 0) < 10;
}

async function logRequest(ip, packageName, ecosystem) {
  try {
    await supabase.from("capture_requests").insert({
      ip_hash: sha384(ip || "unknown").substring(0, 32),
      package_name: packageName,
      ecosystem,
      created_at: new Date().toISOString()
    });
  } catch(e) {}
}

// ── ECOSYSTEM CAPTURE FUNCTIONS ───────────────────────────────

async function captureNpm(name) {
  const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`, {
    headers: { "Accept": "application/json" }
  });
  if (!res.ok) throw new Error(`npm: package not found`);
  const data = await res.json();
  const latest = data["dist-tags"]?.latest;
  if (!latest) throw new Error("npm: no latest version");
  const allVersions = Object.keys(data.versions || {});
  const pkg = await upsertPackage(name, "npm", data.description, latest, allVersions.length);
  if (!pkg) throw new Error("npm: failed to upsert package");
  const { data: existing } = await supabase.from("snapshots").select("version").eq("package_id", pkg.id);
  const seen = new Set((existing || []).map(s => s.version));
  const toCapture = allVersions.filter(v => !seen.has(v));
  let captured = 0;
  for (const version of toCapture) {
    const vd = data.versions[version];
    if (!vd) continue;
    const manifest = {
      name, version, ecosystem: "npm",
      description: data.description, license: vd.license,
      dependencies: vd.dependencies || {}, devDependencies: vd.devDependencies || {},
      peerDependencies: vd.peerDependencies || {}, engines: vd.engines || {},
      scripts: {
        install: vd.scripts?.install || null, preinstall: vd.scripts?.preinstall || null,
        postinstall: vd.scripts?.postinstall || null, prepare: vd.scripts?.prepare || null,
        prepublish: vd.scripts?.prepublish || null, prepublishOnly: vd.scripts?.prepublishOnly || null
      },
      maintainers: (vd.maintainers || data.maintainers || []).map(m => ({ name: m.name, email: m.email || null })),
      author: vd.author || data.author || null,
      publishedAt: data.time?.[version] || null,
      dist: { integrity: vd.dist?.integrity, shasum: vd.dist?.shasum, tarball: vd.dist?.tarball, fileCount: vd.dist?.fileCount || null, unpackedSize: vd.dist?.unpackedSize || null },
      repository: vd.repository || null, homepage: vd.homepage || null,
      bugs: vd.bugs || null, keywords: vd.keywords || [],
      _npmUser: vd._npmUser ? { name: vd._npmUser.name, email: vd._npmUser.email || null } : null,
      captured_at: new Date().toISOString(), captured_by: "prechained.com", crawler_sha384: CRAWLER_SHA384
    };
    const ok = await captureVersion(pkg, version, "npm", vd.dist?.integrity, vd.dist?.shasum, vd.license, Object.keys(vd.dependencies || {}), manifest, CRAWLER_SHA384);
    if (ok) captured++;
  }
  return { pkg, captured, total: allVersions.length, already: seen.size };
}

async function capturePypi(name) {
  const res = await fetch(`https://pypi.org/pypi/${name}/json`);
  if (!res.ok) throw new Error(`pypi: package not found`);
  const data = await res.json();
  const latest = data.info?.version;
  if (!latest) throw new Error("pypi: no latest version");
  const allVersions = Object.keys(data.releases || {}).filter(v => (data.releases[v] || []).length > 0);
  const pkg = await upsertPackage(name, "pypi", data.info?.summary, latest, allVersions.length);
  if (!pkg) throw new Error("pypi: failed to upsert package");
  const { data: existing } = await supabase.from("snapshots").select("version").eq("package_id", pkg.id);
  const seen = new Set((existing || []).map(s => s.version));
  const toCapture = allVersions.filter(v => !seen.has(v));
  let captured = 0;
  for (const version of toCapture) {
    const files = data.releases[version] || [];
    const wheel = files.find(f => f.packagetype === "bdist_wheel") || files[0];
    const manifest = {
      name, version, ecosystem: "pypi",
      summary: data.info?.summary, license: data.info?.license,
      author: data.info?.author, author_email: data.info?.author_email || null,
      requires_python: data.info?.requires_python,
      requires_dist: data.info?.requires_dist || [],
      keywords: data.info?.keywords || null, classifiers: data.info?.classifiers || [],
      yanked: wheel?.yanked || false,
      dist: wheel ? { url: wheel.url, sha256: wheel.digests?.sha256, filename: wheel.filename, size: wheel.size, upload_time: wheel.upload_time } : null,
      all_files: files.map(f => ({ filename: f.filename, packagetype: f.packagetype, sha256: f.digests?.sha256, size: f.size, upload_time: f.upload_time })),
      captured_at: new Date().toISOString(), captured_by: "prechained.com", crawler_sha384: CRAWLER_SHA384
    };
    const ok = await captureVersion(pkg, version, "pypi", wheel?.digests?.sha256, null, data.info?.license, (data.info?.requires_dist || []).map(d => d.split(" ")[0].split(";")[0].trim()), manifest, CRAWLER_SHA384);
    if (ok) captured++;
  }
  return { pkg, captured, total: allVersions.length, already: seen.size };
}

async function captureCargo(name) {
  const res = await fetch(`https://crates.io/api/v1/crates/${name}`, {
    headers: { "User-Agent": "prechained.com/1.0 (supply chain archive)" }
  });
  if (!res.ok) throw new Error(`cargo: crate not found`);
  const data = await res.json();
  const krate = data.crate;
  if (!krate) throw new Error("cargo: invalid response");
  const allVersions = (data.versions || []).map(v => v.num).filter(Boolean);
  const latest = krate.newest_version || allVersions[0];
  const pkg = await upsertPackage(name, "cargo", krate.description, latest, allVersions.length);
  if (!pkg) throw new Error("cargo: failed to upsert package");
  const { data: existing } = await supabase.from("snapshots").select("version").eq("package_id", pkg.id);
  const seen = new Set((existing || []).map(s => s.version));
  const toCapture = (data.versions || []).filter(v => !seen.has(v.num));
  let captured = 0;
  for (const vdata of toCapture) {
    const version = vdata.num;
    let cargoDeps = [];
    try {
      const depsRes = await fetch(`https://crates.io/api/v1/crates/${name}/${version}/dependencies`, { headers: { "User-Agent": "prechained.com/1.0" } });
      if (depsRes.ok) { const dd = await depsRes.json(); cargoDeps = (dd.dependencies || []).map(d => ({ name: d.crate_id, req: d.req, kind: d.kind, optional: d.optional, default_features: d.default_features, features: d.features })); }
    } catch(e) {}
    const manifest = {
      name, version, ecosystem: "cargo",
      description: krate.description, license: vdata.license,
      checksum: vdata.checksum, features: vdata.features || {},
      downloads: vdata.downloads, yanked: vdata.yanked || false,
      repository: krate.repository || null, homepage: krate.homepage || null,
      keywords: (data.keywords || []).map(k => k.keyword),
      categories: (data.categories || []).map(c => c.category),
      published_by: vdata.published_by ? { id: vdata.published_by.id, login: vdata.published_by.login, name: vdata.published_by.name } : null,
      publishedAt: vdata.created_at || null, dependencies: cargoDeps,
      captured_at: new Date().toISOString(), captured_by: "prechained.com", crawler_sha384: CRAWLER_SHA384
    };
    const ok = await captureVersion(pkg, version, "cargo", `sha256:${vdata.checksum}`, null, vdata.license, cargoDeps.map(d => d.name), manifest, CRAWLER_SHA384);
    if (ok) captured++;
  }
  return { pkg, captured, total: allVersions.length, already: seen.size };
}

async function captureRubygems(name) {
  const res = await fetch(`https://rubygems.org/api/v1/gems/${name}.json`);
  if (!res.ok) throw new Error(`rubygems: gem not found`);
  const data = await res.json();
  const versionsRes = await fetch(`https://rubygems.org/api/v1/versions/${name}.json`);
  if (!versionsRes.ok) throw new Error("rubygems: versions not found");
  const versions = await versionsRes.json();
  const allVersions = Array.isArray(versions) ? versions.map(v => v.number).filter(Boolean) : [];
  const latest = data.version;
  const pkg = await upsertPackage(name, "rubygems", data.info, latest, allVersions.length);
  if (!pkg) throw new Error("rubygems: failed to upsert package");
  const { data: existing } = await supabase.from("snapshots").select("version").eq("package_id", pkg.id);
  const seen = new Set((existing || []).map(s => s.version));
  let captured = 0;
  for (const vdata of versions.filter(v => !seen.has(v.number))) {
    const manifest = {
      name, version: vdata.number, ecosystem: "rubygems",
      description: data.info, license: vdata.licenses?.join(", ") || null,
      authors: vdata.authors, platform: vdata.platform,
      gem_uri: `https://rubygems.org/gems/${name}-${vdata.number}.gem`,
      sha: vdata.sha, prerelease: vdata.prerelease || false,
      yanked: vdata.yanked || false,
      publishedAt: vdata.created_at || null,
      downloads: vdata.downloads_count,
      captured_at: new Date().toISOString(), captured_by: "prechained.com", crawler_sha384: CRAWLER_SHA384
    };
    const ok = await captureVersion(pkg, vdata.number, "rubygems", vdata.sha, null, vdata.licenses?.join(", "), [], manifest, CRAWLER_SHA384);
    if (ok) captured++;
  }
  return { pkg, captured, total: allVersions.length, already: seen.size };
}

async function capturePackagist(name) {
  const res = await fetch(`https://packagist.org/packages/${name}.json`);
  if (!res.ok) throw new Error(`packagist: package not found`);
  const data = await res.json();
  const pkgData = data.package;
  if (!pkgData) throw new Error("packagist: invalid response");
  const allVersions = Object.keys(pkgData.versions || {}).filter(v => !v.includes("dev"));
  const latest = pkgData.versions?.[allVersions[0]]?.version || allVersions[0];
  const pkg = await upsertPackage(name, "packagist", pkgData.description, latest, allVersions.length);
  if (!pkg) throw new Error("packagist: failed to upsert package");
  const { data: existing } = await supabase.from("snapshots").select("version").eq("package_id", pkg.id);
  const seen = new Set((existing || []).map(s => s.version));
  let captured = 0;
  for (const version of allVersions.filter(v => !seen.has(v))) {
    const vData = pkgData.versions[version] || {};
    const cleanVersion = version.replace(/^v/, "");
    const manifest = {
      name, version: cleanVersion, ecosystem: "packagist",
      description: pkgData.description, license: vData.license?.[0] || null,
      type: vData.type || null, require: vData.require || {},
      require_dev: vData["require-dev"] || {},
      authors: vData.authors || [], keywords: vData.keywords || [],
      dist: vData.dist || null, source: vData.source || null,
      publishedAt: vData.time || null,
      captured_at: new Date().toISOString(), captured_by: "prechained.com", crawler_sha384: CRAWLER_SHA384
    };
    const ok = await captureVersion(pkg, cleanVersion, "packagist", vData.dist?.shasum, null, vData.license?.[0], Object.keys(vData.require || {}), manifest, CRAWLER_SHA384);
    if (ok) captured++;
  }
  return { pkg, captured, total: allVersions.length, already: seen.size };
}

async function captureNuget(name) {
  const searchRes = await fetch(`https://azuresearch-usnc.nuget.org/query?q=${encodeURIComponent(name)}&take=1&prerelease=false`);
  if (!searchRes.ok) throw new Error("nuget: search failed");
  const searchData = await searchRes.json();
  const entry = (searchData.data || []).find(p => p.id?.toLowerCase() === name.toLowerCase());
  if (!entry) throw new Error("nuget: package not found");
  const latest = entry.version;
  const allVersions = (entry.versions || []).map(v => v.version).filter(Boolean);
  const pkg = await upsertPackage(entry.id, "nuget", entry.description, latest, allVersions.length);
  if (!pkg) throw new Error("nuget: failed to upsert package");
  const { data: existing } = await supabase.from("snapshots").select("version").eq("package_id", pkg.id);
  const seen = new Set((existing || []).map(s => s.version));
  let captured = 0;
  for (const version of allVersions.filter(v => !seen.has(v))) {
    const manifest = {
      name: entry.id, version, ecosystem: "nuget",
      description: entry.description, license: entry.licenseUrl || null,
      authors: entry.authors || [], tags: entry.tags || [],
      projectUrl: entry.projectUrl || null, iconUrl: entry.iconUrl || null,
      requireLicenseAcceptance: entry.requireLicenseAcceptance || false,
      minClientVersion: entry.minClientVersion || null,
      nugetDeps: null,
      captured_at: new Date().toISOString(), captured_by: "prechained.com", crawler_sha384: CRAWLER_SHA384
    };
    const ok = await captureVersion(pkg, version, "nuget", null, null, null, [], manifest, CRAWLER_SHA384);
    if (ok) captured++;
  }
  return { pkg, captured, total: allVersions.length, already: seen.size };
}

async function captureGithub(repoFullName) {
  const headers = { "Accept": "application/vnd.github.v3+json", "User-Agent": "prechained.com/1.0" };
  if (GITHUB_TOKEN) headers["Authorization"] = `token ${GITHUB_TOKEN}`;
  const repoRes = await fetch(`https://api.github.com/repos/${repoFullName}`, { headers });
  if (!repoRes.ok) throw new Error("github: repo not found");
  const repoData = await repoRes.json();
  const commitsRes = await fetch(`https://api.github.com/repos/${repoFullName}/commits?per_page=5`, { headers });
  if (!commitsRes.ok) throw new Error("github: commits not found");
  const commits = await commitsRes.json();
  if (!Array.isArray(commits) || commits.length === 0) throw new Error("github: no commits");
  const latestSha = commits[0].sha?.substring(0, 12);
  const pkg = await upsertPackage(repoFullName, "github", repoData.description, latestSha, commits.length);
  if (!pkg) throw new Error("github: failed to upsert package");
  const { data: existing } = await supabase.from("snapshots").select("version").eq("package_id", pkg.id);
  const seen = new Set((existing || []).map(s => s.version));
  let captured = 0;
  for (const commit of commits.slice(0, 5)) {
    const sha = commit.sha?.substring(0, 12);
    if (!sha || seen.has(sha)) continue;
    const manifest = {
      name: repoFullName, version: sha, ecosystem: "github",
      description: repoData.description, repo_url: repoData.html_url,
      default_branch: repoData.default_branch, license: repoData.license?.spdx_id || null,
      license_name: repoData.license?.name || null, stars: repoData.stargazers_count,
      forks: repoData.forks_count, watchers: repoData.watchers_count,
      open_issues: repoData.open_issues_count, language: repoData.language,
      topics: repoData.topics || [], is_fork: repoData.fork || false,
      parent_repo: repoData.parent?.full_name || null,
      commit_sha: commit.sha, commit_message: commit.commit?.message?.substring(0, 140),
      commit_author: commit.commit?.author?.name, commit_author_email: commit.commit?.author?.email,
      commit_date: commit.commit?.author?.date, commit_committer: commit.commit?.committer?.name,
      commit_verified: commit.commit?.verification?.verified || false,
      commit_verification_reason: commit.commit?.verification?.reason || null,
      commit_parents: (commit.parents || []).map(p => p.sha?.substring(0, 12)),
      captured_at: new Date().toISOString(), captured_by: "prechained.com", crawler_sha384: CRAWLER_SHA384
    };
    const ok = await captureVersion(pkg, sha, "github", commit.sha, null, repoData.license?.spdx_id, [], manifest, CRAWLER_SHA384);
    if (ok) captured++;
  }
  return { pkg, captured, total: commits.length, already: seen.size };
}

// ── MAIN HANDLER ──────────────────────────────────────────────
export default async function handler(req, context) {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "POST required" }), { status: 405, headers: CORS });

  let body;
  try { body = await req.json(); } catch(e) { return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400, headers: CORS }); }

  const { package: packageName, ecosystem } = body;
  if (!packageName || !ecosystem) return new Response(JSON.stringify({ error: "package and ecosystem required" }), { status: 400, headers: CORS });

  const validEcosystems = ["npm", "pypi", "cargo", "rubygems", "packagist", "nuget", "github"];
  if (!validEcosystems.includes(ecosystem.toLowerCase())) {
    return new Response(JSON.stringify({ error: `Invalid ecosystem. Valid: ${validEcosystems.join(", ")}` }), { status: 400, headers: CORS });
  }

  // Rate limit
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] || "unknown";
  const allowed = await checkRateLimit(ip);
  if (!allowed) return new Response(JSON.stringify({ error: "Rate limit exceeded. Max 10 requests per hour." }), { status: 429, headers: CORS });
  await logRequest(ip, packageName, ecosystem);

  try {
    let result;
    const eco = ecosystem.toLowerCase();
    if (eco === "npm") result = await captureNpm(packageName);
    else if (eco === "pypi") result = await capturePypi(packageName);
    else if (eco === "cargo") result = await captureCargo(packageName);
    else if (eco === "rubygems") result = await captureRubygems(packageName);
    else if (eco === "packagist") result = await capturePackagist(packageName);
    else if (eco === "nuget") result = await captureNuget(packageName);
    else if (eco === "github") result = await captureGithub(packageName);

    // Get the latest receipt for this package
    const { data: latestSnap } = await supabase
      .from("snapshots")
      .select("receipt_id, btc_block, sha384_fingerprint, captured_at")
      .eq("package_id", result.pkg.id)
      .order("captured_at", { ascending: false })
      .limit(1).single();

    return new Response(JSON.stringify({
      ok: true,
      package: packageName,
      ecosystem,
      versions_captured: result.captured,
      versions_total: result.total,
      versions_already_archived: result.already,
      receipt_id: latestSnap?.receipt_id || null,
      btc_block: latestSnap?.btc_block || null,
      sha384: latestSnap?.sha384_fingerprint || null,
      captured_at: latestSnap?.captured_at || null,
      verify_url: `https://prechained.com/verify?r=${latestSnap?.receipt_id || ""}`,
      archive_url: `https://prechained.com/package.html?name=${encodeURIComponent(packageName)}&ecosystem=${ecosystem}`
    }), { headers: CORS });

  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
  }
}
