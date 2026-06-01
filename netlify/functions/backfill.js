// backfill.js — Priority legacy snapshot backfill.
// Runs every 5 minutes as a scheduled Netlify function.
//
// Strategy (fastest path to zero legacy records):
//   Pass 1 — rows with manifest_path: fetch from GitHub archive, recompute
//             canonical fingerprint, update to fp:v2. No registry call needed.
//             ~100 rows/run, done in hours.
//   Pass 2 — rows without manifest_path: fetch manifest from registry API,
//             compute canonical fingerprint, update to fp:v2.
//             Skips GitHub archive write (done separately by backfill-archive.js)
//             so each row takes ~150ms instead of ~500ms.
//             ~40 rows/run.
//
// Priority order: packages with most versions first (aws-sdk, rails, react etc.)
// so the high-visibility records clear first.
//
// prechained.com · Built by NextGenRails™

import {
  supabase,
  storeManifestInGithub,
  canonicalFingerprint,
  GITHUB_TOKEN,
} from "./_shared.js";

const TIMEOUT = 8500;
const ARCHIVE_BATCH = 100;  // rows with existing manifest_path
const REGISTRY_BATCH = 40;  // rows needing registry fetch
const ARCHIVE_REPO = process.env.GITHUB_ARCHIVE_REPO || "ngr-dev1/prechained-archive";

// ── REGISTRY MANIFEST FETCHERS ───────────────────────────────────────────────

async function fetchNpmManifest(pkgName, version) {
  const res = await fetch(
    `https://registry.npmjs.org/${encodeURIComponent(pkgName)}`,
    { headers: { Accept: "application/json" } }
  );
  if (!res.ok) throw new Error(`npm ${res.status}`);
  const data = await res.json();
  const vd = data.versions?.[version];
  if (!vd) throw new Error(`version not found`);
  return {
    name: pkgName, version, ecosystem: "npm",
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
    dist: {
      integrity: vd.dist?.integrity, shasum: vd.dist?.shasum, tarball: vd.dist?.tarball,
      fileCount: vd.dist?.fileCount || null, unpackedSize: vd.dist?.unpackedSize || null
    },
    repository: vd.repository || null, homepage: vd.homepage || null,
    bugs: vd.bugs || null, keywords: vd.keywords || [],
    _npmUser: vd._npmUser ? { name: vd._npmUser.name, email: vd._npmUser.email || null } : null,
  };
}

async function fetchPypiManifest(pkgName, version) {
  const res = await fetch(`https://pypi.org/pypi/${encodeURIComponent(pkgName)}/${encodeURIComponent(version)}/json`);
  if (!res.ok) throw new Error(`pypi ${res.status}`);
  const data = await res.json();
  const files = data.urls || [];
  const wheel = files.find(f => f.packagetype === "bdist_wheel") || files[0];
  return {
    name: pkgName, version, ecosystem: "pypi",
    summary: data.info?.summary || null, license: data.info?.license || null,
    author: data.info?.author || null, author_email: data.info?.author_email || null,
    requires_python: data.info?.requires_python || null,
    requires_dist: data.info?.requires_dist || [],
    keywords: data.info?.keywords || null,
    classifiers: data.info?.classifiers || [],
    project_urls: data.info?.project_urls || {},
    yanked: data.info?.yanked || false, yanked_reason: data.info?.yanked_reason || null,
    publishedAt: wheel?.upload_time || files[0]?.upload_time || null,
    dist: { url: wheel?.url, sha256: wheel?.digests?.sha256, size: wheel?.size, filename: wheel?.filename },
    all_files: files.map(f => ({ filename: f.filename, packagetype: f.packagetype, sha256: f.digests?.sha256, size: f.size, upload_time: f.upload_time, yanked: f.yanked || false })),
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
    sha256: vData?.sha ? "sha256:" + vData.sha : null,
    platform: vData?.platform || "ruby",
    ruby_version: vData?.ruby_version || null,
    rubygems_version: vData?.rubygems_version || null,
    authors: gemData.authors,
    owners: (Array.isArray(gemOwners) ? gemOwners : []).map(o => ({ id: o.id, handle: o.handle, email: o.email || null, mfa_level: o.mfa_level || null })),
    homepage_uri: gemData.homepage_uri,
    source_code_uri: gemData.source_code_uri,
    changelog_uri: gemData.changelog_uri || null,
    publishedAt: vData?.created_at || null,
    downloads: gemData.downloads,
    version_downloads: vData?.downloads_count || null,
  };
}

