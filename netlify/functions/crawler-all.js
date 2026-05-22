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
  "express-session","express-rate-limit","supertest","sinon","nock",
  "dotenv","async","bluebird","p-limit","p-queue",
  "chokidar","fs-extra","mkdirp","inquirer","yargs","ora",
  "faker","mathjs","marked","highlight.js","prismjs",
  "flatted","undici","got","ky","superagent",
  "level","levelup","dataloader","webpack-cli","webpack-dev-server",
  "babel-loader","ts-loader","jest-circus","ts-jest","babel-jest",
  "react-dom","react-router","react-query","react-hook-form",
  "next-auth","swr","zustand","jotai","valtio","recoil",
  "tailwind-merge","clsx","classnames","framer-motion","gsap",
  "lodash-es","ramda","fp-ts","io-ts","zod","valibot",
  "drizzle-orm","mikro-orm","objection","bookshelf","waterline",
  "inversify","tsyringe","awilix","bottlejs","typedi",
  "pino-http","winston-daily-rotate-file","log4js","bunyan",
  "node-schedule","agenda","bee-queue","bullmq","pg-boss",
  "passport-google-oauth20","passport-facebook","passport-github2",
  "express-validator","celebrate","typebox","superstruct",
  "axios-retry","got-retry","node-retry","async-retry",
  "compression","serve-static","serve","http-server","live-server",
  "dotenv-expand","dotenv-flow","dotenv-safe","cross-env",
  "rimraf","mkdirp","glob","minimatch","micromatch","picomatch",
  "execa","cross-spawn","which","path-exists","make-dir",
  "tempy","tmp","temp","os-tmpdir","clean-temp",
  "open","opener","opn","xdg-open",
  "boxen","figlet","gradient-string","cli-spinners","listr2",
  "meow","minimist","mri","arg","parse-args","getopts",
  "cosmiconfig","lilconfig","rc","conf","preferences",
  "update-notifier","latest-version","package-json","npm-name",
  "semver","compare-versions","satisfies","node-version",
  "tar","tar-stream","tar-fs","gunzip-maybe","decompress",
  "archiver","zip-a-folder","adm-zip","jszip","fflate",
  "sharp","jimp","canvas","fabric","konva","paper",
  "pdfkit","pdf-lib","pdf-parse","pdf2pic","pdfjs-dist",
  "nodemailer","sendgrid","mailgun-js","postmark","ses",
  "twilio","vonage","nexmo","messagebird","sinch",
  "stripe","paypal-rest-sdk","braintree","square","mollie",
  "aws-sdk","@google-cloud/storage","azure-storage","cloudinary","multer-s3",
  "socket.io-client","socket.io-redis","socket.io-emitter","ws","uws",
  "grpc","@grpc/grpc-js","protobufjs","thrift","avsc",
  "cheerio","puppeteer","playwright","selenium-webdriver","webdriverio",
  "jest","vitest","mocha","jasmine","ava","tap","tape",
  "sinon","nock","msw","supertest","pactum","jest-fetch-mock",
  "eslint","prettier","tslint","jshint","standard","xo",
  "husky","lint-staged","commitlint","semantic-release","standard-version",
  "webpack","vite","esbuild","rollup","parcel","swc","turbopack",
  "babel","@babel/core","@babel/preset-env","@babel/preset-react",
  "typescript","ts-node","tsx","sucrase","@swc/core",
  "jest","@jest/core","jest-environment-jsdom","jest-environment-node",
  "react-testing-library","@testing-library/react","@testing-library/vue",
  "cypress","playwright","puppeteer","nightwatch","webdriverio",
  "storybook","chromatic","percy","applitools",
  "lerna","nx","turborepo","changesets","rush",
  "express","fastify","koa","hapi","restify","polka","micro",
  "nest","loopback","sails","strapi","keystone","payload",
  "next","nuxt","remix","astro","sveltekit","solidstart",
  "mongoose","sequelize","typeorm","prisma","drizzle","mikro-orm",
  "redis","ioredis","keyv","cache-manager","lru-cache","node-cache",
  "bull","bullmq","bee-queue","agenda","node-schedule","cron",
  "mqtt","amqplib","kafkajs","nats","rhea","stompit",
  "passport","jsonwebtoken","bcrypt","argon2","scrypt",
  "helmet","cors","csurf","hpp","xss","sanitize-html","dompurify",
  "compression","morgan","multer","busboy","formidable",
  "swagger-jsdoc","swagger-ui-express","openapi-validator","redoc",
  "winston","pino","bunyan","log4js","debug","loglevel","signale",
  "dotenv","config","convict","nconf","cosmiconfig","rc",
  "axios","got","node-fetch","undici","superagent","needle","ky",
  "cheerio","puppeteer","playwright","crawlee","apify","scrapy"
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
  "lxml","html5lib","cssselect","pyquery","mechanize",
  "hypothesis","faker","factory-boy","model-bakery","mixer",
  "stripe","twilio","sendgrid","mailchimp3","braintree",
  "python-jose","itsdangerous","authlib","oauthlib","social-auth-core",
  "grpcio","protobuf","thrift","avro-python3","msgpack",
  "pyarrow","dask","ray","joblib","multiprocess","concurrent-futures",
  "sympy","statsmodels","xgboost","lightgbm","catboost",
  "networkx","igraph","graph-tool","pyvis","gephi",
  "sqlmodel","tortoise-orm","peewee","pony","databases",
  "celery","dramatiq","rq","huey","apscheduler","schedule",
  "parameterized","responses","freezegun","time-machine","moto",
  "tqdm","alive-progress","halo","yaspin","progress",
  "tabulate","prettytable","texttable","terminaltables","asciitree",
  "colorama","termcolor","blessed","urwid","textual","rich",
  "pathlib","watchdog","schedule","apscheduler","croniter",
  "pyyaml","toml","tomllib","configparser","dynaconf","decouple",
  "pyserial","pyusb","hid","bluetooth","pyobd","can",
  "pygame","pyglet","arcade","pyxel","panda3d","ursina",
  "wxpython","tkinter","pyqt5","pyside2","kivy","dear-imgui",
  "nltk","gensim","fasttext","word2vec","bert","sentence-transformers",
  "gymnasium","stable-baselines3","rllib","dopamine","acme",
  "apache-airflow","prefect","dagster","luigi","kedro","zenml",
  "mlflow","wandb","neptune","comet-ml","clearml","dvclive",
  "docker","kubernetes","ansible","terraform","pulumi","fabric",
  "pytest-asyncio","anyio","trio","curio","asyncio","twisted",
  "flask-restful","flask-sqlalchemy","flask-login","flask-jwt-extended",
  "django-rest-framework","django-cors-headers","django-celery-beat",
  "fastapi","starlette","sanic","tornado","aiohttp","blacksheep",
  "pydantic","pydantic-settings","pydantic-v2","msgspec","cattrs"
];

