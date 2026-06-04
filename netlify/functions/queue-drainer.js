// queue-drainer.js — Capture Queue Drainer
// Runs every few minutes. Claims a batch of pending (package, version) rows
// from `pending_captures`, fetches the real manifest for each, fingerprints +
// stores it via the shared captureVersion(), batch-stamps the whole run's
// fingerprints with OpenTimestamps (one Merkle root), then marks rows done.
// Whatever doesn't finish in the 8.5s budget stays 'pending' and is
// picked up next run — so the firehose is drained in slices, nothing dropped.
//
// This is the half of the pipeline that the old design was missing: the
// crawler discovered fast but tried to capture inline and silently dropped
// everything past ~40 packages. Now discovery (crawler-new) and capture
// (this) are decoupled through a durable queue.
// prechained.com · Built by NextGenRails™

import {
  supabase, upsertPackage, captureVersion,
  claimCaptures, finishCapture, requeueStale, snapshotExists,
  sha384, canonicalFingerprint, storeManifestInGithub
} from "./_shared.js";
import { runDetectors } from "./_detectors.js";

const TIMEOUT = 8500;
const BATCH = 60;   // claim this many per run; drain as many as time allows

// ── XZ-STYLE DIFF DETECTION ───────────────────────────────────
// If a version we already archived reappears with a different fingerprint,
// that's content substitution under a fixed version string — flag it HIGH.
// Fetch the existing snapshot for an exact package+version, returning the
// stored canonical fingerprint and receipt so we can compare against a fresh
// capture. Returns null if none exists yet.
async function getSnapshotForVersion(pkgId, version) {
  const { data } = await supabase
    .from("snapshots")
    .select("id, sha384_fingerprint, receipt_id, captured_at, raw_metadata")
    .eq("package_id", pkgId).eq("version", version)
    .limit(1).maybeSingle();
  return data || null;
}

// Record a same-version substitution: the manifest changed under a fixed
// version string. We do NOT insert a second snapshot row (that would collide
// with the package+version uniqueness and muddy the archive). Instead we flag
// the EXISTING row with a mutation alert that carries the new fingerprint as
// evidence, preserving the original receipt while making the change provable.
// The new manifest is archived to GitHub so the changed content is itself
// retained and independently checkable.
async function recordSameVersionMutation(pkgId, pkgName, ecosystem, version, existingSnap, newFingerprint, newManifest) {
  try {
    const msg = `FINGERPRINT MISMATCH: ${ecosystem}/${pkgName}@${version} ` +
      `stored=${existingSnap.sha384_fingerprint.slice(0,16)}… new=${newFingerprint.slice(0,16)}… — same version, changed manifest (XZ-style substitution)`;
    console.error(`[DIFF-ALERT] ${msg}`);

    // Archive the changed manifest so the new content is retained for inspection.
    let changedManifestPath = null;
    try {
      changedManifestPath = await storeManifestInGithub(
        ecosystem, pkgName, `${version}__mutation-${newFingerprint.slice(0,12)}`, newManifest
      );
    } catch (e) { console.error("[DIFF-ARCHIVE] failed:", e.message); }

    // Flag the actor index.
    await supabase.from("actor_index").update({ flagged: true })
      .eq("package_name", pkgName).eq("ecosystem", ecosystem);

    // MERGE the mutation alert into the existing row's raw_metadata.
    const merged = {
      ...(existingSnap.raw_metadata || {}),
      diff_alert: true,
      alert_type: "FINGERPRINT_MISMATCH",
      alert_severity: "HIGH",
      alert_detail: msg,
      // The ORIGINAL stored fingerprint is the "prior"; the freshly observed
      // one is the change. We store the observed change as evidence on the
      // original row, keeping the original receipt as the anchor of record.
      observed_changed_fingerprint: newFingerprint,
      observed_changed_at: new Date().toISOString(),
      observed_changed_manifest_path: changedManifestPath,
      prior_fingerprint: existingSnap.sha384_fingerprint,
      prior_receipt_id: existingSnap.receipt_id,
      prior_captured_at: existingSnap.captured_at,
    };
    await supabase.from("snapshots").update({ raw_metadata: merged }).eq("id", existingSnap.id);
  } catch (e) {
    console.error("[DIFF-DETECT same-version] error:", e.message);
  }
}

