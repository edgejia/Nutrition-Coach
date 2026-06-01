<!-- refreshed: 2026-06-01 -->
<!-- last_mapped_commit: df5f989b593d494ac44ce3b004307c1c6ada7bec -->
# Architecture

**Analysis Date:** 2026-06-01

## System Overview

```text
┌─────────────────────────────────────────────────────────────┐
│                  Mobile-first React client                   │
│       `client/src/*` described by `README.md`                │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               │ HTTP, FormData, EventSource
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                 Single Fastify service process               │
│       `server/app.ts`, `server/routes/*`, `Dockerfile`       │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               │ services, orchestrator, LLM tools
                               ▼
┌─────────────────────────────────────────────────────────────┐
│          Domain services + OpenAI-backed orchestration        │
│ `server/services/*`, `server/orchestrator/*`, `server/llm/*` │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               │ Drizzle migrations + durable files
                               ▼
┌─────────────────────────────────────────────────────────────┐
│              SQLite, assets, and external OpenAI API          │
│      `drizzle/*`, `data/`, `yarn.lock`, `README.md`          │
└─────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| React client | Provides onboarding, chat logging, home dashboard, history, detail/edit, and settings surfaces | `README.md` |
| Client transport | Sends HTTP chat/API requests and uses browser `EventSource` for SSE | `README.md` |
| Fastify service | Serves the API and, in deployment, the built client from one process | `README.md`, `Dockerfile` |
| Route layer | Owns chat streaming, device/session, meals, history, assets, and `/api/sse` transport boundaries | `README.md` |
| Service layer | Owns domain logic and SQLite-backed persistence | `README.md` |
| Orchestrator | Runs LLM prompt/tool workflows, fallback behavior, receipts, and structured meal mutations | `README.md`, `CHANGELOG.md` |
| LLM provider layer | Uses OpenAI at runtime and mock providers in tests/harnesses | `README.md`, `README-en.md`, `yarn.lock` |
| Persistence layer | Stores devices, chat messages, assets, meal transactions/revisions/items, turn states, receipts, and mutation outcomes | `drizzle/*.sql`, `drizzle/meta/_journal.json` |
| Deployment container | Installs with Yarn, builds the client, runs migrations, then starts the server on port `3000` | `Dockerfile` |
| Ignore boundaries | Keep local agent state, `.planning`, secrets, runtime data, build output, and generated harness artifacts out of git/build context | `.gitignore`, `.dockerignore` |

## Pattern Overview

**Overall:** Full-stack TypeScript monolith deployed as a single Fastify service, with React/Vite on the client, server-owned AI orchestration, Drizzle-managed SQLite persistence, and deterministic test/harness boundaries.

**Key Characteristics:**
- The public README architecture remains layer-oriented: `client/src/` for UI/state/transport, `server/routes/` for HTTP/SSE boundaries, `server/services/` for domain persistence, `server/orchestrator/` for LLM workflow, `server/llm/` for provider adapters, `server/realtime/` for SSE fan-out, and `server/db/` plus `drizzle/` for persistence.
- Deployment is one containerized Node 22 app. `Dockerfile` runs `corepack enable`, installs from `package.json` and `yarn.lock`, runs `yarn build`, sets `NODE_ENV=production`, exposes `3000`, and starts with `yarn db:migrate && yarn start`.
- SQLite schema evolution is source-controlled in `drizzle/`; the migration journal currently lists migrations `0000` through `0008`.
- Meal records use a transaction/revision model from `drizzle/0002_meal_transaction_v2_foundation.sql`, with later migrations adding hot-path history indexes, chat status, chat receipts, persisted meal-period intent, and chat mutation outcomes.
- Runtime local/deployed state is intentionally outside git and Docker context through `.gitignore` and `.dockerignore`: `data/*`, `dist`, `.env*`, `.planning`, local agent folders, and generated harness artifacts.

## Layers

**Client Application:**
- Purpose: Render the mobile-first product experience and own browser-side state/transport.
- Location: `client/src/` as documented in `README.md`.
- Contains: `components/`, `store.ts`, `api.ts`, and `sse.ts`.
- Depends on: React, Vite, browser `fetch`, browser `EventSource`, and same-origin/server API contracts.
- Used by: Vite in development and the production Fastify static-serving path described in `README.md`.

**Backend Transport:**
- Purpose: Own HTTP, SSE, upload, cookie-session, and response shaping boundaries.
- Location: `server/routes/` as documented in `README.md`.
- Contains: Chat, device/session, meals, history, assets, and `/api/sse` route modules.
- Depends on: Service factories, orchestrator, guest-session resolution, and realtime publisher.
- Used by: The Fastify composition root `server/app.ts` described by `README.md`.

**Domain Services:**
- Purpose: Own reusable business logic and SQLite-backed persistence.
- Location: `server/services/` as documented in `README.md`.
- Contains: Meal logging/correction, device goals, assets, summaries, history, guest sessions, and mutation persistence.
- Depends on: Drizzle schema/migrations and server helper libraries.
- Used by: Route modules and orchestrator tool execution.

**AI Orchestration:**
- Purpose: Convert user turns into model calls, tool executions, structured mutation commits, fallback replies, and receipts.
- Location: `server/orchestrator/` and `server/llm/` as documented in `README.md`.
- Contains: Prompt/tool calling, mutation effects, tool contracts, fallback behavior, OpenAI provider, mock provider, and metadata-only failure localization.
- Depends on: OpenAI SDK from `yarn.lock`, injected services, and test/harness providers.
- Used by: `server/routes/chat.ts` and deterministic harnesses under `tests/harness/`.

**Persistence:**
- Purpose: Store product state and support migrations across local and deployed SQLite databases.
- Location: `drizzle/`.
- Contains: SQL migrations `drizzle/0000_brainy_rocket_racer.sql` through `drizzle/0008_shiny_stellaris.sql`, metadata snapshots under `drizzle/meta/`, and migration journal `drizzle/meta/_journal.json`.
- Depends on: Drizzle ORM/Kit and `better-sqlite3` locked in `yarn.lock`.
- Used by: `yarn db:migrate` in local setup and container startup.

**Deployment Packaging:**
- Purpose: Produce a production image with dependencies installed, frontend built, migrations run, and server started.
- Location: `Dockerfile`, `.dockerignore`.
- Contains: Node 22 base image, Yarn install/build/start commands, production env default, and build-context exclusions.
- Depends on: `package.json`, `yarn.lock`, and source files included by `.dockerignore`.
- Used by: Container hosts such as the Railway deployment path referenced by `README.md`.

**Verification and Harness:**
- Purpose: Prove unit, integration, AI behavior, boundary, and release contracts.
- Location: `tests/` as documented in `README.md`; generated evidence is ignored by `.gitignore`.
- Contains: Unit tests, integration tests, deterministic harnesses, and generated artifacts.
- Depends on: Node test runner, real SQLite, mock/harness LLM providers.
- Used by: `yarn test`, `yarn test:unit`, `yarn test:integration`, `yarn verify:harness -- <scenario>`, and `yarn release:check`.

## Data Flow

### Primary Chat Request Path

1. Browser UI under `client/src/components/` submits text/image input through `client/src/api.ts` as described in `README.md`.
2. `server/routes/chat.ts` receives chat requests, owns streaming and upload boundaries, and connects to the orchestrator.
3. `server/orchestrator/*` performs OpenAI-backed analysis/coaching, calls tools, and commits structured meal mutations through `server/services/*`.
4. Meal and chat state persist through Drizzle-managed SQLite tables introduced in `drizzle/0000_brainy_rocket_racer.sql`, `drizzle/0002_meal_transaction_v2_foundation.sql`, `drizzle/0005_chat_message_status.sql`, `drizzle/0006_colossal_selene.sql`, and `drizzle/0008_shiny_stellaris.sql`.
5. `server/routes/chat.ts` streams status, partial reply, final receipt, and fallback/reference information over SSE as described in `README.md` and `CHANGELOG.md`.
6. Client state in `client/src/store.ts` updates the chat, home, history, and meal detail/edit surfaces.

### Onboarding and Guest Session Flow

1. A user completes lightweight onboarding in the React client described by `README.md`.
2. `server/routes/device.ts` creates the device, target data, and cookie-backed guest session.
3. Browser requests use signed cookies rather than account login; `GET /api/sse` specifically depends on cookies because browser `EventSource` cannot set custom headers.
4. Persistent device and target fields live in the `devices` table created by `drizzle/0000_brainy_rocket_racer.sql`.

### Meal Mutation and History Flow

1. Direct edit/delete screens or chat tools request meal changes through route/service boundaries documented in `README.md`.
2. Meal identity lives in `meal_transactions`; immutable content lives in `meal_revisions` and `meal_revision_items` from `drizzle/0002_meal_transaction_v2_foundation.sql`.
3. `drizzle/0007_violet_living_lightning.sql` adds persisted `meal_period` for explicit user meal-period intent.
4. `drizzle/0004_history_query_hot_path_indexes.sql` adds the active meal history hot-path index for device/date pagination.
5. `drizzle/0008_shiny_stellaris.sql` records committed chat mutation outcomes by assistant message, action, affected date, food, macros, and goal fields.

### Build and Deployment Flow

1. Local or CI/container build installs dependencies from `yarn.lock`.
2. `Dockerfile` runs `yarn build`, which README describes as producing the client bundle for Fastify serving.
3. Container startup runs `yarn db:migrate && yarn start`.
4. Runtime state such as SQLite files and durable assets must live on persistent storage outside the image; `.dockerignore` excludes `data/*`, `.env*`, `dist`, and local workflow folders from the build context.

**State Management:**
- Client UI state is centralized in `client/src/store.ts` according to `README.md`.
- Durable server state is SQLite schema managed by `drizzle/*`; runtime database files are ignored by `.gitignore`.
- Durable uploaded image assets live under runtime data paths described by `README.md` environment variables and ignored by `.gitignore` / `.dockerignore`.
- Realtime connection state is in-process SSE fan-out through `server/realtime/` as described by `README.md`; external pub/sub is not represented in the scoped files.

## Key Abstractions

**Single Fastify App:**
- Purpose: One Node service owns API routes, SSE, static client serving, migrations-at-start deployment, and production process lifecycle.
- Examples: `README.md`, `Dockerfile`.
- Pattern: Full-stack monolith packaged as one container.

**Transport / Service Split:**
- Purpose: Keep protocol-specific logic in routes and domain/persistence logic in services.
- Examples: `server/routes/chat.ts`, `server/routes/device.ts`, `server/services/*` referenced by `README.md`.
- Pattern: Routes validate and shape requests/responses; services own reusable mutations and queries.

**Server-Owned Orchestrator:**
- Purpose: Keep LLM analysis, tool contracts, fallback behavior, and mutation receipts on the server.
- Examples: `server/orchestrator/*`, `server/orchestrator/tools.ts`, `server/orchestrator/tool-contract.ts`, `server/orchestrator/mutation-effects.ts` referenced by `README.md`.
- Pattern: OpenAI runtime provider plus mock/harness providers for deterministic verification.

**Revisioned Meal Model:**
- Purpose: Represent edits/deletes safely while preserving revision identity and current pointers.
- Examples: `drizzle/0002_meal_transaction_v2_foundation.sql`, `drizzle/0007_violet_living_lightning.sql`.
- Pattern: `meal_transactions` owns durable meal identity/current revision; `meal_revisions` and `meal_revision_items` own versioned content; later migrations add structured meal-period intent.

**Chat Outcome Records:**
- Purpose: Attach durable mutation metadata to assistant messages for receipts, auditability, and UI reconciliation.
- Examples: `drizzle/0006_colossal_selene.sql`, `drizzle/0008_shiny_stellaris.sql`.
- Pattern: Unique assistant-message outcome records indexed by device/action/date.

**Cookie-Backed Guest Session:**
- Purpose: Preserve same-browser history without full account signup and support browser `EventSource`.
- Examples: `README.md`, `README-en.md`.
- Pattern: Custom signed guest sessions with `credentials: same-origin` client transport.

**Generated Migration Set:**
- Purpose: Keep database evolution explicit and replayable.
- Examples: `drizzle/meta/_journal.json`, `drizzle/meta/0008_snapshot.json`.
- Pattern: Source-controlled Drizzle SQL and JSON snapshots committed alongside code.

## Entry Points

**Production Container:**
- Location: `Dockerfile`
- Triggers: Container build/run.
- Responsibilities: Install dependencies with Yarn, build the app, set production mode, expose port `3000`, migrate DB, and start the server.

**Local Development:**
- Location: `README.md`, `README-en.md`
- Triggers: Developer runs `yarn dev:server` and `yarn dev:client`.
- Responsibilities: Run Fastify on `3000`, Vite on `5173`, and use `.env` for OpenAI/API/model/DB/timezone settings.

**Database Migration:**
- Location: `drizzle/`, `Dockerfile`, `README.md`
- Triggers: `yarn db:migrate` locally or during container startup.
- Responsibilities: Apply SQL migrations from `drizzle/` to the SQLite database path configured by environment.

**Chat API Boundary:**
- Location: `server/routes/chat.ts` as documented in `README.md`.
- Triggers: User meal logging and corrections.
- Responsibilities: Own streaming chat boundary, uploads, orchestrator invocation, receipts, and fallback behavior.

**SSE Boundary:**
- Location: `GET /api/sse` documented in `README.md`.
- Triggers: Browser `EventSource`.
- Responsibilities: Stream chat status, partial reply, final receipt, daily summary, and goals updates through cookie-backed session auth.

**Harness CLI:**
- Location: `tests/harness/` as documented in `README.md`.
- Triggers: `yarn verify:harness -- <scenario>`.
- Responsibilities: Run deterministic AI, receipt, and boundary verification scenarios; generated artifacts remain ignored by `.gitignore`.

## Architectural Constraints

- **Threading:** The scoped files describe a single Node/Fastify process. No worker-thread or multi-process realtime architecture is represented in `README.md`, `Dockerfile`, or `drizzle/*`.
- **Global state:** Runtime SQLite files, durable assets, upload staging, build output, local workflow state, and `.planning` are intentionally local/generated and excluded by `.gitignore` and `.dockerignore`.
- **Circular imports:** Not detected within the scoped path set; source imports outside the listed paths were not scanned for this scoped pass.
- **Timezone:** `TZ=Asia/Taipei` is a documented required setting in `README.md` and `README-en.md`; day-boundary behavior depends on it.
- **Deployment shape:** The production image runs migrations at process startup via `Dockerfile`; deployed hosts need a persistent volume for SQLite and assets as stated in `README.md`.
- **Authentication:** Browser protected flows rely on cookie-backed guest sessions, especially `/api/sse`, because `EventSource` cannot set custom headers.
- **Secrets:** `.env` and `.env.*` are excluded by both `.gitignore` and `.dockerignore`; do not read or commit environment values.

## Anti-Patterns

### Splitting API and Client Into Separate Production Services

**What happens:** Production deployment treats the Vite client and API as separately hosted apps without preserving same-origin cookies.
**Why it's wrong:** `README.md` and `Dockerfile` define a single Fastify service that serves both API and `dist/client`; guest-session and `/api/sse` behavior assume same-origin browser credentials.
**Do this instead:** Build the client with `yarn build`, run `yarn db:migrate && yarn start`, and keep Fastify as the production owner of API plus static client serving.

### Hand-Editing Runtime Data or Generated Evidence

**What happens:** Runtime DB/assets or harness artifacts are treated as source files.
**Why it's wrong:** `.gitignore` excludes `data/*`, `tests/harness/artifacts/`, and `tests/harness/tmp/`; `.dockerignore` excludes runtime data and tests from image context.
**Do this instead:** Change schema through `drizzle/*.sql` generated from source schema, and regenerate harness evidence with `yarn verify:harness -- <scenario>` when needed.

### Bypassing Revisioned Meal Writes

**What happens:** New meal edit/delete behavior writes legacy `meals` rows directly or ignores transaction/revision identity.
**Why it's wrong:** `drizzle/0002_meal_transaction_v2_foundation.sql` establishes `meal_transactions`, `meal_revisions`, and `meal_revision_items` as the durable meal model; changelog entries describe receipt/edit payloads depending on revision identity.
**Do this instead:** Route all meal mutations through service logic that preserves transaction identity, current revision pointers, and optimistic revision checks.

### Committing Local Workflow or Secret Files

**What happens:** `.env`, `.planning`, local agent folders, local DBs, or generated build output are added to source control or Docker context.
**Why it's wrong:** `.gitignore` and `.dockerignore` explicitly exclude these paths; secrets and workflow state are local-only.
**Do this instead:** Commit source, migrations, README/deploy docs, and lockfile changes; keep secret/runtime/workflow files local.

## Error Handling

**Strategy:** Validate and fail at transport, tool-contract, and persistence boundaries; preserve metadata-only failure localization for hard LLM/chat failures without storing raw prompt/user/provider payloads.

**Patterns:**
- Metadata-only LLM/chat failure localization is a first-class architecture feature in `README.md` and `CHANGELOG.md`.
- Guest-session failures are handled by the cookie-backed session boundary described in `README.md`; protected browser flows should not depend on custom headers.
- Migration failures during deployment block startup because `Dockerfile` runs `yarn db:migrate && yarn start`.
- Chat correction failures, ambiguous targets, expired proposals, and unauthorized numeric corrections are no-mutation paths per `CHANGELOG.md`.
- Runtime secrets stay outside source and image context through `.gitignore` and `.dockerignore`.

## Cross-Cutting Concerns

**Logging:** Scoped docs emphasize metadata-only failure localization through `server/llm/errors.ts`, `server/observability/events.ts`, and harness traces referenced by `README.md` and `CHANGELOG.md`.

**Validation:** LLM tool contracts and mutation commits are documented around `server/orchestrator/tools.ts`, `server/orchestrator/tool-contract.ts`, and `server/orchestrator/mutation-effects.ts` in `README.md`.

**Authentication:** Custom signed-cookie guest sessions are documented in `README.md`; `/api/sse` must remain cookie-backed because browser `EventSource` cannot set headers.

**Persistence:** Drizzle SQL migrations under `drizzle/` are the source-controlled persistence history. Runtime SQLite files are ignored.

**Deployment:** `Dockerfile` is the canonical container entry: Node 22, Yarn install, build, `NODE_ENV=production`, expose `3000`, migrate, start.

---

*Architecture analysis: 2026-06-01*