const CARGO_PACKAGES = [
  "serde","tokio","reqwest","clap","anyhow","thiserror","log","env_logger",
  "tracing","rand","uuid","chrono","regex","lazy_static","once_cell",
  "bytes","futures","async-trait","pin-project","tower","hyper","axum",
  "actix-web","warp","rocket","tide","salvo","poem","ntex","viz",
  "sqlx","diesel","sea-orm","rusqlite","mongodb","redis","deadpool",
  "serde_json","serde_yaml","toml","ron","bincode","rmp-serde","ciborium",
  "rayon","crossbeam","dashmap","parking_lot","arc-swap","flume","kanal",
  "image","rustls","native-tls","openssl","ring","sha2","md5","blake3",
  "base64","hex","percent-encoding","url","mime","http","hyper-util",
  "clap","structopt","indicatif","console","dialoguer","colored","owo-colors",
  "tempfile","walkdir","glob","ignore","notify","filetime","fs-err",
  "nom","pest","logos","chumsky","winnow","combine","pom",
  "criterion","proptest","quickcheck","arbitrary","cargo-fuzz",
  "serde_with","derive_more","strum","num","num-traits","num-derive",
  "itertools","either","maybe-owned","smallvec","tinyvec","arrayvec",
  "hashbrown","indexmap","linked-hash-map","multimap","bimap",
  "tokio-stream","tokio-util","tokio-tungstenite","tokio-rustls",
  "tonic","prost","tarpc","jsonrpsee","tower-http","axum-extra",
  "sqlx-postgres","sqlx-mysql","sqlx-sqlite","sea-query","quaint",
  "tracing-subscriber","tracing-opentelemetry","opentelemetry","jaeger",
  "config","dotenv","figment","envy","serde-env","dotenvy",
  "clap_derive","clap_complete","dialoguer","indicatif","console",
  "actix","actix-rt","actix-web-actors","actix-files","actix-multipart",
  "wasm-bindgen","js-sys","web-sys","gloo","yew","leptos","dioxus",
  "rusoto","aws-sdk-rust","azure_core","google-cloud-storage",
  "kafka","rdkafka","lapin","amqprs","async-nats",
  "prometheus","metrics","statsd","opentelemetry-prometheus",
  "zstd","lz4","snap","brotli","flate2","xz2","zip",
  "regex","fancy-regex","onig","pcre2","aho-corasick","memchr",
  "chrono-tz","time","hifitime","jiff","dateparser",
  "ed25519-dalek","x25519-dalek","curve25519-dalek","p256","k256",
  "argon2","bcrypt","pbkdf2","scrypt","balloon-hash","password-hash"
];