async function checkFingerprintDiff(pkgId, pkgName, ecosystem, version, newFingerprint) {
  if (!newFingerprint) return;
  try {
    const { data: prior } = await supabase
      .from("snapshots")
      .select("id, sha384_fingerprint, receipt_id, captured_at")
      .eq("package_id", pkgId).eq("version", version)
      .neq("sha384_fingerprint", newFingerprint).limit(1);
    if (!prior || !prior.length) return;

    const p = prior[0];
    const msg = `FINGERPRINT MISMATCH: ${ecosystem}/${pkgName}@${version} ` +
      `prior=${p.sha384_fingerprint.slice(0,16)}… new=${newFingerprint.slice(0,16)}… — XZ-style substitution`;
    console.error(`[DIFF-ALERT] ${msg}`);

    await supabase.from("actor_index").update({ flagged: true })
      .eq("package_name", pkgName).eq("ecosystem", ecosystem);

    const { data: newSnap } = await supabase
      .from("snapshots").select("id, raw_metadata")
      .eq("package_id", pkgId).eq("version", version)
      .eq("sha384_fingerprint", newFingerprint).limit(1).maybeSingle();
    if (newSnap?.id) {
      // MERGE into existing raw_metadata — never overwrite. Overwriting would
      // wipe the fp:"v2" marker and crawler_sha384 that captureVersion set,
      // which would silently disqualify the row from OTS anchoring.
      const merged = {
        ...(newSnap.raw_metadata || {}),
        diff_alert: true, prior_fingerprint: p.sha384_fingerprint,
        prior_receipt_id: p.receipt_id, prior_captured_at: p.captured_at,
        alert_type: "FINGERPRINT_MISMATCH", alert_severity: "HIGH", alert_detail: msg
      };
      await supabase.from("snapshots").update({ raw_metadata: merged }).eq("id", newSnap.id);
    }
  } catch (e) { console.error("[DIFF-DETECT] error:", e.message); }
}

