import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const NO_CACHE = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
  "Pragma": "no-cache",
  "Surrogate-Control": "no-store",
  "CDN-Cache-Control": "no-store"
};

export default async function handler(req) {
  const url = new URL(req.url);
  const packageId = url.searchParams.get("package_id");
  const receiptId = url.searchParams.get("receipt_id");
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50"), 500);
  const offset = parseInt(url.searchParams.get("offset") || "0");

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
      .select("*, packages(*)")
      .eq("package_id", packageId)
      .order("captured_at", { ascending: false })
      .limit(limit);
    if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: NO_CACHE });
    return new Response(JSON.stringify({ snapshots: data }), { headers: NO_CACHE });
  }

  const { data, error } = await supabase
    .from("snapshots")
    .select("*, packages(name, ecosystem, description)")
    .order("captured_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: NO_CACHE });
  return new Response(JSON.stringify({ snapshots: data }), { headers: NO_CACHE });
}