const NUGET_PACKAGES = [
  "Newtonsoft.Json","System.Text.Json","AutoMapper","Serilog","NLog",
  "Microsoft.EntityFrameworkCore","Dapper","FluentValidation","MediatR",
  "Polly","Refit","RestSharp","Flurl","HttpClientFactory",
  "xunit","NUnit","MSTest","Moq","NSubstitute","FluentAssertions",
  "Bogus","AutoFixture","Shouldly","SpecFlow","BDDfy",
  "Hangfire","Quartz.NET","MassTransit","RabbitMQ.Client","Confluent.Kafka",
  "StackExchange.Redis","MongoDB.Driver","Npgsql","MySqlConnector","SQLite",
  "BCrypt.Net-Next","System.IdentityModel.Tokens.Jwt","Microsoft.AspNetCore.Authentication.JwtBearer",
  "Swashbuckle.AspNetCore","NSwag","Mapster","TinyMapper","ExpressMapper",
  "Scrutor","Lamar","Autofac","SimpleInjector","Castle.Windsor","StructureMap",
  "CsvHelper","EPPlus","iTextSharp","PdfSharp","ClosedXML","NPOI","DocumentFormat.OpenXml",
  "ImageSharp","SkiaSharp","Magick.NET","QRCoder","ZXing.Net","BarcodeLib",
  "SignalR","Grpc.AspNetCore","protobuf-net","MessagePack","Orleans",
  "Serilog.AspNetCore","Serilog.Sinks.Console","Serilog.Sinks.File","Serilog.Sinks.Seq",
  "Microsoft.Extensions.Logging","Microsoft.Extensions.DependencyInjection",
  "Microsoft.Extensions.Configuration","Microsoft.Extensions.Caching.Memory",
  "Carter","FastEndpoints","Minimal.Apis","Ardalis.ApiEndpoints",
  "MediatR.Extensions.Microsoft.DependencyInjection","Ardalis.MediatR",
  "ErrorOr","FluentResults","CSharpFunctionalExtensions","LanguageExt",
  "BenchmarkDotNet","NBench","PerfView","dotMemory","dotTrace",
  "Testcontainers","DotNet.Testcontainers","WireMock.Net","HttpMock",
  "Polly.Contrib.WaitAndRetry","Polly.Extensions.Http","Microsoft.Extensions.Http.Polly",
  "Azure.Storage.Blobs","Azure.Identity","Azure.KeyVault","Azure.ServiceBus",
  "AWSSDK.S3","AWSSDK.DynamoDBv2","AWSSDK.SQS","AWSSDK.Lambda",
  "Google.Cloud.Storage.V1","Google.Cloud.PubSub.V1","Google.Cloud.BigQuery.V2",
  "Elasticsearch.Net","NEST","Meilisearch","Algolia.Search","Typesense",
  "Stripe.net","Braintree","PayPalCheckoutSdk","Square","Adyen",
  "Twilio","SendGrid","Mailchimp.NET","PostmarkDotNet","FluentEmail"
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
  "org.yaml:snakeyaml","com.fasterxml.jackson.dataformat:jackson-dataformat-yaml",
  "org.mapstruct:mapstruct","org.projectlombok:lombok",
  "com.google.inject:guice","org.springframework:spring-context",
  "io.micrometer:micrometer-core","io.opentelemetry:opentelemetry-api",
  "com.amazonaws:aws-java-sdk","software.amazon.awssdk:s3",
  "com.google.cloud:google-cloud-storage","com.azure:azure-storage-blob",
  "org.apache.commons:commons-collections4","org.apache.commons:commons-math3",
  "com.google.guava:guava","net.sf.ehcache:ehcache","org.ehcache:ehcache",
  "com.hazelcast:hazelcast","org.redisson:redisson","com.github.ben-manes.caffeine:caffeine",
  "org.apache.maven:maven-core","org.gradle:gradle-tooling-api",
  "io.grpc:grpc-netty","io.grpc:grpc-stub","io.grpc:grpc-protobuf",
  "com.stripe:stripe-java","com.braintreepayments.gateway:braintree-java",
  "com.twilio.sdk:twilio","com.sendgrid:sendgrid-java",
  "org.elasticsearch.client:elasticsearch-rest-high-level-client",
  "org.apache.solr:solr-core","org.apache.lucene:lucene-core",
  "com.mongodb:mongodb-driver-sync","org.springframework.data:spring-data-mongodb",
  "org.apache.cassandra:cassandra-all","com.datastax.oss:java-driver-core",
  "io.swagger.core.v3:swagger-core","org.springdoc:springdoc-openapi-ui",
  "com.github.spotbugs:spotbugs","org.sonarsource.java:java-checks",
  "org.jacoco:jacoco-maven-plugin","org.apache.maven.plugins:maven-surefire-plugin"
];

