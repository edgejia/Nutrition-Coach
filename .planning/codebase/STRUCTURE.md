---
last_mapped_commit: 93f249b78d8215f401f8764c8802a6da47e5e3cd
last_mapped_at: 2026-05-30
---

# Codebase Structure

**Analysis Date:** 2026-05-30

## Directory Layout

```text
Nutrition-Coach/
├── .codex/skills/          # Project-specific Codex skill indexes for verification, reviews, harnesses, and release smoke
├── .planning/              # GSD planning state, roadmap, milestones, quick tasks, and codebase maps
├── chatgpt/                # External ChatGPT project notes and wireframes
├── client/                 # Vite React frontend application
│   ├── index.html          # Vite HTML entry
│   ├── public/             # Static public assets for the client build
│   ├── src/                # React, Zustand, client API, SSE, lib helpers, contracts, and types
│   └── vite.config.ts      # Client build/dev config
├── data/                   # Local SQLite database, WAL/SHM files, durable assets, and upload staging
├── dist/                   # Built output, including `dist/client` when `yarn build` runs
├── docs/                   # Repo documentation, ADRs, deployment notes, and research maps
├── drizzle/                # Generated Drizzle SQL migrations and metadata snapshots
├── scripts/                # Repo utility CLIs and release/check runners
├── server/                 # Fastify backend, DB, services, routes, orchestrator, LLM, realtime, observability
├── tests/                  # Unit, integration, helper, and deterministic harness tests
├── AGENTS.md               # Local agent workflow, architecture, testing, and promotion rules
├── Dockerfile              # Container image build entry
├── drizzle.config.ts       # Drizzle Kit config
├── package.json            # Yarn scripts and dependencies
├── tsconfig.json           # Shared TypeScript config
└── yarn.lock               # Yarn lockfile
```

## Directory Purposes

**`.codex/skills/`:**
- Purpose: Project-specific Codex workflow instructions for Nutrition Coach work.
- Contains: Skill directories with `SKILL.md` indexes for verification, test generation, code/security/harness reviews, Railway smoke, harness scenarios, and milestone closeout.
- Key files: `.codex/skills/nutrition-verify-change/SKILL.md`, `.codex/skills/nutrition-gen-test/SKILL.md`, `.codex/skills/nutrition-code-review/SKILL.md`, `.codex/skills/nutrition-security-review/SKILL.md`, `.codex/skills/nutrition-new-harness-scenario/SKILL.md`, `.codex/skills/nutrition-harness-review/SKILL.md`, `.codex/skills/nutrition-railway-smoke/SKILL.md`, `.codex/skills/nutrition-milestone-closeout/SKILL.md`

**`.planning/`:**
- Purpose: GSD workflow artifacts and active project planning state.
- Contains: Milestones, phases, quick task plans, roadmap/state, codebase maps, research, todos, workstreams.
- Key files: `.planning/PROJECT.md`, `.planning/ROADMAP.md`, `.planning/STATE.md`, `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/STRUCTURE.md`

**`client/`:**
- Purpose: Frontend app packaged by Vite and served either by Vite dev server or Fastify static serving from `dist/client`.
- Contains: `client/src/` application source, public assets, Vite config, HTML entry.
- Key files: `client/src/main.tsx`, `client/src/App.tsx`, `client/src/store.ts`, `client/src/api.ts`, `client/src/sse.ts`, `client/vite.config.ts`

**`client/src/components/`:**
- Purpose: React UI components and screens.
- Contains: Primary screens (`HomeScreen`, `ChatPanel`, `HistoryScreen`), layout shell, onboarding steps, settings, meal edit/detail screens, display primitives and icons.
- Key files: `client/src/components/MainLayout.tsx`, `client/src/components/ChatPanel.tsx`, `client/src/components/HomeScreen.tsx`, `client/src/components/HistoryScreen.tsx`, `client/src/components/MealEditScreen.tsx`, `client/src/components/onboarding/OnboardingStepper.tsx`

**`client/src/lib/`:**
- Purpose: Frontend pure helpers and UI flow utilities.
- Contains: Time/date helpers, onboarding validation/flow, history week utilities, chat scroll logic, markdown rendering helpers, target input helpers.
- Key files: `client/src/lib/time.ts`, `client/src/lib/history-week.ts`, `client/src/lib/chat-scroll.ts`, `client/src/lib/onboarding-intake-validation.ts`, `client/src/lib/onboarding-stepper-flow.ts`

