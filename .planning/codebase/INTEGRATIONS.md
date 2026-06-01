---
last_mapped_commit: 782a04005f8f328f7f86ac589eb1253060471b5f
---

# External Integrations

**Analysis Date:** 2026-06-01
**Scope:** `.env.example`, `CHANGELOG.md`, `drizzle/`, `drizzle.config.ts`, `package.json`, `scripts/`, `tsconfig.json`

## APIs & External Services

**LLM Provider:**
- OpenAI - Real analysis/coaching provider indicated by `openai` `^4.82.0` in `package.json` and OpenAI env vars in `.env.example`.
  - SDK/Client: `openai` package from `package.json`.
  - Auth: `OPENAI_API_KEY` from `.env.example`.
  - Model config: `OPENAI_ORCHESTRATOR_MODEL` from `.env.example`, defaulting in the template to `gpt-5.4-mini`.
  - Privacy/observability constraint: `CHANGELOG.md` records metadata-only release evidence and no raw prompt, user text, assistant final text, tool payload, provider body, image data, session material, or database snapshot storage in v2.4 verification.

**Same-Origin Product API:**
- Fastify API - Server framework dependency declared in `package.json`.
  - SDK/Client: browser/client code is outside this scoped remap; same-origin serving support is implied by `@fastify/static` in `package.json` and `CLIENT_DIST_DIR` in `.env.example`.
  - Auth: custom guest session configuration via `GUEST_SESSION_SECRET` and `NODE_ENV` in `.env.example`.
  - Uploads: `@fastify/multipart` in `package.json`, durable asset schema in `drizzle/0001_sleepy_vivisector.sql`, and upload staging configuration through `UPLOADS_STAGING_DIR` in `.env.example`.

**Deployment Platform:**
- Railway - `CHANGELOG.md` records previous staging and production smoke checks against Railway domains.
  - SDK/Client: not detected in scoped files; deployment integration is environment/container/platform configuration rather than a repo SDK.
  - Auth: Railway platform credentials are not present in the scoped files.
  - Evidence: `CHANGELOG.md` records v2.0 staging smoke at `https://nutrition-coach-stagin.up.railway.app/`, v2.0 production smoke at `https://nutrition-coach-production.up.railway.app/`, and v2.1 production deployment `3377daaf-820d-4954-9085-8c822ba43d28`.

**Local Browser Automation:**
- Installed Chrome or Microsoft Edge over Chrome DevTools Protocol - `scripts/phase45-mobile-evidence.mjs` searches for `/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge` and `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`.
  - SDK/Client: native Node `WebSocket`, `fetch`, and CDP JSON endpoints in `scripts/phase45-mobile-evidence.mjs`; no Playwright dependency is declared in `package.json`.
  - Auth: none detected; the script targets a local or reachable app URL supplied through `--base-url`.
  - Outputs: screenshots plus `phase45-manifest.json` and `phase45-visual-audit.json` under an output directory, defaulting to `output/playwright`.

**Package Registry:**
- npm-compatible registry through Yarn - `package.json` declares dependency names and version ranges; actual resolved registry data is outside this scoped remap because the lockfile is not in scope.
  - SDK/Client: Yarn command execution through developer shell and `scripts/release-check.mjs`.
  - Auth: not detected in scoped files; do not read `.npmrc` if present.

## Data Storage

**Databases:**
- SQLite file database
  - Connection: `DB_PATH` from `.env.example`; `drizzle.config.ts` falls back to `./data/nutrition.db`.
  - Client: `better-sqlite3` and `drizzle-orm` from `package.json`.
  - Migration tool: `drizzle-kit` from `package.json`, configured in `drizzle.config.ts`.
  - Migration directory: `drizzle/`.
  - Migration journal: `drizzle/meta/_journal.json`, with entries `0000_brainy_rocket_racer` through `0008_shiny_stellaris`.
  - Latest snapshot: `drizzle/meta/0008_snapshot.json`.
  - Core tables from scoped migrations: `devices`, `meals`, `chat_messages`, `assets`, `meal_transactions`, `meal_revisions`, `meal_revision_items`, `asset_references`, `turn_states`, `chat_meal_receipts`, and `chat_mutation_outcomes`.
  - Hot-path indexes: `drizzle/0004_history_query_hot_path_indexes.sql` adds active meal transaction history indexing; `drizzle/0008_shiny_stellaris.sql` adds device/action/date indexing for mutation outcomes.

**File Storage:**
- Durable local asset storage
  - Root: `ASSETS_DIR` optional override in `.env.example`, default described there as `./data/assets`.
  - Metadata table: `assets` in `drizzle/0001_sleepy_vivisector.sql` stores `device_id`, `storage_key`, `mime_type`, `byte_size`, and `created_at`.
  - Reference table: `asset_references` in `drizzle/0002_meal_transaction_v2_foundation.sql` links assets to `chat_message` and `meal_revision` owners.
- Upload staging storage
  - Root: `UPLOADS_STAGING_DIR` optional override in `.env.example`, default described there as `./data/uploads-staging`.
  - Integration dependency: `@fastify/multipart` in `package.json`.

**Caching:**
- No external cache service detected in scoped files.
- Local turn-state persistence uses SQLite table `turn_states` from `drizzle/0003_aspiring_masque.sql`, with `payload`, `expires_at`, `created_at`, and `updated_at`.

