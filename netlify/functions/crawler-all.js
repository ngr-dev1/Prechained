import { createClient } from "@supabase/supabase-js";
import fetch from "node-fetch";
import { createHash } from "crypto";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// ── PACKAGE LISTS ──────────────────────────────────────────────
const NPM_PACKAGES = [
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
  "jimp","canvas","pdfkit","pdf-lib","nanoid","slugify",
  "validator","mime","mime-types","archiver","unzipper",
  "pm2","ts-node","passport-jwt","argon2","bcryptjs",
  "express-session","compression","express-rate-limit",
  "supertest","sinon","nock","swagger-jsdoc",
  "dotenv","async","bluebird","p-limit","p-queue",
  "chokidar","fs-extra","mkdirp","inquirer","yargs","ora",
  "faker","mathjs","marked","highlight.js","prismjs",
  "nanoid","flatted","undici","got","ky","superagent",
  "level","levelup","dataloader","webpack-cli","webpack-dev-server",
  "babel-loader","ts-loader","jest-circus","ts-jest","babel-jest"
];

const PYPI_PACKAGES = [
  "requests","numpy","pandas","scipy","matplotlib","scikit-learn",
  "tensorflow","torch","keras","flask","django","fastapi","uvicorn",
  "sqlalchemy","alembic","celery","redis","pymongo","psycopg2",
  "boto3","paramiko","cryptography","pyjwt","bcrypt","passlib",
  "pillow","opencv-python","nltk","spacy","transformers","datasets",
  "pytest","black","flake8","mypy","isort","pylint","bandit",
  "httpx","aiohttp","websockets","pydantic","marshmallow","attrs",
  "click","typer","rich","loguru","structlog","python-dotenv",
  "arrow","pendulum","pytz","dateutil","humanize",
  "beautifulsoup4","scrapy","selenium","playwright","httplib2",
  "lxml","html5lib","cssselect","pyquery",
  "parameterized","hypothesis","faker","factory-boy",
  "stripe","twilio","sendgrid","mailchimp3",
  "python-jose","itsdangerous","authlib","oauthlib",
  "grpcio","protobuf","thrift","avro-python3",
  "pyarrow","dask","ray","joblib","multiprocess"
];

const CARGO_PACKAGES = [
  "serde","tokio","reqwest","clap","anyhow","thiserror","log","env_logger",
  "tracing","rand","uuid","chrono","regex","lazy_static","once_cell",
  "bytes","futures","async-trait","pin-project","tower","hyper","axum",
  "actix-web","warp","rocket","tide","salvo","poem",
  "sqlx","diesel","sea-orm","rusqlite","mongodb","redis",
  "serde_json","serde_yaml","toml","ron","bincode","rmp-serde",
  "rayon","crossbeam","dashmap","parking_lot","arc-swap",
  "image","rustls","native-tls","openssl","ring","sha2","md5",
  "base64","hex","percent-encoding","url","mime","http",
  "clap","structopt","indicatif","console","dialoguer","colored",
  "tempfile","walkdir","glob","ignore","notify","filetime"
];

const GO_PACKAGES = [
  "github.com/gin-gonic/gin",
  "github.com/gorilla/mux",
  "github.com/labstack/echo",
  "github.com/gofiber/fiber",
  "github.com/beego/beego",
  "github.com/go-chi/chi",
  "github.com/sirupsen/logrus",
  "github.com/uber-go/zap",
  "go.uber.org/zap",
  "github.com/stretchr/testify",
  "github.com/spf13/cobra",
  "github.com/spf13/viper",
  "github.com/joho/godotenv",
  "github.com/golang-jwt/jwt",
  "github.com/google/uuid",
  "github.com/pkg/errors",
  "github.com/go-redis/redis",
  "github.com/olivere/elastic",
  "gorm.io/gorm",
  "github.com/jinzhu/gorm",
  "go.mongodb.org/mongo-driver",
  "github.com/lib/pq",
  "github.com/go-sql-driver/mysql",
  "github.com/mattn/go-sqlite3",
  "github.com/gorilla/websocket",
  "github.com/nats-io/nats.go",
  "github.com/segmentio/kafka-go",
  "github.com/prometheus/client_golang",
  "go.opentelemetry.io/otel",
  "github.com/hashicorp/vault"
];

