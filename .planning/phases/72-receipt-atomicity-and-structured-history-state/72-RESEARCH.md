# Phase 72: Receipt Atomicity and Structured History State - Research

**Researched:** 2026-06-01  
**Domain:** Backend SQLite persistence, chat receipt projection, compressed LLM history authority  
**Confidence:** HIGH for local architecture and proof surfaces; MEDIUM for exact schema shape until planning chooses names.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

### Persistence Guarantee

- **D-01:** Default to a single transaction for new assistant reply plus receipt reference persistence. The current integrity gap is the split write in `finalizeAssistantReply`, and `chat_meal_receipts` already has a one-receipt-per-assistant-message constraint.
- **D-02:** Do not make an idempotent reconciler the default. Reconciliation would likely require inferring missing receipt facts from assistant/tool display text, which Phase 72 is explicitly removing.
- **D-03:** Revisit a tiny legacy repair only if plan-phase investigation proves real corrupt rows exist and the repair can avoid display-string inference.
- **D-04:** If atomic assistant plus receipt persistence fails after the meal mutation committed but before the response is sent, fail closed for receipt identity. Do not send `loggedMeal` or edit identity unless the assistant row and receipt reference were persisted together.
- **D-05:** Existing committed-receipt behavior still applies when later summary recompute or LLM rendering fails. Persistence failure is different: without structured receipt facts, the route must use sanitized fallback semantics and omit receipt-derived identity.
- **D-06:** A narrowly scoped retry for transient DB errors may be considered during plan-phase, but it must not change the default fail-closed contract.
- **D-07:** Put the atomic helper in `chatService`, with a narrow shape such as `saveAssistantReplyWithReceipt(...)`. Routes keep owning sanitization, status choice, HTTP/SSE fallback, and response projection; `chatService` owns SQLite transactions and message persistence.
- **D-08:** Do not use route-local DB transaction details or an over-general message transaction API unless plan-phase proves the narrow service helper cannot preserve existing boundaries.
- **D-09:** Every receipt-bearing finalization path must use the same atomic helper. If a terminal JSON, SSE, stopped, partial, or fallback path attaches `receiptIdentity` or exposes `loggedMeal`/edit identity, assistant reply persistence and receipt reference persistence must succeed together.
- **D-10:** Non-receipt paths can keep ordinary `saveMessage` behavior. Fallback, stopped, and partial paths are not exempt when they are receipt-bearing.

### Structured Compressed-History Facts

- **D-11:** Scope structured compressed-history facts to receipt/mutation outcomes for Phase 72: `log_food`, `update_meal`, `delete_meal`, and `update_goals`.
- **D-12:** Do not broaden Phase 72 to all lookup/summary tools. `find_meals` and `get_daily_summary` can keep existing behavior unless needed to support mutation facts, because the main HIST-01/HIST-02 risk is compressed history inferring committed state from success/display strings.
- **D-13:** Compressed history should render mutation outcomes from persisted structured facts as safe summaries only at the level needed for conversation continuity: action type, affected date, user-safe meal/goal labels, and high-level committed values such as food name, calories, or updated goal fields.
- **D-14:** Compressed history must not use assistant prose, raw tool payloads, tool success strings, meal ids, revision ids, device ids, summaryOutcome internals, or protocol/debug terms as mutation authority.
- **D-15:** Outcome markers alone are too weak; detailed snapshots expose more authority surface than Phase 72 needs.
- **D-16:** Add narrow structured outcome storage keyed near chat/tool messages. Compressed history needs durable facts about the mutation outcome for that turn, not just current domain state and not message display text.
- **D-17:** Existing domain tables remain the source of truth for current meal and goal state. `chat_meal_receipts` can continue to provide meal receipt identity, while the new structured outcome record provides safe compressed-history rendering facts.
- **D-18:** Avoid opaque JSON directly in `chat_messages`; keep the authority separate, typed/validated, and additive for legacy compatibility.
- **D-19:** If structured outcome facts are missing or incomplete, compressed history must omit the committed mutation claim. It must not fall back to legacy tool summaries such as success-string-to-completed-action rendering.
- **D-20:** Ordinary user/assistant text may remain in compressed history only as transcript context. When structured outcome facts are missing or incomplete, assistant prose must not be treated, transformed, summarized, or promoted as a committed mutation fact.

### Legacy Receipt Rows

- **D-21:** Preserve existing `/api/chat/history` behavior for legacy `chat_meal_receipts`. Display-safe `loggedMeal` can still be restored from receipt joins.
- **D-22:** Stale or deleted legacy receipts remain display-only and must not expose edit identity.
- **D-23:** Compressed LLM history must not render committed mutation summaries for legacy rows unless new structured outcome facts exist. This keeps UI compatibility while making compressed-history authority fail closed.
- **D-24:** No default backfill. Phase 72 must not infer new structured outcomes from legacy receipt/domain joins.
- **D-25:** Add targeted proof that rows missing structured outcome facts fail closed in compressed history. A repair helper can be future work, not the default phase behavior.
- **D-26:** Keep the current display-only identity rule: `mealId`, `dateKey`, and `mealRevisionId` are exposed only when the stored receipt revision is still the current active revision.
- **D-27:** New structured outcome storage should be additive and nullable/optional. Existing `chat_meal_receipts` remain valid and are not rewritten.
- **D-28:** For new receipt-bearing writes, the atomic service path should persist assistant reply, receipt reference, and structured facts together. Phase 72 should not rely on strict schema/backfill requirements for legacy compatibility.