**`client/src/contracts/`:**
- Purpose: Client-side product contract data that is validated by source-scan tests and generated docs.
- Contains: Capability matrix contract source.
- Key files: `client/src/contracts/capability-matrix.ts`

**`server/`:**
- Purpose: Fastify backend and application core.
- Contains: Composition root, config, routes, services, orchestrator, LLM providers, DB, realtime publisher, observability, shared libs.
- Key files: `server/index.ts`, `server/app.ts`, `server/config.ts`

**`server/routes/`:**
- Purpose: HTTP and SSE transport boundaries.
- Contains: Route registration functions for device/session, chat, meals, day snapshot, history, assets, observability, and SSE.
- Key files: `server/routes/device.ts`, `server/routes/chat.ts`, `server/routes/meals.ts`, `server/routes/history.ts`, `server/routes/sse.ts`, `server/routes/assets.ts`

**`server/services/`:**
- Purpose: Reusable domain and persistence logic.
- Contains: Device, chat, food logging, meal transactions/history/display/correction, meal numeric proposals, summaries, history query, asset, guest session, target generation, turn state, goal proposal services.
- Key files: `server/services/device.ts`, `server/services/chat.ts`, `server/services/food-logging.ts`, `server/services/meal-transactions.ts`, `server/services/meal-correction.ts`, `server/services/meal-numeric-proposals.ts`, `server/services/history-query.ts`, `server/services/assets.ts`, `server/services/guest-session.ts`

**`server/orchestrator/`:**
- Purpose: Model workflow, tool definitions, prompt construction, mutation receipts, fallback behavior, trace hooks, and guard logic.
- Contains: Orchestrator loop, tool contracts, tool registry/execution, system prompt, history loader, source-text guard, numeric authority guard, protein trust, LLM trace, mutation effects/receipts, and structured clarification fact adapters.
- Key files: `server/orchestrator/index.ts`, `server/orchestrator/tools.ts`, `server/orchestrator/tool-contract.ts`, `server/orchestrator/meal-numeric-authority.ts`, `server/orchestrator/mutation-receipts.ts`, `server/orchestrator/system-prompt.ts`, `server/orchestrator/history.ts`, `server/orchestrator/hooks.ts`

**`server/db/`:**
- Purpose: SQLite/Drizzle persistence setup.
- Contains: Drizzle schema, DB factory, migration runner.
- Key files: `server/db/schema.ts`, `server/db/client.ts`, `server/db/migrate.ts`

**`server/lib/`:**
- Purpose: Backend shared helpers with cross-route contracts.
- Contains: Timezone/date utilities, historical date parsing, explicit meal-period normalization/extraction, guest-session resolution.
- Key files: `server/lib/time.ts`, `server/lib/historical-date.ts`, `server/lib/meal-period.ts`, `server/lib/guest-session-resolver.ts`

**`server/llm/`:**
- Purpose: Runtime and test LLM provider abstractions.
- Contains: Shared provider types, OpenAI provider, mock provider, provider error metadata.
- Key files: `server/llm/types.ts`, `server/llm/openai.ts`, `server/llm/mock.ts`, `server/llm/errors.ts`

**`server/realtime/`:**
- Purpose: In-memory SSE fan-out.
- Contains: Publisher for `daily_summary` and `goals_update` events.
- Key files: `server/realtime/publisher.ts`

**`server/observability/`:**
- Purpose: Structured event helpers for server and orchestrator logs.
- Contains: Event payload builders/loggers used by routes and orchestrator hooks.
- Key files: `server/observability/events.ts`

**`tests/unit/`:**
- Purpose: Pure logic, contracts, components rendered to static markup, client helper, store, service, and orchestrator unit coverage.
- Contains: Node built-in test files named `*.test.ts`.
- Key files: `tests/unit/store.test.ts`, `tests/unit/orchestrator.test.ts`, `tests/unit/tools.test.ts`, `tests/unit/meal-transactions.test.ts`, `tests/unit/sse-client.test.ts`

