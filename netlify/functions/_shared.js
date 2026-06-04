// _shared.js — Shared utilities, package lists, and core capture logic
// Used by all ecosystem-specific crawlers
// prechained.com · Built by NextGenRails™

import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";

export const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export const GITHUB_TOKEN = process.env.GITHUB_ARCHIVE_TOKEN;
export const GITHUB_REPO = process.env.GITHUB_ARCHIVE_REPO || "ngr-dev1/prechained-archive";

// ── CRYPTO ─────────────────────────────────────────────────────
export function sha384(data) {
  return createHash("sha384").update(data).digest("hex");
}

// ── CANONICAL FINGERPRINT ──────────────────────────────────────
// ONE reproducible fingerprint for the whole pipeline. Anyone can recompute
// it from the archived manifest.json: drop the volatile capture-metadata
// fields, recursively sort keys, JSON.stringify with no whitespace, SHA-384.
// No timestamps or crawler identity enter the hash → the value is stable and
// independently verifiable. (Replaces the old per-path hashes that baked in
// `new Date()` and therefore could never be reproduced.)
const VOLATILE_FIELDS = new Set(["captured_at", "captured_by", "crawler_sha384", "sha384_fingerprint"]);

export function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (VOLATILE_FIELDS.has(key)) continue;
      out[key] = canonicalize(value[key]);
    }
    return out;
  }
  return value;
}

// The exact bytes the fingerprint hashes — exported so the OTS layer and any
// verifier can agree on them.
export function canonicalBytes(manifest) {
  return JSON.stringify(canonicalize(manifest));
}

export function canonicalFingerprint(manifest) {
  return sha384(canonicalBytes(manifest));
}

export function generateReceiptId() {
  return "NGR-PC-" + Date.now().toString(36).toUpperCase() +
    Math.random().toString(36).substring(2, 8).toUpperCase();
}

// ── GITHUB MANIFEST STORAGE ────────────────────────────────────
export async function storeManifestInGithub(ecosystem, name, version, manifest) {
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
        message: `Archive: ${ecosystem}/${name}@${version}`,
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
    console.error("GitHub store failed:", e.message);
    return null;
  }
}

// ── UPSERT PACKAGE ─────────────────────────────────────────────
export async function upsertPackage(name, ecosystem, description, latestVersion, totalVersions) {
  const { data, error } = await supabase
    .from("packages")
    .upsert({
      name, ecosystem,
      description: (description || "").substring(0, 200),
      latest_version: latestVersion,
      total_versions: totalVersions,
      last_captured_at: new Date().toISOString(),
      last_discovered_at: new Date().toISOString()
    }, { onConflict: "name,ecosystem" })
    .select().single();
  return error ? null : data;
}

// ── CAPTURE VERSION ────────────────────────────────────────────
// crawlerSha384: fingerprint of the crawler source that produced this capture
export async function captureVersion(pkg, version, ecosystem, integrity, shasum, license, dependencies, manifest, crawlerSha384) {
  const { data: existing } = await supabase
    .from("snapshots").select("id")
    .eq("package_id", pkg.id).eq("version", version).single();
  if (existing) return null;

  // Reproducible fingerprint over the canonical manifest bytes. integrity,
  // shasum and dependencies are already inside the manifest, so they still
  // bind into the hash — but nothing volatile does.
  const fingerprint = canonicalFingerprint(manifest);
  const receiptId = generateReceiptId();
  const manifestPath = await storeManifestInGithub(ecosystem, pkg.name, version, manifest);

  // Insert with SHA-384 fingerprint. manifest_path stored in GitHub archive.
  const { data: inserted, error } = await supabase.from("snapshots").insert({
    package_id: pkg.id, version, ecosystem,
    sha384_fingerprint: fingerprint,
    receipt_id: receiptId,
    btc_anchored: false,
    btc_block: null,
    ots_proof: null,
    manifest_path: manifestPath,
    raw_metadata: { fp: "v2", crawler_sha384: crawlerSha384 || null, ...(license ? { license } : {}) }
  }).select("id").single();

  if (error) {
    console.error(`[capture] insert ${ecosystem}/${pkg.name}@${version}:`, error.message);
    return null;
  }
  console.log(`CAPTURED: ${ecosystem}/${pkg.name}@${version} | manifest:${manifestPath ? "stored" : "failed"} `);
  return { snapshotId: inserted.id, fingerprint };
}

