// backfill-github.mjs
// Bulk GitHub backfill — processes as many rows as possible within timeout
// Deploy to netlify/functions/ in prechained repo
// Trigger via: https://prechained.com/.netlify/functions/backfill-github
// prechained.com · Built by NextGenRails™

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const GITHUB_TOKEN = process.env.GITHUB_ARCHIVE_TOKEN;
const GITHUB_REPO = process.env.GITHUB_ARCHIVE_REPO || "ngr-dev1/prechained-archive";

// Fetch in pages of 500, process concurrently in batches of 10
const PAGE_SIZE = 500;
const CONCURRENCY = 10;
const MAX_RUNTIME_MS = 22000; // Stop at 22s to safely return before Netlify 26s timeout

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
      const err = await res.json();
      if (err.message && err.message.includes("already exists")) return path;
      return null;
    }
    return path;
  } catch(e) {
    return null;
  }
}

async function processRow(row) {
  const pkg = row.packages;
  if (!pkg || !row.raw_metadata) return { id: row.id, result: "skipped" };

  const manifestPath = await storeManifestInGithub(
    pkg.ecosystem, pkg.name, row.version, row.raw_metadata
  );

  if (manifestPath) {
    await supabase.from("snapshots").update({ manifest_path: manifestPath }).eq("id", row.id);
    return { id: row.id, result: "archived" };
  }
  return { id: row.id, result: "error" };
}

async function processBatch(rows) {
  const results = await Promise.all(rows.map(processRow));
  return results;
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
  let pageOffset = 0;

  try {
    while (true) {
      // Stop if approaching timeout
      if (Date.now() - startTime > MAX_RUNTIME_MS) break;

      // Fetch next page
      const { data: rows, error } = await supabase
        .from("snapshots")
        .select("id, version, raw_metadata, packages(name, ecosystem)")
        .is("manifest_path", null)
        .not("raw_metadata", "is", null)
        .range(pageOffset, pageOffset + PAGE_SIZE - 1);

      if (error || !rows || rows.length === 0) break;

      // Process in concurrent batches of CONCURRENCY
      for (let i = 0; i < rows.length; i += CONCURRENCY) {
        if (Date.now() - startTime > MAX_RUNTIME_MS) break;
        const batch = rows.slice(i, i + CONCURRENCY);
        const results = await processBatch(batch);
        for (const r of results) {
          totalProcessed++;
          if (r.result === "archived") totalArchived++;
          else if (r.result === "skipped") totalSkipped++;
          else totalErrors++;
        }
      }

      // If we got a full page, continue to next page
      if (rows.length < PAGE_SIZE) break;
      pageOffset += PAGE_SIZE;
    }

    // Get remaining count
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
