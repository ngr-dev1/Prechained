// threat-actors.js — Returns all flagged actors for the public threat feed
// GET /.netlify/functions/threat-actors
// prechained.com · Built by NextGenRails™

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

export default async function handler(req) {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const { data: actors, error } = await supabase
      .from("actor_index")
      .select("email, username, package_name, ecosystem, first_seen_at")
      .order("first_seen_at", { ascending: false })
      .limit(50);

    if (error) throw error;

    const { data: flagged } = await supabase
      .from("publish_velocity")
      .select("package_name, ecosystem, version_count, window_minutes, flagged")
      .eq("flagged", true);

    const flaggedMap = new Map();
    for (const f of flagged || []) {
      flaggedMap.set(`${f.package_name}:${f.ecosystem}`, f);
    }

    const seen = new Set();
    const result = [];

    for (const actor of actors || []) {
      const key = `${actor.package_name}:${actor.ecosystem}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const vel = flaggedMap.get(key);
      const flags = [];
      let threat_level = "MEDIUM";

      if (vel?.flagged) {
        flags.push(`HIGH_VELOCITY: ${vel.version_count} versions in ${vel.window_minutes}m`);
        threat_level = "HIGH";
      }

      flags.push("NEW_ACTOR");

      result.push({
        ...actor,
        flags,
        threat_level,
      });
    }

    return new Response(JSON.stringify({ actors: result }), { headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
  }
}
