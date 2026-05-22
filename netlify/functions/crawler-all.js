import { createClient } from "@supabase/supabase-js";
import { createHash } from "crypto";

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

const GITHUB_TOKEN = process.env.GITHUB_ARCHIVE_TOKEN;

// ── BITCOIN BLOCK ──────────────────────────────────────────────
let cachedBtcBlock = null;
let cachedBtcBlockTime = 0;

async function getCurrentBtcBlock() {
  // Cache for 5 minutes to avoid hammering blockstream
  if (cachedBtcBlock && Date.now() - cachedBtcBlockTime < 5 * 60 * 1000) {
    return cachedBtcBlock;
  }
  try {
    const res = await fetch("https://blockstream.info/api/blocks/tip/height");
    if (!res.ok) return null;
    cachedBtcBlock = parseInt((await res.text()).trim());
    cachedBtcBlockTime = Date.now();
    return cachedBtcBlock;
  } catch(e) { return null; }
}
const GITHUB_REPO = process.env.GITHUB_ARCHIVE_REPO || "ngr-dev1/prechained-archive";

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
  "express-session","express-rate-limit","supertest","sinon","nock",
  "dotenv","async","bluebird","p-limit","p-queue",
  "chokidar","fs-extra","mkdirp","inquirer","yargs","ora",
  "faker","mathjs","marked","highlight.js","prismjs",
  "flatted","undici","got","ky","superagent",
  "level","levelup","dataloader","webpack-cli","webpack-dev-server",
  "babel-loader","ts-loader","jest-circus","ts-jest","babel-jest",
  "react-dom","react-router","react-query","react-hook-form",
  "next-auth","swr","jotai","valtio","recoil",
  "lodash-es","fp-ts","valibot","drizzle-orm","objection",
  "inversify","tsyringe","bottlejs","typedi",
  "pino-http","winston-daily-rotate-file","log4js","bunyan",
  "node-schedule","agenda","bullmq","pg-boss",
  "passport-google-oauth20","passport-facebook","passport-github2",
  "express-validator","celebrate","typebox","superstruct",
  "compression","serve-static","serve","http-server",
  "dotenv-expand","dotenv-flow","cross-env",
  "execa","cross-spawn","which","path-exists","make-dir",
  "tempy","tmp","open","boxen","figlet","gradient-string",
  "meow","minimist","mri","arg","cosmiconfig","lilconfig",
  "update-notifier","latest-version","package-json",
  "tar","tar-stream","tar-fs","decompress",
  "archiver","adm-zip","jszip","fflate",
  "nodemailer","twilio","vonage",
  "aws-sdk","@google-cloud/storage","cloudinary","multer-s3",
  "grpc","@grpc/grpc-js","protobufjs",
  "jest","vitest","mocha","jasmine","ava","tap","tape",
  "webpack","vite","esbuild","rollup","parcel","swc",
  "lerna","nx","turborepo","changesets","semantic-release",
  "express","fastify","koa","hapi","restify","polka","micro",
  "mongoose","sequelize","typeorm","prisma","drizzle",
  "redis","ioredis","keyv","cache-manager","lru-cache",
  "bull","bullmq","bee-queue","agenda","node-schedule",
  "helmet","cors","csurf","xss","sanitize-html","dompurify",
  "swagger-jsdoc","swagger-ui-express","redoc",
  "axios","got","node-fetch","undici","superagent","needle","ky",
  "cheerio","puppeteer","playwright","crawlee"
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
  "hypothesis","faker","factory-boy",
  "stripe","twilio","sendgrid",
  "python-jose","itsdangerous","authlib","oauthlib",
  "grpcio","protobuf","msgpack",
  "pyarrow","dask","ray","joblib",
  "sympy","statsmodels","xgboost","lightgbm","catboost",
  "networkx","igraph",
  "sqlmodel","tortoise-orm","peewee","databases",
  "tqdm","alive-progress","halo","yaspin",
  "tabulate","prettytable","rich",
  "colorama","termcolor","textual",
  "pyyaml","toml","tomllib","configparser","dynaconf",
  "pytest-asyncio","anyio","trio","twisted",
  "flask-restful","flask-sqlalchemy","flask-login",
  "django-rest-framework","django-cors-headers",
  "fastapi","starlette","sanic","tornado","aiohttp",
  "pydantic","pydantic-settings","msgspec","cattrs",
  "gymnasium","stable-baselines3",
  "mlflow","wandb","neptune",
  "docker","kubernetes","ansible","fabric",
  "apache-airflow","prefect","dagster","luigi"
];