const GITHUB_REPOS = [
  "expressjs/express","lodash/lodash","axios/axios","facebook/react",
  "vuejs/vue","vercel/next.js","nuxt/nuxt","webpack/webpack",
  "babel/babel","microsoft/TypeScript","eslint/eslint",
  "prettier/prettier","jestjs/jest","mochajs/mocha",
  "chalk/chalk","tj/commander.js","motdotla/dotenv",
  "moment/moment","iamkun/dayjs","uuidjs/uuid",
  "remy/nodemon","expressjs/cors","helmetjs/helmet",
  "dcodeIO/bcrypt.js","auth0/node-jsonwebtoken",
  "Automattic/mongoose","sequelize/sequelize","prisma/prisma",
  "socketio/socket.io","websockets/ws","isaacs/node-tar",
  "npm/node-semver","isaacs/node-glob","isaacs/rimraf",
  "fastify/fastify","koajs/koa","hapijs/hapi",
  "ReactiveX/rxjs","ramda/ramda","immerjs/immer",
  "mobxjs/mobx","reduxjs/redux","pmndrs/zustand",
  "graphql/graphql-js","apollographql/apollo-server",
  "typeorm/typeorm","knex/knex","vitejs/vite",
  "rollup/rollup","evanw/esbuild","tailwindlabs/tailwindcss",
  "postcss/postcss","styled-components/styled-components",
  "mrdoob/three.js","d3/d3","chartjs/Chart.js",
  "date-fns/date-fns","winstonjs/winston","pinojs/pino",
  "redis/node-redis","luin/ioredis","OptimalBits/bull",
  "stripe/stripe-node","nodemailer/nodemailer",
  "ajv-validator/ajv","mqttjs/MQTT.js","tulios/kafkajs",
  "brianc/node-postgres","sidorares/node-mysql2",
  "WiseLibs/better-sqlite3","cheeriojs/cheerio","jsdom/jsdom",
  "Leonidas-from-XIV/node-xml2js","SheetJS/sheetjs",
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
  "webpack/webpack-dev-server","jestjs/jest",
  "vitest-dev/vitest","cypress-io/cypress",
  "microsoft/playwright","puppeteer/puppeteer",
  "pallets/flask","django/django","tiangolo/fastapi",
  "psf/requests","numpy/numpy","pandas-dev/pandas",
  "scikit-learn/scikit-learn","tensorflow/tensorflow",
  "pytorch/pytorch","keras-team/keras",
  "celery/celery","redis/redis-py","pymongo/mongo-python-driver",
  "python-pillow/Pillow","opencv/opencv","nltk/nltk",
  "explosion/spaCy","huggingface/transformers",
  "pytest-dev/pytest","psf/black","PyCQA/flake8",
  "python/mypy","PyCQA/pylint","PyCQA/bandit",
  "encode/httpx","aio-libs/aiohttp","Textualize/rich",
  "tiangolo/typer","Delgan/loguru","pydantic/pydantic",
  "marshmallow-code/marshmallow","arrow-py/arrow",
  "scrapy/scrapy","SeleniumHQ/selenium",
  "serde-rs/serde","tokio-rs/tokio","seanmonstar/reqwest",
  "clap-rs/clap","dtolnay/anyhow","dtolnay/thiserror",
  "tokio-rs/axum","actix/actix-web","nickel-org/nickel",
  "SergioBenitez/Rocket","diesel-rs/diesel","launchbadge/sqlx",
  "SeaQL/sea-orm","rusqlite/rusqlite","redis-rs/redis",
  "rayon-rs/rayon","crossbeam-rs/crossbeam",
  "image-rs/image","rustls/rustls","briansmith/ring",
  "RustCrypto/hashes","marshallpierce/rust-base64",
  "servo/url","hyperium/http","hyperium/hyper",
  "dotnet/runtime","dotnet/aspnetcore","dotnet/efcore",
  "AutoMapper/AutoMapper","serilog/serilog","NLog/NLog",
  "App-vNext/Polly","reactiveui/refit","restsharp/RestSharp",
  "xunit/xunit","nunit/nunit","moq/moq4","fluentassertions/fluentassertions",
  "HangfireIO/Hangfire","quartznet/quartznet","MassTransit/MassTransit",
  "StackExchange/StackExchange.Redis","mongodb/mongo-csharp-driver",
  "npgsql/npgsql","SixLabors/ImageSharp","dlemstra/Magick.NET",
  "JamesNK/Newtonsoft.Json","dotnet/System.Text.Json",
  "spring-projects/spring-framework","spring-projects/spring-boot",
  "apache/kafka","apache/commons-lang","apache/logging-log4j2",
  "junit-team/junit5","mockito/mockito","google/guava",
  "netty/netty","eclipse-vertx/vert.x","quarkusio/quarkus",
  "hibernate/hibernate-orm","mybatis/mybatis-3",
  "reactor/reactor-core","ReactiveX/RxJava",
  "nicolo-ribaudo/undici","nicolo-ribaudo/chalk",
  "nicolo-ribaudo/esbuild","nicolo-ribaudo/got",
  "oapi-codegen/oapi-codegen","gin-gonic/gin",
  "gorilla/mux","labstack/echo","gofiber/fiber",
  "sirupsen/logrus","uber-go/zap","stretchr/testify",
  "spf13/cobra","spf13/viper","joho/godotenv",
  "golang-jwt/jwt","google/uuid","pkg/errors",
  "go-redis/redis","olivere/elastic","go-gorm/gorm",
  "mongodb/mongo-go-driver","lib/pq","go-sql-driver/mysql",
  "mattn/go-sqlite3","gorilla/websocket","nats-io/nats.go",
  "segmentio/kafka-go","prometheus/client_golang",
  "open-telemetry/opentelemetry-go","hashicorp/vault",
  "nicolo-ribaudo/flatted","caolan/async",
  "hapijs/hapi","fastify/fastify","koajs/koa",
  "typicode/json-server","nicolo-ribaudo/p-limit",
  "sindresorhus/p-queue","nicolo-ribaudo/meow",
  "sindresorhus/execa","sindresorhus/tempy",
  "sindresorhus/open","sindresorhus/boxen",
  "sindresorhus/update-notifier","sindresorhus/latest-version",
  "vercel/turbo","nicolo-ribaudo/swc","swc-project/swc",
  "rome/tools","biomejs/biome","oxc-project/oxc",
  "nicolo-ribaudo/sucrase","nicolo-ribaudo/tsx",
  "esbuild-kit/tsx","privatenumber/tsx",
  "nicolo-ribaudo/vitest","nicolo-ribaudo/playwright",
  "microsoft/vscode","nicolo-ribaudo/storybook","storybookjs/storybook",
  "nicolo-ribaudo/lerna","lerna/lerna","nicolo-ribaudo/nx","nrwl/nx",
  "nicolo-ribaudo/turborepo","changesets/changesets",
  "nicolo-ribaudo/semantic-release","semantic-release/semantic-release",
  "nicolo-ribaudo/commitlint","conventional-changelog/commitlint",
  "nicolo-ribaudo/standard-version","nicolo-ribaudo/release-please",
  "google-github-actions/release-please-action",
  "actions/checkout","actions/setup-node","actions/setup-python",
  "actions/cache","actions/upload-artifact","actions/download-artifact",
  "docker/build-push-action","docker/login-action","docker/metadata-action",
  "nicolo-ribaudo/upload-to-release","softprops/action-gh-release",
  "nicolo-ribaudo/cosign","sigstore/cosign","sigstore/sigstore",
  "in-toto/in-toto","nicolo-ribaudo/slsa-verifier","slsa-framework/slsa-verifier",
  "anchore/syft","anchore/grype","anchore/sbom-action",
  "nicolo-ribaudo/trivy","aquasecurity/trivy","aquasecurity/tracee",
  "nicolo-ribaudo/snyk","snyk/snyk","nicolo-ribaudo/socket",
  "socketdev/socket-cli-js","nicolo-ribaudo/dependabot",
  "dependabot/dependabot-core","nicolo-ribaudo/renovate","renovatebot/renovate",
  "nicolo-ribaudo/semgrep","semgrep/semgrep","nicolo-ribaudo/codeql",
  "github/codeql","nicolo-ribaudo/osv-scanner","google/osv-scanner",
  "nicolo-ribaudo/osv.dev","google/osv.dev",
  "nicolo-ribaudo/scorecard","ossf/scorecard",
  "nicolo-ribaudo/allstar","ossf/allstar",
  "nicolo-ribaudo/package-analysis","ossf/package-analysis",
  "nicolo-ribaudo/malicious-packages","ossf/malicious-packages"
];