// ── PER-ECOSYSTEM MANIFEST FETCH ──────────────────────────────
// Each returns { manifest, integrity, shasum, license, dependencies } or null.
const FETCHERS = {
  async npm(name, version) {
    const r = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`);
    if (!r.ok) return null;
    const d = await r.json();
    const vd = d.versions?.[version];
    if (!vd) return null;
    return {
      integrity: vd.dist?.integrity, shasum: vd.dist?.shasum, license: vd.license,
      dependencies: Object.keys(vd.dependencies || {}),
      manifest: {
        name, version, ecosystem: "npm", description: d.description, license: vd.license,
        dependencies: vd.dependencies || {}, devDependencies: vd.devDependencies || {},
        scripts: {
          install: vd.scripts?.install || null, preinstall: vd.scripts?.preinstall || null,
          postinstall: vd.scripts?.postinstall || null, prepare: vd.scripts?.prepare || null
        },
        maintainers: (vd.maintainers || d.maintainers || []).map(m => ({ name: m.name, email: m.email || null })),
        author: vd.author || d.author || null, publishedAt: d.time?.[version] || null,
        dist: { integrity: vd.dist?.integrity, shasum: vd.dist?.shasum, tarball: vd.dist?.tarball,
                fileCount: vd.dist?.fileCount || null, unpackedSize: vd.dist?.unpackedSize || null },
        _npmUser: vd._npmUser ? { name: vd._npmUser.name, email: vd._npmUser.email || null } : null
      }
    };
  },

  async pypi(name, version) {
    const r = await fetch(`https://pypi.org/pypi/${name}/${version}/json`);
    if (!r.ok) return null;
    const d = await r.json();
    const files = d.urls || [];
    const wheel = files.find(f => f.packagetype === "bdist_wheel") || files[0];
    return {
      integrity: wheel?.digests?.sha256 ? "sha256:" + wheel.digests.sha256 : "",
      shasum: "", license: d.info?.license,
      dependencies: d.info?.requires_dist || [],
      manifest: {
        name, version, ecosystem: "pypi", summary: d.info?.summary, license: d.info?.license,
        author: d.info?.author, author_email: d.info?.author_email || null,
        requires_python: d.info?.requires_python, requires_dist: d.info?.requires_dist || [],
        yanked: d.info?.yanked || false, yanked_reason: d.info?.yanked_reason || null,
        publishedAt: wheel?.upload_time || null,
        dist: { url: wheel?.url, sha256: wheel?.digests?.sha256, size: wheel?.size, filename: wheel?.filename }
      }
    };
  },

  async cargo(name, version) {
    const r = await fetch(`https://crates.io/api/v1/crates/${name}/${version}`, {
      headers: { "User-Agent": "prechained.com/1.0" }
    });
    if (!r.ok) return null;
    const d = await r.json();
    const v = d.version;
    if (!v) return null;
    let deps = [];
    try {
      const dr = await fetch(`https://crates.io/api/v1/crates/${name}/${version}/dependencies`, {
        headers: { "User-Agent": "prechained.com/1.0" }
      });
      if (dr.ok) deps = ((await dr.json()).dependencies || []).map(x => x.crate_id);
    } catch (e) {}
    return {
      integrity: v.checksum ? "sha256:" + v.checksum : "", shasum: "", license: v.license,
      dependencies: deps,
      manifest: {
        name, version, ecosystem: "cargo", license: v.license, checksum: v.checksum,
        features: v.features || {}, yanked: v.yanked || false,
        published_by: v.published_by ? { id: v.published_by.id, login: v.published_by.login } : null,
        publishedAt: v.created_at || null, dependencies: deps
      }
    };
  },

  async packagist(name, version) {
    const r = await fetch(`https://packagist.org/packages/${name}.json`);
    if (!r.ok) return null;
    const d = await r.json();
    const info = d.package;
    // Packagist version keys can be "v1.2.3" or "dev-branch/name". Match either
    // the raw key or its v-stripped form against what we were asked to capture.
    const versions = info?.versions || {};
    let key = Object.keys(versions).find(k => k === version || k.replace(/^v/, "") === version);
    if (!key) return null;
    const vd = versions[key];
    return {
      integrity: vd?.dist?.shasum ? "sha1:" + vd.dist.shasum : "",
      shasum: "", license: vd?.license?.[0] || "",
      dependencies: Object.keys(vd?.require || {}),
      manifest: {
        name, version, ecosystem: "packagist", description: vd?.description,
        license: vd?.license || [], type: vd?.type, require: vd?.require || {},
        require_dev: vd?.require_dev || {}, dist: vd?.dist || {}, source: vd?.source || {},
        authors: vd?.authors || [], maintainers: info?.maintainers || [],
        is_dev_branch: key.startsWith("dev-") || key.includes("dev-"),
        branch_alias: vd?.extra?.["branch-alias"] || null,
        publishedAt: vd?.time || null
      }
    };
  },

  async nuget(name, version) {
    // Catalog entry for this specific version.
    const r = await fetch(`https://api.nuget.org/v3/registration5-semver1/${name.toLowerCase()}/index.json`);
    if (!r.ok) return null;
    const d = await r.json();
    const entry = (d.items || []).flatMap(i => i.items || [])
      .find(p => p.catalogEntry?.version === version)?.catalogEntry;
    if (!entry) return null;
    const deps = (entry.dependencyGroups || []).flatMap(g => (g.dependencies || []).map(x => x.id));
    return {
      integrity: entry.packageHash || "", shasum: "", license: entry.licenseExpression || "",
      dependencies: deps,
      manifest: {
        name, version, ecosystem: "nuget", description: entry.description,
        licenseExpression: entry.licenseExpression || null,
        authors: entry.authors || [], tags: entry.tags || [],
        repositoryUrl: entry.repository?.url || null, repositoryCommit: entry.repository?.commit || null,
        dependencies: deps, publishedAt: entry.published || null,
        listed: entry.listed !== false, packageHash: entry.packageHash || null
      }
    };
  },

  async rubygems(name, version) {
    const r = await fetch(`https://rubygems.org/api/v1/versions/${name}.json`);
    if (!r.ok) return null;
    const versions = await r.json();
    const v = Array.isArray(versions) ? versions.find(x => x.number === version) : null;
    if (!v) return null;
    return {
      integrity: v.sha ? "sha256:" + v.sha : "", shasum: "", license: v.licenses?.[0] || "",
      dependencies: [],
      manifest: {
        name, version, ecosystem: "rubygems", licenses: v.licenses || [], sha: v.sha,
        prerelease: v.prerelease || false, platform: v.platform || "ruby",
        publishedAt: v.created_at || null,
        dependencies: {
          runtime: (v.dependencies?.runtime || []).map(x => ({ name: x.name, requirements: x.requirements })),
          development: (v.dependencies?.development || []).map(x => ({ name: x.name, requirements: x.requirements }))
        }
      }
    };
  },

  async maven(name, version) {
    const [groupId, artifactId] = name.split(":");
    if (!groupId || !artifactId) return null;
    const groupPath = groupId.replace(/\./g, "/");
    let pom = "";
    try {
      const pr = await fetch(`https://repo1.maven.org/maven2/${groupPath}/${artifactId}/${version}/${artifactId}-${version}.pom`);
      if (pr.ok) pom = await pr.text();
    } catch (e) {}
    return {
      integrity: "", shasum: "", license: "",
      dependencies: [],
      manifest: {
        groupId, artifactId, version, ecosystem: "maven", name,
        pom_present: !!pom, pom_sha384: pom ? sha384(pom) : null,
        centralUrl: `https://repo1.maven.org/maven2/${groupPath}/${artifactId}/${version}/`
      }
    };
  },

  async github(name, version) {
    // version here is a pushed-at date marker; capture current default-branch head.
    const headers = { "Accept": "application/vnd.github.v3+json", "User-Agent": "prechained.com/1.0" };
    if (process.env.GITHUB_ARCHIVE_TOKEN) headers["Authorization"] = "token " + process.env.GITHUB_ARCHIVE_TOKEN;
    const r = await fetch(`https://api.github.com/repos/${name}`, { headers });
    if (!r.ok) return null;
    const d = await r.json();
    return {
      integrity: "", shasum: "", license: d.license?.spdx_id || "",
      dependencies: [],
      manifest: {
        repo: name, version, ecosystem: "github", description: d.description,
        default_branch: d.default_branch, stars: d.stargazers_count,
        pushed_at: d.pushed_at, created_at: d.created_at, archived: d.archived,
        license: d.license?.spdx_id || null, topics: d.topics || []
      }
    };
  }
};