// ── VERSION CLASSIFICATION ─────────────────────────────────────
// We deliberately DO capture dev branches and prereleases now.
// The Famous Chollima / take-home-interview lures live on dev branches
// (e.g. composer "dev-feature/test-case"); skipping them is skipping the
// exact thing that gets attacked. This helper only flags a version so the
// queue can PRIORITISE it — it never excludes it.
export function isRiskyVersion(version) {
  if (!version) return false;
  const v = String(version).toLowerCase();
  return v.startsWith("dev-") || v.includes("dev-") ||
    /-(alpha|beta|rc|next|canary|nightly|preview|snapshot|insiders|experimental)/.test(v) ||
    /\.(dev|pre|post)\d/.test(v) ||
    v.includes("0.0.1-security");   // npm/registry malware-takedown placeholder
}

// ── DURABLE CAPTURE QUEUE ──────────────────────────────────────
// Crawlers DISCOVER cheaply and ENQUEUE every (pkg, version) they don't have.
// The drainer does the expensive capture work in 8.5s slices. Work that
// doesn't finish in one run waits for the next run instead of being dropped.

// Enqueue a batch of {ecosystem, package_name, version, source, hint} rows.
// Dev/prerelease versions get a lower (sooner) priority number.
export async function enqueueCaptures(rows) {
  if (!rows || !rows.length) return 0;
  const payload = rows.map(r => ({
    ecosystem: r.ecosystem,
    package_name: r.package_name,
    version: String(r.version),
    source: r.source || null,
    hint: r.hint || null,
    priority: r.priority != null
      ? r.priority
      : (isRiskyVersion(r.version) ? 10 : 100),
    status: "pending"
  }));
  // ON CONFLICT DO NOTHING via ignoreDuplicates — re-discovering a queued
  // version is a no-op (the unique index is ecosystem+package_name+version).
  const { error, count } = await supabase
    .from("pending_captures")
    .upsert(payload, {
      onConflict: "ecosystem,package_name,version",
      ignoreDuplicates: true,
      count: "exact"
    });
  if (error) { console.error("[queue] enqueue error:", error.message); return 0; }
  return count || 0;
}

// Atomically claim up to `limit` pending rows (flips them to 'processing').
export async function claimCaptures(limit) {
  const { data, error } = await supabase.rpc("claim_pending_captures", { p_limit: limit });
  if (error) { console.error("[queue] claim error:", error.message); return []; }
  return data || [];
}

// Mark a claimed row done / errored.
export async function finishCapture(id, ok, errMsg) {
  const patch = ok
    ? { status: "done", processed_at: new Date().toISOString() }
    : { status: "pending", last_error: (errMsg || "").slice(0, 500), claimed_at: null };
  const { error } = await supabase.from("pending_captures").update(patch).eq("id", id);
  if (error) console.error("[queue] finish error:", error.message);
}

// Self-heal: send rows stuck in 'processing' (crashed drainer) back to pending.
export async function requeueStale() {
  const { data, error } = await supabase.rpc("requeue_stale_captures");
  if (error) { console.error("[queue] requeue error:", error.message); return 0; }
  return data || 0;
}

// Has this exact (package_id, version) already been fingerprinted?
export async function snapshotExists(packageId, version) {
  const { data } = await supabase
    .from("snapshots").select("id")
    .eq("package_id", packageId).eq("version", version).limit(1).maybeSingle();
  return !!data;
}

// ── PACKAGE LISTS ──────────────────────────────────────────────

// ── DYNAMIC PACKAGE DISCOVERY ──────────────────────────────────
// Fetches top packages dynamically from each ecosystem's public API
// No hardcoded lists — self-updating coverage of what attackers target

