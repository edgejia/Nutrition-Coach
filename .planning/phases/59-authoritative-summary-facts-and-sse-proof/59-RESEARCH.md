# Phase 59: Authoritative Summary Facts and SSE Proof - Research

**Researched:** 2026-05-16 [VERIFIED: system date]
**Domain:** Backend fact rendering, LLM advice containment, Fastify SSE terminal proof, Node test/harness validation [VERIFIED: `.planning/ROADMAP.md`]
**Confidence:** HIGH for codebase architecture and validation commands; MEDIUM for exact renderer wording until planner locks copy details [VERIFIED: codebase grep] [VERIFIED: `.planning/phases/59-authoritative-summary-facts-and-sse-proof/59-CONTEXT.md`]

<user_constraints>
## User Constraints (from CONTEXT.md) [VERIFIED: `.planning/phases/59-authoritative-summary-facts-and-sse-proof/59-CONTEXT.md`]

### Locked Decisions

#### Authoritative summary/history facts
- D-01: Persisted meal records are the only authoritative source for concrete meal names and per-meal kcal facts in summary/history output.
- D-02: Aggregate daily totals can support day-level totals only. They must not authorize invented meal names, fake meal lists, macro attribution, or assigning the full daily total to one named meal.
- D-03: Backend summary/history replies must include a deterministic fact segment rendered from persisted facts for meal names, meal count, day total kcal, and per-meal kcal.
- D-04: Empty-day summary replies must preserve summary semantics such as `0 餐 / 0 kcal` and must not fall back to mutation-failure copy such as `我還沒有把這餐寫入紀錄`.

#### Advice isolation
- D-05: Final summary/history replies must separate deterministic backend fact text from optional LLM advice text.
- D-06: Optional LLM advice cannot introduce concrete persisted meal names, per-meal kcal, macro attribution, meal count, or day total facts.
- D-07: JSON, SSE, and non-SSE final reply paths must use the same fact renderer and advice guard.
- D-08: The existing final guard remains as defense-in-depth, not the primary correctness mechanism.

#### SSE proof
- D-09: SSE proof must drain through stream close instead of stopping at the first `event: done`.
- D-10: SSE proof must fail if any `chunk` or `status` frame appears after the first `done`.
- D-11: Harness artifacts must store structured metadata such as first done observed, stream closed, and no post-done frames; they must not persist raw SSE frame transcripts.

#### Release boundary
- D-12: Do not promote, merge, deploy, fast-forward, rebase, or push toward `staging` or `main` as part of this phase.
- D-13: Out of scope: goal proposal confirmation, failed `update_goals` outcome rendering, stale chat receipts, cross-tab meal row invalidation, product-polish backlog items, water tracking, monthly history, onboarding animation, and motion-system work.

### the agent's Discretion
- Choose the smallest code organization that makes persisted fact rendering authoritative across all final reply paths.
- Choose whether the SSE proof belongs in an existing harness scenario, a targeted integration helper, or a focused harness helper update, as long as it is machine-checkable and stores structured metadata only.
- Choose exact function names, file splits, and test placement by following existing route/orchestrator/harness patterns.

### Deferred Ideas (OUT OF SCOPE)
- Goal proposal confirmation.
- Failed `update_goals` outcome rendering.
- Stale chat receipts.
- Cross-tab meal row invalidation.
- Product polish backlog items such as water tracking, monthly history, onboarding animation, and motion-system work.
- Staging or production promotion.
</user_constraints>

<phase_requirements>
## Phase Requirements [VERIFIED: `.planning/REQUIREMENTS.md`]

| ID | Description | Research Support |
|----|-------------|------------------|
| AUTH-01 | Backend summary/history replies use persisted meal records as the authoritative source for meal names, meal count, day total kcal, and per-meal kcal. | Use `foodLoggingService.getMealsByDate()` for meal facts and `summaryService.getDailySummary()` only for day aggregates. [VERIFIED: `server/services/food-logging.ts`] [VERIFIED: `server/services/summary.ts`] |
| AUTH-02 | Aggregate daily totals cannot authorize invented meal names or assigning the full day total to one named meal. | Keep aggregate totals in the deterministic renderer only; do not use aggregate totals to validate model-authored meal-specific text. [VERIFIED: `.planning/notes/v2-2-post-review-blocker-reopened.md`] |
| AUTH-03 | Summary/history replies are split into deterministic backend-rendered fact text plus optional LLM advice text. | Add a shared renderer/composer used before response/history persistence. [VERIFIED: `server/routes/chat.ts`] |
| AUTH-04 | Optional LLM advice cannot introduce concrete persisted meal names, per-meal kcal, macro attribution, meal count, or day total facts. | Add a conservative advice guard that drops advice on forbidden concrete facts; keep `guardNoMutationLoggingClaim()` as fallback defense. [VERIFIED: `server/orchestrator/index.ts`] [VERIFIED: `.planning/phases/59-authoritative-summary-facts-and-sse-proof/59-CONTEXT.md`] |
| STREAM-01 | SSE proof drains through stream close instead of stopping at the first `event: done`. | Reuse or harden `readStreamThroughClose()` rather than `readStreamUntilEvent(..., "done")` for promotion proof. [VERIFIED: `tests/harness/sse.ts`] |
| STREAM-02 | SSE proof fails if any `chunk` or `status` frame appears after the first `done`. | Test the terminal-proof predicate with synthetic post-done `chunk` and `status` frames and run the harness scenario against real route output. [VERIFIED: `tests/harness/scenarios/image-log-failure.ts`] |
| STREAM-03 | Harness artifacts store structured SSE proof metadata, not raw SSE frame transcripts. | Persist booleans/counts/event names such as `closed`, `firstDoneIndex`, `terminalViolationEvents`, and `rawLength`; avoid `rawSSE`, `streamFrames`, and `sseTranscript` artifact keys. [VERIFIED: `tests/harness/artifacts.ts`] [VERIFIED: current `tests/harness/artifacts/image-log-failure/latest/*.json`] |
</phase_requirements>

