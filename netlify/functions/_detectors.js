// _detectors.js — Supply chain threat detectors.
// Every detector compares a newly captured version against the package's OWN
// prior version history. A detector only fires when there is prior history to
// compare against — a brand-new package with no history is never flagged, which
// eliminates the largest false-positive source.
//
// Each detector returns either null (no finding) or a structured flag:
//   { type, severity, detail, evidence: { ... } }
// Evidence always contains the concrete before/after values so the finding is
// independently checkable against the archived manifests. Nothing is inferred
// or guessed — if the data doesn't support a definitive statement, no flag.
//
// prechained.com · Built by NextGenRails™

import { supabase } from "./_shared.js";

// ── Helpers ──────────────────────────────────────────────────

// Pull a manifest's install-time scripts (npm only has these reliably).
function installHooks(manifest) {
  const s = manifest?.scripts || {};
  const hooks = {};
  for (const k of ["preinstall", "install", "postinstall"]) {
    if (s[k]) hooks[k] = String(s[k]);
  }
  return hooks;
}

// Normalise a publisher identity to a comparable string, per ecosystem.
function publisherIdentity(manifest, ecosystem) {
  if (ecosystem === "npm") {
    if (manifest?._npmUser?.name) return manifest._npmUser.name.toLowerCase();
    return null;
  }
  if (ecosystem === "cargo") {
    if (manifest?.published_by?.login) return manifest.published_by.login.toLowerCase();
    return null;
  }
  return null; // other ecosystems: publisher identity not reliably captured
}

function unpackedSize(manifest, ecosystem) {
  if (ecosystem === "npm") {
    const n = manifest?.dist?.unpackedSize;
    return typeof n === "number" && n > 0 ? n : null;
  }
  return null; // only npm reliably reports unpackedSize
}

// Fetch prior snapshots for this package (everything except the version we just
// captured), newest first. We read the archived manifests so detectors compare
// real captured state, not registry-live state.
async function fetchPriorManifests(pkgId, currentVersion, limit = 60) {
  const { data, error } = await supabase
    .from("snapshots")
    .select("version, captured_at, manifest_path, raw_metadata")
    .eq("package_id", pkgId)
    .neq("version", currentVersion)
    .order("captured_at", { ascending: false })
    .limit(limit);
  if (error || !data) return [];
  return data;
}

