// crawler-new.js — New-Version Discovery Crawler (all 8 ecosystems)
// Runs every 10 minutes. Its ONLY job is to DISCOVER (package, version) pairs
// cheaply and ENQUEUE the ones we don't already have. The expensive capture
// work (fingerprint + GitHub manifest store + BTC anchor) is done by
// queue-drainer.js, which drains the queue in 8.5s slices.
//
// What changed vs the old crawler-new:
//   1. We NO LONGER skip dev/prerelease versions. Dev branches are exactly
//      where targeted-developer lures live (Famous Chollima, take-home tasks).
//   2. We NO LONGER skip a package just because its name is already known.
//      We diff the package's full version list against what we've stored and
//      enqueue every NEW version — that's how XZ-style "new bad version of a
//      trusted package" gets caught.
//   3. Discovery is cheap (one or two feed/registry calls per package), so we
//      can sweep far more of each feed within the timeout. Capture cost is
//      moved off the critical path into the durable queue.
// prechained.com · Built by NextGenRails™

import { supabase, enqueueCaptures } from "./_shared.js";

const TIMEOUT = 8500;

// ── HELPER: enqueue every not-yet-captured version of one package ─────────
async function enqueueNewVersions(name, ecosystem, allVersions, source, hintByVersion) {
  if (!allVersions || !allVersions.length) return 0;

  const { data: pkg } = await supabase
    .from("packages").select("id")
    .eq("name", name).eq("ecosystem", ecosystem).maybeSingle();

  let seen = new Set();
  if (pkg) {
    const { data: existing } = await supabase
      .from("snapshots").select("version").eq("package_id", pkg.id);
    seen = new Set((existing || []).map(s => s.version));
  }

  const fresh = allVersions.filter(v => !seen.has(String(v)));
  if (!fresh.length) return 0;

  const rows = fresh.map(v => ({
    ecosystem,
    package_name: name,
    version: String(v),
    source,
    hint: hintByVersion ? (hintByVersion[v] || null) : null
  }));
  return await enqueueCaptures(rows);
}

// ── NPM ───────────────────────────────────────────────────────
async function crawlNpmNew(startTime) {
  let enq = 0;
  try {
    const res = await fetch("https://registry.npmjs.org/-/v1/search?text=&size=100&from=0&quality=0&popularity=0&maintenance=0", {
      headers: { "Accept": "application/json" }
    });
    if (!res.ok) return 0;
    const data = await res.json();
    const names = (data.objects || []).map(o => o.package?.name).filter(Boolean);

    for (const name of names) {
      if (Date.now() - startTime > TIMEOUT) break;
      try {
        const r = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`);
        if (!r.ok) continue;
        const pd = await r.json();
        // EVERY version, including prereleases and dist-tagged dev builds.
        const allVersions = Object.keys(pd.versions || {});
        enq += await enqueueNewVersions(name, "npm", allVersions, "crawler-new/npm");
      } catch (e) { console.error(`[npm-new] ${name}:`, e.message); }
    }
  } catch (e) { console.error("[npm-new] feed error:", e.message); }
  return enq;
}

// ── PYPI ──────────────────────────────────────────────────────
async function crawlPypiNew(startTime) {
  let enq = 0;
  try {
    const res = await fetch("https://pypi.org/rss/updates.xml");
    if (!res.ok) return 0;
    const xml = await res.text();
    // <title>name X.Y.Z</title> — keep the version exactly as published,
    // including .dev / a / b / rc prerelease suffixes.
    const matches = [...xml.matchAll(/<title>([^<]+?)\s+([^\s<]+)<\/title>/gi)];
    const seen = new Set();
    for (const m of matches.slice(0, 60)) {
      if (Date.now() - startTime > TIMEOUT) break;
      const name = m[1].trim();
      const version = m[2].trim();
      const key = name + "@" + version;
      if (seen.has(key)) continue;
      seen.add(key);
      enq += await enqueueNewVersions(name, "pypi", [version], "crawler-new/pypi");
    }
  } catch (e) { console.error("[pypi-new] feed error:", e.message); }
  return enq;
}

// ── CARGO ─────────────────────────────────────────────────────
async function crawlCargoNew(startTime) {
  let enq = 0;
  try {
    const res = await fetch("https://crates.io/api/v1/crates?sort=new&per_page=100", {
      headers: { "User-Agent": "prechained.com/1.0 (supply chain archive)" }
    });
    if (!res.ok) return 0;
    const data = await res.json();
    for (const crate of (data.crates || [])) {
      if (Date.now() - startTime > TIMEOUT) break;
      const name = crate.name;
      if (!name) continue;
      try {
        const vr = await fetch(`https://crates.io/api/v1/crates/${name}`, {
          headers: { "User-Agent": "prechained.com/1.0" }
        });
        if (!vr.ok) {
          if (crate.newest_version) enq += await enqueueNewVersions(name, "cargo", [crate.newest_version], "crawler-new/cargo");
          continue;
        }
        const cd = await vr.json();
        const allVersions = (cd.versions || []).map(v => v.num).filter(Boolean);
        enq += await enqueueNewVersions(name, "cargo", allVersions.length ? allVersions : [crate.newest_version], "crawler-new/cargo");
      } catch (e) { console.error(`[cargo-new] ${name}:`, e.message); }
    }
  } catch (e) { console.error("[cargo-new] feed error:", e.message); }
  return enq;
}