## Summary

Phase 59 should be planned as a backend state-boundary refactor, not another regex-parser repair. [VERIFIED: `.planning/notes/v2-2-post-review-blocker-reopened.md`] The current code already exposes persisted meal facts through `get_daily_summary` and passes those facts through `summaryHistoryFacts`, but the final summary/history text can still originate from model output and survive through `guardNoMutationLoggingClaim()` when it appears fact-grounded. [VERIFIED: `server/orchestrator/tools.ts`] [VERIFIED: `server/orchestrator/index.ts`] [VERIFIED: `server/routes/chat.ts`]

The planner should introduce one shared summary/history composer that renders deterministic facts from persisted rows and appends only advice that passes a conservative guard. [VERIFIED: `.planning/phases/59-authoritative-summary-facts-and-sse-proof/59-CONTEXT.md`] JSON, non-SSE drained streams, and live SSE should all call that composer before saving assistant history or emitting final visible text. [VERIFIED: `server/routes/chat.ts`]

The SSE side should use the existing through-close collector pattern but make the proof phase-specific and negative-testable. [VERIFIED: `tests/harness/sse.ts`] Existing `image-log-failure` evidence already records structured terminal metadata for close/done/post-done checks, but the planner should add or update tests so post-done `chunk` and `status` frames are proven to fail deterministically. [VERIFIED: `tests/harness/scenarios/image-log-failure.ts`] [VERIFIED: `tests/harness/artifacts/image-log-failure/latest/snapshots.json`]

**Primary recommendation:** Add `server/orchestrator/summary-history-renderer.ts` with `renderSummaryHistoryFacts()`, `guardSummaryHistoryAdvice()`, and `composeSummaryHistoryReply()`, then route every summary/history final path through it and update harness SSE proof to drain through close with structured-only artifacts. [VERIFIED: codebase grep]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Persisted meal fact retrieval | Database / Storage | API / Backend | Meal names and per-meal kcal live in meal transaction/revision storage and are surfaced by `foodLoggingService.getMealsByDate()`. [VERIFIED: `server/db/schema.ts`] [VERIFIED: `server/services/food-logging.ts`] |
| Daily aggregate totals | Database / Storage | API / Backend | `summaryService.getDailySummary()` computes aggregate totals and meal count from active meal transactions/items. [VERIFIED: `server/services/summary.ts`] |
| Deterministic fact segment rendering | API / Backend | Frontend Server (SSR): — | The backend must render authoritative final text before route response/history persistence. [VERIFIED: `.planning/phases/59-authoritative-summary-facts-and-sse-proof/59-CONTEXT.md`] |
| Optional advice generation | API / Backend | LLM provider boundary | The LLM can provide advice, but advice is untrusted until the backend guard accepts it. [VERIFIED: `.planning/notes/v2-2-post-review-blocker-reopened.md`] |
| JSON and non-SSE final reply enforcement | API / Backend | — | `server/routes/chat.ts` drains model streams for JSON and calls final guards before `finalizeAssistantReply()` and `reply.send()`. [VERIFIED: `server/routes/chat.ts`] |
| Live SSE final reply enforcement | API / Backend | Browser / Client | The route owns `text/event-stream` emission and must not write unsafe chunks before final guard/composer output. [VERIFIED: `server/routes/chat.ts`] [CITED: https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events] |
| Harness proof artifacts | Test Harness | Filesystem | `writeScenarioArtifacts()` writes redacted JSON artifacts under `tests/harness/artifacts/<scenario>/latest/`. [VERIFIED: `tests/harness/artifacts.ts`] |

## Project Constraints (from AGENTS.md)