async function fetchPackagistManifest(pkgName, version) {
  const res = await fetch(`https://packagist.org/packages/${pkgName}.json`);
  if (!res.ok) throw new Error(`packagist ${res.status}`);
  const data = await res.json();
  const pkg_data = data.package;
  const vData = pkg_data?.versions?.[version] || pkg_data?.versions?.["v" + version];
  if (!vData) throw new Error(`version not found`);
  return {
    name: pkgName, version, ecosystem: "packagist",
    description: vData.description || pkg_data.description || null,
    license: vData.license?.[0] || null, licenses: vData.license || [],
    type: vData.type, require: vData.require || {}, require_dev: vData.require_dev || {},
    dist: vData.dist || {}, source: vData.source || {},
    authors: vData.authors || [], maintainers: pkg_data.maintainers || [],
    homepage: vData.homepage, keywords: vData.keywords || [],
    publishedAt: vData.time || null,
    github_stars: pkg_data.github_stars || null,
    github_watchers: pkg_data.github_watchers || null,
    github_forks: pkg_data.github_forks || null,
    abandoned: pkg_data.abandoned || false,
  };
}

async function fetchNugetManifest(pkgName, version) {
  const regRes = await fetch(`https://api.nuget.org/v3/registration5-semver1/${pkgName.toLowerCase()}/index.json`);
  if (!regRes.ok) throw new Error(`nuget ${regRes.status}`);
  const regData = await regRes.json();
  let entry = null;
  for (const page of regData.items || []) {
    const items = page.items || [];
    for (const item of items) {
      if (item.catalogEntry?.version?.toLowerCase() === version.toLowerCase()) { entry = item.catalogEntry; break; }
    }
    if (entry) break;
    if (!page.items && page["@id"]) {
      const pg = await fetch(page["@id"]);
      if (pg.ok) {
        const pgData = await pg.json();
        for (const item of pgData.items || []) {
          if (item.catalogEntry?.version?.toLowerCase() === version.toLowerCase()) { entry = item.catalogEntry; break; }
        }
      }
    }
    if (entry) break;
  }
  if (!entry) throw new Error(`version not found`);
  const nugetDeps = (entry.dependencyGroups || []).flatMap(g =>
    (g.dependencies || []).map(d => ({ id: d.id, range: d.range, targetFramework: g.targetFramework || null }))
  );
  return {
    name: pkgName, version, ecosystem: "nuget",
    description: entry.description || null, authors: entry.authors || null,
    licenseExpression: entry.licenseExpression || null, licenseUrl: entry.licenseUrl || null,
    projectUrl: entry.projectUrl || null, tags: entry.tags || [],
    language: entry.language || null, repositoryUrl: entry.repositoryUrl || null,
    repositoryType: entry.repositoryType || null, repositoryCommit: entry.repositoryCommit || null,
    dependencies: nugetDeps, dependencyGroups: entry.dependencyGroups || [],
    publishedAt: entry.published || null, listed: entry.listed !== false,
    requireLicenseAcceptance: entry.requireLicenseAcceptance || false,
    packageHash: entry.packageHash || null, packageHashAlgorithm: entry.packageHashAlgorithm || null,
  };
}

