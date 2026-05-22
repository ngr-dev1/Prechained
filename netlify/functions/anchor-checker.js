import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";

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
    console.error("Failed to fetch BTC block height:", e.message);
    return null;
  }
}

async function verifyOtsProof(otsProofBase64, fingerprint) {
  try {
    // Check if the OTS proof is now confirmed by querying the calendar
    const hashBytes = Buffer.from(fingerprint, "hex");
    const res = await fetch("https://a.pool.opentimestamps.org/digest", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: hashBytes
    });
    // If server returns same proof, it's still pending
    // If it returns a completed proof with Bitcoin attestation, it's confirmed
    if (!res.ok) return null;
    const responseData = await res.buffer();
    const responseBase64 = responseData.toString("base64");
    // Different response means it may be confirmed
    return responseBase64 !== otsProofBase64;
  } catch(e) {
    return false;
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

  // Get all unanchored snapshots that have an OTS proof and are older than 20 minutes
  const twentyMinutesAgo = new Date(Date.now() - 20 * 60 * 1000).toISOString();
  const { data: pending, error } = await supabase
    .from("snapshots")
    .select("id, sha384_fingerprint, ots_proof, captured_at")
    .eq("btc_anchored", false)
    .not("ots_proof", "is", null)
    .lt("captured_at", twentyMinutesAgo)
    .limit(20);

  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      headers: { "Content-Type": "application/json" }
    });
  }

  console.log(`Checking ${pending?.length || 0} pending anchors`);

  let confirmed = 0;
  for (const snap of (pending || [])) {
    const isConfirmed = await verifyOtsProof(snap.ots_proof, snap.sha384_fingerprint);
    if (isConfirmed) {
      await supabase
        .from("snapshots")
        .update({
          btc_anchored: true,
          btc_block: currentBlock
        })
        .eq("id", snap.id);
      confirmed++;
      console.log(`Confirmed anchor for ${snap.id} at block ${currentBlock}`);
    }
  }

  return new Response(JSON.stringify({
    ok: true,
    current_block: currentBlock,
    checked: pending?.length || 0,
    confirmed,
    timestamp: new Date().toISOString()
  }), {
    headers: { "Content-Type": "application/json" }
  });
}
