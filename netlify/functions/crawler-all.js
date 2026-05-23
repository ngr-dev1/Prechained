// crawler-all.js — Universal Crawler, All 8 Ecosystems
// Each ecosystem exported as its own scheduled Netlify function
// so each gets a full independent timeout budget
// prechained.com · Built by NextGenRails™

import {
  supabase, upsertPackage, captureVersion, sha384, generateReceiptId,
  storeManifestInGithub, getCurrentBtcBlock,
  GITHUB_TOKEN,
  fetchNpmPackages, fetchPypiPackages, fetchCargoPackages, fetchGithubRepos,
  fetchNugetPackages, fetchMavenPackages, fetchRubygemsPackages, fetchPackagistPackages
} from "./_shared.js";
import { readFileSync } from "fs";

const TIMEOUT = 8500;

function crawlerSha(url) {
  try { return sha384(readFileSync(new URL(url).pathname, "utf8")); } catch(e) { return null; }
}
const CRAWLER_SHA384 = crawlerSha(import.meta.url);

// ── NPM ────────────────────────────────────────────────────────
export async function crawlerNpm(req, context) {
  const startTime = Date.now();
  let captured = 0, skipped = 0;
  console.log(`[npm] starting ${new Date().toISOString()}`);

  const NPM_PACKAGES = await fetchNpmPackages();
  for (const name of [...NPM_PACKAGES].sort(() => Math.random() - 0.5)) {
    if (Date.now() - startTime > TIMEOUT) break;
    try {
      const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`, { headers: { "Accept": "application/json" } });
      if (!res.ok) continue;
      const data = await res.json();
      const latest = data["dist-tags"]?.latest;
      if (!latest) continue;
      const allVersions = Object.keys(data.versions || {});
      const pkg = await upsertPackage(name, "npm", data.description, latest, allVersions.length);
      if (!pkg) continue;
      const { data: existing } = await supabase.from("snapshots").select("version").eq("package_id", pkg.id);
      const seen = new Set((existing || []).map(s => s.version));
      for (const version of allVersions.filter(v => !seen.has(v))) {
        if (Date.now() - startTime > TIMEOUT) break;
        const vd = data.versions[version];
        if (!vd) continue;
        const manifest = {
          name, version, ecosystem: "npm",
          description: data.description, license: vd.license,
          dependencies: vd.dependencies || {}, devDependencies: vd.devDependencies || {},
          peerDependencies: vd.peerDependencies || {}, engines: vd.engines || {},
          scripts: {
            install: vd.scripts?.install || null,
            preinstall: vd.scripts?.preinstall || null,
            postinstall: vd.scripts?.postinstall || null,
            prepare: vd.scripts?.prepare || null,
            prepublish: vd.scripts?.prepublish || null,
            prepublishOnly: vd.scripts?.prepublishOnly || null
          },
          maintainers: (vd.maintainers || data.maintainers || []).map(m => ({ name: m.name, email: m.email || null })),
          author: vd.author || data.author || null,
          publishedAt: data.time?.[version] || null,
          dist: {
            integrity: vd.dist?.integrity,
            shasum: vd.dist?.shasum,
            tarball: vd.dist?.tarball,
            fileCount: vd.dist?.fileCount || null,
            unpackedSize: vd.dist?.unpackedSize || null
          },
          repository: vd.repository || null, homepage: vd.homepage || null,
          bugs: vd.bugs || null,
          keywords: vd.keywords || [],
          _npmUser: vd._npmUser ? { name: vd._npmUser.name, email: vd._npmUser.email || null } : null,
          captured_at: new Date().toISOString(), captured_by: "prechained.com", crawler_sha384: CRAWLER_SHA384
        };
        const ok = await captureVersion(pkg, version, "npm", vd.dist?.integrity, vd.dist?.shasum, vd.license, Object.keys(vd.dependencies || {}), manifest, CRAWLER_SHA384);
        ok ? captured++ : skipped++;
      }
    } catch(e) { console.error(`[npm] ${name}:`, e.message); }
  }
  const elapsed = Date.now() - startTime;
  console.log(`[npm] done: ${captured} captured, ${skipped} skipped, ${elapsed}ms`);
  return new Response(JSON.stringify({ ok: true, ecosystem: "npm", captured, skipped, elapsed_ms: elapsed, crawler_sha384: CRAWLER_SHA384, timestamp: new Date().toISOString() }), { headers: { "Content-Type": "application/json" } });
}

// ── PYPI ───────────────────────────────────────────────────────
export async function crawlerPypi(req, context) {
  const startTime = Date.now();
  let captured = 0, skipped = 0;
  console.log(`[pypi] starting ${new Date().toISOString()}`);

  const PYPI_PACKAGES = await fetchPypiPackages();
  for (const name of [...PYPI_PACKAGES].sort(() => Math.random() - 0.5)) {
    if (Date.now() - startTime > TIMEOUT) break;
    try {
      const res = await fetch(`https://pypi.org/pypi/${name}/json`);
      if (!res.ok) continue;
      const data = await res.json();
      const latest = data.info?.version;
      if (!latest) continue;
      const allVersions = Object.keys(data.releases || {}).filter(v => (data.releases[v] || []).length > 0);
      const pkg = await upsertPackage(name, "pypi", data.info?.summary, latest, allVersions.length);
      if (!pkg) continue;
      const { data: existing } = await supabase.from("snapshots").select("version").eq("package_id", pkg.id);
      const seen = new Set((existing || []).map(s => s.version));
      for (const version of allVersions.filter(v => !seen.has(v))) {
        if (Date.now() - startTime > TIMEOUT) break;
        const files = data.releases[version] || [];
        const wheel = files.find(f => f.packagetype === "bdist_wheel") || files[0];
        const manifest = {
          name, version, ecosystem: "pypi",
          summary: data.info?.summary, license: data.info?.license,
          author: data.info?.author,
          author_email: data.info?.author_email || null,
          maintainer: data.info?.maintainer || null,
          maintainer_email: data.info?.maintainer_email || null,
          requires_python: data.info?.requires_python,
          requires_dist: data.info?.requires_dist || [],
          keywords: data.info?.keywords || null,
          classifiers: data.info?.classifiers || [],
          project_urls: data.info?.project_urls || {},
          yanked: data.info?.yanked || false,
          yanked_reason: data.info?.yanked_reason || null,
          publishedAt: wheel?.upload_time || files[0]?.upload_time || null,
          dist: { url: wheel?.url, sha256: wheel?.digests?.sha256, size: wheel?.size, filename: wheel?.filename },
          all_files: files.map(f => ({ filename: f.filename, packagetype: f.packagetype, sha256: f.digests?.sha256, size: f.size, upload_time: f.upload_time, yanked: f.yanked || false })),
          captured_at: new Date().toISOString(), captured_by: "prechained.com", crawler_sha384: CRAWLER_SHA384
        };
        const ok = await captureVersion(pkg, version, "pypi", wheel?.digests?.sha256 ? "sha256:" + wheel.digests.sha256 : "", wheel?.digests?.md5 || "", data.info?.license || [], manifest, CRAWLER_SHA384);
        ok ? captured++ : skipped++;
      }
    } catch(e) { console.error(`[pypi] ${name}:`, e.message); }
  }
  const elapsed = Date.now() - startTime;
  console.log(`[pypi] done: ${captured} captured, ${skipped} skipped, ${elapsed}ms`);
  return new Response(JSON.stringify({ ok: true, ecosystem: "pypi", captured, skipped, elapsed_ms: elapsed, crawler_sha384: CRAWLER_SHA384, timestamp: new Date().toISOString() }), { headers: { "Content-Type": "application/json" } });
}

