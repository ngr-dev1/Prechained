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
  "graphql","apollo-server","typeorm","knex","objection",
  "vitest","cypress","playwright","puppeteer",
  "vite","rollup","parcel","esbuild",
  "tailwindcss","postcss","sass","styled-components","emotion",
  "three","d3","chart.js","recharts",
  "date-fns","luxon","chrono-node",
  "winston","pino","bunyan","debug",
  "redis","ioredis","bull","node-cron",
  "stripe","braintree",
  "nodemailer","sendgrid",
  "class-validator","ajv","fastest-validator",
  "formidable","busboy",
  "mqtt","amqplib","kafkajs","nats",
  "pg","mysql2","sqlite3","better-sqlite3",
  "cheerio","jsdom",
  "xml2js","fast-xml-parser","csv-parser","papaparse","xlsx",
  "jimp","canvas","pdfkit","pdf-lib",
  "express-rate-limit","csurf","xss-clean",
  "cache-manager","lru-cache","keyv",
  "dotenv","config","convict","nconf",
  "async","bluebird","p-limit","p-queue","bottleneck",
  "chokidar","fs-extra","mkdirp","del","copy",
  "inquirer","yargs","minimist","meow","ora","cli-progress",
  "faker","chance","casual","lorem-ipsum",
  "mathjs","numeric","ml-matrix","simple-statistics",
  "marked","showdown","remarkable","markdown-it",
  "highlight.js","prismjs","shiki",
  "lodash-es","radash","just-clone","just-debounce",
  "nanoid","cuid","shortid","ulid",
  "slugify","validator","dompurify","sanitize-html",
  "mime","mime-types","file-type","magic-bytes.js",
  "archiver","unzipper","tar-stream","decompress",
  "node-schedule","cron","later","agenda",
  "pm2","forever","nodemon","ts-node",
  "passport-jwt","passport-local","passport-google-oauth20",
  "argon2","bcryptjs","scrypt","pbkdf2",
  "express-session","cookie-session","connect-redis",
  "multer-s3","multer-gridfs-storage",
  "mongoose-paginate-v2","mongoose-aggregate-paginate-v2",
  "sequelize-typescript","typeorm-naming-strategies",
  "graphql-tools","graphql-subscriptions","graphql-upload",
  "dataloader","apollo-datasource","apollo-cache-inmemory",
  "webpack-cli","webpack-dev-server","webpack-bundle-analyzer",
  "babel-loader","ts-loader","css-loader","style-loader",
  "jest-circus","@jest/globals","ts-jest","babel-jest",
  "supertest","nock","sinon","proxyquire","rewire",
  "artillery","autocannon","loadtest","clinic",
  "swagger-jsdoc","swagger-ui-express","openapi-validator",
  "socket.io-client","socket.io-redis","socket.io-emitter",
  "ioredis","redis-om","keyv-redis","cache-manager-redis-store",
  "express-async-errors","http-errors","boom","celebrate",
  "class-transformer","reflect-metadata","tsyringe","inversify",
  "typestack","routing-controllers","type-graphql","typedi",
  "nestjs","@nestjs/core","@nestjs/common","@nestjs/cli",
  "fastify-plugin","@fastify/cors","@fastify/helmet","@fastify/jwt",
  "hono","itty-router","trouter","find-my-way",
  "undici","got","ky","needle","superagent","request",
  "cheerio","crawler","node-html-parser","htmlparser2",
  "playwright-core","puppeteer-core","selenium-webdriver",
  "pdf-parse","pdf2pic","pdfjs-dist",
  "opencv4nodejs","tesseract.js","face-api.js",
  "@tensorflow/tfjs-node","brain.js","ml-classify-text",
  "natural","compromise","franc","langdetect",
  "socket.io","uws","ws","sockjs","primus",
  "grpc","@grpc/grpc-js","protobufjs","thrift",
  "amqp","amqplib","rhea","stompit",
  "level","levelup","leveldown","rocksdb",
  "neo4j-driver","arangodb","couchdb-nano","rethinkdb",
  "elasticsearch","@elastic/elasticsearch","opensearch-js",
  "influxdb-client","prometheus-client","jaeger-client",
  "dd-trace","newrelic","elastic-apm-node","sentry"
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
    return null;
  }
}

async function fetchNpmPackage(name) {
  try {
    const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`, {
      headers: { "Accept": "application/json" },
      timeout: 5000
    });
    if (!res.ok) return null;
    return res.json();
  } catch(e) {
    return null;
  }
}

async function captureVersion(pkg, name, version, versionData, ecosystem) {
  // Check if this version already captured
  const { data: existing } = await supabase
    .from("snapshots")
    .select("id")
    .eq("package_id", pkg.id)
    .eq("version", version)
    .single();

  if (existing) return false;

  const payload = JSON.stringify({
    name,
    version,
    ecosystem,
    integrity: versionData.dist?.integrity || "",
    shasum: versionData.dist?.shasum || "",
    dependencies: Object.keys(versionData.dependencies || {}).sort(),
    engines: versionData.engines || {},
    timestamp: new Date().toISOString()
  });

  const fingerprint = sha384(payload);
  const receiptId = generateReceiptId();
  const otsProof = await submitToOpenTimestamps(fingerprint);

  const { error } = await supabase.from("snapshots").insert({
    package_id: pkg.id,
    version,
    ecosystem,
    sha384_fingerprint: fingerprint,
    receipt_id: receiptId,
    btc_anchored: false,
    ots_proof: otsProof,
    raw_metadata: {
      integrity: versionData.dist?.integrity,
      shasum: versionData.dist?.shasum,
      license: versionData.license,
      engines: versionData.engines || {},
      dependencies: Object.keys(versionData.dependencies || {})
    }
  });

  if (error) return false;

  console.log(`CAPTURED: ${name}@${version} | ${fingerprint.substring(0,12)}...`);
  return true;
}

async function processPackage(name) {
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

    // Check how many versions already captured
    const { count: existingCount } = await supabase
      .from("snapshots")
      .select("*", { count: "exact", head: true })
      .eq("package_id", pkg.id);

    // If we have all versions skip entirely
    if (existingCount >= totalVersions) return 0;

    // Capture versions we don't have yet — prioritize latest first then work backwards
    const versionsToCapture = allVersions
      .reverse() // newest first
      .slice(0, 3); // capture up to 3 new versions per run per package

    let captured = 0;
    for (const version of versionsToCapture) {
      const versionData = data.versions[version];
      if (!versionData) continue;
      const didCapture = await captureVersion(pkg, name, version, versionData, "npm");
      if (didCapture) captured++;
    }

    return captured;
  } catch(err) {
    console.error(`Error: ${name}:`, err.message);
    return 0;
  }
}

export default async function handler(req, context) {
  const startTime = Date.now();
  console.log("Crawler running at", new Date().toISOString());

  // Shuffle packages so different ones get priority each run
  const shuffled = [...PACKAGES].sort(() => Math.random() - 0.5);

  let totalCaptured = 0;
  let packagesChecked = 0;

  for (const name of shuffled) {
    if (Date.now() - startTime > 8000) break;

    const captured = await processPackage(name);
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
