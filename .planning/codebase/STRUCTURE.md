# Codebase Structure

**Analysis Date:** 2026-05-29

## Directory Layout

```text
Nutrition-Coach/
├── client/                 # Vite React client application
│   ├── index.html          # Vite HTML entry
│   ├── vite.config.ts      # Client dev/build config
│   └── src/                # React components, store, transport, UI helpers
├── server/                 # Fastify API, services, orchestration, persistence adapters
│   ├── app.ts              # Backend composition root
│   ├── index.ts            # Production server entry
│   ├── config.ts           # Environment-derived runtime config
│   ├── db/                 # Drizzle schema, SQLite client, migration runner
│   ├── lib/                # Shared server helpers for session/date/time/meal periods
│   ├── llm/                # LLM provider interface, OpenAI adapter, mock provider
│   ├── observability/      # Structured event helpers
│   ├── orchestrator/       # AI workflow, prompts, tools, receipts, traces
│   ├── realtime/           # SSE fan-out publisher
│   ├── routes/             # Fastify route registration modules
│   └── services/           # Domain and persistence service factories
├── tests/                  # Node test suites plus deterministic harness
│   ├── unit/               # Unit/source contract tests
│   ├── integration/        # Fastify route/service/orchestrator integration tests
│   ├── helpers/            # Shared test helpers
│   └── harness/            # Deterministic scenario runner, fixtures, artifacts
├── drizzle/                # Generated SQL migrations and Drizzle snapshots
├── scripts/                # Verification and documentation generation scripts
├── docs/                   # Project docs, ADRs, deployment guidance, matrices
├── data/                   # Runtime SQLite/assets area; only `.gitkeep` is source-controlled
├── .planning/              # GSD project state, milestones, phases, codebase maps
├── .codex/skills/          # Repo-local Codex skill indexes for Nutrition workflows
├── .claude/                # Thin compatibility shims and local Claude settings
├── package.json            # Yarn scripts and dependencies
├── tsconfig.json           # TypeScript project config
├── drizzle.config.ts       # Drizzle generation config
├── Dockerfile              # Deployment container config
└── yarn.lock               # Yarn lockfile
```

## Directory Purposes

**`client/`:**
- Purpose: Browser UI for onboarding, chat logging, home dashboard, history, settings, day detail, and meal editing.
- Contains: `client/src/main.tsx`, `client/src/App.tsx`, `client/src/components/*.tsx`, `client/src/lib/*.ts`, `client/src/store.ts`, `client/src/api.ts`, `client/src/sse.ts`, `client/src/types.ts`.
- Key files: `client/src/main.tsx`, `client/src/App.tsx`, `client/src/components/MainLayout.tsx`, `client/src/store.ts`, `client/src/api.ts`, `client/src/sse.ts`, `client/vite.config.ts`.

**`client/src/components/`:**
- Purpose: React screens and reusable UI components.
- Contains: Top-level surfaces such as `HomeScreen.tsx`, `ChatPanel.tsx`, `HistoryScreen.tsx`, `GoalSettings.tsx`, `MealEditScreen.tsx`, sport design primitives, icons, and onboarding steps.
- Key files: `client/src/components/MainLayout.tsx`, `client/src/components/ChatPanel.tsx`, `client/src/components/HomeScreen.tsx`, `client/src/components/HistoryScreen.tsx`, `client/src/components/onboarding/OnboardingStepper.tsx`.

**`client/src/lib/`:**
- Purpose: Pure client helpers and source-contract logic.
- Contains: Time formatting, history-week calculations, onboarding validation/flow helpers, markdown parsing, target input helpers, chat scroll helpers.
- Key files: `client/src/lib/time.ts`, `client/src/lib/onboarding-intake-validation.ts`, `client/src/lib/history-week.ts`, `client/src/lib/assistant-markdown.ts`.

**`server/`:**
- Purpose: Same-origin backend API, model orchestration, persistence, assets, and deployed static serving.
- Contains: Composition root, entry point, config, DB layer, route modules, services, orchestrator, LLM adapters, observability, realtime publisher.
- Key files: `server/app.ts`, `server/index.ts`, `server/config.ts`.

**`server/routes/`:**
- Purpose: Fastify route boundaries.
- Contains: `assets.ts`, `chat.ts`, `day-snapshot.ts`, `device.ts`, `history.ts`, `meals.ts`, `observability.ts`, `sse.ts`.
- Key files: `server/routes/chat.ts` for chat JSON/SSE and uploads, `server/routes/device.ts` for onboarding/session/goals, `server/routes/meals.ts` for direct meal edits/deletes, `server/routes/sse.ts` for realtime.