const RUBYGEMS_PACKAGES = [
  "rails","rake","bundler","rspec","minitest","sinatra","devise",
  "activesupport","activerecord","actionpack","actionview","actionmailer",
  "sidekiq","delayed_job","resque","que","good_job",
  "puma","unicorn","passenger","thin","webrick",
  "pg","mysql2","sqlite3","redis","mongo","mongoid",
  "carrierwave","shrine","active_storage","paperclip","dragonfly",
  "nokogiri","mechanize","httparty","faraday","rest-client","typhoeus",
  "capybara","selenium-webdriver","watir","site_prism","cucumber",
  "factory_bot","faker","ffaker","shoulda-matchers","vcr","webmock",
  "devise","warden","pundit","cancancan","rolify","jwt",
  "bcrypt","attr_encrypted","lockbox","blind_index",
  "rubocop","brakeman","bundler-audit","reek","flog","flay",
  "pry","byebug","awesome_print","hirb","table_print",
  "stripe","braintree","active_merchant","pay","koudoku",
  "aws-sdk","google-cloud-storage","azure","cloudinary","shrine-cloudinary",
  "elasticsearch","searchkick","chewy","ransack","pg_search",
  "kaminari","will_paginate","pagy","friendly_id","acts-as-taggable-on",
  "simple_form","formtastic","reform","dry-validation","dry-schema",
  "state_machines","aasm","workflow","statesman","transitions",
  "money","money-rails","carmen","countries","phony",
  "whenever","clockwork","rufus-scheduler","sidekiq-scheduler",
  "scenic","fx","paranoia","paper_trail","audited","logidze",
  "graphql","graphql-batch","graphql-guard","graphql-pro",
  "grape","rack","rack-cors","rack-attack","rack-timeout",
  "liquid","slim","haml","erb","jbuilder","rabl","blueprinter"
];