**`tests/integration/`:**
- Purpose: Fastify routes, SSE transport, orchestrator boundaries, SQLite-backed flows, and beta web-app serving coverage.
- Contains: Node built-in integration tests using real app fixtures and real SQLite.
- Key files: `tests/integration/chat-api.test.ts`, `tests/integration/chat-streaming.test.ts`, `tests/integration/meals-api.test.ts`, `tests/integration/history-api.test.ts`, `tests/integration/sse.test.ts`, `tests/integration/web-app.test.ts`

**`tests/harness/`:**
- Purpose: Deterministic boundary verification with generated artifacts.
- Contains: Scenario runner, app fixture, scenario types, artifact writers, LLM/harness helpers, TypeScript scenarios, visual/browser `.mjs` scenarios, generated artifacts.
- Key files: `tests/harness/run.ts`, `tests/harness/app-fixture.ts`, `tests/harness/scenario-types.ts`, `tests/harness/scenarios/boundary-contracts.ts`, `tests/harness/scenarios/text-log.ts`, `tests/harness/artifacts.ts`

**`drizzle/`:**
- Purpose: Generated database migration SQL and metadata.
- Contains: Numbered migration SQL files and `drizzle/meta/*.json` snapshots.
- Key files: `drizzle/0000_brainy_rocket_racer.sql`, `drizzle/0006_colossal_selene.sql`, `drizzle/meta/_journal.json`

**`scripts/`:**
- Purpose: Repo automation scripts.
- Contains: Release check runner, timezone wrapper, matrix doc generators, mobile evidence script.
- Key files: `scripts/run-node-with-tz.mjs`, `scripts/release-check.mjs`, `scripts/generate-capability-matrix-doc.mjs`, `scripts/generate-behavior-matrix-doc.mjs`

**`docs/`:**
- Purpose: User/developer documentation, deployment procedures, research maps, and ADRs.
- Contains: Deployment checklist, Codex workflow notes, ADRs, generated/research documentation.
- Key files: `docs/codex.md`, `docs/deploy/railway-beta.md`, `docs/adr/0001-metadata-only-llm-failure-localization.md`, `docs/research/Backend-flow/00-overview.md`, `docs/research/AI-flow/04-orchestrator-index.md`

**`data/`:**
- Purpose: Local runtime persistence for development.
- Contains: SQLite database/WAL files, durable assets, staged uploads, UAT asset folders.
- Key files: `data/nutrition.db`, `data/assets/meal-images/`, `data/uploads-staging/`

## Key File Locations

**Entry Points:**
- `server/index.ts`: Production server entry; creates `OpenAIProvider`, builds app, listens on configured port.
- `server/app.ts`: Backend composition root; wire new services, routes, publisher, orchestrator dependencies, and static serving here.
- `client/src/main.tsx`: React DOM entry.
- `client/src/App.tsx`: Client session/onboarding/main-layout gate.
- `tests/harness/run.ts`: Deterministic harness CLI entry.

**Configuration:**
- `package.json`: Yarn scripts, ESM package type, runtime/dev dependencies.
- `tsconfig.json`: Shared strict TypeScript config for server, tests, client, and Vite config.
- `client/vite.config.ts`: Vite root, React/Tailwind plugins, dev proxy, and client output directory.
- `server/config.ts`: Centralized server environment configuration.
- `drizzle.config.ts`: Drizzle Kit SQLite schema/migration configuration.
- `.env`: Present - contains environment configuration and must not be read or quoted.
- `.env.example`: Example environment configuration.
- `AGENTS.md`: Local workflow, architecture, verification, and branch/promotion rules.

**Core Logic:**
- `server/routes/chat.ts`: Chat JSON/SSE route, upload staging, durable asset creation, active turn cancellation, SSE terminal events, route fallbacks.
- `server/orchestrator/index.ts`: Model loop, prompt/history/tool orchestration, fallback behavior, mutation receipt handling.
- `server/orchestrator/tools.ts`: LLM tool definitions and tool-side domain execution.
- `server/orchestrator/tool-contract.ts`: Tool validation/source guard/controlled failure runner.
- `server/services/meal-transactions.ts`: Revisioned meal writes, optimistic preconditions, asset references, soft deletes.
- `server/services/history-query.ts`: History filtering, pagination, trends, and DTO projection.
- `server/services/guest-session.ts`: HMAC signed guest-session cookies.
- `server/lib/guest-session-resolver.ts`: Protected-route authorization helper.
- `client/src/store.ts`: Client state boundary.
- `client/src/api.ts`: Client HTTP and chat stream transport boundary.
- `client/src/sse.ts`: Client EventSource boundary.
- `client/src/components/MainLayout.tsx`: Main app shell, SSE subscription, day rollover refresh, and screen routing.

