// threat-actors.mjs — Returns flagged actors for the public threat feed
// GET /.netlify/functions/threat-actors
// prechained.com · Built by NextGenRails™

import { createClient } from "@supabase/supabase-js";
import { isKnownGood } from "./actor-intelligence.js";

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
    // Only show actors that are explicitly flagged (known campaigns or velocity-triggered)
    const { data: actors, error } = await supabase
      .from("actor_index")
      .select("email, username, package_name, ecosystem, first_seen_at")
      .eq("flagged", true)
      .order("first_seen_at", { ascending: false })
      .limit(50);

    if (error) throw error;

    // Also pull any unflagged actors that have HIGH_VELOCITY and auto-flag them
    const { data: velocityFlagged } = await supabase
      .from("publish_velocity")
      .select("package_name, ecosystem, version_count, window_minutes, flagged")
      .eq("flagged", true);

    const flaggedMap = new Map();
    for (const f of velocityFlagged || []) {
      flaggedMap.set(`${f.package_name}:${f.ecosystem}`, f);
    }

    // Auto-flag any actor_index rows with HIGH_VELOCITY that aren't flagged yet
    if (velocityFlagged?.length) {
      for (const v of velocityFlagged) {
        await supabase
          .from("actor_index")
          .update({ flagged: true })
          .eq("package_name", v.package_name)
          .eq("ecosystem", v.ecosystem)
          .eq("flagged", false);
      }
    }

    const seen = new Set();
    const result = [];

    for (const actor of actors || []) {
      const key = `${actor.package_name}:${actor.ecosystem}`;
      if (seen.has(key)) continue;
      seen.add(key);

      // Skip known-good maintainers — they should never appear in the threat feed
      if (isKnownGood(actor.email, actor.username)) continue;

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