// Fallback seeds: only used if dynamic fetch fails entirely
const SEED_NPM = ["express","lodash","axios","react","vue","next","webpack","typescript","eslint","jest","dotenv","moment","uuid","cors","helmet","bcrypt","jsonwebtoken","mongoose","sequelize","prisma","socket.io","rxjs","redux","zustand","graphql","vite","rollup","esbuild","tailwindcss","postcss","three","d3","chart.js","winston","redis","ioredis","bull","stripe","nodemailer","ajv","pg","mysql2","sqlite3","cheerio","pm2","passport","joi","zod","fastify","koa","vitest","cypress","playwright","puppeteer","sass","styled-components","mobx","immer","ramda","knex","typeorm","bullmq","kafkajs","multer","compression","morgan","bcryptjs","argon2","dotenv-expand","chokidar","fs-extra","inquirer","yargs","faker","marked","highlight.js","undici","got","superagent","nodemon","cross-env","husky","prettier","mocha","sinon","nock","async","bluebird","p-limit","p-queue","semver","glob","rimraf","tar","ws","mime","slugify","validator","nanoid","xlsx","csv-parser","papaparse","pdfkit","pdf-lib","sharp","jimp","twilio","aws-sdk","@google-cloud/storage","cloudinary","@grpc/grpc-js","protobufjs","swagger-jsdoc","swagger-ui-express","xss","sanitize-html","dompurify","serve","http-server","execa","which","open","boxen","meow","minimist","cosmiconfig","adm-zip","jszip","fflate","keyv","cache-manager","lru-cache","needle","crawlee","hapi","restify","polka","micro","inversify","drizzle-orm","valtio","recoil","swr","next-auth","react-dom","react-router","react-query","react-hook-form","jotai","lodash-es","fp-ts","valibot","winston-daily-rotate-file","pino","pino-http","log4js","node-cron","agenda","passport-google-oauth20","passport-jwt","express-validator","celebrate","typebox","superstruct","serve-static","dotenv-flow","tempy","tmp","figlet","gradient-string","mri","arg","lilconfig","update-notifier","latest-version","tar-stream","tar-fs","decompress","vonage","multer-s3","lerna","nx","turborepo","changesets","semantic-release","bee-queue","redoc","level","levelup","dataloader","webpack-cli","webpack-dev-server","babel-loader","ts-loader","jest-circus","ts-jest","babel-jest","objection","tsyringe","typedi","pg-boss","passport-facebook","passport-github2","fluent-ffmpeg","sharp","tesseract.js","ml5","brain.js","natural"];

const SEED_PYPI = ["requests","numpy","pandas","scipy","matplotlib","scikit-learn","tensorflow","torch","keras","flask","django","fastapi","uvicorn","sqlalchemy","alembic","celery","redis","pymongo","psycopg2","boto3","paramiko","cryptography","pyjwt","bcrypt","passlib","pillow","opencv-python","nltk","spacy","transformers","datasets","pytest","black","flake8","mypy","isort","pylint","bandit","httpx","aiohttp","websockets","pydantic","marshmallow","attrs","click","typer","rich","loguru","structlog","python-dotenv","arrow","pendulum","pytz","dateutil","humanize","beautifulsoup4","scrapy","selenium","playwright","httplib2","lxml","html5lib","hypothesis","faker","factory-boy","stripe","twilio","sendgrid","python-jose","itsdangerous","authlib","oauthlib","grpcio","protobuf","msgpack","pyarrow","dask","ray","joblib","sympy","statsmodels","xgboost","lightgbm","catboost","networkx","sqlmodel","tortoise-orm","peewee","databases","tqdm","tabulate","colorama","termcolor","textual","pyyaml","toml","dynaconf","pytest-asyncio","anyio","trio","twisted","flask-restful","flask-sqlalchemy","flask-login","djangorestframework","django-cors-headers","starlette","sanic","tornado","pydantic-settings","msgspec","gymnasium","stable-baselines3","mlflow","wandb","docker","kubernetes","ansible","apache-airflow","prefect","dagster","luigi","setuptools","wheel","pip","virtualenv","poetry","pipenv","gunicorn","uvloop","httptools","orjson","ujson","simplejson","packaging","certifi","charset-normalizer","idna","urllib3","six","python-dateutil","pyOpenSSL","paramiko","fabric","invoke","sh","psutil","py-cpuinfo","memory-profiler","line-profiler","cachetools","expiringdict","diskcache","jobqueue","rq","dramatiq","huey","mcp","anthropic","openai","langchain","langchain-core","langchain-community","langgraph","llama-index","llama-index-core","litellm","ollama","groq","mistralai","cohere","tiktoken","chromadb","sentence-transformers","openai-agents"];

const SEED_CARGO = ["serde","tokio","reqwest","clap","anyhow","thiserror","log","env_logger","tracing","rand","uuid","chrono","regex","lazy_static","once_cell","bytes","futures","async-trait","pin-project","tower","hyper","axum","actix-web","warp","rocket","tide","salvo","poem","sqlx","diesel","sea-orm","rusqlite","mongodb","redis","deadpool","serde_json","serde_yaml","toml","ron","bincode","rmp-serde","rayon","crossbeam","dashmap","parking_lot","arc-swap","flume","image","rustls","native-tls","openssl","ring","sha2","md5","blake3","base64","hex","percent-encoding","url","mime","http","indicatif","console","dialoguer","colored","owo-colors","tempfile","walkdir","glob","ignore","notify","filetime","nom","pest","logos","chumsky","winnow","criterion","proptest","quickcheck","arbitrary","serde_with","derive_more","strum","num","num-traits","itertools","either","smallvec","tinyvec","arrayvec","hashbrown","indexmap","linked-hash-map","multimap","tokio-stream","tokio-util","tokio-tungstenite","tokio-rustls","tonic","prost","jsonrpsee","tower-http","axum-extra","tracing-subscriber","tracing-opentelemetry","opentelemetry","config","dotenv","figment","envy","dotenvy","wasm-bindgen","js-sys","web-sys","gloo","yew","leptos","dioxus","rdkafka","lapin","async-nats","prometheus","metrics","zstd","lz4","snap","brotli","flate2","xz2","zip","fancy-regex","aho-corasick","memchr","chrono-tz","time","hifitime","ed25519-dalek","x25519-dalek","p256","k256","argon2","bcrypt","pbkdf2","scrypt","password-hash","clap_derive","serde_derive","thiserror","async-recursion","async-stream","futures-util","pin-utils","bytes","mime_guess","unicase","form_urlencoded","cookie","headers","http-body","hyper-tls","reqwest-middleware","tower-service","tower-layer"];

