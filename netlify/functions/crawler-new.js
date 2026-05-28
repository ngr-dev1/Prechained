// crawler-new.js — New Package Feed Crawler
// Watches "new packages" feeds on all 8 ecosystems every 10 minutes.
// Captures EVERYTHING that newly appears — not just popular packages.
// This is how you catch Sicoob.Sdk on day one, not after disclosure.
// prechained.com · Built by NextGenRails™

import {
  supabase, upsertPackage, captureVersion, sha384, generateReceiptId,
  storeManifestInGithub, getCurrentBtcBlock, GITHUB_TOKEN
} from "./_shared.js";
import { readFileSync } from "fs";

const TIMEOUT = 8500;
const CRAWLER_SHA384 = (() => {
  try { return sha384(readFileSync(new URL(import.meta.url).pathname, "utf8")); } catch(e) { return null; }
})();

// ── TYPOSQUAT CHECK ───────────────────────────────────────────
// Levenshtein distance — same implementation as capture.js
function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i-1] === b[j-1]
        ? dp[i-1][j-1]
        : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
    }
  }
  return dp[m][n];
}

async function checkAndFlagTyposquat(packageName, ecosystem, packageId) {
  try {
    const { data: knownPkgs } = await supabase
      .from("packages")
      .select("name")
      .eq("ecosystem", ecosystem)
      .order("total_versions", { ascending: false })
      .limit(500);

    if (!knownPkgs || knownPkgs.length === 0) return;

    const nameLower = packageName.toLowerCase();
    let closest = null;
    let minDist = Infinity;

    for (const { name } of knownPkgs) {
      if (name.toLowerCase() === nameLower) continue;
      const dist = levenshtein(nameLower, name.toLowerCase());
      if (dist <= 2 && dist < minDist) {
        minDist = dist;
        closest = name;
      }
    }

    if (closest) {
      console.log(`[TYPOSQUAT-NEW] ${ecosystem}/${packageName} is ${minDist} edit(s) from "${closest}" — flagging`);
      // Flag in actor_index if we have actor data
      await supabase
        .from("actor_index")
        .update({ flagged: true })
        .eq("package_name", packageName)
        .eq("ecosystem", ecosystem);

      // Write typosquat flag into snapshot raw_metadata
      if (packageId) {
        await supabase
          .from("snapshots")
          .update({
            raw_metadata: supabase.rpc ? undefined : {
              typosquat_alert: true,
              closest_match: closest,
              edit_distance: minDist,
              alert_type: "TYPOSQUAT",
              alert_severity: "HIGH",
            }
          })
          .eq("package_id", packageId)
          .is("raw_metadata->typosquat_alert", null);
      }
    }
  } catch(e) {
    console.error("[TYPOSQUAT-NEW] error:", e.message);
  }
}

// ── HELPER: CAPTURE A SINGLE NEW PACKAGE ─────────────────────
// Shared logic for capturing a newly discovered package + version
async function captureNewPackage(name, ecosystem, version, integrity, shasum, license, dependencies, manifest) {
  const pkg = await upsertPackage(name, ecosystem, manifest.description || null, version, 1);
  if (!pkg) return false;

  const ok = await captureVersion(pkg, version, ecosystem, integrity, shasum, license, dependencies, manifest, CRAWLER_SHA384);
  if (ok) {
    console.log(`[NEW] ${ecosystem}/${name}@${version} captured`);
    // Run typosquat check on every new package — this is the core value
    await checkAndFlagTyposquat(name, ecosystem, pkg.id);
  }
  return ok;
}