const NUGET_PACKAGES = [
  "Newtonsoft.Json","System.Text.Json","AutoMapper","Serilog","NLog",
  "Microsoft.EntityFrameworkCore","Dapper","FluentValidation","MediatR",
  "Polly","Refit","RestSharp","Flurl","HttpClientFactory",
  "xunit","NUnit","MSTest","Moq","NSubstitute","FluentAssertions",
  "Bogus","AutoFixture","Shouldly","SpecFlow",
  "Hangfire","Quartz.NET","MassTransit","RabbitMQ.Client","Confluent.Kafka",
  "StackExchange.Redis","MongoDB.Driver","Npgsql","MySqlConnector",
  "BCrypt.Net-Next","System.IdentityModel.Tokens.Jwt","AspNetCore.Authentication.JwtBearer",
  "Swashbuckle.AspNetCore","NSwag","AutoMapper.Extensions.Microsoft.DependencyInjection",
  "Scrutor","Lamar","Autofac","SimpleInjector",
  "CsvHelper","EPPlus","iTextSharp","PdfSharp","ClosedXML",
  "ImageSharp","SkiaSharp","Magick.NET","QRCoder"
];

const MAVEN_PACKAGES = [
  "com.google.guava:guava",
  "org.apache.commons:commons-lang3",
  "commons-io:commons-io",
  "org.slf4j:slf4j-api",
  "ch.qos.logback:logback-classic",
  "org.apache.logging.log4j:log4j-core",
  "junit:junit",
  "org.junit.jupiter:junit-jupiter",
  "org.mockito:mockito-core",
  "org.springframework:spring-core",
  "org.springframework.boot:spring-boot-starter",
  "org.springframework.boot:spring-boot-starter-web",
  "org.springframework.boot:spring-boot-starter-data-jpa",
  "org.springframework.boot:spring-boot-starter-security",
  "com.fasterxml.jackson.core:jackson-databind",
  "io.netty:netty-all",
  "io.vertx:vertx-core",
  "io.quarkus:quarkus-core",
  "org.hibernate:hibernate-core",
  "org.mybatis:mybatis",
  "org.apache.kafka:kafka-clients",
  "io.projectreactor:reactor-core",
  "io.reactivex.rxjava3:rxjava",
  "org.bouncycastle:bcprov-jdk15on",
  "com.auth0:java-jwt",
  "org.postgresql:postgresql",
  "mysql:mysql-connector-java",
  "com.h2database:h2",
  "redis.clients:jedis",
  "io.lettuce:lettuce-core"
];

// ── UTILITIES ──────────────────────────────────────────────────
function sha384(data) {
  return createHash("sha384").update(data).digest("hex");
}

function generateReceiptId() {
  return "NGR-PC-" + Date.now().toString(36).toUpperCase() +
    Math.random().toString(36).substring(2, 8).toUpperCase();
}

async function upsertPackage(name, ecosystem, description, latestVersion, totalVersions) {
  const { data, error } = await supabase
    .from("packages")
    .upsert({
      name, ecosystem, description,
      latest_version: latestVersion,
      total_versions: totalVersions,
      last_captured_at: new Date().toISOString()
    }, { onConflict: "name,ecosystem" })
    .select().single();
  return error ? null : data;
}

async function captureVersion(pkg, version, ecosystem, integrity, shasum, license, dependencies) {
  const { data: existing } = await supabase
    .from("snapshots").select("id")
    .eq("package_id", pkg.id).eq("version", version).single();
  if (existing) return false;

  const payload = JSON.stringify({
    name: pkg.name, version, ecosystem,
    integrity: integrity || "",
    shasum: shasum || "",
    dependencies: (dependencies || []).sort(),
    timestamp: new Date().toISOString()
  });

  const fingerprint = sha384(payload);
  const { error } = await supabase.from("snapshots").insert({
    package_id: pkg.id, version, ecosystem,
    sha384_fingerprint: fingerprint,
    receipt_id: generateReceiptId(),
    btc_anchored: false,
    ots_proof: null,
    raw_metadata: license ? { license } : null
  });

  return !error;
}