**Testing:**
- `tests/unit/*.test.ts`: Unit and contract tests.
- `tests/integration/*.test.ts`: App-level Fastify/SQLite integration tests.
- `tests/harness/scenarios/*.ts`: Deterministic proof scenarios run by `yarn verify:harness -- <scenario>`.
- `tests/harness/scenarios/*.mjs`: Direct browser/visual harness scripts; follow artifact README or phase docs rather than `yarn verify:harness`.
- `tests/helpers/spy-hooks.ts`: Typed orchestrator hook spies.
- `tests/harness/artifacts/**`: Generated verification evidence; regenerate, do not hand-edit.

## Naming Conventions

**Files:**
- Backend route files use kebab-case matching API domains: `server/routes/day-snapshot.ts`, `server/routes/assets.ts`, `server/routes/observability.ts`.
- Backend service files use kebab-case domain names and export `createXService()`: `server/services/food-logging.ts`, `server/services/meal-transactions.ts`, `server/services/history-query.ts`.
- Orchestrator modules use kebab-case for focused subdomains: `server/orchestrator/tool-contract.ts`, `server/orchestrator/source-text-guard.ts`, `server/orchestrator/mutation-receipts.ts`.
- React component files use PascalCase: `client/src/components/ChatPanel.tsx`, `client/src/components/MealTimeline.tsx`, `client/src/components/onboarding/StepGoal.tsx`.
- Client helper files use kebab-case or concise domain names: `client/src/lib/chat-scroll.ts`, `client/src/lib/history-week.ts`, `client/src/sse-summary-coordinator.ts`.
- Tests use `*.test.ts`; integration tests sometimes include `.integration.test.ts` for cross-boundary chat flows: `tests/integration/chat-goal-update.integration.test.ts`.
- Harness scenarios use kebab-case: `tests/harness/scenarios/guest-session-hardening.ts`, `tests/harness/scenarios/meal-image-continuity.ts`.

**Directories:**
- Runtime backend code lives under `server/` by architectural layer (`routes`, `services`, `orchestrator`, `db`, `llm`, `lib`, `realtime`, `observability`).
- Runtime frontend code lives under `client/src/` by UI boundary (`components`, `lib`, `contracts`) plus top-level transport/state files.
- Tests are split by verification level: `tests/unit/`, `tests/integration/`, `tests/harness/`.
- Generated SQL migrations live under `drizzle/`; generated harness proof artifacts live under `tests/harness/artifacts/`.

## Where to Add New Code

**New API Route:**
- Primary code: Add `server/routes/<domain>.ts` with `register<Domain>Routes(app, deps)`.
- Wiring: Register it in `server/app.ts` and pass only the required services.
- Auth: Use `server/lib/guest-session-resolver.ts` for browser-protected routes.
- Tests: Add route coverage in `tests/integration/<domain>-api.test.ts`; use `buildApp()` with `MockLLMProvider` or targeted test providers.

**New Domain Service:**
- Primary code: Add `server/services/<domain>.ts` with a `create<Domain>Service(db, opts?)` factory.
- Wiring: Instantiate it in `server/app.ts`; expose it through `AppServices` only when harness/integration tests need in-process access.
- Tests: Add focused tests in `tests/unit/<domain>.test.ts` for pure service behavior or `tests/integration/<domain>-api.test.ts` for route-backed behavior.

**New Orchestrator Tool:**
- Primary code: Add contract, schema, definition, and executor path in `server/orchestrator/tools.ts`; use `runContract()` from `server/orchestrator/tool-contract.ts`.
- Prompt: Update `server/orchestrator/system-prompt.ts` only when model routing instructions must change.
- Tests: Add `tests/unit/tools.test.ts` / `tests/unit/tool-contract.test.ts` coverage and integration or harness coverage when the tool mutates state.

