import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";
import { createHash } from "crypto";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

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
    return null;
  }
}

async function getTopNpmPackages() {
  try {
    // Fetch top downloaded packages from npm registry
    const res = await fetch(
      "https://registry.npmjs.org/-/v1/search?text=not:unstable&size=250&popularity=1.0",
      { headers: { "Accept": "application/json" } }
    );
    if (!res.ok) throw new Error("npm search failed");
    const data = await res.json();
    return data.objects?.map(o => o.package.name) || [];
  } catch(e) {
    console.error("Failed to fetch top packages:", e.message);
    // Fallback expanded list
    return [
      "express","lodash","axios","react","vue","next","nuxt","webpack","babel",
      "typescript","eslint","prettier","jest","mocha","chalk","commander","dotenv",
      "moment","dayjs","uuid","nodemon","cors","helmet","bcrypt","jsonwebtoken",
      "mongoose","sequelize","prisma","socket.io","ws","tar","semver","glob",
      "rimraf","cross-env","concurrently","husky","lint-staged","node-fetch",
      "crypto-js","sharp","multer","morgan","body-parser","compression",
      "cookie-parser","passport","joi","yup","zod","fastify","koa","hapi",
      "rxjs","ramda","immutable","immer","mobx","redux","recoil","zustand",
      "graphql","apollo-server","prisma","typeorm","knex","objection",
      "jest","vitest","cypress","playwright","puppeteer","selenium-webdriver",
      "webpack","vite","rollup","parcel","esbuild","swc","turbopack",
      "tailwindcss","postcss","sass","less","styled-components","emotion",
      "three","d3","chart.js","echarts","recharts","victory","nivo",
      "date-fns","luxon","dayjs","moment-timezone","chrono-node",
      "lodash","ramda","underscore","fp-ts","zod","io-ts","runtypes",
      "winston","pino","bunyan","log4js","debug","loglevel",
      "redis","ioredis","bull","agenda","node-cron","bee-queue",
      "stripe","paypal-rest-sdk","braintree","square","plaid",
      "aws-sdk","@google-cloud/storage","azure-storage","cloudinary",
      "nodemailer","sendgrid","mailgun-js","postmark","ses",
      "passport-jwt","passport-local","jsonwebtoken","bcryptjs","argon2",
      "express-validator","class-validator","fastest-validator","ajv",
      "multer","formidable","busboy","multiparty","connect-busboy",
      "socket.io","ws","uWebSockets.js","sockjs","engine.io",
      "mqtt","amqplib","kafkajs","nats","redis-streams-adapter",
      "mongoose","mongodb","pg","mysql2","sqlite3","better-sqlite3",
      "sequelize","typeorm","prisma","knex","bookshelf","waterline",
      "cheerio","puppeteer","playwright","selenium-webdriver","jsdom",
      "xml2js","fast-xml-parser","csv-parser","papaparse","xlsx",
      "sharp","jimp","canvas","svg.js","pdfkit","pdf-lib",
      "ffmpeg","fluent-ffmpeg","node-media-server","mediasoup",
      "tensorflow","@tensorflow/tfjs","brain.js","natural","compromise",
      "express-rate-limit","helmet","cors","csurf","hpp","xss-clean",
      "compression","cache-manager","node-cache","lru-cache","keyv"
    ];
  }
}

async function fetchNpmPackage(name) {
  try {
    const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`, {
      headers: { "Accept": "application/vnd.npm.install-v1+json" }
    });
    if (!res.ok) return null;
    return res.json();
  } catch(e) {
    return null;
  }
}

async function processPackage(name) {
  try {
    const data = await fetchNpmPackage(name);
    if (!data) return { status: "skip", reason: "fetch failed" };

    const latest = data["dist-tags"]?.latest;
    if (!latest) return { status: "skip", reason: "no latest" };

    const versionData = data.versions?.[latest];
    if (!versionData) return { status: "skip", reason: "no version data" };

    const description = (data.description || "").substring(0, 200);
    const totalVersions = Object.keys(data.versions || {}).length;

    // Upsert package record
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

    if (pkgError || !pkg) return { status: "skip", reason: "db error" };

    // Check if this EXACT version already captured
    const { data: existing } = await supabase
      .from("snapshots")
      .select("id, version")
      .eq("package_id", pkg.id)
      .eq("version", latest)
      .single();

    if (existing) return { status: "skip", reason: "already captured" };

    // New version detected — fingerprint and record it
    const payload = JSON.stringify({
      name,
      version: latest,
      ecosystem: "npm",
      integrity: versionData.dist?.integrity || "",
      shasum: versionData.dist?.shasum || "",
      dependencies: Object.keys(versionData.dependencies || {}).sort(),
      devDependencies: Object.keys(versionData.devDependencies || {}).sort(),
      engines: versionData.engines || {},
      timestamp: new Date().toISOString()
    });

    const fingerprint = sha384(payload);
    const receiptId = generateReceiptId();

    // Submit to OpenTimestamps for Bitcoin anchoring
    const otsProof = await submitToOpenTimestamps(fingerprint);

    const { error: insertError } = await supabase.from("snapshots").insert({
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
        license: versionData.license,
        engines: versionData.engines || {},
        dependencies: Object.keys(versionData.dependencies || {}),
        devDependencies: Object.keys(versionData.devDependencies || {})
      }
    });

    if (insertError) return { status: "skip", reason: insertError.message };

    console.log(`NEW: ${name}@${latest} | ${fingerprint.substring(0,12)}... | OTS: ${otsProof ? "submitted" : "failed"}`);
    return { status: "captured", name, version: latest };

  } catch(err) {
    console.error(`Error processing ${name}:`, err.message);
    return { status: "error", reason: err.message };
  }
}

export default async function handler(req, context) {
  const startTime = Date.now();
  console.log("Crawler running at", new Date().toISOString());

  // Get dynamic package list
  const packages = await getTopNpmPackages();
  console.log(`Checking ${packages.length} packages`);

  let captured = 0;
  let skipped = 0;
  let errors = 0;

  // Process in batches of 10 to avoid timeouts
  const batchSize = 10;
  for (let i = 0; i < packages.length; i += batchSize) {
    const batch = packages.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(processPackage));

    for (const r of results) {
      if (r.status === "captured") captured++;
      else if (r.status === "error") errors++;
      else skipped++;
    }

    // Stop if approaching Netlify's 10 second function timeout
    if (Date.now() - startTime > 8000) {
      console.log("Approaching timeout — stopping early");
      break;
    }
  }

  console.log(`Done: ${captured} captured, ${skipped} skipped, ${errors} errors`);

  return new Response(JSON.stringify({
    ok: true,
    captured,
    skipped,
    errors,
    packages_checked: packages.length,
    timestamp: new Date().toISOString()
  }), {
    headers: { "Content-Type": "application/json" }
  });
}
