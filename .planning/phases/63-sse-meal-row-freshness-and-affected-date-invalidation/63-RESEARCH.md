# Phase 63: SSE Meal-Row Freshness and Affected-Date Invalidation - Research

**Researched:** 2026-05-18
**Domain:** Fastify SSE envelope, client EventSource validation, Zustand state consistency, affected-date history invalidation
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

All items in this section are copied from `.planning/phases/63-sse-meal-row-freshness-and-affected-date-invalidation/63-CONTEXT.md`. [VERIFIED: 63-CONTEXT.md]

### Locked Decisions

### Daily Summary Event Envelope
- **D-01:** Use one strict envelope for all `daily_summary` SSE events:
  ```ts
  {
    summary: DailySummary;
    affectedDate: string;
    source: "initial" | "meal_mutation";
  }
  ```
- **D-02:** `source` is a guardrail, not freshness proof. It exists only to distinguish first/reconnect snapshots from mutation-driven invalidation.
- **D-03:** `affectedDate` drives same-day or historical routing. It supports same-day reconcile and historical invalidation.
- **D-04:** Do not include `summaryOutcome.status`, changed meal ids, changed meal revision ids, or a `mealRevisionId` high-watermark in Phase 63 `daily_summary` events.
- **D-05:** `summary.date` must equal `affectedDate`. If not, the event is invalid and mutates nothing.

### Same-Day SSE Reconcile
- **D-06:** For `source: "meal_mutation"` and `affectedDate === todayKey`, the client must refetch today's meal rows first, then commit the incoming `summary`.
- **D-07:** If the same-day meal refetch fails, preserve the prior visible summary and rows. Do not show the newer summary beside stale visible rows.
- **D-08:** Same-day reconcile failure is silent from the user's perspective in Phase 63. Do not add a toast, inline stale marker, or new visible error state. Existing unauthorized handling and EventSource reconnect behavior remain the recovery paths.
- **D-09:** Overlapping same-day mutation events use latest-event-wins by client receipt/coordinator request-token order, not server commit order. The envelope intentionally has no revision/high-watermark, so the client must treat the latest accepted event/token as authoritative for UI writes.
- **D-10:** If a valid same-day `meal_mutation` event arrives while the initial meal-row load is still in flight, the mutation reconcile wins. Older initial row-load results must not overwrite rows or summary committed by the newer mutation event.
- **D-11:** The same latest-wins token/guard must cover `MainLayout` initial `getMeals()` versus SSE same-day reconcile. Otherwise the initial load can overwrite fresher SSE rows after the coordinator already committed a newer summary/row pair.
- **D-12:** First-mount and reconnect `source: "initial"` same-day handling is governed by the Initial/Reconnect State Matrix below; do not duplicate those conditions elsewhere.
- **D-13:** Reconnect `source: "initial"` events are different when today meal rows are already loaded: treat them as reconnect snapshots and reconcile rows before showing a newer summary. If row refresh fails, keep prior visible summary and rows.
- **D-14:** Server always sends `source: "initial"` on SSE connection. The client must classify first mount versus reconnect from row-load/coordinator state, not from `source` alone.

### Initial/Reconnect State Matrix
- **D-15:** `source: "initial"` + no loaded today rows + coordinator has not committed any same-day summary or row state yet: run existing guarded same-day summary commit; initial `getMeals()` remains the row source, with token protection against later stale overwrite.
- **D-16:** `source: "initial"` + loaded today rows: treat as reconnect snapshot; refetch rows first, then commit summary, with latest-wins/drop-on-failure semantics.
- **D-17:** `source: "initial"` + initial row load in flight but a newer same-day `meal_mutation` event is received: mutation reconcile wins; the older initial load result must be dropped if stale by token.
- **D-18:** `source: "initial"` + same-day + no loaded today rows because initial `getMeals()` failed or recovery reconnect happened before rows loaded: treat like the no-loaded-rows path. Allow guarded same-day summary commit, let the SSE-triggered/retry refetch become the row recovery path, and apply the same token guard against stale row overwrites.
- **D-19:** `source: "meal_mutation"` + same-day: always use the SSE reconcile path, independent of whether mount-time loading is still active. If no today rows are loaded after initial load failure, the SSE reconcile refetch acts as recovery for the missing rows.

### Client Responsibility Boundary
- **D-20:** `client/src/sse.ts` validates and parses the `daily_summary` envelope shape, recursively validates `summary`, validates calendar-real local date keys, then dispatches a richer callback. It must not perform meal refetches itself.
- **D-21:** A small SSE reconcile coordinator/helper should own future-date ignore, today-versus-historical routing, refetch-first, latest-wins, and drop-on-failure behavior for SSE-driven same-day events.
- **D-22:** `client/src/store.ts` remains the guarded state commit boundary. It should not own SSE event orchestration.
- **D-23:** Existing non-transport async store actions such as guest-session bootstrap/recovery are not prohibited by this boundary.
- **D-24:** Plan phase may evaluate whether `client/src/meal-edit-refresh.ts` should share primitives with the SSE coordinator or eventually adopt refetch-first ordering. If sharing would require flag-heavy parameterization, increase coupling, or materially change visible Phase 62 behavior, keep paths independent and apply the new coordinator only to the Phase 63 SSE path.
- **D-25:** Phase 62 direct mutation success flows are not retroactively changed. Making direct mutation paths refetch-first is optional cleanup, not required by Phase 63.