const CARGO_PACKAGES = [
  "serde","tokio","reqwest","clap","anyhow","thiserror","log","env_logger",
  "tracing","rand","uuid","chrono","regex","lazy_static","once_cell",
  "bytes","futures","async-trait","pin-project","tower","hyper","axum",
  "actix-web","warp","rocket","tide","salvo","poem",
  "sqlx","diesel","sea-orm","rusqlite","mongodb","redis","deadpool",
  "serde_json","serde_yaml","toml","ron","bincode","rmp-serde",
  "rayon","crossbeam","dashmap","parking_lot","arc-swap","flume",
  "image","rustls","native-tls","openssl","ring","sha2","md5","blake3",
  "base64","hex","percent-encoding","url","mime","http",
  "clap","indicatif","console","dialoguer","colored","owo-colors",
  "tempfile","walkdir","glob","ignore","notify","filetime",
  "nom","pest","logos","chumsky","winnow",
  "criterion","proptest","quickcheck","arbitrary",
  "serde_with","derive_more","strum","num","num-traits",
  "itertools","either","smallvec","tinyvec","arrayvec",
  "hashbrown","indexmap","linked-hash-map","multimap",
  "tokio-stream","tokio-util","tokio-tungstenite","tokio-rustls",
  "tonic","prost","jsonrpsee","tower-http","axum-extra",
  "tracing-subscriber","tracing-opentelemetry","opentelemetry",
  "config","dotenv","figment","envy","dotenvy",
  "wasm-bindgen","js-sys","web-sys","gloo","yew","leptos","dioxus",
  "rdkafka","lapin","async-nats",
  "prometheus","metrics","opentelemetry-prometheus",
  "zstd","lz4","snap","brotli","flate2","xz2","zip",
  "regex","fancy-regex","aho-corasick","memchr",
  "chrono-tz","time","hifitime",
  "ed25519-dalek","x25519-dalek","p256","k256",
  "argon2","bcrypt","pbkdf2","scrypt","password-hash"
];

const NUGET_PACKAGES = [
  "Newtonsoft.Json","System.Text.Json","AutoMapper","Serilog","NLog",
  "Microsoft.EntityFrameworkCore","Dapper","FluentValidation","MediatR",
  "Polly","Refit","RestSharp","Flurl",
  "xunit","NUnit","MSTest","Moq","NSubstitute","FluentAssertions",
  "Bogus","AutoFixture","Shouldly","SpecFlow",
  "Hangfire","Quartz.NET","MassTransit","RabbitMQ.Client","Confluent.Kafka",
  "StackExchange.Redis","MongoDB.Driver","Npgsql","MySqlConnector",
  "BCrypt.Net-Next","System.IdentityModel.Tokens.Jwt",
  "Swashbuckle.AspNetCore","NSwag","Mapster",
  "Scrutor","Autofac","SimpleInjector","Castle.Windsor",
  "CsvHelper","EPPlus","iTextSharp","PdfSharp","ClosedXML","NPOI",
  "ImageSharp","SkiaSharp","Magick.NET","QRCoder","ZXing.Net",
  "SignalR","Grpc.AspNetCore","protobuf-net","MessagePack","Orleans",
  "Serilog.AspNetCore","Serilog.Sinks.Console","Serilog.Sinks.File",
  "Microsoft.Extensions.Logging","Microsoft.Extensions.DependencyInjection",
  "Microsoft.Extensions.Configuration","Microsoft.Extensions.Caching.Memory",
  "Carter","FastEndpoints","Ardalis.ApiEndpoints",
  "ErrorOr","FluentResults","CSharpFunctionalExtensions","LanguageExt",
  "BenchmarkDotNet","Testcontainers","WireMock.Net",
  "Polly.Extensions.Http","Microsoft.Extensions.Http.Polly",
  "Azure.Storage.Blobs","Azure.Identity","Azure.KeyVault","Azure.ServiceBus",
  "AWSSDK.S3","AWSSDK.DynamoDBv2","AWSSDK.SQS",
  "Elasticsearch.Net","NEST","Meilisearch","Algolia.Search",
  "Stripe.net","Braintree","PayPalCheckoutSdk",
  "Twilio","SendGrid","PostmarkDotNet","FluentEmail"
];