### the agent's Discretion

Planner may choose exact table/column names, TypeScript types, service method names, safe summary wording, and test organization. Planner may also decide whether a single retry for transient DB errors is useful, as long as retry behavior does not weaken the fail-closed receipt identity contract.

### Deferred Ideas (OUT OF SCOPE)

- A targeted legacy repair helper may be considered in a future phase if real corrupt rows are found and repair can be implemented without display-string inference.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| RCP-01 | Assistant reply persistence and meal receipt reference persistence are atomic or idempotently reconciled so chat history cannot show a receipt-derived meal action without matching structured receipt facts. | Use one `chatService` transaction for assistant message, `chat_meal_receipts`, and structured outcome facts; route response projection must omit receipt identity on transaction failure. [VERIFIED: `.planning/REQUIREMENTS.md`, `server/routes/chat.ts`, `server/services/chat.ts`] |
| HIST-01 | Compressed LLM history formats prior tool outcomes from persisted structured fields instead of display strings such as success copy. | Replace `formatToolSummary()` authority for `log_food`, `update_meal`, `delete_meal`, and `update_goals` with validated structured outcome rows. [VERIFIED: `.planning/REQUIREMENTS.md`, `server/services/chat.ts`] |
| HIST-02 | Existing chat, correction, and summary flows keep renderer-owned receipt semantics while compressed-history implementation stops inferring tool state from user-visible text. | Keep `renderMutationReceipt()` and existing receipt tests green; add structured compressed-history tests for valid, missing, invalid, stale, and legacy-only facts. [VERIFIED: `.planning/REQUIREMENTS.md`, `server/orchestrator/mutation-receipts.ts`, `tests/unit/mutation-receipts.test.ts`] |
</phase_requirements>

## Summary

Phase 72 should be planned as a targeted backend authority hardening phase, not a broad chat/orchestrator rewrite. The current split write is in `server/routes/chat.ts`: `finalizeAssistantReply()` calls `chatService.saveMessage()` and then, only if `receiptIdentity` exists, calls `chatService.saveMealReceiptReference()`. [VERIFIED: codebase grep] The matching service already demonstrates the correct ownership pattern because `saveMessage()` wraps message plus image asset reference writes in a SQLite transaction. [VERIFIED: codebase grep]

The compressed-history defect is equally localized. `chatService.getCompressedHistory()` merges tool message summaries into assistant content, and `formatToolSummary()` currently turns tool message content equal to `"成功"` into committed mutation markers such as `[系統已完成餐點記錄]`. [VERIFIED: codebase grep] The orchestrator also checks those markers in `detectHallucinatedChoiceFollowUp()`, so the plan must remove display-string mutation authority from both compressed history rendering and any downstream logic that treats those markers as facts. [VERIFIED: codebase grep]

**Primary recommendation:** add an additive structured mutation outcome table plus a narrow `chatService.saveAssistantReplyWithReceipt(...)` transaction helper; route code should call it for every receipt-bearing terminal path, and `getCompressedHistory()` should render mutation facts only from validated persisted outcome rows. [VERIFIED: `.planning/phases/72-receipt-atomicity-and-structured-history-state/72-CONTEXT.md`, codebase grep]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Assistant reply plus receipt atomicity | API / Backend service | Database / Storage | `chatService` already owns message persistence and SQLite transactions; route code owns sanitization and response projection. [VERIFIED: `AGENTS.md`, `server/services/chat.ts`, `server/routes/chat.ts`] |
| Structured mutation outcome persistence | Database / Storage | API / Backend service | Additive state must be durable and keyed to chat/device/message identity; typed validation belongs at the service boundary before read/render. [VERIFIED: `server/db/schema.ts`, `server/services/chat.ts`] |
| Compressed LLM history rendering | API / Backend service | Orchestrator | `server/orchestrator/history.ts` delegates history loading to `chatService.getCompressedHistory()`, so the policy boundary is already the chat service. [VERIFIED: `server/orchestrator/history.ts`, `server/services/chat.ts`] |
| Receipt response projection | API / Backend route | Client | `server/routes/chat.ts` currently projects `loggedMeal` into JSON/SSE terminal payloads and `/api/chat/history` maps service rows to public fields. [VERIFIED: `server/routes/chat.ts`] |
| Renderer-owned visible mutation copy | Orchestrator | API / Backend route | `renderMutationReceipt()` already owns visible log/update/delete/goals copy and forbidden-term checks. [VERIFIED: `server/orchestrator/mutation-receipts.ts`, `tests/unit/mutation-receipts.test.ts`] |

## Project Constraints (from AGENTS.md)