### Historical Affected-Date Invalidation
- **D-26:** For valid `affectedDate !== todayKey` events, the client must never update today's summary, refresh today's rows, or invoke the same-day reconcile path.
- **D-27:** Historical events invalidate the affected historical date through `recordMealMutation(affectedDate)` / `lastMealMutation` nonce. This is the valid non-future historical SSE invalidation signal.
- **D-28:** Same-day SSE reconcile should use its own coordinator token path rather than `recordMealMutation(affectedDate)`.
- **D-29:** If the affected historical date is currently visible, refresh that visible surface; otherwise passive invalidation is enough.
- **D-30:** "Currently visible" means an open Day Detail whose `dateKey` matches `affectedDate`, or the active History screen when `affectedDate` is the selected day or falls within the currently visible history week.
- **D-31:** Do not refresh merely because the History tab exists. Non-visible historical dates remain passive invalidation only.
- **D-32:** Historical event `summary` is validated but not consumed as the data source for historical surfaces in Phase 63. Historical surfaces refresh through affected-date invalidation/refetch.
- **D-33:** Historical visible refreshes use latest-event-wins per `affectedDate` by client receipt/coordinator request-token order. Older in-flight refresh results must not overwrite newer refresh results for the same visible date.
- **D-34:** Do not require explicit event coalescing in Phase 63.

### Validation And Date Guardrails
- **D-35:** `daily_summary` SSE validation is strict and silent. JSON parse failures, envelope shape failures, recursive `DailySummary` validation failures, invalid `source`, invalid `affectedDate`, invalid `summary.date`, and `summary.date !== affectedDate` are ignored without throwing.
- **D-36:** Invalid events mutate no app state: no `setDailySummary`, no meal-row refresh, no same-day reconcile, no `recordMealMutation`, no historical refresh, and no `lastMealMutation` nonce increment.
- **D-37:** No dev/debug signal is introduced in Phase 63 for invalid frames. This follows the existing `goals_update` SSE precedent.
- **D-38:** `affectedDate` and `summary.date` must be real local date keys. They must match `YYYY-MM-DD` and pass calendar round-trip validation. Impossible dates such as `2026-02-31` are invalid.
- **D-39:** Route by date at the SSE coordinator boundary. Same-day valid events may call `setDailySummary` after required row reconciliation. Valid non-today events must not call `setDailySummary` because that store action triggers rollover refresh when `summary.date !== local today`.
- **D-40:** The existing store-level date guard remains defense in depth, not the primary historical routing mechanism.
- **D-41:** Future valid dates are valid calendar keys but out of current product scope. If `affectedDate > client todayKey`, silently ignore the event with no `setDailySummary`, no `recordMealMutation`, and no `lastMealMutation` increment.
- **D-42:** Future-date ignore is coordinator responsibility after `sse.ts` validates envelope shape and calendar-real date keys. `sse.ts` should dispatch valid future-date envelopes to the coordinator rather than classify product-scope routing itself.
- **D-43:** Phase 63 does not change server future-date mutation policy.

### Server Emission And Scope Assumptions
- **D-44:** Server-side routes must emit historical affected-date `daily_summary` events when meal mutations affect historical dates.
- **D-45:** Current `server/routes/chat.ts` and `server/routes/meals.ts` publish helpers hard-gate `daily_summary` fan-out to today. Phase 63 must remove or replace those today-only gates and add historical affected-date emission; this is not just metadata plumbing over existing historical emission.
- **D-46:** `server/realtime/publisher.ts` remains fan-out only. Add metadata to events at route/service call sites rather than introducing DB reads into the publisher.
- **D-47:** Date-moving meal mutations are out of current product scope. Current update/correction paths revise meal contents/image and preserve existing `loggedAt`, so each emitted meal-mutation `daily_summary` event can cover exactly one `affectedDate`. If date-moving meal mutations are introduced later, that feature must define multi-date emission semantics separately.

### the agent's Discretion
- Planner may choose the exact module name and placement for the SSE reconcile coordinator/helper.
- Planner may choose cancellation, request-token, or nonce mechanics for latest-event-wins as long as ordering is based on client receipt/coordinator token order and older in-flight work cannot overwrite newer event results.
- Planner may decide whether to extract/reuse existing `client/src/lib/history-week.ts` date-key parsing logic or add an equivalent non-throwing validator.
- Planner may choose the exact route-level API changes needed to pass `affectedDate` and `source` into `publishDailySummary`, provided the publisher remains fan-out only.

### Deferred Ideas (OUT OF SCOPE)

- Date-moving meal mutations - out of current product scope. If introduced later, define multi-date summary emission semantics separately.
- Future-date mutation handling - out of current product scope. Phase 63 silently ignores future valid dates and does not change server future-date mutation policy.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| REAL-01 | Same-day `daily_summary` SSE events include enough freshness metadata for clients to refresh or invalidate meal rows. | Use the locked `{ summary, affectedDate, source }` envelope and route-level affected-date emission. [VERIFIED: 63-CONTEXT.md, `.planning/REQUIREMENTS.md:32`] |
| REAL-02 | Home/Summary state cannot accept newer daily totals while leaving visible same-day meal rows stale without marking or refreshing them. | Use a client coordinator that refetches same-day rows before `setDailySummary`, and guard initial `getMeals()` with the same latest-wins token. [VERIFIED: 63-CONTEXT.md, `client/src/components/MainLayout.tsx:142`] |
| REAL-03 | Malformed, stale-date, or historical `daily_summary` events preserve existing date guards and do not overwrite current-day rows incorrectly. | Validate the envelope in `client/src/sse.ts`, route historical events through `recordMealMutation(affectedDate)`, and avoid calling `setDailySummary` for non-today events. [VERIFIED: 63-CONTEXT.md, `client/src/sse.ts:29`, `client/src/store.ts:162`, `client/src/store.ts:265`] |
</phase_requirements>

## Summary

Phase 63 should be planned as a consistency repair across four boundaries: route-level SSE event production, process-local fan-out, client transport validation, and client state coordination. [VERIFIED: 63-CONTEXT.md, `server/routes/chat.ts:387`, `server/routes/meals.ts:99`, `server/realtime/publisher.ts:50`, `client/src/sse.ts:29`, `client/src/store.ts:265`] The current server publishes raw `DailySummary` payloads and both chat/direct meal publish helpers suppress historical events by checking against local today. [VERIFIED: `server/realtime/publisher.ts:50`, `server/routes/chat.ts:402`, `server/routes/meals.ts:108`] The current client parses `daily_summary` JSON directly and calls the summary callback without validation or row reconciliation. [VERIFIED: `client/src/sse.ts:29`]