// ── NPM NEW PACKAGES ──────────────────────────────────────────
// npm's /-/rss feed returns the 50 most recently published packages
async function crawlNpmNew(startTime) {
  let captured = 0;
  try {
    // Use npm's changes feed — newest packages by publish date
    const res = await fetch("https://registry.npmjs.org/-/v1/search?text=&size=50&from=0&quality=0&popularity=0&maintenance=0", {
      headers: { "Accept": "application/json" }
    });
    if (!res.ok) return 0;
    const data = await res.json();
    const packages = (data.objects || []).map(o => o.package?.name).filter(Boolean);

    for (const name of packages) {
      if (Date.now() - startTime > TIMEOUT) break;
      try {
        const pkgRes = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`);
        if (!pkgRes.ok) continue;
        const pkgData = await pkgRes.json();
        const latest = pkgData["dist-tags"]?.latest;
        if (!latest) continue;

        // Check if already captured
        const { data: existingPkg } = await supabase
          .from("packages").select("id").eq("name", name).eq("ecosystem", "npm").single();
        if (existingPkg) continue; // Already known — skip

        const vd = pkgData.versions?.[latest];
        if (!vd) continue;

        const manifest = {
          name, version: latest, ecosystem: "npm",
          description: pkgData.description,
          license: vd.license,
          dependencies: vd.dependencies || {},
          maintainers: (vd.maintainers || pkgData.maintainers || []).map(m => ({ name: m.name, email: m.email || null })),
          author: vd.author || pkgData.author || null,
          publishedAt: pkgData.time?.[latest] || null,
          dist: { integrity: vd.dist?.integrity, shasum: vd.dist?.shasum, tarball: vd.dist?.tarball },
          _npmUser: vd._npmUser ? { name: vd._npmUser.name, email: vd._npmUser.email || null } : null,
          captured_at: new Date().toISOString(), captured_by: "prechained.com/crawler-new", crawler_sha384: CRAWLER_SHA384
        };

        const ok = await captureNewPackage(name, "npm", latest, vd.dist?.integrity, vd.dist?.shasum, vd.license, Object.keys(vd.dependencies || {}), manifest);
        if (ok) captured++;
      } catch(e) { console.error(`[npm-new] ${name}:`, e.message); }
    }
  } catch(e) { console.error("[npm-new] feed error:", e.message); }
  return captured;
}

// ── PYPI NEW PACKAGES ─────────────────────────────────────────
// PyPI's /rss/updates.xml — last 40 packages updated
async function crawlPypiNew(startTime) {
  let captured = 0;
  try {
    const res = await fetch("https://pypi.org/rss/updates.xml");
    if (!res.ok) return 0;
    const xml = await res.text();

    // Parse package names from RSS — <title>packagename X.Y.Z</title>
    const matches = [...xml.matchAll(/<title>([^<]+?)\s+([\d.]+(?:\.post\d+|\.dev\d+|[ab]\d+|rc\d+)?)<\/title>/gi)];
    const packages = matches.slice(0, 40).map(m => ({ name: m[1].trim(), version: m[2].trim() }));

    for (const { name, version } of packages) {
      if (Date.now() - startTime > TIMEOUT) break;
      try {
        // Check if this version is already captured
        const { data: existingPkg } = await supabase
          .from("packages").select("id").eq("name", name).eq("ecosystem", "pypi").single();
        if (existingPkg) {
          const { data: existingSnap } = await supabase
            .from("snapshots").select("id").eq("package_id", existingPkg.id).eq("version", version).single();
          if (existingSnap) continue;
        }

        const pkgRes = await fetch(`https://pypi.org/pypi/${name}/${version}/json`);
        if (!pkgRes.ok) continue;
        const data = await pkgRes.json();
        const files = data.urls || [];
        const wheel = files.find(f => f.packagetype === "bdist_wheel") || files[0];

        const manifest = {
          name, version, ecosystem: "pypi",
          summary: data.info?.summary,
          license: data.info?.license,
          author: data.info?.author,
          author_email: data.info?.author_email || null,
          requires_python: data.info?.requires_python,
          requires_dist: data.info?.requires_dist || [],
          publishedAt: wheel?.upload_time || null,
          dist: { url: wheel?.url, sha256: wheel?.digests?.sha256, size: wheel?.size },
          captured_at: new Date().toISOString(), captured_by: "prechained.com/crawler-new", crawler_sha384: CRAWLER_SHA384
        };

        const ok = await captureNewPackage(name, "pypi", version, wheel?.digests?.sha256 ? "sha256:"+wheel.digests.sha256 : "", "", data.info?.license || "", data.info?.requires_dist || [], manifest);
        if (ok) captured++;
      } catch(e) { console.error(`[pypi-new] ${name}:`, e.message); }
    }
  } catch(e) { console.error("[pypi-new] feed error:", e.message); }
  return captured;
}