// ── NUGET ─────────────────────────────────────────────────────
async function crawlNugetNew(startTime) {
  let enq = 0;
  try {
    // prerelease=true so we DON'T silently exclude dev/preview packages.
    const res = await fetch("https://azuresearch-usnc.nuget.org/query?q=&take=100&sortBy=created-desc&prerelease=true");
    if (!res.ok) return 0;
    const data = await res.json();
    for (const pkg of (data.data || [])) {
      if (Date.now() - startTime > TIMEOUT) break;
      const name = pkg.id;
      if (!name) continue;
      const allVersions = Array.isArray(pkg.versions)
        ? pkg.versions.map(v => v.version).filter(Boolean)
        : (pkg.version ? [pkg.version] : []);
      enq += await enqueueNewVersions(name, "nuget", allVersions, "crawler-new/nuget");
    }
  } catch (e) { console.error("[nuget-new] feed error:", e.message); }
  return enq;
}

// ── RUBYGEMS ──────────────────────────────────────────────────
async function crawlRubygemsNew(startTime) {
  let enq = 0;
  try {
    const feeds = [
      "https://rubygems.org/api/v1/activity/just_updated.json",
      "https://rubygems.org/api/v1/activity/latest.json"
    ];
    const seen = new Set();
    for (const url of feeds) {
      if (Date.now() - startTime > TIMEOUT) break;
      const res = await fetch(url);
      if (!res.ok) continue;
      const gems = await res.json();
      for (const gem of (gems || [])) {
        if (Date.now() - startTime > TIMEOUT) break;
        const name = gem.name, version = gem.version;
        if (!name || !version) continue;
        const key = name + "@" + version;
        if (seen.has(key)) continue;
        seen.add(key);
        enq += await enqueueNewVersions(name, "rubygems", [version], "crawler-new/rubygems");
      }
    }
  } catch (e) { console.error("[rubygems-new] feed error:", e.message); }
  return enq;
}

// ── PACKAGIST (the ecosystem this attack used) ────────────────
async function crawlPackagistNew(startTime) {
  let enq = 0;
  try {
    const res = await fetch("https://packagist.org/explore/new.json");
    if (!res.ok) return 0;
    const data = await res.json();
    const names = (data.packages || []).map(p => p.name).filter(Boolean);

    for (const name of names) {
      if (Date.now() - startTime > TIMEOUT) break;
      try {
        const r = await fetch(`https://packagist.org/packages/${name}.json`);
        if (!r.ok) continue;
        const pd = await r.json();
        const info = pd.package;
        if (!info) continue;
        // CRITICAL FIX: keep dev- branches and prerelease tags. The Famous
        // Chollima loader shipped on a "dev-…/feature/test-case" branch that
        // the old `.filter(v => !v.includes("dev"))` threw away.
        const allVersions = Object.keys(info.versions || {});
        enq += await enqueueNewVersions(name, "packagist", allVersions, "crawler-new/packagist");
      } catch (e) { console.error(`[packagist-new] ${name}:`, e.message); }
    }
  } catch (e) { console.error("[packagist-new] feed error:", e.message); }
  return enq;
}

// ── MAVEN ─────────────────────────────────────────────────────
async function crawlMavenNew(startTime) {
  let enq = 0;
  try {
    const res = await fetch("https://search.maven.org/solrsearch/select?q=*:*&rows=100&wt=json&sort=timestamp+desc");
    if (!res.ok) return 0;
    const data = await res.json();
    for (const doc of (data.response?.docs || [])) {
      if (Date.now() - startTime > TIMEOUT) break;
      const groupId = doc.g, artifactId = doc.a;
      const version = doc.latestVersion || doc.v;
      if (!groupId || !artifactId || !version) continue;
      const name = `${groupId}:${artifactId}`;
      enq += await enqueueNewVersions(name, "maven", [version], "crawler-new/maven");
    }
  } catch (e) { console.error("[maven-new] feed error:", e.message); }
  return enq;
}

// ── GITHUB ────────────────────────────────────────────────────
async function crawlGithubNew(startTime) {
  let enq = 0;
  try {
    const headers = { "Accept": "application/vnd.github.v3+json", "User-Agent": "prechained.com/1.0" };
    if (process.env.GITHUB_ARCHIVE_TOKEN) headers["Authorization"] = "token " + process.env.GITHUB_ARCHIVE_TOKEN;
    const since = new Date(Date.now() - 60 * 60 * 1000).toISOString().split("T")[0];
    const res = await fetch(
      `https://api.github.com/search/repositories?q=pushed:>=${since}+topic:package-manager+topic:security&sort=updated&per_page=50`,
      { headers }
    );
    if (!res.ok) return 0;
    const data = await res.json();
    for (const repo of (data.items || [])) {
      if (Date.now() - startTime > TIMEOUT) break;
      const name = repo.full_name;
      if (!name) continue;
      const version = (repo.pushed_at || "").substring(0, 10).replace(/-/g, "");
      if (!version) continue;
      enq += await enqueueNewVersions(name, "github", [version], "crawler-new/github");
    }
  } catch (e) { console.error("[github-new] feed error:", e.message); }
  return enq;
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

  const eco = ["npm","pypi","cargo","nuget","rubygems","packagist","maven","github"];
  const breakdown = results.map((r, i) => ({
    ecosystem: eco[i],
    enqueued: r.status === "fulfilled" ? r.value : 0,
    error: r.status === "rejected" ? r.reason?.message : null
  }));
  const totalEnqueued = breakdown.reduce((s, b) => s + b.enqueued, 0);
  const elapsed = Date.now() - startTime;

  console.log(`[crawler-new] done: ${totalEnqueued} versions enqueued in ${elapsed}ms`);
  console.log("[crawler-new] breakdown:", JSON.stringify(breakdown));

  return new Response(JSON.stringify({
    ok: true,
    total_enqueued: totalEnqueued,
    elapsed_ms: elapsed,
    breakdown,
    timestamp: new Date().toISOString()
  }), { headers: { "Content-Type": "application/json" } });
}