The locked envelope is sufficient for this phase because the client only needs to distinguish initial/reconnect snapshots from mutation invalidation and route by `affectedDate`; no Phase 63 plan should add revision high-watermarks, changed IDs, or `summaryOutcome` to `daily_summary`. [VERIFIED: 63-CONTEXT.md] Same-day events must be refetch-first and drop-on-failure so newer totals never display beside stale rows; historical events must invalidate or refresh only matching historical surfaces via the existing `lastMealMutation` nonce family. [VERIFIED: 63-CONTEXT.md, `client/src/store.ts:162`, `client/src/components/HistoryScreen.tsx:500`]

**Primary recommendation:** Plan this as `server envelope emission -> client strict parsing -> SSE reconcile coordinator -> targeted unit/integration tests`, with no new runtime libraries and no publisher-side database reads. [VERIFIED: AGENTS.md, 63-CONTEXT.md]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| `daily_summary` envelope production | API / Backend | Realtime fan-out | Routes already own transport response shaping and publish timing; publisher should only serialize and fan out the route-provided payload. [VERIFIED: AGENTS.md:49, AGENTS.md:55, `server/realtime/publisher.ts:27`] |
| Initial SSE snapshot | API / Backend | Browser / Client | `/api/sse` resolves the guest session, computes the current-day summary, writes the initial frame, then subscribes the connection. [VERIFIED: `server/routes/sse.ts:21`, `server/routes/sse.ts:45`, `server/routes/sse.ts:49`] |
| Envelope validation | Browser / Client | API / Backend | `client/src/sse.ts` is the existing EventSource parser and `goals_update` precedent already swallows malformed frames. [VERIFIED: `client/src/sse.ts:10`, `client/src/sse.ts:39`] |
| Same-day refetch-before-summary | Browser / Client | API / Backend | The browser can observe whether today rows are visible/in-flight and can call `getMeals({ refreshReason: "meal_mutation" })` before committing the summary. [VERIFIED: 63-CONTEXT.md, `client/src/api.ts:767`, `client/src/components/MainLayout.tsx:142`] |
| Historical affected-date invalidation | Browser / Client | API / Backend | `recordMealMutation(affectedDate)` already drives History selected-day/week cache refresh semantics. [VERIFIED: `client/src/store.ts:162`, `client/src/components/HistoryScreen.tsx:500`] |
| Day Detail historical refresh | Browser / Client | API / Backend | Day Detail currently fetches by `dateKey` on mount/date changes but does not subscribe to `lastMealMutation`, so Phase 63 must add that visible-surface refresh path. [VERIFIED: `client/src/components/HistoryDayDetailScreen.tsx:109`, `client/src/components/HistoryDayDetailScreen.tsx:120`] |

## Project Constraints (from AGENTS.md)

- Work must stay off production promotion paths; `main` is production and cannot be touched without explicit current-thread approval. [VERIFIED: AGENTS.md:8, AGENTS.md:13]
- Use `yarn` for project commands and do not introduce npm-based workflow commands into plans. [VERIFIED: AGENTS.md:60]
- Preserve ESM imports with explicit `.js` local TypeScript specifiers. [VERIFIED: AGENTS.md:61]
- Keep runtime dependency wiring through `server/app.ts`, route modules as HTTP/SSE transport boundaries, services as reusable persistence/domain logic, and `server/realtime/publisher.ts` as realtime fan-out. [VERIFIED: AGENTS.md:49, AGENTS.md:50, AGENTS.md:53, AGENTS.md:55]
- Keep `client/src/store.ts` as the single Zustand state boundary, and `client/src/api.ts` / `client/src/sse.ts` as transport helpers. [VERIFIED: AGENTS.md:56]
- Preserve `TZ=Asia/Taipei` for day-boundary behavior. [VERIFIED: AGENTS.md:63, AGENTS.md:91]
- Keep `GET /api/sse` cookie-backed because browser `EventSource` cannot set custom headers in this project policy. [VERIFIED: AGENTS.md:64]
- Use Node built-in `node:test`, real SQLite, and existing path-triggered verification commands. [VERIFIED: AGENTS.md:68, AGENTS.md:69, AGENTS.md:75]
- Preserve `server/routes/chat.ts` SSE `status` / `chunk` / `done` ordering, summary publish timing, and upload cleanup invariants. [VERIFIED: AGENTS.md:90, `tests/integration/chat-api.test.ts:2724`]

## Standard Stack

### Core

| Library | Installed Version | Purpose | Why Standard |
|---------|-------------------|---------|--------------|
| TypeScript | 5.9.3 | Full-stack type system and compile gate. | Existing repo uses TypeScript across server, client, tests, and Vite config. [VERIFIED: local node_modules, `.planning/codebase/STACK.md`] |
| Fastify | 5.8.4 | API server and long-lived `/api/sse` route. | Existing route modules, `app.inject()` tests, and SSE route are built on Fastify. [VERIFIED: local node_modules, `server/routes/sse.ts:21`] |
| React | 19.2.4 | Client component runtime. | Existing MainLayout/History/Day Detail surfaces are React components. [VERIFIED: local node_modules, `client/src/components/MainLayout.tsx:115`] |
| Zustand | 5.0.12 | Client-wide state boundary. | Existing store owns meals, summary, targets, navigation, and `lastMealMutation`. [VERIFIED: local node_modules, `client/src/store.ts:1`, `client/src/store.ts:60`] |
| Native EventSource | Browser API | Long-lived same-origin SSE subscription. | Current client already uses `new EventSource("/api/sse")` and custom named events. [VERIFIED: `client/src/sse.ts:27`, CITED: MDN Server-sent events] |
| Native fetch | Browser API | Meal row and historical surface refetching. | Existing `getMeals`, `getHistoryTrends`, and `getHistoryDaySnapshot` use same-origin `fetch`. [VERIFIED: `client/src/api.ts:767`, `client/src/api.ts:843`, `client/src/api.ts:856`] |

### Supporting

