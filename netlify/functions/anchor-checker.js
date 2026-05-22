import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function getCurrentBtcBlock() {
  try {
    const res = await fetch("https://blockstream.info/api/blocks/tip/height");
    if (!res.ok) return null;
    return parseInt((await res.text()).trim());
  } catch(e) { return null; }
}

export default async function handler(req, context) {
  console.log("Anchor checker running at", new Date().toISOString());

  const currentBlock = await getCurrentBtcBlock();
  if (!currentBlock) {
    return new Response(JSON.stringify({ ok: false, error: "Could not fetch BTC block" }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  console.log("Current BTC block:", currentBlock);

  // Update ALL unanchored snapshots directly without fetching IDs first
  const { error, count } = await supabase
    .from("snapshots")
    .update({ btc_anchored: true, btc_block: currentBlock })
    .eq("btc_anchored", false);

  const anchored = error ? 0 : (count || 0);
  console.log("Anchored:", anchored, "Error:", error?.message);

  return new Response(JSON.stringify({
    ok: !error,
    current_block: currentBlock,
    anchored,
    error: error?.message || null,
    timestamp: new Date().toISOString()
  }), { headers: { "Content-Type": "application/json" } });
}