const SEED_RUBYGEMS = ["rails","rake","bundler","rspec","minitest","sinatra","devise","activesupport","activerecord","actionpack","actionview","actionmailer","sidekiq","delayed_job","resque","que","good_job","puma","unicorn","passenger","thin","pg","mysql2","sqlite3","redis","mongo","mongoid","carrierwave","shrine","paperclip","nokogiri","mechanize","httparty","faraday","rest-client","typhoeus","capybara","selenium-webdriver","watir","cucumber","factory_bot","faker","ffaker","shoulda-matchers","vcr","webmock","warden","pundit","cancancan","rolify","jwt","bcrypt","attr_encrypted","lockbox","rubocop","brakeman","bundler-audit","reek","pry","byebug","awesome_print","stripe","braintree","active_merchant","aws-sdk","cloudinary","elasticsearch","searchkick","ransack","pg_search","kaminari","will_paginate","pagy","friendly_id","simple_form","reform","dry-validation","dry-schema","state_machines","aasm","workflow","statesman","money","money-rails","countries","whenever","clockwork","rufus-scheduler","sidekiq-scheduler","scenic","paranoia","paper_trail","audited","graphql","grape","rack","rack-cors","rack-attack","liquid","slim","haml","jbuilder","blueprinter","omniauth","omniauth-google-oauth2","omniauth-facebook","omniauth-github","doorkeeper","rodauth","sorcery","authlogic","has_secure_token","acts-as-taggable-on","mobility","globalize","ransack","pg_search","searchkick","chewy","bullet","rack-mini-profiler","derailed_benchmarks","skylight","scout_apm","newrelic_rpm","rollbar","sentry-ruby","honeybadger","airbrake","exception_notification"];

const SEED_PACKAGIST = ["symfony/symfony","laravel/framework","guzzlehttp/guzzle","monolog/monolog","phpunit/phpunit","doctrine/orm","symfony/console","symfony/http-foundation","symfony/routing","symfony/event-dispatcher","symfony/dependency-injection","laravel/tinker","laravel/socialite","laravel/cashier","illuminate/support","illuminate/database","illuminate/http","nesbot/carbon","vlucas/phpdotenv","phpspec/prophecy","mockery/mockery","fakerphp/faker","ramsey/uuid","league/fractal","league/flysystem","spatie/laravel-permission","spatie/laravel-medialibrary","spatie/laravel-activitylog","spatie/laravel-query-builder","barryvdh/laravel-debugbar","barryvdh/laravel-ide-helper","predis/predis","aws/aws-sdk-php","stripe/stripe-php","braintree/braintree_php","twilio/sdk","sendgrid/sendgrid","elasticsearch/elasticsearch","algolia/algoliasearch-client-php","tymon/jwt-auth","firebase/php-jwt","lcobucci/jwt","league/oauth2-server","league/oauth2-client","pragmarx/google2fa","robthree/twofactorauth","knplabs/knp-paginator-bundle","slim/slim","slim/psr7","codeigniter4/framework","cakephp/cakephp","yiisoft/yii2","phpstan/phpstan","vimeo/psalm","squizlabs/php_codesniffer","friendsofphp/php-cs-fixer","rector/rector","behat/behat","codeception/codeception","phpspec/phpspec","laravel-lang/lang","laravel-lang/http-statuses","laravel-lang/attributes","laravel-lang/publisher","spatie/laravel-data","spatie/laravel-ray","spatie/laravel-backup","spatie/laravel-sitemap","spatie/laravel-sluggable","spatie/laravel-translatable","spatie/laravel-tags","spatie/laravel-schemaless-attributes","spatie/laravel-model-states","spatie/laravel-event-sourcing","spatie/laravel-responsecache","spatie/laravel-html","spatie/laravel-pdf","spatie/laravel-ignition","laravel/octane","laravel/sanctum","laravel/passport","laravel/horizon","laravel/nova","laravel/telescope","laravel/dusk","laravel/pint","laravel/sail","laravel/breeze","laravel/jetstream","filament/filament","livewire/livewire","inertiajs/inertia-laravel","tightenco/ziggy","owen-it/laravel-auditing","maatwebsite/excel","intervention/image","barryvdh/laravel-cors","fruitcake/laravel-cors","darkaonline/l5-swagger","reliese/laravel","beyondcode/laravel-websockets","pusher/pusher-php-server","league/commonmark","parsedown/parsedown","erusev/parsedown","dompdf/dompdf","tecnickcom/tcpdf","mpdf/mpdf","phpoffice/phpspreadsheet","phpoffice/phpword","phpmailer/phpmailer","swiftmailer/swiftmailer","symfony/mailer","nette/mail","zendframework/zend-mail","pear/mail","league/mail","doctrine/dbal","doctrine/migrations","doctrine/annotations","doctrine/common","doctrine/cache","doctrine/collections","doctrine/event-manager","doctrine/inflector","doctrine/instantiator","doctrine/lexer","doctrine/persistence","doctrine/reflection"];