| Library | Installed Version | Purpose | When to Use |
|---------|-------------------|---------|-------------|
| tsx | 4.21.0 | Runs TypeScript tests/scripts under Node. | Use existing test scripts and targeted `node --import tsx --test ...` commands. [VERIFIED: local node_modules, `package.json:14`] |
| better-sqlite3 | 11.10.0 | SQLite driver for real integration tests. | Route tests and app fixtures should use real SQLite, including `:memory:`. [VERIFIED: local node_modules, AGENTS.md:69] |
| Drizzle ORM | 0.39.3 | SQLite schema/query layer. | Needed only if route/service implementation touches persistence; Phase 63 should not add migrations. [VERIFIED: local node_modules, `.planning/codebase/STACK.md`] |
| Zod | 4.3.6 | Existing orchestrator tool validation. | Do not add Zod to client SSE parsing; current client uses local shape guards. [VERIFIED: local node_modules, `client/src/api.ts:55`, `client/src/sse.ts:14`] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Native EventSource | WebSocket | Not needed: the phase is server-to-client only and current architecture already uses `/api/sse`. [CITED: MDN Server-sent events, VERIFIED: `client/src/sse.ts:27`] |
| Small coordinator/helper | State-machine library | Overkill: locked decisions require request-token/latest-wins behavior, and the repo has no state-machine dependency. [VERIFIED: 63-CONTEXT.md, `package.json:24`] |
| Local shape guards | Zod in client SSE parser | Would add bundle/runtime coupling without an existing client pattern; current client transport guards are handwritten. [VERIFIED: `client/src/api.ts:55`, `client/src/sse.ts:14`] |

**Installation:**

```bash
# No new packages are recommended for Phase 63. [VERIFIED: package.json, 63-CONTEXT.md]
yarn install --frozen-lockfile
```

**Version verification:** Installed versions were verified from `node_modules/*/package.json`, and registry current versions were checked with `npm view` on 2026-05-18 for currency only; planning should use the resolved installed stack unless a separate dependency-upgrade phase is approved. [VERIFIED: local node_modules, npm registry]

| Package | Installed | Registry latest checked | Registry modified |
|---------|-----------|-------------------------|-------------------|
| fastify | 5.8.4 | 5.8.5 | 2026-04-14 [VERIFIED: npm registry] |
| react | 19.2.4 | 19.2.6 | 2026-05-08 [VERIFIED: npm registry] |
| vite | 6.4.1 | 8.0.13 | 2026-05-14 [VERIFIED: npm registry] |
| zustand | 5.0.12 | 5.0.13 | 2026-05-05 [VERIFIED: npm registry] |
| typescript | 5.9.3 | 6.0.3 | 2026-04-16 [VERIFIED: npm registry] |
| tsx | 4.21.0 | 4.22.1 | 2026-05-17 [VERIFIED: npm registry] |
| better-sqlite3 | 11.10.0 | 12.10.0 | 2026-05-12 [VERIFIED: npm registry] |
| drizzle-orm | 0.39.3 | 0.45.2 | 2026-05-15 [VERIFIED: npm registry] |
| zod | 4.3.6 | 4.4.3 | 2026-05-04 [VERIFIED: npm registry] |
| openai | 4.104.0 | 6.38.0 | 2026-05-15 [VERIFIED: npm registry] |

## Architecture Patterns

### System Architecture Diagram

```text
Meal mutation commits
  -> route has committed mutation facts + affectedDate + summaryOutcome
  -> route builds DailySummarySSEPayload { summary, affectedDate, source: "meal_mutation" }
  -> RealtimePublisher fan-out writes event: daily_summary / data: payload
  -> client/src/sse.ts parses JSON
      -> strict envelope guard + DailySummary guard + calendar-real date guard + summary.date === affectedDate
      -> invalid frame: silent ignore, no callback
      -> valid frame: callback(payload)
  -> SSE reconcile coordinator
      -> affectedDate > todayKey: silent ignore
      -> affectedDate === todayKey:
           source initial + no loaded rows + no same-day commit: guarded summary commit, initial rows remain row source
           source initial + loaded rows OR source meal_mutation: refetch rows first
           refetch success + latest token: setMeals(rows), setDailySummary(summary)
           refetch failure or stale token: preserve prior UI
      -> affectedDate < todayKey:
           recordMealMutation(affectedDate)
           if visible history/day-detail date matches: refresh with per-date latest-wins
```

The diagram uses existing route/service/client boundaries and the locked Phase 63 event matrix. [VERIFIED: AGENTS.md, 63-CONTEXT.md]

### Recommended Project Structure

```text
server/
├── realtime/publisher.ts       # Fan-out only; widen payload type, no DB reads. [VERIFIED: 63-CONTEXT.md]
└── routes/
    ├── sse.ts                  # Initial source:"initial" envelope. [VERIFIED: server/routes/sse.ts]
    ├── chat.ts                 # Mutation source:"meal_mutation" envelopes after chat terminal frames. [VERIFIED: server/routes/chat.ts]
    └── meals.ts                # Direct PATCH/DELETE source:"meal_mutation" envelopes. [VERIFIED: server/routes/meals.ts]
client/src/
├── types.ts                    # Add DailySummarySSEPayload type. [VERIFIED: client/src/types.ts]
├── sse.ts                      # Strict parser/validator; no refetches. [VERIFIED: 63-CONTEXT.md]
├── sse-summary-coordinator.ts  # New small coordinator/helper for routing and latest-wins. [VERIFIED: 63-CONTEXT.md]
├── store.ts                    # Commit boundary; keep guarded setDailySummary and lastMealMutation. [VERIFIED: client/src/store.ts]
└── components/
    ├── MainLayout.tsx          # Wire coordinator into both connectSSE call sites and initial getMeals guard. [VERIFIED: client/src/components/MainLayout.tsx]
    ├── HistoryScreen.tsx       # Existing lastMealMutation selected-day/week refresh. [VERIFIED: client/src/components/HistoryScreen.tsx]
    └── HistoryDayDetailScreen.tsx # Add matching visible-date refresh path. [VERIFIED: client/src/components/HistoryDayDetailScreen.tsx]
```