// ── PROCESS ONE QUEUE ROW ─────────────────────────────────────
async function processRow(row) {
  const { id, ecosystem, package_name, version } = row;
  const fetcher = FETCHERS[ecosystem];
  if (!fetcher) { await finishCapture(id, false, `no fetcher for ${ecosystem}`); return false; }

  try {
    const fetched = await fetcher(package_name, version);
    if (!fetched) {
      // Manifest gone (e.g. yanked/taken-down). Mark done so we don't loop;
      // the not-found itself is information and is recorded as last_error.
      await finishCapture(id, true);
      return false;
    }

    // Ensure the package row exists, stamp discovery.
    const pkg = await upsertPackage(
      package_name, ecosystem,
      fetched.manifest.description || fetched.manifest.summary || null,
      version, fetched.manifest.total_versions || null
    );
    if (!pkg) { await finishCapture(id, false, "upsertPackage failed"); return false; }

    const fullManifest = {
      ...fetched.manifest,
      captured_at: new Date().toISOString(),
      captured_by: "prechained.com/queue-drainer"
    };

    // Compute the canonical fingerprint of what we just fetched, BEFORE deciding
    // whether to skip. This is what makes same-version substitution detectable:
    // if a snapshot for this exact package+version already exists, we compare
    // its stored fingerprint against this fresh one.
    //   • identical  → genuinely already captured; skip.
    //   • different  → the published manifest CHANGED under a fixed version
    //                  string (XZ-style substitution). Record the mutation
    //                  against the existing row and stop — we keep the original
    //                  receipt intact and flag the change as evidence.
    const candidateFp = canonicalFingerprint(fullManifest);
    const existingSnap = await getSnapshotForVersion(pkg.id, version);
    if (existingSnap) {
      if (existingSnap.sha384_fingerprint === candidateFp) {
        await finishCapture(id, true); // same content, already have it
        return false;
      }
      // Same version, DIFFERENT canonical fingerprint → substitution event.
      await recordSameVersionMutation(pkg.id, package_name, ecosystem, version, existingSnap, candidateFp, fullManifest);
      await finishCapture(id, true);
      return false;
    }

    const result = await captureVersion(
      pkg, version, ecosystem,
      fetched.integrity, fetched.shasum, fetched.license,
      fetched.dependencies, fullManifest, null
    );

    if (result) {
      // captureVersion returns the canonical fingerprint it stored — reuse it
      // for diff detection instead of recomputing a (now non-canonical) hash.
      await checkFingerprintDiff(pkg.id, package_name, ecosystem, version, result.fingerprint);

      // History-based threat detectors (install-hook-added, publisher-change,
      // size-spike). Each only fires when prior versions exist to compare
      // against. Findings are MERGED into raw_metadata — never overwrite.
      try {
        const flags = await runDetectors({
          pkgId: pkg.id, packageName: package_name, ecosystem, version,
          newManifest: fullManifest
        });
        if (flags.length) {
          const { data: snapRow } = await supabase
            .from("snapshots").select("id, raw_metadata")
            .eq("id", result.snapshotId).maybeSingle();
          if (snapRow?.id) {
            const merged = {
              ...(snapRow.raw_metadata || {}),
              threat_flags: flags,
              threat_flagged: true,
              threat_max_severity: flags.some(f => f.severity === "HIGH") ? "HIGH"
                : flags.some(f => f.severity === "MEDIUM") ? "MEDIUM" : "LOW"
            };
            await supabase.from("snapshots").update({ raw_metadata: merged }).eq("id", snapRow.id);
            console.error(`[THREAT] ${ecosystem}/${package_name}@${version}: ${flags.map(f => f.type).join(", ")}`);
          }
        }
      } catch (e) {
        console.error("[THREAT-DETECT] error:", e.message);
      }
    }
    await finishCapture(id, true);
    return result;   // { snapshotId, fingerprint } | null — handler batch-stamps these
  } catch (e) {
    await finishCapture(id, false, e.message);
    return false;
  }
}

