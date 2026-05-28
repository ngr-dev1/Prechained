import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const NO_CACHE = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

const CACHE_60 = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, s-maxage=60, stale-while-revalidate=30",
};

export default async function handler(req) {
  const url = new URL(req.url);
  const packageId = url.searchParams.get("package_id");
  const receiptId = url.searchParams.get("receipt_id");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 500);
  const offset = parseInt(url.searchParams.get("offset") || "0");
  const captureCountOnly = url.searchParams.get("capture_count") === "1";

  // On-demand capture count shortcut
  if(captureCountOnly) {
    const { count } = await supabase
      .from("capture_requests")
      .select("*", { count: "exact", head: true });
    return new Response(JSON.stringify({ capture_count: count || 0 }), { headers: CACHE_60 });
  }

  if (receiptId) {
    const { data, error } = await supabase
      .from("snapshots")
      .select("*, packages(*)")
      .eq("receipt_id", receiptId)
      .single();
    if (error) return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: NO_CACHE });
    return new Response(JSON.stringify(data), { headers: NO_CACHE });
  }

  if (packageId) {
    const { data, error } = await supabase
      .from("snapshots")
      .select("*, packages(*), manifest_path")
      .eq("package_id", packageId)
      .order("captured_at", { ascending: false })
      .limit(limit);
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: NO_CACHE });
    return new Response(JSON.stringify({ snapshots: data }), { headers: NO_CACHE });
  }

  // Main feed — also fetch counts in parallel using the same working select pattern
  const [feedResult, snapCountResult, pkgCountResult] = await Promise.all([
    supabase
      .from("snapshots")
      .select("*, packages(name, ecosystem, description), manifest_path")
      .order("captured_at", { ascending: false })
      .range(offset, offset + limit - 1),
    supabase
      .from("snapshots")
      .select("id", { count: "exact", head: false })
      .limit(1),
    supabase
      .from("packages")
      .select("id", { count: "exact", head: false })
      .limit(1)
  ]);

  if (feedResult.error) return new Response(JSON.stringify({ error: feedResult.error.message }), { status: 500, headers: NO_CACHE });

  return new Response(JSON.stringify({
    snapshots: feedResult.data,
    total_snapshots: snapCountResult.count ?? null,
    total_packages: pkgCountResult.count ?? null
  }), { headers: CACHE_60 });
}