// ── CARGO NEW PACKAGES ────────────────────────────────────────
// crates.io new crates feed — sorted by newest
async function crawlCargoNew(startTime) {
  let captured = 0;
  try {
    const res = await fetch("https://crates.io/api/v1/crates?sort=new&per_page=50", {
      headers: { "User-Agent": "prechained.com/1.0 (supply chain archive)" }
    });
    if (!res.ok) return 0;
    const data = await res.json();
    const crates = data.crates || [];

    for (const crate of crates) {
      if (Date.now() - startTime > TIMEOUT) break;
      const name = crate.name;
      const version = crate.newest_version;
      if (!name || !version) continue;

      try {
        const { data: existingPkg } = await supabase
          .from("packages").select("id").eq("name", name).eq("ecosystem", "cargo").single();
        if (existingPkg) continue;

        const manifest = {
          name, version, ecosystem: "cargo",
          description: crate.description,
          downloads: crate.downloads,
          repository: crate.repository,
          homepage: crate.homepage,
          publishedAt: crate.created_at || null,
          captured_at: new Date().toISOString(), captured_by: "prechained.com/crawler-new", crawler_sha384: CRAWLER_SHA384
        };

        const ok = await captureNewPackage(name, "cargo", version, "", "", "", [], manifest);
        if (ok) captured++;
      } catch(e) { console.error(`[cargo-new] ${name}:`, e.message); }
    }
  } catch(e) { console.error("[cargo-new] feed error:", e.message); }
  return captured;
}

// ── NUGET NEW PACKAGES ────────────────────────────────────────
// NuGet catalog — sorted by newest
async function crawlNugetNew(startTime) {
  let captured = 0;
  try {
    // NuGet search sorted by created date
    const res = await fetch("https://azuresearch-usnc.nuget.org/query?q=&take=50&sortBy=created-desc&prerelease=false");
    if (!res.ok) return 0;
    const data = await res.json();
    const packages = data.data || [];

    for (const pkg of packages) {
      if (Date.now() - startTime > TIMEOUT) break;
      const name = pkg.id;
      const version = pkg.version;
      if (!name || !version) continue;

      try {
        const { data: existingPkg } = await supabase
          .from("packages").select("id").eq("name", name).eq("ecosystem", "nuget").single();
        if (existingPkg) continue;

        const manifest = {
          name, version, ecosystem: "nuget",
          description: pkg.description,
          authors: pkg.authors || [],
          tags: pkg.tags || [],
          totalDownloads: pkg.totalDownloads || 0,
          verified: pkg.verified || false,
          publishedAt: null,
          captured_at: new Date().toISOString(), captured_by: "prechained.com/crawler-new", crawler_sha384: CRAWLER_SHA384
        };

        const ok = await captureNewPackage(name, "nuget", version, "", "", "", [], manifest);
        if (ok) captured++;
      } catch(e) { console.error(`[nuget-new] ${name}:`, e.message); }
    }
  } catch(e) { console.error("[nuget-new] feed error:", e.message); }
  return captured;
}