// ── CARGO ──────────────────────────────────────────────────────
export async function crawlerCargo(req, context) {
  const startTime = Date.now();
  let captured = 0, skipped = 0;
  console.log(`[cargo] starting ${new Date().toISOString()}`);

  const CARGO_PACKAGES = await fetchCargoPackages();
  for (const name of [...CARGO_PACKAGES].sort(() => Math.random() - 0.5)) {
    if (Date.now() - startTime > TIMEOUT) break;
    try {
      const res = await fetch(`https://crates.io/api/v1/crates/${name}`, { headers: { "User-Agent": "prechained.com/1.0" } });
      if (!res.ok) continue;
      const data = await res.json();
      const krate = data.crate;
      if (!krate) continue;
      const allVersions = (data.versions || []).map(v => v.num);
      const pkg = await upsertPackage(name, "cargo", krate.description, krate.newest_version, allVersions.length);
      if (!pkg) continue;
      const { data: existing } = await supabase.from("snapshots").select("version").eq("package_id", pkg.id);
      const seen = new Set((existing || []).map(s => s.version));
      for (const version of allVersions.filter(v => !seen.has(v))) {
        if (Date.now() - startTime > TIMEOUT) break;
        const vData = (data.versions || []).find(v => v.num === version);
        // Fetch dependencies for this specific version
        let cargoDeps = [];
        try {
          const depsRes = await fetch(`https://crates.io/api/v1/crates/${name}/${version}/dependencies`, { headers: { "User-Agent": "prechained.com/1.0" } });
          if (depsRes.ok) {
            const depsData = await depsRes.json();
            cargoDeps = (depsData.dependencies || []).map(d => ({
              name: d.crate_id, requirement: d.req, kind: d.kind, optional: d.optional, default_features: d.default_features
            }));
          }
        } catch(e) {}
        const manifest = {
          name, version, ecosystem: "cargo",
          description: krate.description, license: vData?.license,
          checksum: vData?.checksum, features: vData?.features || {},
          downloads: vData?.downloads, yanked: vData?.yanked || false,
          repository: krate.repository, homepage: krate.homepage,
          keywords: (data.keywords || []).map(k => k.keyword),
          categories: (data.categories || []).map(c => c.category),
          dependencies: cargoDeps,
          authors: krate.exact_match ? [] : (data.crate?.authors || []),
          published_by: vData?.published_by ? { id: vData.published_by.id, login: vData.published_by.login, name: vData.published_by.name || null } : null,
          publishedAt: vData?.created_at || null,
          captured_at: new Date().toISOString(), captured_by: "prechained.com", crawler_sha384: CRAWLER_SHA384
        };
        const ok = await captureVersion(pkg, version, "cargo", vData?.checksum ? "sha256:" + vData.checksum : "", "", vData?.license || "", cargoDeps.map(d => d.name), manifest, CRAWLER_SHA384);
        ok ? captured++ : skipped++;
      }
    } catch(e) { console.error(`[cargo] ${name}:`, e.message); }
  }
  const elapsed = Date.now() - startTime;
  console.log(`[cargo] done: ${captured} captured, ${skipped} skipped, ${elapsed}ms`);
  return new Response(JSON.stringify({ ok: true, ecosystem: "cargo", captured, skipped, elapsed_ms: elapsed, crawler_sha384: CRAWLER_SHA384, timestamp: new Date().toISOString() }), { headers: { "Content-Type": "application/json" } });
}