**`server/services/`:**
- Purpose: Reusable domain and persistence logic.
- Contains: Asset storage, chat history, device targets, food logging, meal transactions, corrections, proposals, summaries, history queries, guest sessions, target generation, turn state.
- Key files: `server/services/meal-transactions.ts`, `server/services/food-logging.ts`, `server/services/meal-correction.ts`, `server/services/history-query.ts`, `server/services/guest-session.ts`, `server/services/assets.ts`, `server/services/summary.ts`.

**`server/orchestrator/`:**
- Purpose: AI workflow and tool execution.
- Contains: `index.ts` model/tool loop, `tools.ts` registry and tool contracts, `system-prompt.ts`, mutation receipt renderers, tool-contract helpers, prompt patterns, protein trust, trace hooks, source-text guards.
- Key files: `server/orchestrator/index.ts`, `server/orchestrator/tools.ts`, `server/orchestrator/system-prompt.ts`, `server/orchestrator/mutation-receipts.ts`, `server/orchestrator/llm-trace.ts`.

**`server/db/`:**
- Purpose: SQLite/Drizzle access.
- Contains: `client.ts` DB opener/schema validator, `schema.ts` table definitions, `migrate.ts` migration runner.
- Key files: `server/db/schema.ts`, `server/db/client.ts`, `server/db/migrate.ts`.

**`server/llm/`:**
- Purpose: Runtime and test LLM abstraction.
- Contains: OpenAI adapter, mock provider, provider errors, shared provider/tool-call types.
- Key files: `server/llm/types.ts`, `server/llm/openai.ts`, `server/llm/mock.ts`, `server/llm/errors.ts`.

**`tests/`:**
- Purpose: Unit, integration, and deterministic scenario verification.
- Contains: `tests/unit/*.test.ts`, `tests/integration/*.test.ts`, `tests/harness/scenarios/*.ts`, browser/visual `.mjs` harness scripts, helpers.
- Key files: `tests/harness/app-fixture.ts`, `tests/harness/run.ts`, `tests/harness/scenario-types.ts`, `tests/helpers/spy-hooks.ts`.

**`drizzle/`:**
- Purpose: Generated SQLite migrations and snapshots.
- Contains: SQL files `drizzle/0000_*.sql` through `drizzle/0007_*.sql` and metadata snapshots under `drizzle/meta/`.
- Key files: `drizzle/0002_meal_transaction_v2_foundation.sql`, `drizzle/0004_history_query_hot_path_indexes.sql`, `drizzle/meta/_journal.json`.

**`scripts/`:**
- Purpose: Local verification and generated documentation helpers.
- Contains: Timezone wrapper, release gate, capability/behavior matrix generation, mobile evidence script.
- Key files: `scripts/run-node-with-tz.mjs`, `scripts/release-check.mjs`, `scripts/generate-capability-matrix-doc.mjs`, `scripts/generate-behavior-matrix-doc.mjs`.

**`docs/`:**
- Purpose: Human project documentation, deployment guidance, ADRs, generated matrices.
- Contains: `docs/codex.md`, `docs/deploy/railway-beta.md`, `docs/adr/*.md`, `docs/capability-matrix.md`.
- Key files: `docs/codex.md`, `docs/deploy/railway-beta.md`, `docs/adr/0001-metadata-only-llm-failure-localization.md`, `docs/adr/0002-correction-authority-and-meal-intent.md`.

**`.planning/`:**
- Purpose: GSD workflow state and planning artifacts.
- Contains: Project state, roadmap/milestones, active phases, quick tasks, codebase maps.
- Key files: `.planning/STATE.md`, `.planning/ROADMAP.md`, `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/STRUCTURE.md`.

**`.codex/skills/`:**
- Purpose: Repo-local Codex skill instructions.
- Contains: Nutrition verification, test generation, code review, harness review/scenario creation, Railway smoke, security review, milestone closeout skills.
- Key files: `.codex/skills/nutrition-verify-change/SKILL.md`, `.codex/skills/nutrition-gen-test/SKILL.md`, `.codex/skills/nutrition-new-harness-scenario/SKILL.md`.

## Key File Locations