## Authentication & Identity

**Auth Provider:**
- Custom guest-session identity
  - Implementation config: `GUEST_SESSION_SECRET` optional override in `.env.example`.
  - Deployment behavior: `.env.example` documents `NODE_ENV=production` as an optional deployment override; production mode is associated with secure deployed-session behavior in project rules outside the scoped files.
  - Database identity key: scoped migrations consistently use `device_id` foreign keys across `chat_messages`, `meals`, `assets`, `meal_transactions`, `asset_references`, `turn_states`, `chat_meal_receipts`, and `chat_mutation_outcomes`.
  - External IdP: not detected in scoped files; no OAuth, Clerk, Auth0, Supabase Auth, or Firebase dependency is declared in `package.json`.

## Monitoring & Observability

**Error Tracking:**
- No external error tracking service detected in scoped files.
- `CHANGELOG.md` records metadata-only provider failure localization, route/orchestrator fallback metadata, and reference-code behavior for user-visible fallback/error bubbles.
- `CHANGELOG.md` records provider failure metadata fields such as status, provider request id, error class/type/code, operation, model, and abort flag.

**Logs:**
- Release logs - `scripts/release-check.mjs` prints release-check status, diff base, changed file counts, timezone contract, step labels, server route/service change note, and final PASS.
- Matrix generation checks - `scripts/generate-capability-matrix-doc.mjs` and `scripts/generate-behavior-matrix-doc.mjs` fail with explicit out-of-sync messages when generated Markdown differs from source.
- Visual evidence logs - `scripts/phase45-mobile-evidence.mjs` prints usage/help and throws explicit setup errors for unreachable base URLs, missing browsers, and non-Vite base URLs.
- Privacy guardrail - `CHANGELOG.md` repeatedly states release evidence is metadata-only and excludes raw prompts, user text, assistant final text, tool payloads, provider bodies, image data, session material, and database snapshots.

## CI/CD & Deployment

**Hosting:**
- Railway - deployment history and smoke evidence are recorded in `CHANGELOG.md`.
- Local/deployed app configuration is environment-variable driven through `.env.example`.
- Same-origin static client serving is supported by `@fastify/static` in `package.json` and `CLIENT_DIST_DIR` in `.env.example`.

**CI Pipeline:**
- No hosted CI config is present in the scoped files.
- Local release gate: `yarn release:check` from `package.json`.
- Release gate implementation: `scripts/release-check.mjs` validates `TZ=Asia/Taipei`, runs `yarn tsc --noEmit`, `yarn test`, and `yarn build`, and considers changed files from Git to print route/service integration notes.
- Test command coverage: `package.json` `test` runs unit and integration tests through Node test runner; `test:unit` and `test:integration` split the same pattern; `verify:harness` runs deterministic harness scenarios.
- Matrix checks: `package.json` `matrix:check` runs capability matrix unit tests and `yarn matrix:gen:check`; `behavior-matrix:gen:check` validates generated harness behavior documentation.
- Recent verification evidence: `CHANGELOG.md` records v2.4 `yarn tsc --noEmit` and `yarn release:check` passing with 1,245 tests and a completed frontend build.

## Environment Configuration

**Required env vars:**
- `OPENAI_API_KEY` - Required OpenAI credential in `.env.example`.
- `OPENAI_ORCHESTRATOR_MODEL` - Required/defaulted model selector in `.env.example`.
- `PORT` - Server port in `.env.example`, default `3000`.
- `DB_PATH` - SQLite database path in `.env.example` and `drizzle.config.ts`.
- `TZ` - Required day-boundary timezone in `.env.example`, `scripts/run-node-with-tz.mjs`, and `scripts/release-check.mjs`.

**Optional env vars:**
- `NODE_ENV` - Deployment mode override in `.env.example`.
- `GUEST_SESSION_SECRET` - Stable random guest-session signing secret in `.env.example`.
- `ASSETS_DIR` - Durable asset directory in `.env.example`.
- `UPLOADS_STAGING_DIR` - Upload staging directory in `.env.example`.
- `CLIENT_DIST_DIR` - Built client directory in `.env.example`.

**Secrets location:**
- `.env.example` is safe to read and contains placeholder/template values only.
- Real `.env` and `.env.*` files are secret-bearing local configuration and must not be read or quoted.
- Railway/deployment secrets are external to the repo; scoped files do not include platform credentials.

## Webhooks & Callbacks

**Incoming:**
- No third-party incoming webhooks detected in scoped files.
- Product traffic is handled by the Fastify server dependency in `package.json`; route files are outside this scoped remap.
- Realtime/SSE behavior is referenced in `CHANGELOG.md` as `daily_summary` SSE and freshness envelopes, but endpoint implementation is outside the scoped paths.

**Outgoing:**
- OpenAI API calls are implied by the `openai` dependency in `package.json` and OpenAI env vars in `.env.example`.
- Railway smoke targets are external deployed URLs recorded in `CHANGELOG.md`.
- `scripts/phase45-mobile-evidence.mjs` makes outgoing local/network requests to the provided `--base-url` and to `http://127.0.0.1:<debug-port>/json/version` for CDP discovery.
- No payment provider, email provider, object-storage SaaS, queue service, external cache, analytics SDK, or outgoing webhook integration is detected in the scoped files.

---

*Integration audit: 2026-06-01*