// ── GITHUB ─────────────────────────────────────────────────────
export async function crawlerGithub(req, context) {
  const startTime = Date.now();
  let captured = 0, skipped = 0;
  console.log(`[github] starting ${new Date().toISOString()}`);

  const btcBlock = await getCurrentBtcBlock();
  const headers = { "Accept": "application/vnd.github.v3+json", "User-Agent": "prechained.com/1.0" };
  if (GITHUB_TOKEN) headers["Authorization"] = "token " + GITHUB_TOKEN;

  const GITHUB_REPOS = await fetchGithubRepos();
  for (const repo of [...GITHUB_REPOS].sort(() => Math.random() - 0.5)) {
    if (Date.now() - startTime > TIMEOUT) break;
    try {
      const [repoRes, commitsRes] = await Promise.all([
        fetch(`https://api.github.com/repos/${repo}`, { headers }),
        fetch(`https://api.github.com/repos/${repo}/commits?per_page=5`, { headers })
      ]);
      if (!repoRes.ok || !commitsRes.ok) continue;
      const repoData = await repoRes.json();
      const commits = await commitsRes.json();
      if (!Array.isArray(commits) || !commits.length) continue;

      for (const commit of commits.slice(0, 5)) {
        if (Date.now() - startTime > TIMEOUT) break;
        const latestSha = commit.sha;
        const version = latestSha.substring(0, 12);
        const pkg = await upsertPackage(repo, "github", repoData.description, version, repoData.size || 1);
        if (!pkg) continue;
        const { data: existing } = await supabase.from("snapshots").select("id").eq("package_id", pkg.id).eq("version", version).single();
        if (existing) { skipped++; continue; }
        const manifest = {
          repo, commit_sha: latestSha, tree_sha: commit.commit?.tree?.sha || "",
          branch: repoData.default_branch || "main", ecosystem: "github",
          description: repoData.description,
          license: repoData.license?.spdx_id || null,
          license_name: repoData.license?.name || null,
          stars: repoData.stargazers_count,
          watchers: repoData.watchers_count,
          forks: repoData.forks_count,
          open_issues: repoData.open_issues_count,
          language: repoData.language,
          topics: repoData.topics || [],
          commit_message: commit.commit?.message?.substring(0, 500),
          commit_author: {
            name: commit.commit?.author?.name,
            email: commit.commit?.author?.email || null,
            date: commit.commit?.author?.date
          },
          commit_committer: {
            name: commit.commit?.committer?.name,
            email: commit.commit?.committer?.email || null,
            date: commit.commit?.committer?.date
          },
          commit_verified: commit.commit?.verification?.verified || false,
          commit_verification_reason: commit.commit?.verification?.reason || null,
          commit_parents: (commit.parents || []).map(p => p.sha),
          github_author_login: commit.author?.login || null,
          github_committer_login: commit.committer?.login || null,
          archived: repoData.archived,
          disabled: repoData.disabled || false,
          visibility: repoData.visibility,
          default_branch: repoData.default_branch,
          pushed_at: repoData.pushed_at,
          created_at: repoData.created_at,
          homepage: repoData.homepage || null,
          size_kb: repoData.size,
          has_wiki: repoData.has_wiki,
          has_issues: repoData.has_issues,
          is_fork: repoData.fork,
          parent_repo: repoData.parent?.full_name || null,
          captured_at: new Date().toISOString(), captured_by: "prechained.com", crawler_sha384: CRAWLER_SHA384
        };
        const payload = JSON.stringify({ repo, commit_sha: latestSha, ecosystem: "github", timestamp: manifest.captured_at });
        const fingerprint = sha384(payload);
        const manifestPath = await storeManifestInGithub("github", repo, version, manifest);
        const { error } = await supabase.from("snapshots").insert({
          package_id: pkg.id, version, ecosystem: "github",
          sha384_fingerprint: fingerprint, receipt_id: generateReceiptId(),
          btc_anchored: btcBlock ? true : false, btc_block: btcBlock || null,
          manifest_path: manifestPath,
          raw_metadata: { commit_sha: latestSha, branch: repoData.default_branch || "main", license: repoData.license?.spdx_id || "", crawler_sha384: CRAWLER_SHA384 }
        });
        if (!error) captured++;
        else skipped++;
      }
    } catch(e) { console.error(`[github] ${repo}:`, e.message); }
  }
  const elapsed = Date.now() - startTime;
  console.log(`[github] done: ${captured} captured, ${skipped} skipped, ${elapsed}ms`);
  return new Response(JSON.stringify({ ok: true, ecosystem: "github", captured, skipped, elapsed_ms: elapsed, crawler_sha384: CRAWLER_SHA384, timestamp: new Date().toISOString() }), { headers: { "Content-Type": "application/json" } });
}