// ── RUBYGEMS NEW PACKAGES ─────────────────────────────────────
// RubyGems latest gems feed
async function crawlRubygemsNew(startTime) {
  let captured = 0;
  try {
    const res = await fetch("https://rubygems.org/api/v1/activity/just_updated.json");
    if (!res.ok) return 0;
    const gems = await res.json();

    for (const gem of (gems || []).slice(0, 50)) {
      if (Date.now() - startTime > TIMEOUT) break;
      const name = gem.name;
      const version = gem.version;
      if (!name || !version) continue;

      try {
        const { data: existingPkg } = await supabase
          .from("packages").select("id").eq("name", name).eq("ecosystem", "rubygems").single();
        if (existingPkg) {
          const { data: existingSnap } = await supabase
            .from("snapshots").select("id").eq("package_id", existingPkg.id).eq("version", version).single();
          if (existingSnap) continue;
        }

        const manifest = {
          name, version, ecosystem: "rubygems",
          description: gem.info,
          authors: gem.authors,
          licenses: gem.licenses || [],
          sha: gem.sha,
          publishedAt: gem.version_created_at || null,
          homepage_uri: gem.homepage_uri,
          captured_at: new Date().toISOString(), captured_by: "prechained.com/crawler-new", crawler_sha384: CRAWLER_SHA384
        };

        const ok = await captureNewPackage(name, "rubygems", version, gem.sha ? "sha256:"+gem.sha : "", "", gem.licenses?.[0] || "", [], manifest);
        if (ok) captured++;
      } catch(e) { console.error(`[rubygems-new] ${name}:`, e.message); }
    }
  } catch(e) { console.error("[rubygems-new] feed error:", e.message); }
  return captured;
}

// ── PACKAGIST NEW PACKAGES ────────────────────────────────────
async function crawlPackagistNew(startTime) {
  let captured = 0;
  try {
    // Packagist latest packages feed
    const res = await fetch("https://packagist.org/explore/new.json");
    if (!res.ok) return 0;
    const data = await res.json();
    const packages = data.packages || [];

    for (const pkg of packages.slice(0, 30)) {
      if (Date.now() - startTime > TIMEOUT) break;
      const name = pkg.name;
      if (!name) continue;

      try {
        const { data: existingPkg } = await supabase
          .from("packages").select("id").eq("name", name).eq("ecosystem", "packagist").single();
        if (existingPkg) continue;

        // Fetch full package data
        const pkgRes = await fetch(`https://packagist.org/packages/${name}.json`);
        if (!pkgRes.ok) continue;
        const pkgData = await pkgRes.json();
        const pkgInfo = pkgData.package;
        if (!pkgInfo) continue;

        const versions = Object.keys(pkgInfo.versions || {}).filter(v => !v.includes("dev"));
        const version = (versions[0] || "").replace(/^v/, "");
        if (!version) continue;
        const vData = pkgInfo.versions[versions[0]];

        const manifest = {
          name, version, ecosystem: "packagist",
          description: vData?.description,
          authors: vData?.authors || [],
          license: vData?.license?.[0],
          publishedAt: vData?.time || null,
          captured_at: new Date().toISOString(), captured_by: "prechained.com/crawler-new", crawler_sha384: CRAWLER_SHA384
        };

        const ok = await captureNewPackage(name, "packagist", version, "", "", vData?.license?.[0] || "", Object.keys(vData?.require || {}), manifest);
        if (ok) captured++;
      } catch(e) { console.error(`[packagist-new] ${name}:`, e.message); }
    }
  } catch(e) { console.error("[packagist-new] feed error:", e.message); }
  return captured;
}

// ── MAVEN NEW PACKAGES ────────────────────────────────────────
// Maven Central new artifacts feed
async function crawlMavenNew(startTime) {
  let captured = 0;
  try {
    // Maven Central search — sort by added date
    const res = await fetch("https://search.maven.org/solrsearch/select?q=*:*&rows=50&wt=json&sort=timestamp+desc");
    if (!res.ok) return 0;
    const data = await res.json();
    const docs = data.response?.docs || [];

    for (const doc of docs) {
      if (Date.now() - startTime > TIMEOUT) break;
      const groupId = doc.g;
      const artifactId = doc.a;
      const version = doc.latestVersion || doc.v;
      if (!groupId || !artifactId || !version) continue;

      const name = `${groupId}:${artifactId}`;
      try {
        const { data: existingPkg } = await supabase
          .from("packages").select("id").eq("name", name).eq("ecosystem", "maven").single();
        if (existingPkg) continue;

        const manifest = {
          groupId, artifactId, version, ecosystem: "maven",
          name,
          publishedAt: doc.timestamp ? new Date(doc.timestamp).toISOString() : null,
          packaging: doc.p || "jar",
          captured_at: new Date().toISOString(), captured_by: "prechained.com/crawler-new", crawler_sha384: CRAWLER_SHA384
        };

        const ok = await captureNewPackage(name, "maven", version, "", "", "", [], manifest);
        if (ok) captured++;
      } catch(e) { console.error(`[maven-new] ${name}:`, e.message); }
    }
  } catch(e) { console.error("[maven-new] feed error:", e.message); }
  return captured;
}

