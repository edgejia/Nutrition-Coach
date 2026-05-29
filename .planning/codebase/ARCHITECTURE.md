<!-- refreshed: 2026-05-30 -->
# Architecture

**Analysis Date:** 2026-05-30

## System Overview

```text
┌─────────────────────────────────────────────────────────────┐
│                 React Client + Same-Origin API              │
├──────────────────┬──────────────────┬───────────────────────┤
│  App shell/state │  Transport APIs  │  Screen components    │
│ `client/src/App.tsx` │ `client/src/api.ts` │ `client/src/components/` │
│ `client/src/store.ts` │ `client/src/sse.ts` │ `client/src/components/MainLayout.tsx` │
└────────┬─────────┴────────┬─────────┴──────────┬────────────┘
         │                  │                     │
         ▼                  ▼                     ▼
┌─────────────────────────────────────────────────────────────┐
│                    Fastify HTTP Boundary                    │
│ `server/index.ts` -> `server/app.ts` -> `server/routes/*.ts` │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│            Domain Services + Orchestrator Runtime           │
│ `server/services/*.ts`  `server/orchestrator/*.ts`          │
│ `server/realtime/publisher.ts` `server/lib/*.ts`            │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│        SQLite, Durable Assets, External LLM Provider        │
│ `server/db/schema.ts` `drizzle/` `data/assets/`             │
│ `server/llm/openai.ts`                                     │
└─────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Server process entry | Creates the production Fastify app with `OpenAIProvider`, logger redaction, configured port, and `0.0.0.0` listen host. | `server/index.ts` |
| App composition root | Creates the SQLite DB, services, orchestrator, realtime publisher, Fastify plugins, route registrations, and optional static client serving. Add new route/service wiring here. | `server/app.ts` |
| Server config | Centralizes all server `process.env` reads and defaults for model, DB path, asset paths, guest-session cookies, runtime port, and timezone contract. | `server/config.ts` |
| HTTP routes | Own request validation, cookie-backed auth resolution, transport-specific response shaping, SSE framing, and route-level fallbacks. | `server/routes/*.ts` |
| Guest-session resolver | Converts active/resume cookies into an authorized `deviceId` and clears invalid cookies. Protected routes should use this helper instead of raw `deviceId` inputs. | `server/lib/guest-session-resolver.ts` |
| Domain services | Own reusable persistence and domain operations over Drizzle/better-sqlite3. | `server/services/*.ts` |
| Meal transaction core | Owns revisioned meal writes, optimistic revision preconditions, soft deletes, nullable explicit meal-period authority, and asset references. | `server/services/meal-transactions.ts`, `server/lib/meal-period.ts` |
| Orchestrator | Owns model prompt construction, history loading, tool-call loop, controlled fallbacks, streaming handoff, and mutation receipt rules. | `server/orchestrator/index.ts` |
| Tool contracts | Own LLM-facing tool schemas, Zod validation, source-text guard execution, structured clarification facts, redacted logging summaries, and controlled tool failure mapping. | `server/orchestrator/tool-contract.ts`, `server/orchestrator/tools.ts` |
| Correction authority | Owns backend evidence checks for meal numeric edits, meal numeric proposals, target ranking, rendered clarification options, and stale selection recovery. | `server/orchestrator/meal-numeric-authority.ts`, `server/services/meal-numeric-proposals.ts`, `server/services/meal-correction.ts`, `server/orchestrator/mutation-receipts.ts` |
| LLM providers | Define runtime and test model-provider adapters. Runtime uses OpenAI; tests and harnesses inject deterministic providers. | `server/llm/openai.ts`, `server/llm/mock.ts`, `server/llm/types.ts` |
| Realtime publisher | Owns in-memory per-device SSE subscribers and emits `daily_summary` / `goals_update` events. | `server/realtime/publisher.ts` |
| Database schema | Defines SQLite tables for devices, chat messages, assets, revisioned meals, asset references, and turn states. | `server/db/schema.ts` |
| Migrations | Applies Drizzle migrations and reconciles partial migration state. | `server/db/migrate.ts`, `drizzle/` |
| Client state boundary | Owns Zustand state, localStorage persistence, guest-session recovery state, provisional chat bubble state, daily-summary guard, and navigation state. | `client/src/store.ts` |
| Client transport | Owns `fetch()` wrappers, response normalization, image compression, SSE stream parsing, and typed client-side errors. | `client/src/api.ts` |
| Client app shell | Gates onboarding/session recovery/main UI and wires viewport shell behavior, SSE subscription, meal refresh, and day rollover. | `client/src/App.tsx`, `client/src/components/MainLayout.tsx` |
| Deterministic harness | Boots the real app against in-memory SQLite and deterministic LLM providers, then writes proof artifacts. | `tests/harness/app-fixture.ts`, `tests/harness/run.ts`, `tests/harness/scenarios/*.ts` |

## Pattern Overview

**Overall:** Layered TypeScript monolith with dependency-injected Fastify backend, Drizzle SQLite persistence, LLM orchestration as an application service, and a React/Zustand same-origin client.

**Key Characteristics:**
- `server/app.ts` is the only backend composition root: instantiate DB, services, `RealtimePublisher`, and `createOrchestrator()` there.
- `server/routes/*.ts` own HTTP/SSE transport behavior and call injected services; keep persistence logic in `server/services/*.ts`.
- `server/orchestrator/index.ts` controls the LLM loop and uses `server/orchestrator/tools.ts` / `server/orchestrator/tool-contract.ts` for all model tool side effects.
- v2.4 clarification-only tool results terminate through renderer-owned controlled replies; `ToolExecutionResult.clarification` carries allowlisted facts and avoids serialized JSON reparsing in `server/orchestrator/index.ts`.
- v2.4 meal correction authority is backend-owned: explicit numeric evidence is checked in `server/orchestrator/meal-numeric-authority.ts`, backend proposal state lives in `server/services/meal-numeric-proposals.ts`, and correction target selection/rendered options live in `server/services/meal-correction.ts`.
- `client/src/store.ts` is the single client state boundary; components select actions/state from it and use `client/src/api.ts` / `client/src/sse.ts` for transport.
- Local TypeScript imports use explicit `.js` specifiers throughout `server/`, `client/src/`, and `tests/`.

## Layers

**Client UI Layer:**
- Purpose: Render onboarding, home, chat, history, settings, and meal-edit screens.
- Location: `client/src/components/`
- Contains: React components, screen shells, icons/primitives, onboarding step components.
- Depends on: `client/src/store.ts`, `client/src/api.ts`, `client/src/sse.ts`, `client/src/lib/*.ts`, `client/src/types.ts`
- Used by: `client/src/App.tsx`, `client/src/main.tsx`

**Client State and Transport Layer:**
- Purpose: Hold app state, normalize server payloads, parse chat streaming events, manage guest-session recovery, and sync realtime summary/goal events.
- Location: `client/src/store.ts`, `client/src/api.ts`, `client/src/sse.ts`, `client/src/sse-summary-coordinator.ts`
- Contains: Zustand store actions, `fetch()` wrappers, EventSource connection management, stream parser callbacks, response guards.
- Depends on: Browser APIs, `client/src/types.ts`, `client/src/lib/*.ts`
- Used by: `client/src/components/*.tsx`, `client/src/App.tsx`

**HTTP Route Layer:**
- Purpose: Validate request bodies/query params, resolve signed guest sessions, shape responses, own SSE framing, and translate domain errors to HTTP status codes.
- Location: `server/routes/`
- Contains: `registerDeviceRoutes()`, `registerChatRoutes()`, `registerMealRoutes()`, `registerHistoryRoutes()`, `registerDaySnapshotRoutes()`, `registerAssetRoutes()`, `registerSSERoutes()`, `registerObservabilityRoutes()`.
- Depends on: Injected services from `server/app.ts`, `server/lib/guest-session-resolver.ts`, `server/realtime/publisher.ts`, route-local validation helpers.
- Used by: `server/app.ts`

**Domain Service Layer:**
- Purpose: Persist and query devices, chat messages, assets, meal transactions, summaries, history, target generation, guest sessions, and turn state.
- Location: `server/services/`
- Contains: Factory functions such as `createDeviceService()`, `createFoodLoggingService()`, `createSummaryService()`, `createHistoryQueryService()`, `createAssetService()`, `createGuestSessionService()`.
- Depends on: `server/db/client.ts`, `server/db/schema.ts`, `server/lib/time.ts`, Drizzle query builders, selected raw better-sqlite3 hot-path queries.
- Used by: `server/routes/*.ts`, `server/orchestrator/*.ts`, `tests/*`

**Orchestrator Layer:**
- Purpose: Translate user turns into model messages, execute LLM tools, record tool summaries, detect unsafe model behavior, and return JSON or streamable replies.
- Location: `server/orchestrator/`
- Contains: `createOrchestrator()`, system prompt rendering, history loading, tool registry/contracts, mutation receipts, structured clarification facts, hooks, LLM trace support, source-text and numeric authority guards.
- Depends on: Injected `LLMProvider`, chat/summary/food/device/goal services, `RealtimePublisher`, `server/lib/time.ts`.
- Used by: `server/routes/chat.ts`, integration tests, harness scenarios.

**Persistence Layer:**
- Purpose: Store devices, chat history, assets, meal transactions/revisions/items, asset references, and turn state in SQLite.
- Location: `server/db/`, `drizzle/`, `data/`
- Contains: Drizzle schema, migration runner, generated SQL migrations, local SQLite files and asset directories.
- Depends on: `better-sqlite3`, `drizzle-orm`, process configuration in `server/config.ts`.
- Used by: `server/services/*.ts`, tests using `:memory:` fixtures.

**Observability and Verification Layer:**
- Purpose: Emit structured route/orchestrator events and prove boundary contracts with unit, integration, and harness tests.
- Location: `server/observability/events.ts`, `tests/unit/`, `tests/integration/`, `tests/harness/`
- Contains: structured event helpers, Node test suites, app fixtures, deterministic scenario runner, generated artifact output.
- Depends on: Node built-in `node:test`, real Fastify app, real SQLite, injected mock/harness LLM providers.
- Used by: GSD verification workflows and release checks.

## Data Flow

### Primary Chat Request Path

1. Client sends multipart chat with `Accept: text/event-stream` from `sendMessageStream()` (`client/src/api.ts:609`).
2. `registerChatRoutes()` resolves the signed guest session, parses multipart input, stores a turn entry in `activeChatTurns`, opens the SSE response, and schedules orchestrator work (`server/routes/chat.ts:1181`, `server/routes/chat.ts:1511`).
3. `handleOrchestratorSSE()` creates durable assets, calls `orchestrator.handleMessage()`, streams `status` / `chunk` / `done` events, publishes summary events after mutations, and always cleans staged uploads (`server/routes/chat.ts:787`, `server/routes/chat.ts:906`, `server/routes/chat.ts:991`, `server/routes/chat.ts:1126`).
4. `createOrchestrator().handleMessage()` loads device and compressed history, saves the user message, builds the system prompt and tool definitions, and runs up to `MAX_ROUNDS = 3` model/tool rounds (`server/orchestrator/index.ts:606`, `server/orchestrator/index.ts:621`, `server/orchestrator/index.ts:630`, `server/orchestrator/index.ts:717`).
5. Tool calls run through contract validation and service execution before tool summaries are saved to chat history (`server/orchestrator/tool-contract.ts:111`, `server/orchestrator/index.ts:932`, `server/orchestrator/index.ts:973`).
6. Client parses SSE frames, commits the provisional assistant bubble, updates daily summary/targets, and refreshes meals when needed (`client/src/api.ts:661`, `client/src/api.ts:703`, `client/src/store.ts:321`, `client/src/components/ChatPanel.tsx:96`).

### v2.4 Meal Correction Authority Path

1. `find_meals` resolves correction targets through evidence tiers in `server/services/meal-correction.ts`: explicit date, pending/current-turn evidence, food labels, persisted meal period, inferred fallback, and recency tie-breaks.
2. Ambiguous targets return backend-rendered numbered options and store exact rendered option facts for follow-up validation.
3. Numeric `update_meal` calls require explicit current-turn numeric evidence from `server/orchestrator/meal-numeric-authority.ts`; vague numeric requests create renderer-owned clarification/proposal copy instead of mutation facts.
4. Approved backend meal numeric proposals are revision-scoped and single-use through `server/services/meal-numeric-proposals.ts`.
5. Stale selections and stale proposal approvals fail closed through existing revision preconditions and clarification copy without `daily_summary` publication.

### JSON Chat Fallback Path

1. Non-SSE chat callers omit `Accept: text/event-stream`; `server/routes/chat.ts` branches into the JSON path (`server/routes/chat.ts:1207`).
2. The JSON path still uses the same multipart parsing, durable asset creation, orchestrator, reply sanitization, summary publication, and cleanup logic (`server/routes/chat.ts:1297`, `server/routes/chat.ts:1303`, `server/routes/chat.ts:1365`, `server/routes/chat.ts:1498`).
3. Client `sendMessage()` normalizes the returned reply, logged meal receipt, summary outcome, and asset URLs (`client/src/api.ts:539`, `client/src/api.ts:451`).

### Guest Session and Protected API Path

1. Onboarding submits to `POST /api/device`, which validates goal/intake, creates a device, and issues active/resume cookies (`server/routes/device.ts:370`, `server/routes/device.ts:396`, `server/routes/device.ts:407`).
2. Returning browser sessions call `POST /api/device/session`; active cookies are accepted, resume cookies are reissued, and legacy localStorage `deviceId` can migrate once (`server/routes/device.ts:411`, `server/routes/device.ts:419`, `server/routes/device.ts:429`, `server/routes/device.ts:444`).
3. Protected routes call `resolveGuestSession()` and use its `deviceId`; invalid cookies trigger `clearSessionCookies()` (`server/lib/guest-session-resolver.ts:32`, `server/routes/meals.ts:133`, `server/routes/sse.ts:21`).
4. Client `useStore.bootstrapGuestSession()` and `recoverGuestSession()` update localStorage and recovery state from `/api/device/session` (`client/src/store.ts:188`, `client/src/store.ts:214`, `client/src/api.ts:503`).

### Meal Mutation and Realtime Summary Path

1. REST meal edits/deletes resolve the guest session and validate revision preconditions (`server/routes/meals.ts:171`, `server/routes/meals.ts:273`, `server/services/meal-transactions.ts:220`).
2. `createFoodLoggingService()` delegates mutation writes to `createMealTransactionsService()`, which creates revisioned records and asset references inside SQLite transactions (`server/services/food-logging.ts:46`, `server/services/meal-transactions.ts:334`, `server/services/meal-transactions.ts:347`).
3. Routes recompute summary outcome with `buildSummaryOutcomeAfterMealCommit()` and publish a `daily_summary` SSE envelope through `RealtimePublisher` (`server/routes/meals.ts:236`, `server/routes/meals.ts:311`, `server/realtime/publisher.ts:58`).
4. Client `connectSSE()` validates `daily_summary` / `goals_update` frames, and `createSSESummaryCoordinator()` reloads today's meals before committing same-day summaries (`client/src/sse.ts:67`, `client/src/sse-summary-coordinator.ts:23`, `client/src/sse-summary-coordinator.ts:50`).

### History and Day Snapshot Path

1. Client history screens call `getHistoryTrends()`, `getHistoryDaySnapshot()`, `getDaySnapshot()`, and `getMeals()` from `client/src/api.ts` (`client/src/api.ts:767`, `client/src/api.ts:790`, `client/src/api.ts:848`, `client/src/api.ts:856`).
2. `server/routes/history.ts` validates flat query parameters and delegates to `createHistoryQueryService()` (`server/routes/history.ts:142`, `server/routes/history.ts:179`, `server/routes/history.ts:195`).
3. `server/services/history-query.ts` validates date keys, encodes/decodes cursors, projects revisioned meal DTOs, and derives trends from current meal revisions (`server/services/history-query.ts:131`, `server/services/history-query.ts:159`, `server/services/history-query.ts:351`).
4. `server/routes/day-snapshot.ts` combines summary and meal rows for a specific date through `createDaySnapshotService()` (`server/routes/day-snapshot.ts:17`, `server/routes/day-snapshot.ts:36`).

**State Management:**
- Server request state is per request except `server/routes/chat.ts` module-level `activeChatTurns`, which tracks cancellable in-flight SSE chat turns by `deviceId:turnId`.
- Realtime server state is an in-memory `Map<string, FastifyReply[]>` inside `server/realtime/publisher.ts`.
- Durable application state is SQLite via `server/db/schema.ts` and durable image files under `data/assets/`.
- Client app state is centralized in Zustand in `client/src/store.ts`; persistent identity/targets mirror to browser `localStorage`, while signed ownership lives in HttpOnly cookies.

## Key Abstractions

**`buildApp()` Composition Root:**
- Purpose: Assemble DB, services, orchestrator, plugins, routes, static serving, and test hooks.
- Examples: `server/app.ts`, `tests/harness/app-fixture.ts`, `tests/integration/*.test.ts`
- Pattern: Dependency injection via factory-created services and `AppOptions`; production injects `OpenAIProvider`, tests inject `MockLLMProvider` or harness providers.

**Route Registration Functions:**
- Purpose: Keep each HTTP/SSE surface isolated behind `register*Routes(app, deps)`.
- Examples: `server/routes/chat.ts`, `server/routes/device.ts`, `server/routes/meals.ts`, `server/routes/history.ts`
- Pattern: Routes receive service dependencies from `server/app.ts`; they own validation, auth, status codes, headers, and response DTO shaping.

**Service Factories:**
- Purpose: Create cohesive DB-backed service APIs from a shared Drizzle database handle.
- Examples: `server/services/device.ts`, `server/services/food-logging.ts`, `server/services/summary.ts`, `server/services/assets.ts`
- Pattern: `createXService(db, opts?)` returns an object of async methods; callers do not instantiate DB clients inside routes.

**Revisioned Meal Model:**
- Purpose: Preserve meal edit/delete history with transaction headers, immutable revisions, revision items, and optimistic preconditions.
- Examples: `server/db/schema.ts`, `server/services/meal-transactions.ts`, `server/services/food-logging.ts`, `server/services/meal-history.ts`
- Pattern: Writes create a `meal_transactions` row plus `meal_revisions` / `meal_revision_items`; updates create new revisions and move `currentRevisionId`.

**Asset Reference Tokens:**
- Purpose: Decouple durable asset IDs from legacy image fields and authorize image reads by owner device.
- Examples: `server/services/assets.ts`, `server/services/chat.ts`, `server/services/meal-transactions.ts`, `server/routes/assets.ts`
- Pattern: Store `asset:<id>` references in legacy image fields, maintain `asset_references`, serve bytes via `/api/assets/:id` after guest-session ownership checks.

**Guest Session Cookies:**
- Purpose: Authorize browser-owned guest data without exposing raw device ownership through headers or query params.
- Examples: `server/services/guest-session.ts`, `server/lib/guest-session-resolver.ts`, `server/routes/device.ts`
- Pattern: HMAC-signed active and resume cookies; protected routes resolve cookies to `deviceId` and reissue active sessions from resume cookies.

**LLM Provider Interface:**
- Purpose: Hide runtime OpenAI and deterministic test providers behind a shared chat/tool/stream API.
- Examples: `server/llm/types.ts`, `server/llm/openai.ts`, `server/llm/mock.ts`, `tests/harness/streaming-llm.ts`
- Pattern: Inject `LLMProvider` into `buildApp()` / `createOrchestrator()`; services do not instantiate model clients.

**Tool Contract Runner:**
- Purpose: Validate LLM tool calls, run source-text guards, execute side effects, and map controlled failures without leaking raw arguments.
- Examples: `server/orchestrator/tool-contract.ts`, `server/orchestrator/tools.ts`
- Pattern: `ToolContract` + Zod schema + `runContract()` + redacted `logSummary()`.

**Realtime Publisher:**
- Purpose: Fan out per-device state changes to connected browser EventSource clients.
- Examples: `server/realtime/publisher.ts`, `server/routes/sse.ts`, `server/routes/chat.ts`, `server/routes/meals.ts`
- Pattern: Route subscribes Fastify replies; publisher writes named SSE frames and removes stale replies.

**Zustand Store:**
- Purpose: Single state boundary for client identity, navigation, messages, meals, summaries, targets, provisional streaming, and recovery.
- Examples: `client/src/store.ts`, `client/src/components/MainLayout.tsx`, `client/src/components/ChatPanel.tsx`
- Pattern: Components select state/actions; transport modules normalize payloads before state writes.

## Entry Points

**Production Server:**
- Location: `server/index.ts`
- Triggers: `yarn start`, Railway production runtime, `yarn dev:server` through `tsx --watch`
- Responsibilities: Load `config`, create `OpenAIProvider`, call `buildApp()`, listen on configured port, enable request auth redaction.

**Fastify Composition:**
- Location: `server/app.ts`
- Triggers: `server/index.ts`, integration tests, harness fixtures
- Responsibilities: Create DB/services/orchestrator/publisher, validate timezone, register CORS/multipart/static plugins, register routes.

**Database Migration CLI:**
- Location: `server/db/migrate.ts`
- Triggers: `yarn db:migrate`
- Responsibilities: Load `.env` when invoked directly, open SQLite, apply `drizzle/` migrations, close DB.

**React Client:**
- Location: `client/src/main.tsx`
- Triggers: Vite dev server and built `dist/client/index.html`
- Responsibilities: Mount `<App />` in React `StrictMode` and load `client/src/app.css`.

**Client App Gate:**
- Location: `client/src/App.tsx`
- Triggers: React render
- Responsibilities: Choose onboarding, recovery, loading, or main layout based on `deviceId` and `guestSessionStatus`.

**Vite Build/Dev:**
- Location: `client/vite.config.ts`
- Triggers: `yarn dev:client`, `yarn build`
- Responsibilities: Set `client` root, proxy `/api` to `localhost:3000`, emit build output to `dist/client`.

**Harness Scenario Runner:**
- Location: `tests/harness/run.ts`
- Triggers: `yarn verify:harness -- <scenario>`
- Responsibilities: Dynamic-import `tests/harness/scenarios/<name>.js`, boot a real in-memory app fixture, run the scenario, and write artifacts.

## Architectural Constraints

- **Threading:** Node single-process event loop. SQLite uses synchronous `better-sqlite3` under Drizzle; long operations should remain bounded. `server/routes/chat.ts` schedules SSE orchestrator work with `setImmediate()` after opening the stream.
- **Global state:** `server/routes/chat.ts` has module-level `activeChatTurns` for SSE cancellation; `server/realtime/publisher.ts` has an instance-level subscriber map created in `server/app.ts`; `client/src/sse.ts` has a module-level `eventSource`; `client/src/store.ts` has module-level `rolloverRefreshHandler`.
- **Circular imports:** `server/orchestrator/tool-contract.ts` lazily imports `./source-text-guard.js` inside `runContract()` to avoid a module-load circular dependency with tool code.
- **Timezone:** `server/app.ts` calls `validateTimezone()` at boot; `server/config.ts` defines required timezone `Asia/Taipei`; tests and harness fixtures set `process.env.TZ = "Asia/Taipei"`.
- **Authentication:** Browser-protected API routes use signed guest-session cookies via `server/lib/guest-session-resolver.ts`; `GET /api/sse` uses cookies because browser `EventSource` cannot set custom headers.
- **Static serving:** `server/app.ts` serves `dist/client` only when `index.html` exists in `CLIENT_DIST_DIR`; otherwise API-only local development is supported.
- **Dependency injection:** Runtime code injects `OpenAIProvider` only at `server/index.ts`; tests and harnesses inject `MockLLMProvider` or custom providers through `buildApp()`.
- **ESM imports:** `package.json` sets `"type": "module"`; local TypeScript imports use explicit `.js` specifiers.

## Anti-Patterns

### Raw Device Authorization

**What happens:** A route trusts `deviceId` from query parameters, request bodies, or `x-device-id` headers for ownership.
**Why it's wrong:** Browser routes must derive ownership from signed cookies; raw IDs bypass the guest-session contract and can expose another user's meals/assets.
**Do this instead:** Use `resolveGuestSession(request, { deviceService, guestSessionService })` in protected routes, matching `server/routes/meals.ts`, `server/routes/history.ts`, `server/routes/assets.ts`, and `server/routes/sse.ts`.

### Service or Route Creates Runtime LLM Client

**What happens:** A service or route imports and instantiates `OpenAIProvider` directly.
**Why it's wrong:** It bypasses test/harness DI and makes deterministic providers impossible.
**Do this instead:** Add provider dependencies through `server/app.ts` and pass them to `createOrchestrator()` or targeted services, matching `server/index.ts` and `server/app.ts`.

### Persistence Logic in React or Route Helpers

**What happens:** UI components or route-local helpers duplicate Drizzle queries or meal revision rules.
**Why it's wrong:** Meal revisions, asset references, summary recomputation, and optimistic preconditions are cross-route domain contracts.
**Do this instead:** Put reusable domain behavior in `server/services/*.ts`, especially `server/services/meal-transactions.ts` for meal writes and `server/services/history-query.ts` for history DTOs.

### Hand-Rolled Tool Side Effects Outside Contracts

**What happens:** Orchestrator code executes a new model tool without `ToolContract`, Zod validation, source guards, and redacted log summaries.
**Why it's wrong:** Tool calls are untrusted model output and must fail closed without leaking raw arguments.
**Do this instead:** Add the tool schema/executor in `server/orchestrator/tools.ts` and run it through `runContract()` from `server/orchestrator/tool-contract.ts`.

## Error Handling

**Strategy:** Routes translate expected validation/auth/domain conflicts to HTTP responses and let unexpected errors propagate to Fastify. Orchestrator and chat routes provide controlled user-facing fallbacks for LLM/provider/tool failures while preserving durable mutation side effects.

**Patterns:**
- Protected routes return `401` from `resolveGuestSession()` failures and clear invalid cookies when requested (`server/lib/guest-session-resolver.ts`, `server/routes/*.ts`).
- Validation failures return route-specific `400` payloads such as onboarding `VALIDATION_ERROR`, history `INVALID_QUERY`, and multipart upload errors (`server/routes/device.ts`, `server/routes/history.ts`, `server/routes/chat.ts`).
- Meal revision conflicts throw `MealRevisionPreconditionError` in `server/services/meal-transactions.ts` and map to `409` in `server/routes/meals.ts`.
- Chat route catch paths save fallback assistant messages and still emit terminal `done` frames on SSE (`server/routes/chat.ts:1070`, `server/routes/chat.ts:1113`).
- Orchestrator catches provider errors, records hooks/fallback context, and returns partial-success replies after mutations (`server/orchestrator/index.ts:780`).
- Client transport throws typed `UNAUTHORIZED`, `IntakeValidationError`, and `MealRevisionConflictError` errors from `client/src/api.ts`.

## Cross-Cutting Concerns

**Logging:** Fastify logger is configured in `server/index.ts`; structured route/orchestrator events are emitted through `server/observability/events.ts` and route-local log calls. Tool logging uses redacted summaries from `server/orchestrator/tool-contract.ts`.

**Validation:** Routes use local guards for HTTP payloads (`server/routes/device.ts`, `server/routes/history.ts`, `server/routes/meals.ts`). Tool calls use Zod schemas and source-text guards (`server/orchestrator/tool-contract.ts`, `server/orchestrator/tools.ts`). Client SSE/API payloads use shape guards before state mutation (`client/src/api.ts`, `client/src/sse.ts`).

**Authentication:** Guest-session cookies are created by `server/services/guest-session.ts`, resolved by `server/lib/guest-session-resolver.ts`, and recovered by `client/src/store.ts` through `client/src/api.ts`. Do not add browser route auth based on raw device IDs.

**Time:** Day-boundary logic uses `server/lib/time.ts` and `client/src/lib/time.ts`; runtime must use `TZ=Asia/Taipei`. Tests use `scripts/run-node-with-tz.mjs`.

**Assets:** Uploads stage under `config.uploadsStagingDir`, durable files live under `config.assetsDir`, and ownership is enforced through `assets` / `asset_references` plus `/api/assets/:id`.

**Testing:** Unit tests live in `tests/unit/`, route/service integration tests in `tests/integration/`, and boundary proof scenarios in `tests/harness/scenarios/`. Project skills prescribe Node built-in `node:test`, real SQLite, explicit `.js` imports, and `MockLLMProvider` / harness providers.

---

*Architecture analysis: 2026-05-26*