const MAVEN_PACKAGES = [
  "com.google.guava:guava","org.apache.commons:commons-lang3",
  "commons-io:commons-io","org.slf4j:slf4j-api",
  "ch.qos.logback:logback-classic","org.apache.logging.log4j:log4j-core",
  "junit:junit","org.junit.jupiter:junit-jupiter",
  "org.mockito:mockito-core","org.springframework:spring-core",
  "org.springframework.boot:spring-boot-starter",
  "org.springframework.boot:spring-boot-starter-web",
  "org.springframework.boot:spring-boot-starter-data-jpa",
  "org.springframework.boot:spring-boot-starter-security",
  "org.springframework.boot:spring-boot-starter-actuator",
  "com.fasterxml.jackson.core:jackson-databind",
  "io.netty:netty-all","io.vertx:vertx-core",
  "io.quarkus:quarkus-core","org.hibernate:hibernate-core",
  "org.mybatis:mybatis","org.apache.kafka:kafka-clients",
  "io.projectreactor:reactor-core","io.reactivex.rxjava3:rxjava",
  "org.bouncycastle:bcprov-jdk15on","com.auth0:java-jwt",
  "org.postgresql:postgresql","mysql:mysql-connector-java",
  "com.h2database:h2","redis.clients:jedis","io.lettuce:lettuce-core",
  "org.apache.httpcomponents:httpclient","com.squareup.okhttp3:okhttp",
  "com.google.code.gson:gson","org.json:json",
  "org.yaml:snakeyaml","org.mapstruct:mapstruct","org.projectlombok:lombok",
  "com.google.inject:guice","io.micrometer:micrometer-core",
  "com.amazonaws:aws-java-sdk","software.amazon.awssdk:s3",
  "com.google.cloud:google-cloud-storage",
  "org.apache.commons:commons-collections4","org.apache.commons:commons-math3",
  "com.hazelcast:hazelcast","org.redisson:redisson","com.github.ben-manes.caffeine:caffeine",
  "io.grpc:grpc-netty","io.grpc:grpc-stub","io.grpc:grpc-protobuf",
  "com.stripe:stripe-java","com.twilio.sdk:twilio","com.sendgrid:sendgrid-java",
  "org.elasticsearch.client:elasticsearch-rest-high-level-client",
  "org.apache.lucene:lucene-core",
  "com.mongodb:mongodb-driver-sync",
  "io.swagger.core.v3:swagger-core","org.springdoc:springdoc-openapi-ui"
];

const GITHUB_REPOS = [
  "expressjs/express","lodash/lodash","axios/axios","facebook/react",
  "vuejs/vue","vercel/next.js","nuxt/nuxt","webpack/webpack",
  "babel/babel","microsoft/TypeScript","eslint/eslint",
  "prettier/prettier","jestjs/jest","mochajs/mocha",
  "chalk/chalk","tj/commander.js","motdotla/dotenv",
  "moment/moment","iamkun/dayjs","remy/nodemon",
  "expressjs/cors","helmetjs/helmet","dcodeIO/bcrypt.js",
  "auth0/node-jsonwebtoken","Automattic/mongoose","sequelize/sequelize",
  "prisma/prisma","socketio/socket.io","websockets/ws","isaacs/node-tar",
  "npm/node-semver","fastify/fastify","koajs/koa","hapijs/hapi",
  "ReactiveX/rxjs","ramda/ramda","immerjs/immer",
  "mobxjs/mobx","reduxjs/redux","pmndrs/zustand",
  "graphql/graphql-js","apollographql/apollo-server",
  "typeorm/typeorm","knex/knex","vitejs/vite",
  "rollup/rollup","evanw/esbuild","tailwindlabs/tailwindcss",
  "postcss/postcss","mrdoob/three.js","d3/d3","chartjs/Chart.js",
  "date-fns/date-fns","winstonjs/winston","pinojs/pino",
  "redis/node-redis","luin/ioredis","OptimalBits/bull",
  "stripe/stripe-node","nodemailer/nodemailer","ajv-validator/ajv",
  "mqttjs/MQTT.js","tulios/kafkajs","brianc/node-postgres",
  "sidorares/node-mysql2","WiseLibs/better-sqlite3",
  "cheeriojs/cheerio","jsdom/jsdom","SheetJS/sheetjs",
  "jimp-dev/jimp","foliojs/pdfkit","Hopding/pdf-lib",
  "ai/nanoid","simov/slugify","validatorjs/validator",
  "caolan/async","petkaantonov/bluebird",
  "sindresorhus/p-limit","paulmillr/chokidar",
  "jprichardson/node-fs-extra","SBoudrias/Inquirer.js",
  "yargs/yargs","sindresorhus/ora","faker-js/faker",
  "josdejong/mathjs","markedjs/marked",
  "highlightjs/highlight.js","PrismJS/prism",
  "sindresorhus/got","visionmedia/superagent",
  "graphql/dataloader","webpack/webpack-cli",
  "jestjs/jest","vitest-dev/vitest","cypress-io/cypress",
  "microsoft/playwright","puppeteer/puppeteer",
  "pallets/flask","django/django","tiangolo/fastapi",
  "psf/requests","numpy/numpy","pandas-dev/pandas",
  "scikit-learn/scikit-learn","tensorflow/tensorflow",
  "pytorch/pytorch","keras-team/keras","celery/celery",
  "redis/redis-py","pymongo/mongo-python-driver",
  "python-pillow/Pillow","nltk/nltk","explosion/spaCy",
  "huggingface/transformers","pytest-dev/pytest","psf/black",
  "PyCQA/flake8","python/mypy","PyCQA/pylint",
  "encode/httpx","aio-libs/aiohttp","Textualize/rich",
  "tiangolo/typer","Delgan/loguru","pydantic/pydantic",
  "scrapy/scrapy","SeleniumHQ/selenium",
  "serde-rs/serde","tokio-rs/tokio","seanmonstar/reqwest",
  "clap-rs/clap","dtolnay/anyhow","dtolnay/thiserror",
  "tokio-rs/axum","actix/actix-web","diesel-rs/diesel","launchbadge/sqlx",
  "SeaQL/sea-orm","rayon-rs/rayon","image-rs/image",
  "rustls/rustls","briansmith/ring","RustCrypto/hashes",
  "dotnet/runtime","dotnet/aspnetcore","dotnet/efcore",
  "AutoMapper/AutoMapper","serilog/serilog","NLog/NLog",
  "App-vNext/Polly","reactiveui/refit","restsharp/RestSharp",
  "xunit/xunit","nunit/nunit","moq/moq4","fluentassertions/fluentassertions",
  "HangfireIO/Hangfire","MassTransit/MassTransit",
  "StackExchange/StackExchange.Redis","mongodb/mongo-csharp-driver",
  "npgsql/npgsql","SixLabors/ImageSharp","dlemstra/Magick.NET",
  "JamesNK/Newtonsoft.Json",
  "spring-projects/spring-framework","spring-projects/spring-boot",
  "apache/kafka","apache/commons-lang","apache/logging-log4j2",
  "junit-team/junit5","mockito/mockito","google/guava",
  "netty/netty","eclipse-vertx/vert.x","quarkusio/quarkus",
  "hibernate/hibernate-orm","mybatis/mybatis-3",
  "reactor/reactor-core","ReactiveX/RxJava",
  "gin-gonic/gin","gorilla/mux","labstack/echo","gofiber/fiber",
  "sirupsen/logrus","uber-go/zap","stretchr/testify",
  "spf13/cobra","spf13/viper","joho/godotenv",
  "golang-jwt/jwt","google/uuid","go-redis/redis",
  "go-gorm/gorm","mongodb/mongo-go-driver","lib/pq",
  "gorilla/websocket","nats-io/nats.go","segmentio/kafka-go",
  "prometheus/client_golang","open-telemetry/opentelemetry-go",
  "hashicorp/vault","ossf/scorecard","ossf/package-analysis",
  "ossf/malicious-packages","sigstore/cosign","sigstore/sigstore",
  "anchore/syft","anchore/grype","anchore/sbom-action",
  "aquasecurity/trivy","snyk/snyk","google/osv-scanner",
  "actions/checkout","actions/setup-node","actions/setup-python",
  "actions/cache","docker/build-push-action","docker/login-action"
];