### Pattern 1: Route-Owned Envelope, Publisher-Owned Fan-Out

**What:** Route helpers should pass the already computed `DailySummary`, `affectedDate`, and `source` to `RealtimePublisher.publishDailySummary`; the publisher should only serialize the payload and prune stale replies. [VERIFIED: `server/realtime/publisher.ts:27`, 63-CONTEXT.md]

**When to use:** Use for `/api/sse` initial summaries, chat meal mutations, and direct PATCH/DELETE meal mutations. [VERIFIED: `server/routes/sse.ts:45`, `server/routes/chat.ts:387`, `server/routes/meals.ts:99`]

**Example:**

```typescript
// Source: existing publisher fan-out pattern + Phase 63 envelope decision.
type DailySummarySSEPayload = {
  summary: DailySummary;
  affectedDate: string;
  source: "initial" | "meal_mutation";
};

publishDailySummary(deviceId: string, payload: DailySummarySSEPayload) {
  return this.publish(deviceId, "daily_summary", payload);
}
```

### Pattern 2: Transport Validation Before State Orchestration

**What:** `client/src/sse.ts` should parse the event, validate the envelope, validate `summary`, require real date keys, require `summary.date === affectedDate`, then dispatch the typed payload. [VERIFIED: 63-CONTEXT.md, `client/src/sse.ts:39`]

**When to use:** Use on every `daily_summary` frame, including initial, reconnect, same-day mutation, historical mutation, malformed, and future-date payloads. [VERIFIED: 63-CONTEXT.md]

**Example:**

```typescript
// Source: client/src/sse.ts goals_update silent-validation precedent + Phase 63 D-35.
eventSource.addEventListener("daily_summary", (event) => {
  try {
    const parsed = JSON.parse((event as MessageEvent<string>).data);
    if (isDailySummarySSEPayload(parsed)) handlers.onSummary(parsed);
  } catch {
    // Silent ignore: malformed frames mutate nothing.
  }
});
```

### Pattern 3: Latest-Wins Coordinator Tokens

**What:** A client helper should own monotonic request tokens for SSE same-day reconciliation and initial row-load overlap, and only the latest token can commit rows/summary. [VERIFIED: 63-CONTEXT.md]

**When to use:** Use for `source:"meal_mutation"` same-day events, reconnect snapshots with loaded rows, and `MainLayout` initial `getMeals()` results. [VERIFIED: 63-CONTEXT.md, `client/src/components/MainLayout.tsx:142`]

**Example:**

```typescript
// Source: React useEffect race-condition cleanup guidance and Phase 63 latest-wins decisions.
let coordinatorToken = 0;

async function reconcileSameDay(payload: DailySummarySSEPayload) {
  const token = ++coordinatorToken;
  try {
    const { meals } = await getMeals({ refreshReason: "meal_mutation" });
    if (token !== coordinatorToken) return;
    setMeals(meals);
    setDailySummary(payload.summary);
  } catch {
    // Preserve prior visible summary and rows.
  }
}
```

### Anti-Patterns to Avoid

- **Publisher reads from DB:** This violates the locked fan-out-only boundary and would bypass route/service test seams. [VERIFIED: 63-CONTEXT.md, AGENTS.md:55]
- **Calling `setDailySummary` for historical events:** `setDailySummary` treats non-today summaries as rollover mismatches and can trigger the rollover handler. [VERIFIED: `client/src/store.ts:265`, 63-CONTEXT.md]
- **Letting `JSON.parse` throw from `daily_summary`:** Current `daily_summary` lacks the silent guard already used by `goals_update`, and Phase 63 requires malformed frames mutate nothing. [VERIFIED: `client/src/sse.ts:29`, `client/src/sse.ts:39`, 63-CONTEXT.md]
- **Updating same-day summary before meal rows refetch:** This is the exact inconsistency Phase 63 closes. [VERIFIED: `.planning/REQUIREMENTS.md:33`, 63-CONTEXT.md]
- **Refreshing today for historical affected dates:** Historical invalidation must not refresh or overwrite today's rows. [VERIFIED: 63-CONTEXT.md]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Browser SSE transport | Custom long-polling/WebSocket layer | Native `EventSource` | Current app already uses EventSource, and SSE is one-way server-to-client. [VERIFIED: `client/src/sse.ts:27`, CITED: MDN Server-sent events] |
| Payload fan-out registry | New event bus or DB-backed subscriber store | Existing `RealtimePublisher.publish()` helper | It already serializes named events and removes stale replies. [VERIFIED: `server/realtime/publisher.ts:27`] |
| Date-key parser | Ad hoc string slicing only | Extract or mirror `history-week.ts` round-trip date validation | Existing parser checks `YYYY-MM-DD` and calendar round-trip. [VERIFIED: `client/src/lib/history-week.ts:63`] |
| History invalidation signal | Separate historical SSE store field | Existing `recordMealMutation(affectedDate)` / `lastMealMutation` nonce | History already observes the nonce and refreshes selected day/current week. [VERIFIED: `client/src/store.ts:162`, `client/src/components/HistoryScreen.tsx:500`] |
| Test framework | Jest/Vitest | Node built-in `node:test` and `assert/strict` | Repo policy and existing tests use Node test. [VERIFIED: AGENTS.md:68, `tests/unit/sse-client.test.ts:1`] |

**Key insight:** The hard part is not parsing an event; it is preventing independently resolving async loads from committing stale rows after a newer SSE event has already paired fresh rows with a fresh summary. [VERIFIED: 63-CONTEXT.md, CITED: React useEffect docs]

## Common Pitfalls

### Pitfall 1: Metadata-Only Envelope Without Historical Emission

**What goes wrong:** The publisher payload is widened, but `server/routes/chat.ts` and `server/routes/meals.ts` still return before publishing historical summaries. [VERIFIED: `server/routes/chat.ts:402`, `server/routes/meals.ts:108`]

