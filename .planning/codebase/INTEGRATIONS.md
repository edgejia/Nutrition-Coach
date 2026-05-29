# External Integrations

**Analysis Date:** 2026-05-30

## APIs & External Services

**LLM / AI:**
- OpenAI - Used for nutrition analysis, coaching replies, target generation, streaming chat completions, and tool-calling orchestration.
  - SDK/Client: `openai` 4.104.0 in `server/llm/openai.ts`.
  - Auth: `OPENAI_API_KEY` read implicitly by `new OpenAI()` in `server/llm/openai.ts`.
  - Model config: `OPENAI_ORCHESTRATOR_MODEL` in `server/config.ts`, defaulting to `gpt-5.4-mini`.
  - Runtime wiring: `server/index.ts` injects `new OpenAIProvider()` into `buildApp()`.
  - Test isolation: `server/llm/mock.ts`, `tests/harness/streaming-llm.ts`, and `tests/harness/app-fixture.ts` provide deterministic providers so tests and harnesses do not require live OpenAI.

**Browser APIs:**
- Server-Sent Events - Browser `EventSource` connects to `/api/sse` from `client/src/sse.ts`; Fastify streams `daily_summary` and `goals_update` events from `server/routes/sse.ts` and `server/realtime/publisher.ts`.
- Fetch / FormData - Client transport helpers in `client/src/api.ts` call same-origin `/api/*` endpoints with `credentials: "same-origin"` for cookie-backed session flows.
- File upload - `client/src/api.ts` enforces client-side image constraints and sends multipart chat requests; `server/routes/chat.ts` handles multipart parsing and upload cleanup.

**Package Registry:**
- npm registry - `yarn.lock` resolves dependencies from `https://registry.yarnpkg.com/`; install path is `yarn install --frozen-lockfile` in `Dockerfile`.

## Data Storage

**Databases:**
- SQLite file database.
  - Connection: `DB_PATH` in `server/config.ts`, `drizzle.config.ts`, and `server/db/migrate.ts`; default path is `./data/nutrition.db`.
  - Client: `better-sqlite3` plus `drizzle-orm/better-sqlite3` in `server/db/client.ts`.
  - Schema: `server/db/schema.ts` defines `devices`, `meals`, `chat_messages`, `assets`, `meal_transactions`, `meal_revisions`, `meal_revision_items`, `asset_references`, and `turn_states`.
  - Migrations: SQL migrations live in `drizzle/*.sql`; `server/db/migrate.ts` applies them and reconciles a known partial `chat_messages.status` migration.
  - Runtime safety: `server/db/client.ts` enables WAL and foreign keys, applies migrations for `:memory:` test databases, and requires migrations before file-backed boot.
  - Production placement: `docs/deploy/railway-beta.md` sets `DB_PATH=/app/data/nutrition.db` on a Railway mounted volume.

**File Storage:**
- Local filesystem only.
  - Durable assets: `ASSETS_DIR` in `server/config.ts`, managed by `server/services/assets.ts`, exposed through `GET /api/assets/:id` in `server/routes/assets.ts`.
  - Upload staging: `UPLOADS_STAGING_DIR` in `server/config.ts`, consumed by `server/routes/chat.ts` before assets are persisted.
  - Built client shell: `CLIENT_DIST_DIR` in `server/config.ts`, served by `@fastify/static` from `server/app.ts`.
  - Railway baseline: `docs/deploy/railway-beta.md` places durable data under `/app/data` and staging uploads under `/tmp/nutrition-uploads`.

**Caching:**
- None detected as an external cache.
- In-process realtime subscriber state lives in `server/realtime/publisher.ts` as a `Map<string, FastifyReply[]>`; it is process-local and not durable.
- Client state is local in `client/src/store.ts` through Zustand; durable state is recovered through same-origin API calls and guest-session cookies.

## Authentication & Identity

**Auth Provider:**
- Custom guest-session cookies; no third-party identity provider detected.
  - Implementation: `server/services/guest-session.ts` issues HMAC-SHA256 signed active and resume tokens.
  - Session resolution: `server/lib/guest-session-resolver.ts` validates cookies, resumes sessions, loads the device record through `server/services/device.ts`, and clears invalid cookies.
  - Cookie names and TTLs: configured by `GUEST_SESSION_COOKIE_NAME`, `GUEST_SESSION_RESUME_COOKIE_NAME`, `GUEST_SESSION_TTL_SECONDS`, and `GUEST_SESSION_RESUME_TTL_SECONDS` in `server/config.ts`.
  - Signing secret: `GUEST_SESSION_SECRET` in `server/config.ts`; `README.md` documents it as an app-owned deployment secret, not an external provider credential.
  - Secure-cookie mode: `server/config.ts` enables secure cookies when `NODE_ENV=production` or `GUEST_SESSION_COOKIE_SECURE=true`.
  - Bootstrap and recovery: `POST /api/device`, `POST /api/device/session`, and `DELETE /api/device/session` live in `server/routes/device.ts`.
  - Protected browser routes: routes under `server/routes/chat.ts`, `server/routes/meals.ts`, `server/routes/history.ts`, `server/routes/day-snapshot.ts`, `server/routes/assets.ts`, `server/routes/observability.ts`, and `server/routes/sse.ts` use `resolveGuestSession()`.

## Monitoring & Observability