const RUBYGEMS_PACKAGES = [
  "rails","rake","bundler","rspec","minitest","sinatra","devise",
  "activesupport","activerecord","actionpack","actionview","actionmailer",
  "sidekiq","delayed_job","resque","que","good_job",
  "puma","unicorn","passenger","thin",
  "pg","mysql2","sqlite3","redis","mongo","mongoid",
  "carrierwave","shrine","paperclip",
  "nokogiri","mechanize","httparty","faraday","rest-client","typhoeus",
  "capybara","selenium-webdriver","watir","cucumber",
  "factory_bot","faker","ffaker","shoulda-matchers","vcr","webmock",
  "devise","warden","pundit","cancancan","rolify","jwt",
  "bcrypt","attr_encrypted","lockbox",
  "rubocop","brakeman","bundler-audit","reek",
  "pry","byebug","awesome_print",
  "stripe","braintree","active_merchant",
  "aws-sdk","cloudinary",
  "elasticsearch","searchkick","ransack","pg_search",
  "kaminari","will_paginate","pagy","friendly_id",
  "simple_form","reform","dry-validation","dry-schema",
  "state_machines","aasm","workflow","statesman",
  "money","money-rails","countries",
  "whenever","clockwork","rufus-scheduler","sidekiq-scheduler",
  "scenic","paranoia","paper_trail","audited",
  "graphql","grape","rack","rack-cors","rack-attack",
  "liquid","slim","haml","jbuilder","blueprinter"
];

