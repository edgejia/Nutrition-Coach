<!-- refreshed: 2026-06-01 -->
<!-- last_mapped_commit: df5f989b593d494ac44ce3b004307c1c6ada7bec -->
# Codebase Structure

**Analysis Date:** 2026-06-01

## Directory Layout

```text
Nutrition-Coach/
├── client/                 # Vite React client; described by `README.md`
│   └── src/                # Components, Zustand store, API, SSE helpers
├── server/                 # Fastify API, services, LLM orchestration, SQLite access
│   ├── routes/             # HTTP/SSE transport boundaries
│   ├── services/           # Domain logic and persistence services
│   ├── orchestrator/       # LLM prompts, tools, receipts, fallback behavior
│   ├── llm/                # OpenAI and mock provider adapters
│   ├── realtime/           # SSE fan-out
│   └── db/                 # Drizzle schema/client/migration runner
├── tests/                  # Unit, integration, and deterministic harness tests
│   └── harness/            # Scenario verification and generated artifacts
├── drizzle/                # Source-controlled SQLite migrations and snapshots
│   ├── 0000_*.sql          # Base devices/chat/meals schema
│   ├── 0001_*.sql          # Assets
│   ├── 0002_*.sql          # Meal transaction/revision model
│   ├── 0003_*.sql          # Turn states
│   ├── 0004_*.sql          # History hot-path index
│   ├── 0005_*.sql          # Chat message status
│   ├── 0006_*.sql          # Chat meal receipts
│   ├── 0007_*.sql          # Meal-period intent
│   ├── 0008_*.sql          # Chat mutation outcomes
│   └── meta/               # Drizzle migration journal and JSON snapshots
├── data/                   # Runtime SQLite/assets area; ignored except `.gitkeep`
├── dist/                   # Generated client build output; ignored
├── Dockerfile              # Production container build/start path
├── README.md               # Traditional Chinese product, setup, architecture guide
├── README-en.md            # English product, setup, architecture guide
├── CHANGELOG.md            # Versioned product/architecture/verification changes
├── .gitignore              # Git source boundary
├── .dockerignore           # Docker build-context boundary
└── yarn.lock               # Locked dependency graph
```

## Directory Purposes

**`client/`:**
- Purpose: Mobile-first browser app for onboarding, chat logging, home dashboard, history, settings, detail, and meal edit flows.
- Contains: `client/src/components/`, `client/src/store.ts`, `client/src/api.ts`, `client/src/sse.ts`.
- Key files: `client/src/store.ts`, `client/src/api.ts`, `client/src/sse.ts`, `client/src/components/ChatPanel.tsx` as documented in `README.md`.

**`server/`:**
- Purpose: Same-origin Fastify backend, static client serving, model orchestration, persistence, guest sessions, and SSE.
- Contains: `server/app.ts`, `server/routes/`, `server/services/`, `server/orchestrator/`, `server/llm/`, `server/realtime/`, `server/db/`.
- Key files: `server/app.ts`, `server/routes/chat.ts`, `server/routes/device.ts`, `server/lib/guest-session-resolver.ts`, `server/orchestrator/tools.ts`, `server/orchestrator/tool-contract.ts`, `server/orchestrator/mutation-effects.ts` as documented in `README.md`.

**`server/routes/`:**
- Purpose: HTTP and SSE transport boundaries.
- Contains: Chat streaming/upload routes, device/session routes, meal routes, history routes, assets, and `/api/sse`.
- Key files: `server/routes/chat.ts`, `server/routes/device.ts` from `README.md`.

**`server/services/`:**
- Purpose: Domain logic and SQLite-backed persistence.
- Contains: Meal persistence, corrections, goals, assets, history, summaries, guest sessions, and mutation support.
- Key files: `server/services/*` as documented in `README.md`.

**`server/orchestrator/`:**
- Purpose: OpenAI-backed meal analysis/coaching, tool calling, structured mutation commits, receipts, and fallback behavior.
- Contains: Prompts, tool contracts, mutation effects, correction authority, and fallback flow.
- Key files: `server/orchestrator/*`, `server/orchestrator/tools.ts`, `server/orchestrator/tool-contract.ts`, `server/orchestrator/mutation-effects.ts` from `README.md`.

**`server/llm/`:**
- Purpose: LLM provider abstraction and metadata-only failure localization.
- Contains: OpenAI provider, mock provider, provider error types, and shared provider interfaces.
- Key files: `server/llm/errors.ts` from `README.md`.

**`server/db/`:**
- Purpose: Runtime schema/client/migration integration for SQLite.
- Contains: Drizzle schema, SQLite client, and migration runner.
- Key files: `server/db/*` as documented in `README.md`.

**`tests/`:**
- Purpose: Unit, integration, route/service/SSE/orchestrator, and deterministic harness coverage.
- Contains: `tests/unit/`, `tests/integration/`, `tests/harness/`.
- Key files: `tests/harness/scenarios/provider-auth-failure-localization.ts` from `README.md`.

