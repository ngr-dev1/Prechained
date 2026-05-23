import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req) {
  let total_packages = 0;
  let total_snapshots = 0;

  try {
    const [pkgResult, snapResult] = await Promise.all([
      supabase.from("packages").select("*", { count: "exact", head: true }),
      supabase.from("snapshots").select("*", { count: "exact", head: true })
    ]);
    total_packages = pkgResult.count ?? 0;
    total_snapshots = snapResult.count ?? 0;
  } catch(e) {}

  return new Response(JSON.stringify({
    total_packages,
    total_snapshots,
    timestamp: new Date().toISOString()
  }), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
      "Pragma": "no-cache",
      "Surrogate-Control": "no-store",
      "CDN-Cache-Control": "no-store"
    }
  });
}