const PACKAGIST_PACKAGES = [
  "symfony/symfony","laravel/framework","guzzlehttp/guzzle",
  "monolog/monolog","phpunit/phpunit","doctrine/orm",
  "symfony/console","symfony/http-foundation","symfony/routing",
  "symfony/event-dispatcher","symfony/dependency-injection",
  "laravel/tinker","laravel/socialite","laravel/cashier",
  "illuminate/support","illuminate/database","illuminate/http",
  "nesbot/carbon","vlucas/phpdotenv",
  "phpspec/prophecy","mockery/mockery","fakerphp/faker",
  "ramsey/uuid","league/fractal","league/flysystem",
  "spatie/laravel-permission","spatie/laravel-medialibrary",
  "spatie/laravel-activitylog","spatie/laravel-query-builder",
  "barryvdh/laravel-debugbar","barryvdh/laravel-ide-helper",
  "predis/predis","aws/aws-sdk-php",
  "stripe/stripe-php","braintree/braintree_php",
  "twilio/sdk","sendgrid/sendgrid",
  "elasticsearch/elasticsearch","algolia/algoliasearch-client-php",
  "tymon/jwt-auth","firebase/php-jwt","lcobucci/jwt",
  "league/oauth2-server","league/oauth2-client",
  "pragmarx/google2fa","robthree/twofactorauth",
  "kaminari","knplabs/knp-paginator-bundle",
  "slim/slim","slim/psr7","codeigniter4/framework",
  "cakephp/cakephp","yiisoft/yii2",
  "phpstan/phpstan","vimeo/psalm","squizlabs/php_codesniffer",
  "friendsofphp/php-cs-fixer","rector/rector",
  "behat/behat","codeception/codeception","phpspec/phpspec"
];

// ── UTILITIES ──────────────────────────────────────────────────

function sha384(data) {
  return createHash("sha384").update(data).digest("hex");
}

function generateReceiptId() {
  return "NGR-PC-" + Date.now().toString(36).toUpperCase() +
    Math.random().toString(36).substring(2, 8).toUpperCase();
}

// ── GITHUB MANIFEST STORAGE ────────────────────────────────────

async function storeManifestInGithub(ecosystem, name, version, manifest) {
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

async function upsertPackage(name, ecosystem, description, latestVersion, totalVersions) {
  const { data, error } = await supabase
    .from("packages")
    .upsert({
      name, ecosystem,
      description: (description || "").substring(0, 200),
      latest_version: latestVersion,
      total_versions: totalVersions,
      last_captured_at: new Date().toISOString()
    }, { onConflict: "name,ecosystem" })
    .select().single();
  return error ? null : data;
}

async function captureVersion(pkg, version, ecosystem, integrity, shasum, license, dependencies, manifest) {
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
  const receiptId = generateReceiptId();

  // Store manifest in GitHub archive
  const manifestPath = await storeManifestInGithub(ecosystem, pkg.name, version, manifest);

  // Get current Bitcoin block at time of capture
  const btcBlock = await getCurrentBtcBlock();

  const { error } = await supabase.from("snapshots").insert({
    package_id: pkg.id, version, ecosystem,
    sha384_fingerprint: fingerprint,
    receipt_id: receiptId,
    btc_anchored: btcBlock ? true : false,
    btc_block: btcBlock || null,
    ots_proof: null,
    manifest_path: manifestPath,
    raw_metadata: license ? { license } : null
  });

  if (!error) {
    console.log("CAPTURED: " + ecosystem + "/" + pkg.name + "@" + version +
      " | manifest: " + (manifestPath ? "stored" : "failed"));
  }
  return !error;
}

// ── NPM ────────────────────────────────────────────────────────
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
      const pkg = await upsertPackage(name, "npm", data.description, latest, allVersions.length);
      if (!pkg) continue;
      const { data: existing } = await supabase.from("snapshots").select("version").eq("package_id", pkg.id);
      const capturedSet = new Set((existing||[]).map(s => s.version));
      const uncaptured = allVersions.filter(v => !capturedSet.has(v)).slice(0, 10);
      for (const version of uncaptured) {
        if (Date.now() - startTime > 7000) break;
        const vd = data.versions[version];
        if (!vd) continue;
        const manifest = {
          name, version, ecosystem: "npm",
          description: data.description,
          license: vd.license,
          dependencies: vd.dependencies || {},
          devDependencies: vd.devDependencies || {},
          peerDependencies: vd.peerDependencies || {},
          engines: vd.engines || {},
          dist: { integrity: vd.dist?.integrity, shasum: vd.dist?.shasum },
          captured_at: new Date().toISOString(),
          captured_by: "prechained.com"
        };
        if (await captureVersion(pkg, version, "npm",
          vd.dist?.integrity, vd.dist?.shasum, vd.license,
          Object.keys(vd.dependencies || {}), manifest)) captured++;
      }
    } catch(e) {}
  }
  return captured;
}