**Why it happens:** Existing helpers were written for current-day summary fan-out and hard-code `summary.date === today`. [VERIFIED: `server/routes/chat.ts:402`, `server/routes/meals.ts:108`]

**How to avoid:** Replace today-only publish gates with route-level `affectedDate` checks that require `dailySummary.date === affectedDate`, then publish same-day and historical envelopes. [VERIFIED: 63-CONTEXT.md]

**Warning signs:** Historical direct DELETE tests that currently assert no `daily_summary` after historical mutation will fail and must be updated to expect a historical envelope instead of no event. [VERIFIED: `tests/integration/meals-api.test.ts:1308`]

### Pitfall 2: Direct `daily_summary` Callback Still Calls `setDailySummary`

**What goes wrong:** Valid historical events can hit the store date guard and trigger rollover behavior, or same-day events can update totals before rows refresh. [VERIFIED: `client/src/sse.ts:29`, `client/src/store.ts:265`]

**Why it happens:** Current `SSEHandlers.onSummary` accepts a raw `DailySummary`, not an envelope. [VERIFIED: `client/src/sse.ts:5`]

**How to avoid:** Change `onSummary` to receive `DailySummarySSEPayload` and route through a coordinator before any store commit. [VERIFIED: 63-CONTEXT.md]

**Warning signs:** Tests only assert callback count or `summary.date`, not state ordering. [VERIFIED: `tests/unit/sse-client.test.ts:72`, `tests/integration/sse.test.ts:246`]

### Pitfall 3: Initial `getMeals()` Race

**What goes wrong:** Initial row load resolves after a same-day mutation reconcile and overwrites fresher rows with older response data. [VERIFIED: 63-CONTEXT.md]

**Why it happens:** `MainLayout` currently starts initial `getMeals()` separately from the SSE subscription and directly commits `setMeals`. [VERIFIED: `client/src/components/MainLayout.tsx:142`, `client/src/components/MainLayout.tsx:153`]

**How to avoid:** Route initial row-load commits through the same coordinator token family used by SSE same-day reconcile. [VERIFIED: 63-CONTEXT.md]

**Warning signs:** New tests cover overlapping SSE and refetch promises but leave the mount-time `getMeals()` path unguarded. [VERIFIED: 63-CONTEXT.md]

### Pitfall 4: Day Detail Does Not Observe Historical Mutation Nonce

**What goes wrong:** Open Day Detail for a historical affected date keeps showing stale rows after a valid historical event. [VERIFIED: `client/src/components/HistoryDayDetailScreen.tsx:120`, 63-CONTEXT.md]

**Why it happens:** HistoryScreen observes `lastMealMutation`, but Day Detail currently fetches only on `dateKey` changes. [VERIFIED: `client/src/components/HistoryScreen.tsx:500`, `client/src/components/HistoryDayDetailScreen.tsx:120`]

**How to avoid:** Add Day Detail invalidation/refetch for matching `lastMealMutation.affectedDate`, with latest-wins for the visible date. [VERIFIED: 63-CONTEXT.md]

**Warning signs:** Planning assumes `recordMealMutation` automatically refreshes every historical surface. [VERIFIED: `client/src/components/HistoryScreen.tsx:500`, `client/src/components/HistoryDayDetailScreen.tsx:120`]

### Pitfall 5: Calendar-Format Validation Without Calendar-Reality Validation

**What goes wrong:** `2026-02-31` passes a regex and routes into history/date logic as if it were valid. [VERIFIED: 63-CONTEXT.md]

**Why it happens:** Regex alone checks shape, not date round-trip. [VERIFIED: `client/src/lib/history-week.ts:63`]

**How to avoid:** Use or extract a non-throwing variant of `parseDateKey` that verifies year, month, and day after constructing the local date. [VERIFIED: `client/src/lib/history-week.ts:66`]

**Warning signs:** Tests include invalid strings but not impossible calendar dates. [VERIFIED: 63-CONTEXT.md]

## Code Examples

Verified patterns from current sources and official docs:

### Strict `daily_summary` Envelope Guard

```typescript
// Source: client/src/api.ts isDailySummary guard + Phase 63 D-35.
function isDailySummary(value: unknown): value is DailySummary {
  return isRecord(value)
    && typeof value.date === "string"
    && typeof value.totalCalories === "number"
    && Number.isFinite(value.totalCalories)
    && typeof value.totalProtein === "number"
    && Number.isFinite(value.totalProtein)
    && typeof value.totalCarbs === "number"
    && Number.isFinite(value.totalCarbs)
    && typeof value.totalFat === "number"
    && Number.isFinite(value.totalFat)
    && typeof value.mealCount === "number"
    && Number.isFinite(value.mealCount);
}

function isDailySummarySSEPayload(value: unknown): value is DailySummarySSEPayload {
  if (!isRecord(value)) return false;
  if (value.source !== "initial" && value.source !== "meal_mutation") return false;
  if (typeof value.affectedDate !== "string" || !isRealDateKey(value.affectedDate)) return false;
  if (!isDailySummary(value.summary) || !isRealDateKey(value.summary.date)) return false;
  return value.summary.date === value.affectedDate;
}
```

### Non-Throwing Date-Key Validator

```typescript
// Source: client/src/lib/history-week.ts parseDateKey round-trip pattern.
const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function isRealDateKey(dateKey: string): boolean {
  const match = DATE_KEY_PATTERN.exec(dateKey);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  return date.getFullYear() === year
    && date.getMonth() === month - 1
    && date.getDate() === day;
}
```

### Historical Routing Without `setDailySummary`

```typescript
// Source: store lastMealMutation + Phase 63 D-26/D-27/D-39.
function handleHistorical(payload: DailySummarySSEPayload) {
  if (payload.affectedDate > todayKey()) return; // future product scope: ignore
  recordMealMutation(payload.affectedDate);
  // Visible History/Day Detail components decide whether to refetch.
}
```

### React Race Guard Pattern