**`drizzle/`:**
- Purpose: Source-controlled SQLite migration history and Drizzle snapshots.
- Contains: Migrations `drizzle/0000_brainy_rocket_racer.sql` through `drizzle/0008_shiny_stellaris.sql`, plus `drizzle/meta/*.json`.
- Key files: `drizzle/meta/_journal.json`, `drizzle/0002_meal_transaction_v2_foundation.sql`, `drizzle/0004_history_query_hot_path_indexes.sql`, `drizzle/0007_violet_living_lightning.sql`, `drizzle/0008_shiny_stellaris.sql`.

**`data/`:**
- Purpose: Local/deployed runtime storage for SQLite, WAL/SHM files, durable assets, and staging uploads.
- Contains: Runtime-generated files only; source control should keep only `data/.gitkeep`.
- Key files: `data/.gitkeep`; runtime DB/assets are ignored by `.gitignore` and `.dockerignore`.

**`.planning/`:**
- Purpose: Local GSD workflow state and codebase map output.
- Contains: `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/STRUCTURE.md`, and other workflow artifacts.
- Key files: `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/STRUCTURE.md`.

## Key File Locations

**Entry Points:**
- `Dockerfile`: Production container build and start path.
- `README.md`: Local setup, product flow, architecture overview, command list, environment variables, and deployment guidance in Traditional Chinese.
- `README-en.md`: English mirror of local setup, architecture overview, commands, environment variables, and deployment guidance.
- `server/app.ts`: Fastify composition root documented by `README.md`.
- `server/routes/chat.ts`: Streaming chat route documented by `README.md`.
- `client/src/store.ts`: Client state boundary documented by `README.md`.

**Configuration:**
- `.gitignore`: Defines source-control exclusions for local agent state, `.planning`, dependencies, build output, runtime data, generated harness artifacts, local docs, secrets, DB files, OS files, and browser/tool cache.
- `.dockerignore`: Defines Docker build-context exclusions for dependencies, build output, coverage, secrets, runtime data, tests, docs, local agent/planning folders, browser cache, git metadata, logs, and DB files.
- `Dockerfile`: Uses `node:22-bookworm-slim`, `corepack enable`, `yarn install --frozen-lockfile`, `yarn build`, `NODE_ENV=production`, `EXPOSE 3000`, and `yarn db:migrate && yarn start`.
- `yarn.lock`: Locks framework/runtime dependencies including Fastify, React, Vite, Drizzle, `better-sqlite3`, and OpenAI SDK packages.
- `README.md`: Documents required runtime variables: `OPENAI_API_KEY`, `OPENAI_ORCHESTRATOR_MODEL`, `PORT`, `DB_PATH`, `TZ`, `NODE_ENV`, `GUEST_SESSION_SECRET`, `ASSETS_DIR`, `UPLOADS_STAGING_DIR`, `CLIENT_DIST_DIR`.

**Core Logic:**
- `server/routes/chat.ts`: Text/image meal logging, streaming chat UX, corrections, upload flow, receipts, and fallback behavior.
- `server/orchestrator/*`: Model prompts, tool calls, correction authority, fallback behavior, and receipt generation.
- `server/orchestrator/tools.ts`: LLM tool calling with structured mutation commits.
- `server/orchestrator/tool-contract.ts`: Tool contract boundary.
- `server/orchestrator/mutation-effects.ts`: Structured mutation effect ownership.
- `server/services/*`: Persistence and domain logic.
- `server/routes/device.ts`: Signed-cookie guest sessions and device onboarding.
- `server/lib/guest-session-resolver.ts`: Guest-session resolution boundary.
- `client/src/sse.ts`: SSE transport helpers.
- `client/src/components/ChatPanel.tsx`: Streaming chat surface.

**Persistence:**
- `drizzle/0000_brainy_rocket_racer.sql`: Initial `chat_messages`, `devices`, and legacy `meals` tables.
- `drizzle/0001_sleepy_vivisector.sql`: `assets` table and storage-key uniqueness.
- `drizzle/0002_meal_transaction_v2_foundation.sql`: `meal_transactions`, `meal_revisions`, `meal_revision_items`, `asset_references`, and legacy meal backfill.
- `drizzle/0003_aspiring_masque.sql`: `turn_states` table and device/kind uniqueness.
- `drizzle/0004_history_query_hot_path_indexes.sql`: Active meal history pagination index.
- `drizzle/0005_chat_message_status.sql`: `chat_messages.status`.
- `drizzle/0006_colossal_selene.sql`: `chat_meal_receipts`.
- `drizzle/0007_violet_living_lightning.sql`: `meal_transactions.meal_period`.
- `drizzle/0008_shiny_stellaris.sql`: `chat_mutation_outcomes`.
- `drizzle/meta/_journal.json`: Ordered Drizzle migration journal through index `8`.