// ── NUGET ──────────────────────────────────────────────────────
export async function crawlerNuget(req, context) {
  const startTime = Date.now();
  let captured = 0, skipped = 0;
  console.log(`[nuget] starting ${new Date().toISOString()}`);

  const NUGET_PACKAGES = await fetchNugetPackages();
  for (const name of [...NUGET_PACKAGES].sort(() => Math.random() - 0.5)) {
    if (Date.now() - startTime > TIMEOUT) break;
    try {
      const res = await fetch(`https://api.nuget.org/v3/registration5-semver1/${name.toLowerCase()}/index.json`);
      if (!res.ok) continue;
      const data = await res.json();
      const items = data.items || [];
      if (!items.length) continue;
      const allVersions = items.flatMap(i => (i.items || []).map(p => p.catalogEntry?.version)).filter(Boolean);
      const latest = allVersions[allVersions.length - 1];
      if (!latest) continue;
      const firstEntry = items[0]?.items?.[0]?.catalogEntry;
      const pkg = await upsertPackage(name, "nuget", firstEntry?.description, latest, allVersions.length);
      if (!pkg) continue;
      const { data: existing } = await supabase.from("snapshots").select("version").eq("package_id", pkg.id);
      const seen = new Set((existing || []).map(s => s.version));
      for (const version of allVersions.filter(v => !seen.has(v))) {
        if (Date.now() - startTime > TIMEOUT) break;
        const entry = items.flatMap(i => i.items || []).find(p => p.catalogEntry?.version === version)?.catalogEntry;
        // Fetch owners for this package (who can publish)
        let nugetOwners = [];
        try {
          const ownersRes = await fetch(`https://api.nuget.org/v3/owners/${name.toLowerCase()}/owners.json`);
          if (ownersRes.ok) {
            const ownersData = await ownersRes.json();
            nugetOwners = Array.isArray(ownersData) ? ownersData : [];
          }
        } catch(e) {}
        // Extract all deps flat
        const nugetDeps = (entry?.dependencyGroups || []).flatMap(g =>
          (g.dependencies || []).map(d => ({ id: d.id, range: d.range, targetFramework: g.targetFramework || null }))
        );
        const manifest = {
          name, version, ecosystem: "nuget",
          description: entry?.description,
          license: entry?.licenseExpression || entry?.licenseUrl || null,
          licenseExpression: entry?.licenseExpression || null,
          authors: entry?.authors ? (typeof entry.authors === "string" ? entry.authors.split(",").map(a => a.trim()) : entry.authors) : [],
          owners: nugetOwners,
          tags: entry?.tags ? (typeof entry.tags === "string" ? entry.tags.split(" ").filter(Boolean) : entry.tags) : [],
          projectUrl: entry?.projectUrl || null,
          repositoryUrl: entry?.repository?.url || null,
          repositoryType: entry?.repository?.type || null,
          repositoryCommit: entry?.repository?.commit || null,
          dependencies: nugetDeps,
          dependencyGroups: entry?.dependencyGroups || [],
          publishedAt: entry?.published || null,
          listed: entry?.listed !== false,
          requireLicenseAcceptance: entry?.requireLicenseAcceptance || false,
          minClientVersion: entry?.minClientVersion || null,
          packageHash: entry?.packageHash || null,
          packageHashAlgorithm: entry?.packageHashAlgorithm || null,
          iconUrl: entry?.iconUrl || null,
          readmeUrl: entry?.readmeUrl || null,
          captured_at: new Date().toISOString(), captured_by: "prechained.com", crawler_sha384: CRAWLER_SHA384
        };
        const ok = await captureVersion(pkg, version, "nuget", entry?.packageHash || "", "", entry?.licenseExpression || "", nugetDeps.map(d => d.id), manifest, CRAWLER_SHA384);
        ok ? captured++ : skipped++;
      }
    } catch(e) { console.error(`[nuget] ${name}:`, e.message); }
  }
  const elapsed = Date.now() - startTime;
  console.log(`[nuget] done: ${captured} captured, ${skipped} skipped, ${elapsed}ms`);
  return new Response(JSON.stringify({ ok: true, ecosystem: "nuget", captured, skipped, elapsed_ms: elapsed, crawler_sha384: CRAWLER_SHA384, timestamp: new Date().toISOString() }), { headers: { "Content-Type": "application/json" } });
}

