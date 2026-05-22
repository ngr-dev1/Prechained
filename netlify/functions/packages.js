import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req) {
  const url = new URL(req.url);
  const ecosystem = url.searchParams.get("ecosystem") || null;
  const search = url.searchParams.get("q") || null;
  const page = parseInt(url.searchParams.get("page") || "1");
  const limit = 20;
  const offset = (page - 1) * limit;

  let query = supabase
    .from("packages")
    .select("*", { count: "exact" })
    .order("last_captured_at", { ascending: false })
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
      "Access-Control-Allow-Origin": "*"
    }
  });
}
