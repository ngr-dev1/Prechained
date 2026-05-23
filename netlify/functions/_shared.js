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

// ── BITCOIN BLOCK ──────────────────────────────────────────────
let cachedBtcBlock = null;
let cachedBtcBlockTime = 0;

export async function getCurrentBtcBlock() {
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

// ── CRYPTO ─────────────────────────────────────────────────────
export function sha384(data) {
  return createHash("sha384").update(data).digest("hex");
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
      last_captured_at: new Date().toISOString()
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
  const manifestPath = await storeManifestInGithub(ecosystem, pkg.name, version, manifest);
  const btcBlock = await getCurrentBtcBlock();

  const { error } = await supabase.from("snapshots").insert({
    package_id: pkg.id, version, ecosystem,
    sha384_fingerprint: fingerprint,
    receipt_id: receiptId,
    btc_anchored: btcBlock ? true : false,
    btc_block: btcBlock || null,
    ots_proof: null,
    manifest_path: manifestPath,
    raw_metadata: license ? { license, crawler_sha384: crawlerSha384 || null } : { crawler_sha384: crawlerSha384 || null }
  });

  if (!error) {
    console.log(`CAPTURED: ${ecosystem}/${pkg.name}@${version} | btc:${btcBlock} | manifest:${manifestPath ? "stored" : "failed"}`);
  }
  return !error;
}

// ── PACKAGE LISTS ──────────────────────────────────────────────

export const NPM_PACKAGES = [
  "express","lodash","axios","react","vue","next","nuxt","webpack","babel",
  "typescript","eslint","prettier","jest","mocha","chalk","commander","dotenv",
  "moment","dayjs","uuid","nodemon","cors","helmet","bcrypt","jsonwebtoken",
  "mongoose","sequelize","prisma","socket.io","ws","tar","semver","glob",
  "rimraf","cross-env","concurrently","husky","lint-staged",
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
  "async","bluebird","p-limit","p-queue",
  "chokidar","fs-extra","mkdirp","inquirer","yargs","ora",
  "faker","mathjs","marked","highlight.js","prismjs",
  "flatted","undici","got","ky","superagent",
  "level","levelup","dataloader","webpack-cli","webpack-dev-server",
  "babel-loader","ts-loader","jest-circus","ts-jest","babel-jest",
  "react-dom","react-router","react-query","react-hook-form",
  "next-auth","swr","jotai","valtio","recoil",
  "lodash-es","fp-ts","valibot","drizzle-orm","objection",
  "inversify","tsyringe","typedi",
  "pino-http","winston-daily-rotate-file","log4js","bunyan",
  "node-schedule","agenda","bullmq","pg-boss",
  "passport-google-oauth20","passport-facebook","passport-github2",
  "express-validator","celebrate","typebox","superstruct",
  "serve-static","serve","http-server",
  "dotenv-expand","dotenv-flow",
  "execa","cross-spawn","which","path-exists","make-dir",
  "tempy","tmp","open","boxen","figlet","gradient-string",
  "meow","minimist","mri","arg","cosmiconfig","lilconfig",
  "update-notifier","latest-version","package-json",
  "tar-stream","tar-fs","decompress",
  "adm-zip","jszip","fflate",
  "twilio","vonage",
  "aws-sdk","@google-cloud/storage","cloudinary","multer-s3",
  "@grpc/grpc-js","protobufjs",
  "mocha","jasmine","ava","tap","tape",
  "swc","lerna","nx","turborepo","changesets","semantic-release",
  "hapi","restify","polka","micro",
  "keyv","cache-manager","lru-cache",
  "bee-queue",
  "xss","sanitize-html","dompurify",
  "swagger-jsdoc","swagger-ui-express","redoc",
  "needle","crawlee"
];

export const PYPI_PACKAGES = [
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
  "tabulate","prettytable",
  "colorama","termcolor","textual",
  "pyyaml","toml","configparser","dynaconf",
  "pytest-asyncio","anyio","trio","twisted",
  "flask-restful","flask-sqlalchemy","flask-login",
  "djangorestframework","django-cors-headers",
  "starlette","sanic","tornado",
  "pydantic-settings","msgspec","cattrs",
  "gymnasium","stable-baselines3",
  "mlflow","wandb","neptune",
  "docker","kubernetes","ansible","fabric",
  "apache-airflow","prefect","dagster","luigi"
];

export const CARGO_PACKAGES = [
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
  "fancy-regex","aho-corasick","memchr",
  "chrono-tz","time","hifitime",
  "ed25519-dalek","x25519-dalek","p256","k256",
  "argon2","bcrypt","pbkdf2","scrypt","password-hash"
];

export const NUGET_PACKAGES = [
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

export const MAVEN_PACKAGES = [
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

export const GITHUB_REPOS = [
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
  "vitest-dev/vitest","cypress-io/cypress",
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
  "semgrep/semgrep",
  "actions/checkout","actions/setup-node","actions/setup-python",
  "actions/cache","docker/build-push-action","docker/login-action"
];

export const RUBYGEMS_PACKAGES = [
  "rails","rake","bundler","rspec","minitest","sinatra","devise",
  "activesupport","activerecord","actionpack","actionview","actionmailer",
  "sidekiq","delayed_job","resque","que","good_job",
  "puma","unicorn","passenger","thin",
  "pg","mysql2","sqlite3","redis","mongo","mongoid",
  "carrierwave","shrine","paperclip",
  "nokogiri","mechanize","httparty","faraday","rest-client","typhoeus",
  "capybara","selenium-webdriver","watir","cucumber",
  "factory_bot","faker","ffaker","shoulda-matchers","vcr","webmock",
  "warden","pundit","cancancan","rolify","jwt",
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

export const PACKAGIST_PACKAGES = [
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
  "knplabs/knp-paginator-bundle",
  "slim/slim","slim/psr7","codeigniter4/framework",
  "cakephp/cakephp","yiisoft/yii2",
  "phpstan/phpstan","vimeo/psalm","squizlabs/php_codesniffer",
  "friendsofphp/php-cs-fixer","rector/rector",
  "behat/behat","codeception/codeception","phpspec/phpspec"
];
