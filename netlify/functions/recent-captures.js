// recent-captures.js — Returns recent on-demand captures for the chips on capture.html
// GET /.netlify/functions/recent-captures
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

  try {
    // Get last 8 unique package+ecosystem combos from capture_requests
    const { data, error } = await supabase
      .from("capture_requests")
      .select("package_name, ecosystem, created_at")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) throw error;

    // Deduplicate by package_name+ecosystem, keep most recent
    const seen = new Set();
    const unique = [];
    for (const row of data || []) {
      const key = `${row.package_name}|${row.ecosystem}`;
      if (!seen.has(key)) {
        seen.add(key);
        unique.push({ package_name: row.package_name, ecosystem: row.ecosystem });
      }
      if (unique.length >= 8) break;
    }

    return new Response(JSON.stringify(unique), { headers: CORS });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
  }
}
