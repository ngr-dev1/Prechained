// webhooks.js — Prechained Webhook & Alert Subscription API
// Paid tier: notify security teams when monitored packages get new versions or fingerprint changes
//
// POST /.netlify/functions/webhooks/subscribe   — create subscription
// GET  /.netlify/functions/webhooks/list        — list my subscriptions (by api_key)
// DELETE /.netlify/functions/webhooks/cancel    — cancel subscription
// POST /.netlify/functions/webhooks/deliver     — internal: deliver pending alerts (called by crawler)
//
// Supabase tables required:
//   webhook_subscriptions(id, api_key, webhook_url, packages jsonb, ecosystems jsonb,
//     alert_types jsonb, plan text, created_at, active bool, last_delivered_at)
//   webhook_deliveries(id, subscription_id, payload jsonb, delivered_at, status text, http_status int)
//
// prechained.com · Built by NextGenRails™

import { createClient } from "@supabase/supabase-js";
import { createHash, randomBytes } from "crypto";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const CORS = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, X-API-Key",
};

// Plans — matches roadmap pricing
const PLANS = {
  starter:    { price: 49,  label: "Starter",    max_packages: 1,   max_projects: 1 },
  pro:        { price: 199, label: "Pro",         max_packages: 5,   max_projects: 5 },
  unlimited:  { price: 499, label: "Unlimited",   max_packages: 999, max_projects: 999 },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data, null, 2), { status, headers: CORS });
}
function err(msg, status = 400) {
  return json({ error: msg }, status);
}
function generateApiKey() {
  return "pk_live_" + randomBytes(20).toString("hex");
}

