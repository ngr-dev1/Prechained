// source.js — Live Crawler Source Inspector
// Serves the actual source code of any crawler function
// with its SHA-384 fingerprint so anyone can verify
// what code produced any given receipt
// prechained.com · Built by NextGenRails™

import { createHash } from "crypto";
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

const CRAWLERS = [
  "crawler-all",
  "_shared",
];

function sha384(data) {
  return createHash("sha384").update(data).digest("hex");
}

export default async function handler(req) {
  const url = new URL(req.url);
  const file = url.searchParams.get("file");

  // List all available crawler sources with their current fingerprints
  if (!file) {
    const index = [];
    for (const name of CRAWLERS) {
      const path = join(__dirname, `${name}.js`);
      if (!existsSync(path)) continue;
      try {
        const src = readFileSync(path, "utf8");
        const fingerprint = sha384(src);
        const lines = src.split("\n").length;
        index.push({
          file: `${name}.js`,
          sha384: fingerprint,
          lines,
          description: src.split("\n").find(l => l.startsWith("//") && l.length > 4)?.replace("// ", "") || "",
          view_url: `/.netlify/functions/source?file=${name}.js`,
          raw_url: `https://raw.githubusercontent.com/ngr-dev1/prechained/main/netlify/functions/${name}.js`
        });
      } catch(e) {}
    }

    return new Response(JSON.stringify({
      description: "Live crawler source index. Every SHA-384 here can be cross-referenced with the crawler_sha384 field on any receipt.",
      note: "Trust is not declared. It is computed. Verify for yourself.",
      crawlers: index,
      timestamp: new Date().toISOString()
    }, null, 2), { headers: { ...CORS, "Content-Type": "application/json" } });
  }

  // Serve a specific crawler file
  const safeName = file.replace(/[^a-zA-Z0-9_\-\.]/g, "");
  if (!safeName.endsWith(".js") || !CRAWLERS.some(c => `${c}.js` === safeName)) {
    return new Response(JSON.stringify({ error: "File not found" }), { status: 404, headers: CORS });
  }

  const path = join(__dirname, safeName);
  if (!existsSync(path)) {
    return new Response(JSON.stringify({ error: "File not found on disk" }), { status: 404, headers: CORS });
  }

  try {
    const src = readFileSync(path, "utf8");
    const fingerprint = sha384(src);

    // Return as JSON with metadata, or raw source if ?raw=1
    if (url.searchParams.get("raw") === "1") {
      return new Response(src, {
        headers: {
          "Content-Type": "text/plain; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
          "X-SHA384": fingerprint,
          "Cache-Control": "no-store"
        }
      });
    }

    return new Response(JSON.stringify({
      file: safeName,
      sha384: fingerprint,
      lines: src.split("\n").length,
      bytes: src.length,
      source: src,
      verify_note: `Compute SHA-384 of the 'source' field and compare to 'sha384' to independently verify this file has not been tampered with.`,
      raw_url: `/.netlify/functions/source?file=${safeName}&raw=1`,
      github_url: `https://github.com/ngr-dev1/prechained/blob/main/netlify/functions/${safeName}`,
      timestamp: new Date().toISOString()
    }, null, 2), { headers: CORS });
  } catch(e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: CORS });
  }
}
