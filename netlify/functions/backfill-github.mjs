// backfill-github.mjs
// Bulk GitHub backfill — rate-limit safe version
// Concurrency: 3, with 500ms delay between batches
// Each call processes ~100-150 rows safely
// prechained.com · Built by NextGenRails™

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const GITHUB_TOKEN = process.env.GITHUB_ARCHIVE_TOKEN;
const GITHUB_REPO = process.env.GITHUB_ARCHIVE_REPO || "ngr-dev1/prechained-archive";
const PAGE_SIZE = 300;
const CONCURRENCY = 3;
const BATCH_DELAY_MS = 500;
const MAX_RUNTIME_MS = 20000;

async function storeManifestInGithub(ecosystem, name, version, manifest) {
  if (!GITHUB_TOKEN || !manifest) return null;
  try {
    const safeName = name.replace(/\//g, "__").replace(/@/g, "at");
    const path = `${ecosystem}/${safeName}/${version}/manifest.json`;
    const content = Buffer.from(JSON.stringify(manifest, null, 2)).toString("base64");

    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/contents/${path}`, {
      method: "PUT",
      headers: {
        "Authorization": `token ${GITHUB_TOKEN}`,
        "Content-Type": "application/json",
        "User-Agent": "prechained.com/1.0"
      },
      body: JSON.stringify({
        message: `Backfill: ${ecosystem}/${name}@${version}`,
        content
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      if (err.message && err.message.includes("already exists")) return path;
      console.error(`GitHub error for ${path}: ${res.status} ${err.message}`);
      return null;
    }
    return path;
  } catch(e) {
    console.error("GitHub store failed:", e.message);
    return null;
  }
}

export default async function handler(req) {
  const CORS = { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" };

  if (!GITHUB_TOKEN) {
    return new Response(JSON.stringify({ error: "GITHUB_ARCHIVE_TOKEN not set" }), { status: 500, headers: CORS });
  }

  const startTime = Date.now();
  let totalProcessed = 0;
  let totalArchived = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  try {
    const { data: rows, error } = await supabase
      .from("snapshots")
      .select("id, version, raw_metadata, packages(name, ecosystem)")
      .is("manifest_path", null)
      .not("raw_metadata", "is", null)
      .limit(PAGE_SIZE);

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500, headers: CORS });
    }

    if (!rows || rows.length === 0) {
      const { count } = await supabase
        .from("snapshots")
        .select("id", { count: "exact", head: true })
        .is("manifest_path", null);
      return new Response(JSON.stringify({
        ok: true,
        message: "Backfill complete!",
        remaining_unarchived: count || 0
      }), { headers: CORS });
    }

    // Process in small concurrent batches with delays
    for (let i = 0; i < rows.length; i += CONCURRENCY) {
      if (Date.now() - startTime > MAX_RUNTIME_MS) break;

      const batch = rows.slice(i, i + CONCURRENCY);
      const results = await Promise.all(batch.map(async (row) => {
        const pkg = row.packages;
        if (!pkg || !row.raw_metadata) return "skipped";

        const manifestPath = await storeManifestInGithub(
          pkg.ecosystem, pkg.name, row.version, row.raw_metadata
        );

        if (manifestPath) {
          await supabase.from("snapshots").update({ manifest_path: manifestPath }).eq("id", row.id);
          return "archived";
        }
        return "error";
      }));

      for (const r of results) {
        totalProcessed++;
        if (r === "archived") totalArchived++;
        else if (r === "skipped") totalSkipped++;
        else totalErrors++;
      }

      // Rate limit safety delay between batches
      await new Promise(r => setTimeout(r, BATCH_DELAY_MS));
    }

    const { count: remaining } = await supabase
      .from("snapshots")
      .select("id", { count: "exact", head: true })
      .is("manifest_path", null);

    return new Response(JSON.stringify({
      ok: true,
      processed: totalProcessed,
      archived: totalArchived,
      skipped: totalSkipped,
      errors: totalErrors,
      remaining_unarchived: remaining || 0,
      elapsed_ms: Date.now() - startTime,
      note: (remaining || 0) > 0
        ? `Hit this endpoint again to continue. ${remaining} rows remaining.`
        : "Backfill complete!"
    }), { headers: CORS });

  } catch(e) {
    return new Response(JSON.stringify({
      error: e.message,
      processed: totalProcessed,
      archived: totalArchived,
      elapsed_ms: Date.now() - startTime
    }), { status: 500, headers: CORS });
  }
}
