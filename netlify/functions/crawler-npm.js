import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";
import { createHash } from "crypto";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const PACKAGES = [
  "express","lodash","axios","react","vue","next","nuxt","webpack","babel",
  "typescript","eslint","prettier","jest","mocha","chalk","commander","dotenv",
  "moment","dayjs","uuid","nodemon","cors","helmet","bcrypt","jsonwebtoken",
  "mongoose","sequelize","prisma","socket.io","ws","tar","semver","glob",
  "rimraf","cross-env","concurrently","husky","lint-staged","node-fetch",
  "crypto-js","sharp","multer","morgan","body-parser","compression",
  "cookie-parser","passport","joi","yup","zod","fastify","koa",
  "rxjs","ramda","immutable","immer","mobx","redux","zustand",
  "graphql","apollo-server","typeorm","knex","vitest","cypress",
  "playwright","puppeteer","vite","rollup","parcel","esbuild",
  "tailwindcss","postcss","sass","styled-components","emotion",
  "three","d3","chart.js","recharts","date-fns","luxon",
  "winston","pino","debug","redis","ioredis","bull","node-cron",
  "stripe","nodemailer","class-validator","ajv","formidable",
  "mqtt","amqplib","kafkajs","pg","mysql2","sqlite3","better-sqlite3",
  "cheerio","jsdom","xml2js","csv-parser","papaparse","xlsx",
  "jimp","canvas","pdfkit","pdf-lib","nanoid","cuid","slugify",
  "validator","mime","mime-types","archiver","unzipper",
  "pm2","ts-node","passport-jwt","passport-local","argon2","bcryptjs",
  "express-session","compression","express-rate-limit","helmet",
  "supertest","sinon","nock","artillery","swagger-jsdoc",
  "dotenv","config","async","bluebird","p-limit","p-queue",
  "chokidar","fs-extra","mkdirp","inquirer","yargs","ora",
  "faker","mathjs","marked","highlight.js","prismjs",
  "lodash-es","nanoid","flatted","serialize-javascript",
  "socket.io-client","undici","got","ky","superagent",
  "level","levelup","mongoose-paginate-v2","dataloader",
  "webpack-cli","webpack-dev-server","babel-loader","ts-loader",
  "jest-circus","ts-jest","babel-jest","vitest"
];

function sha384(data) {
  return createHash("sha384").update(data).digest("hex");
}

function generateReceiptId() {
  return "NGR-PC-" + Date.now().toString(36).toUpperCase() +
    Math.random().toString(36).substring(2,8).toUpperCase();
}

async function fetchNpmPackage(name) {
  try {
    const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`, {
      headers: { "Accept": "application/json" }
    });
    if (!res.ok) return null;
    return res.json();
  } catch(e) {
    return null;
  }
}

async function processPackage(name, startTime) {
  try {
    const data = await fetchNpmPackage(name);
    if (!data) return 0;

    const latest = data["dist-tags"]?.latest;
    if (!latest) return 0;

    const description = (data.description || "").substring(0, 200);
    const allVersions = Object.keys(data.versions || {});
    const totalVersions = allVersions.length;

    // Upsert package
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

    if (pkgError || !pkg) return 0;

    // Get already captured versions for this package
    const { data: captured } = await supabase
      .from("snapshots")
      .select("version")
      .eq("package_id", pkg.id);

    const capturedVersions = new Set((captured || []).map(s => s.version));

    // Find uncaptured versions
    const uncaptured = allVersions.filter(v => !capturedVersions.has(v));
    if (!uncaptured.length) return 0;

    // Take up to 20 versions per package per run — no OTS here, just fast capture
    const toCapture = uncaptured.slice(0, 20);
    let count = 0;

    for (const version of toCapture) {
      // Hard stop if approaching timeout
      if (Date.now() - startTime > 8500) break;

      const versionData = data.versions[version];
      if (!versionData) continue;

      const payload = JSON.stringify({
        name,
        version,
        ecosystem: "npm",
        integrity: versionData.dist?.integrity || "",
        shasum: versionData.dist?.shasum || "",
        dependencies: Object.keys(versionData.dependencies || {}).sort(),
        timestamp: new Date().toISOString()
      });

      const fingerprint = sha384(payload);
      const receiptId = generateReceiptId();

      const { error } = await supabase.from("snapshots").insert({
        package_id: pkg.id,
        version,
        ecosystem: "npm",
        sha384_fingerprint: fingerprint,
        receipt_id: receiptId,
        btc_anchored: false,
        ots_proof: null,
        raw_metadata: {
          integrity: versionData.dist?.integrity,
          shasum: versionData.dist?.shasum,
          license: versionData.license,
          dependencies: Object.keys(versionData.dependencies || {})
        }
      });

      if (!error) {
        count++;
        console.log(`CAPTURED: ${name}@${version}`);
      }
    }

    return count;
  } catch(err) {
    console.error(`Error: ${name}:`, err.message);
    return 0;
  }
}

export default async function handler(req, context) {
  const startTime = Date.now();
  console.log("Crawler running at", new Date().toISOString());

  // Shuffle so different packages get priority each run
  const shuffled = [...PACKAGES].sort(() => Math.random() - 0.5);

  let totalCaptured = 0;
  let packagesChecked = 0;

  for (const name of shuffled) {
    if (Date.now() - startTime > 8500) break;
    const captured = await processPackage(name, startTime);
    totalCaptured += captured;
    packagesChecked++;
  }

  console.log(`Done: ${totalCaptured} captured across ${packagesChecked} packages`);

  return new Response(JSON.stringify({
    ok: true,
    captured: totalCaptured,
    packages_checked: packagesChecked,
    timestamp: new Date().toISOString()
  }), {
    headers: { "Content-Type": "application/json" }
  });
}