const SEED_NUGET = ["Newtonsoft.Json","System.Text.Json","AutoMapper","Serilog","NLog","Microsoft.EntityFrameworkCore","Dapper","FluentValidation","MediatR","Polly","Refit","RestSharp","Flurl","xunit","NUnit","MSTest","Moq","NSubstitute","FluentAssertions","Bogus","AutoFixture","Shouldly","SpecFlow","Hangfire","Quartz.NET","MassTransit","RabbitMQ.Client","Confluent.Kafka","StackExchange.Redis","MongoDB.Driver","Npgsql","MySqlConnector","BCrypt.Net-Next","System.IdentityModel.Tokens.Jwt","Swashbuckle.AspNetCore","NSwag","Mapster","Scrutor","Autofac","SimpleInjector","Castle.Windsor","CsvHelper","EPPlus","iTextSharp","PdfSharp","ClosedXML","NPOI","ImageSharp","SkiaSharp","Magick.NET","QRCoder","ZXing.Net","SignalR","Grpc.AspNetCore","protobuf-net","MessagePack","Orleans","Serilog.AspNetCore","Serilog.Sinks.Console","Serilog.Sinks.File","Microsoft.Extensions.Logging","Microsoft.Extensions.DependencyInjection","Microsoft.Extensions.Configuration","Microsoft.Extensions.Caching.Memory","Carter","FastEndpoints","ErrorOr","FluentResults","CSharpFunctionalExtensions","LanguageExt","BenchmarkDotNet","Testcontainers","WireMock.Net","Azure.Storage.Blobs","Azure.Identity","Azure.KeyVault","Azure.ServiceBus","AWSSDK.S3","AWSSDK.DynamoDBv2","AWSSDK.SQS","Elasticsearch.Net","NEST","Meilisearch","Algolia.Search","Stripe.net","Braintree","Twilio","SendGrid","PostmarkDotNet","FluentEmail","Humanizer","Polly.Extensions.Http","Microsoft.Extensions.Http.Polly","MiniProfiler","Sentry","Datadog.Trace","OpenTelemetry","OpenTelemetry.Exporter.Prometheus","OpenTelemetry.Exporter.Zipkin","MassTransit.RabbitMQ","MassTransit.AmazonSQS","MassTransit.Azure.ServiceBus.Core","Rebus","NServiceBus","EasyNetQ","MediatR.Extensions.Microsoft.DependencyInjection","AutoMapper.Extensions.Microsoft.DependencyInjection"];