// ── PYPI ───────────────────────────────────────────────────────
async function crawlPypi(startTime) {
  let captured = 0;
  const shuffled = [...PYPI_PACKAGES].sort(() => Math.random() - 0.5);
  for (const name of shuffled) {
    if (Date.now() - startTime > 7000) break;
    try {
      const res = await fetch(`https://pypi.org/pypi/${name}/json`);
      if (!res.ok) continue;
      const data = await res.json();
      const latest = data.info?.version;
      if (!latest) continue;
      const allVersions = Object.keys(data.releases || {}).filter(v => (data.releases[v]||[]).length > 0);
      const pkg = await upsertPackage(name, "pypi", data.info?.summary, latest, allVersions.length);
      if (!pkg) continue;
      const { data: existing } = await supabase.from("snapshots").select("version").eq("package_id", pkg.id);
      const capturedSet = new Set((existing||[]).map(s => s.version));
      const uncaptured = allVersions.filter(v => !capturedSet.has(v)).slice(0, 8);
      for (const version of uncaptured) {
        if (Date.now() - startTime > 7000) break;
        const files = data.releases[version] || [];
        const wheel = files.find(f => f.packagetype === "bdist_wheel") || files[0];
        const manifest = {
          name, version, ecosystem: "pypi",
          summary: data.info?.summary,
          license: data.info?.license,
          author: data.info?.author,
          requires_python: data.info?.requires_python,
          requires_dist: data.info?.requires_dist || [],
          dist: { url: wheel?.url, sha256: wheel?.digests?.sha256, md5: wheel?.digests?.md5 },
          captured_at: new Date().toISOString(),
          captured_by: "prechained.com"
        };
        if (await captureVersion(pkg, version, "pypi",
          wheel?.digests?.sha256 ? "sha256:" + wheel.digests.sha256 : "",
          wheel?.digests?.md5 || "", data.info?.license || [], manifest)) captured++;
      }
    } catch(e) {}
  }
  return captured;
}

// ── CARGO ──────────────────────────────────────────────────────
async function crawlCargo(startTime) {
  let captured = 0;
  const shuffled = [...CARGO_PACKAGES].sort(() => Math.random() - 0.5);
  for (const name of shuffled) {
    if (Date.now() - startTime > 7000) break;
    try {
      const res = await fetch("https://crates.io/api/v1/crates/" + name, {
        headers: { "User-Agent": "prechained.com/1.0" }
      });
      if (!res.ok) continue;
      const data = await res.json();
      const krate = data.crate;
      if (!krate) continue;
      const allVersions = (data.versions||[]).map(v => v.num);
      const pkg = await upsertPackage(name, "cargo", krate.description, krate.newest_version, allVersions.length);
      if (!pkg) continue;
      const { data: existing } = await supabase.from("snapshots").select("version").eq("package_id", pkg.id);
      const capturedSet = new Set((existing||[]).map(s => s.version));
      const uncaptured = allVersions.filter(v => !capturedSet.has(v)).slice(0, 8);
      for (const version of uncaptured) {
        if (Date.now() - startTime > 7000) break;
        const vData = (data.versions||[]).find(v => v.num === version);
        const manifest = {
          name, version, ecosystem: "cargo",
          description: krate.description,
          license: vData?.license,
          checksum: vData?.checksum,
          features: vData?.features || {},
          downloads: vData?.downloads,
          captured_at: new Date().toISOString(),
          captured_by: "prechained.com"
        };
        if (await captureVersion(pkg, version, "cargo",
          vData?.checksum ? "sha256:" + vData.checksum : "",
          "", vData?.license || "", [], manifest)) captured++;
      }
    } catch(e) {}
  }
  return captured;
}

// ── NUGET ──────────────────────────────────────────────────────
async function crawlNuget(startTime) {
  let captured = 0;
  const shuffled = [...NUGET_PACKAGES].sort(() => Math.random() - 0.5);
  for (const name of shuffled) {
    if (Date.now() - startTime > 7000) break;
    try {
      const res = await fetch("https://api.nuget.org/v3/registration5-semver1/" + name.toLowerCase() + "/index.json");
      if (!res.ok) continue;
      const data = await res.json();
      const items = data.items || [];
      if (!items.length) continue;
      const allVersions = items.flatMap(i => (i.items||[]).map(p => p.catalogEntry?.version)).filter(Boolean);
      const latest = allVersions[allVersions.length - 1];
      if (!latest) continue;
      const firstEntry = items[0]?.items?.[0]?.catalogEntry;
      const pkg = await upsertPackage(name, "nuget", firstEntry?.description, latest, allVersions.length);
      if (!pkg) continue;
      const { data: existing } = await supabase.from("snapshots").select("version").eq("package_id", pkg.id);
      const capturedSet = new Set((existing||[]).map(s => s.version));
      const uncaptured = allVersions.filter(v => !capturedSet.has(v)).slice(0, 8);
      for (const version of uncaptured) {
        if (Date.now() - startTime > 7000) break;
        const entry = items.flatMap(i => i.items||[]).find(p => p.catalogEntry?.version === version)?.catalogEntry;
        const manifest = {
          name, version, ecosystem: "nuget",
          description: entry?.description,
          license: entry?.licenseExpression || entry?.licenseUrl,
          authors: entry?.authors,
          dependencies: entry?.dependencyGroups || [],
          captured_at: new Date().toISOString(),
          captured_by: "prechained.com"
        };
        if (await captureVersion(pkg, version, "nuget",
          "", "", entry?.licenseExpression || "", [], manifest)) captured++;
      }
    } catch(e) {}
  }
  return captured;
}