**Entry Points:**
- `server/index.ts`: Production backend entry, `OpenAIProvider` construction, logging, listen call.
- `server/app.ts`: Testable Fastify app factory and dependency composition root.
- `client/src/main.tsx`: React DOM mount.
- `client/src/App.tsx`: Top-level UI gate for onboarding, recovery, loading, and main layout.
- `tests/harness/run.ts`: Deterministic harness CLI entry.

**Configuration:**
- `package.json`: Yarn scripts and runtime/dev dependency declarations.
- `tsconfig.json`: Strict ESM TypeScript config across `server`, `client/src`, `tests`, and Vite config.
- `client/vite.config.ts`: Vite React/Tailwind config, `/api` dev proxy, `dist/client` build output.
- `drizzle.config.ts`: Drizzle SQLite schema and migration output config.
- `server/config.ts`: Runtime config for model, DB, assets, uploads, guest sessions, port, client dist, timezone.
- `.env`: Present, contains local environment configuration; do not read or quote contents.
- `.env.example`: Present, contains example environment configuration; do not read or quote contents.

**Core Logic:**
- `server/routes/chat.ts`: Chat JSON/SSE transport, upload staging, fallback persistence, cancellation, summary publish timing.
- `server/orchestrator/index.ts`: Model/tool loop, state accumulation, mutation receipts, fallback behavior.
- `server/orchestrator/tools.ts`: Tool contracts, validation, dispatch, controlled replies, redacted logging.
- `server/services/meal-transactions.ts`: Meal transaction/revision writes, optimistic revision preconditions, soft delete.
- `server/services/meal-correction.ts`: Historical meal lookup, pending selection, numeric correction flows.
- `server/services/history-query.ts`: History pagination, search, trends, and day snapshots.
- `server/services/guest-session.ts`: Signed active/resume guest-session tokens.
- `server/realtime/publisher.ts`: In-process SSE fan-out.
- `client/src/store.ts`: Zustand state boundary and localStorage persistence.
- `client/src/api.ts`: REST/streaming client transport and payload normalization.
- `client/src/sse.ts`: EventSource setup and SSE payload guards.
- `client/src/sse-summary-coordinator.ts`: Reconcile meal rows and summary envelopes.

**Testing:**
- `tests/unit/*.test.ts`: Pure logic, UI source contracts, store/transport helpers, service unit behavior.
- `tests/integration/*.test.ts`: Fastify routes, services, SSE, orchestrator, SQLite-backed flows.
- `tests/harness/scenarios/*.ts`: Deterministic boundary scenarios run by `yarn verify:harness -- <scenario>`.
- `tests/harness/scenarios/*.mjs`: Direct browser/visual harness scripts.
- `tests/harness/artifacts/**`: Generated verification evidence; regenerate through matching harness commands.

## Naming Conventions

**Files:**
- Backend route files use lowercase kebab or single words under `server/routes/`: `server/routes/day-snapshot.ts`, `server/routes/chat.ts`.
- Backend services use lowercase kebab or domain nouns under `server/services/`: `server/services/food-logging.ts`, `server/services/meal-transactions.ts`.
- Orchestrator helpers use lowercase kebab by concern: `server/orchestrator/system-prompt.ts`, `server/orchestrator/source-text-guard.ts`.
- React component files use PascalCase: `client/src/components/MainLayout.tsx`, `client/src/components/HistoryScreen.tsx`.
- Client helper files use lowercase kebab or domain nouns: `client/src/meal-edit-payload.ts`, `client/src/lib/onboarding-flow.ts`.
- Tests use `*.test.ts` for unit/integration and scenario names under `tests/harness/scenarios/`: `tests/integration/chat-api.test.ts`, `tests/harness/scenarios/boundary-contracts.ts`.

**Directories:**
- Use domain/layer directories: `server/routes`, `server/services`, `server/orchestrator`, `client/src/components`, `client/src/lib`, `tests/integration`, `tests/harness/scenarios`.
- Onboarding component substeps live under `client/src/components/onboarding/`.
- Generated migrations live under `drizzle/` and generated harness evidence lives under `tests/harness/artifacts/`.

## Where to Add New Code

**New Backend API Feature:**
- Primary code: Add the transport boundary in `server/routes/<feature>.ts`.
- Domain code: Add reusable logic in `server/services/<feature>.ts`.
- Composition: Wire the service and route in `server/app.ts`.
- Tests: Add route/service coverage in `tests/integration/<feature>-api.test.ts`; use real SQLite through `buildApp()`.

