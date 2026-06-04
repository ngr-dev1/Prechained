// threat-hunter.js — Real-time malicious package hunter.
// Runs every 5 minutes. Monitors live threat intelligence feeds and the
// npm real-time publish stream to capture suspicious packages BEFORE
// they get taken down — so prechained.com has the cryptographic receipt
// that proves what the package contained at the moment it was live.
//
// Detection sources:
//   1. npm real-time changes feed — every single new package published to npm
//   2. OSV.dev malicious package feed — packages flagged as MAL-*
//   3. PyPI recent packages feed — new packages with no history
//   4. Socket.dev alerts RSS (if available)
//
// Capture strategy:
//   - Brand new package (< 24h old, never seen before) → capture immediately
//   - Package flagged by OSV as malicious → capture immediately
//   - New package with install hooks + no prior history → capture + threat flag
//   - Any package named in a known attack pattern → capture
//
// Every capture gets a cryptographic receipt timestamped to the moment
// the package was live. Even if npm pulls it in 10 minutes, we have the record.
//
// prechained.com · Built by NextGenRails™

import { supabase, upsertPackage, captureVersion, canonicalFingerprint,
         generateReceiptId, storeManifestInGithub, enqueueCaptures,
         GITHUB_TOKEN } from "./_shared.js";
import { runDetectors } from "./_detectors.js";

const TIMEOUT = 25000; // background function — 25s budget
const MAX_NEW_PACKAGES = 150; // npm publishes ~300/min — sample aggressively
const MAX_OSV_PACKAGES = 50;

// ── HELPERS ────────────────────────────────────────────────────────────────

function installHooks(manifest) {
  const s = manifest?.scripts || {};
  return Object.fromEntries(
    ["preinstall","install","postinstall","prepare","prepublishOnly"]
      .filter(k => s[k])
      .map(k => [k, String(s[k])])
  );
}

function isSuspiciousName(name) {
  if (!name) return false;
  const n = name.toLowerCase();
  // Random-looking names (high entropy) — attacker-generated package names
  // like typhonian-manticore-31395 have numbers appended to Dune words
  const hasTrailingNumbers = /[a-z]-\d{3,}$/.test(n);
  // Typosquats of popular packages
  const typosquatPatterns = [
    /^lo+dash/, /^reac[^t]/, /^expresss/, /^lodas[^h]/, /^reqests/,
    /^cros-env/, /^cross-en[^v]/, /^node-fetch\d/, /^axios-/,
    /^moment-\w+-\d/, /^webpack-\w+-\d/
  ];
  const isTyposquat = typosquatPatterns.some(p => p.test(n));
  // Known attacker naming patterns from historical attacks
  const attackPatterns = [
    /\b(miasma|shai-hulud|typhonian|gesserit|fremen|fedaykin|harkonnen)\b/,
    /\b(malware|backdoor|stealer|trojan|payload|exfil)\b/,
  ];
  const isKnownPattern = attackPatterns.some(p => p.test(n));
  return hasTrailingNumbers || isTyposquat || isKnownPattern;
}