// ── MAVEN ──────────────────────────────────────────────────────
async function crawlMaven(startTime) {
  let captured = 0;
  const shuffled = [...MAVEN_PACKAGES].sort(() => Math.random() - 0.5);
  for (const artifact of shuffled) {
    if (Date.now() - startTime > 7000) break;
    try {
      const [groupId, artifactId] = artifact.split(":");
      if (!groupId || !artifactId) continue;
      const res = await fetch(
        "https://search.maven.org/solrsearch/select?q=g:" + encodeURIComponent('"' + groupId + '"') +
        "+AND+a:" + encodeURIComponent('"' + artifactId + '"') + "&core=gav&rows=20&wt=json"
      );
      if (!res.ok) continue;
      const data = await res.json();
      const docs = data.response?.docs || [];
      if (!docs.length) continue;
      const allVersions = docs.map(d => d.v).filter(Boolean);
      const latest = allVersions[0];
      if (!latest) continue;
      const pkg = await upsertPackage(artifact, "maven", groupId + ":" + artifactId, latest, allVersions.length);
      if (!pkg) continue;
      const { data: existing } = await supabase.from("snapshots").select("version").eq("package_id", pkg.id);
      const capturedSet = new Set((existing||[]).map(s => s.version));
      const uncaptured = allVersions.filter(v => !capturedSet.has(v)).slice(0, 8);
      for (const version of uncaptured) {
        if (Date.now() - startTime > 7000) break;
        const manifest = {
          groupId, artifactId, version, ecosystem: "maven",
          captured_at: new Date().toISOString(),
          captured_by: "prechained.com"
        };
        if (await captureVersion(pkg, version, "maven", "", "", "", [], manifest)) captured++;
      }
    } catch(e) {}
  }
  return captured;
}

// ── GITHUB ─────────────────────────────────────────────────────
async function crawlGithub(startTime) {
  let captured = 0;
  const shuffled = [...GITHUB_REPOS].sort(() => Math.random() - 0.5);
  const headers = {
    "Accept": "application/vnd.github.v3+json",
    "User-Agent": "prechained.com/1.0"
  };
  if (GITHUB_TOKEN) headers["Authorization"] = "token " + GITHUB_TOKEN;
  for (const repo of shuffled) {
    if (Date.now() - startTime > 7000) break;
    try {
      const repoRes = await fetch("https://api.github.com/repos/" + repo, { headers });
      if (!repoRes.ok) continue;
      const repoData = await repoRes.json();
      const defaultBranch = repoData.default_branch || "main";
      const commitRes = await fetch("https://api.github.com/repos/" + repo + "/commits/" + defaultBranch, { headers });
      if (!commitRes.ok) continue;
      const commitData = await commitRes.json();
      const latestSha = commitData.sha;
      const treeSha = commitData.commit?.tree?.sha || "";
      const version = latestSha.substring(0, 12);
      const pkg = await upsertPackage(repo, "github", repoData.description, version, repoData.size || 1);
      if (!pkg) continue;
      const { data: existing } = await supabase.from("snapshots").select("id").eq("package_id", pkg.id).eq("version", version).single();
      if (existing) continue;
      const manifest = {
        repo, commit_sha: latestSha, tree_sha: treeSha,
        branch: defaultBranch, ecosystem: "github",
        description: repoData.description,
        license: repoData.license?.spdx_id,
        stars: repoData.stargazers_count,
        language: repoData.language,
        captured_at: new Date().toISOString(),
        captured_by: "prechained.com"
      };
      const payload = JSON.stringify({
        repo, commit_sha: latestSha, tree_sha: treeSha,
        branch: defaultBranch, ecosystem: "github",
        timestamp: new Date().toISOString()
      });
      const fingerprint = sha384(payload);
      const manifestPath = await storeManifestInGithub("github", repo, version, manifest);
      const { error } = await supabase.from("snapshots").insert({
        package_id: pkg.id, version, ecosystem: "github",
        sha384_fingerprint: fingerprint,
        receipt_id: generateReceiptId(),
        btc_anchored: false, ots_proof: null,
        manifest_path: manifestPath,
        raw_metadata: { commit_sha: latestSha, tree_sha: treeSha, branch: defaultBranch, license: repoData.license?.spdx_id || "" }
      });
      if (!error) { captured++; }
    } catch(e) {}
  }
  return captured;
}