- Use `feature/* -> staging -> main`; do not touch `main` without explicit current-thread production promotion approval. [VERIFIED: `AGENTS.md`]
- Do not promote, merge, deploy, push, fast-forward, or rebase toward `staging` or `main` in Phase 59. [VERIFIED: `AGENTS.md`] [VERIFIED: `59-CONTEXT.md`]
- Use `yarn` only for repo commands and package workflow. [VERIFIED: `AGENTS.md`]
- Run `yarn release:check` before any later merge to `staging` or `main`; this phase can record it as a local gate but still must not promote. [VERIFIED: `AGENTS.md`]
- Keep `server/app.ts` as backend composition root for service/route wiring. [VERIFIED: `AGENTS.md`] [VERIFIED: `server/app.ts`]
- Keep HTTP/SSE validation, auth checks, stream framing, and response shaping in `server/routes/*.ts`. [VERIFIED: `AGENTS.md`]
- Keep reusable domain and persistence logic in `server/services/*.ts`; do not instantiate LLM clients inside services. [VERIFIED: `AGENTS.md`]
- Keep model workflow, tool execution, prompts, and fallback behavior in `server/orchestrator/*`. [VERIFIED: `AGENTS.md`]
- Use explicit `.js` specifiers in local TypeScript imports. [VERIFIED: `AGENTS.md`]
- Preserve DI: runtime uses `OpenAIProvider`; tests use `MockLLMProvider` or harness providers. [VERIFIED: `AGENTS.md`] [VERIFIED: `tests/harness/streaming-llm.ts`]
- Preserve `TZ=Asia/Taipei` for local/test day-boundary behavior. [VERIFIED: `AGENTS.md`] [VERIFIED: `tests/harness/app-fixture.ts`]
- `GET /api/sse` uses cookie-backed guest sessions because browser `EventSource` cannot set custom headers. [VERIFIED: `AGENTS.md`]
- Use Node built-in `node:test`; do not introduce Jest or Vitest without explicit migration. [VERIFIED: `AGENTS.md`] [CITED: https://nodejs.org/api/test.html]
- Use real SQLite in tests; `:memory:` is acceptable and DB mocking is not. [VERIFIED: `AGENTS.md`] [VERIFIED: `tests/harness/app-fixture.ts`]
- Treat `tests/harness/artifacts/**` as generated evidence; regenerate with matching harness command and do not hand-edit. [VERIFIED: `AGENTS.md`]
- Any `*.ts` edit requires `yarn tsc --noEmit`; route/service edits require `yarn test:integration`; unit test edits require `yarn test:unit`; harness scenario edits require `yarn verify:harness -- <scenario>`. [VERIFIED: `AGENTS.md`]
- `server/routes/chat.ts` has strict SSE `status` / `chunk` / `done`, summary publish, and upload cleanup invariants. [VERIFIED: `AGENTS.md`] [VERIFIED: `server/routes/chat.ts`]

## Standard Stack

### Core

| Library | Installed Version | Latest Verified | Purpose | Why Standard |
|---------|-------------------|-----------------|---------|--------------|
| Node.js | v24.14.0 local runtime [VERIFIED: `node --version`] | Docs checked against current Node test runner docs [CITED: https://nodejs.org/api/test.html] | Runtime and built-in `node:test` execution | Existing scripts use `node scripts/run-node-with-tz.mjs --import tsx --test`; no new test runner should be introduced. [VERIFIED: `package.json`] [VERIFIED: `AGENTS.md`] |
| Fastify | 5.8.4 in `yarn.lock` [VERIFIED: `yarn.lock`] | 5.8.5, published 2026-04-14 [VERIFIED: npm registry] | HTTP app, route injection, SSE response transport | Existing `buildApp()` composes Fastify routes/services and tests use app fixtures; Fastify docs support `inject()` for booted-route HTTP tests. [VERIFIED: `server/app.ts`] [CITED: https://fastify.dev/docs/v5.7.x/Guides/Testing/] |
| Drizzle ORM | 0.39.3 in `yarn.lock` [VERIFIED: `yarn.lock`] | 0.45.2, published 2026-03-27 [VERIFIED: npm registry] | SQLite query builder/schema mapping | Existing services use Drizzle builders over meal transaction/revision tables. [VERIFIED: `server/services/summary.ts`] [VERIFIED: `server/db/schema.ts`] |
| better-sqlite3 | 11.10.0 in `yarn.lock` [VERIFIED: `yarn.lock`] | 12.10.0, published 2026-05-12 [VERIFIED: npm registry] | Local SQLite driver | Existing app/test fixtures use SQLite, including `:memory:` for deterministic tests. [VERIFIED: `tests/harness/app-fixture.ts`] |
| tsx | 4.21.0 in `yarn.lock` [VERIFIED: `yarn.lock`] | 4.22.0, published 2026-05-14 [VERIFIED: npm registry] | TypeScript execution in Node tests and scripts | Existing scripts run TS directly with `--import tsx`. [VERIFIED: `package.json`] |
| TypeScript | 5.9.3 in `yarn.lock` [VERIFIED: `yarn.lock`] | 6.0.3, published 2026-04-16 [VERIFIED: npm registry] | Static type gate | Existing verification matrix requires `yarn tsc --noEmit` for TS edits. [VERIFIED: `AGENTS.md`] |

### Supporting

| Library | Installed Version | Latest Verified | Purpose | When to Use |
|---------|-------------------|-----------------|---------|-------------|
| zod | 4.3.6 in `yarn.lock` [VERIFIED: `yarn.lock`] | 4.4.3, published 2026-05-04 [VERIFIED: npm registry] | Tool/route input validation | Keep existing tool schemas and add no new validation framework. [VERIFIED: `server/orchestrator/tools.ts`] |
| @fastify/multipart | 9.4.0 in `yarn.lock` [VERIFIED: `yarn.lock`] | 10.0.0, published 2026-04-07 [VERIFIED: npm registry] | Multipart chat/image route parsing | Phase 59 should not change upload parsing; relevant because `image-log-failure` harness exercises SSE + upload cleanup. [VERIFIED: `server/app.ts`] [VERIFIED: `tests/harness/scenarios/image-log-failure.ts`] |
| @fastify/cors | 11.2.0 in `yarn.lock` [VERIFIED: `yarn.lock`] | 11.2.0, published 2025-12-09 [VERIFIED: npm registry] | CORS plugin | No Phase 59 change expected. [VERIFIED: `server/app.ts`] |
| @fastify/static | 9.1.1 in `yarn.lock` [VERIFIED: `yarn.lock`] | 9.1.3, published 2026-04-21 [VERIFIED: npm registry] | Built client serving | No Phase 59 change expected. [VERIFIED: `server/app.ts`] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Shared backend renderer | More model prompt instructions | Rejected for this phase because the locked decision requires backend-rendered deterministic facts, not model-authored facts. [VERIFIED: `59-CONTEXT.md`] |
| Conservative advice drop | Complex natural-language fact parser | Rejected as primary correctness because prior repair rounds showed parser/regex patches can miss aggregate bypasses. [VERIFIED: `.planning/notes/v2-2-post-review-blocker-reopened.md`] |
| `readStreamThroughClose()` | Existing `readStreamUntilEvent(reader, "done")` | Rejected for promotion proof because the locked requirement is to observe close and detect post-done frames. [VERIFIED: `59-CONTEXT.md`] [VERIFIED: `tests/harness/sse.ts`] |
| Node `node:test` | Jest/Vitest | Rejected by project policy. [VERIFIED: `AGENTS.md`] |

**Installation:**
```bash
# No new packages recommended for Phase 59.
yarn install --frozen-lockfile
```

**Version verification:** Installed versions were verified from `yarn.lock`; latest registry versions and publish dates were verified with read-only registry fetches on 2026-05-16. [VERIFIED: `yarn.lock`] [VERIFIED: npm registry]

## Architecture Patterns

### System Architecture Diagram

```text
User summary/history request
  -> POST /api/chat JSON or SSE route
  -> Orchestrator asks LLM for tool call
  -> get_daily_summary tool
       -> summaryService.getDailySummary(deviceId, date)
            -> aggregate day total + meal count
       -> foodLoggingService.getMealsByDate(deviceId, date)
            -> persisted meal names + per-meal kcal
  -> SummaryHistoryFacts
  -> Shared summary/history composer
       -> deterministic fact segment from persisted facts
       -> optional model advice through advice guard
          -> if advice contains persisted meal names, kcal, macros, meal count, or day totals: drop advice
          -> else append advice
  -> Defense-in-depth final guard
  -> Response path
       -> JSON: save assistant reply, send JSON
       -> non-SSE stream drained as JSON: drain, compose, save, send JSON
       -> live SSE: hold summary-context tokens, compose, emit chunk(s), emit done, close stream
  -> Tests/harness
       -> unit renderer/advice tests
       -> JSON + SSE integration regressions
       -> SSE through-close proof with structured artifacts
```

### Recommended Project Structure

```text
server/
├── orchestrator/
│   ├── summary-history-renderer.ts   # deterministic fact renderer + advice guard
│   ├── index.ts                      # orchestrator state flow; defense-in-depth guard remains
│   └── tools.ts                      # get_daily_summary facts contract stays here
├── routes/
│   └── chat.ts                       # JSON/non-SSE/SSE compose-before-save/emit paths
tests/
├── unit/
│   ├── summary-history-renderer.test.ts  # renderer/advice guard contract
│   ├── orchestrator.test.ts              # orchestration wiring regressions
│   └── verification-artifacts.test.ts    # artifact redaction/structured-only proof
├── integration/
│   ├── chat-api.test.ts                  # JSON summary/history final reply regressions
│   └── chat-streaming.test.ts            # SSE summary/history final reply regressions
└── harness/
    ├── sse.ts                            # through-close collector + terminal-proof helper
    └── scenarios/image-log-failure.ts    # or focused scenario chosen by planner
```

### Pattern 1: Deterministic Fact Renderer

**What:** Build summary/history fact text only from `SummaryHistoryFacts.dailySummary` and `SummaryHistoryFacts.meals`. [VERIFIED: `server/orchestrator/index.ts`] [VERIFIED: `server/orchestrator/tools.ts`]

**When to use:** Use whenever `get_daily_summary` succeeded and final output is a summary/history reply. [VERIFIED: `.planning/REQUIREMENTS.md`]

**Example:**
```typescript
// Source: codebase pattern from server/orchestrator/tools.ts + Phase 59 locked decisions
export interface SummaryHistoryFacts {
  dailySummary?: DailySummary;
  meals: Array<{ foodName: string; calories: number }>;
}

export function renderSummaryHistoryFacts(facts: SummaryHistoryFacts): string {
  const summary = facts.dailySummary;
  if (!summary || summary.mealCount === 0 || facts.meals.length === 0) {
    return "今天已記錄 0 餐，共 0 kcal。";
  }

  const mealList = facts.meals
    .map((meal) => `${meal.foodName} ${formatCalories(meal.calories)} kcal`)
    .join("、");
  return `今天已記錄 ${summary.mealCount} 餐，共 ${formatCalories(summary.totalCalories)} kcal：${mealList}。`;
}
```

### Pattern 2: Advice Is Optional and Disposable

**What:** Treat LLM text after a summary/history tool call as optional advice, not fact text. [VERIFIED: `.planning/phases/59-authoritative-summary-facts-and-sse-proof/59-CONTEXT.md`]

**When to use:** Use in JSON, drained non-SSE stream, and SSE final paths before assistant history persistence. [VERIFIED: `server/routes/chat.ts`]

**Example:**
```typescript
// Source: Phase 59 D-05/D-06 and existing route finalization pattern
export function composeSummaryHistoryReply(
  facts: SummaryHistoryFacts,
  advice: string | undefined,
): string {
  const factSegment = renderSummaryHistoryFacts(facts);
  const safeAdvice = guardSummaryHistoryAdvice(advice ?? "", facts);
  return safeAdvice ? `${factSegment}\n\n${safeAdvice}` : factSegment;
}
```

### Pattern 3: SSE Terminal Proof Through Close

**What:** Read until `ReadableStream` close, record `firstDoneIndex`, `closed`, and post-done terminal violations, then fail on post-done `chunk` or `status`. [VERIFIED: `tests/harness/sse.ts`] [VERIFIED: `tests/harness/scenarios/image-log-failure.ts`]

**When to use:** Use for promotion-blocking SSE proof, not ordinary integration tests that only need done payloads. [VERIFIED: `.planning/REQUIREMENTS.md`]

**Example:**
```typescript
// Source: tests/harness/sse.ts and image-log-failure.ts
const collected = await readStreamThroughClose(res.body.getReader(), {
  maxReads: 60,
  readTimeoutMs: 5000,
});
const terminalViolations = collected.eventsAfterFirstDone
  .filter((event) => event.event === "chunk" || event.event === "status");
assert.equal(collected.closed, true);
assert.notEqual(collected.firstDoneIndex, -1);
assert.deepEqual(terminalViolations, []);
```

### Anti-Patterns to Avoid

- **Letting aggregate totals validate meal facts:** Aggregate totals can support day-total text only, not meal names or per-meal kcal. [VERIFIED: `59-CONTEXT.md`]
- **Streaming model summary tokens before final advice guard:** Existing summary-context streaming holds tokens before final guard; keep or strengthen that hold so unsafe advice cannot leak as chunks. [VERIFIED: `server/routes/chat.ts`]
- **Forking JSON and SSE fact logic:** Use one composer for JSON, non-SSE drained stream, and SSE to satisfy AUTH-04. [VERIFIED: `.planning/REQUIREMENTS.md`]
- **Hand-editing harness artifacts:** Regenerate artifacts with `yarn verify:harness -- <scenario>`. [VERIFIED: `AGENTS.md`]
- **Persisting raw SSE transcripts:** The artifact writer omits keys such as `sseTranscript` and `streamFrames`; phase proof should store structured metadata only. [VERIFIED: `tests/harness/artifacts.ts`]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Meal fact authority | Do not infer meal names/kcal from LLM reply text. | Persisted meal rows via `foodLoggingService.getMealsByDate()`. | Locked requirement makes persisted rows the sole authority for concrete meal facts. [VERIFIED: `59-CONTEXT.md`] |
| Daily aggregates | Do not derive day totals by summing model text or route chunks. | `summaryService.getDailySummary()`. | Existing service already computes active transaction/item aggregates with Drizzle. [VERIFIED: `server/services/summary.ts`] |
| Advice validation | Do not build a permissive parser that “repairs” model fact claims. | Conservative advice guard that drops advice when concrete facts appear. | Prior parser repairs left bypasses; backend facts must be primary. [VERIFIED: `.planning/notes/v2-2-post-review-blocker-reopened.md`] |
| SSE proof collection | Do not stop at first `event: done`. | `readStreamThroughClose()` plus terminal-proof assertions. | STREAM-01 requires stream close observation. [VERIFIED: `.planning/REQUIREMENTS.md`] |
| Harness artifact writing | Do not write ad hoc files or raw transcripts. | `writeScenarioArtifacts()`. | Existing writer redacts sensitive/raw payload keys and standardizes `latest/` evidence files. [VERIFIED: `tests/harness/artifacts.ts`] |
| HTTP route tests | Do not mock Fastify transport. | `buildApp()` fixtures and `app.inject()`/real fetch patterns. | Project tests already use real app fixtures; Fastify supports injection after plugin boot. [VERIFIED: `tests/harness/app-fixture.ts`] [CITED: https://fastify.dev/docs/v5.7.x/Guides/Testing/] |
| Test framework | Do not add Jest/Vitest. | Node built-in `node:test` via existing scripts. | Project policy requires `node:test`. [VERIFIED: `AGENTS.md`] |

**Key insight:** Phase 59 correctness should come from a state boundary: persisted facts render facts, untrusted model text can only add advice, and all final transports share the same composer. [VERIFIED: `.planning/phases/59-authoritative-summary-facts-and-sse-proof/59-CONTEXT.md`]

## Common Pitfalls

### Pitfall 1: Keeping the Guard as the Primary Renderer
**What goes wrong:** Model-authored summary text remains the source of truth when `guardNoMutationLoggingClaim()` decides it is close enough. [VERIFIED: `server/orchestrator/index.ts`]  
**Why it happens:** The current guard validates claims after model generation instead of rendering facts first. [VERIFIED: `server/orchestrator/index.ts`]  
**How to avoid:** Render the deterministic fact segment before composing the final reply and keep the guard only after composition. [VERIFIED: `59-CONTEXT.md`]  
**Warning signs:** Tests assert that unsafe model text is replaced with mutation-failure fallback instead of asserting deterministic summary text. [VERIFIED: `tests/integration/chat-api.test.ts`] [VERIFIED: `tests/integration/chat-streaming.test.ts`]

### Pitfall 2: Empty-Day Summary Falls Into Mutation-Failure Copy
**What goes wrong:** `0 餐 / 0 kcal` summary queries can return `我還沒有把這餐寫入紀錄`. [VERIFIED: `59-CONTEXT.md`]  
**Why it happens:** Existing no-mutation guard returns false when `mealCount <= 0` or `meals.length === 0`. [VERIFIED: `server/orchestrator/index.ts`]  
**How to avoid:** The renderer must explicitly handle empty facts before any no-mutation fallback. [VERIFIED: `59-CONTEXT.md`]  
**Warning signs:** Empty-day summary tests assert fallback language rather than summary semantics. [VERIFIED: `tests/unit/orchestrator.test.ts`]

### Pitfall 3: Advice Reintroduces Facts
**What goes wrong:** The fact segment is correct, but appended advice says a fake meal name, wrong kcal, macro attribution, meal count, or day total. [VERIFIED: `59-CONTEXT.md`]  
**Why it happens:** Advice text is still LLM output and cannot be trusted for concrete persisted facts. [VERIFIED: `.planning/notes/v2-2-post-review-blocker-reopened.md`]  
**How to avoid:** Drop advice if it contains persisted meal names, kcal/day total numbers, macro units, meal counts, or macro attribution patterns. [VERIFIED: `.planning/notes/v2-2-authoritative-summary-facts-acceptance.md`]  
**Warning signs:** Tests only check the first deterministic sentence and ignore appended text. [VERIFIED: `.planning/notes/v2-2-authoritative-summary-facts-acceptance.md`]

### Pitfall 4: SSE Chunks Leak Before Guarding
**What goes wrong:** Unsafe model summary text is emitted as `chunk` frames before the final guard replaces persisted history. [VERIFIED: `server/routes/chat.ts`]  
**Why it happens:** Streaming routes write chunks incrementally unless summary-context text is held. [VERIFIED: `server/routes/chat.ts`]  
**How to avoid:** For summary/history contexts, hold model tokens, sanitize advice, then emit composed text only after the composer runs. [VERIFIED: `server/routes/chat.ts`]  
**Warning signs:** SSE tests read chunks until `done` but do not check visible chunk text against forbidden advice facts. [VERIFIED: `tests/integration/chat-streaming.test.ts`]

### Pitfall 5: Proof Stops at Done
**What goes wrong:** A post-done `chunk` or `status` frame can exist but the proof never reads it. [VERIFIED: `.planning/REQUIREMENTS.md`]  
**Why it happens:** Many harness helpers still call `readStreamUntilEvent(reader, "done")`. [VERIFIED: codebase grep]  
**How to avoid:** Promotion proof must read through close and assert no terminal violations. [VERIFIED: `tests/harness/sse.ts`]  
**Warning signs:** Artifacts include done payloads but no `closed`, `firstDoneIndex`, or post-done violation fields. [VERIFIED: current `tests/harness/artifacts/image-log-failure/latest/*.json`]

### Pitfall 6: Raw SSE Evidence Sneaks Into Artifacts
**What goes wrong:** Full transcripts or chunk payloads persist user/model text in `tests/harness/artifacts/**`. [VERIFIED: `tests/unit/verification-artifacts.test.ts`]  
**Why it happens:** Scenario code can attach raw fields before artifact redaction, and redaction only omits known key names. [VERIFIED: `tests/harness/artifacts.ts`]  
**How to avoid:** Store structured fields directly and add artifact tests for any new proof keys. [VERIFIED: `tests/harness/artifacts.ts`]  
**Warning signs:** Artifacts contain keys like `rawSSE`, `streamFrames`, `sseTranscript`, or `token`. [VERIFIED: `tests/harness/artifacts.ts`]

## Code Examples

### Shared Compose Call in JSON Path
```typescript
// Source: server/routes/chat.ts finalization pattern + Phase 59 shared composer requirement
const finalReply = summaryHistoryFacts?.dailySummary
  ? composeSummaryHistoryReply(summaryHistoryFacts, modelAdviceText)
  : guardNoMutationLoggingClaim(modelReplyText, didLogMeal, didMutateMeal, { summaryHistoryFacts });

const { sanitized } = await finalizeAssistantReply(
  chatService,
  deviceId,
  finalReply,
  receiptIdentity,
);
```

### Shared Compose Call in SSE Path
```typescript
// Source: server/routes/chat.ts summary-context token holding pattern
if (shouldHoldNoMutationSummaryText && summaryHistoryFacts?.dailySummary) {
  const composed = composeSummaryHistoryReply(summaryHistoryFacts, fullReply);
  const sanitized = sanitizeReply(composed);
  if (sanitized) {
    stream.write(`event: chunk\ndata: ${JSON.stringify({ token: sanitized })}\n\n`);
  }
  await finalizeAssistantReply(chatService, deviceId, sanitized, receiptIdentity);
  return { fullReply: sanitized, didLogMeal, dailySummary, summaryHistoryFacts, tokensStreamed, finalReplySource: "renderer", finalReplyShape: "plain_text" };
}
```

### Structured SSE Proof Metadata
```typescript
// Source: tests/harness/scenarios/image-log-failure.ts
const proof = {
  closed: collection.closed,
  firstDoneObserved: collection.firstDoneIndex !== -1,
  firstDoneIndex: collection.firstDoneIndex,
  noPostDoneChunkOrStatus: collection.eventsAfterFirstDone
    .every((event) => event.event !== "chunk" && event.event !== "status"),
  postDoneEventNames: collection.eventsAfterFirstDone.map((event) => event.event),
  rawLength: collection.raw.length,
};
```

## State of the Art

| Old Approach | Current/Required Approach | When Changed | Impact |
|--------------|---------------------------|--------------|--------|
| Prompt/guard repairs for summary facts | Backend deterministic fact renderer plus advice guard | Reopened on 2026-05-16 in Phase 59 context [VERIFIED: `59-CONTEXT.md`] | Planner should assign renderer work before route/harness proof. [VERIFIED: `.planning/notes/v2-2-post-review-blocker-reopened.md`] |
| Aggregate day totals used in guard decisions | Aggregate totals only render day-level facts | Quick task `260516-ppf` and Phase 59 locked D-02 [VERIFIED: `260516-ppf-VERIFICATION.md`] [VERIFIED: `59-CONTEXT.md`] | Avoid any task that lets `dailySummary.totalCalories` validate named meal claims. [VERIFIED: `tests/unit/orchestrator.test.ts`] |
| SSE read until first `done` | Read through stream close and inspect post-done frames | Existing helper in `tests/harness/sse.ts`, locked by STREAM-01/02 [VERIFIED: `tests/harness/sse.ts`] [VERIFIED: `.planning/REQUIREMENTS.md`] | Promotion proof must include close observation and negative proof for post-done frames. [VERIFIED: `.planning/notes/v2-2-authoritative-summary-facts-acceptance.md`] |
| Raw/prose-heavy artifacts | Structured redacted JSON artifacts | Existing `writeScenarioArtifacts()` contract [VERIFIED: `tests/harness/artifacts.ts`] | New evidence should use metadata fields, not transcripts. [VERIFIED: `tests/unit/verification-artifacts.test.ts`] |

**Deprecated/outdated:**
- Sixth parser/regex repair round: rejected by reopen decision. [VERIFIED: `.planning/notes/v2-2-post-review-blocker-reopened.md`]
- Raw SSE frame transcripts as proof artifacts: rejected by STREAM-03 and artifact redaction rules. [VERIFIED: `.planning/REQUIREMENTS.md`] [VERIFIED: `tests/harness/artifacts.ts`]

## Assumptions Log

All claims in this research were verified or cited; no `[ASSUMED]` claims are used. [VERIFIED: source list below]

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| — | — | — | — |

## Open Questions

1. **Exact deterministic date label for historical summary text**
   - What we know: Historical summary handling already carries `dailySummary.date` and `affectedDate`. [VERIFIED: `server/orchestrator/tools.ts`] [VERIFIED: `server/routes/chat.ts`]
   - What's unclear: The acceptance checklist gives today-style copy but does not lock historical phrasing. [VERIFIED: `.planning/notes/v2-2-authoritative-summary-facts-acceptance.md`]
   - Recommendation: Planner should require renderer tests for today and historical dates, using existing `appendHistoricalDateSuffixIfMissing()` semantics or replacing it with renderer-owned date labels for summary/history replies. [VERIFIED: `server/routes/chat.ts`]

2. **Whether summary advice is worth keeping when suspicious**
   - What we know: Advice is optional and can be stripped, replaced, or rejected when it introduces forbidden concrete facts. [VERIFIED: `59-CONTEXT.md`]
   - What's unclear: The phase does not require salvaging partial advice. [VERIFIED: `.planning/REQUIREMENTS.md`]
   - Recommendation: Plan the smallest safe behavior: drop the whole advice segment on any forbidden concrete fact, and test that safe generic advice can still append. [VERIFIED: `59-CONTEXT.md`]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | TypeScript execution and `node:test` | yes [VERIFIED: `node --version`] | v24.14.0 [VERIFIED: `node --version`] | None needed. [VERIFIED: `package.json`] |
| Yarn | Repo scripts and policy-compliant package workflow | yes [VERIFIED: `yarn --version`] | 1.22.22 [VERIFIED: `yarn --version`] | None; project forbids npm workflow. [VERIFIED: `AGENTS.md`] |
| Git | Commit research artifact and inspect branch state | yes [VERIFIED: `git --version`] | Apple Git 2.50.1 [VERIFIED: `git --version`] | None needed. [VERIFIED: `.planning/config.json`] |
| SQLite CLI | Optional local DB inspection | yes [VERIFIED: `sqlite3 --version`] | 3.51.0 [VERIFIED: `sqlite3 --version`] | Tests use better-sqlite3 directly, so CLI absence would not block tests. [VERIFIED: `package.json`] |
| Fastify test app fixture | Integration/harness tests | yes [VERIFIED: `tests/harness/app-fixture.ts`] | Uses repo dependencies [VERIFIED: `yarn.lock`] | None needed. [VERIFIED: `tests/harness/app-fixture.ts`] |

**Missing dependencies with no fallback:** None found for planning/execution of this phase. [VERIFIED: environment audit]

**Missing dependencies with fallback:** None found for planning/execution of this phase. [VERIFIED: environment audit]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Node built-in `node:test` on Node v24.14.0; TS loaded via `tsx` 4.21.0. [VERIFIED: `node --version`] [VERIFIED: `yarn.lock`] [CITED: https://nodejs.org/api/test.html] |
| Config file | No separate Jest/Vitest config; commands are in `package.json`. [VERIFIED: `package.json`] |
| Quick run command | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/summary-history-renderer.test.ts tests/unit/orchestrator.test.ts tests/unit/verification-artifacts.test.ts` [VERIFIED: `package.json`] |
| Full suite command | `yarn test` plus `yarn verify:harness -- image-log-failure` and `yarn release:check` for promotion-blocker evidence. [VERIFIED: `package.json`] [VERIFIED: `AGENTS.md`] |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| AUTH-01 | Persisted meal rows drive meal names, meal count, day total kcal, and per-meal kcal. | unit + integration | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/summary-history-renderer.test.ts tests/integration/chat-api.test.ts tests/integration/chat-streaming.test.ts` | `tests/unit/summary-history-renderer.test.ts` missing; integration files exist. [VERIFIED: codebase grep] |
| AUTH-02 | Aggregate total cannot authorize fake meal names or full-day kcal as one meal. | unit + integration | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/summary-history-renderer.test.ts tests/unit/orchestrator.test.ts tests/integration/chat-api.test.ts tests/integration/chat-streaming.test.ts` | Renderer test missing; existing guard/integration files exist. [VERIFIED: codebase grep] |
| AUTH-03 | Deterministic fact segment renders `2 餐 / 900 kcal / meal list` and empty-day `0 餐 / 0 kcal`. | unit | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/summary-history-renderer.test.ts` | Missing; Wave 0 gap. [VERIFIED: `rg --files`] |
| AUTH-04 | Advice guard applies across JSON, SSE, and non-SSE drained final paths. | unit + integration | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/summary-history-renderer.test.ts tests/integration/chat-api.test.ts tests/integration/chat-streaming.test.ts` | Unit missing; integration files exist. [VERIFIED: codebase grep] |
| STREAM-01 | SSE proof drains to stream close after done. | harness + unit helper | `yarn verify:harness -- image-log-failure` and `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/sse-terminal-proof.test.ts` | Harness exists; unit helper test missing. [VERIFIED: `tests/harness/scenarios/image-log-failure.ts`] |
| STREAM-02 | Proof fails on post-done `chunk` or `status`. | unit helper + harness | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/sse-terminal-proof.test.ts` | Missing; Wave 0 gap. [VERIFIED: `rg --files`] |
| STREAM-03 | Artifacts store structured metadata and no raw transcripts. | unit + harness artifact inspection | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/verification-artifacts.test.ts && yarn verify:harness -- image-log-failure` | Existing artifact test and harness exist. [VERIFIED: `tests/unit/verification-artifacts.test.ts`] [VERIFIED: `tests/harness/scenarios/image-log-failure.ts`] |

### Sampling Rate

- **Per task commit:** Run the narrow command for touched files, plus `yarn tsc --noEmit` for TS edits. [VERIFIED: `AGENTS.md`]
- **Per wave merge:** Run `yarn test:unit`, `yarn test:integration`, and the chosen harness scenario command. [VERIFIED: `AGENTS.md`] [VERIFIED: `package.json`]
- **Phase gate:** Run `yarn tsc --noEmit`, targeted unit/integration commands, `yarn verify:harness -- image-log-failure` or the chosen focused scenario, and `yarn release:check`; do not promote. [VERIFIED: `AGENTS.md`] [VERIFIED: `59-CONTEXT.md`]

### Wave 0 Gaps

- [ ] `tests/unit/summary-history-renderer.test.ts` — covers AUTH-01, AUTH-02, AUTH-03, AUTH-04. [VERIFIED: `rg --files`]
- [ ] `server/orchestrator/summary-history-renderer.ts` — shared implementation boundary for renderer and advice guard. [VERIFIED: codebase grep]
- [ ] `tests/unit/sse-terminal-proof.test.ts` or equivalent helper coverage — proves synthetic post-done `chunk` and `status` fail STREAM-02. [VERIFIED: codebase grep]
- [ ] Route integration additions for non-SSE drained stream path if existing coverage does not force `streamGenerator` through JSON. [VERIFIED: `server/routes/chat.ts`]
- [ ] Artifact regression that new SSE proof metadata omits raw transcript keys if new keys are added. [VERIFIED: `tests/harness/artifacts.ts`]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no direct auth change | Keep existing cookie-backed guest-session route resolution; do not accept raw `deviceId` for protected browser routes. [VERIFIED: `AGENTS.md`] |
| V3 Session Management | no direct session change | Preserve existing guest-session cookies and test setup. [VERIFIED: `tests/harness/app-fixture.ts`] |
| V4 Access Control | yes, indirectly | All persisted fact retrieval must remain scoped by `deviceId`. [VERIFIED: `server/services/food-logging.ts`] [VERIFIED: `server/services/summary.ts`] |
| V5 Input Validation | yes | Keep zod/tool schema validation; do not accept unvalidated model/tool args as authoritative facts. [VERIFIED: `server/orchestrator/tools.ts`] |
| V6 Cryptography | no new crypto | Do not modify guest-session signing or secrets in this phase. [VERIFIED: `59-CONTEXT.md`] |
| V7 Error Handling and Logging | yes | Do not persist raw SSE transcripts, raw provider payloads, user text, or secrets in artifacts. [VERIFIED: `tests/harness/artifacts.ts`] |
| V14 Configuration | yes | Preserve `TZ=Asia/Taipei` day-boundary configuration in tests/harness. [VERIFIED: `AGENTS.md`] [VERIFIED: `tests/harness/app-fixture.ts`] |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| LLM output tampers with persisted meal facts | Tampering | Backend deterministic fact renderer ignores model-authored facts. [VERIFIED: `59-CONTEXT.md`] |
| Aggregate bypass assigns day total to one meal | Tampering | Keep day totals and per-meal facts separate in renderer/advice guard. [VERIFIED: `.planning/notes/v2-2-post-review-blocker-reopened.md`] |
| Cross-device summary fact leak | Information Disclosure | Keep `deviceId` scoped service calls and signed-session route ownership. [VERIFIED: `server/services/food-logging.ts`] [VERIFIED: `AGENTS.md`] |
| SSE proof artifact leaks raw user/model text | Information Disclosure | Store structured metadata only and rely on artifact redaction. [VERIFIED: `tests/harness/artifacts.ts`] |
| Post-done stream frames create inconsistent client state | Tampering / Repudiation | Drain through close and fail on post-done `chunk` or `status`. [VERIFIED: `.planning/REQUIREMENTS.md`] |

## Sources

### Primary (HIGH confidence)

- `.planning/phases/59-authoritative-summary-facts-and-sse-proof/59-CONTEXT.md` — locked implementation decisions, discretion, deferred scope. [VERIFIED: file read]
- `.planning/REQUIREMENTS.md` — AUTH-01..04 and STREAM-01..03. [VERIFIED: file read]
- `.planning/ROADMAP.md` — phase goal and success criteria. [VERIFIED: file read]
- `.planning/STATE.md` — prior quick-task sequence and branch/milestone history. [VERIFIED: file read]
- `.planning/todos/pending/v2-2-authoritative-summary-facts-sse-proof.md` — primary blocker scope. [VERIFIED: file read]
- `.planning/notes/v2-2-authoritative-summary-facts-acceptance.md` — acceptance checklist. [VERIFIED: file read]
- `.planning/notes/v2-2-post-review-blocker-reopened.md` — decision to stop parser repair rounds. [VERIFIED: file read]
- `.planning/quick/260516-ppf-fix-v2-2-summary-history-fact-grounding-/260516-ppf-PLAN.md` — prior patch plan. [VERIFIED: file read]
- `.planning/quick/260516-ppf-fix-v2-2-summary-history-fact-grounding-/260516-ppf-SUMMARY.md` — prior patch result. [VERIFIED: file read]
- `.planning/quick/260516-ppf-fix-v2-2-summary-history-fact-grounding-/260516-ppf-VERIFICATION.md` — prior patch verification and remaining context. [VERIFIED: file read]
- `AGENTS.md` and `docs/codex.md` — repo constraints and Nutrition skill conventions. [VERIFIED: file read]
- `server/orchestrator/tools.ts`, `server/orchestrator/index.ts`, `server/routes/chat.ts`, `server/services/food-logging.ts`, `server/services/summary.ts`, `server/db/schema.ts`, `server/app.ts` — relevant implementation. [VERIFIED: codebase grep]
- `tests/unit/*.test.ts`, `tests/integration/chat-*.test.ts`, `tests/harness/*` — relevant validation and harness patterns. [VERIFIED: codebase grep]
- `package.json`, `yarn.lock`, `.planning/config.json` — scripts, installed versions, and workflow toggles. [VERIFIED: file read]
- npm registry metadata fetched 2026-05-16 — latest versions and publish dates for listed packages. [VERIFIED: npm registry]

### Primary External (HIGH confidence)

- WHATWG HTML Standard, Server-sent events — SSE format and EventSource behavior. [CITED: https://html.spec.whatwg.org/dev/server-sent-events.html]
- MDN, Using server-sent events — `text/event-stream`, event blocks, close behavior, named events. [CITED: https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events/Using_server-sent_events]
- Node.js Test Runner docs — `--test`, execution model, async activity behavior. [CITED: https://nodejs.org/api/test.html]
- Fastify Testing guide — `fastify.inject()` and booted app testing. [CITED: https://fastify.dev/docs/v5.7.x/Guides/Testing/]

### Secondary (MEDIUM confidence)

- None used. [VERIFIED: source audit]

### Tertiary (LOW confidence)

- None used. [VERIFIED: source audit]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — installed versions verified from `yarn.lock`, latest versions/publish dates checked against registry, and project policy forbids introducing new test frameworks. [VERIFIED: `yarn.lock`] [VERIFIED: npm registry] [VERIFIED: `AGENTS.md`]
- Architecture: HIGH — implementation paths and service boundaries are visible in code and match AGENTS.md. [VERIFIED: codebase grep] [VERIFIED: `AGENTS.md`]
- Pitfalls: HIGH — pitfalls are based on the reopened blocker note, prior verification, and current code paths. [VERIFIED: `.planning/notes/v2-2-post-review-blocker-reopened.md`] [VERIFIED: `260516-ppf-VERIFICATION.md`] [VERIFIED: codebase grep]
- Exact final copy: MEDIUM — acceptance gives examples but does not lock all historical date wording. [VERIFIED: `.planning/notes/v2-2-authoritative-summary-facts-acceptance.md`]

**Research date:** 2026-05-16 [VERIFIED: system date]
**Valid until:** 2026-05-23 for package/version claims; architecture findings remain valid until relevant route/orchestrator/harness files change. [VERIFIED: npm registry] [VERIFIED: codebase grep]
