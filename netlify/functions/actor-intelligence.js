// actor-intelligence.js — Actor attribution and threat intelligence
// GET /.netlify/functions/actor-intelligence?email=x&username=y&package=z&ecosystem=npm
// prechained.com · Built by NextGenRails™

import { supabase } from "./_shared.js";

const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

export default async function handler(req) {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const url = new URL(req.url);
  const email    = url.searchParams.get("email")    || null;
  const username = url.searchParams.get("username") || null;
  const pkg      = url.searchParams.get("package")  || null;
  const ecosystem = url.searchParams.get("ecosystem") || null;

  if (!email && !username && !pkg) {
    return new Response(JSON.stringify({ error: "Provide email, username, or package" }), { status: 400, headers: CORS });
  }

  try {
    const results = await queryActorIntelligence({ email, username, pkg, ecosystem });
    return new Response(JSON.stringify(results), { headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
  }
}

// ── CORE QUERY ─────────────────────────────────────────────────
export async function queryActorIntelligence({ email, username, pkg, ecosystem }) {
  const connectedPackages = [];
  const actorIdentities   = new Set();
  const flags             = [];

  // ── 1. Look up by email ──────────────────────────────────────
  if (email) {
    const { data: emailMatches } = await supabase
      .from("actor_index")
      .select("package_name, ecosystem, username, first_seen_at")
      .eq("email", email.toLowerCase().trim())
      .order("first_seen_at", { ascending: true })
      .limit(50);

    for (const row of emailMatches || []) {
      if (row.package_name !== pkg) {
        connectedPackages.push({
          package:   row.package_name,
          ecosystem: row.ecosystem,
          via:       "email",
          identity:  email,
          first_seen: row.first_seen_at
        });
      }
      if (row.username) actorIdentities.add(row.username);
    }
  }

  // ── 2. Look up by username ───────────────────────────────────
  const usernamesToCheck = new Set();
  if (username) usernamesToCheck.add(username.toLowerCase().trim());
  actorIdentities.forEach(u => usernamesToCheck.add(u.toLowerCase().trim()));

  for (const uname of usernamesToCheck) {
    const { data: unameMatches } = await supabase
      .from("actor_index")
      .select("package_name, ecosystem, email, first_seen_at")
      .eq("username", uname)
      .order("first_seen_at", { ascending: true })
      .limit(50);

    for (const row of unameMatches || []) {
      if (row.package_name !== pkg) {
        // Avoid dupes
        const already = connectedPackages.find(
          c => c.package === row.package_name && c.ecosystem === row.ecosystem
        );
        if (!already) {
          connectedPackages.push({
            package:   row.package_name,
            ecosystem: row.ecosystem,
            via:       "username",
            identity:  uname,
            first_seen: row.first_seen_at
          });
        }
      }
      if (row.email) actorIdentities.add(row.email);
    }
  }

  // ── 3. Cross-ecosystem check ─────────────────────────────────
  const ecosystems = [...new Set(connectedPackages.map(c => c.ecosystem))];
  if (ecosystems.length > 1) {
    flags.push({
      type:     "CROSS_ECOSYSTEM",
      severity: "HIGH",
      detail:   `Actor seen across ${ecosystems.length} ecosystems: ${ecosystems.join(", ")}`,
    });
  }

  // ── 4. Velocity check for THIS package ──────────────────────
  let velocity = null;
  if (pkg && ecosystem) {
    const { data: velData } = await supabase
      .from("publish_velocity")
      .select("*")
      .eq("package_name", pkg)
      .eq("ecosystem", ecosystem)
      .single();

    if (velData) {
      velocity = velData;
      const minutesWindow = velData.window_minutes || 60;
      const versionsPerHour = (velData.version_count / minutesWindow) * 60;

      if (velData.version_count >= 3 && minutesWindow <= 60) {
        flags.push({
          type:     "HIGH_VELOCITY",
          severity: "HIGH",
          detail:   `${velData.version_count} versions published in ${minutesWindow} minutes — malware pattern`,
        });
      }
    }
  }

  // ── 5. New actor check (first appearance) ──────────────────
  const allPkgs = pkg ? [pkg, ...connectedPackages.map(c => c.package)] : connectedPackages.map(c => c.package);
  const { count: totalAppearances } = await supabase
    .from("actor_index")
    .select("*", { count: "exact", head: true })
    .or(
      [email ? `email.eq.${email}` : null, username ? `username.eq.${username}` : null]
        .filter(Boolean)
        .join(",")
    );

  const isNewActor = (totalAppearances || 0) <= 1;
  if (isNewActor && pkg) {
    flags.push({
      type:     "NEW_ACTOR",
      severity: "MEDIUM",
      detail:   "First appearance of this actor in the archive — no prior publishing history",
    });
  }

  // ── 6. Known identities collected ───────────────────────────
  const knownIdentities = [...actorIdentities];

  return {
    actor: {
      email:    email    || null,
      username: username || null,
      known_identities: knownIdentities,
    },
    connected_packages: connectedPackages,
    connected_package_count: connectedPackages.length,
    flags,
    threat_level: deriveThreatLevel(flags),
    velocity,
    is_new_actor: isNewActor,
  };
}

function deriveThreatLevel(flags) {
  if (flags.some(f => f.severity === "HIGH"))   return "HIGH";
  if (flags.some(f => f.severity === "MEDIUM")) return "MEDIUM";
  if (flags.length > 0)                         return "LOW";
  return "NONE";
}

// ── INDEX ACTORS FROM A CAPTURE ──────────────────────────────
// Call this from capture.js after each successful capture
export async function indexActors(pkg, ecosystem, manifest) {
  if (!manifest) return;

  const rows = [];
  const seen = new Set();

  const addActor = (email, username) => {
    const e = email?.toLowerCase().trim() || null;
    const u = username?.toLowerCase().trim() || null;
    if (!e && !u) return;
    const key = `${e}|${u}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({
      email:        e,
      username:     u,
      ecosystem,
      package_name: pkg.name,
      package_id:   pkg.id,
      first_seen_at: new Date().toISOString(),
    });
  };

  // npm maintainers
  if (Array.isArray(manifest.maintainers)) {
    for (const m of manifest.maintainers) {
      addActor(m.email, m.name);
    }
  }
  // npm _npmUser
  if (manifest._npmUser) {
    addActor(manifest._npmUser.email, manifest._npmUser.name);
  }
  // npm author
  if (manifest.author) {
    const a = manifest.author;
    if (typeof a === "object") addActor(a.email, a.name);
  }
  // pypi
  if (manifest.author_email || manifest.author) {
    addActor(manifest.author_email, manifest.author);
  }
  // cargo published_by
  if (manifest.published_by) {
    addActor(null, manifest.published_by.login || manifest.published_by.name);
  }
  // github commit author
  if (manifest.commit_author_email || manifest.commit_author) {
    addActor(manifest.commit_author_email, manifest.commit_author);
  }

  if (rows.length === 0) return;

  // Insert each row individually — upsert onConflict doesn't handle NULLS NOT DISTINCT correctly
  // so we check for existence first then insert if missing
  for (const row of rows) {
    try {
      let query = supabase.from("actor_index").select("id", { count: "exact", head: true })
        .eq("package_name", row.package_name)
        .eq("ecosystem", row.ecosystem);
      if (row.email)    query = query.eq("email", row.email);
      else              query = query.is("email", null);
      if (row.username) query = query.eq("username", row.username);
      else              query = query.is("username", null);

      const { count } = await query;
      if ((count || 0) === 0) {
        await supabase.from("actor_index").insert(row);
      }
    } catch(e) {
      // ignore individual row errors
    }
  }
}

// ── UPDATE VELOCITY ──────────────────────────────────────────
// Call this from capture.js after capturing new versions
export async function updateVelocity(pkg, ecosystem, newVersionCount) {
  if (newVersionCount === 0) return;

  const now = new Date();

  const { data: existing } = await supabase
    .from("publish_velocity")
    .select("*")
    .eq("package_name", pkg.name)
    .eq("ecosystem", ecosystem)
    .single();

  if (!existing) {
    await supabase.from("publish_velocity").insert({
      package_name:     pkg.name,
      ecosystem,
      package_id:       pkg.id,
      version_count:    newVersionCount,
      first_version_at: now.toISOString(),
      last_version_at:  now.toISOString(),
      window_minutes:   60,
      flagged:          newVersionCount >= 3,
    });
  } else {
    const firstSeen   = new Date(existing.first_version_at);
    const windowMins  = Math.round((now - firstSeen) / 60000) || 1;
    const totalCount  = existing.version_count + newVersionCount;
    const flagged     = totalCount >= 3 && windowMins <= 60;

    await supabase.from("publish_velocity").update({
      version_count:   totalCount,
      last_version_at: now.toISOString(),
      window_minutes:  windowMins,
      flagged,
    }).eq("id", existing.id);
  }
}
