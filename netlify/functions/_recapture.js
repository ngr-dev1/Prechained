// _recapture.js — Honest manifest reconstruction for backfill/audit.
// prechained.com · Built by NextGenRails™
//
// The full manifest for a snapshot only ever lived in the GitHub archive; the
// Supabase row keeps just the fingerprint + a stub raw_metadata. For rows whose
// archive write failed (manifest_path IS NULL) the content is gone, so the only
// honest recovery is to RE-FETCH the manifest from the source registry, rebuild
// it byte-for-byte the way the crawler did, recompute the canonical fingerprint,
// and accept it ONLY if it reproduces the stored sha384_fingerprint.
//
// CRITICAL: these builders mirror crawler-all.js EXACTLY — same fields, same
// quirks (see maven's POM regex). The point is reproduction, not improvement.
// Because the result is gated on an exact fingerprint match, any imperfect
// reconstruction simply fails the gate and is never archived. The archive can
// therefore never be corrupted by this path; the worst case is under-recovery.

import { canonicalFingerprint } from "./_shared.js";

const JSON_HEADERS = { "Accept": "application/json" };
const UA = { "User-Agent": "prechained.com/1.0" };

// Ecosystems whose crawler baked volatile popularity/owner/download data into
// the hashed manifest. They will rarely re-verify; flagged here for reporting.
export const LOW_YIELD = new Set(["cargo", "rubygems", "packagist"]);
export const UNRECOVERABLE = new Set(["github"]);

async function getJson(url, headers = JSON_HEADERS) {
  const r = await fetch(url, { headers });
  if (!r.ok) return null;
  return r.json().catch(() => null);
}

// ── npm ────────────────────────────────────────────────────────
async function buildNpm(name, version) {
  const data = await getJson(`https://registry.npmjs.org/${encodeURIComponent(name)}`);
  if (!data) return { manifest: null, reason: "unfetchable" };
  const vd = data.versions?.[version];
  if (!vd) return { manifest: null, reason: "version-gone" };
  return { manifest: {
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
    captured_at: null, captured_by: "prechained.com", crawler_sha384: null
  }};
}

// ── pypi ───────────────────────────────────────────────────────
// NOTE: the crawler hashed the package-level `info` block (latest release) for
// every version, so any newer release shifts the hash for ALL versions.
async function buildPypi(name, version) {
  const data = await getJson(`https://pypi.org/pypi/${name}/json`);
  if (!data) return { manifest: null, reason: "unfetchable" };
  const files = data.releases?.[version] || [];
  if (!files.length) return { manifest: null, reason: "version-gone" };
  const wheel = files.find(f => f.packagetype === "bdist_wheel") || files[0];
  return { manifest: {
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
    captured_at: null, captured_by: "prechained.com", crawler_sha384: null
  }};
}

// ── cargo ──────────────────────────────────────────────────────
// LOW YIELD: `downloads` drifts every crawl, so this rarely re-verifies.
async function buildCargo(name, version) {
  const data = await getJson(`https://crates.io/api/v1/crates/${name}`, { ...JSON_HEADERS, ...UA });
  if (!data?.crate) return { manifest: null, reason: "unfetchable" };
  const vData = (data.versions || []).find(v => v.num === version);
  if (!vData) return { manifest: null, reason: "version-gone" };
  let cargoDeps = [];
  const depsData = await getJson(`https://crates.io/api/v1/crates/${name}/${version}/dependencies`, { ...JSON_HEADERS, ...UA });
  if (depsData) cargoDeps = (depsData.dependencies || []).map(d => ({
    name: d.crate_id, requirement: d.req, kind: d.kind, optional: d.optional, default_features: d.default_features
  }));
  return { manifest: {
    name, version, ecosystem: "cargo",
    description: data.crate.description, license: vData?.license,
    checksum: vData?.checksum, features: vData?.features || {},
    downloads: vData?.downloads, yanked: vData?.yanked || false,
    repository: data.crate.repository, homepage: data.crate.homepage,
    keywords: (data.keywords || []).map(k => k.keyword),
    categories: (data.categories || []).map(c => c.category),
    dependencies: cargoDeps,
    authors: data.crate.exact_match ? [] : (data.crate?.authors || []),
    published_by: vData?.published_by ? { id: vData.published_by.id, login: vData.published_by.login, name: vData.published_by.name || null } : null,
    publishedAt: vData?.created_at || null,
    captured_at: null, captured_by: "prechained.com", crawler_sha384: null
  }};
}