**Error Tracking:**
- None detected as an external error tracking service.
- Provider errors are normalized into metadata-only `LLMProviderError` instances by `server/llm/openai.ts` and `server/llm/errors.ts`.
- Redacted deterministic traces are captured by `server/orchestrator/llm-trace.ts`, `tests/harness/llm-trace.ts`, and artifact writers in `tests/harness/artifacts.ts`.

**Logs:**
- Fastify logger configured in `server/index.ts`, with default `LOG_LEVEL` fallback to `info`.
- Production logger redacts `req.headers.authorization` in `server/index.ts`.
- Structured log event helpers live in `server/observability/events.ts`; route code such as `server/routes/chat.ts`, `server/routes/device.ts`, `server/routes/sse.ts`, and `server/routes/observability.ts` calls those helpers.
- Client observability endpoint is `POST /api/observability/client-event` in `server/routes/observability.ts`; client transport lives in `client/src/api.ts`.
- Debug flag `DEBUG` is centralized in `server/config.ts`.

## CI/CD & Deployment

**Hosting:**
- Railway is the documented deployment platform in `docs/deploy/railway-beta.md`.
- Deployment shape is one persistent web service with one public domain and one mounted volume at `/app/data`, documented in `docs/deploy/railway-beta.md`.
- Docker deployment is supported by `Dockerfile`, which builds the client and starts the server through migrations.
- Same-origin beta serving is implemented in `server/app.ts`, where Fastify serves `dist/client` and falls back to `index.html` for non-API `GET` routes.

**CI Pipeline:**
- No `.github/workflows/**` files detected.
- No dedicated CI config detected.
- Local merge/release gate is `yarn release:check` in `package.json`, implemented by `scripts/release-check.mjs`.
- Matrix document checks are local scripts in `package.json`: `matrix:check`, `matrix:gen:check`, and `behavior-matrix:gen:check`.

## Environment Configuration

**Required env vars:**
- `OPENAI_API_KEY` - Required for live OpenAI calls through `server/llm/openai.ts`.
- `OPENAI_ORCHESTRATOR_MODEL` - Model selection in `server/config.ts`.
- `PORT` - Fastify listen port in `server/config.ts` and `server/index.ts`.
- `DB_PATH` - SQLite file path in `server/config.ts`, `drizzle.config.ts`, and `server/db/migrate.ts`.
- `TZ` - Required timezone contract in `server/config.ts` and `server/lib/time.ts`.
- `GUEST_SESSION_SECRET` - Required for safe shared/deployed guest-session cookies in `server/config.ts`.

**Deployment env vars and overrides:**
- `NODE_ENV` - Enables production secure-cookie behavior in `server/config.ts`.
- `GUEST_SESSION_COOKIE_NAME` - Active cookie name in `server/config.ts`.
- `GUEST_SESSION_RESUME_COOKIE_NAME` - Resume cookie name in `server/config.ts`.
- `GUEST_SESSION_TTL_SECONDS` - Active cookie TTL in `server/config.ts`.
- `GUEST_SESSION_RESUME_TTL_SECONDS` - Resume cookie TTL in `server/config.ts`.
- `GUEST_SESSION_COOKIE_SECURE` - Explicit secure-cookie override in `server/config.ts`.
- `ASSETS_DIR` - Durable asset root in `server/config.ts` and `server/services/assets.ts`.
- `UPLOADS_STAGING_DIR` - Multipart staging root in `server/config.ts` and `server/routes/chat.ts`.
- `CLIENT_DIST_DIR` - Built client directory in `server/config.ts` and `server/app.ts`.
- `LOG_LEVEL` - Fastify logger level in `server/index.ts`.
- `DEBUG` - Debug toggle in `server/config.ts`.
- `HARNESS_ARTIFACTS_DIR` - Optional deterministic harness artifact root in `tests/harness/artifacts.ts`.

**Secrets location:**
- Local development uses `.env` at repo root, loaded by `yarn dev:server` and `server/db/migrate.ts`; the file exists and must not be quoted.
- `.env.example` exists at repo root as a template; do not treat it as a secrets source.
- Railway secrets and variables are configured in the Railway service variable UI as described by `docs/deploy/railway-beta.md`.
- No committed cloud credential files, SSH keys, package auth files, or secret directories were read.

## Webhooks & Callbacks

**Incoming:**
- No third-party webhook receiver endpoints detected.
- Public app API endpoints are same-origin Fastify routes:
  - `POST /api/device`, `POST /api/device/session`, `DELETE /api/device/session`, `PATCH /api/device/goals`, and `PUT /api/device/goals` in `server/routes/device.ts`.
  - `POST /api/chat`, `POST /api/chat/stop`, and `GET /api/chat/history` in `server/routes/chat.ts`.
  - `GET /api/sse` in `server/routes/sse.ts`.
  - `GET /api/assets/:id` in `server/routes/assets.ts`.
  - `GET /api/meals`, `PATCH /api/meals/:id`, and `DELETE /api/meals/:id` in `server/routes/meals.ts`.
  - `GET /api/day-snapshot` in `server/routes/day-snapshot.ts`.
  - `GET /api/history/meals`, `GET /api/history/search`, `GET /api/history/trends`, and `GET /api/history/days/:date` in `server/routes/history.ts`.
  - `POST /api/observability/client-event` in `server/routes/observability.ts`.

**Outgoing:**
- OpenAI Chat Completions API calls from `server/llm/openai.ts`.
- No outgoing webhook delivery clients detected.
- No external database, object storage, cache, analytics, email, payment, or identity provider clients detected.

---

*Integration audit: 2026-05-26*