// ── MAVEN ──────────────────────────────────────────────────────
export async function crawlerMaven(req, context) {
  const startTime = Date.now();
  let captured = 0, skipped = 0;
  console.log(`[maven] starting ${new Date().toISOString()}`);

  const MAVEN_PACKAGES = await fetchMavenPackages();
  for (const artifact of [...MAVEN_PACKAGES].sort(() => Math.random() - 0.5)) {
    if (Date.now() - startTime > TIMEOUT) break;
    try {
      const [groupId, artifactId] = artifact.split(":");
      if (!groupId || !artifactId) continue;
      const res = await fetch(`https://search.maven.org/solrsearch/select?q=g:"${groupId}"+AND+a:"${artifactId}"&core=gav&rows=50&wt=json`);
      if (!res.ok) continue;
      const data = await res.json();
      const docs = data.response?.docs || [];
      if (!docs.length) continue;
      const allVersions = docs.map(d => d.v).filter(Boolean);
      const latest = allVersions[0];
      if (!latest) continue;
      const pkg = await upsertPackage(artifact, "maven", `${groupId}:${artifactId}`, latest, allVersions.length);
      if (!pkg) continue;
      const { data: existing } = await supabase.from("snapshots").select("version").eq("package_id", pkg.id);
      const seen = new Set((existing || []).map(s => s.version));
      for (const version of allVersions.filter(v => !seen.has(v))) {
        if (Date.now() - startTime > TIMEOUT) break;
        const doc = docs.find(d => d.v === version) || {};
        // Fetch POM for full metadata — developers, scm, dependencies, licenses
        let pomData = {};
        try {
          const groupPath = groupId.replace(/\./g, "/");
          const pomRes = await fetch(`https://repo1.maven.org/maven2/${groupPath}/${artifactId}/${version}/${artifactId}-${version}.pom`);
          if (pomRes.ok) {
            const pomText = await pomRes.text();
            // Parse key POM fields from XML
            const extractTag = (xml, tag) => { const m = xml.match(new RegExp(`<${tag}[^>]*>([\s\S]*?)<\/${tag}>`, "i")); return m ? m[1].trim() : null; };
            const extractAll = (xml, tag) => { const r = []; const re = new RegExp(`<${tag}[^>]*>([\s\S]*?)<\/${tag}>`, "gi"); let m; while ((m = re.exec(xml)) !== null) r.push(m[1].trim()); return r; };
            const devSection = extractTag(pomText, "developers");
            const licSection = extractTag(pomText, "licenses");
            const depsSection = extractTag(pomText, "dependencies");
            const scmSection = extractTag(pomText, "scm");
            pomData = {
              description: extractTag(pomText, "description"),
              url: extractTag(pomText, "url"),
              inceptionYear: extractTag(pomText, "inceptionYear"),
              licenses: licSection ? extractAll(licSection, "license").map(l => ({
                name: extractTag(l, "name"), url: extractTag(l, "url"), distribution: extractTag(l, "distribution")
              })) : [],
              developers: devSection ? extractAll(devSection, "developer").map(d => ({
                id: extractTag(d, "id"), name: extractTag(d, "name"), email: extractTag(d, "email"),
                organization: extractTag(d, "organization"), roles: extractAll(extractTag(d, "roles") || "", "role")
              })) : [],
              scm: scmSection ? {
                connection: extractTag(scmSection, "connection"),
                developerConnection: extractTag(scmSection, "developerConnection"),
                url: extractTag(scmSection, "url"),
                tag: extractTag(scmSection, "tag")
              } : null,
              dependencies: depsSection ? extractAll(depsSection, "dependency").map(d => ({
                groupId: extractTag(d, "groupId"), artifactId: extractTag(d, "artifactId"),
                version: extractTag(d, "version"), scope: extractTag(d, "scope") || "compile",
                optional: extractTag(d, "optional") === "true"
              })) : []
            };
          }
        } catch(e) {}
        const manifest = {
          groupId, artifactId, version, ecosystem: "maven",
          id: doc.id,
          publishedAt: doc.timestamp ? new Date(doc.timestamp).toISOString() : null,
          packaging: doc.p || "jar",
          availableFiles: doc.ec || [],
          description: pomData.description || null,
          url: pomData.url || null,
          inceptionYear: pomData.inceptionYear || null,
          licenses: pomData.licenses || [],
          developers: pomData.developers || [],
          scm: pomData.scm || null,
          dependencies: pomData.dependencies || [],
          centralUrl: `https://repo1.maven.org/maven2/${groupId.replace(/\./g,"/")}/${artifactId}/${version}/`,
          captured_at: new Date().toISOString(), captured_by: "prechained.com", crawler_sha384: CRAWLER_SHA384
        };
        const ok = await captureVersion(pkg, version, "maven", "", "", pomData.licenses?.[0]?.name || "", (pomData.dependencies || []).map(d => `${d.groupId}:${d.artifactId}`), manifest, CRAWLER_SHA384);
        ok ? captured++ : skipped++;
      }
    } catch(e) { console.error(`[maven] ${artifact}:`, e.message); }
  }
  const elapsed = Date.now() - startTime;
  console.log(`[maven] done: ${captured} captured, ${skipped} skipped, ${elapsed}ms`);
  return new Response(JSON.stringify({ ok: true, ecosystem: "maven", captured, skipped, elapsed_ms: elapsed, crawler_sha384: CRAWLER_SHA384, timestamp: new Date().toISOString() }), { headers: { "Content-Type": "application/json" } });
}

