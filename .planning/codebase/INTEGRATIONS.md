# External Integrations

**Analysis Date:** 2026-05-29

## APIs & External Services

**LLM Provider:**
- OpenAI Chat Completions - Meal analysis, coaching replies, tool calling, and streaming responses for chat/orchestrator flows.
  - SDK/Client: `openai` package in `server/llm/openai.ts`; runtime client is `OpenAIProvider`, injected from `server/index.ts` into `buildApp()` in `server/app.ts`.
  - Auth: `OPENAI_API_KEY` consumed by the OpenAI SDK environment lookup; never expose this to `client/src/**`.
  - Model: `OPENAI_ORCHESTRATOR_MODEL` read in `server/config.ts`, defaulting to `gpt-5.4-mini`.
  - Operations: non-streaming tool calls through `OpenAIProvider.chat()`, streamed rounds through `OpenAIProvider.chatRound()`, and token streams through `OpenAIProvider.chatStream()` in `server/llm/openai.ts`.
  - Error metadata: normalized by `server/llm/openai.ts` and redacted before logging by `server/observability/events.ts`.

**Same-Origin Product API:**
- Fastify REST/SSE API - Browser client calls same-origin `/api/*` endpoints through `client/src/api.ts` and `client/src/sse.ts`.
  - SDK/Client: native `fetch`, `FormData`, and `EventSource` in `client/src/api.ts` and `client/src/sse.ts`.
  - Auth: HttpOnly guest-session cookies from `server/services/guest-session.ts`.
  - Endpoints: `/api/device`, `/api/device/session`, `/api/device/goals`, `/api/chat`, `/api/chat/stop`, `/api/chat/history`, `/api/meals`, `/api/day-snapshot`, `/api/history/*`, `/api/assets/:id`, `/api/sse`, and `/api/observability/client-event`.

**Deployment Platform:**
- Railway - Persistent web service with one public domain and one mounted volume, documented in `docs/deploy/railway-beta.md`.
  - SDK/Client: Not applicable; deployment is command/env based through `Dockerfile` and Railway service variables.
  - Auth: Railway platform credentials are not represented in repo code.
  - Runtime contract: `DB_PATH=/app/data/nutrition.db`, `ASSETS_DIR=/app/data/assets`, `UPLOADS_STAGING_DIR=/tmp/nutrition-uploads`, `CLIENT_DIST_DIR=/app/dist/client`, and `TZ=Asia/Taipei` in `docs/deploy/railway-beta.md`.

**Package Registry:**
- npm registry via Yarn - Dependencies resolve from `registry.yarnpkg.com` entries in `yarn.lock`.
  - SDK/Client: Yarn 1 through `yarn.lock` and `Dockerfile`.
  - Auth: Not detected; do not read `.npmrc` if one appears because package auth tokens are forbidden files.

## Data Storage

**Databases:**
- SQLite file database
  - Connection: `DB_PATH` in `server/config.ts`, `drizzle.config.ts`, and `server/db/migrate.ts`; default path is `./data/nutrition.db`.
  - Client: `better-sqlite3` plus `drizzle-orm/better-sqlite3` in `server/db/client.ts`.
  - Schema: `server/db/schema.ts` defines `devices`, `meals`, `chat_messages`, `assets`, `meal_transactions`, `meal_revisions`, `chat_meal_receipts`, `meal_revision_items`, `asset_references`, and `turn_states`.
  - Migrations: `drizzle/*.sql` and `drizzle/meta/*.json`; runtime migration entry is `server/db/migrate.ts`.
  - Runtime settings: `server/db/client.ts` enables `journal_mode = WAL` and `foreign_keys = ON`, and validates required tables for file-backed databases.
  - Test storage: `:memory:` SQLite is supported by `server/db/client.ts`; `tests/harness/app-fixture.ts` and integration tests use real SQLite, not DB mocks.

**File Storage:**
- Local filesystem durable assets
  - Root: `ASSETS_DIR` in `server/config.ts`, defaulting to `./data/assets`; Railway target is `/app/data/assets` in `docs/deploy/railway-beta.md`.
  - Client access: protected `GET /api/assets/:id` in `server/routes/assets.ts`, returning bytes through `assetService.readOwnedAsset()`.
  - Storage service: `server/services/assets.ts` copies staged uploads into `meal-images/<assetId>.<ext>`, records metadata in the `assets` table, and links usage through `asset_references`.
- Local filesystem staged uploads
  - Root: `UPLOADS_STAGING_DIR` in `server/config.ts`, defaulting to `./data/uploads-staging`; Railway target is `/tmp/nutrition-uploads`.
  - Upload route: `server/routes/chat.ts` accepts one image per chat request, allows JPEG/PNG/WebP, enforces a 5 MB product limit, and cleans staged files on rejection or downstream failure.

**Caching:**
- No external cache service detected.
- In-process realtime subscriptions live in `RealtimePublisher.connections` in `server/realtime/publisher.ts`; this is process-local state, not durable cache.
- Client state lives in Zustand in `client/src/store.ts`; persistence is through backend SQLite and same-origin session cookies.

## Authentication & Identity