async function fetchMavenManifest(pkgName, version) {
  const [groupId, artifactId] = pkgName.split(":");
  if (!groupId || !artifactId) throw new Error(`bad maven pkgName`);
  const groupPath = groupId.replace(/\./g, "/");
  const pomRes = await fetch(`https://repo1.maven.org/maven2/${groupPath}/${artifactId}/${version}/${artifactId}-${version}.pom`);
  if (!pomRes.ok) throw new Error(`maven pom ${pomRes.status}`);
  const pomText = await pomRes.text();
  const getTag = (xml, tag) => { const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i")); return m ? m[1].trim() : null; };
  const getDeps = (xml) => { const deps = []; const dr = /<dependency>([\s\S]*?)<\/dependency>/gi; let m; while ((m = dr.exec(xml)) !== null) deps.push({ groupId: getTag(m[1], "groupId"), artifactId: getTag(m[1], "artifactId"), version: getTag(m[1], "version"), scope: getTag(m[1], "scope") }); return deps; };
  return {
    name: pkgName, version, ecosystem: "maven", groupId, artifactId,
    description: getTag(pomText, "description"), url: getTag(pomText, "url"),
    inceptionYear: getTag(pomText, "inceptionYear"),
    licenses: (() => { const lics = []; const lr = /<license>([\s\S]*?)<\/license>/gi; let m; while ((m = lr.exec(pomText)) !== null) lics.push({ name: getTag(m[1], "name"), url: getTag(m[1], "url") }); return lics; })(),
    developers: (() => { const devs = []; const dr = /<developer>([\s\S]*?)<\/developer>/gi; let m; while ((m = dr.exec(pomText)) !== null) devs.push({ id: getTag(m[1], "id"), name: getTag(m[1], "name"), email: getTag(m[1], "email") }); return devs; })(),
    scm: { url: getTag(pomText, "url"), connection: getTag(pomText, "connection") },
    dependencies: getDeps(pomText),
    centralUrl: `https://repo1.maven.org/maven2/${groupPath}/${artifactId}/${version}/`,
    publishedAt: null,
  };
}

async function fetchGithubManifest(pkgName, version) {
  const headers = { "Accept": "application/vnd.github.v3+json", "User-Agent": "prechained.com/1.0" };
  if (GITHUB_TOKEN) headers["Authorization"] = "token " + GITHUB_TOKEN;
  const [repoRes, releaseRes] = await Promise.all([
    fetch(`https://api.github.com/repos/${pkgName}`, { headers }),
    fetch(`https://api.github.com/repos/${pkgName}/releases/tags/${encodeURIComponent(version)}`, { headers })
  ]);
  if (!repoRes.ok) throw new Error(`github ${repoRes.status}`);
  const repo = await repoRes.json();
  const release = releaseRes.ok ? await releaseRes.json() : null;
  return {
    name: pkgName, version, ecosystem: "github",
    description: repo.description, homepage: repo.homepage,
    language: repo.language, license: repo.license?.spdx_id || null,
    topics: repo.topics || [], stargazers_count: repo.stargazers_count,
    forks_count: repo.forks_count, open_issues_count: repo.open_issues_count,
    default_branch: repo.default_branch,
    publishedAt: release?.published_at || null,
    release_name: release?.name || null,
    release_body: release?.body ? release.body.slice(0, 1000) : null,
    assets: (release?.assets || []).map(a => ({ name: a.name, size: a.size, download_count: a.download_count })),
    archived: repo.archived, fork: repo.fork,
  };
}

async function fetchManifestFromRegistry(ecosystem, pkgName, version) {
  switch (ecosystem) {
    case "npm":       return fetchNpmManifest(pkgName, version);
    case "pypi":      return fetchPypiManifest(pkgName, version);
    case "cargo":     return fetchCargoManifest(pkgName, version);
    case "rubygems":  return fetchRubygemsManifest(pkgName, version);
    case "packagist": return fetchPackagistManifest(pkgName, version);
    case "nuget":     return fetchNugetManifest(pkgName, version);
    case "maven":     return fetchMavenManifest(pkgName, version);
    case "github":    return fetchGithubManifest(pkgName, version);
    default: throw new Error(`unknown ecosystem: ${ecosystem}`);
  }
}

async function fetchManifestFromArchive(manifestPath) {
  const url = `https://raw.githubusercontent.com/${ARCHIVE_REPO}/main/${manifestPath}`;
  const headers = GITHUB_TOKEN ? { Authorization: `token ${GITHUB_TOKEN}` } : {};
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`archive ${res.status}`);
  return res.json();
}

