# External Integrations

**Analysis Date:** 2026-06-01
**Last Mapped Commit:** `df5f989b593d494ac44ce3b004307c1c6ada7bec`
**Scope:** `.dockerignore`, `.gitignore`, `CHANGELOG.md`, `Dockerfile`, `README-en.md`, `README.md`, `drizzle/`, `yarn.lock`

## APIs & External Services

**LLM Provider:**
- OpenAI Chat Completions - Meal analysis and coaching are OpenAI-backed per `README.md` and `README-en.md`.
  - SDK/Client: `openai` package; `yarn.lock` resolves `openai@^4.82.0` to `4.104.0`.
  - Auth: `OPENAI_API_KEY`, documented as required in `README.md` and `README-en.md`.
  - Model: `OPENAI_ORCHESTRATOR_MODEL`, documented in `README.md` and `README-en.md` with default `gpt-5.4-mini`.
  - Behavior evidence: `CHANGELOG.md` records metadata-only provider failure localization, redacted LLM traces, and no raw prompt/provider payload persistence for release evidence.

**Same-Origin Product API:**
- Fastify REST/SSE API - Browser-facing API and SSE surfaces are documented in `README.md` and `README-en.md`.
  - SDK/Client: native browser HTTP/SSE clients are implied by `client/src/api.ts` and `client/src/sse.ts` references in `README.md` / `README-en.md`.
  - Auth: cookie-backed guest sessions; `README.md` and `README-en.md` state `GET /api/sse` uses cookies because browser `EventSource` cannot set custom headers.
  - Streaming: Server-Sent Events stream chat status, partial replies, final receipts, and summary freshness signals per `README.md`, `README-en.md`, and `CHANGELOG.md`.

**Deployment Platform:**
- Railway - Deployment example is referenced by `README.md` and `README-en.md`; `CHANGELOG.md` records prior Railway staging and production smoke checks.
  - SDK/Client: Not applicable in scoped files; deployment is command/env based through `Dockerfile` and documented setup.
  - Auth: Railway platform credentials are not represented in scoped repo files.
  - Runtime contract: one Fastify process serves API plus `dist/client`; use persistent volume storage for SQLite and durable assets per `README.md` and `README-en.md`.

**Package Registry:**
- npm registry via Yarn - Dependencies resolve from `registry.yarnpkg.com` entries in `yarn.lock`.
  - SDK/Client: Yarn using `yarn.lock`; `Dockerfile` runs `corepack enable && yarn install --frozen-lockfile`.
  - Auth: Not detected in scoped files; `.npmrc` is not part of this scoped pass and must not be read if present.

## Data Storage

**Databases:**
- SQLite file database
  - Connection: `DB_PATH`, documented in `README.md` and `README-en.md` with default `./data/nutrition.db`.
  - Client: `better-sqlite3` plus Drizzle; `yarn.lock` resolves `better-sqlite3@^11.8.0` to `11.10.0` and `drizzle-orm@^0.39.0` to `0.39.3`.
  - Migrations: `drizzle/0000_brainy_rocket_racer.sql` through `drizzle/0008_shiny_stellaris.sql`; migration journal is `drizzle/meta/_journal.json`.
  - Schema surfaces in scoped migrations include `devices`, `meals`, `chat_messages`, `assets`, `meal_transactions`, `meal_revisions`, `meal_revision_items`, `asset_references`, `turn_states`, `chat_meal_receipts`, and `chat_mutation_outcomes`.
  - Recent persistence additions: `drizzle/0007_violet_living_lightning.sql` adds structured `meal_period`; `drizzle/0008_shiny_stellaris.sql` adds `chat_mutation_outcomes` for committed mutation receipts.
  - Test storage: `README.md` and `README-en.md` describe tests under `tests/integration/` and deterministic harness flows under `tests/harness/`; generated harness artifacts are ignored by `.gitignore`.

**File Storage:**
- Local filesystem durable assets
  - Root: `ASSETS_DIR`, documented in `README.md` and `README-en.md` with default `./data/assets`.
  - Purpose: durable image assets for meal photos; `README.md` and `README-en.md` require persistent volume storage in deployment.
  - Git/Docker handling: `.gitignore` ignores `data/*` except `data/.gitkeep`; `.dockerignore` excludes `data/*` except `data/.gitkeep`.
- Local filesystem staged uploads
  - Root: `UPLOADS_STAGING_DIR`, documented in `README.md` and `README-en.md` with default `./data/uploads-staging`.
  - Legacy/local upload path: `.gitignore` and `.dockerignore` exclude `server/uploads/`.

**Caching:**
- No external cache service detected in scoped files.
- Realtime state is process-local SSE fan-out per `README.md` and `README-en.md` references to `server/realtime/`.
- Client-side state boundary is `client/src/store.ts` per `README.md` and `README-en.md`; durable state is SQLite-backed.

## Authentication & Identity