// ── RUBYGEMS ───────────────────────────────────────────────────
async function crawlRubygems(startTime) {
  let captured = 0;
  const shuffled = [...RUBYGEMS_PACKAGES].sort(() => Math.random() - 0.5);
  for (const name of shuffled) {
    if (Date.now() - startTime > 7000) break;
    try {
      const res = await fetch("https://rubygems.org/api/v1/gems/" + name + ".json");
      if (!res.ok) continue;
      const data = await res.json();
      const latest = data.version;
      if (!latest) continue;
      const versionsRes = await fetch("https://rubygems.org/api/v1/versions/" + name + ".json");
      if (!versionsRes.ok) continue;
      const versions = await versionsRes.json();
      const allVersions = versions.map(v => v.number).filter(Boolean);
      const pkg = await upsertPackage(name, "rubygems", data.info, latest, allVersions.length);
      if (!pkg) continue;
      const { data: existing } = await supabase.from("snapshots").select("version").eq("package_id", pkg.id);
      const capturedSet = new Set((existing||[]).map(s => s.version));
      const uncaptured = allVersions.filter(v => !capturedSet.has(v)).slice(0, 8);
      for (const version of uncaptured) {
        if (Date.now() - startTime > 7000) break;
        const vData = versions.find(v => v.number === version);
        const manifest = {
          name, version, ecosystem: "rubygems",
          description: data.info,
          licenses: vData?.licenses || [],
          sha: vData?.sha,
          dependencies: vData?.dependencies || {},
          captured_at: new Date().toISOString(),
          captured_by: "prechained.com"
        };
        if (await captureVersion(pkg, version, "rubygems",
          vData?.sha ? "sha256:" + vData.sha : "",
          "", vData?.licenses?.[0] || "", [], manifest)) captured++;
      }
    } catch(e) {}
  }
  return captured;
}

// ── PACKAGIST ──────────────────────────────────────────────────
async function crawlPackagist(startTime) {
  let captured = 0;
  const shuffled = [...PACKAGIST_PACKAGES].sort(() => Math.random() - 0.5);
  for (const name of shuffled) {
    if (Date.now() - startTime > 7000) break;
    try {
      const res = await fetch("https://packagist.org/packages/" + name + ".json");
      if (!res.ok) continue;
      const data = await res.json();
      const pkg_data = data.package;
      if (!pkg_data) continue;
      const allVersions = Object.keys(pkg_data.versions || {})
        .filter(v => !v.includes("dev") && !v.includes("alpha") && !v.includes("beta"))
        .slice(0, 30);
      if (!allVersions.length) continue;
      const latest = allVersions[0].replace(/^v/, "");
      const firstVersion = pkg_data.versions[allVersions[0]];
      const pkg = await upsertPackage(name, "packagist", firstVersion?.description || "", latest, allVersions.length);
      if (!pkg) continue;
      const { data: existing } = await supabase.from("snapshots").select("version").eq("package_id", pkg.id);
      const capturedSet = new Set((existing||[]).map(s => s.version));
      const uncaptured = allVersions.filter(v => !capturedSet.has(v.replace(/^v/, ""))).slice(0, 8);
      for (const version of uncaptured) {
        if (Date.now() - startTime > 7000) break;
        const vData = pkg_data.versions[version];
        const cleanVersion = version.replace(/^v/, "");
        const manifest = {
          name, version: cleanVersion, ecosystem: "packagist",
          description: vData?.description,
          license: vData?.license?.[0],
          require: vData?.require || {},
          dist: vData?.dist || {},
          captured_at: new Date().toISOString(),
          captured_by: "prechained.com"
        };
        if (await captureVersion(pkg, cleanVersion, "packagist",
          vData?.dist?.shasum ? "sha1:" + vData.dist.shasum : "",
          "", vData?.license?.[0] || "",
          Object.keys(vData?.require || {}), manifest)) captured++;
      }
    } catch(e) {}
  }
  return captured;
}

// ── MAIN HANDLER ───────────────────────────────────────────────
export default async function handler(req, context) {
  const startTime = Date.now();
  console.log("Universal crawler running at", new Date().toISOString());

  const [npm, pypi, cargo, nuget, maven, github, rubygems, packagist] = await Promise.all([
    crawlNpm(startTime),
    crawlPypi(startTime),
    crawlCargo(startTime),
    crawlNuget(startTime),
    crawlMaven(startTime),
    crawlGithub(startTime),
    crawlRubygems(startTime),
    crawlPackagist(startTime)
  ]);

  const total = npm + pypi + cargo + nuget + maven + github + rubygems + packagist;
  console.log("Done: " + total + " total | npm:" + npm + " pypi:" + pypi +
    " cargo:" + cargo + " nuget:" + nuget + " maven:" + maven +
    " github:" + github + " rubygems:" + rubygems + " packagist:" + packagist);

  return new Response(JSON.stringify({
    ok: true,
    captured: { total, npm, pypi, cargo, nuget, maven, github, rubygems, packagist },
    timestamp: new Date().toISOString()
  }), {
    headers: { "Content-Type": "application/json" }
  });
}