// ── nuget ──────────────────────────────────────────────────────
async function buildNuget(name, version) {
  const lower = name.toLowerCase();
  const data = await getJson(`https://api.nuget.org/v3/registration5-semver1/${lower}/index.json`);
  if (!data) return { manifest: null, reason: "unfetchable" };
  const items = data.items || [];
  const entry = items.flatMap(i => i.items || []).find(p => p.catalogEntry?.version === version)?.catalogEntry;
  if (!entry) return { manifest: null, reason: "version-gone" };
  let nugetOwners = [];
  const ownersData = await getJson(`https://api.nuget.org/v3/owners/${lower}/owners.json`);
  if (Array.isArray(ownersData)) nugetOwners = ownersData;
  const nugetDeps = (entry?.dependencyGroups || []).flatMap(g =>
    (g.dependencies || []).map(d => ({ id: d.id, range: d.range, targetFramework: g.targetFramework || null }))
  );
  return { manifest: {
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
    captured_at: null, captured_by: "prechained.com", crawler_sha384: null
  }};
}

// ── maven ──────────────────────────────────────────────────────
// The POM extract helpers below intentionally reproduce the crawler's behaviour
// EXACTLY, including the template-literal escaping that turns [\s\S] into [sS].
// Changing them would alter the hashed bytes and break verification.
function mavenExtractTag(xml, tag) { const m = xml.match(new RegExp(`<${tag}[^>]*>([\s\S]*?)<\/${tag}>`, "i")); return m ? m[1].trim() : null; }
function mavenExtractAll(xml, tag) { const r = []; const re = new RegExp(`<${tag}[^>]*>([\s\S]*?)<\/${tag}>`, "gi"); let m; while ((m = re.exec(xml)) !== null) r.push(m[1].trim()); return r; }

async function buildMaven(artifact, version) {
  const [groupId, artifactId] = artifact.split(":");
  if (!groupId || !artifactId) return { manifest: null, reason: "bad-coordinate" };
  const doc = (await getJson(`https://search.maven.org/solrsearch/select?q=g:"${groupId}"+AND+a:"${artifactId}"+AND+v:"${version}"&core=gav&rows=20&wt=json`))?.response?.docs?.[0]
    || (await getJson(`https://search.maven.org/solrsearch/select?q=g:"${groupId}"+AND+a:"${artifactId}"&core=gav&rows=50&wt=json`))?.response?.docs?.find(d => d.v === version);
  if (!doc) return { manifest: null, reason: "version-gone" };
  let pomData = {};
  try {
    const groupPath = groupId.replace(/\./g, "/");
    const pomRes = await fetch(`https://repo1.maven.org/maven2/${groupPath}/${artifactId}/${version}/${artifactId}-${version}.pom`);
    if (pomRes.ok) {
      const pomText = await pomRes.text();
      const devSection = mavenExtractTag(pomText, "developers");
      const licSection = mavenExtractTag(pomText, "licenses");
      const depsSection = mavenExtractTag(pomText, "dependencies");
      const scmSection = mavenExtractTag(pomText, "scm");
      pomData = {
        description: mavenExtractTag(pomText, "description"),
        url: mavenExtractTag(pomText, "url"),
        inceptionYear: mavenExtractTag(pomText, "inceptionYear"),
        licenses: licSection ? mavenExtractAll(licSection, "license").map(l => ({
          name: mavenExtractTag(l, "name"), url: mavenExtractTag(l, "url"), distribution: mavenExtractTag(l, "distribution")
        })) : [],
        developers: devSection ? mavenExtractAll(devSection, "developer").map(d => ({
          id: mavenExtractTag(d, "id"), name: mavenExtractTag(d, "name"), email: mavenExtractTag(d, "email"),
          organization: mavenExtractTag(d, "organization"), roles: mavenExtractAll(mavenExtractTag(d, "roles") || "", "role")
        })) : [],
        scm: scmSection ? {
          connection: mavenExtractTag(scmSection, "connection"),
          developerConnection: mavenExtractTag(scmSection, "developerConnection"),
          url: mavenExtractTag(scmSection, "url"),
          tag: mavenExtractTag(scmSection, "tag")
        } : null,
        dependencies: depsSection ? mavenExtractAll(depsSection, "dependency").map(d => ({
          groupId: mavenExtractTag(d, "groupId"), artifactId: mavenExtractTag(d, "artifactId"),
          version: mavenExtractTag(d, "version"), scope: mavenExtractTag(d, "scope") || "compile",
          optional: mavenExtractTag(d, "optional") === "true"
        })) : []
      };
    }
  } catch (e) {}
  return { manifest: {
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
    captured_at: null, captured_by: "prechained.com", crawler_sha384: null
  }};
}