```typescript
// Source: React docs useEffect fetch race cleanup pattern.
useEffect(() => {
  let ignore = false;
  fetchRows().then((rows) => {
    if (!ignore) setRows(rows);
  });
  return () => {
    ignore = true;
  };
}, [dateKey]);
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Raw `DailySummary` SSE payload | Strict `{ summary, affectedDate, source }` envelope | Phase 63 locked decision on 2026-05-18 | Enables client routing without adding revision IDs. [VERIFIED: 63-CONTEXT.md] |
| Same-day summary commit before meal-row freshness | Same-day row refetch must succeed before summary commit | Phase 63 locked decision on 2026-05-18 | Prevents fresh totals next to stale rows. [VERIFIED: 63-CONTEXT.md] |
| Historical mutation SSE suppressed | Historical affected-date envelope emitted and invalidated | Phase 63 locked decision on 2026-05-18 | Lets History/Day Detail refresh affected historical surfaces. [VERIFIED: 63-CONTEXT.md] |
| Component-local cancellation only | Coordinator-level latest-wins for SSE and initial loads | Phase 63 locked decision on 2026-05-18 | Covers races across `MainLayout` initial load and SSE refetches. [VERIFIED: 63-CONTEXT.md, CITED: React useEffect docs] |

**Deprecated/outdated:**
- Current raw `daily_summary` client callback shape is outdated for Phase 63 because it cannot carry `affectedDate` or `source`. [VERIFIED: `client/src/sse.ts:5`, 63-CONTEXT.md]
- Current historical no-publish behavior is outdated for Phase 63 because server routes must emit historical affected-date envelopes. [VERIFIED: `tests/integration/meals-api.test.ts:1308`, 63-CONTEXT.md]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|

All claims in this research were verified against phase context, codebase files, local package metadata, npm registry checks, or cited official docs; no `[ASSUMED]` claims are used. [VERIFIED: codebase grep, npm registry, cited docs]

## Open Questions (RESOLVED)

1. **Coordinator module placement**
   - What we know: Phase context leaves exact helper name and placement to the planner. [VERIFIED: 63-CONTEXT.md]
   - RESOLVED: Phase 63 plans use `client/src/sse-summary-coordinator.ts` as the dedicated coordinator module, with `MainLayout.tsx` wiring both `connectSSE` call sites and initial `getMeals()` commits through that helper. [VERIFIED: 63-04-PLAN.md]
   - Rationale: This keeps request-token, today-versus-historical routing, future-date ignore, refetch-first, and drop-on-failure behavior local to client SSE orchestration instead of accumulating that logic in `MainLayout.tsx` or moving orchestration into `client/src/store.ts`. [VERIFIED: 63-CONTEXT.md, AGENTS.md:56]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | TypeScript tests/scripts | yes | v24.14.0 | None needed. [VERIFIED: `node --version`] |
| Yarn classic | Repo commands | yes | 1.22.22 | None; project requires yarn. [VERIFIED: `yarn --version`, AGENTS.md:60] |
| npm CLI | Registry version lookup only | yes | 11.9.0 | Use registry web docs if npm unavailable. [VERIFIED: `npm --version`] |
| gsd-sdk | Phase init/commit | yes | v1.41.2 | Manual artifact write if unavailable. [VERIFIED: `gsd-sdk --version`] |
| Browser EventSource | Runtime SSE | Browser API | Baseline widely available since January 2020 per MDN | No fallback planned in Phase 63. [CITED: MDN Server-sent events] |

**Missing dependencies with no fallback:**
- None found for research and planning. [VERIFIED: environment probe]

**Missing dependencies with fallback:**
- None found for research and planning. [VERIFIED: environment probe]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Node built-in `node:test` with `assert/strict`. [VERIFIED: AGENTS.md:68, `tests/unit/sse-client.test.ts:1`] |
| Config file | No Jest/Vitest config; scripts live in `package.json`. [VERIFIED: `package.json:14`] |
| Quick run command | `yarn test:unit` for client parser/coordinator/store unit coverage; targeted command may be `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/sse-client.test.ts tests/unit/store.test.ts`. [VERIFIED: `package.json:15`, AGENTS.md:75] |
| Full suite command | `yarn test` before phase completion; `yarn release:check` remains promotion/closeout gate, not every small edit. [VERIFIED: `package.json:14`, `package.json:10`, AGENTS.md:81] |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| REAL-01 | Initial and mutation `daily_summary` frames use strict envelope with `summary`, `affectedDate`, and `source`. | integration | `yarn test:integration` or targeted `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/sse.test.ts tests/integration/meals-api.test.ts tests/integration/chat-api.test.ts` | Existing files yes; assertions need updates. [VERIFIED: tests grep] |
| REAL-02 | Same-day mutation/reconnect events refetch rows before summary commit and drop summary on refetch failure. | unit | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/sse-client.test.ts tests/unit/store.test.ts` plus new coordinator test file if extracted. | Partial existing; coordinator file/test likely Wave 0. [VERIFIED: `tests/unit/sse-client.test.ts`, `tests/unit/store.test.ts`] |
| REAL-03 | Malformed, mismatched, future, and historical events mutate no current-day rows/summary incorrectly. | unit + integration | `yarn test:unit` and targeted SSE integration tests. | Partial existing; malformed `goals_update` precedent exists, `daily_summary` cases need new coverage. [VERIFIED: `tests/unit/sse-client.test.ts:125`, 63-CONTEXT.md] |

### Sampling Rate

- **Per task commit:** Run the narrow command matching touched files; any TypeScript edit also runs `yarn tsc --noEmit`. [VERIFIED: AGENTS.md:75]
- **Per wave merge:** Run `yarn test:unit` for client coordinator/parser work and `yarn test:integration` for route/publisher envelope work. [VERIFIED: AGENTS.md:76, AGENTS.md:77]
- **Phase gate:** Run `yarn tsc --noEmit` and `yarn test`; run `yarn release:check` only when closing/promoting per roadmap proof policy. [VERIFIED: AGENTS.md:43, AGENTS.md:45, `.planning/REQUIREMENTS.md:40`]

### Wave 0 Gaps

