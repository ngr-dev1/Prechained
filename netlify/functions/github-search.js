// github-search.js — Search the prechained-archive GitHub repo by package name
// Returns results in the same shape as packages.js for seamless merging in Browse
// prechained.com · Built by NextGenRails™

const GITHUB_TOKEN = process.env.GITHUB_ARCHIVE_TOKEN;
const GITHUB_REPO = process.env.GITHUB_ARCHIVE_REPO || "ngr-dev1/prechained-archive";

export default async function handler(req) {
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") || "").trim();
  const ecosystem = url.searchParams.get("ecosystem") || null;

  if (!q || q.length < 2) {
    return json({ packages: [], total: 0, source: "github" });
  }

  if (!GITHUB_TOKEN) {
    return json({ packages: [], total: 0, source: "github", error: "No GitHub token" });
  }

  try {
    // GitHub code search: search for paths matching the query in the archive repo
    // The archive structure is: {ecosystem}/{package-name}/{version}/manifest.json
    // We search for the package name in the path
    let searchQuery = `repo:${GITHUB_REPO} path:manifest.json filename:manifest.json "${q}" in:path`;
    if (ecosystem) {
      searchQuery = `repo:${GITHUB_REPO} path:${ecosystem}/${q} filename:manifest.json`;
    }

    const searchRes = await fetch(
      `https://api.github.com/search/code?q=${encodeURIComponent(searchQuery)}&per_page=30`,
      {
        headers: {
          Authorization: `token ${GITHUB_TOKEN}`,
          Accept: "application/vnd.github.v3+json",
          "User-Agent": "Prechained/1.0"
        }
      }
    );

    if (!searchRes.ok) {
      const err = await searchRes.text();
      console.error("GitHub search error:", searchRes.status, err);
      return json({ packages: [], total: 0, source: "github", error: `GitHub API ${searchRes.status}` });
    }

    const data = await searchRes.json();
    const items = data.items || [];

    // Parse paths: ecosystem/package-name/version/manifest.json
    // Group by ecosystem+name, collect versions
    const pkgMap = new Map();

    for (const item of items) {
      // item.path = "npm/lodash/4.17.21/manifest.json"
      const parts = item.path.split("/");
      if (parts.length < 4) continue; // unexpected structure

      const eco = parts[0];
      // For scoped packages like @scope/name, the path is npm/@scope/name/version/manifest.json
      // parts would be: ["npm", "@scope", "name", "version", "manifest.json"] — 5 parts
      // vs unscoped: ["npm", "lodash", "4.17.21", "manifest.json"] — 4 parts
      let pkgName, version;
      if (parts.length === 5 && parts[1].startsWith("@")) {
        pkgName = `${parts[1]}/${parts[2]}`;
        version = parts[3];
      } else {
        pkgName = parts[1];
        version = parts[2];
      }

      // Filter by ecosystem if requested
      if (ecosystem && eco !== ecosystem) continue;

      // Filter: package name must actually contain the search query (case-insensitive)
      if (!pkgName.toLowerCase().includes(q.toLowerCase())) continue;

      const key = `${eco}::${pkgName}`;
      if (!pkgMap.has(key)) {
        pkgMap.set(key, {
          id: null, // no Supabase ID — archive only
          name: pkgName,
          ecosystem: eco,
          description: null,
          latest_version: version,
          total_versions: 1,
          last_captured_at: item.repository?.updated_at || null,
          raw_metadata: {},
          _source: "github", // flag for browse to show "Archive only" badge
          _archive_path: item.html_url
        });
      } else {
        // Already seen this package — just increment version count
        pkgMap.get(key).total_versions += 1;
      }
    }

    const packages = [...pkgMap.values()];

    return json({
      packages,
      total: packages.length,
      total_github_hits: data.total_count || 0,
      source: "github"
    });

  } catch (err) {
    console.error("github-search error:", err);
    return json({ packages: [], total: 0, source: "github", error: err.message });
  }
}

function json(data) {
  return new Response(JSON.stringify(data), {
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, s-maxage=60, stale-while-revalidate=30"
    }
  });
}
