import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const HEADERS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
  "Pragma": "no-cache",
  "Surrogate-Control": "no-store",
  "CDN-Cache-Control": "no-store"
};

export default async function handler(req) {
  let total_packages = 0;
  let total_snapshots = 0;

  try {
    // Use count:"exact" WITHOUT head:true so it does a real SELECT with COUNT
    // This matches how snapshots.js queries work (no HEAD requests)
    const [pkgResult, snapResult] = await Promise.all([
      supabase.from("packages").select("*", { count: "exact", head: false }).limit(1),
      supabase.from("snapshots").select("*", { count: "exact", head: false }).limit(1)
    ]);

    total_packages = pkgResult.count ?? 0;
    total_snapshots = snapResult.count ?? 0;
  } catch(e) {}

  return new Response(JSON.stringify({
    total_packages,
    total_snapshots,
    timestamp: new Date().toISOString()
  }), { headers: HEADERS });
}