- Use `yarn` only; do not use `npm` for project commands. [CITED: `AGENTS.md`]
- The repo is ESM and local TypeScript imports use explicit `.js` specifiers. [CITED: `AGENTS.md`]
- `server/app.ts` is the backend composition root. [CITED: `AGENTS.md`]
- `server/routes/*.ts` own HTTP/SSE transport boundaries, request validation, auth checks, stream framing, and response shaping. [CITED: `AGENTS.md`]
- `server/services/*.ts` own reusable domain and persistence logic. [CITED: `AGENTS.md`]
- `server/orchestrator/*` owns model workflow, tool definitions, tool execution, prompt construction, and fallback behavior. [CITED: `AGENTS.md`]
- Use Node built-in `node:test`; do not introduce Jest or Vitest without explicit migration approval. [CITED: `AGENTS.md`]
- Use real SQLite in tests; `:memory:` is acceptable, mocked DBs are not. [CITED: `AGENTS.md`]
- `TZ=Asia/Taipei` matters for day-boundary behavior and must remain in local/test setups. [CITED: `AGENTS.md`]
- Any `*.ts` edit triggers `yarn tsc --noEmit`; route/service edits trigger `yarn test:integration`; unit test edits trigger `yarn test:unit`. [CITED: `AGENTS.md`]
- `server/routes/chat.ts` has strict ordering invariants around SSE status/chunk/done, summary publish timing, and upload cleanup. [CITED: `AGENTS.md`]
- `main` is production and must not be promoted without explicit current-thread approval. [CITED: `AGENTS.md`]

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| TypeScript | `^5.7.0` | Server/client type system and ESM source compilation. | Existing repo stack; no migration needed. [VERIFIED: `package.json`] |
| Fastify | `^5.2.0` | HTTP/SSE route host. | Existing chat route and integration tests use Fastify/app injection. [VERIFIED: `package.json`, `server/app.ts`, tests grep] |
| Drizzle ORM | `^0.39.0` | SQLite schema declarations and typed query builder. | Existing `server/db/schema.ts` and migrations use Drizzle SQLite tables/indexes. [VERIFIED: `package.json`, `server/db/schema.ts`] |
| better-sqlite3 | `^11.8.0` | Local SQLite driver. | Existing `createDb()` uses `better-sqlite3`, enables foreign keys, WAL, and migrations. [VERIFIED: `package.json`, `server/db/client.ts`] |
| Zod | `^4.3.6` | Runtime validation for structured facts. | Existing milestone direction and AI-SPEC prefer Zod-first typed validation before trusting structured state. [VERIFIED: `package.json`, `72-AI-SPEC.md`] |
| Node built-in test runner | Node `v24.14.0` available locally | Unit/integration test execution. | Project rule requires `node:test`; scripts already run `node --test` through the TZ wrapper. [VERIFIED: `AGENTS.md`, `package.json`, env probe] |

### Supporting

| Library/Tool | Version | Purpose | When to Use |
|--------------|---------|---------|-------------|
| `tsx` | `^4.19.0` | Execute TypeScript tests/scripts under Node. | Existing test and migration scripts import `tsx`. [VERIFIED: `package.json`] |
| `drizzle-kit` | `^0.31.10` | Generate additive migrations from schema changes. | Use if the planner chooses to generate the structured outcome migration rather than hand-author SQL. [VERIFIED: `package.json`, `drizzle.config.ts`] |
| `sqlite3` CLI | `/usr/bin/sqlite3` available | Manual DB inspection only. | Optional debugging; implementation and tests should use the existing app DB helpers. [VERIFIED: env probe] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| One `chatService` transaction | Idempotent reconciler | Context explicitly rejects reconciler as default because it risks deriving missing facts from display text. [VERIFIED: `72-CONTEXT.md`] |
| Separate structured outcome table | JSON column on `chat_messages` | Context says to avoid opaque JSON directly in `chat_messages` and keep authority separate/additive. [VERIFIED: `72-CONTEXT.md`] |
| Deterministic facts from tool/domain results | Additional model extraction call | AI-SPEC states Phase 72 should not add an extra model call on the normal receipt path. [CITED: `72-AI-SPEC.md`] |

**Installation:** no new external packages are recommended. [VERIFIED: `package.json`, `72-AI-SPEC.md`]

## Package Legitimacy Audit

No external package install is recommended for this phase. [VERIFIED: `72-AI-SPEC.md`, `package.json`] The package legitimacy gate was not run because the planner should use existing repo dependencies only. [ASSUMED]

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| none | — | — | — | — | not run | No package install planned. [VERIFIED: research scope] |

**Packages removed due to slopcheck [SLOP] verdict:** none. [VERIFIED: no packages recommended]  
**Packages flagged as suspicious [SUS]:** none. [VERIFIED: no packages recommended]

## Architecture Patterns

### System Architecture Diagram

```text
User message / image
  -> /api/chat route (guest session, upload validation, response projection)
  -> orchestrator.handleMessage()
     -> tool execution: log_food / update_meal / delete_meal / update_goals
     -> renderer-owned mutation receipt text
     -> structured mutation outcome fact from committed tool/domain result
  -> route finalization
     -> if receipt-bearing: chatService.saveAssistantReplyWithReceipt(...)
        -> SQLite transaction:
           chat_messages assistant row
           chat_meal_receipts row when meal receipt exists
           chat_mutation_outcomes row for log/update/delete/goals
        -> success: route may expose loggedMeal/edit identity according to projection rules
        -> failure: route sends sanitized fallback and omits receipt-derived identity
     -> if not receipt-bearing: chatService.saveMessage(...)

Later LLM turn
  -> orchestrator/history.loadHistory()
  -> chatService.getCompressedHistory()
     -> user/assistant transcript context
     -> structured outcome rows validated with Zod
     -> safe mutation fact summaries only for complete valid rows
     -> no mutation claim for missing/invalid/legacy-only facts
```