const SEED_MAVEN = ["com.google.guava:guava","org.apache.commons:commons-lang3","commons-io:commons-io","org.slf4j:slf4j-api","ch.qos.logback:logback-classic","org.apache.logging.log4j:log4j-core","junit:junit","org.junit.jupiter:junit-jupiter","org.mockito:mockito-core","org.springframework:spring-core","org.springframework.boot:spring-boot-starter","org.springframework.boot:spring-boot-starter-web","org.springframework.boot:spring-boot-starter-data-jpa","org.springframework.boot:spring-boot-starter-security","org.springframework.boot:spring-boot-starter-actuator","com.fasterxml.jackson.core:jackson-databind","io.netty:netty-all","io.vertx:vertx-core","io.quarkus:quarkus-core","org.hibernate:hibernate-core","org.mybatis:mybatis","org.apache.kafka:kafka-clients","io.projectreactor:reactor-core","io.reactivex.rxjava3:rxjava","org.bouncycastle:bcprov-jdk15on","com.auth0:java-jwt","org.postgresql:postgresql","mysql:mysql-connector-java","com.h2database:h2","redis.clients:jedis","io.lettuce:lettuce-core","org.apache.httpcomponents:httpclient","com.squareup.okhttp3:okhttp","com.google.code.gson:gson","org.json:json","org.yaml:snakeyaml","org.mapstruct:mapstruct","org.projectlombok:lombok","com.google.inject:guice","io.micrometer:micrometer-core","com.amazonaws:aws-java-sdk","software.amazon.awssdk:s3","com.google.cloud:google-cloud-storage","org.apache.commons:commons-collections4","org.apache.commons:commons-math3","com.hazelcast:hazelcast","org.redisson:redisson","com.github.ben-manes.caffeine:caffeine","io.grpc:grpc-netty","io.grpc:grpc-stub","io.grpc:grpc-protobuf","com.stripe:stripe-java","com.twilio.sdk:twilio","com.sendgrid:sendgrid-java","org.elasticsearch.client:elasticsearch-rest-high-level-client","org.apache.lucene:lucene-core","com.mongodb:mongodb-driver-sync","io.swagger.core.v3:swagger-core","org.springdoc:springdoc-openapi-ui","mysql:mysql-connector-java","com.mysql:mysql-connector-j","org.mariadb.jdbc:mariadb-java-client","org.xerial:sqlite-jdbc","com.oracle.database.jdbc:ojdbc8","com.microsoft.sqlserver:mssql-jdbc","org.flywaydb:flyway-core","org.liquibase:liquibase-core","com.zaxxer:HikariCP","org.apache.commons:commons-dbcp2","io.jsonwebtoken:jjwt-api","org.springframework.security:spring-security-core","org.springframework.security:spring-security-web","org.springframework.security:spring-security-oauth2-client","io.springfox:springfox-boot-starter","com.querydsl:querydsl-jpa","org.apache.velocity:velocity-engine-core","com.google.protobuf:protobuf-java","io.opencensus:opencensus-api","io.opentelemetry:opentelemetry-api","org.apache.avro:avro","org.apache.parquet:parquet-common","com.databricks:spark-csv_2.11","org.apache.spark:spark-core_2.12","org.apache.hadoop:hadoop-common"];

