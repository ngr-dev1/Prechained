import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const ALLOWED_SORT = ["last_captured_at", "name", "total_versions"];

export default async function handler(req) {
  const url = new URL(req.url);
  const ecosystem = url.searchParams.get("ecosystem") || null;
  const search = url.searchParams.get("q") || null;
  const page = Math.max(1, parseInt(url.searchParams.get("page") || "1"));
  const rawSort = url.searchParams.get("sort") || "last_captured_at";
  const sortBy = ALLOWED_SORT.includes(rawSort) ? rawSort : "last_captured_at";
  const sortDir = url.searchParams.get("dir") === "asc" ? true : false;
  const limit = 20;
  const offset = (page - 1) * limit;

  let query = supabase
    .from("packages")
    .select("*", { count: "exact" })
    .order(sortBy, { ascending: sortDir })
    .range(offset, offset + limit - 1);

  if (ecosystem) query = query.eq("ecosystem", ecosystem);
  if (search) query = query.ilike("name", `%${search}%`);

  const { data, error, count } = await query;

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }

  return new Response(JSON.stringify({
    packages: data,
    total: count,
    page,
    limit
  }), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, s-maxage=30, stale-while-revalidate=15"
    }
  });
}