All nodes and responsibilities above are grounded in current route/service/orchestrator boundaries. [VERIFIED: `AGENTS.md`, `server/routes/chat.ts`, `server/services/chat.ts`, `server/orchestrator/history.ts`]

### Recommended Project Structure

```text
server/
├── db/
│   ├── schema.ts                 # Add additive structured outcome table.
│   └── migrations/ or drizzle/    # Add next migration, no legacy backfill by default.
├── services/
│   └── chat.ts                   # Atomic helper, outcome validation, compressed-history rendering.
├── orchestrator/
│   ├── index.ts                  # Return typed mutation outcome fact with receipt-bearing results.
│   ├── mutation-effects.ts       # Existing committed effect types are the safest source shape.
│   └── mutation-receipts.ts      # Keep visible receipt copy renderer-owned.
└── routes/
    └── chat.ts                   # Keep sanitization, status choice, fallback, SSE/JSON projection.

tests/
├── unit/
│   ├── chat.test.ts              # Service transaction/history/outcome rendering cases.
│   ├── history.test.ts           # Orchestrator loadHistory bridge expectations.
│   ├── orchestrator.test.ts      # Renderer outcome propagation and compressed-history inputs.
│   └── mutation-receipts.test.ts # Existing visible receipt semantics.
└── integration/
    ├── chat-api.test.ts          # JSON persistence, history projection, fail-closed response proof.
    └── chat-streaming.test.ts    # SSE done/stopped/fallback/persist-catch proof.
```

This structure follows existing repo directories and test files. [VERIFIED: codebase grep]

### Pattern 1: Narrow Atomic Persistence Helper

**What:** Add `saveAssistantReplyWithReceipt(...)` to `chatService` and implement it with `db.transaction((tx) => { ... })`, mirroring the existing transaction pattern in `saveMessage()`. [VERIFIED: `server/services/chat.ts`]  
**When to use:** Every terminal finalization path with a receipt identity or structured mutation outcome fact. [VERIFIED: `72-CONTEXT.md`, `server/routes/chat.ts`]  
**Example:**

```ts
return db.transaction((tx) => {
  tx.insert(chatMessages).values({ id, deviceId, role: "assistant", content, status, createdAt }).run();
  tx.insert(chatMealReceipts).values({ id: receiptId, assistantMessageId: id, ...receipt }).run();
  tx.insert(chatMutationOutcomes).values({ id: outcomeId, assistantMessageId: id, action, payload, createdAt }).run();
  return { id, createdAt };
});
```

The exact table/column names are planner discretion. [VERIFIED: `72-CONTEXT.md`]

### Pattern 2: Structured Outcome Fact Near Chat Messages

**What:** Store a narrow row keyed by `device_id` and `assistant_message_id`, with an action discriminator for `log_food`, `update_meal`, `delete_meal`, and `update_goals`, plus safe payload fields needed for history continuity. [VERIFIED: `72-CONTEXT.md`, `72-AI-SPEC.md`]  
**When to use:** When a tool/domain mutation committed and the assistant reply will carry receipt/committed outcome semantics. [VERIFIED: `server/orchestrator/tools.ts`, `server/orchestrator/index.ts`]  
**Implementation note:** The current `OrchestratorResult` does not return `deletedMeal` or a general `mutationEffects`/outcome object, so the plan should add a typed `mutationOutcomeFact` return field rather than asking the route to parse renderer text. [VERIFIED: `server/orchestrator/index.ts`, `server/orchestrator/mutation-effects.ts`]

### Pattern 3: Compressed History From Validated Rows

**What:** Keep turn grouping in `getCompressedHistory()`, but remove mutation authority from `formatToolSummary()` for scoped mutation tools. [VERIFIED: `server/services/chat.ts`]  
**When to use:** On every `loadHistory()` call before model context construction. [VERIFIED: `server/orchestrator/history.ts`]  
**Rule:** Missing, invalid, or incomplete structured outcome facts render no committed mutation claim. [VERIFIED: `72-CONTEXT.md`]

### Pattern 4: Fail-Closed Route Projection

**What:** For receipt-bearing writes, response projection must depend on successful atomic persistence. [VERIFIED: `72-CONTEXT.md`]  
**When to use:** JSON success, JSON drained stream, JSON catch, SSE normal done, SSE stopped, SSE hallucination fallback, and SSE outer/persist catch paths. [VERIFIED: `server/routes/chat.ts`, `tests/integration/chat-api.test.ts`, `tests/integration/chat-streaming.test.ts`]  
**Rule:** Summary recompute or later LLM rendering failure can still show committed receipts; assistant/receipt/outcome persistence failure cannot. [VERIFIED: `72-CONTEXT.md`, existing tests around final-reply and summary failures]

### Anti-Patterns to Avoid