// ── NPM CRAWLER ────────────────────────────────────────────────
async function crawlNpm(startTime) {
  let captured = 0;
  const shuffled = [...NPM_PACKAGES].sort(() => Math.random() - 0.5);

  for (const name of shuffled) {
    if (Date.now() - startTime > 7000) break;
    try {
      const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`, {
        headers: { "Accept": "application/json" }
      });
      if (!res.ok) continue;
      const data = await res.json();
      const latest = data["dist-tags"]?.latest;
      if (!latest) continue;
      const allVersions = Object.keys(data.versions || {});
      const pkg = await upsertPackage(name, "npm", (data.description||"").substring(0,200), latest, allVersions.length);
      if (!pkg) continue;

      const { data: existing } = await supabase.from("snapshots").select("version").eq("package_id", pkg.id);
      const capturedSet = new Set((existing||[]).map(s => s.version));
      const uncaptured = allVersions.filter(v => !capturedSet.has(v)).slice(0, 15);

      for (const version of uncaptured) {
        if (Date.now() - startTime > 7000) break;
        const vd = data.versions[version];
        if (!vd) continue;
        const ok = await captureVersion(pkg, version, "npm",
          vd.dist?.integrity, vd.dist?.shasum, vd.license,
          Object.keys(vd.dependencies || {}));
        if (ok) captured++;
      }
    } catch(e) {}
  }
  return captured;
}

// ── PYPI CRAWLER ───────────────────────────────────────────────
async function crawlPypi(startTime) {
  let captured = 0;
  const shuffled = [...PYPI_PACKAGES].sort(() => Math.random() - 0.5);

  for (const name of shuffled) {
    if (Date.now() - startTime > 7000) break;
    try {
      const res = await fetch(`https://pypi.org/pypi/${name}/json`);
      if (!res.ok) continue;
      const data = await res.json();
      const info = data.info;
      const latest = info?.version;
      if (!latest) continue;
      const allVersions = Object.keys(data.releases || {}).filter(v => (data.releases[v]||[]).length > 0);
      const pkg = await upsertPackage(name, "pypi", (info.summary||"").substring(0,200), latest, allVersions.length);
      if (!pkg) continue;

      const { data: existing } = await supabase.from("snapshots").select("version").eq("package_id", pkg.id);
      const capturedSet = new Set((existing||[]).map(s => s.version));
      const uncaptured = allVersions.filter(v => !capturedSet.has(v)).slice(0, 10);

      for (const version of uncaptured) {
        if (Date.now() - startTime > 7000) break;
        const files = data.releases[version] || [];
        const wheel = files.find(f => f.packagetype === "bdist_wheel") || files[0];
        const ok = await captureVersion(pkg, version, "pypi",
          wheel?.digests?.sha256 ? `sha256:${wheel.digests.sha256}` : "",
          wheel?.digests?.md5 || "", info.license || "", []);
        if (ok) captured++;
      }
    } catch(e) {}
  }
  return captured;
}

// ── CARGO CRAWLER ──────────────────────────────────────────────
async function crawlCargo(startTime) {
  let captured = 0;
  const shuffled = [...CARGO_PACKAGES].sort(() => Math.random() - 0.5);

  for (const name of shuffled) {
    if (Date.now() - startTime > 7000) break;
    try {
      const res = await fetch(`https://crates.io/api/v1/crates/${name}`, {
        headers: { "User-Agent": "prechained.com/1.0 (contact@prechained.com)" }
      });
      if (!res.ok) continue;
      const data = await res.json();
      const krate = data.crate;
      if (!krate) continue;
      const latest = krate.newest_version;
      const allVersions = (data.versions||[]).map(v => v.num);
      const pkg = await upsertPackage(name, "cargo", (krate.description||"").substring(0,200), latest, allVersions.length);
      if (!pkg) continue;

      const { data: existing } = await supabase.from("snapshots").select("version").eq("package_id", pkg.id);
      const capturedSet = new Set((existing||[]).map(s => s.version));
      const uncaptured = allVersions.filter(v => !capturedSet.has(v)).slice(0, 10);

      for (const version of uncaptured) {
        if (Date.now() - startTime > 7000) break;
        const vData = (data.versions||[]).find(v => v.num === version);
        const ok = await captureVersion(pkg, version, "cargo",
          vData?.checksum ? `sha256:${vData.checksum}` : "",
          "", vData?.license || "", []);
        if (ok) captured++;
      }
    } catch(e) {}
  }
  return captured;
}