// ── MAIN HANDLER ─────────────────────────────────────────────────────────────
export default async function handler(req, context) {
  const start = Date.now();
  console.log("[backfill] start", new Date().toISOString());

  let archiveDone = 0, registryDone = 0, failed = 0;

  // ── PASS 1: rows with archived manifests (fast — no registry call) ──
  const { data: archiveRows } = await supabase
    .from("snapshots")
    .select("id, version, ecosystem, manifest_path, package_id")
    .filter("raw_metadata->>fp", "neq", "v2")
    .not("manifest_path", "is", null)
    .order("id", { ascending: true })
    .limit(ARCHIVE_BATCH);

  // Get package names
  const allIds = [...new Set([...(archiveRows || []).map(r => r.package_id)])];
  const { data: packages } = await supabase.from("packages").select("id, name, ecosystem").in("id", allIds.length ? allIds : ["00000000-0000-0000-0000-000000000000"]);
  const pkgMap = new Map((packages || []).map(p => [p.id, p]));

  for (const row of archiveRows || []) {
    if (Date.now() - start > TIMEOUT * 0.45) break; // leave half the budget for pass 2
    const pkg = pkgMap.get(row.package_id);
    if (!pkg) { failed++; continue; }
    try {
      const manifest = await fetchManifestFromArchive(row.manifest_path);
      const fingerprint = canonicalFingerprint(manifest);
      const { error } = await supabase.from("snapshots").update({
        sha384_fingerprint: fingerprint,
        raw_metadata: { fp: "v2", backfilled: true, source: "archive" }
      }).eq("id", row.id);
      if (error) throw new Error(error.message);
      archiveDone++;
    } catch (e) {
      console.warn(`[backfill] archive ${pkg.name}@${row.version}: ${e.message}`);
      failed++;
    }
  }

  // ── PASS 2: rows without manifests (registry fetch, skip GitHub write) ──
  if (Date.now() - start < TIMEOUT * 0.5) {
    const { data: registryRows } = await supabase
      .from("snapshots")
      .select("id, version, ecosystem, package_id")
      .filter("raw_metadata->>fp", "neq", "v2")
      .is("manifest_path", null)
      .order("id", { ascending: true })
      .limit(REGISTRY_BATCH);

    const regIds = [...new Set((registryRows || []).map(r => r.package_id))];
    if (regIds.length) {
      const { data: regPkgs } = await supabase.from("packages").select("id, name, ecosystem").in("id", regIds);
      const regMap = new Map((regPkgs || []).map(p => [p.id, p]));

      for (const row of registryRows || []) {
        if (Date.now() - start > TIMEOUT) break;
        const pkg = regMap.get(row.package_id);
        if (!pkg) { failed++; continue; }
        try {
          const manifest = await fetchManifestFromRegistry(row.ecosystem, pkg.name, row.version);
          const fingerprint = canonicalFingerprint(manifest);
          // Store manifest in GitHub archive (best-effort, don't fail the row if this fails)
          let manifestPath = null;
          try {
            manifestPath = await storeManifestInGithub(row.ecosystem, pkg.name, row.version, manifest);
          } catch (e) {
            console.warn(`[backfill] github store ${pkg.name}@${row.version}: ${e.message}`);
          }
          const updateData = {
            sha384_fingerprint: fingerprint,
            raw_metadata: { fp: "v2", backfilled: true, source: "registry" },
            ...(manifestPath ? { manifest_path: manifestPath } : {})
          };
          const { error } = await supabase.from("snapshots").update(updateData).eq("id", row.id);
          if (error) throw new Error(error.message);
          registryDone++;
        } catch (e) {
          console.warn(`[backfill] registry ${pkg?.name}@${row.version}: ${e.message}`);
          failed++;
        }
      }
    }
  }

  // Count remaining
  const { count: remaining } = await supabase
    .from("snapshots")
    .select("id", { count: "exact", head: true })
    .filter("raw_metadata->>fp", "neq", "v2");

  const elapsed = Date.now() - start;
  const done = archiveDone + registryDone;
  console.log(`[backfill] done: archive=${archiveDone} registry=${registryDone} failed=${failed} remaining=${remaining} ${elapsed}ms`);

  return new Response(JSON.stringify({
    ok: true, archiveDone, registryDone, totalDone: done,
    failed, remaining, elapsed_ms: elapsed,
    timestamp: new Date().toISOString(),
    ...(remaining === 0 ? { allDone: true } : {})
  }), { headers: { "Content-Type": "application/json" } });
}