- **Route-local transaction code:** violates the local boundary that services own persistence and routes own transport/projection. [CITED: `AGENTS.md`]
- **Display-string repair:** contradicts the phase goal by reconstructing facts from assistant prose or tool success copy. [VERIFIED: `72-CONTEXT.md`]
- **Opaque JSON in `chat_messages`:** conflicts with the locked decision to keep authority separate, typed/validated, and additive. [VERIFIED: `72-CONTEXT.md`]
- **Delete outcome from receipt text:** current delete success does not carry `loggedMeal`; route-level reconstruction from text would be brittle. [VERIFIED: `server/orchestrator/index.ts`, `server/orchestrator/mutation-receipts.ts`]
- **Client-side authority fix:** client DTO guards are useful but cannot close backend persistence atomicity. [VERIFIED: `AGENTS.md`, `server/routes/chat.ts`, `client/src/api.ts` grep]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Transaction atomicity | Custom compensation state machine or route-local multi-step cleanup | `db.transaction()` inside `chatService` | Existing service pattern already uses SQLite transaction semantics for message plus asset reference persistence. [VERIFIED: `server/services/chat.ts`] |
| Runtime validation | Ad hoc `typeof` chains spread across route and history code | Zod schema plus narrow renderer helpers | AI-SPEC and recent milestone direction use typed validated boundaries. [CITED: `72-AI-SPEC.md`] |
| Receipt copy rendering | New route strings or model-generated success text | Existing `renderMutationReceipt()` | Existing tests enforce renderer-owned copy and forbidden internal terms. [VERIFIED: `server/orchestrator/mutation-receipts.ts`, `tests/unit/mutation-receipts.test.ts`] |
| Legacy backfill | One-time inference from old assistant/tool display strings | No default backfill; fail closed in compressed history | Locked decisions prohibit inferring new structured outcomes from legacy display/domain joins. [VERIFIED: `72-CONTEXT.md`] |
| Persistence tests | Mocked DB or shallow route mocks | Real SQLite integration/unit tests with `:memory:` or temp DB | Project rules require real SQLite and existing tests already use it. [CITED: `AGENTS.md`, tests grep] |

**Key insight:** This phase is about authority provenance; any shortcut that converts display copy into structured state recreates the bug under a new name. [VERIFIED: `72-CONTEXT.md`, `72-AI-SPEC.md`]

## Runtime State Inventory

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Existing persisted `chat_messages` and `chat_meal_receipts` rows may exist without new structured outcome rows. [VERIFIED: `server/db/schema.ts`, `72-CONTEXT.md`] | Add nullable/additive schema and keep legacy rows display-compatible; do not backfill by default. [VERIFIED: `72-CONTEXT.md`] |
| Live service config | None found for this phase; chat receipt/history behavior is local app code and SQLite state. [VERIFIED: codebase grep, `.planning/config.json`] | No live service config migration required. [VERIFIED: research scope] |
| OS-registered state | None found; no launchd/systemd/pm2 registration participates in receipt history state. [VERIFIED: repo grep not finding runtime registration refs for this capability] | No OS registration action required. [VERIFIED: research scope] |
| Secrets/env vars | No new secrets or env var names are needed; existing DB path/config and guest session secrets are unaffected. [VERIFIED: `server/app.ts`, `server/db/client.ts`, `AGENTS.md`] | No secret rename or env migration required. [VERIFIED: research scope] |
| Build artifacts | Drizzle migration metadata will need the next migration journal/snapshot if generated. [VERIFIED: `drizzle/meta/_journal.json`, `drizzle/*.sql`] | Add schema + migration consistently; run the project migration/test path in planning/execution. [VERIFIED: `package.json`, `server/db/migrate.ts`] |

## Common Pitfalls

### Pitfall 1: Atomic DB Write But Non-Atomic Response Projection

**What goes wrong:** The helper fails, but the route still sends `loggedMeal`, `mealId`, `dateKey`, or `mealRevisionId` from precomputed `loggedMeal` variables. [VERIFIED: `server/routes/chat.ts`]  
**Why it happens:** Current route computes `streamLoggedMealReceipt`/`jsonLoggedMealReceipt` before final persistence. [VERIFIED: `server/routes/chat.ts`]  
**How to avoid:** Make `finalizeAssistantReply` return a success object that controls whether receipt projection is allowed. [ASSUMED]  
**Warning signs:** Tests monkeypatching `saveAssistantReplyWithReceipt()` to throw still receive `loggedMeal` in JSON/SSE terminal payloads. [ASSUMED]

### Pitfall 2: Delete Outcomes Have No Route-Safe Structured Source

**What goes wrong:** Planner tries to build delete compressed-history facts from `renderMutationReceipt()` text. [VERIFIED: `server/orchestrator/mutation-receipts.ts`]  
**Why it happens:** Current `OrchestratorResult` exposes `loggedMeal` for log/update and `dailyTargets` for goals, but not `deletedMeal` or `mutationEffects`. [VERIFIED: `server/orchestrator/index.ts`]  
**How to avoid:** Return a typed `mutationOutcomeFact` from orchestrator/tool execution for all four scoped actions. [ASSUMED]  
**Warning signs:** Implementation branches on receipt text like `已刪除` or parses food names from assistant replies. [ASSUMED]

### Pitfall 3: Leaving Marker Checks In The Orchestrator

**What goes wrong:** `getCompressedHistory()` stops rendering success markers, but `detectHallucinatedChoiceFollowUp()` still treats old marker strings as meal mutation authority when legacy assistant text contains them. [VERIFIED: `server/orchestrator/index.ts`]  
**Why it happens:** Marker detection is not isolated to `formatToolSummary()`. [VERIFIED: codebase grep]  
**How to avoid:** Plan an explicit audit/removal or compatibility treatment for `[系統已完成餐點記錄]`, `[系統已完成餐點修改]`, and `[系統已完成餐點刪除]`. [VERIFIED: codebase grep]

