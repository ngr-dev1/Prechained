// og-image.js — Dynamic OG image generator for verify page shares
// GET /.netlify/functions/og-image?receipt=NGR-PC-XXXXX
// Returns a 1200x630 SVG/PNG-like response for social sharing previews
// prechained.com · Built by NextGenRails™

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const HEADERS = {
  "Content-Type": "image/svg+xml",
  "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=3600",
  "Access-Control-Allow-Origin": "*",
};

function escapeXml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .slice(0, 80);
}

function truncate(str, max = 40) {
  if (!str) return "Unknown";
  const s = String(str);
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function buildSvg({ packageName, version, ecosystem, receiptId, capturedAt, sha384 }) {
  const dateStr = capturedAt
    ? new Date(capturedAt).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })
    : "Unknown date";
  const shortSha = sha384 ? sha384.slice(0, 24) + "…" : "N/A";
  const shortReceipt = receiptId ? receiptId.slice(0, 26) : "N/A";
  const ecosystemColors = {
    npm: "#cb3837", pypi: "#3572A5", cargo: "#dea584",
    github: "#6e40c9", nuget: "#004880", maven: "#c71a36",
    rubygems: "#e9573f", packagist: "#f28d1a",
  };
  const ecoColor = ecosystemColors[ecosystem?.toLowerCase()] || "#f97316";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1200" y2="630" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#0a0a0a"/>
      <stop offset="100%" stop-color="#111827"/>
    </linearGradient>
    <linearGradient id="accent" x1="0" y1="0" x2="400" y2="0" gradientUnits="userSpaceOnUse">
      <stop offset="0%" stop-color="#f97316"/>
      <stop offset="100%" stop-color="#fb923c"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="1200" height="630" fill="url(#bg)"/>

  <!-- Top accent bar -->
  <rect x="0" y="0" width="1200" height="6" fill="url(#accent)"/>

  <!-- Grid lines (subtle) -->
  <line x1="0" y1="120" x2="1200" y2="120" stroke="#1f2937" stroke-width="1"/>
  <line x1="0" y1="510" x2="1200" y2="510" stroke="#1f2937" stroke-width="1"/>

  <!-- Left column separator -->
  <line x1="720" y1="120" x2="720" y2="510" stroke="#1f2937" stroke-width="1"/>

  <!-- Logo / brand -->
  <text x="72" y="78" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="22" font-weight="800" fill="#f97316">⬡ PRECHAINED</text>
  <text x="72" y="102" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="13" fill="#6b7280">Cryptographic Supply Chain Archive · prechained.com</text>

  <!-- Verified badge top-right -->
  <rect x="1040" y="52" width="120" height="36" rx="18" fill="#16a34a" opacity="0.15"/>
  <rect x="1040" y="52" width="120" height="36" rx="18" fill="none" stroke="#16a34a" stroke-width="1.5"/>
  <text x="1100" y="75" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="13" font-weight="700" fill="#4ade80" text-anchor="middle">✓ VERIFIED</text>

  <!-- Package name (large) -->
  <text x="72" y="195" font-family="'SF Mono',monospace,sans-serif" font-size="48" font-weight="800" fill="#f1f5f9">${escapeXml(truncate(packageName, 28))}</text>

  <!-- Version + ecosystem chip -->
  <rect x="72" y="218" width="${24 + escapeXml(version || "").length * 9 + 20}" height="28" rx="6" fill="${ecoColor}" opacity="0.15"/>
  <rect x="72" y="218" width="${24 + escapeXml(version || "").length * 9 + 20}" height="28" rx="6" fill="none" stroke="${ecoColor}" stroke-width="1"/>
  <text x="84" y="237" font-family="'SF Mono',monospace" font-size="13" fill="${ecoColor}" font-weight="700">v${escapeXml(version || "?")}  ·  ${escapeXml(ecosystem?.toUpperCase() || "?")}</text>

  <!-- Labels + values — left column -->
  <text x="72" y="310" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="12" fill="#6b7280" font-weight="600" letter-spacing="0.08em">RECEIPT ID</text>
  <text x="72" y="336" font-family="'SF Mono',monospace" font-size="15" fill="#e2e8f0">${escapeXml(shortReceipt)}</text>

  <text x="72" y="390" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="12" fill="#6b7280" font-weight="600" letter-spacing="0.08em">SHA-384 FINGERPRINT</text>
  <text x="72" y="416" font-family="'SF Mono',monospace" font-size="14" fill="#a3e635">${escapeXml(shortSha)}</text>

  <text x="72" y="466" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="12" fill="#6b7280" font-weight="600" letter-spacing="0.08em">ARCHIVED</text>
  <text x="72" y="492" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="15" fill="#e2e8f0">${escapeXml(dateStr)}</text>

  <!-- Right column — Receipt -->
    <text x="756" y="195" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="12" fill="#6b7280" font-weight="600" letter-spacing="0.08em">RECEIPT ID</text>
    <text x="756" y="235" font-family="'SF Mono',monospace" font-size="16" font-weight="700" fill="#1a1a1a">${escapeXml((receiptId||'').substring(0,18))}</text>
    <text x="756" y="265" font-family="'SF Mono',monospace" font-size="14" fill="#6b7280">${escapeXml((receiptId||'').substring(18))}</text>
    <!-- Trust statement -->
  <text x="756" y="390" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="13" fill="#4b5563" font-style="italic">Trust is not declared.</text>
  <text x="756" y="412" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="13" fill="#4b5563" font-style="italic">It is computed.</text>

  <!-- Bottom bar -->
  <text x="72" y="548" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="12" fill="#374151">prechained.com/verify?receipt=${escapeXml(receiptId || "")}</text>
  <text x="1128" y="548" font-family="-apple-system,BlinkMacSystemFont,sans-serif" font-size="12" fill="#374151" text-anchor="end">NextGenRails™</text>
</svg>`;
}

export default async function handler(req) {
  const url = new URL(req.url);
  const receiptId = url.searchParams.get("receipt") || url.searchParams.get("r");

  if (!receiptId) {
    // Generic OG image — no receipt specified
    const svg = buildSvg({
      packageName: "prechained.com",
      version: "open",
      ecosystem: "archive",
      receiptId: null,
      capturedAt: null,
      sha384: null,
    });
    return new Response(svg, { headers: HEADERS });
  }

  try {
    const { data } = await supabase
      .from("snapshots")
      .select(`
        receipt_id, version, ecosystem, sha384_fingerprint,
        btc_block, captured_at,
        packages!inner(name)
      `)
      .eq("receipt_id", receiptId)
      .limit(1)
      .single();

    if (!data) {
      // Not found — return a "not found" OG image rather than 404
      const svg = buildSvg({
        packageName: "Receipt not found",
        version: "?",
        ecosystem: "unknown",
        receiptId,
        capturedAt: null,
        sha384: null,
      });
      return new Response(svg, { headers: HEADERS });
    }

    const svg = buildSvg({
      packageName: data.packages?.name || "Unknown",
      version: data.version,
      ecosystem: data.ecosystem,
      receiptId: data.receipt_id,
      capturedAt: data.captured_at,
      sha384: data.sha384_fingerprint,
    });

    return new Response(svg, { headers: HEADERS });
  } catch (e) {
    const svg = buildSvg({
      packageName: "prechained.com",
      version: "archive",
      ecosystem: "multi",
      receiptId,
      capturedAt: null,
      sha384: null,
    });
    return new Response(svg, { headers: HEADERS });
  }
}
