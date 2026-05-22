import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";
import { createHash } from "crypto";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const SEED_PACKAGES = [
  "express","lodash","axios","react","vue","next","nuxt","webpack","babel",
  "typescript","eslint","prettier","jest","mocha","chalk","commander","dotenv",
  "moment","dayjs","uuid","nodemon","cors","helmet","bcrypt","jsonwebtoken",
  "mongoose","sequelize","prisma","socket.io","ws","tar","semver","glob",
  "rimraf","cross-env","concurrently","husky","lint-staged","node-fetch",
  "crypto-js","sharp","multer","morgan","body-parser","compression","cookie-parser",
  "passport","joi","yup","zod"
];

function sha384(data) {
  return createHash("sha384").update(data).digest("hex");
}

function generateReceiptId() {
  return "NGR-PC-" + Date.now().toString(36).toUpperCase() +
    Math.random().toString(36).substring(2,8).toUpperCase();
}

async function submitToOpenTimestamps(fingerprint) {
  try {
    const hashBytes = Buffer.from(fingerprint, "hex");
    const res = await fetch("https://a.pool.opentimestamps.org/digest", {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: hashBytes
    });
    if (!res.ok) return null;
    const otsData = await res.buffer();
    return otsData.toString("base64");
  } catch(e) {
    console.error("OTS submission failed:", e.message);
    return null;
  }
}

async function fetchNpmPackage(name) {
  const res = await fetch(`https://registry.npmjs.org/${name}`);
  if (!res.ok) return null;
  return res.json();
}

async function processPackage(name) {
  try {
    const data = await fetchNpmPackage(name);
    if (!data) return;

    const latest = data["dist-tags"]?.latest;
    if (!latest) return;

    const versionData = data.versions?.[latest];
    if (!versionData) return;

    const description = data.description || "";
    const totalVersions = Object.keys(data.versions || {}).length;

    const { data: pkg, error: pkgError } = await supabase
      .from("packages")
      .upsert({
        name,
        ecosystem: "npm",
        description,
        latest_version: latest,
        total_versions: totalVersions,
        last_captured_at: new Date().toISOString()
      }, { onConflict: "name,ecosystem" })
      .select()
      .single();

    if (pkgError || !pkg) return;

    const { data: existing } = await supabase
      .from("snapshots")
      .select("id")
      .eq("package_id", pkg.id)
      .eq("version", latest)
      .single();

    if (existing) return;

    const payload = JSON.stringify({
      name,
      version: latest,
      ecosystem: "npm",
      integrity: versionData.dist?.integrity || "",
      shasum: versionData.dist?.shasum || "",
      dependencies: versionData.dependencies || {},
      timestamp: new Date().toISOString()
    });

    const fingerprint = sha384(payload);
    const receiptId = generateReceiptId();

    // Submit to OpenTimestamps for Bitcoin anchoring
    const otsProof = await submitToOpenTimestamps(fingerprint);

    await supabase.from("snapshots").insert({
      package_id: pkg.id,
      version: latest,
      ecosystem: "npm",
      sha384_fingerprint: fingerprint,
      receipt_id: receiptId,
      btc_anchored: false,
      ots_proof: otsProof,
      raw_metadata: {
        integrity: versionData.dist?.integrity,
        shasum: versionData.dist?.shasum,
        dependencies: versionData.dependencies || {}
      }
    });

    console.log(`Captured: ${name}@${latest} | ${fingerprint.substring(0,16)}... | OTS: ${otsProof ? 'submitted' : 'failed'}`);

  } catch(err) {
    console.error(`Error processing ${name}:`, err.message);
  }
}

export default async function handler(req, context) {
  console.log("Crawler running at", new Date().toISOString());

  for (const pkg of SEED_PACKAGES) {
    await processPackage(pkg);
  }

  return new Response(JSON.stringify({
    ok: true,
    processed: SEED_PACKAGES.length,
    timestamp: new Date().toISOString()
  }), {
    headers: { "Content-Type": "application/json" }
  });
}