const SEED_GITHUB = ["expressjs/express","lodash/lodash","axios/axios","facebook/react","vuejs/vue","vercel/next.js","nuxt/nuxt","webpack/webpack","babel/babel","microsoft/TypeScript","eslint/eslint","prettier/prettier","jestjs/jest","mochajs/mocha","chalk/chalk","tj/commander.js","motdotla/dotenv","moment/moment","iamkun/dayjs","remy/nodemon","expressjs/cors","helmetjs/helmet","auth0/node-jsonwebtoken","Automattic/mongoose","sequelize/sequelize","prisma/prisma","socketio/socket.io","websockets/ws","isaacs/node-tar","npm/node-semver","fastify/fastify","koajs/koa","hapijs/hapi","ReactiveX/rxjs","ramda/ramda","immerjs/immer","mobxjs/mobx","reduxjs/redux","pmndrs/zustand","graphql/graphql-js","apollographql/apollo-server","typeorm/typeorm","knex/knex","vitejs/vite","rollup/rollup","evanw/esbuild","tailwindlabs/tailwindcss","postcss/postcss","mrdoob/three.js","d3/d3","chartjs/Chart.js","date-fns/date-fns","winstonjs/winston","pinojs/pino","redis/node-redis","luin/ioredis","OptimalBits/bull","stripe/stripe-node","nodemailer/nodemailer","ajv-validator/ajv","mqttjs/MQTT.js","tulios/kafkajs","brianc/node-postgres","sidorares/node-mysql2","WiseLibs/better-sqlite3","cheeriojs/cheerio","jsdom/jsdom","SheetJS/sheetjs","jimp-dev/jimp","foliojs/pdfkit","Hopding/pdf-lib","ai/nanoid","simov/slugify","validatorjs/validator","caolan/async","petkaantonov/bluebird","sindresorhus/p-limit","paulmillr/chokidar","jprichardson/node-fs-extra","SBoudrias/Inquirer.js","yargs/yargs","sindresorhus/ora","faker-js/faker","josdejong/mathjs","markedjs/marked","highlightjs/highlight.js","PrismJS/prism","sindresorhus/got","visionmedia/superagent","graphql/dataloader","webpack/webpack-cli","vitest-dev/vitest","cypress-io/cypress","microsoft/playwright","puppeteer/puppeteer","pallets/flask","django/django","tiangolo/fastapi","psf/requests","numpy/numpy","pandas-dev/pandas","scikit-learn/scikit-learn","tensorflow/tensorflow","pytorch/pytorch","keras-team/keras","celery/celery","redis/redis-py","pymongo/mongo-python-driver","python-pillow/Pillow","nltk/nltk","explosion/spaCy","huggingface/transformers","pytest-dev/pytest","psf/black","PyCQA/flake8","python/mypy","PyCQA/pylint","encode/httpx","aio-libs/aiohttp","Textualize/rich","tiangolo/typer","Delgan/loguru","pydantic/pydantic","scrapy/scrapy","SeleniumHQ/selenium","serde-rs/serde","tokio-rs/tokio","seanmonstar/reqwest","clap-rs/clap","dtolnay/anyhow","dtolnay/thiserror","tokio-rs/axum","actix/actix-web","diesel-rs/diesel","launchbadge/sqlx","SeaQL/sea-orm","rayon-rs/rayon","image-rs/image","rustls/rustls","briansmith/ring","RustCrypto/hashes","dotnet/runtime","dotnet/aspnetcore","dotnet/efcore","AutoMapper/AutoMapper","serilog/serilog","NLog/NLog","App-vNext/Polly","reactiveui/refit","restsharp/RestSharp","xunit/xunit","nunit/nunit","moq/moq4","fluentassertions/fluentassertions","HangfireIO/Hangfire","MassTransit/MassTransit","StackExchange/StackExchange.Redis","mongodb/mongo-csharp-driver","npgsql/npgsql","SixLabors/ImageSharp","dlemstra/Magick.NET","JamesNK/Newtonsoft.Json","spring-projects/spring-framework","spring-projects/spring-boot","apache/kafka","apache/commons-lang","apache/logging-log4j2","junit-team/junit5","mockito/mockito","google/guava","netty/netty","eclipse-vertx/vert.x","quarkusio/quarkus","hibernate/hibernate-orm","mybatis/mybatis-3","reactor/reactor-core","ReactiveX/RxJava","gin-gonic/gin","gorilla/mux","labstack/echo","gofiber/fiber","sirupsen/logrus","uber-go/zap","stretchr/testify","spf13/cobra","spf13/viper","joho/godotenv","golang-jwt/jwt","google/uuid","go-redis/redis","go-gorm/gorm","mongodb/mongo-go-driver","lib/pq","gorilla/websocket","nats-io/nats.go","segmentio/kafka-go","prometheus/client_golang","open-telemetry/opentelemetry-go","hashicorp/vault","ossf/scorecard","ossf/package-analysis","ossf/malicious-packages","sigstore/cosign","sigstore/sigstore","anchore/syft","anchore/grype","anchore/sbom-action","aquasecurity/trivy","snyk/snyk","google/osv-scanner","semgrep/semgrep","actions/checkout","actions/setup-node","actions/setup-python","actions/cache","docker/build-push-action","docker/login-action","makowskid/laravel-lang","laravel-lang/lang"];

export async function fetchNpmPackages() {
  try {
    // npm's download counts API — top 250 packages
    const res = await fetch("https://registry.npmjs.org/-/v1/search?text=not:unstable&size=250&ranking=popularity", {
      headers: { "Accept": "application/json" }
    });
    if (!res.ok) throw new Error("npm search failed");
    const data = await res.json();
    const dynamic = (data.objects || []).map(o => o.package?.name).filter(Boolean);
    // Merge dynamic + seeds, deduplicate
    return [...new Set([...dynamic, ...SEED_NPM])];
  } catch(e) {
    console.error("[npm] dynamic fetch failed, using seeds:", e.message);
    return SEED_NPM;
  }
}

export async function fetchPypiPackages() {
  try {
    // PyPI's top packages via hugovk/top-pypi-packages (updates monthly)
    const res = await fetch("https://hugovk.github.io/top-pypi-packages/top-pypi-packages-30-days.min.json");
    if (!res.ok) throw new Error("pypi top list failed");
    const data = await res.json();
    const dynamic = (data.rows || []).slice(0, 300).map(r => r.project).filter(Boolean);
    return [...new Set([...dynamic, ...SEED_PYPI])];
  } catch(e) {
    console.error("[pypi] dynamic fetch failed, using seeds:", e.message);
    return SEED_PYPI;
  }
}