**New AI Tool or Orchestrator Behavior:**
- Tool schema/validation/execution: `server/orchestrator/tools.ts`.
- Prompt policy: `server/orchestrator/system-prompt.ts`.
- Reply ownership/receipt copy: `server/orchestrator/mutation-receipts.ts`.
- Provider-agnostic loop changes: `server/orchestrator/index.ts`.
- Tests: Use `tests/integration/orchestrator.test.ts`, chat integration tests, and harness scenarios in `tests/harness/scenarios/` when boundary proof is needed.

**New Persistence Entity or Query:**
- Schema: `server/db/schema.ts`.
- Migration: Generate SQL into `drizzle/` with `yarn db:generate`.
- Service API: Add queries/mutations under `server/services/<domain>.ts`.
- Tests: Add unit coverage for pure projection helpers and integration coverage for SQLite-backed behavior.

**New Client Screen or UI Surface:**
- Component: `client/src/components/<ScreenName>.tsx`.
- Navigation/state: `client/src/store.ts`.
- Layout shell wiring: `client/src/components/MainLayout.tsx`.
- Shared types: `client/src/types.ts`.
- Transport helpers: `client/src/api.ts` or `client/src/sse.ts` only when the screen needs server data.

**New Onboarding Step:**
- Step component: `client/src/components/onboarding/Step<Name>.tsx`.
- Flow helpers: `client/src/lib/onboarding-flow.ts` and `client/src/lib/onboarding-stepper-flow.ts`.
- Intake validation: `client/src/lib/onboarding-intake-validation.ts` and `server/routes/device.ts`.
- Types: `client/src/types.ts` and `server/services/device.ts`.

**New Realtime Event:**
- Server publish method: `server/realtime/publisher.ts`.
- SSE route subscription remains in `server/routes/sse.ts`.
- Client parser/guards: `client/src/sse.ts`.
- Client state reconciliation: Add a coordinator near `client/src/sse-summary-coordinator.ts` or a store action in `client/src/store.ts`.

**New Asset or Upload Behavior:**
- Upload parsing and cleanup: `server/routes/chat.ts`.
- Durable asset persistence and references: `server/services/assets.ts`.
- Asset serving: `server/routes/assets.ts`.
- Client file preparation: `client/src/api.ts`.
- Harness proof: Add/update scenarios under `tests/harness/scenarios/`.

**New Utility:**
- Server date/session/meal-period helpers: `server/lib/*.ts`.
- Client pure UI/domain helpers: `client/src/lib/*.ts`.
- Test-only helpers: `tests/helpers/*.ts` or `tests/harness/*.ts`.
- Shared runtime types should stay scoped to server or client unless both sides already use a generated/duplicated DTO in `client/src/types.ts`.

## Special Directories

**`data/`:**
- Purpose: Local runtime SQLite database, WAL/SHM files, uploads, and assets.
- Generated: Yes, except `data/.gitkeep`.
- Committed: Only `data/.gitkeep` is tracked.

**`dist/`:**
- Purpose: Build output for the Vite client and TypeScript declarations/output when generated.
- Generated: Yes.
- Committed: No.

**`drizzle/`:**
- Purpose: Source-controlled database migrations and schema snapshots generated from `server/db/schema.ts`.
- Generated: Yes, by Drizzle.
- Committed: Yes.

**`tests/harness/artifacts/`:**
- Purpose: Generated deterministic scenario evidence.
- Generated: Yes.
- Committed: No in the current tracked file list; treat as generated evidence and regenerate with the matching harness command.

**`.planning/`:**
- Purpose: GSD workflow state, milestones, phases, and codebase maps.
- Generated: Mixed; created/updated by GSD workflows.
- Committed: Codebase map files are tracked; keep updates scoped to the active GSD task.

**`.codex/skills/`:**
- Purpose: Repo-local Codex workflow instructions.
- Generated: No.
- Committed: Local/project workflow guidance; read `SKILL.md` indexes before task-specific work.

**`.claude/`:**
- Purpose: Compatibility shims and local Claude settings.
- Generated: Mixed.
- Committed: Some compatibility files may be tracked; keep project rules in `AGENTS.md` and `docs/codex.md`.

**`.playwright-mcp/`:**
- Purpose: Local browser automation logs, screenshots, and captured pages.
- Generated: Yes.
- Committed: No in the current tracked file list.

---

*Structure analysis: 2026-05-29*
