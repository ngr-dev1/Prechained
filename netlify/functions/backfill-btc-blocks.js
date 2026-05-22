import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Get the Bitcoin block height at a specific Unix timestamp
async function getBtcBlockAtTime(unixTimestamp) {
  try {
    // Blockstream API: get blocks around a specific timestamp
    const res = await fetch(
      `https://mempool.space/api/v1/mining/blocks/timestamp/${unixTimestamp}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    return data?.height || null;
  } catch(e) {
    return null;
  }
}

export default async function handler(req, context) {
  console.log("BTC block backfill running at", new Date().toISOString());

  // Get all snapshots that have btc_block = 950561 (the bulk-assigned wrong block)
  // Process in batches of 100 to avoid timeout
  const { data: snapshots, error } = await supabase
    .from("snapshots")
    .select("id, captured_at, btc_block")
    .eq("btc_block", 950561)
    .limit(100);

  if (error || !snapshots?.length) {
    return new Response(JSON.stringify({
      ok: true, message: "No snapshots to backfill", count: 0
    }), { headers: { "Content-Type": "application/json" } });
  }

  console.log("Backfilling", snapshots.length, "snapshots");

  let updated = 0;
  const blockCache = {};

  for (const snap of snapshots) {
    const unixTs = Math.floor(new Date(snap.captured_at).getTime() / 1000);
    // Round to nearest 10 minutes to cache block lookups
    const roundedTs = Math.floor(unixTs / 600) * 600;

    if (!blockCache[roundedTs]) {
      const block = await getBtcBlockAtTime(roundedTs);
      blockCache[roundedTs] = block;
      // Small delay to avoid rate limiting
      await new Promise(r => setTimeout(r, 200));
    }

    const exactBlock = blockCache[roundedTs];
    if (exactBlock && exactBlock !== snap.btc_block) {
      await supabase
        .from("snapshots")
        .update({ btc_block: exactBlock })
        .eq("id", snap.id);
      updated++;
    }
  }

  console.log("Updated:", updated);

  return new Response(JSON.stringify({
    ok: true,
    processed: snapshots.length,
    updated,
    timestamp: new Date().toISOString()
  }), { headers: { "Content-Type": "application/json" } });
}