const PACKAGIST_PACKAGES = [
  "symfony/symfony","laravel/framework","guzzlehttp/guzzle",
  "monolog/monolog","phpunit/phpunit","doctrine/orm",
  "symfony/console","symfony/http-foundation","symfony/routing",
  "symfony/event-dispatcher","symfony/dependency-injection",
  "laravel/tinker","laravel/socialite","laravel/cashier",
  "illuminate/support","illuminate/database","illuminate/http",
  "carbon/carbon","nesbot/carbon","vlucas/phpdotenv",
  "phpspec/prophecy","mockery/mockery","fakerphp/faker",
  "ramsey/uuid","league/fractal","league/flysystem",
  "spatie/laravel-permission","spatie/laravel-medialibrary",
  "spatie/laravel-activitylog","spatie/laravel-query-builder",
  "barryvdh/laravel-debugbar","barryvdh/laravel-ide-helper",
  "predis/predis","phpredis/phpredis","aws/aws-sdk-php",
  "stripe/stripe-php","braintree/braintree_php","paypal/rest-api-sdk-php",
  "twilio/sdk","sendgrid/sendgrid","mailchimp/marketing",
  "elasticsearch/elasticsearch","algolia/algoliasearch-client-php",
  "tymon/jwt-auth","firebase/php-jwt","lcobucci/jwt",
  "league/oauth2-server","league/oauth2-client","socialiteproviders/manager",
  "pragmarx/google2fa","robthree/twofactorauth","sonata-project/admin-bundle",
  "friendsofsymfony/user-bundle","stof/doctrine-extensions-bundle",
  "gedmo/doctrine-extensions","knplabs/knp-paginator-bundle",
  "vich/uploader-bundle","liip/imagine-bundle","oneup/flysystem-bundle",
  "php-http/guzzle7-adapter","php-http/httplug","nyholm/psr7",
  "slim/slim","slim/psr7","slim/http","codeigniter4/framework",
  "cakephp/cakephp","zendframework/zendframework","laminas/laminas-mvc",
  "yiisoft/yii2","nette/nette","phalcon/cphalcon",
  "phpstan/phpstan","vimeo/psalm","squizlabs/php_codesniffer",
  "friendsofphp/php-cs-fixer","rector/rector","infection/infection",
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

  if (!error) console.log(`CAPTURED: ${ecosystem}/${pkg.name}@${version}`);
  return !error;
}