// Download an archived manifest from the GitHub raw endpoint.
async function fetchArchivedManifest(manifestPath) {
  if (!manifestPath) return null;
  try {
    const repo = process.env.GITHUB_ARCHIVE_REPO || "ngr-dev1/prechained-archive";
    const r = await fetch(`https://raw.githubusercontent.com/${repo}/main/${manifestPath}`);
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// ── DETECTOR 1: INSTALL HOOK ADDED ───────────────────────────
// Fires when the new version has an install hook (preinstall/install/postinstall)
// that NONE of the prior versions had. npm only. This is the Miasma / Shai-Hulud
// vector: a malicious preinstall hook injected into a previously-clean package.
function detectInstallHookAdded(newManifest, ecosystem, priorManifests) {
  if (ecosystem !== "npm") return null;
  const newHooks = installHooks(newManifest);
  if (Object.keys(newHooks).length === 0) return null; // no hooks at all → nothing

  // Did ANY prior version already have install hooks? If so, hooks are normal
  // for this package and we do not flag.
  let priorHadHooks = false;
  let priorCount = 0;
  for (const pm of priorManifests) {
    if (!pm) continue;
    priorCount++;
    if (Object.keys(installHooks(pm)).length > 0) { priorHadHooks = true; break; }
  }

  // No prior manifests available to compare → cannot make a definitive claim.
  if (priorCount === 0) return null;
  if (priorHadHooks) return null;

  const hookList = Object.keys(newHooks).join(", ");
  return {
    type: "INSTALL_HOOK_ADDED",
    severity: "HIGH",
    detail: `Version introduces install hook(s) [${hookList}] not present in ${priorCount} prior captured version(s).`,
    evidence: {
      hooks: newHooks,
      prior_versions_checked: priorCount,
    },
  };
}

// ── DETECTOR 2: MAINTAINER / PUBLISHER CHANGE ────────────────
// Fires when the publisher of the new version differs from the publisher of
// every prior captured version. npm and cargo only. Account takeover is a
// primary supply-chain vector; a sudden publisher change on an established
// package is a concrete, checkable signal.
function detectPublisherChange(newManifest, ecosystem, priorManifests) {
  const newPub = publisherIdentity(newManifest, ecosystem);
  if (!newPub) return null; // can't identify publisher → no claim

  const priorPubs = new Set();
  for (const pm of priorManifests) {
    const p = publisherIdentity(pm, ecosystem);
    if (p) priorPubs.add(p);
  }
  if (priorPubs.size === 0) return null; // no prior publisher data → no claim
  if (priorPubs.has(newPub)) return null; // publisher seen before → normal

  return {
    type: "PUBLISHER_CHANGE",
    severity: "MEDIUM",
    detail: `Version published by "${newPub}", which differs from all ${priorPubs.size} previously seen publisher(s): ${[...priorPubs].join(", ")}.`,
    evidence: {
      new_publisher: newPub,
      prior_publishers: [...priorPubs],
    },
  };
}

// ── DETECTOR 3: SIZE SPIKE ───────────────────────────────────
// Fires when unpackedSize jumps far beyond the prior versions' median. npm only.
// Miasma bloated index.js from ~8KB to ~4.3MB — a textbook size spike from an
// injected payload. We require a large absolute AND relative jump to avoid
// flagging normal growth.
function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function detectSizeSpike(newManifest, ecosystem, priorManifests) {
  if (ecosystem !== "npm") return null;
  const newSize = unpackedSize(newManifest, ecosystem);
  if (!newSize) return null;

  const priorSizes = [];
  for (const pm of priorManifests) {
    const s = unpackedSize(pm, ecosystem);
    if (s) priorSizes.push(s);
  }
  if (priorSizes.length < 3) return null; // need a stable baseline → at least 3

  const med = median(priorSizes);
  if (!med || med <= 0) return null;

  const ratio = newSize / med;
  const absJump = newSize - med;

  // Require BOTH a 10x relative jump AND at least 1MB absolute growth.
  // Both thresholds must hold to flag — this is deliberately conservative.
  if (ratio < 10 || absJump < 1_000_000) return null;

  return {
    type: "SIZE_SPIKE",
    severity: "MEDIUM",
    detail: `Unpacked size ${(newSize / 1e6).toFixed(2)}MB is ${ratio.toFixed(1)}x the median of ${priorSizes.length} prior version(s) (${(med / 1e6).toFixed(2)}MB).`,
    evidence: {
      new_size_bytes: newSize,
      prior_median_bytes: Math.round(med),
      ratio: Number(ratio.toFixed(1)),
      prior_versions_checked: priorSizes.length,
    },
  };
}

// ── ORCHESTRATOR ─────────────────────────────────────────────
// Runs all history-based detectors for one freshly captured version.
// Fetches prior versions once, downloads up to `maxManifests` archived
// manifests for comparison, runs every detector, returns the list of flags.
// Bounded work: caps manifest downloads so a single capture can't run long.
export async function runDetectors({ pkgId, packageName, ecosystem, version, newManifest }) {
  const flags = [];

  // Prior snapshot rows (metadata only — cheap).
  const priorRows = await fetchPriorManifests(pkgId, version);
  if (!priorRows.length) return flags; // no history → no history-based flags

  // Download a bounded number of prior manifests, newest first.
  const MAX_MANIFESTS = 25;
  const priorManifests = [];
  for (const row of priorRows.slice(0, MAX_MANIFESTS)) {
    const m = await fetchArchivedManifest(row.manifest_path);
    if (m) priorManifests.push(m);
  }
  if (!priorManifests.length) return flags; // couldn't load any → no claim

  const hook = detectInstallHookAdded(newManifest, ecosystem, priorManifests);
  if (hook) flags.push(hook);

  const pub = detectPublisherChange(newManifest, ecosystem, priorManifests);
  if (pub) flags.push(pub);

  const size = detectSizeSpike(newManifest, ecosystem, priorManifests);
  if (size) flags.push(size);

  return flags;
}
