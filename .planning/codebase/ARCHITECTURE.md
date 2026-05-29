<!-- refreshed: 2026-05-29 -->
# Architecture

**Analysis Date:** 2026-05-29

## System Overview

```text
Browser React app
`client/src/main.tsx`, `client/src/App.tsx`, `client/src/components/*`
        |
        | fetch/FormData/EventSource through `client/src/api.ts` and `client/src/sse.ts`
        v
Fastify HTTP/SSE transport
`server/index.ts` -> `server/app.ts` -> `server/routes/*.ts`
        |
        | dependency-injected services and orchestrator
        v
Domain + AI workflow layer
`server/services/*.ts`, `server/orchestrator/*.ts`, `server/llm/*.ts`
        |
        | Drizzle + better-sqlite3, filesystem assets, OpenAI provider
        v
SQLite + local files + external LLM
`server/db/schema.ts`, `drizzle/*`, `data/`, `server/llm/openai.ts`
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Server entry | Instantiate the production `OpenAIProvider`, configure Fastify logging, and listen on `0.0.0.0` | `server/index.ts:1` |
| App composition root | Create DB, services, orchestrator, realtime publisher, route registrations, CORS/multipart/static serving | `server/app.ts:75` |
| Config boundary | Centralize environment reads for DB paths, upload paths, guest sessions, client dist, port, timezone, and model | `server/config.ts:9` |
| DB client | Open SQLite with WAL and foreign keys, apply in-memory migrations for tests, validate persistent schema on boot | `server/db/client.ts:34` |
| Schema | Define devices, chat messages, assets, meal transactions/revisions/items, receipts, asset references, and turn states | `server/db/schema.ts:4` |
| Route layer | Own HTTP/SSE validation, session resolution, request parsing, response shaping, and transport-specific fallback behavior | `server/routes/*.ts` |
| Guest-session resolver | Convert signed active/resume cookies into a verified device ownership context for protected routes | `server/lib/guest-session-resolver.ts:32` |
| Services | Own reusable domain and persistence operations over Drizzle and SQLite transactions | `server/services/*.ts` |
| Orchestrator | Own model prompt construction, chat history, tool loop, mutation receipts, fallbacks, and stream/non-stream replies | `server/orchestrator/index.ts:630` |
| Tool contracts | Define LLM tools, Zod validation, controlled replies, tool dispatch, and redacted hook summaries | `server/orchestrator/tools.ts:1907` |
| LLM provider | Adapt OpenAI chat, streaming, tool-call merging, aborts, and provider error metadata behind `LLMProvider` | `server/llm/openai.ts:79` |
| Realtime publisher | Maintain in-process SSE subscribers and publish `daily_summary` / `goals_update` events by device | `server/realtime/publisher.ts:13` |
| React app shell | Gate onboarding, guest-session recovery, and main authenticated UI state | `client/src/App.tsx:7` |
| Zustand store | Own single client state boundary, localStorage persistence, provisional chat bubbles, summaries, meals, and navigation | `client/src/store.ts:100` |
| Client transport | Normalize REST/SSE payloads, image compression, credentials, conflicts, and API-specific errors | `client/src/api.ts:475`, `client/src/sse.ts:67` |
| Harness fixture | Boot the real Fastify app with `:memory:` SQLite and deterministic LLM providers for scenario evidence | `tests/harness/app-fixture.ts:65` |

## Pattern Overview

**Overall:** Layered TypeScript monolith with dependency-injected backend services, server-owned AI/tool orchestration, and a client-side state/transport split.

**Key Characteristics:**
- Backend runtime composition happens in `server/app.ts`; route modules receive concrete dependencies instead of importing or instantiating runtime services directly.
- HTTP routes in `server/routes/*.ts` remain transport boundaries. They resolve guest sessions, validate payloads, call services/orchestrator, and shape responses.
- Services in `server/services/*.ts` own DB queries, transactions, and persistence semantics. Use Drizzle builders for ordinary queries and raw SQLite only for deliberate hot paths such as `server/services/meal-transactions.ts:308`.
- The AI workflow is isolated behind `server/orchestrator/index.ts`, `server/orchestrator/tools.ts`, and `server/llm/types.ts`; runtime uses `OpenAIProvider`, while tests and harnesses inject deterministic providers.
- Client state is centralized in `client/src/store.ts`; API and SSE parsing are centralized in `client/src/api.ts` and `client/src/sse.ts`.

## Layers

**Backend Composition:**
- Purpose: Wire the app and enforce cross-cutting runtime contracts.
- Location: `server/app.ts`
- Contains: DB creation, service factories, orchestrator factory, publisher singleton per app instance, route registration, static client serving.
- Depends on: `server/config.ts`, `server/db/client.ts`, `server/services/*.ts`, `server/orchestrator/index.ts`, `server/routes/*.ts`.
- Used by: `server/index.ts`, `tests/integration/*.test.ts`, `tests/harness/app-fixture.ts`.

**Backend Transport:**
- Purpose: Own HTTP and SSE protocol details.
- Location: `server/routes/*.ts`
- Contains: Fastify route registration, cookie-backed session checks, multipart parsing, request validation, SSE framing, response DTO projection.
- Depends on: Service interfaces, `server/lib/guest-session-resolver.ts`, `server/realtime/publisher.ts`, selected orchestrator helpers.
- Used by: Fastify through `server/app.ts`.

**Domain Services:**
- Purpose: Own business rules that can be reused by routes, tools, tests, and harnesses.
- Location: `server/services/*.ts`
- Contains: Device targets, chat history, assets, meal transactions, meal corrections, history queries, summaries, proposal state, guest-session signing.
- Depends on: `server/db/schema.ts`, `server/db/client.ts`, `server/lib/*.ts`.
- Used by: Routes in `server/routes/*.ts`, AI tools in `server/orchestrator/tools.ts`, harness setup in `tests/harness/app-fixture.ts`.

**AI Orchestration:**
- Purpose: Convert user turns into model calls, tool executions, renderer-owned receipts, and fallback-safe replies.
- Location: `server/orchestrator/*.ts`
- Contains: `MAX_ROUNDS = 3` loop, system prompt sections, tool registry, mutation receipt rendering, hallucination guards, provider metadata hooks, LLM trace artifacts.
- Depends on: `server/llm/types.ts`, injected services, `server/services/summary.ts`, `server/services/food-logging.ts`, `server/realtime/publisher.ts`.
- Used by: `server/routes/chat.ts`.

**Persistence:**
- Purpose: Store device, chat, asset, meal, revision, proposal, and turn-state data.
- Location: `server/db/*.ts`, `drizzle/*`, `data/`
- Contains: Drizzle schema, migration runner/client, generated SQL migrations, runtime SQLite DB files.
- Depends on: `better-sqlite3`, `drizzle-orm`, `drizzle-kit`.
- Used by: Service factories in `server/services/*.ts`.

**Client Application:**
- Purpose: Render onboarding, home, chat, history, settings, day detail, and meal edit flows.
- Location: `client/src/*`
- Contains: React components, Zustand store, API/SSE clients, shared client types and pure UI helpers.
- Depends on: React, Zustand, browser `fetch`, browser `EventSource`, Vite build/runtime.
- Used by: Browser runtime from `client/src/main.tsx`; production same-origin serving from `server/app.ts:162`.

**Verification Harness:**
- Purpose: Prove route, SSE, AI, upload, and UI boundary contracts with deterministic artifacts.
- Location: `tests/harness/*`
- Contains: Scenario runner, app fixture, deterministic streaming LLM, scenario files, artifact writer, browser `.mjs` scenarios.
- Depends on: Real Fastify app through `server/app.ts`, in-memory SQLite, harness providers.
- Used by: `yarn verify:harness -- <scenario>` from `package.json:17`.

## Data Flow

### Primary Chat Request Path

1. Browser submits a chat turn through JSON or streaming transport in `client/src/api.ts:553` and `client/src/api.ts:623`.
2. `server/routes/chat.ts:1184` resolves the signed guest session with `server/lib/guest-session-resolver.ts:32`, parses multipart input, stages uploads, and chooses JSON vs SSE by the `Accept` header.
3. `server/routes/chat.ts:1300` creates a durable asset when needed, then calls `orchestrator.handleMessage()`.
4. `server/orchestrator/index.ts:641` loads the device and chat history, saves the user message at `server/orchestrator/index.ts:653`, builds the system prompt at `server/orchestrator/index.ts:777`, and enters the `MAX_ROUNDS` model/tool loop at `server/orchestrator/index.ts:836`.
5. Tool calls dispatch through `server/orchestrator/tools.ts:2112` into services such as `server/services/food-logging.ts:49`, `server/services/summary.ts:20`, and `server/services/meal-correction.ts:572`.
6. Meal mutations commit through transaction/revision semantics in `server/services/meal-transactions.ts:343`, `server/services/meal-transactions.ts:438`, or `server/services/meal-transactions.ts:492`.
7. The orchestrator returns a renderer/model/fallback reply with summaries, targets, affected dates, and receipt metadata from `server/orchestrator/index.ts:991`, `server/orchestrator/index.ts:1078`, or `server/orchestrator/index.ts:1231`.
8. The route writes assistant output and receipt references through `server/routes/chat.ts:227`, publishes summary updates through `server/routes/chat.ts:1368`, and emits JSON or SSE terminal events through `server/routes/chat.ts:1386` and `server/routes/chat.ts:1537`.
9. The client normalizes final payloads in `client/src/api.ts:465`, commits provisional bubbles in `client/src/store.ts:321`, and reconciles daily summaries/meals through `client/src/sse-summary-coordinator.ts:23`.

### Onboarding and Guest Session Flow

1. `client/src/App.tsx:20` shows onboarding when `client/src/store.ts:100` has no `deviceId`.
2. `client/src/api.ts:486` submits intake to `POST /api/device`.
3. `server/routes/device.ts:370` validates goal/intake fields, optionally calls target generation, creates the device via `server/services/device.ts:41`, and issues signed guest-session cookies through `server/services/guest-session.ts:188`.
4. Existing browser sessions bootstrap or recover via `client/src/store.ts:188` and `client/src/api.ts:517`.
5. Protected server routes resolve active/resume cookies through `server/lib/guest-session-resolver.ts:32`; route code uses the resolved `deviceId`, not query strings or custom browser headers.

### Realtime Summary and Goals Flow

1. `client/src/components/MainLayout.tsx:156` performs the initial meal load and `client/src/components/MainLayout.tsx:161` opens `/api/sse`.
2. `server/routes/sse.ts:21` verifies the guest session, hijacks the response, subscribes through `server/realtime/publisher.ts:16`, and emits the initial `daily_summary`.
3. Meal mutation routes and chat route publish summary envelopes through `server/realtime/publisher.ts:58`; goal changes publish through `server/realtime/publisher.ts:67`.
4. `client/src/sse.ts:67` validates incoming payload shapes before invoking handlers.
5. `client/src/sse-summary-coordinator.ts:65` refreshes meal rows before committing same-day mutation summaries, records historical affected dates, and ignores future summaries.

### Historical Query Flow

1. The client calls history APIs through `client/src/api.ts:872` and `client/src/api.ts:880`.
2. `server/routes/history.ts:142` resolves sessions and validates query parameters before calling `server/services/history-query.ts:446`.
3. `server/services/history-query.ts:451` pages meals, `server/services/history-query.ts:505` searches item names with cursors and nutrition bounds, and `server/services/history-query.ts:621` aggregates trend buckets.
4. Route responses are normalized into client meal entries by `client/src/api.ts:851`.

**State Management:**
- Server request state is per Fastify request except `server/routes/chat.ts:100`, which stores in-process active chat turns for cancellation, and `server/realtime/publisher.ts:14`, which stores in-process SSE subscribers.
- Persistent domain state lives in SQLite through `server/db/schema.ts` and `drizzle/*`; durable images live under the configured assets directory from `server/config.ts:36`.
- Client UI state lives in the single Zustand store at `client/src/store.ts:100`; device identity and daily targets are mirrored to `localStorage` at `client/src/store.ts:173`.
- Client streaming response state is held as a provisional bubble in `client/src/store.ts:91` and finalized by `client/src/store.ts:321`.

## Key Abstractions

**`buildApp()` Composition Root:**
- Purpose: Build a complete Fastify app with injected LLM provider and optional test/harness overrides.
- Examples: `server/app.ts:75`, `tests/integration/*.test.ts`, `tests/harness/app-fixture.ts:92`.
- Pattern: Factory with dependency injection and optional `onServicesReady` observer.

**Service Factories:**
- Purpose: Encapsulate domain operations behind `createXService(db)` return objects.
- Examples: `server/services/device.ts:41`, `server/services/food-logging.ts:49`, `server/services/history-query.ts:446`, `server/services/assets.ts:46`.
- Pattern: Factory functions close over `AppDatabase`; methods return DTOs or domain errors.

**Meal Transactions and Revisions:**
- Purpose: Maintain mutable meals as immutable revisions with current pointers, optimistic revision guards, and soft delete semantics.
- Examples: `server/db/schema.ts:64`, `server/services/meal-transactions.ts:119`, `server/services/meal-transactions.ts:229`.
- Pattern: Transaction table owns identity/current revision; revision and item tables own versioned content.

**Guest Session Cookies:**
- Purpose: Bind browser requests to device ownership using signed active/resume cookies.
- Examples: `server/services/guest-session.ts:124`, `server/lib/guest-session-resolver.ts:32`, `server/routes/sse.ts:21`.
- Pattern: HMAC signed claims plus resume-cookie reissue; route handlers clear invalid cookies.

**LLM Provider Interface:**
- Purpose: Keep runtime OpenAI calls replaceable by mocks and harness providers.
- Examples: `server/llm/types.ts:64`, `server/llm/openai.ts:79`, `tests/harness/streaming-llm.ts`.
- Pattern: Interface with `chat`, optional `chatRound`, and optional `chatStream`.

**Tool Contract Registry:**
- Purpose: Make each LLM tool schema, validation, log summary, and execution path explicit.
- Examples: `server/orchestrator/tools.ts:1900`, `server/orchestrator/tools.ts:1907`, `server/orchestrator/tools.ts:2112`.
- Pattern: Registry-first dispatch over `ToolContract` with Zod validation and controlled failure/reply adapters.

**Realtime Publisher:**
- Purpose: Fan out summary and goals events to current device subscribers.
- Examples: `server/realtime/publisher.ts:13`, `server/routes/sse.ts:57`.
- Pattern: In-memory `Map<deviceId, FastifyReply[]>` scoped to one app process.

**Client Transport Boundary:**
- Purpose: Hide fetch/SSE details and normalize untrusted server payloads before they touch UI state.
- Examples: `client/src/api.ts:553`, `client/src/api.ts:623`, `client/src/sse.ts:67`.
- Pattern: API-specific exported functions plus local type guards/normalizers.

**Harness Scenario App:**
- Purpose: Reuse the real app in deterministic verification scenarios.
- Examples: `tests/harness/app-fixture.ts:65`, `tests/harness/run.ts:31`.
- Pattern: Full app boot against `:memory:` SQLite, seeded device, deterministic provider, generated artifacts.

## Entry Points

**Production Server:**
- Location: `server/index.ts`
- Triggers: `yarn start` from `package.json:13`, Railway/runtime process start.
- Responsibilities: Instantiate `OpenAIProvider`, set logger redaction, call `buildApp()`, listen on `config.port`.

**Fastify App Factory:**
- Location: `server/app.ts`
- Triggers: Production server, integration tests, harness fixture.
- Responsibilities: Build the complete app graph, validate timezone, register routes, serve built client when `dist/client/index.html` exists.

**Vite Client:**
- Location: `client/src/main.tsx`
- Triggers: Browser loading `client/index.html` in dev or built bundle in `dist/client`.
- Responsibilities: Mount React `App` and global CSS.

**React App Gate:**
- Location: `client/src/App.tsx`
- Triggers: React render.
- Responsibilities: Choose onboarding, recovery, loading, or main layout based on Zustand `deviceId` and guest-session status.

**Chat API Route:**
- Location: `server/routes/chat.ts`
- Triggers: `POST /api/chat`, `POST /api/chat/stop`, `GET /api/chat/history`.
- Responsibilities: Own chat upload parsing, JSON/SSE transport, cancellation, fallback persistence, summary publishing, and cleanup.

**SSE Route:**
- Location: `server/routes/sse.ts`
- Triggers: Browser `EventSource("/api/sse")` from `client/src/sse.ts:69`.
- Responsibilities: Verify cookie-backed session, subscribe the raw reply, emit initial summary, keep the connection alive.

**Harness CLI:**
- Location: `tests/harness/run.ts`
- Triggers: `yarn verify:harness -- <scenario>` from `package.json:17`.
- Responsibilities: Import scenario, boot scenario app, run scenario, write generated artifacts, print pass/fail summary.

## Architectural Constraints

- **Threading:** The runtime uses the Node.js event loop. Chat SSE work is scheduled after response open with `setImmediate()` in `server/routes/chat.ts:1545`; OpenAI and DB operations are async around synchronous `better-sqlite3` calls.
- **Global state:** Keep global mutable state limited and intentional. Current module-level state appears in `server/routes/chat.ts:100` for active chat turn cancellation, `client/src/sse.ts:10` for one EventSource, `client/src/store.ts:33` for the rollover handler, and `server/config.ts:9` for environment-derived constants.
- **Circular imports:** Not detected by import inspection. Preserve the current direction: `routes -> services/orchestrator -> db/lib`, `client components -> store/api/sse`, and avoid importing route modules from services.
- **Timezone:** `server/app.ts:82` validates `TZ=Asia/Taipei` through `server/lib/time.ts`; tests and harnesses also run through timezone-aware scripts such as `scripts/run-node-with-tz.mjs`.
- **Authentication:** Browser protected routes must derive ownership from guest-session cookies through `server/lib/guest-session-resolver.ts`, because `EventSource` cannot set custom headers.
- **LLM dependency injection:** Only `server/index.ts:8` instantiates `OpenAIProvider`; tests and harnesses inject mocks/providers through `buildApp()`.
- **Single-process realtime:** `server/realtime/publisher.ts:14` stores subscribers in memory. Multi-instance deployment requires an external pub/sub layer before horizontal realtime scaling.

## Anti-Patterns

### Raw Device Ownership In Routes

**What happens:** Route code trusts `deviceId` query parameters, request bodies, or `x-device-id` headers for protected browser surfaces.
**Why it's wrong:** It bypasses the signed guest-session ownership contract and breaks `/api/sse`, where browser `EventSource` cannot send custom headers.
**Do this instead:** Resolve the session with `resolveGuestSession()` in `server/lib/guest-session-resolver.ts:32`, then use the returned `deviceId` as shown in `server/routes/meals.ts:133` and `server/routes/sse.ts:21`.

### Service-Owned Runtime LLM Clients

**What happens:** A service or route creates an OpenAI client directly.
**Why it's wrong:** It breaks deterministic testing and bypasses the `LLMProvider` seam used by `tests/harness/app-fixture.ts:72`.
**Do this instead:** Add provider-dependent behavior to an injected service factory or the orchestrator, and wire it in `server/app.ts:86`; keep runtime provider construction in `server/index.ts:8`.

### DB Logic In Client Or Transport DTOs

**What happens:** A route or client component starts owning meal transaction/revision semantics.
**Why it's wrong:** Optimistic revision checks and grouped meal rules are centralized in `server/services/meal-transactions.ts:119` and `server/services/food-logging.ts:49`; duplicating them creates stale writes and inconsistent conflicts.
**Do this instead:** Routes validate transport payloads, then call service methods such as `foodLoggingService.updateMeal()` in `server/routes/meals.ts:213`.

### Direct Store Mutation Outside Actions

**What happens:** Components mutate state outside `client/src/store.ts` actions or duplicate localStorage writes.
**Why it's wrong:** Guest-session recovery, target persistence, rollover guards, and provisional bubbles rely on centralized action behavior in `client/src/store.ts:173` and `client/src/store.ts:321`.
**Do this instead:** Add or reuse a store action in `client/src/store.ts`, then consume it from components through selectors as in `client/src/components/MainLayout.tsx:117`.

## Error Handling

**Strategy:** Validate at transport and contract boundaries, return controlled HTTP errors for user-caused input/session failures, and convert model/tool failures into deterministic fallback replies without losing committed mutations.

**Patterns:**
- Guest-session failures return `401` and optionally clear cookies from routes such as `server/routes/sse.ts:21` and `server/routes/meals.ts:133`.
- Route validation returns `400` for malformed intake, query, multipart, or edit payloads in files such as `server/routes/device.ts:178`, `server/routes/history.ts:158`, and `server/routes/meals.ts:185`.
- Meal revision conflicts throw `MealRevisionPreconditionError` in `server/services/meal-transactions.ts:98` and map to `409` in `server/routes/meals.ts:90`.
- Orchestrator/provider failures are classified with `LLMProviderError` metadata in `server/llm/openai.ts:70`, observed by hooks in `server/orchestrator/hooks.ts:103`, and returned as renderer/fallback replies in `server/orchestrator/index.ts:901`.
- Chat route catch paths persist fallback assistant messages and clean up staged/durable uploads in `server/routes/chat.ts:1453` and `server/routes/chat.ts:1501`.

## Cross-Cutting Concerns

**Logging:** Fastify logging is configured in `server/index.ts:9`; structured route/orchestrator events live in `server/observability/events.ts` and `server/orchestrator/hooks.ts:51`. Client events are best-effort through `client/src/api.ts:367` and `server/routes/observability.ts:16`.

**Validation:** Routes use local parsing/type guards in `server/routes/*.ts`; tool contracts use Zod through `server/orchestrator/tool-contract.ts` and `server/orchestrator/tools.ts`; client transport normalizes untrusted payloads in `client/src/api.ts` and `client/src/sse.ts`.

**Authentication:** The app uses custom signed guest sessions from `server/services/guest-session.ts:124`; protected browser routes call `server/lib/guest-session-resolver.ts:32`; the client uses `credentials: "same-origin"` in `client/src/api.ts`.

**Uploads and Assets:** Chat uploads are staged by `server/routes/chat.ts`, persisted by `server/services/assets.ts:46`, represented as `asset:<id>` refs by `server/services/assets.ts:30`, and served only after ownership checks in `server/routes/assets.ts:16`.

**Release Verification:** `scripts/release-check.mjs:123` enforces timezone, TypeScript, tests, and frontend build; `package.json:14` and `package.json:17` define the core test and harness gates.

---

*Architecture analysis: 2026-05-29*