**Auth Provider:**
- Custom signed guest-session cookies
  - Implementation surface: documented in `README.md` and `README-en.md` as cookie-backed guest sessions without account signup, with key code paths `server/routes/device.ts` and `server/lib/guest-session-resolver.ts`.
  - Secret: `GUEST_SESSION_SECRET`, documented in `README.md` and `README-en.md` as an app-owned random secret with default `dev-guest-session-secret-change-me`.
  - Secure cookie mode: `NODE_ENV=production` enables secure guest-session cookies per `README.md` and `README-en.md`; `Dockerfile` sets `NODE_ENV=production`.
  - SSE constraint: `GET /api/sse` uses cookie-backed guest sessions because browser `EventSource` cannot set custom headers, documented in `README.md` and `README-en.md`.

## Monitoring & Observability

**Error Tracking:**
- No external error tracking service detected in scoped files.
- Metadata-only LLM/chat failure localization is documented in `README.md`, `README-en.md`, and `CHANGELOG.md`.
- Provider failures are represented with allowlisted metadata such as status, provider request id, error class/type/code, operation, model, and abort flag per `CHANGELOG.md`.

**Logs:**
- Runtime log framework is not directly inspectable from the scoped files, but `README.md` and `README-en.md` identify server route/orchestrator boundaries and `CHANGELOG.md` records route logs, orchestrator child logs, trace facts, and fallback reference codes.
- Release/harness evidence must remain metadata-only; `CHANGELOG.md` repeatedly states raw prompts, user text, assistant final text, tool payloads, provider bodies, image data, session material, and database snapshots are not stored in evidence.

## CI/CD & Deployment

**Hosting:**
- Railway is the documented deployment example from `README.md` and `README-en.md`.
- Containerized runtime uses `Dockerfile`: Node 22 base image, frozen Yarn install, `yarn build`, `NODE_ENV=production`, `EXPOSE 3000`, and migration-before-start command.
- Same-origin production serving uses one Fastify process for API and `dist/client`, documented in `README.md` and `README-en.md`.

**CI Pipeline:**
- No GitHub Actions or hosted CI config detected in the scoped paths.
- Local release gate is `yarn release:check`, documented in `README.md`, `README-en.md`, and `CHANGELOG.md`.
- Recent v2.4 release proof in `CHANGELOG.md` records `yarn tsc --noEmit` and `yarn release:check` passing, with `yarn release:check` reporting 1,245 tests passed and frontend build complete.
- Promotion workflow remains manual in scoped release notes: `CHANGELOG.md` states v2.4 had no push, merge, deploy, Railway smoke, staging promotion, or main promotion.

## Environment Configuration

**Required env vars:**
- `OPENAI_API_KEY` - Required OpenAI API key, documented in `README.md` and `README-en.md`.
- `OPENAI_ORCHESTRATOR_MODEL` - Chat orchestrator model, default `gpt-5.4-mini`, documented in `README.md` and `README-en.md`.
- `PORT` - Fastify port, default `3000`, documented in `README.md` and `README-en.md`; `Dockerfile` exposes `3000`.
- `DB_PATH` - SQLite database path, default `./data/nutrition.db`, documented in `README.md` and `README-en.md`.
- `TZ` - Required timezone for daily nutrition boundaries, default/required value `Asia/Taipei`, documented in `README.md` and `README-en.md`.
- `NODE_ENV` - Production mode toggle for secure cookies; `Dockerfile` sets `NODE_ENV=production`.
- `GUEST_SESSION_SECRET` - App-owned random secret for signed guest sessions, documented in `README.md` and `README-en.md`.
- `ASSETS_DIR` - Durable image asset directory, default `./data/assets`, documented in `README.md` and `README-en.md`.
- `UPLOADS_STAGING_DIR` - Request-local upload staging directory, default `./data/uploads-staging`, documented in `README.md` and `README-en.md`.
- `CLIENT_DIST_DIR` - Frontend build directory served by Fastify, default `./dist/client`, documented in `README.md` and `README-en.md`.

**Secrets location:**
- `.env` and `.env.*` are local secret/config files excluded by `.gitignore` and `.dockerignore`; their contents must not be read or quoted.
- `.env.example` is intentionally unignored in `.gitignore` and `.dockerignore` so it can act as the local environment template.
- Deployment secrets are configured outside the repo; scoped docs point to Railway setup through `README.md` and `README-en.md`.

## Webhooks & Callbacks

**Incoming:**
- No external webhook endpoints detected in scoped files.
- Public product traffic enters same-origin Fastify routes documented in `README.md` and `README-en.md`.
- Realtime browser callback surface is `GET /api/sse`, documented in `README.md` and `README-en.md`.

**Outgoing:**
- OpenAI API calls for real meal analysis during local development and production, documented in `README.md` and `README-en.md`.
- No outgoing webhook, payment, email, object storage SaaS, queue, or external cache integration detected in scoped files.
- SSE fan-out sends chat status, partial replies, final receipts, `daily_summary`, and freshness signals to connected browser clients per `README.md`, `README-en.md`, and `CHANGELOG.md`.

---

*Integration audit: 2026-06-01*