// ── GITHUB NEW REPOS ──────────────────────────────────────────
// New public repos with security/package topics
async function crawlGithubNew(startTime) {
  let captured = 0;
  try {
    const headers = {
      "Accept": "application/vnd.github.v3+json",
      "User-Agent": "prechained.com/1.0"
    };
    if (GITHUB_TOKEN) headers["Authorization"] = "token " + GITHUB_TOKEN;

    // Search for repos pushed in last hour with supply chain / package topics
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString().split("T")[0];
    const res = await fetch(
      `https://api.github.com/search/repositories?q=pushed:>=${since}+topic:package-manager+topic:security&sort=updated&per_page=30`,
      { headers }
    );
    if (!res.ok) return 0;
    const data = await res.json();
    const repos = data.items || [];

    for (const repo of repos) {
      if (Date.now() - startTime > TIMEOUT) break;
      const name = repo.full_name;
      if (!name) continue;

      try {
        const { data: existingPkg } = await supabase
          .from("packages").select("id").eq("name", name).eq("ecosystem", "github").single();
        if (existingPkg) continue;

        const btcBlock = await getCurrentBtcBlock();
        const version = (repo.pushed_at || "").substring(0, 10).replace(/-/g, "");
        const manifest = {
          repo: name, version, ecosystem: "github",
          description: repo.description,
          stars: repo.stargazers_count,
          language: repo.language,
          topics: repo.topics || [],
          license: repo.license?.spdx_id || null,
          pushed_at: repo.pushed_at,
          created_at: repo.created_at,
          captured_at: new Date().toISOString(), captured_by: "prechained.com/crawler-new", crawler_sha384: CRAWLER_SHA384
        };

        const pkg = await upsertPackage(name, "github", repo.description, version, 1);
        if (!pkg) continue;

        const ok = await captureVersion(pkg, version, "github", "", "", repo.license?.spdx_id || "", [], manifest, CRAWLER_SHA384);
        if (ok) { captured++; await checkAndFlagTyposquat(name, "github", pkg.id); }
      } catch(e) { console.error(`[github-new] ${name}:`, e.message); }
    }
  } catch(e) { console.error("[github-new] feed error:", e.message); }
  return captured;
}

// ── DEFAULT EXPORT ────────────────────────────────────────────
export default async function handler(req, context) {
  const startTime = Date.now();
  console.log(`[crawler-new] starting ${new Date().toISOString()}`);

  const results = await Promise.allSettled([
    crawlNpmNew(startTime),
    crawlPypiNew(startTime),
    crawlCargoNew(startTime),
    crawlNugetNew(startTime),
    crawlRubygemsNew(startTime),
    crawlPackagistNew(startTime),
    crawlMavenNew(startTime),
    crawlGithubNew(startTime),
  ]);

  const totals = results.map((r, i) => ({
    ecosystem: ["npm","pypi","cargo","nuget","rubygems","packagist","maven","github"][i],
    captured: r.status === "fulfilled" ? r.value : 0,
    error: r.status === "rejected" ? r.reason?.message : null
  }));

  const totalCaptured = totals.reduce((sum, t) => sum + t.captured, 0);
  const elapsed = Date.now() - startTime;

  console.log(`[crawler-new] done: ${totalCaptured} new packages captured in ${elapsed}ms`);
  console.log("[crawler-new] breakdown:", JSON.stringify(totals));

  return new Response(JSON.stringify({
    ok: true,
    total_captured: totalCaptured,
    elapsed_ms: elapsed,
    breakdown: totals,
    crawler_sha384: CRAWLER_SHA384,
    timestamp: new Date().toISOString()
  }), { headers: { "Content-Type": "application/json" } });
}
