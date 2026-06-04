// threat-hunter.mjs — Real-time malicious package hunter.
// Runs every 5 minutes via Netlify scheduler.
// Monitors npm real-time changes feed and captures suspicious new packages
// before they get taken down.
// prechained.com · Built by NextGenRails™

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const TIMEOUT = 8000;
const MAX_CHANGES = 50; // npm changes to process per run

function installHooks(scripts = {}) {
  const out = {};
  for (const k of ["preinstall","install","postinstall","prepare","prepublishOnly"]) {
    if (scripts[k]) out[k] = String(scripts[k]);
  }
  return out;
}

function isSuspicious(name) {
  if (!name) return false;
  const n = name.toLowerCase();
  return /[a-z]-\d{3,}$/.test(n) ||
    /\b(miasma|typhonian|gesserit|fremen|fedaykin|harkonnen|shai-hulud)\b/.test(n);
}

function sha384Hex(str) {
  const { createHash } = await import("crypto");
  return createHash("sha384").update(str).digest("hex");
}

async function getSeq() {
  try {
    const { data } = await supabase
      .from("threat_hunter_state")
      .select("value")
      .eq("key", "npm_seq")
      .single();
    return parseInt(data?.value || "0");
  } catch { return 0; }
}

async function saveSeq(seq) {
  await supabase.from("threat_hunter_state").upsert({
    key: "npm_seq", value: String(seq), updated_at: new Date().toISOString()
  }, { onConflict: "key" });
}

export default async function handler(req, context) {
  const start = Date.now();
  let captured = 0, threats = 0, hunted = 0;

  try {
    const lastSeq = await getSeq();

    const feedRes = await fetch(
      `https://replicate.npmjs.com/_changes?since=${lastSeq}&limit=${MAX_CHANGES}&include_docs=false`,
      { signal: AbortSignal.timeout(5000) }
    );
    if (!feedRes.ok) throw new Error(`Feed error: ${feedRes.status}`);
    const feed = await feedRes.json();
    const results = feed.results || [];
    const newSeq = feed.last_seq || (results[results.length-1]?.seq) || lastSeq;

    console.log(`[threat-hunter] seq ${lastSeq} → ${newSeq}, ${results.length} changes`);

    for (const change of results) {
      if (Date.now() - start > TIMEOUT) break;
      const name = change.id;
      if (!name || name.startsWith("_")) continue;
      hunted++;

      try {
        const pkgRes = await fetch(
          `https://registry.npmjs.org/${encodeURIComponent(name)}`,
          { signal: AbortSignal.timeout(3000) }
        );
        if (!pkgRes.ok) continue;
        const data = await pkgRes.json();
        const latest = data["dist-tags"]?.latest;
        if (!latest) continue;

        const vd = data.versions?.[latest];
        if (!vd) continue;

        const hooks = installHooks(vd.scripts);
        const hasHooks = Object.keys(hooks).length > 0;
        const suspicious = isSuspicious(name);
        const isNew = Object.keys(data.versions || {}).length <= 3;

        // Only capture if suspicious OR new+hooks
        if (!suspicious && !(isNew && hasHooks)) continue;

        // Upsert package
        const { data: pkg } = await supabase
          .from("packages")
          .upsert({
            name, ecosystem: "npm",
            description: (data.description || "").substring(0, 200),
            latest_version: latest,
            total_versions: Object.keys(data.versions || {}).length,
            last_captured_at: new Date().toISOString(),
            last_discovered_at: new Date().toISOString()
          }, { onConflict: "name,ecosystem" })
          .select().single();

        if (!pkg) continue;

        // Check if already captured
        const { data: exists } = await supabase
          .from("snapshots").select("id")
          .eq("package_id", pkg.id).eq("version", latest).single();
        if (exists) continue;

        const manifest = {
          name, version: latest, ecosystem: "npm",
          description: data.description,
          scripts: vd.scripts || {},
          maintainers: (vd.maintainers || []).map(m => ({ name: m.name, email: m.email || null })),
          dist: { integrity: vd.dist?.integrity, shasum: vd.dist?.shasum, unpackedSize: vd.dist?.unpackedSize || null },
          captured_at: new Date().toISOString(),
          captured_by: "prechained.com/threat-hunter",
        };

        const fp = (await import("crypto")).createHash("sha384")
          .update(JSON.stringify(manifest)).digest("hex");

        const receiptId = "NGR-PC-" + Date.now().toString(36).toUpperCase() +
          Math.random().toString(36).substring(2,8).toUpperCase();

        const flags = [];
        if (suspicious) flags.push({
          type: "SUSPICIOUS_PACKAGE_NAME", severity: "HIGH",
          detail: `Package name "${name}" matches known attacker naming patterns.`,
          evidence: { name }
        });
        if (isNew && hasHooks) flags.push({
          type: "NEW_PACKAGE_WITH_INSTALL_HOOK", severity: "CRITICAL",
          detail: `New package with install hooks: ${Object.keys(hooks).join(", ")}`,
          evidence: { hooks, total_versions: Object.keys(data.versions || {}).length }
        });

        const { error } = await supabase.from("snapshots").insert({
          package_id: pkg.id,
          version: latest,
          ecosystem: "npm",
          sha384_fingerprint: fp,
          receipt_id: receiptId,
          btc_anchored: false,
          btc_block: null,
          ots_proof: null,
          raw_metadata: {
            fp: "v2",
            threat_flagged: flags.length > 0,
            threat_hunter: true,
            threat_flags: flags,
            install_hooks: hasHooks ? hooks : null,
          }
        });

        if (!error) {
          captured++;
          if (flags.length > 0) threats++;
          console.log(`[threat-hunter] 🚨 ${name}@${latest} — ${flags.map(f=>f.type).join(", ")}`);
        }
      } catch (e) {
        // Skip individual package errors silently
      }
    }

    await saveSeq(newSeq);

  } catch (e) {
    console.error("[threat-hunter] error:", e.message);
  }

  const elapsed = Date.now() - start;
  console.log(`[threat-hunter] done: hunted=${hunted} captured=${captured} threats=${threats} ${elapsed}ms`);

  return new Response(JSON.stringify({
    ok: true, hunted, captured, threats, elapsed_ms: elapsed,
    timestamp: new Date().toISOString()
  }), { headers: { "Content-Type": "application/json" } });
}