### Pitfall 4: Breaking Legacy Chat History Display

**What goes wrong:** `/api/chat/history` stops hydrating display-safe `loggedMeal` for legacy rows. [VERIFIED: `tests/unit/chat.test.ts`, `tests/integration/chat-api.test.ts`]  
**Why it happens:** Structured outcome fail-closed rules for compressed history are mistakenly applied to UI display restoration. [VERIFIED: `72-CONTEXT.md`]  
**How to avoid:** Keep `getMealReceiptForAssistantMessage()` behavior for display, while making compressed-history mutation claims depend on new outcome rows. [VERIFIED: `server/services/chat.ts`, `72-CONTEXT.md`]

### Pitfall 5: Metadata Leakage In New Validation Logs

**What goes wrong:** Outcome validation or persistence failure logs raw food text, assistant text, ids, tool payloads, or DB snapshots. [VERIFIED: `docs/adr/0001-metadata-only-llm-failure-localization.md`, `72-AI-SPEC.md`]  
**Why it happens:** New schema validation often logs full payloads for debugging. [ASSUMED]  
**How to avoid:** Log only sanitized issue code/path/count and failure class. [CITED: `72-AI-SPEC.md`, `docs/adr/0001-metadata-only-llm-failure-localization.md`]

## Code Examples

### Existing Transaction Pattern To Reuse

```ts
return db.transaction((tx) => {
  tx.insert(chatMessages).values({ id, deviceId, role, content, createdAt }).run();
  if (imageAssetId) {
    tx.insert(assetReferences).values({ ownerType: "chat_message", ownerId: id }).run();
  }
  return { id, createdAt };
});
```

Source: `chatService.saveMessage()` in `server/services/chat.ts`. [VERIFIED: codebase grep]

### Existing Stale Receipt Display-Only Rule

```ts
const isCurrentActiveReceipt =
  receipt.deletedAt === null && receipt.mealRevisionId === receipt.currentRevisionId;

return {
  ...(isCurrentActiveReceipt
    ? { mealId: receipt.mealTransactionId, dateKey, mealRevisionId: receipt.mealRevisionId }
    : {}),
  foodName,
  itemCount,
  calories,
};
```

Source: `getMealReceiptForAssistantMessage()` in `server/services/chat.ts`. [VERIFIED: codebase grep]

### Existing Display-String Mutation Authority To Remove

```ts
const completed = content.trim() === "成功";
if (toolName === "log_food") {
  return completed ? "[系統已完成餐點記錄]" : "[系統餐點記錄未完成]";
}
```

Source: `formatToolSummary()` in `server/services/chat.ts`. [VERIFIED: codebase grep]

### Existing Renderer-Owned Receipt Source

```ts
case "delete": {
  const datePrefix = formatDatePrefix(effects.deletedMeal.dateKey || effects.affectedDate);
  return `已刪除${datePrefix}${effects.deletedMeal.foodName}，已從當日紀錄移除。`;
}
```

Source: `renderMutationReceipt()` in `server/orchestrator/mutation-receipts.ts`. [VERIFIED: codebase grep]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Compressed history infers mutation completion from tool success strings. | Persist structured mutation outcome facts and render only validated facts. | Phase 72 planning target. [VERIFIED: `72-CONTEXT.md`] | Closes false committed-memory risk for log/update/delete/goals. [VERIFIED: `72-AI-SPEC.md`] |
| Assistant row and receipt reference saved in separate calls. | One service transaction writes assistant row, receipt reference, and structured outcome fact. | Phase 72 planning target. [VERIFIED: `72-CONTEXT.md`] | Prevents chat history from exposing receipt identity after partial persistence. [VERIFIED: `72-CONTEXT.md`] |
| Legacy receipts can hydrate display-safe UI facts. | Preserve UI display compatibility but no compressed-history mutation claim without structured outcome facts. | Phase 72 planning target. [VERIFIED: `72-CONTEXT.md`] | Avoids backfilling authority from legacy/display state. [VERIFIED: `72-CONTEXT.md`] |

**Deprecated/outdated:**
- `formatToolSummary()` returning committed mutation markers for `"成功"` is outdated for scoped mutation tools. [VERIFIED: `server/services/chat.ts`, `72-CONTEXT.md`]
- Treating `[系統已完成餐點記錄]` style strings as authority in orchestrator follow-up recovery is suspect after this phase and must be reviewed. [VERIFIED: `server/orchestrator/index.ts`, `72-CONTEXT.md`]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The planner can make route projection depend on the atomic helper return value without changing public non-receipt response shapes. | Common Pitfalls / Architecture Patterns | Tests may reveal a larger route refactor is needed. |
| A2 | A typed `mutationOutcomeFact` returned from the orchestrator is the narrowest way to cover delete facts without parsing text. | Common Pitfalls / Architecture Patterns | Planner may instead derive facts in `executeTool()` or another helper, but must preserve the no-display-inference rule. |
| A3 | No new package install is needed, so slopcheck can be skipped. | Package Legitimacy Audit | If planner introduces a package, package legitimacy gate must be rerun before execution. |

## Open Questions