**Testing:**
- `tests/unit/`: Pure logic and contract tests documented in `README.md`.
- `tests/integration/`: Routes, services, SSE, and orchestrator boundary tests documented in `README.md`.
- `tests/harness/`: Deterministic AI behavior, receipt, and boundary harness documented in `README.md`.
- `tests/harness/artifacts/`: Generated evidence ignored by `.gitignore`.
- `tests/harness/tmp/`: Generated temporary harness files ignored by `.gitignore`.

## Naming Conventions

**Files:**
- Drizzle migrations use numbered snake/kebab-ish generated names: `drizzle/0008_shiny_stellaris.sql`.
- Drizzle snapshots use matching numeric JSON names under `drizzle/meta/`: `drizzle/meta/0008_snapshot.json`.
- Public documentation uses root README files: `README.md` and `README-en.md`.
- Ignore and deployment files live at repository root: `.gitignore`, `.dockerignore`, `Dockerfile`.

**Directories:**
- Use architecture-layer directories documented in `README.md`: `client/src/components`, `server/routes`, `server/services`, `server/orchestrator`, `server/llm`, `server/realtime`, `server/db`, `tests/harness`.
- Keep generated/source-controlled migrations in `drizzle/`.
- Keep runtime-only DB/assets in `data/`.
- Keep generated workflow maps in `.planning/codebase/`.

## Where to Add New Code

**New Backend API Feature:**
- Primary code: `server/routes/<feature>.ts`.
- Domain code: `server/services/<feature>.ts`.
- Composition: `server/app.ts`.
- Tests: `tests/integration/<feature>-api.test.ts`.

**New AI Tool or Orchestrator Behavior:**
- Tool contract/schema: `server/orchestrator/tools.ts` and `server/orchestrator/tool-contract.ts`.
- Mutation effects/receipts: `server/orchestrator/mutation-effects.ts` and related receipt renderers under `server/orchestrator/`.
- Runtime provider behavior: `server/llm/`.
- Boundary proof: `tests/harness/`.

**New Persistence Entity or Query:**
- Schema source: `server/db/schema.ts`.
- Generated migration output: `drizzle/`.
- Migration journal/snapshot output: `drizzle/meta/`.
- Service API: `server/services/<domain>.ts`.
- Do not hand-edit runtime SQLite files under `data/`.

**New Client Screen or UI Surface:**
- Component: `client/src/components/<ScreenName>.tsx`.
- Shared client state: `client/src/store.ts`.
- REST transport: `client/src/api.ts`.
- SSE transport: `client/src/sse.ts`.

**New Deployment or Runtime Configuration:**
- Container behavior: `Dockerfile`.
- Docker context exclusions: `.dockerignore`.
- Git source exclusions: `.gitignore`.
- User-facing setup docs: `README.md` and `README-en.md`.
- Do not commit `.env`, `.env.*`, DB files, local agent folders, or `.planning` outputs outside explicit GSD artifacts.

**New Verification Evidence:**
- Unit tests: `tests/unit/`.
- Integration tests: `tests/integration/`.
- Deterministic harness scenarios: `tests/harness/`.
- Generated artifacts: `tests/harness/artifacts/`, regenerated by commands and ignored by `.gitignore`.

## Special Directories

**`drizzle/`:**
- Purpose: Source-controlled database migrations and schema snapshots.
- Generated: Yes, by Drizzle.
- Committed: Yes.

**`drizzle/meta/`:**
- Purpose: Drizzle migration journal and snapshots.
- Generated: Yes.
- Committed: Yes.

**`data/`:**
- Purpose: Runtime SQLite database, WAL/SHM files, uploads, and durable assets.
- Generated: Yes, except `data/.gitkeep`.
- Committed: Only `data/.gitkeep`.

**`dist/`:**
- Purpose: Generated frontend build output served by Fastify in deployed mode.
- Generated: Yes.
- Committed: No.

**`tests/harness/artifacts/`:**
- Purpose: Generated deterministic scenario evidence.
- Generated: Yes.
- Committed: No; excluded by `.gitignore`.

**`tests/harness/tmp/`:**
- Purpose: Temporary harness runtime files.
- Generated: Yes.
- Committed: No; excluded by `.gitignore`.

**`.planning/`:**
- Purpose: GSD workflow state, active planning artifacts, and codebase maps.
- Generated: Mixed.
- Committed: Excluded by `.gitignore`; this scoped task intentionally updates `.planning/codebase/ARCHITECTURE.md` and `.planning/codebase/STRUCTURE.md` only.

**`.codex/` and `.claude/`:**
- Purpose: Local/project agent instructions and compatibility shims.
- Generated: Mixed.
- Committed: Excluded by `.gitignore` and `.dockerignore` in the scoped files.

**`.playwright-*` and `.playwright-mcp`:**
- Purpose: Browser automation cache/log output.
- Generated: Yes.
- Committed: No; excluded by `.gitignore` and `.dockerignore`.

---

*Structure analysis: 2026-06-01*