**Auth Provider:**
- Custom guest-session cookies
  - Implementation: `server/services/guest-session.ts` signs base64url JSON claims with HMAC-SHA256, verifies with `timingSafeEqual`, and serializes `HttpOnly; SameSite=Lax` cookies.
  - Active cookie: `GUEST_SESSION_COOKIE_NAME` in `server/config.ts`, default `guest_session`.
  - Resume cookie: `GUEST_SESSION_RESUME_COOKIE_NAME` in `server/config.ts`, default `guest_session_resume`.
  - Secret: `GUEST_SESSION_SECRET` in `server/config.ts`; deployment guidance in `README.md` treats this as app-owned random secret, not external provider credential.
  - Secure cookies: `GUEST_SESSION_COOKIE_SECURE=true` or `NODE_ENV=production` enables `Secure` in `server/config.ts` and `server/services/guest-session.ts`.
  - Session resolution: protected browser routes call `resolveGuestSession()` in `server/lib/guest-session-resolver.ts`; route code should derive ownership from cookies, not raw `deviceId` query params or `x-device-id` headers.
  - Bootstrap/resume/logout routes: `server/routes/device.ts` implements `POST /api/device/session` and `DELETE /api/device/session`.

## Monitoring & Observability

**Error Tracking:**
- None external detected.
- LLM/provider failures are wrapped in `LLMProviderError` in `server/llm/errors.ts` and normalized in `server/llm/openai.ts`.
- Route fallback and provider metadata are sanitized in `server/observability/events.ts` before logging.

**Logs:**
- Fastify/Pino-compatible logger
  - Runtime setup: `server/index.ts` passes logger config with `LOG_LEVEL` defaulting to `info`.
  - Redaction: `server/index.ts` removes `req.headers.authorization` from logs.
  - Event helpers: `server/observability/events.ts` defines redacted event schemas for onboarding, CTA, chat fallback, goal updates, and SSE connection state.
- Client observability endpoint
  - Endpoint: `POST /api/observability/client-event` in `server/routes/observability.ts`.
  - Caller: `recordClientEvent()` in `client/src/api.ts` uses best-effort same-origin `fetch`.
  - Events: `home_cta_intent_selected` and `home_cta_option_sent` in `server/observability/events.ts`.

## CI/CD & Deployment

**Hosting:**
- Railway persistent web service per `docs/deploy/railway-beta.md`.
- Containerized runtime through `Dockerfile`: install with Yarn, run `yarn build`, expose `3000`, and start with `yarn db:migrate && yarn start`.
- Same-origin frontend serving through `@fastify/static` in `server/app.ts` when `CLIENT_DIST_DIR/index.html` exists.

**CI Pipeline:**
- GitHub Actions or other CI config not detected under `.github/**`.
- Local merge gate is `yarn release:check` in `package.json`, implemented by `scripts/release-check.mjs`.
- Release gate runs TypeScript/tests/matrix checks and enforces timezone through `scripts/run-node-with-tz.mjs` and `scripts/release-check.mjs`.
- Promotion workflow is manual: `feature/* -> staging -> main` in `AGENTS.md`; touching `main` requires explicit production approval in the current thread.

## Environment Configuration

**Required env vars:**
- `OPENAI_API_KEY` - OpenAI SDK credential used by `server/llm/openai.ts`.
- `OPENAI_ORCHESTRATOR_MODEL` - Model name read by `server/config.ts`; default is `gpt-5.4-mini`.
- `PORT` - Fastify listen port read by `server/config.ts`; default is `3000`.
- `DB_PATH` - SQLite database path read by `server/config.ts`, `drizzle.config.ts`, and `server/db/migrate.ts`.
- `TZ` - Required process timezone; `server/lib/time.ts` requires `Asia/Taipei`, and `scripts/run-node-with-tz.mjs` forces it for tests.
- `GUEST_SESSION_SECRET` - HMAC signing secret read by `server/config.ts`; set a stable random value for shared/deployed environments.
- `NODE_ENV` - Enables secure guest-session cookies when set to `production` through `server/config.ts`.
- `ASSETS_DIR` - Durable asset root read by `server/config.ts`.
- `UPLOADS_STAGING_DIR` - Request-local upload staging root read by `server/config.ts`.
- `CLIENT_DIST_DIR` - Built frontend directory read by `server/config.ts` and served by `server/app.ts`.
- `LOG_LEVEL` - Runtime log level read in `server/index.ts`.
- Optional guest-session overrides: `GUEST_SESSION_COOKIE_NAME`, `GUEST_SESSION_RESUME_COOKIE_NAME`, `GUEST_SESSION_TTL_SECONDS`, `GUEST_SESSION_RESUME_TTL_SECONDS`, and `GUEST_SESSION_COOKIE_SECURE` in `server/config.ts`.
- Optional harness output override: `HARNESS_ARTIFACTS_DIR` in `tests/harness/artifacts.ts`.

**Secrets location:**
- `.env` file present - contains local environment configuration and must not be read or quoted.
- `.env.example` file present - template exists but `.env*` contents are treated as forbidden by mapper policy.
- Runtime deployment secrets are configured outside the repo in Railway service variables per `docs/deploy/railway-beta.md`.
- `.gitignore` excludes `.env`, `.env.*`, local databases, `data/*`, `dist/`, and generated harness artifacts.

## Webhooks & Callbacks

**Incoming:**
- No external webhook endpoints detected.
- Public HTTP API endpoints are same-origin product endpoints in `server/routes/*.ts`.
- Realtime browser callback surface is `GET /api/sse` in `server/routes/sse.ts`; it uses EventSource-compatible cookies because browsers cannot attach custom headers to `EventSource`.
- Client event ingestion is internal/product observability only: `POST /api/observability/client-event` in `server/routes/observability.ts`.

**Outgoing:**
- OpenAI Chat Completions requests from `server/llm/openai.ts`.
- No outgoing webhooks, email, payment, analytics SaaS, object storage SaaS, queue, or external cache integrations detected.
- SSE fan-out from `server/realtime/publisher.ts` emits `daily_summary` and `goals_update` to connected browser clients over same-origin HTTP responses.

---

*Integration audit: 2026-05-29*