1. **Where should the new outcome type live?**  
   - What we know: `mutation-effects.ts` already contains safe committed effect types; `ToolExecutionResult` contains the tool result facts; `OrchestratorResult` currently omits a generic outcome field. [VERIFIED: codebase grep]  
   - What's unclear: whether the planner should expose `mutationEffects`, a new `MutationOutcomeFact`, or a separate service-facing DTO. [ASSUMED]  
   - Recommendation: expose the smallest service-facing DTO that contains only compressed-history-safe fields. [ASSUMED]

2. **Should the outcome payload be normalized columns or strict JSON payload?**  
   - What we know: context rejects opaque JSON directly in `chat_messages`, but leaves exact table/column names to the planner. [VERIFIED: `72-CONTEXT.md`]  
   - What's unclear: whether to use one table with discriminator plus JSON payload, or separate nullable columns for common fields. [ASSUMED]  
   - Recommendation: prefer a separate table with discriminator columns plus a strict validated payload if that is the smallest additive migration; never read unvalidated JSON into compressed history. [ASSUMED]

3. **Is a one-time transient retry worth planning?**  
   - What we know: context allows a narrowly scoped retry only if it does not weaken fail-closed behavior. [VERIFIED: `72-CONTEXT.md`]  
   - What's unclear: whether local SQLite failures in this app are meaningfully transient. [ASSUMED]  
   - Recommendation: skip retry unless planning finds a specific current failure mode; atomic fail-closed tests matter more. [ASSUMED]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | TypeScript scripts/tests | Yes | `v24.14.0` | None needed. [VERIFIED: env probe] |
| Yarn | Project commands | Yes | `1.22.22` | None; project forbids npm for project commands. [VERIFIED: env probe, `AGENTS.md`] |
| SQLite CLI | Optional DB inspection | Yes | `/usr/bin/sqlite3` | Use app/test DB helpers if CLI not needed. [VERIFIED: env probe] |
| `slopcheck` | Package legitimacy gate if new packages are added | No | — | Not required because no new packages are recommended. [VERIFIED: env probe, research scope] |

**Missing dependencies with no fallback:** none for the recommended no-new-package implementation. [VERIFIED: env probe]  
**Missing dependencies with fallback:** `slopcheck` is missing, but package gate is not needed unless the plan introduces packages. [VERIFIED: env probe]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Node built-in `node:test` through repo scripts. [VERIFIED: `package.json`, `AGENTS.md`] |
| Config file | No Jest/Vitest config; test scripts are in `package.json`. [VERIFIED: `package.json`, repo files] |
| Quick run command | `yarn tsc --noEmit` plus focused `node scripts/run-node-with-tz.mjs --import tsx --test ...` for touched tests. [VERIFIED: `AGENTS.md`, `package.json`] |
| Full suite command | `yarn test`; release gate is `yarn release:check`. [VERIFIED: `package.json`, `AGENTS.md`] |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| RCP-01 | Atomic assistant/receipt/outcome helper commits all rows or none. | unit/service + integration | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/chat.test.ts tests/integration/chat-api.test.ts tests/integration/chat-streaming.test.ts` | Existing files; new cases needed. [VERIFIED: tests grep] |
| RCP-01 | JSON/SSE terminal payload omits receipt identity when atomic persistence fails. | integration | `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/chat-api.test.ts tests/integration/chat-streaming.test.ts` | Existing files; new failure injection cases needed. [VERIFIED: tests grep] |
| HIST-01 | Compressed history renders log/update/delete/goals from structured outcome rows only. | unit/service | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/chat.test.ts tests/unit/history.test.ts` | Existing files; old expectations must change. [VERIFIED: tests grep] |
| HIST-01 | Missing/invalid/legacy-only outcome facts omit mutation claims. | unit/service | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/chat.test.ts` | Existing file; new cases needed. [VERIFIED: tests grep] |
| HIST-02 | Renderer-owned receipt semantics remain green for log/update/delete/goals. | unit | `yarn test:unit` or focused `tests/unit/mutation-receipts.test.ts tests/unit/orchestrator.test.ts` | Existing files. [VERIFIED: tests grep] |
| HIST-02 | `/api/chat/history` preserves legacy display-safe receipt projection and stale display-only identity. | unit + integration | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/chat.test.ts tests/integration/chat-api.test.ts` | Existing files. [VERIFIED: tests grep] |

### Sampling Rate

- **Per task commit:** `yarn tsc --noEmit` and the focused unit/integration files touched by that task. [CITED: `AGENTS.md`]
- **Per wave merge:** `yarn test:unit` plus `yarn test:integration` when route/service/schema files changed. [CITED: `AGENTS.md`]
- **Phase gate:** `yarn release:check` before promotion readiness; no staging/main promotion is authorized by this phase. [CITED: `AGENTS.md`, `.planning/REQUIREMENTS.md`]

### Wave 0 Gaps