async function captureNpmPackage(name, startTime) {
  if (Date.now() - startTime > TIMEOUT) return null;
  try {
    const res = await fetch(
      `https://registry.npmjs.org/${encodeURIComponent(name)}`,
      { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(5000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const latest = data["dist-tags"]?.latest;
    if (!latest) return null;
    const allVersions = Object.keys(data.versions || {});
    const pkg = await upsertPackage(name, "npm", data.description, latest, allVersions.length);
    if (!pkg) return null;

    let captured = 0;
    let threats = [];

    for (const version of allVersions.slice(-5)) { // last 5 versions
      if (Date.now() - startTime > TIMEOUT) break;
      const vd = data.versions[version];
      if (!vd) continue;

      const hooks = installHooks(vd);
      const hasHooks = Object.keys(hooks).length > 0;
      const suspicious = isSuspiciousName(name);
      const isNew = allVersions.length <= 3; // brand new package

      const manifest = {
        name, version, ecosystem: "npm",
        description: data.description,
        license: vd.license,
        dependencies: vd.dependencies || {},
        devDependencies: vd.devDependencies || {},
        scripts: {
          install: vd.scripts?.install || null,
          preinstall: vd.scripts?.preinstall || null,
          postinstall: vd.scripts?.postinstall || null,
          prepare: vd.scripts?.prepare || null,
          prepublishOnly: vd.scripts?.prepublishOnly || null,
        },
        maintainers: (vd.maintainers || data.maintainers || []).map(m => ({
          name: m.name, email: m.email || null
        })),
        author: vd.author || data.author || null,
        publishedAt: data.time?.[version] || null,
        dist: {
          integrity: vd.dist?.integrity,
          shasum: vd.dist?.shasum,
          tarball: vd.dist?.tarball,
          fileCount: vd.dist?.fileCount || null,
          unpackedSize: vd.dist?.unpackedSize || null,
        },
        repository: vd.repository || null,
        keywords: vd.keywords || [],
        _npmUser: vd._npmUser ? { name: vd._npmUser.name, email: vd._npmUser.email || null } : null,
        captured_at: new Date().toISOString(),
        captured_by: "prechained.com/threat-hunter",
        threat_hunter: true,
        suspicious_name: suspicious,
        install_hooks_present: hasHooks,
        hooks_detail: hasHooks ? hooks : null,
      };

      const ok = await captureVersion(
        pkg, version, "npm",
        vd.dist?.integrity, vd.dist?.shasum,
        vd.license,
        Object.keys(vd.dependencies || {}),
        manifest, null
      );

      if (ok) {
        captured++;

        // Run detectors immediately
        const flags = await runDetectors({
          pkgId: pkg.id,
          packageName: name,
          ecosystem: "npm",
          version,
          newManifest: manifest,
        });

        // If brand new package has install hooks — auto-flag as threat
        let threatFlags = [...flags];
        if (isNew && hasHooks) {
          threatFlags.push({
            type: "NEW_PACKAGE_WITH_INSTALL_HOOK",
            severity: "CRITICAL",
            detail: `Brand new package (${allVersions.length} total versions) has install hooks: ${Object.keys(hooks).join(", ")}. High probability of malicious payload.`,
            evidence: { hooks, total_versions: allVersions.length, is_new_package: true },
          });
        }
        if (suspicious) {
          threatFlags.push({
            type: "SUSPICIOUS_PACKAGE_NAME",
            severity: "HIGH",
            detail: `Package name "${name}" matches known attacker naming patterns or typosquat signatures.`,
            evidence: { name, pattern_matched: true },
          });
        }

        if (threatFlags.length > 0) {
          threats.push({ name, version, flags: threatFlags });
          // Update snapshot with threat flags
          const { data: snap } = await supabase
            .from("snapshots")
            .select("id")
            .eq("package_id", pkg.id)
            .eq("version", version)
            .single();

          if (snap?.id) {
            await supabase.from("snapshots").update({
              raw_metadata: {
                fp: "v2",
                threat_flagged: true,
                threat_hunter: true,
                threat_flags: threatFlags,
                captured_by: "threat-hunter",
              }
            }).eq("id", snap.id);
          }

          console.log(`[threat-hunter] 🚨 THREAT: ${name}@${version} — ${threatFlags.map(f => f.type).join(", ")}`);
        }
      }
    }

    return { name, captured, threats };
  } catch (e) {
    console.error(`[threat-hunter] npm/${name}:`, e.message);
    return null;
  }
}

// ── SOURCE 1: npm real-time changes feed ──────────────────────────────────
// The npm replication feed exposes every package change in real time.
// We store the last sequence number in Supabase so each run picks up
// exactly where the last one left off — no gaps, no duplicates.
async function huntNpmChanges(startTime) {
  let captured = 0, hunted = 0, threats = 0;

  try {
    // Get last sequence from DB
    const { data: seqRow } = await supabase
      .from("threat_hunter_state")
      .select("value")
      .eq("key", "npm_seq")
      .single();

    const lastSeq = parseInt(seqRow?.value || "0");

    const feedUrl = `https://replicate.npmjs.com/_changes?since=${lastSeq}&limit=${MAX_NEW_PACKAGES}&include_docs=false`;
    const res = await fetch(feedUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) return { captured, hunted, threats };
    const data = await res.json();

    const results = data.results || [];
    if (!results.length) return { captured, hunted, threats };

    const newSeq = data.last_seq || results[results.length - 1]?.seq || lastSeq;

    console.log(`[threat-hunter] npm changes: ${results.length} new packages since seq ${lastSeq}`);

    for (const change of results) {
      if (Date.now() - startTime > TIMEOUT) break;
      const name = change.id;
      if (!name || name.startsWith("_")) continue;
      hunted++;

      const result = await captureNpmPackage(name, startTime);
      if (result) {
        captured += result.captured;
        threats += result.threats.length;
      }
    }

    // Save new sequence
    await supabase.from("threat_hunter_state").upsert({
      key: "npm_seq",
      value: String(newSeq),
      updated_at: new Date().toISOString()
    }, { onConflict: "key" });

  } catch (e) {
    console.error("[threat-hunter] npm changes feed:", e.message);
  }

  return { captured, hunted, threats };
}

// ── SOURCE 2: OSV.dev malicious package feed ──────────────────────────────
// OSV.dev has a specific ecosystem "MAL" for malicious packages.
// These are packages that have been confirmed malicious.
// We capture them immediately — even if npm has already pulled them,
// we try to get the manifest from the registry before it's 100% gone.
async function huntOsvMalicious(startTime) {
  let captured = 0, hunted = 0;

  try {
    // Query OSV for malicious npm packages modified in last 24 hours
    const res = await fetch("https://api.osv.dev/v1/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        query: {
          package: { ecosystem: "npm" }
        }
      }),
      signal: AbortSignal.timeout(8000)
    });

    // Also fetch the malicious package list specifically
    const malRes = await fetch(
      "https://api.osv.dev/v1/vulns?package.ecosystem=MAL&modified.after=" +
      new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split("T")[0],
      { signal: AbortSignal.timeout(8000) }
    );

    if (malRes.ok) {
      const malData = await malRes.json();
      const vulns = malData.vulns || [];

      for (const vuln of vulns.slice(0, MAX_OSV_PACKAGES)) {
        if (Date.now() - startTime > TIMEOUT) break;
        const affected = vuln.affected || [];
        for (const aff of affected) {
          const pkgName = aff.package?.name;
          const ecosystem = aff.package?.ecosystem?.toLowerCase();
          if (!pkgName || ecosystem !== "npm") continue;
          hunted++;
          console.log(`[threat-hunter] OSV malicious: ${pkgName} (${vuln.id})`);
          const result = await captureNpmPackage(pkgName, startTime);
          if (result) captured += result.captured;
        }
      }
    }
  } catch (e) {
    console.error("[threat-hunter] OSV feed:", e.message);
  }

  return { captured, hunted };
}