// ── RUBYGEMS ───────────────────────────────────────────────────
export async function crawlerRubygems(req, context) {
  const startTime = Date.now();
  let captured = 0, skipped = 0;
  console.log(`[rubygems] starting ${new Date().toISOString()}`);

  const RUBYGEMS_PACKAGES = await fetchRubygemsPackages();
  for (const name of [...RUBYGEMS_PACKAGES].sort(() => Math.random() - 0.5)) {
    if (Date.now() - startTime > TIMEOUT) break;
    try {
      const [gemRes, versionsRes] = await Promise.all([
        fetch(`https://rubygems.org/api/v1/gems/${name}.json`),
        fetch(`https://rubygems.org/api/v1/versions/${name}.json`)
      ]);
      if (!gemRes.ok || !versionsRes.ok) continue;
      const gemData = await gemRes.json();
      const versions = await versionsRes.json();
      if (!Array.isArray(versions)) continue;
      const latest = gemData.version;
      if (!latest) continue;
      const allVersions = versions.map(v => v.number).filter(Boolean);
      const pkg = await upsertPackage(name, "rubygems", gemData.info, latest, allVersions.length);
      if (!pkg) continue;
      const { data: existing } = await supabase.from("snapshots").select("version").eq("package_id", pkg.id);
      const seen = new Set((existing || []).map(s => s.version));
      for (const version of allVersions.filter(v => !seen.has(v))) {
        if (Date.now() - startTime > TIMEOUT) break;
        const vData = versions.find(v => v.number === version);
        // Fetch owners — who has push rights to this gem
        let gemOwners = [];
        try {
          const ownersRes = await fetch(`https://rubygems.org/api/v1/gems/${name}/owners.json`);
          if (ownersRes.ok) gemOwners = await ownersRes.json();
        } catch(e) {}
        const manifest = {
          name, version, ecosystem: "rubygems",
          description: gemData.info,
          licenses: vData?.licenses || [],
          sha: vData?.sha,
          gem_uri: vData?.gem_uri || `https://rubygems.org/gems/${name}-${version}.gem`,
          spec_sha: vData?.spec_sha || null,
          created_at: vData?.created_at,
          publishedAt: vData?.created_at || null,
          prerelease: vData?.prerelease || false,
          platform: vData?.platform || "ruby",
          yanked: vData?.yanked || false,
          dependencies: {
            runtime: (vData?.dependencies?.runtime || []).map(d => ({ name: d.name, requirements: d.requirements })),
            development: (vData?.dependencies?.development || []).map(d => ({ name: d.name, requirements: d.requirements }))
          },
          authors: gemData.authors,
          owners: gemOwners.map(o => ({ id: o.id, handle: o.handle, email: o.email || null, mfa_level: o.mfa_level || null })),
          homepage_uri: gemData.homepage_uri,
          source_code_uri: gemData.source_code_uri,
          changelog_uri: gemData.changelog_uri || null,
          funding_uri: gemData.funding_uri || null,
          bug_tracker_uri: gemData.bug_tracker_uri || null,
          mailing_list_uri: gemData.mailing_list_uri || null,
          documentation_uri: gemData.documentation_uri || null,
          downloads: gemData.downloads,
          version_downloads: vData?.downloads_count || null,
          captured_at: new Date().toISOString(), captured_by: "prechained.com", crawler_sha384: CRAWLER_SHA384
        };
        const ok = await captureVersion(pkg, version, "rubygems", vData?.sha ? "sha256:" + vData.sha : "", "", vData?.licenses?.[0] || "", [], manifest, CRAWLER_SHA384);
        ok ? captured++ : skipped++;
      }
    } catch(e) { console.error(`[rubygems] ${name}:`, e.message); }
  }
  const elapsed = Date.now() - startTime;
  console.log(`[rubygems] done: ${captured} captured, ${skipped} skipped, ${elapsed}ms`);
  return new Response(JSON.stringify({ ok: true, ecosystem: "rubygems", captured, skipped, elapsed_ms: elapsed, crawler_sha384: CRAWLER_SHA384, timestamp: new Date().toISOString() }), { headers: { "Content-Type": "application/json" } });
}