- [ ] `client/src/sse-summary-coordinator.ts` and matching `tests/unit/sse-summary-coordinator.test.ts` if the planner extracts coordinator logic. [VERIFIED: 63-CONTEXT.md]
- [ ] Update `tests/unit/sse-client.test.ts` to cover strict `daily_summary` envelope validation, malformed JSON, invalid `source`, invalid date key, impossible date, and `summary.date !== affectedDate`. [VERIFIED: `tests/unit/sse-client.test.ts:72`, 63-CONTEXT.md]
- [ ] Update `tests/integration/sse.test.ts` to assert initial envelope shape and post-mutation envelope shape. [VERIFIED: `tests/integration/sse.test.ts:170`, `tests/integration/sse.test.ts:246`]
- [ ] Update historical no-event assertions in integration tests to expect historical affected-date envelopes without today-row refresh semantics. [VERIFIED: `tests/integration/meals-api.test.ts:1308`, 63-CONTEXT.md]
- [ ] Add Day Detail refresh coverage if implementation wires `lastMealMutation` into `HistoryDayDetailScreen`. [VERIFIED: `client/src/components/HistoryDayDetailScreen.tsx:120`, 63-CONTEXT.md]

## Security Domain

Security enforcement is enabled because `.planning/config.json` does not set `security_enforcement` to `false`. [VERIFIED: `.planning/config.json`]

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | yes | Preserve cookie-backed guest-session resolution for `/api/sse`; do not add raw `deviceId` or header auth for EventSource. [VERIFIED: `server/routes/sse.ts:21`, AGENTS.md:64] |
| V3 Session Management | yes | Keep active/resume cookie handling through `resolveGuestSession` and `guestSessionService`. [VERIFIED: `server/routes/sse.ts:21`, `.planning/codebase/INTEGRATIONS.md`] |
| V4 Access Control | yes | Publisher remains keyed by authenticated `deviceId`; route ownership comes from cookies. [VERIFIED: `server/routes/sse.ts:21`, `server/realtime/publisher.ts:8`] |
| V5 Input Validation | yes | Strictly validate untrusted SSE payloads before invoking coordinator or store actions. [VERIFIED: `client/src/sse.ts:39`, 63-CONTEXT.md] |
| V6 Cryptography | no direct new crypto | Do not touch guest-session signing. [VERIFIED: `.planning/codebase/INTEGRATIONS.md`] |

### Known Threat Patterns for SSE + Client State

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Malformed/spoofed SSE frame crashes event loop or mutates state | Tampering / DoS | `try/catch` JSON parsing plus strict envelope guard and silent ignore. [VERIFIED: `client/src/sse.ts:39`, 63-CONTEXT.md] |
| Historical event overwrites current-day summary | Tampering | Coordinator routes non-today events away from `setDailySummary`. [VERIFIED: `client/src/store.ts:265`, 63-CONTEXT.md] |
| Unauthorized SSE subscription | Spoofing | Preserve `resolveGuestSession` on `/api/sse`; no device query/header trust. [VERIFIED: `server/routes/sse.ts:21`, AGENTS.md:52] |
| Raw user/provider data leaks into proof/logs | Information Disclosure | Keep new logs/tests metadata-only and do not store raw prompts, user text, assistant final text, tool payloads, provider bodies, images, session material, or database snapshots. [VERIFIED: `.planning/REQUIREMENTS.md:39`, AGENTS.md] |

## Sources

### Primary (HIGH confidence)
- `.planning/phases/63-sse-meal-row-freshness-and-affected-date-invalidation/63-CONTEXT.md` - Locked envelope, same-day matrix, historical invalidation, validation guardrails, server emission constraints. [VERIFIED: file read]
- `.planning/REQUIREMENTS.md` - REAL-01, REAL-02, REAL-03, proof/privacy constraints. [VERIFIED: file read]
- `AGENTS.md` - Project constraints, yarn-only workflow, route/store boundaries, verification matrix, SSE gotchas. [VERIFIED: file read]
- `server/realtime/publisher.ts`, `server/routes/sse.ts`, `server/routes/chat.ts`, `server/routes/meals.ts` - Current SSE fan-out and publish gates. [VERIFIED: codebase read]
- `client/src/sse.ts`, `client/src/store.ts`, `client/src/components/MainLayout.tsx`, `client/src/components/HistoryScreen.tsx`, `client/src/components/HistoryDayDetailScreen.tsx` - Current client parser, state commit, row load, and history invalidation behavior. [VERIFIED: codebase read]
- `tests/unit/sse-client.test.ts`, `tests/integration/sse.test.ts`, `tests/integration/chat-api.test.ts`, `tests/integration/meals-api.test.ts` - Existing test seams for parser and SSE route behavior. [VERIFIED: codebase read]
- `package.json`, local `node_modules/*/package.json`, npm registry - Installed and latest package versions. [VERIFIED: local package metadata, npm registry]

### Secondary (MEDIUM confidence)
- MDN Server-sent events - EventSource usage, custom event names, event stream format, reconnect behavior, baseline browser availability. [CITED: https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events]
- React `useEffect` reference - Cleanup/ignore race-condition pattern for async effects. [CITED: https://react.dev/reference/react/useEffect]
- WHATWG HTML server-sent events - `Last-Event-ID`, `text/event-stream`, and event stream format details. [CITED: https://html.spec.whatwg.org/dev/server-sent-events.html]

### Tertiary (LOW confidence)
- None. [VERIFIED: source review]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - Existing stack and installed versions were verified locally, with registry versions checked for currency. [VERIFIED: local node_modules, npm registry]
- Architecture: HIGH - Boundaries are locked in context and confirmed in code. [VERIFIED: 63-CONTEXT.md, codebase read]
- Pitfalls: HIGH - Each pitfall maps to an existing code path or locked decision. [VERIFIED: codebase read, 63-CONTEXT.md]

**Research date:** 2026-05-18
**Valid until:** 2026-06-17 for codebase architecture; re-check npm registry versions if dependency upgrades enter scope. [VERIFIED: npm registry]
