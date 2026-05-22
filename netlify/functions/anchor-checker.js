import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function getCurrentBtcBlock() {
  try {
    const res = await fetch("https://blockstream.info/api/blocks/tip/height");
    if (!res.ok) return null;
    const height = await res.text();
    return parseInt(height.trim());
  } catch(e) {
    console.error("Failed to fetch BTC block:", e.message);
    return null;
  }
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

  // Anchor all unanchored snapshots older than 10 minutes to the current block
  const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

  const { data: pending, error } = await supabase
    .from("snapshots")
    .select("id")
    .eq("btc_anchored", false)
    .lt("captured_at", tenMinutesAgo)
    .limit(500);

  if (error || !pending?.length) {
    return new Response(JSON.stringify({
      ok: true, current_block: currentBlock, anchored: 0
    }), { headers: { "Content-Type": "application/json" } });
  }

  console.log("Anchoring", pending.length, "snapshots to block", currentBlock);

  const ids = pending.map(s => s.id);

  const { error: updateError } = await supabase
    .from("snapshots")
    .update({ btc_anchored: true, btc_block: currentBlock })
    .in("id", ids);

  const anchored = updateError ? 0 : ids.length;
  console.log("Anchored:", anchored);

  return new Response(JSON.stringify({
    ok: true,
    current_block: currentBlock,
    anchored,
    timestamp: new Date().toISOString()
  }), { headers: { "Content-Type": "application/json" } });
}