// ── ROUTE DISPATCHER ─────────────────────────────────────────
export default async function handler(req) {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const url = new URL(req.url);
  const path = url.pathname.split("/").pop(); // last segment
  const apiKey = req.headers.get("x-api-key") || url.searchParams.get("api_key");

  // ── POST /subscribe ─────────────────────────────────────────
  if (req.method === "POST" && path === "subscribe") {
    let body;
    try { body = await req.json(); } catch { return err("Invalid JSON"); }

    const { webhook_url, packages, ecosystems, alert_types, plan, email } = body;

    if (!webhook_url) return err("webhook_url is required");
    if (!packages || !Array.isArray(packages) || packages.length === 0)
      return err("packages must be a non-empty array");
    if (!plan || !PLANS[plan]) return err(`plan must be one of: ${Object.keys(PLANS).join(", ")}`);

    const planConfig = PLANS[plan];
    if (packages.length > planConfig.max_packages)
      return err(`${plan} plan supports up to ${planConfig.max_packages} package(s). Upgrade for more.`);

    // Validate webhook URL
    try { new URL(webhook_url); } catch { return err("webhook_url must be a valid URL"); }
    if (!webhook_url.startsWith("https://"))
      return err("webhook_url must use HTTPS");

    const newApiKey = generateApiKey();
    const { data: sub, error } = await supabase
      .from("webhook_subscriptions")
      .insert({
        api_key: newApiKey,
        webhook_url,
        packages: packages.map(p => p.toLowerCase()),
        ecosystems: (ecosystems || ["npm", "pypi", "cargo", "github", "nuget", "maven", "rubygems", "packagist"]),
        alert_types: (alert_types || ["NEW_VERSION", "FINGERPRINT_MISMATCH", "TYPOSQUAT", "HIGH_VELOCITY", "CROSS_ECOSYSTEM"]),
        plan,
        email: email || null,
        active: true,
        created_at: new Date().toISOString(),
      })
      .select("id, api_key, plan, packages, webhook_url, created_at")
      .single();

    if (error) {
      console.error("webhook subscribe error:", error.message);
      return err("Failed to create subscription", 500);
    }

    return json({
      ok: true,
      subscription_id: sub.id,
      api_key: sub.api_key,
      plan: sub.plan,
      plan_details: PLANS[plan],
      packages: sub.packages,
      webhook_url: sub.webhook_url,
      created_at: sub.created_at,
      note: "Save your api_key — it cannot be recovered. Use it in X-API-Key header to manage this subscription.",
      pricing_note: `${PLANS[plan].label} plan — $${PLANS[plan].price}/mo. Contact ngr.admin@proton.me for billing.`,
    });
  }

  // ── GET /list ────────────────────────────────────────────────
  if (req.method === "GET" && path === "list") {
    if (!apiKey) return err("X-API-Key header required", 401);

    const { data: subs, error } = await supabase
      .from("webhook_subscriptions")
      .select("id, plan, packages, ecosystems, alert_types, webhook_url, active, created_at, last_delivered_at")
      .eq("api_key", apiKey);

    if (error) return err("Failed to fetch subscriptions", 500);
    if (!subs || subs.length === 0) return json({ subscriptions: [], count: 0 });

    return json({ subscriptions: subs, count: subs.length });
  }

  // ── DELETE /cancel ───────────────────────────────────────────
  if (req.method === "DELETE" && path === "cancel") {
    if (!apiKey) return err("X-API-Key header required", 401);

    const subscriptionId = url.searchParams.get("id");
    const query = supabase
      .from("webhook_subscriptions")
      .update({ active: false })
      .eq("api_key", apiKey);

    if (subscriptionId) query.eq("id", subscriptionId);

    const { error } = await query;
    if (error) return err("Failed to cancel subscription", 500);

    return json({ ok: true, cancelled: true });
  }

  // ── POST /deliver ─────────────────────────────────────────────
  // Internal endpoint — called by crawler/capture after detecting an alert condition
  if (req.method === "POST" && path === "deliver") {
    // Only callable internally (from other Netlify functions via same env)
    const internalSecret = req.headers.get("x-internal-secret");
    if (internalSecret !== process.env.INTERNAL_WEBHOOK_SECRET) {
      return err("Unauthorized", 401);
    }

    let body;
    try { body = await req.json(); } catch { return err("Invalid JSON"); }

    const { package_name, ecosystem, alert_type, version, sha384, receipt_id, detail } = body;
    if (!package_name || !ecosystem || !alert_type) return err("package_name, ecosystem, alert_type required");

    // Find active subscriptions watching this package + ecosystem + alert type
    const { data: subs } = await supabase
      .from("webhook_subscriptions")
      .select("id, webhook_url, alert_types")
      .eq("active", true)
      .contains("packages", [package_name.toLowerCase()])
      .contains("ecosystems", [ecosystem.toLowerCase()]);

    if (!subs || subs.length === 0) return json({ ok: true, delivered: 0 });

    const payload = {
      source: "prechained.com",
      event: alert_type,
      package: package_name,
      ecosystem,
      version: version || null,
      sha384: sha384 || null,
      receipt_id: receipt_id || null,
      detail: detail || null,
      verify_url: receipt_id ? `https://prechained.com/verify?receipt=${receipt_id}` : null,
      timestamp: new Date().toISOString(),
    };

    let delivered = 0;
    for (const sub of subs) {
      if (!sub.alert_types.includes(alert_type)) continue;
      try {
        const res = await fetch(sub.webhook_url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "User-Agent": "Prechained-Alerts/1.0" },
          body: JSON.stringify(payload),
        });

        await supabase.from("webhook_deliveries").insert({
          subscription_id: sub.id,
          payload,
          delivered_at: new Date().toISOString(),
          status: res.ok ? "delivered" : "failed",
          http_status: res.status,
        });

        if (res.ok) {
          delivered++;
          await supabase
            .from("webhook_subscriptions")
            .update({ last_delivered_at: new Date().toISOString() })
            .eq("id", sub.id);
        }
      } catch (e) {
        console.error(`[webhook] delivery failed for sub ${sub.id}:`, e.message);
        await supabase.from("webhook_deliveries").insert({
          subscription_id: sub.id,
          payload,
          delivered_at: new Date().toISOString(),
          status: "error",
          http_status: null,
        });
      }
    }

    return json({ ok: true, delivered, total_matching: subs.length });
  }

  // ── GET /plans ────────────────────────────────────────────────
  if (req.method === "GET" && path === "plans") {
    return json({
      plans: Object.entries(PLANS).map(([key, p]) => ({
        id: key,
        label: p.label,
        price_per_month: p.price,
        max_packages: p.max_packages,
        features: [
          `Monitor up to ${p.max_packages === 999 ? "unlimited" : p.max_packages} package(s)`,
          "Real-time webhook alerts",
          "Alerts: new version, fingerprint mismatch, typosquat, high velocity, cross-ecosystem",
          "All 8 ecosystems",
          "HTTPS delivery with retry",
        ],
      })),
      contact: "ngr.admin@proton.me",
      note: "Free tier available via Prechained public API — webhooks are paid tier only.",
    });
  }

  return err("Not found. Valid paths: /subscribe, /list, /cancel, /deliver, /plans", 404);
}