- [ ] `tests/unit/chat.test.ts` — red cases for valid/missing/invalid/legacy-only structured outcomes in compressed history. [VERIFIED: current tests still expect success-string marker]
- [ ] `tests/unit/history.test.ts` — update bridge expectation away from raw/success-string mutation markers for scoped tools. [VERIFIED: current test expects `系統已完成餐點記錄`]
- [ ] `tests/integration/chat-api.test.ts` — JSON atomic persistence failure case that proves response/history omit receipt-derived identity. [VERIFIED: file exists]
- [ ] `tests/integration/chat-streaming.test.ts` — SSE done/stopped/fallback atomic persistence failure cases. [VERIFIED: file exists]
- [ ] `tests/unit/orchestrator.test.ts` — proof that log/update/delete/goals expose structured outcome facts without changing renderer-owned receipt copy. [VERIFIED: file exists]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | Yes | Keep cookie-backed guest-session resolution in routes; do not derive ownership from raw device query/header inputs. [CITED: `AGENTS.md`] |
| V3 Session Management | Yes | Preserve existing signed guest session flow for `/api/chat` and `/api/chat/history`. [VERIFIED: `server/routes/chat.ts`, `server/lib/guest-session-resolver.ts`] |
| V4 Access Control | Yes | Scope every chat/outcome query by `deviceId` and join receipt rows through same-device checks. [VERIFIED: `server/services/chat.ts`] |
| V5 Input Validation | Yes | Validate structured outcome payloads with Zod before insert/read/render. [CITED: `72-AI-SPEC.md`] |
| V6 Cryptography | No new cryptography | Do not introduce custom crypto for this phase. [ASSUMED] |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Cross-device receipt/outcome disclosure | Information Disclosure | Include `deviceId` in structured outcome rows and all lookup predicates; mirror existing receipt joins. [VERIFIED: `server/services/chat.ts`] |
| SQL injection through outcome lookups | Tampering | Use Drizzle builders/parameterized SQL, not raw interpolated user strings. [CITED: `nutrition-security-review` skill, codebase pattern] |
| Metadata leakage during validation failures | Information Disclosure | Log sanitized issue paths/codes/counts only; no payload dumps. [CITED: `docs/adr/0001-metadata-only-llm-failure-localization.md`, `72-AI-SPEC.md`] |
| Stale edit/delete identity revival | Elevation of Privilege / Tampering | Preserve current active revision check before exposing `mealId`, `dateKey`, and `mealRevisionId`. [VERIFIED: `server/services/chat.ts`, `72-CONTEXT.md`] |
| False committed memory in LLM context | Tampering | Render compressed mutation facts only from complete validated structured outcome rows. [VERIFIED: `72-CONTEXT.md`] |

## Sources

### Primary (HIGH confidence)

- `.planning/phases/72-receipt-atomicity-and-structured-history-state/72-CONTEXT.md` — locked decisions D-01 through D-28 and deferred scope. [VERIFIED: local file read]
- `.planning/REQUIREMENTS.md` — RCP-01, HIST-01, HIST-02 requirements and v2.5 scope. [VERIFIED: local file read]
- `.planning/phases/72-receipt-atomicity-and-structured-history-state/72-AI-SPEC.md` — AI design/eval contract for no new AI framework, structured facts, and metadata-only evidence. [VERIFIED: local file read]
- `AGENTS.md` — project commands, architecture boundaries, testing matrix, and workflow rules. [VERIFIED: local file read]
- `server/routes/chat.ts` — split write, response projection, JSON/SSE terminal paths, fallback/stopped handling. [VERIFIED: codebase grep]
- `server/services/chat.ts` — message transaction pattern, receipt joins, stale display-only identity, compressed-history formatter. [VERIFIED: codebase grep]
- `server/db/schema.ts` — current `chat_messages`, `chat_meal_receipts`, meal revision schema and constraints. [VERIFIED: codebase grep]
- `server/orchestrator/index.ts`, `server/orchestrator/tools.ts`, `server/orchestrator/mutation-effects.ts`, `server/orchestrator/mutation-receipts.ts` — mutation effects, tool result facts, renderer-owned receipt behavior, and current result shape. [VERIFIED: codebase grep]
- `tests/unit/chat.test.ts`, `tests/unit/history.test.ts`, `tests/unit/orchestrator.test.ts`, `tests/unit/mutation-receipts.test.ts`, `tests/integration/chat-api.test.ts`, `tests/integration/chat-streaming.test.ts` — existing proof surfaces and gaps. [VERIFIED: codebase grep]
- `docs/adr/0001-metadata-only-llm-failure-localization.md`, `docs/adr/0002-correction-authority-and-meal-intent.md` — privacy and correction authority decisions. [VERIFIED: local file read]

### Secondary (MEDIUM confidence)

- Project skills `.codex/skills/nutrition-gen-test/SKILL.md`, `.codex/skills/nutrition-verify-change/SKILL.md`, `.codex/skills/nutrition-security-review/SKILL.md` — repo-native test and security review patterns. [VERIFIED: local file read]

### Tertiary (LOW confidence)

- No external web search was used; external regulatory/source claims in AI-SPEC were not reverified during this research pass. [VERIFIED: tool usage]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions and scripts are from `package.json`, and no new dependencies are recommended. [VERIFIED: `package.json`]
- Architecture: HIGH — route/service/orchestrator boundaries and defect sites were verified in source. [VERIFIED: codebase grep]
- Pitfalls: HIGH for split write/display-string authority/stale identity; MEDIUM for exact helper/outcome DTO shape because planner has discretion. [VERIFIED: codebase grep, `72-CONTEXT.md`]
- Validation: HIGH — existing tests and commands are directly present; new cases are clearly localized. [VERIFIED: tests grep, `package.json`]

**Research date:** 2026-06-01  
**Valid until:** 2026-07-01 for local architecture; recheck package versions and docs if planning introduces new external dependencies.