// ── rubygems ───────────────────────────────────────────────────
// LOW YIELD: `downloads` and `version_downloads` drift every crawl.
async function buildRubygems(name, version) {
  const [gemData, versions] = await Promise.all([
    getJson(`https://rubygems.org/api/v1/gems/${name}.json`),
    getJson(`https://rubygems.org/api/v1/versions/${name}.json`)
  ]);
  if (!gemData || !Array.isArray(versions)) return { manifest: null, reason: "unfetchable" };
  const vData = versions.find(v => v.number === version);
  if (!vData) return { manifest: null, reason: "version-gone" };
  let gemOwners = [];
  const ownersData = await getJson(`https://rubygems.org/api/v1/gems/${name}/owners.json`);
  if (Array.isArray(ownersData)) gemOwners = ownersData;
  return { manifest: {
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
    captured_at: null, captured_by: "prechained.com", crawler_sha384: null
  }};
}

// ── packagist ──────────────────────────────────────────────────
// LOW YIELD: github_stars/watchers/forks drift constantly.
async function buildPackagist(name, version) {
  const data = await getJson(`https://packagist.org/packages/${name}.json`);
  const pkg_data = data?.package;
  if (!pkg_data) return { manifest: null, reason: "unfetchable" };
  // The crawler stores cleanVersion but keys pkg_data.versions by the raw tag.
  const rawKey = Object.keys(pkg_data.versions || {}).find(k => k.replace(/^v/, "") === String(version).replace(/^v/, ""));
  const vData = rawKey ? pkg_data.versions[rawKey] : null;
  if (!vData) return { manifest: null, reason: "version-gone" };
  const cleanVersion = String(version).replace(/^v/, "");
  return { manifest: {
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
    captured_at: null, captured_by: "prechained.com", crawler_sha384: null
  }};
}

// ── dispatcher ─────────────────────────────────────────────────
export async function buildManifest(ecosystem, name, version) {
  try {
    switch (ecosystem) {
      case "npm": return await buildNpm(name, version);
      case "pypi": return await buildPypi(name, version);
      case "cargo": return await buildCargo(name, version);
      case "nuget": return await buildNuget(name, version);
      case "maven": return await buildMaven(name, version);
      case "rubygems": return await buildRubygems(name, version);
      case "packagist": return await buildPackagist(name, version);
      case "github": return { manifest: null, reason: "github-unrecoverable" };
      default: return { manifest: null, reason: "unsupported-ecosystem" };
    }
  } catch (e) {
    return { manifest: null, reason: `fetch-error:${e.message}` };
  }
}

// Reconstruct + verify against the stored fingerprint.
// Returns one of:
//   { status:"verified",  manifest, computedFp }   ← safe to archive
//   { status:"mismatch",  computedFp }              ← do NOT archive
//   { status:"unfetchable" | "github-unrecoverable" | "unsupported-ecosystem" | ... }
export async function recaptureAndVerify({ ecosystem, name, version, storedFingerprint }) {
  if (UNRECOVERABLE.has(ecosystem)) return { status: "github-unrecoverable" };
  const { manifest, reason } = await buildManifest(ecosystem, name, version);
  if (!manifest) return { status: reason || "unfetchable" };
  const computedFp = canonicalFingerprint(manifest);
  if (computedFp === storedFingerprint) return { status: "verified", manifest, computedFp };
  return { status: "mismatch", computedFp };
}