// ── NUGET CRAWLER ──────────────────────────────────────────────
async function crawlNuget(startTime) {
  let captured = 0;
  const shuffled = [...NUGET_PACKAGES].sort(() => Math.random() - 0.5);

  for (const name of shuffled) {
    if (Date.now() - startTime > 7000) break;
    try {
      const res = await fetch(`https://api.nuget.org/v3/registration5-semver1/${name.toLowerCase()}/index.json`);
      if (!res.ok) continue;
      const data = await res.json();
      const items = data.items || [];
      if (!items.length) continue;

      const allVersions = items.flatMap(i => (i.items||[]).map(p => p.catalogEntry?.version)).filter(Boolean);
      const latest = allVersions[allVersions.length - 1];
      if (!latest) continue;

      const firstEntry = items[0]?.items?.[0]?.catalogEntry;
      const desc = (firstEntry?.description||"").substring(0,200);
      const pkg = await upsertPackage(name, "nuget", desc, latest, allVersions.length);
      if (!pkg) continue;

      const { data: existing } = await supabase.from("snapshots").select("version").eq("package_id", pkg.id);
      const capturedSet = new Set((existing||[]).map(s => s.version));
      const uncaptured = allVersions.filter(v => !capturedSet.has(v)).slice(0, 10);

      for (const version of uncaptured) {
        if (Date.now() - startTime > 7000) break;
        const entry = items.flatMap(i => i.items||[]).find(p => p.catalogEntry?.version === version)?.catalogEntry;
        const ok = await captureVersion(pkg, version, "nuget",
          "", "", entry?.licenseExpression || entry?.licenseUrl || "", []);
        if (ok) captured++;
      }
    } catch(e) {}
  }
  return captured;
}

// ── MAVEN CRAWLER ──────────────────────────────────────────────
async function crawlMaven(startTime) {
  let captured = 0;
  const shuffled = [...MAVEN_PACKAGES].sort(() => Math.random() - 0.5);

  for (const artifact of shuffled) {
    if (Date.now() - startTime > 7000) break;
    try {
      const [groupId, artifactId] = artifact.split(":");
      if (!groupId || !artifactId) continue;
      const g = groupId.replace(/\./g, "/");
      const res = await fetch(
        `https://search.maven.org/solrsearch/select?q=g:"${groupId}"+AND+a:"${artifactId}"&core=gav&rows=20&wt=json`
      );
      if (!res.ok) continue;
      const data = await res.json();
      const docs = data.response?.docs || [];
      if (!docs.length) continue;

      const allVersions = docs.map(d => d.v).filter(Boolean);
      const latest = allVersions[0];
      if (!latest) continue;

      const pkg = await upsertPackage(artifact, "maven", `${groupId}:${artifactId}`, latest, allVersions.length);
      if (!pkg) continue;

      const { data: existing } = await supabase.from("snapshots").select("version").eq("package_id", pkg.id);
      const capturedSet = new Set((existing||[]).map(s => s.version));
      const uncaptured = allVersions.filter(v => !capturedSet.has(v)).slice(0, 10);

      for (const version of uncaptured) {
        if (Date.now() - startTime > 7000) break;
        const ok = await captureVersion(pkg, version, "maven", "", "", "", []);
        if (ok) captured++;
      }
    } catch(e) {}
  }
  return captured;
}

// ── MAIN HANDLER ───────────────────────────────────────────────
export default async function handler(req, context) {
  const startTime = Date.now();
  console.log("Universal crawler running at", new Date().toISOString());

  // Run all ecosystems — each gets a slice of the time budget
  const [npm, pypi, cargo, nuget, maven] = await Promise.all([
    crawlNpm(startTime),
    crawlPypi(startTime),
    crawlCargo(startTime),
    crawlNuget(startTime),
    crawlMaven(startTime)
  ]);

  const total = npm + pypi + cargo + nuget + maven;
  console.log(`Done: ${total} total (npm:${npm} pypi:${pypi} cargo:${cargo} nuget:${nuget} maven:${maven})`);

  return new Response(JSON.stringify({
    ok: true,
    captured: { total, npm, pypi, cargo, nuget, maven },
    timestamp: new Date().toISOString()
  }), {
    headers: { "Content-Type": "application/json" }
  });
}