// ── DEFAULT EXPORT ────────────────────────────────────────────
export default async function handler(req, context) {
  const startTime = Date.now();
  console.log(`[queue-drainer] starting ${new Date().toISOString()}`);

  // Self-heal any rows a previous crashed run left in 'processing'.
  const requeued = await requeueStale();
  if (requeued) console.log(`[queue-drainer] requeued ${requeued} stale rows`);

  let captured = 0, processed = 0;
  const newlyCaptured = [];   // { snapshotId, fingerprint } collected for one batch stamp
  // Keep claiming small batches until the time budget runs out.
  while (Date.now() - startTime < TIMEOUT) {
    const rows = await claimCaptures(BATCH);
    if (!rows.length) break;
    for (const row of rows) {
      if (Date.now() - startTime > TIMEOUT) break;
      processed++;
      const result = await processRow(row);
      if (result) { captured++; newlyCaptured.push(result); }
    }
  }

  let stamped = 0;
  if (newlyCaptured.length) {
    try {
      const proofs = await stampFingerprints(newlyCaptured.map(c => c.fingerprint));
      await Promise.all(newlyCaptured.map(async c => {
        const proof = proofs.get(c.fingerprint);
        if (!proof) return;
        const { error } = await supabase.from("snapshots")
          .update({ ots_proof: proof }).eq("id", c.snapshotId);
        if (!error) stamped++;
      }));
    } catch (e) {
      console.error("[queue-drainer] OTS stamp failed (anchor-checker will retry):", e.message);
    }
  }

  const elapsed = Date.now() - startTime;
  const { count: backlog } = await supabase
    .from("pending_captures").select("id", { count: "exact", head: true })
    .eq("status", "pending");

  console.log(`[queue-drainer] done: processed ${processed}, captured ${captured}, backlog ${backlog ?? "?"}, ${elapsed}ms`);

  return new Response(JSON.stringify({
    ok: true, processed, captured, requeued, backlog: backlog ?? null,
    elapsed_ms: elapsed, timestamp: new Date().toISOString()
  }), { headers: { "Content-Type": "application/json" } });
}
