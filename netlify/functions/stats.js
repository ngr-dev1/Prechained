import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req) {
  const [pkgCount, snapCount] = await Promise.all([
    supabase.from("packages").select("*", { count: "exact", head: true }),
    supabase.from("snapshots").select("*", { count: "exact", head: true })
  ]);

  return new Response(JSON.stringify({
    total_packages: pkgCount.count || 0,
    total_snapshots: snapCount.count || 0,
    timestamp: new Date().toISOString()
  }), {
    headers: { 
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*"
    }
  });
}