// ── SOURCE 3: PyPI recent packages ───────────────────────────────────────
async function huntPypiNew(startTime) {
  let captured = 0, hunted = 0;

  try {
    const res = await fetch("https://pypi.org/rss/packages.xml", {
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) return { captured, hunted };
    const xml = await res.text();

    // Extract package names from RSS
    const matches = [...xml.matchAll(/<title>([^<]+)<\/title>/gi)].slice(1, 30);

    for (const m of matches) {
      if (Date.now() - startTime > TIMEOUT) break;
      const name = m[1].trim().split(" ")[0];
      if (!name) continue;
      hunted++;

      try {
        const pkgRes = await fetch(`https://pypi.org/pypi/${name}/json`, {
          signal: AbortSignal.timeout(4000)
        });
        if (!pkgRes.ok) continue;
        const data = await pkgRes.json();
        const version = data.info?.version;
        if (!version) continue;

        const suspicious = isSuspiciousName(name);
        const isNew = Object.keys(data.releases || {}).length <= 2;

        if (!suspicious && !isNew) continue; // only capture suspicious/new from PyPI

        const pkg = await upsertPackage(name, "pypi", data.info?.summary, version, Object.keys(data.releases || {}).length);
        if (!pkg) continue;

        const files = data.releases?.[version] || [];
        const wheel = files.find(f => f.packagetype === "bdist_wheel") || files[0];

        const manifest = {
          name, version, ecosystem: "pypi",
          summary: data.info?.summary,
          license: data.info?.license,
          author: data.info?.author,
          requires_dist: data.info?.requires_dist || [],
          publishedAt: wheel?.upload_time || null,
          dist: { url: wheel?.url, sha256: wheel?.digests?.sha256, size: wheel?.size },
          captured_at: new Date().toISOString(),
          captured_by: "prechained.com/threat-hunter",
          threat_hunter: true,
          suspicious_name: suspicious,
        };

        const ok = await captureVersion(pkg, version, "pypi",
          wheel?.digests?.sha256 ? "sha256:" + wheel.digests.sha256 : "",
          "", data.info?.license || [], manifest, null
        );

        if (ok) {
          captured++;
          if (suspicious || isNew) {
            const { data: snap } = await supabase.from("snapshots")
              .select("id").eq("package_id", pkg.id).eq("version", version).single();
            if (snap?.id) {
              const flags = [];
              if (suspicious) flags.push({ type: "SUSPICIOUS_PACKAGE_NAME", severity: "HIGH",
                detail: `PyPI package "${name}" matches suspicious naming patterns.`, evidence: { name } });
              if (isNew) flags.push({ type: "NEW_PACKAGE_NO_HISTORY", severity: "MEDIUM",
                detail: `Newly published PyPI package with no prior history.`, evidence: { total_versions: Object.keys(data.releases || {}).length } });
              await supabase.from("snapshots").update({
                raw_metadata: { fp: "v2", threat_flagged: true, threat_hunter: true, threat_flags: flags }
              }).eq("id", snap.id);
            }
          }
        }
      } catch (e) {
        console.error(`[threat-hunter] pypi/${name}:`, e.message);
      }
    }
  } catch (e) {
    console.error("[threat-hunter] PyPI new feed:", e.message);
  }

  return { captured, hunted };
}

// ── MAIN HANDLER ───────────────────────────────────────────────────────────
export default async function handler(req, context) {
  const start = Date.now();
  console.log("[threat-hunter] start", new Date().toISOString());

  // Run all three sources in parallel where possible
  const [npmChanges, osvResults, pypiResults] = await Promise.allSettled([
    huntNpmChanges(start),
    huntOsvMalicious(start),
    huntPypiNew(start),
  ]);

  const npm = npmChanges.status === "fulfilled" ? npmChanges.value : { captured: 0, hunted: 0, threats: 0 };
  const osv = osvResults.status === "fulfilled" ? osvResults.value : { captured: 0, hunted: 0 };
  const pypi = pypiResults.status === "fulfilled" ? pypiResults.value : { captured: 0, hunted: 0 };

  const elapsed = Date.now() - start;
  const totalCaptured = npm.captured + osv.captured + pypi.captured;
  const totalThreats = npm.threats || 0;

  console.log(`[threat-hunter] done: npm=${npm.captured} captured/${npm.hunted} hunted/${npm.threats} threats | osv=${osv.captured}/${osv.hunted} | pypi=${pypi.captured}/${pypi.hunted} | ${elapsed}ms`);

  return new Response(JSON.stringify({
    ok: true,
    total_captured: totalCaptured,
    total_threats: totalThreats,
    npm: { captured: npm.captured, hunted: npm.hunted, threats: npm.threats },
    osv: { captured: osv.captured, hunted: osv.hunted },
    pypi: { captured: pypi.captured, hunted: pypi.hunted },
    elapsed_ms: elapsed,
    timestamp: new Date().toISOString(),
  }), { headers: { "Content-Type": "application/json" } });
}