// ── PACKAGIST ──────────────────────────────────────────────────
export async function crawlerPackagist(req, context) {
  const startTime = Date.now();
  let captured = 0, skipped = 0;
  console.log(`[packagist] starting ${new Date().toISOString()}`);

  const PACKAGIST_PACKAGES = await fetchPackagistPackages();
  for (const name of [...PACKAGIST_PACKAGES].sort(() => Math.random() - 0.5)) {
    if (Date.now() - startTime > TIMEOUT) break;
    try {
      const res = await fetch(`https://packagist.org/packages/${name}.json`);
      if (!res.ok) continue;
      const data = await res.json();
      const pkg_data = data.package;
      if (!pkg_data) continue;
      const allVersions = Object.keys(pkg_data.versions || {}).filter(v => !v.includes("dev") && !v.includes("alpha") && !v.includes("beta"));
      if (!allVersions.length) continue;
      const latest = allVersions[0].replace(/^v/, "");
      const firstVersion = pkg_data.versions[allVersions[0]];
      const pkg = await upsertPackage(name, "packagist", firstVersion?.description || "", latest, allVersions.length);
      if (!pkg) continue;
      const { data: existing } = await supabase.from("snapshots").select("version").eq("package_id", pkg.id);
      const seen = new Set((existing || []).map(s => s.version));
      for (const version of allVersions.filter(v => !seen.has(v.replace(/^v/, "")))) {
        if (Date.now() - startTime > TIMEOUT) break;
        const vData = pkg_data.versions[version];
        const cleanVersion = version.replace(/^v/, "");
        const manifest = {
          name, version: cleanVersion, ecosystem: "packagist",
          description: vData?.description, license: vData?.license?.[0],
          licenses: vData?.license || [], type: vData?.type,
          require: vData?.require || {}, require_dev: vData?.require_dev || {},
          dist: vData?.dist || {}, source: vData?.source || {},
          authors: vData?.authors || [],
          maintainers: pkg_data.maintainers || [],
          homepage: vData?.homepage,
          keywords: vData?.keywords || [],
          publishedAt: vData?.time || null,
          github_stars: pkg_data.github_stars || null,
          github_watchers: pkg_data.github_watchers || null,
          github_forks: pkg_data.github_forks || null,
          abandoned: pkg_data.abandoned || false,
          captured_at: new Date().toISOString(), captured_by: "prechained.com", crawler_sha384: CRAWLER_SHA384
        };
        const ok = await captureVersion(pkg, cleanVersion, "packagist", vData?.dist?.shasum ? "sha1:" + vData.dist.shasum : "", "", vData?.license?.[0] || "", Object.keys(vData?.require || {}), manifest, CRAWLER_SHA384);
        ok ? captured++ : skipped++;
      }
    } catch(e) { console.error(`[packagist] ${name}:`, e.message); }
  }
  const elapsed = Date.now() - startTime;
  console.log(`[packagist] done: ${captured} captured, ${skipped} skipped, ${elapsed}ms`);
  return new Response(JSON.stringify({ ok: true, ecosystem: "packagist", captured, skipped, elapsed_ms: elapsed, crawler_sha384: CRAWLER_SHA384, timestamp: new Date().toISOString() }), { headers: { "Content-Type": "application/json" } });
}