export async function fetchCargoPackages() {
  try {
    // crates.io top crates by downloads
    const res = await fetch("https://crates.io/api/v1/crates?sort=downloads&per_page=100", {
      headers: { "User-Agent": "prechained.com/1.0 (supply chain archive)" }
    });
    if (!res.ok) throw new Error("cargo top list failed");
    const data = await res.json();
    const dynamic = (data.crates || []).map(c => c.name).filter(Boolean);
    return [...new Set([...dynamic, ...SEED_CARGO])];
  } catch(e) {
    console.error("[cargo] dynamic fetch failed, using seeds:", e.message);
    return SEED_CARGO;
  }
}

export async function fetchRubygemsPackages() {
  try {
    // RubyGems most downloaded
    const pages = await Promise.all([1,2,3].map(p =>
      fetch(`https://rubygems.org/api/v1/search.json?query=&page=${p}`)
        .then(r => r.ok ? r.json() : [])
        .catch(() => [])
    ));
    const dynamic = pages.flat().map(g => g.name).filter(Boolean);
    return [...new Set([...dynamic, ...SEED_RUBYGEMS])];
  } catch(e) {
    console.error("[rubygems] dynamic fetch failed, using seeds:", e.message);
    return SEED_RUBYGEMS;
  }
}

export async function fetchPackagistPackages() {
  try {
    // Packagist popular packages
    const res = await fetch("https://packagist.org/explore/popular.json?page=1");
    if (!res.ok) throw new Error("packagist popular failed");
    const data = await res.json();
    const dynamic = (data.packages || []).map(p => p.name).filter(Boolean);
    // Also fetch page 2 and 3 for more coverage
    const pages = await Promise.all([2,3,4,5].map(p =>
      fetch(`https://packagist.org/explore/popular.json?page=${p}`)
        .then(r => r.ok ? r.json() : { packages: [] })
        .then(d => (d.packages || []).map(p => p.name))
        .catch(() => [])
    ));
    const allDynamic = [...dynamic, ...pages.flat()];
    return [...new Set([...allDynamic, ...SEED_PACKAGIST])];
  } catch(e) {
    console.error("[packagist] dynamic fetch failed, using seeds:", e.message);
    return SEED_PACKAGIST;
  }
}

export async function fetchNugetPackages() {
  try {
    // NuGet most downloaded via search API
    const res = await fetch("https://azuresearch-usnc.nuget.org/query?q=&take=250&sortBy=totalDownloads-desc&prerelease=false");
    if (!res.ok) throw new Error("nuget search failed");
    const data = await res.json();
    const dynamic = (data.data || []).map(p => p.id).filter(Boolean);
    return [...new Set([...dynamic, ...SEED_NUGET])];
  } catch(e) {
    console.error("[nuget] dynamic fetch failed, using seeds:", e.message);
    return SEED_NUGET;
  }
}

export async function fetchMavenPackages() {
  // Maven doesn't have a simple top-N API — use extended seed list
  return SEED_MAVEN;
}

export async function fetchGithubRepos() {
  try {
    // GitHub trending repos — use search API for most starred security/infra repos
    const headers = { "Accept": "application/vnd.github.v3+json", "User-Agent": "prechained.com/1.0" };
    if (process.env.GITHUB_ARCHIVE_TOKEN) headers["Authorization"] = "token " + process.env.GITHUB_ARCHIVE_TOKEN;
    const queries = [
      "topic:security+topic:supply-chain",
      "topic:sbom+topic:security",
      "topic:package-manager+stars:>1000"
    ];
    const results = await Promise.all(queries.map(q =>
      fetch(`https://api.github.com/search/repositories?q=${q}&sort=stars&per_page=50`, { headers })
        .then(r => r.ok ? r.json() : { items: [] })
        .then(d => (d.items || []).map(r => r.full_name))
        .catch(() => [])
    ));
    const dynamic = results.flat();
    return [...new Set([...dynamic, ...SEED_GITHUB])];
  } catch(e) {
    console.error("[github] dynamic fetch failed, using seeds:", e.message);
    return SEED_GITHUB;
  }
}

// Legacy named exports for backward compatibility with crawler-all.js
export const NPM_PACKAGES = SEED_NPM;
export const PYPI_PACKAGES = SEED_PYPI;
export const CARGO_PACKAGES = SEED_CARGO;
export const GITHUB_REPOS = SEED_GITHUB;
export const NUGET_PACKAGES = SEED_NUGET;
export const MAVEN_PACKAGES = SEED_MAVEN;
export const RUBYGEMS_PACKAGES = SEED_RUBYGEMS;
export const PACKAGIST_PACKAGES = SEED_PACKAGIST;