// ── NPM ────────────────────────────────────────────────────────
async function crawlNpm(startTime) {
  let captured = 0;
  const shuffled = [...NPM_PACKAGES].sort(() => Math.random() - 0.5);
  for (const name of shuffled) {
    if (Date.now() - startTime > 7500) break;
    try {
      const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`, { headers: { "Accept": "application/json" } });
      if (!res.ok) continue;
      const data = await res.json();
      const latest = data["dist-tags"]?.latest;
      if (!latest) continue;
      const allVersions = Object.keys(data.versions || {});
      const pkg = await upsertPackage(name, "npm", data.description, latest, allVersions.length);
      if (!pkg) continue;
      const { data: existing } = await supabase.from("snapshots").select("version").eq("package_id", pkg.id);
      const capturedSet = new Set((existing||[]).map(s => s.version));
      const uncaptured = allVersions.filter(v => !capturedSet.has(v)).slice(0, 15);
      for (const version of uncaptured) {
        if (Date.now() - startTime > 7500) break;
        const vd = data.versions[version];
        if (!vd) continue;
        if (await captureVersion(pkg, version, "npm", vd.dist?.integrity, vd.dist?.shasum, vd.license, Object.keys(vd.dependencies || {}))) captured++;
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
    if (Date.now() - startTime > 7500) break;
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
      const uncaptured = allVersions.filter(v => !capturedSet.has(v)).slice(0, 10);
      for (const version of uncaptured) {
        if (Date.now() - startTime > 7500) break;
        const files = data.releases[version] || [];
        const wheel = files.find(f => f.packagetype === "bdist_wheel") || files[0];
        if (await captureVersion(pkg, version, "pypi", wheel?.digests?.sha256 ? `sha256:${wheel.digests.sha256}` : "", wheel?.digests?.md5 || "", data.info?.license || "", [])) captured++;
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
    if (Date.now() - startTime > 7500) break;
    try {
      const res = await fetch(`https://crates.io/api/v1/crates/${name}`, { headers: { "User-Agent": "prechained.com/1.0" } });
      if (!res.ok) continue;
      const data = await res.json();
      const krate = data.crate;
      if (!krate) continue;
      const allVersions = (data.versions||[]).map(v => v.num);
      const pkg = await upsertPackage(name, "cargo", krate.description, krate.newest_version, allVersions.length);
      if (!pkg) continue;
      const { data: existing } = await supabase.from("snapshots").select("version").eq("package_id", pkg.id);
      const capturedSet = new Set((existing||[]).map(s => s.version));
      const uncaptured = allVersions.filter(v => !capturedSet.has(v)).slice(0, 10);
      for (const version of uncaptured) {
        if (Date.now() - startTime > 7500) break;
        const vData = (data.versions||[]).find(v => v.num === version);
        if (await captureVersion(pkg, version, "cargo", vData?.checksum ? `sha256:${vData.checksum}` : "", "", vData?.license || "", [])) captured++;
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
    if (Date.now() - startTime > 7500) break;
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
      const pkg = await upsertPackage(name, "nuget", firstEntry?.description, latest, allVersions.length);
      if (!pkg) continue;
      const { data: existing } = await supabase.from("snapshots").select("version").eq("package_id", pkg.id);
      const capturedSet = new Set((existing||[]).map(s => s.version));
      const uncaptured = allVersions.filter(v => !capturedSet.has(v)).slice(0, 10);
      for (const version of uncaptured) {
        if (Date.now() - startTime > 7500) break;
        const entry = items.flatMap(i => i.items||[]).find(p => p.catalogEntry?.version === version)?.catalogEntry;
        if (await captureVersion(pkg, version, "nuget", "", "", entry?.licenseExpression || "", [])) captured++;
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
    if (Date.now() - startTime > 7500) break;
    try {
      const [groupId, artifactId] = artifact.split(":");
      if (!groupId || !artifactId) continue;
      const res = await fetch(`https://search.maven.org/solrsearch/select?q=g:"${groupId}"+AND+a:"${artifactId}"&core=gav&rows=20&wt=json`);
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
        if (Date.now() - startTime > 7500) break;
        if (await captureVersion(pkg, version, "maven", "", "", "", [])) captured++;
      }
    } catch(e) {}
  }
  return captured;
}

// ── GITHUB ─────────────────────────────────────────────────────
async function crawlGithub(startTime) {
  let captured = 0;
  const shuffled = [...GITHUB_REPOS].sort(() => Math.random() - 0.5);
  const headers = { "Accept": "application/vnd.github.v3+json", "User-Agent": "prechained.com/1.0" };
  if (process.env.GITHUB_TOKEN) headers["Authorization"] = `token ${process.env.GITHUB_TOKEN}`;
  for (const repo of shuffled) {
    if (Date.now() - startTime > 7500) break;
    try {
      const repoRes = await fetch(`https://api.github.com/repos/${repo}`, { headers });
      if (!repoRes.ok) continue;
      const repoData = await repoRes.json();
      const defaultBranch = repoData.default_branch || "main";
      const commitRes = await fetch(`https://api.github.com/repos/${repo}/commits/${defaultBranch}`, { headers });
      if (!commitRes.ok) continue;
      const commitData = await commitRes.json();
      const latestSha = commitData.sha;
      const treeSha = commitData.commit?.tree?.sha || "";
      const version = latestSha.substring(0, 12);
      const pkg = await upsertPackage(repo, "github", repoData.description, version, repoData.size || 1);
      if (!pkg) continue;
      const { data: existing } = await supabase.from("snapshots").select("id").eq("package_id", pkg.id).eq("version", version).single();
      if (existing) continue;
      const payload = JSON.stringify({ repo, commit_sha: latestSha, tree_sha: treeSha, branch: defaultBranch, ecosystem: "github", timestamp: new Date().toISOString() });
      const fingerprint = sha384(payload);
      const { error } = await supabase.from("snapshots").insert({
        package_id: pkg.id, version, ecosystem: "github",
        sha384_fingerprint: fingerprint,
        receipt_id: generateReceiptId(),
        btc_anchored: false, ots_proof: null,
        raw_metadata: { commit_sha: latestSha, tree_sha: treeSha, branch: defaultBranch, license: repoData.license?.spdx_id || "" }
      });
      if (!error) { captured++; console.log(`GITHUB: ${repo}@${version}`); }
    } catch(e) {}
  }
  return captured;
}

// ── RUBYGEMS ───────────────────────────────────────────────────
async function crawlRubygems(startTime) {
  let captured = 0;
  const shuffled = [...RUBYGEMS_PACKAGES].sort(() => Math.random() - 0.5);
  for (const name of shuffled) {
    if (Date.now() - startTime > 7500) break;
    try {
      const res = await fetch(`https://rubygems.org/api/v1/gems/${name}.json`);
      if (!res.ok) continue;
      const data = await res.json();
      const latest = data.version;
      if (!latest) continue;
      const versionsRes = await fetch(`https://rubygems.org/api/v1/versions/${name}.json`);
      if (!versionsRes.ok) continue;
      const versions = await versionsRes.json();
      const allVersions = versions.map(v => v.number).filter(Boolean);
      const pkg = await upsertPackage(name, "rubygems", data.info, latest, allVersions.length);
      if (!pkg) continue;
      const { data: existing } = await supabase.from("snapshots").select("version").eq("package_id", pkg.id);
      const capturedSet = new Set((existing||[]).map(s => s.version));
      const uncaptured = allVersions.filter(v => !capturedSet.has(v)).slice(0, 10);
      for (const version of uncaptured) {
        if (Date.now() - startTime > 7500) break;
        const vData = versions.find(v => v.number === version);
        if (await captureVersion(pkg, version, "rubygems", vData?.sha ? `sha256:${vData.sha}` : "", "", vData?.licenses?.[0] || "", [])) captured++;
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
    if (Date.now() - startTime > 7500) break;
    try {
      const res = await fetch(`https://packagist.org/packages/${name}.json`);
      if (!res.ok) continue;
      const data = await res.json();
      const pkg_data = data.package;
      if (!pkg_data) continue;
      const allVersions = Object.keys(pkg_data.versions || {}).filter(v => !v.includes("dev") && !v.includes("alpha") && !v.includes("beta")).slice(0, 30);
      if (!allVersions.length) continue;
      const latest = allVersions[0].replace(/^v/, "");
      const firstVersion = pkg_data.versions[allVersions[0]];
      const pkg = await upsertPackage(name, "packagist", firstVersion?.description || "", latest, allVersions.length);
      if (!pkg) continue;
      const { data: existing } = await supabase.from("snapshots").select("version").eq("package_id", pkg.id);
      const capturedSet = new Set((existing||[]).map(s => s.version));
      const uncaptured = allVersions.filter(v => !capturedSet.has(v.replace(/^v/, ""))).slice(0, 10);
      for (const version of uncaptured) {
        if (Date.now() - startTime > 7500) break;
        const vData = pkg_data.versions[version];
        const cleanVersion = version.replace(/^v/, "");
        if (await captureVersion(pkg, cleanVersion, "packagist", vData?.dist?.shasum ? `sha1:${vData.dist.shasum}` : "", "", vData?.license?.[0] || "", Object.keys(vData?.require || {}))) captured++;
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
  console.log(`Done: ${total} total | npm:${npm} pypi:${pypi} cargo:${cargo} nuget:${nuget} maven:${maven} github:${github} rubygems:${rubygems} packagist:${packagist}`);

  return new Response(JSON.stringify({
    ok: true,
    captured: { total, npm, pypi, cargo, nuget, maven, github, rubygems, packagist },
    timestamp: new Date().toISOString()
  }), {
    headers: { "Content-Type": "application/json" }
  });
}