// ── DEFAULT EXPORT (scheduled cron + manual HTTP trigger) ─────
export default async function handler(req, context) {
  const isScheduled = !req?.url;

  if (isScheduled) {
    // Cron trigger — run directly, full timeout budget available
    await Promise.allSettled([
      crawlerNpm(req, context), crawlerPypi(req, context), crawlerCargo(req, context),
      crawlerGithub(req, context), crawlerNuget(req, context), crawlerMaven(req, context),
      crawlerRubygems(req, context), crawlerPackagist(req, context)
    ]);
    return new Response(JSON.stringify({ ok: true, crawler_sha384: CRAWLER_SHA384, timestamp: new Date().toISOString() }), { headers: { "Content-Type": "application/json" } });
  }

  // HTTP trigger — return immediately, run crawlers in background via waitUntil
  // Prevents 10-second HTTP timeout when triggered manually from browser
  context.waitUntil(
    Promise.allSettled([
      crawlerNpm(req, context), crawlerPypi(req, context), crawlerCargo(req, context),
      crawlerGithub(req, context), crawlerNuget(req, context), crawlerMaven(req, context),
      crawlerRubygems(req, context), crawlerPackagist(req, context)
    ])
  );
  return new Response(JSON.stringify({ ok: true, started: true, crawler_sha384: CRAWLER_SHA384, timestamp: new Date().toISOString() }), { headers: { "Content-Type": "application/json" } });
}