**New LLM Provider Behavior:**
- Primary code: Update shared provider types in `server/llm/types.ts` and implementations in `server/llm/openai.ts` / `server/llm/mock.ts`.
- Wiring: Keep provider creation at `server/index.ts` or tests; do not instantiate runtime providers in services.
- Tests: Add provider-specific unit tests under `tests/unit/openai-provider.test.ts` or orchestrator integration tests under `tests/integration/orchestrator.test.ts`.

**New Client Screen:**
- Primary code: Add a PascalCase component under `client/src/components/`.
- State: Add shared app state/actions to `client/src/store.ts`; use local component state only for screen-local UI details.
- Navigation: Wire top-level screen routing in `client/src/components/MainLayout.tsx` and tab affordances in `client/src/components/BottomTabBar.tsx` when applicable.
- Tests: Add markup/source contract tests under `tests/unit/<screen-or-contract>.test.ts`.

**New Client Transport Function:**
- Primary code: Add `fetch()` wrapper and response shape guards/normalizers in `client/src/api.ts`.
- Realtime: Add EventSource event parsing to `client/src/sse.ts` and coordination logic to `client/src/sse-summary-coordinator.ts` when events affect summary/meals/targets.
- Tests: Add `tests/unit/api-client.test.ts`, `tests/unit/sse-client.test.ts`, or integration tests for matching server routes.

**New Shared Client Helper:**
- Primary code: Add pure helpers under `client/src/lib/<domain>.ts`.
- Tests: Add `tests/unit/<domain>.test.ts` or source-contract tests if behavior is UI contract driven.

**New Database Table or Index:**
- Schema: Update `server/db/schema.ts`.
- Migration: Generate SQL under `drizzle/` with `yarn db:generate`; apply with `yarn db:migrate`.
- Services: Access the table through `server/services/*.ts`, not routes/components.
- Tests: Add `tests/unit/db-migrate.test.ts` coverage for migration-sensitive behavior and integration tests using real SQLite.

**New Harness Scenario:**
- Primary code: Add `tests/harness/scenarios/<scenario>.ts` exporting a `VerificationScenario`.
- Fixture: Use `createScenarioApp()` from `tests/harness/app-fixture.ts` or the runner-provided app context; close fixtures in `finally` when manually created.
- Artifacts: Let `tests/harness/artifacts.ts` write evidence under `tests/harness/artifacts/<scenario>/latest/`.
- Verification: Run `yarn verify:harness -- <scenario>` for TypeScript scenarios.

**Utilities:**
- Backend shared helpers: `server/lib/<domain>.ts`
- Frontend shared helpers: `client/src/lib/<domain>.ts`
- Repo scripts: `scripts/<task>.mjs`
- Test helpers: `tests/helpers/<domain>.ts` or `tests/harness/<domain>.ts`

## Special Directories

**`.planning/`:**
- Purpose: GSD workflow artifacts consumed by planning/execution agents.
- Generated: Mixed; workflow-generated and manually reviewed planning files.
- Committed: Project-dependent; treat active GSD artifacts as first-class workflow outputs.

**`.codex/skills/`:**
- Purpose: Local project skill instructions used by Codex.
- Generated: No.
- Committed: Local/project-specific according to repo policy; do not duplicate policy into legacy shims.

**`.claude/`:**
- Purpose: Legacy Claude compatibility shims and settings.
- Generated: No.
- Committed: Compatibility-only; source of truth is `AGENTS.md` and `docs/codex.md`.

**`data/`:**
- Purpose: Local runtime database, WAL files, assets, and staged uploads.
- Generated: Yes.
- Committed: Only placeholders or intentional fixtures; runtime DB/assets should generally remain local.

**`dist/`:**
- Purpose: Build output, including `dist/client` served by Fastify when present.
- Generated: Yes.
- Committed: No for normal development output.

**`drizzle/`:**
- Purpose: Generated SQL migrations and metadata snapshots.
- Generated: Yes, via Drizzle Kit.
- Committed: Yes; migrations are source-controlled schema history.

**`tests/harness/artifacts/`:**
- Purpose: Generated deterministic verification evidence.
- Generated: Yes, via harness commands.
- Committed: Yes when evidence is intentional for the phase; do not hand-edit.

**`.playwright-mcp/`:**
- Purpose: Local browser automation logs, screenshots, and smoke artifacts.
- Generated: Yes.
- Committed: No for routine local artifacts.

---

*Structure analysis: 2026-05-26*
