# Phase 65: Tool Contract Alignment and Meal-Period Authority - Research

**Researched:** 2026-05-27  
**Domain:** TypeScript/Fastify orchestrator contracts, SQLite meal persistence, React DTO projection  
**Confidence:** HIGH for local architecture and test strategy; MEDIUM for exact persistence DDL until migration is generated.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
## Implementation Decisions

### Trusted Protein Contract
- **D-01:** `protein_sources` is parse-time optional, execution-time guarded, and server-owned. The model may omit it; only backend-normalized facts decide whether trusted protein is persisted or surfaced.
- **D-02:** Carry-forward prompt guidance remains in force: trace foods, generic ingredients, and weak anchors must not be treated as trusted protein sources.
- **D-03:** New Phase 65 prompt decision: the prompt contract must stop saying `protein_sources` is always required. It should tell the model to provide `protein_sources` only when credible anchors exist and to omit it when credible anchors are missing.
- **D-04:** Successful log reply copy should mention trusted protein sources only when the backend has counted trusted sources. Raw model `protein_sources` must not drive reply copy.
- **D-05:** Unsupported positive trusted-protein claims should default to commit-and-strip/normalize. Rejection is a rare escape hatch for structural contradictions that cannot be repaired or mapped coherently to the submitted meal.
- **D-06:** Weak anchors, vague names, low-confidence sources, or missing sources are not rejection reasons by themselves. If planning starts enumerating many rejection classes, it is drifting toward the rejected "required and fail closed" policy.
- **D-07:** Downstream code must read trusted-protein authority only from backend-normalized facts. Raw model `protein_sources` is parse-time evidence only; if exposed for debugging, it must be redacted metadata and never authority for reply copy, ranking, or correction reasoning.

### Meal-Period Authority
- **D-08:** `loggedAt` and `mealPeriod` are separate authorities. `loggedAt` remains actual/historical timestamp and date-placement authority; `mealPeriod` carries explicit user meal-category intent for display and correction targeting.
- **D-09:** Missing/null `mealPeriod` means no explicit period authority. Hour-based inference from `loggedAt` is allowed only as legacy/no-authority fallback.
- **D-10:** Historical log synthetic midpoint behavior can continue for `loggedAt` date placement, but explicit meal-period intent must still persist beside it so downstream code does not re-derive intent from synthetic hour.
- **D-11:** Authoritative `mealPeriod` must be grounded in original user/source text with direct meal-category words, such as supported equivalents for `早餐/早飯`, `午餐/午飯`, `晚餐/晚飯`, and `宵夜`.
- **D-12:** Time-of-day phrases such as `早上`, `中午`, or `晚上` may support timestamp/date parsing or fallback inference, but must not become persisted explicit period authority by themselves.
- **D-13:** Tool-provided `meal_period` is parse-time evidence only. If model args conflict with direct source text, source text wins and the backend should normalize rather than fail the log.
- **D-14:** A single `log_food` call represents one meal-level record and can carry at most one authoritative `mealPeriod`. Multi-period user text should be represented by separate meal logs; if one tool call cannot coherently map period to meal, the reject-or-clarify path is only about meal-logging/tool coherence and not Phase 67 correction-target clarification rendering.
- **D-15:** Meal-category words inside `food_name` or item labels can help map evidence, but cannot create authority unless grounded in original user/source text. Model-authored labels must not manufacture persisted period intent.

### DTO and UI Projection
- **D-16:** Phase 65 should project one backend period field anywhere a meal row or logged-meal receipt is represented: current-day meals, history/day snapshot meals, `loggedMeal` receipts, mutation/update responses, and edit payloads.
- **D-17:** Public client-facing field: `mealPeriod?: "breakfast" | "lunch" | "dinner" | "late_night"`. The enum is authority; Traditional Chinese labels are frontend presentation.
- **D-18:** Do not backfill inferred values into `mealPeriod`, and do not add `inferredMealPeriod` in Phase 65. `mealPeriod` present means explicit backend authority; missing/null means clients may use `loggedAt` fallback for display.
- **D-19:** Any surface that renders meal-period labels should prefer `mealPeriod` when present and fall back to `loggedAt` hour inference only when missing. Timestamp-only rows may either remain time-only or intentionally add period labels during planning; this decision does not claim every listed UI surface already renders hour-based meal-period labels.
- **D-20:** Direct edit/PATCH flows should carry `mealPeriod` in payloads/responses for projection, but ordinary numeric, name, macro, image, or meal-content edits must preserve existing explicit period when the edit omits it. Changing or clearing period requires an explicit grounded period correction.
- **D-21:** Tests should prove DTO/receipt projection, UI helper preference over `loggedAt`, legacy fallback inference, and edit preservation on omitted `mealPeriod`. Keep proof focused on projection behavior, not summary redesign or exhaustive screen coverage.

### Correction Candidate Handoff
- **D-22:** Phase 65 should expose explicit source-text-backed `mealPeriod` as a clean authority fact distinguishable from `loggedAt` fallback. Phase 67 owns ranking weights, tie-breaking, hard/soft matching, food-label precedence, and clarification behavior.
- **D-23:** Phase 65 owns INTENT-03 candidate projection at the fact-authority boundary: `MealCorrectionCandidate.mealPeriod` should use persisted explicit `mealPeriod` when available and fall back to `inferMealPeriod(loggedAt)` only for legacy/no-authority rows.
- **D-24:** Correction candidates should carry effective period plus source. `candidate.mealPeriod` can remain the compatibility/effective value, while a companion source field distinguishes explicit authority from inferred fallback.
- **D-25:** Use domain labels `explicit` and `inferred` for the source field. `explicit` means persisted source-text-backed user intent; `inferred` means no explicit authority, effective period came from `loggedAt` fallback.
- **D-26:** Candidate tests should prove explicit lunch with breakfast-hour `loggedAt` yields `mealPeriod="lunch"` and source `"explicit"`, while legacy/no-authority rows infer from `loggedAt` with source `"inferred"`. Full ranking, tie-breaking, hard/soft matching, and clarification tests stay Phase 67.

### Metadata and Proof Guardrails
- **D-27:** New `mealPeriod` and candidate source fields are structured facts. Normal proof and trace artifacts must remain metadata-only and must not persist raw prompts, user text, assistant final text, raw tool payloads, image data, session material, or database snapshots.

### the agent's Discretion
- Exact persistence shape is for plan-phase calibration: it may live in meal transaction headers, revisions, projected meal facts, or another additive schema shape as long as the logical authority contract above holds.
- Exact structural-contradiction calibration for trusted-protein rejection is for plan-phase. The default policy must still read as "commit the meal and strip unsupported trust."
- Exact public/internal naming for candidate source may be calibrated in plan-phase, but the domain values should remain `explicit` / `inferred`.

### Deferred Ideas (OUT OF SCOPE)
## Deferred Ideas

None — discussion stayed within phase scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TOOL-01 | The `log_food` LLM-facing JSON schema and runtime Zod executor contract agree on whether `protein_sources` is required. | `server/orchestrator/tools.ts` has optional Zod `protein_sources` but JSON schema currently says `Required` and lists `required: ["protein_sources"]`; plan should remove the JSON-schema requirement and update prompt/tests. [VERIFIED: server/orchestrator/tools.ts] [VERIFIED: .planning/REQUIREMENTS.md] |
| TOOL-02 | Trusted-protein behavior remains protected after schema alignment. | Existing tests cover counted anchors, excluded trace sources, weak/generic source repair, missing quantity, and trusted-protein rejection boundaries in `tests/unit/tools.test.ts`; plan should keep these green and add one omission case. [VERIFIED: tests/unit/tools.test.ts] [VERIFIED: .planning/REQUIREMENTS.md] |
| TOOL-03 | Successful text and image logging still return committed receipts and `summaryOutcome` without LLM-authored mutation facts. | `ToolExecutionResult.loggedMeal`, `summaryOutcome`, projected reply helpers, and chat route receipt persistence already implement committed receipt behavior; plan should extend the receipt shape without changing summary outcome policy. [VERIFIED: server/orchestrator/tools.ts] [VERIFIED: server/orchestrator/index.ts] [VERIFIED: server/routes/chat.ts] |
| INTENT-01 | Explicit meal-period intent is persisted as authority for new logs even when clock hour differs. | Add nullable persisted `mealPeriod` to the meal transaction boundary and derive it from source text, not from `loggedAt` hour or model-only labels. [VERIFIED: .planning/phases/65-tool-contract-alignment-and-meal-period-authority/65-CONTEXT.md] [VERIFIED: server/services/meal-transactions.ts] |
| INTENT-02 | Current-day and historical meal rows expose period from persisted structured facts. | Project `mealPeriod` through `/api/meals`, `/api/day-snapshot`, `/api/history/meals`, `/api/history/days/:date`, logged receipts, client normalizers, and edit payload builders. [VERIFIED: server/routes/meals.ts] [VERIFIED: server/routes/day-snapshot.ts] [VERIFIED: server/services/history-query.ts] [VERIFIED: client/src/types.ts] |
| INTENT-03 | Correction candidate scoring uses persisted period facts when available and does not let clock heuristics override explicit intent. | `MealCorrectionCandidate.mealPeriod` currently comes from `inferMealPeriod(loggedAt)`; plan should load persisted `mealPeriod`, expose source `explicit`/`inferred`, and leave ranking redesign to Phase 67. [VERIFIED: server/services/meal-correction.ts] [VERIFIED: 65-CONTEXT.md] |
</phase_requirements>

## Summary

Phase 65 is primarily an authority-boundary phase, not a new feature-stack phase. The safest plan is to keep the existing Fastify/SQLite/Zod/React stack, align the `log_food` JSON schema and prompt to the already-optional Zod executor, and add one nullable structured meal-period authority field at the meal transaction level. [VERIFIED: package.json] [VERIFIED: server/orchestrator/tools.ts] [VERIFIED: server/db/schema.ts] [VERIFIED: 65-CONTEXT.md]

The recommended persistence shape is `meal_transactions.meal_period` as nullable text with enum values `breakfast | lunch | dinner | late_night`. This fits the locked one-meal-one-period rule, preserves edits by default, keeps `loggedAt` as date/timestamp authority, lets legacy rows remain null, and gives correction candidates a cheap header-level fact. [VERIFIED: server/services/meal-transactions.ts] [VERIFIED: server/services/meal-correction.ts] [VERIFIED: 65-CONTEXT.md]

Do not broaden the phase into candidate ranking policy, correction clarification rendering, snack taxonomy, or trace payload capture. Those are either Phase 67 responsibilities or explicitly excluded by metadata-only proof constraints. [VERIFIED: .planning/ROADMAP.md] [VERIFIED: 65-CONTEXT.md] [VERIFIED: .planning/PROJECT.md]

**Primary recommendation:** Use an additive `meal_transactions.meal_period` nullable enum-like text column, source-text-only backend normalization for explicit authority, DTO projection everywhere meal rows/receipts flow, and focused Node `node:test` unit/integration coverage. [VERIFIED: server/db/schema.ts] [VERIFIED: AGENTS.md] [CITED: https://nodejs.org/api/test.html]

## Project Constraints (from AGENTS.md)

- Use `yarn` only; do not use `npm` for repo work. [VERIFIED: AGENTS.md]
- Keep local TypeScript imports ESM-compatible with explicit `.js` specifiers. [VERIFIED: AGENTS.md]
- Use Node built-in `node:test`; do not introduce Jest or Vitest without explicit migration approval. [VERIFIED: AGENTS.md]
- Use real SQLite in tests; `:memory:` is allowed and DB mocking is not. [VERIFIED: AGENTS.md]
- Preserve `TZ=Asia/Taipei` for day-boundary behavior and test setup. [VERIFIED: AGENTS.md]
- Wire new backend dependencies through `server/app.ts`; keep route validation/transport shaping in routes and domain/persistence logic in services. [VERIFIED: AGENTS.md]
- `server/orchestrator/*` owns tool definitions, model workflow, prompt construction, tool execution, and fallback behavior. [VERIFIED: AGENTS.md]
- `client/src/store.ts` is the Zustand state boundary; `client/src/api.ts` and `client/src/sse.ts` own transport helpers. [VERIFIED: AGENTS.md]
- Any TypeScript edit requires `yarn tsc --noEmit`; route/service edits require integration tests; promotion readiness requires `yarn release:check`. [VERIFIED: AGENTS.md] [VERIFIED: .codex/skills/nutrition-verify-change/SKILL.md]
- Normal proof and harness artifacts must remain metadata-only and must not include raw prompts, user text, assistant final text, raw tool payloads, image data, session material, or database snapshots. [VERIFIED: AGENTS.md] [VERIFIED: .planning/PROJECT.md]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| `protein_sources` contract alignment | API / Backend orchestrator | LLM prompt | The executable schema and JSON schema live in `server/orchestrator/tools.ts`; prompt wording in `system-prompt.ts` should match but cannot be authoritative. [VERIFIED: server/orchestrator/tools.ts] [VERIFIED: server/orchestrator/system-prompt.ts] |
| Trusted-protein authority | API / Backend orchestrator | Persistence | `normalizeTrustedProteinEstimate` and backend counted/excluded sources already decide receipt facts; raw model input is evidence only. [VERIFIED: server/orchestrator/tools.ts] [VERIFIED: server/orchestrator/protein-trust.ts] |
| Explicit meal-period extraction | API / Backend orchestrator | Persistence | `runContract` context provides `currentUserMessage`; explicit source-text extraction should happen before writing the meal. [VERIFIED: server/orchestrator/tools.ts] |
| Meal-period persistence | Database / Storage | API / Backend services | `meal_transactions` owns meal-level `loggedAt` and revision identity, making it the least invasive place for one meal-level period fact. [VERIFIED: server/db/schema.ts] [VERIFIED: server/services/meal-transactions.ts] |
| Current-day meal DTO projection | API / Backend routes | Client transport | `/api/meals` maps service entries into public meal rows; client `getMeals` normalizes that shape. [VERIFIED: server/routes/meals.ts] [VERIFIED: client/src/api.ts] |
| Historical DTO projection | API / Backend services | Client transport | `history-query.ts` builds `HistoryMealDto`; `/api/history/days/:date` returns those DTOs and client `normalizeHistoryMeal` converts them. [VERIFIED: server/services/history-query.ts] [VERIFIED: server/routes/history.ts] [VERIFIED: client/src/api.ts] |
| Logged meal receipts | API / Backend routes | Client chat/store | `ToolExecutionResult.loggedMeal` is projected by chat routes and consumed by chat history/SSE/client normalizers. [VERIFIED: server/orchestrator/tools.ts] [VERIFIED: server/routes/chat.ts] [VERIFIED: client/src/api.ts] |
| UI label preference | Browser / Client | API DTOs | `HomeScreen.getDisplayMealLabel` and `getMealBadge` currently infer labels from `loggedAt`; update helpers to accept `mealPeriod` first and fallback to `loggedAt`. [VERIFIED: client/src/components/HomeScreen.tsx] |
| Correction candidate handoff | API / Backend service | Database / Storage | `MealCorrectionCandidate` is built in `meal-correction.ts`; it currently infers period from `loggedAt` and should instead expose effective period plus source. [VERIFIED: server/services/meal-correction.ts] |

## Standard Stack

### Core

| Library / Tool | Version | Purpose | Why Standard |
|----------------|---------|---------|--------------|
| TypeScript | 5.9.3 installed | Static typing across server/client and explicit DTO contracts. | Existing repo compiler and lockfile already use TypeScript; all phase surfaces are `.ts`/`.tsx`. [VERIFIED: package.json] [VERIFIED: yarn.lock] |
| Node.js | v24.14.0 available | Runtime and built-in `node:test` runner. | Project scripts invoke `node --import tsx --test`; official Node docs describe `node:test` and `--test` as the test runner path. [VERIFIED: command probe] [VERIFIED: package.json] [CITED: https://nodejs.org/api/test.html] |
| Zod | 4.3.6 installed | Runtime validation for tool argument contracts. | `logFoodSchema` is already Zod-based; Zod docs support `.parse`, granular `ZodError`, enums, and `.optional()`. [VERIFIED: package.json] [VERIFIED: server/orchestrator/tools.ts] [CITED: https://zod.dev/basics] [CITED: https://zod.dev/api?id=sets] |
| Drizzle ORM | 0.39.3 installed | SQLite schema definitions and query builder. | Existing schema and migrations are Drizzle-based; Drizzle docs show SQLite `schema.ts`, migration folder, and generated migration workflow. [VERIFIED: package.json] [VERIFIED: server/db/schema.ts] [CITED: https://orm.drizzle.team/docs/get-started/sqlite-existing] |
| better-sqlite3 | 11.10.0 installed | SQLite driver for runtime and tests. | `createDb` initializes Drizzle with `drizzle-orm/better-sqlite3` and in-memory tests bootstrap migrations automatically. [VERIFIED: package.json] [VERIFIED: server/db/client.ts] |
| React + Vite + Zustand | React 19.0.0, Vite 6.2.0, Zustand 5.0.0 installed | Client DTO consumption and meal row presentation. | Existing client uses React components, Vite scripts, and Zustand store boundary. [VERIFIED: package.json] [VERIFIED: client/src/store.ts] |

### Supporting

| Library / Tool | Version | Purpose | When to Use |
|----------------|---------|---------|-------------|
| tsx | 4.21.0 installed | Execute TypeScript tests/scripts under Node. | Existing `yarn test:*`, `db:migrate`, and dev scripts use `--import tsx`. [VERIFIED: package.json] [VERIFIED: yarn.lock] |
| drizzle-kit | 0.31.10 installed | Generate migrations from `server/db/schema.ts`. | Use when adding `meal_period` to the Drizzle schema and creating migration SQL. [VERIFIED: package.json] [VERIFIED: drizzle.config.ts] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `meal_transactions.meal_period` nullable header column | `meal_revisions.meal_period` copied per revision | Revision storage can audit period changes, but Phase 65 needs preservation on ordinary edits; revision-level storage forces every update path to copy forward the period. Header storage better matches one meal-level authority. [VERIFIED: server/services/meal-transactions.ts] [VERIFIED: 65-CONTEXT.md] |
| Backend source-text extractor | Trust `args.meal_period` directly | Model args are parse-time evidence only by locked decision; trusting them would let model-authored labels manufacture authority. [VERIFIED: 65-CONTEXT.md] |
| Add `inferredMealPeriod` public DTO | Keep `mealPeriod` explicit-only and infer on client helper fallback | Locked decision forbids `inferredMealPeriod` in Phase 65 and defines missing/null `mealPeriod` as no explicit authority. [VERIFIED: 65-CONTEXT.md] |

**Installation:**

No new package installation is recommended for Phase 65. [VERIFIED: package.json] [VERIFIED: 65-CONTEXT.md]

## Package Legitimacy Audit

Phase 65 should not install external packages. Existing stack packages were read from `package.json`/`yarn.lock`; `slopcheck` was not available, and no new package is proposed. [VERIFIED: package.json] [VERIFIED: yarn.lock] [VERIFIED: command probe]

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| None proposed | — | — | — | — | not run | No install task needed |

**Packages removed due to slopcheck [SLOP] verdict:** none. [VERIFIED: no new package recommendation]  
**Packages flagged as suspicious [SUS]:** none. [VERIFIED: no new package recommendation]

## Architecture Patterns

### System Architecture Diagram

```text
User text/image
  -> Fastify /api/chat route
  -> Orchestrator tool selection
  -> log_food JSON schema + Zod contract
  -> Backend normalization
       -> trusted protein counted/excluded facts
       -> explicit mealPeriod from source text only
       -> loggedAt from current/historical date placement
  -> Food logging service
  -> meal_transactions header + meal_revisions/items
  -> SummaryOutcome recompute
  -> LoggedMeal receipt + route DTOs
       -> /api/meals current-day rows
       -> /api/day-snapshot rows
       -> /api/history/* rows
       -> chat loggedMeal receipts
  -> Client api.ts normalizers
  -> UI label helpers prefer mealPeriod, fallback to loggedAt

Correction path:
find_meals query
  -> meal-correction loadActiveCandidates
  -> candidate.mealPeriod = persisted explicit OR inferMealPeriod(loggedAt)
  -> candidate.mealPeriodSource = explicit | inferred
  -> Phase 67 ranking consumes clean facts later
```

All nodes in this flow already exist except explicit `mealPeriod` extraction/persistence/projection and candidate source tagging. [VERIFIED: server/orchestrator/tools.ts] [VERIFIED: server/services/meal-transactions.ts] [VERIFIED: server/services/meal-correction.ts] [VERIFIED: client/src/api.ts]

### Recommended Project Structure

```text
server/
├── db/schema.ts                         # add nullable meal_period on meal_transactions
├── lib/meal-period.ts                   # shared explicit source-text extractor and labels, if planner wants a small module
├── orchestrator/tools.ts                # schema/prompt-facing log_food execution and receipt projection
├── orchestrator/system-prompt.ts        # conditional protein_sources prompt contract
├── services/meal-transactions.ts        # write/read transaction-level mealPeriod
├── services/food-logging.ts             # compatibility entry projection
├── services/meal-history.ts             # current-day/historical read projection
├── services/history-query.ts            # HistoryMealDto projection
├── services/meal-correction.ts          # candidate effective mealPeriod/source
└── routes/{chat,meals,day-snapshot,history}.ts

client/src/
├── types.ts                             # public mealPeriod enum field
├── api.ts                               # transport guards/normalizers
├── meal-edit-payload.ts                 # edit payload preservation
└── components/HomeScreen.tsx            # label/badge helper preference

tests/
├── unit/tools.test.ts
├── unit/meal-correction.test.ts
├── unit/home-dashboard-contract.test.ts
├── unit/meal-edit-payload.test.ts        # create if missing
└── integration/{chat-api,meals-api,history-api}.test.ts
```

This structure follows existing ownership boundaries and uses existing test directories. [VERIFIED: AGENTS.md] [VERIFIED: repo file scan]

### Pattern 1: Additive Nullable Meal Authority

**What:** Add nullable `mealPeriod` to the transaction header and never synthesize values for legacy rows. [VERIFIED: server/db/schema.ts] [VERIFIED: 65-CONTEXT.md]

**When to use:** Use for new logs where backend source-text extraction finds a direct meal-category word; leave null when no explicit authority exists. [VERIFIED: 65-CONTEXT.md]

**Example:**

```typescript
// Source: server/db/schema.ts + 65-CONTEXT.md
export const mealTransactions = sqliteTable("meal_transactions", {
  // existing fields...
  loggedAt: text("logged_at").notNull(),
  mealPeriod: text("meal_period", {
    enum: ["breakfast", "lunch", "dinner", "late_night"],
  }),
});
```

Drizzle's SQLite docs show text columns in `sqliteTable` and schema updates through migration generation; local migrations already use raw SQL for SQLite constraints when needed. [CITED: https://orm.drizzle.team/docs/get-started/sqlite-existing] [VERIFIED: drizzle/0005_chat_message_status.sql]

### Pattern 2: Source-Text-Only Explicit Period Extraction

**What:** Derive explicit `mealPeriod` from `context.currentUserMessage`, with direct meal-category words only; do not persist `早上`, `中午`, or `晚上` as explicit authority. [VERIFIED: 65-CONTEXT.md] [VERIFIED: server/orchestrator/tools.ts]

**When to use:** Run during `log_food` execution after date intent resolution and before `foodLoggingService.logGroupedMeal`. [VERIFIED: server/orchestrator/tools.ts]

**Example:**

```typescript
// Source: 65-CONTEXT.md + server/orchestrator/tools.ts
type MealPeriod = "breakfast" | "lunch" | "dinner" | "late_night";

function extractExplicitMealPeriodFromSourceText(sourceText: string): MealPeriod | undefined {
  if (/(早餐|早飯)/.test(sourceText)) return "breakfast";
  if (/(午餐|午飯)/.test(sourceText)) return "lunch";
  if (/(晚餐|晚飯)/.test(sourceText)) return "dinner";
  if (/宵夜/.test(sourceText)) return "late_night";
  return undefined;
}
```

Planner note: existing `extractHistoricalMealPeriod` and `meal-correction.extractMealPeriod` include time-of-day words and snack labels; do not reuse them for persisted authority without narrowing semantics. [VERIFIED: server/orchestrator/tools.ts] [VERIFIED: server/services/meal-correction.ts] [VERIFIED: 65-CONTEXT.md]

### Pattern 3: Effective Candidate Fact With Source

**What:** Keep `candidate.mealPeriod` as compatibility/effective value, and add `candidate.mealPeriodSource: "explicit" | "inferred"`. [VERIFIED: 65-CONTEXT.md]

**When to use:** In `loadActiveCandidates`, after selecting meal transaction headers and before scoring. [VERIFIED: server/services/meal-correction.ts]

**Example:**

```typescript
// Source: server/services/meal-correction.ts + 65-CONTEXT.md
const explicitMealPeriod = normalizeStoredMealPeriod(header.mealPeriod);
return {
  // existing candidate fields...
  mealPeriod: explicitMealPeriod ?? inferMealPeriod(header.loggedAt),
  mealPeriodSource: explicitMealPeriod ? "explicit" : "inferred",
};
```

### Anti-Patterns to Avoid

- **Backfilling inferred periods into `mealPeriod`:** This would erase the distinction between explicit user authority and legacy clock fallback. [VERIFIED: 65-CONTEXT.md]
- **Trusting `args.meal_period` over source text:** Model arguments are parse-time evidence only and can conflict with user text. [VERIFIED: 65-CONTEXT.md]
- **Changing `loggedAt` to force display labels:** `loggedAt` remains date/timestamp authority; changing it for display would risk date placement and summary boundaries. [VERIFIED: 65-CONTEXT.md] [VERIFIED: server/lib/time.ts]
- **Routing Phase 65 into ranking redesign:** Full weights, hard/soft matching, tie-breaking, and clarification behavior are Phase 67. [VERIFIED: .planning/ROADMAP.md] [VERIFIED: 65-CONTEXT.md]
- **Adding Jest/Vitest or mocked DBs:** Project policy requires Node `node:test` and real SQLite. [VERIFIED: AGENTS.md]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Runtime tool validation | Custom JSON argument validator | Existing Zod schemas in `tools.ts` | Zod already produces structured parse failures and is wired into `runContract`. [VERIFIED: server/orchestrator/tools.ts] [CITED: https://zod.dev/basics] |
| SQLite migration plumbing | Custom migration runner | Existing Drizzle migrations and `yarn db:generate`/`yarn db:migrate` | Repo already uses Drizzle migration journal and `applyMigrations`. [VERIFIED: package.json] [VERIFIED: server/db/migrate.ts] |
| Test framework | Jest/Vitest | Node `node:test` with `node:assert/strict` | Project policy and existing tests use Node's built-in runner. [VERIFIED: AGENTS.md] [CITED: https://nodejs.org/api/test.html] |
| Inferred meal labels in many components | Per-component hour logic | Shared helper accepting `mealPeriod` + `loggedAt` | `HomeScreen` already centralizes label/badge helpers used elsewhere; expand the helper instead of scattering rules. [VERIFIED: client/src/components/HomeScreen.tsx] |
| Correction candidate authority | Ad hoc ranking flags | Effective `mealPeriod` plus `mealPeriodSource` | Phase 65 only needs fact authority handoff; Phase 67 owns ranking policy. [VERIFIED: 65-CONTEXT.md] |

**Key insight:** The hard part is preserving authority provenance, not parsing more labels. Keep explicit authority sparse and structured; keep fallback inference visibly separate. [VERIFIED: 65-CONTEXT.md]

## Runtime State Inventory

| Category | Items Found | Action Required |
|----------|-------------|-----------------|
| Stored data | SQLite tables include `meal_transactions`, `meal_revisions`, `meal_revision_items`, `chat_meal_receipts`; `meal_transactions` currently stores `logged_at` but no `meal_period`. [VERIFIED: server/db/schema.ts] [VERIFIED: drizzle/0002_meal_transaction_v2_foundation.sql] | Add nullable column via migration. No data backfill; legacy rows remain null and infer only at read/candidate fallback. [VERIFIED: 65-CONTEXT.md] |
| Live service config | No external live service config was identified for this phase; behavior is local app code + SQLite. [VERIFIED: .planning/ROADMAP.md] [VERIFIED: repo scan] | None. |
| OS-registered state | No launchd/systemd/pm2/task registration is part of this phase. [VERIFIED: .planning/ROADMAP.md] | None. |
| Secrets/env vars | No new secret or env var is needed; existing `TZ=Asia/Taipei` remains required. [VERIFIED: AGENTS.md] [VERIFIED: server/lib/time.ts] | Preserve test/runtime timezone setup. |
| Build artifacts | Drizzle migration journal and generated SQL are persistent repo artifacts; `dist/client` is not relevant to research but `yarn build` may be part of release checks. [VERIFIED: drizzle/meta/_journal.json] [VERIFIED: package.json] | Generate/add migration artifacts if schema changes; do not hand-edit generated harness artifacts. [VERIFIED: AGENTS.md] |

## Common Pitfalls

### Pitfall 1: Treating `meal_period` Tool Args As Authority

**What goes wrong:** The model can pass `meal_period: "breakfast"` for text saying `午餐`, causing stored facts to contradict user intent. [VERIFIED: 65-CONTEXT.md]  
**Why it happens:** Existing `log_food` already accepts optional `meal_period` for historical midpoint construction. [VERIFIED: server/orchestrator/tools.ts]  
**How to avoid:** Extract authority from `context.currentUserMessage`; use tool args only as fallback evidence for loggedAt midpoint where allowed. [VERIFIED: 65-CONTEXT.md]  
**Warning signs:** Tests assert only `loggedAt` hour instead of persisted `mealPeriod`. [VERIFIED: tests/unit/tools.test.ts]

### Pitfall 2: Reusing Existing Time-Phrase Extractors For Persistence

**What goes wrong:** `中午` or `晚上` becomes persisted explicit authority even though locked decisions say time-of-day phrases are not meal-category authority. [VERIFIED: 65-CONTEXT.md]  
**Why it happens:** Existing `extractHistoricalMealPeriod` maps `早上/中午/晚上` and `extractMealPeriod` does similar query hint extraction. [VERIFIED: server/orchestrator/tools.ts] [VERIFIED: server/services/meal-correction.ts]  
**How to avoid:** Create a narrower extractor for persisted authority. [VERIFIED: 65-CONTEXT.md]  
**Warning signs:** Source text `中午我吃...` yields `mealPeriod: "lunch"` in a persistence test. [VERIFIED: 65-CONTEXT.md]

### Pitfall 3: Making Edits Clear The Period

**What goes wrong:** A normal PATCH for calories/name/image drops existing `mealPeriod` because update code rewrites revision facts without carrying header fields. [VERIFIED: server/services/meal-transactions.ts]  
**Why it happens:** Update inputs currently include items/image/revision checks only. [VERIFIED: server/services/meal-transactions.ts]  
**How to avoid:** Store period on `meal_transactions` or explicitly copy it forward if revision-level storage is chosen. [VERIFIED: server/services/meal-transactions.ts] [VERIFIED: 65-CONTEXT.md]  
**Warning signs:** Direct edit preservation tests pass for macros but fail period projection after PATCH. [VERIFIED: 65-CONTEXT.md]

### Pitfall 4: Public DTO Inference Masquerading As Authority

**What goes wrong:** API returns inferred `mealPeriod` for legacy rows, so clients cannot distinguish explicit user intent from fallback. [VERIFIED: 65-CONTEXT.md]  
**Why it happens:** Existing UI only has hour-derived labels, so it is tempting to fill public `mealPeriod` everywhere for convenience. [VERIFIED: client/src/components/HomeScreen.tsx]  
**How to avoid:** Public `mealPeriod` is present only when stored explicit authority exists; helpers perform local fallback from `loggedAt` for display. [VERIFIED: 65-CONTEXT.md]  
**Warning signs:** Legacy seeded row at 08:00 returns `mealPeriod: "breakfast"` from API. [VERIFIED: 65-CONTEXT.md]

### Pitfall 5: Snapshot Tests Becoming Large Prompt Rewrites

**What goes wrong:** `system-prompt.test.ts` expected full prompt strings become noisy and brittle when one contract sentence changes. [VERIFIED: tests/unit/system-prompt.test.ts]  
**Why it happens:** Existing tests include long expected prompt snapshots. [VERIFIED: tests/unit/system-prompt.test.ts]  
**How to avoid:** Update exact snapshots only as needed, and add narrow assertions that `protein_sources` is conditional rather than always required. [VERIFIED: tests/unit/system-prompt.test.ts] [VERIFIED: 65-CONTEXT.md]

## Code Examples

Verified patterns from official/local sources:

### Zod Optional Contract

```typescript
// Source: server/orchestrator/tools.ts and Zod docs
const historicalMealPeriodSchema = z.enum(["breakfast", "lunch", "dinner", "late_night"]).optional();
const proteinSources = z.array(proteinSourceSchema).min(1).optional();
```

Zod documents `z.enum(...)` and `.optional()` for allowing `undefined` inputs. [CITED: https://zod.dev/api?id=sets]

### Existing Node Test Pattern

```typescript
// Source: tests/unit/tools.test.ts
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../../server/db/client.js";
```

Node docs state the test runner is invoked with `--test`, and project tests use this pattern with `tsx`. [CITED: https://nodejs.org/api/test.html] [VERIFIED: package.json]

### Drizzle Migration Shape

```sql
-- Source: drizzle/0005_chat_message_status.sql pattern
ALTER TABLE meal_transactions
  ADD COLUMN meal_period TEXT
  CHECK (meal_period IN ('breakfast','lunch','dinner','late_night'));
```

Planner should let `drizzle-kit` generate the actual migration or adjust generated SQL to match existing migration style if Drizzle emits a different nullable/check representation. [VERIFIED: package.json] [VERIFIED: drizzle.config.ts] [VERIFIED: drizzle/0005_chat_message_status.sql]

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| JSON schema requires `protein_sources`; Zod executor accepts omission | Align JSON schema/prompt to optional model evidence and backend normalization | Phase 65 planned | Model calls and local validation stop disagreeing, while trusted-protein facts remain backend-owned. [VERIFIED: server/orchestrator/tools.ts] [VERIFIED: 65-CONTEXT.md] |
| Meal period display inferred only from `loggedAt` hour | Persist explicit `mealPeriod` when direct source text says the meal category; infer only for display/candidate fallback | Phase 65 planned | `午餐我吃了雞腿便當` logged in the morning can display and correct as lunch without changing timestamp semantics. [VERIFIED: .planning/REQUIREMENTS.md] [VERIFIED: 65-CONTEXT.md] |
| Correction candidates expose only inferred `mealPeriod` | Candidates expose effective period plus `mealPeriodSource` | Phase 65 planned | Phase 67 can rank explicit period facts without treating clock fallback as higher authority. [VERIFIED: server/services/meal-correction.ts] [VERIFIED: 65-CONTEXT.md] |

**Deprecated/outdated:**
- Prompt text saying `protein_sources` is always required is outdated for Phase 65 and conflicts with locked D-03. [VERIFIED: server/orchestrator/system-prompt.ts] [VERIFIED: 65-CONTEXT.md]
- Persisting period from `早上/中午/晚上` as meal authority is disallowed by D-12. [VERIFIED: 65-CONTEXT.md]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | No new package installation is needed. [ASSUMED] | Standard Stack / Package Audit | If planner decides to add a JSON-schema generator or migration helper, it must run the package legitimacy gate and human-verify package provenance before install. |

## Open Questions (RESOLVED)

1. **RESOLVED: Should `點心/下午茶` ever map to `late_night` explicit authority?**
   - What we know: Current query/time extractors map snack words to `late_night`, but locked D-11 examples only name breakfast/lunch/dinner/late-night equivalents and D-12 forbids time phrases as authority. [VERIFIED: server/orchestrator/tools.ts] [VERIFIED: server/services/meal-correction.ts] [VERIFIED: 65-CONTEXT.md]
   - Resolution: `點心/下午茶` must not map to explicit `late_night` in Phase 65. Only direct meal-category words listed in CONTEXT.md create persisted authority; snack/afternoon-tea taxonomy stays out of scope for this phase. [RESOLVED] [VERIFIED: 65-CONTEXT.md]
   - Plan implication: Do not persist `點心/下午茶` as explicit authority in Phase 65; leave existing correction query hints alone unless they conflict with the new explicit/source model. [RESOLVED] [VERIFIED: 65-CONTEXT.md]

2. **RESOLVED: Should explicit period correction be implemented now?**
   - What we know: D-20 says changing/clearing period requires explicit grounded period correction, but success criteria focus on logging, projection, edit preservation, and candidate handoff. [VERIFIED: 65-CONTEXT.md] [VERIFIED: .planning/ROADMAP.md]
   - Resolution: Explicit period correction is not implemented broadly in Phase 65. Ordinary edits preserve existing `mealPeriod`, and any period-changing behavior remains deferred/narrow unless explicitly grounded. [RESOLVED] [VERIFIED: 65-CONTEXT.md]
   - Plan implication: Preserve on ordinary edits and defer broad period-changing correction UX; do not expand ranking, clarification, or correction-target policy in this phase. [RESOLVED] [VERIFIED: 65-CONTEXT.md]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | TypeScript tests/scripts | yes | v24.14.0 | None needed. [VERIFIED: command probe] |
| Yarn | Project scripts | yes | 1.22.22 | None; AGENTS forbids npm for repo work. [VERIFIED: command probe] [VERIFIED: AGENTS.md] |
| SQLite CLI | Optional manual DB inspection | yes | `/usr/bin/sqlite3` found | Use better-sqlite3 in tests if CLI not needed. [VERIFIED: command probe] |
| gsd-sdk | GSD workflow docs/commit | yes | path found | Manual git commit only if GSD commit helper fails. [VERIFIED: command probe] |
| ctx7 | Documentation lookup | no | — | Used official web docs fallback. [VERIFIED: command probe] [CITED: https://zod.dev/basics] |
| slopcheck | Package legitimacy | no | — | No new packages proposed; gate any future package behind human verification. [VERIFIED: command probe] |

**Missing dependencies with no fallback:** none for the recommended no-new-package Phase 65 plan. [VERIFIED: command probe]  
**Missing dependencies with fallback:** ctx7 unavailable; official docs were used. slopcheck unavailable; no package install is proposed. [VERIFIED: command probe]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Node built-in `node:test` on Node v24.14.0. [VERIFIED: command probe] [CITED: https://nodejs.org/api/test.html] |
| Config file | No separate test config; package scripts call `node scripts/run-node-with-tz.mjs --import tsx --test ...`. [VERIFIED: package.json] |
| Quick run command | `yarn test:unit` for unit scope; targeted single-file commands can use `node scripts/run-node-with-tz.mjs --import tsx --test <file>`. [VERIFIED: package.json] [VERIFIED: nutrition-verify-change] |
| Full suite command | `yarn test`; release gate `yarn release:check`. [VERIFIED: package.json] [VERIFIED: AGENTS.md] |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| TOOL-01 | JSON schema no longer requires `protein_sources`; Zod still accepts omission. | unit | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/tools.test.ts` | yes [VERIFIED: tests/unit/tools.test.ts] |
| TOOL-02 | Counted anchors/excluded trace/conservative behavior remain green; unsupported weak source defaults to normalize/strip unless structural contradiction. | unit | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/tools.test.ts tests/unit/protein-trust.test.ts` | yes [VERIFIED: tests/unit/tools.test.ts] [VERIFIED: tests/unit/protein-trust.test.ts] |
| TOOL-03 | Text/image log receipts still include committed `loggedMeal` and `summaryOutcome`; reply copy does not expose raw tool fields. | integration | `yarn test:integration` or targeted `tests/integration/chat-api.test.ts tests/integration/chat-streaming.test.ts` | yes [VERIFIED: tests/integration/chat-api.test.ts] [VERIFIED: tests/integration/chat-streaming.test.ts] |
| INTENT-01 | `午餐我吃了雞腿便當` with breakfast-hour `loggedAt` persists `mealPeriod="lunch"` while preserving `loggedAt`. | unit + integration | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/tools.test.ts tests/integration/chat-api.test.ts` | yes [VERIFIED: tests/unit/tools.test.ts] [VERIFIED: tests/integration/chat-api.test.ts] |
| INTENT-02 | `/api/meals`, day snapshot, history rows, receipts, update responses, and edit payloads expose explicit `mealPeriod` when present and omit it for legacy rows. | unit + integration | `yarn test:unit && yarn test:integration` or targeted route/client tests | partial; likely add/extend tests [VERIFIED: tests/unit/home-dashboard-contract.test.ts] [VERIFIED: tests/integration/meals-api.test.ts] |
| INTENT-03 | Correction candidates use persisted explicit period and expose source; legacy rows infer from `loggedAt`. | unit | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-correction.test.ts` | yes [VERIFIED: tests/unit/meal-correction.test.ts] |

### Sampling Rate

- **Per task commit:** Run the narrowest targeted unit/integration command for edited paths plus `yarn tsc --noEmit` after TypeScript edits. [VERIFIED: AGENTS.md] [VERIFIED: nutrition-verify-change]
- **Per wave merge:** Run `yarn test:unit` for unit-only waves; run `yarn test:integration` when routes/services/orchestrator integration changed. [VERIFIED: package.json] [VERIFIED: AGENTS.md]
- **Phase gate:** Run `yarn tsc --noEmit` and `yarn release:check` before closing Phase 65; release gate does not authorize staging/main promotion. [VERIFIED: AGENTS.md] [VERIFIED: .planning/PROJECT.md]

### Wave 0 Gaps

- [ ] Add migration/schema tests or extend `tests/unit/meal-transactions.test.ts` / `tests/unit/food-logging.test.ts` for nullable `mealPeriod` write + edit preservation. [VERIFIED: tests/unit/meal-transactions.test.ts] [VERIFIED: tests/unit/food-logging.test.ts]
- [ ] Add a narrow client helper test for `getDisplayMealLabel(mealPeriod, loggedAt)` and `getMealBadge(mealPeriod, loggedAt)` preference/fallback. [VERIFIED: tests/unit/home-dashboard-contract.test.ts] [VERIFIED: client/src/components/HomeScreen.tsx]
- [ ] Add or extend edit payload tests so `MealEditPayload` carries `mealPeriod` from row/receipt and PATCH omission preserves persisted period. [VERIFIED: client/src/meal-edit-payload.ts] [VERIFIED: tests/unit/chat-bubble-contract.test.ts]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | yes | Existing cookie-backed guest session resolver for protected routes; Phase 65 should not add new auth bypass paths. [VERIFIED: AGENTS.md] [VERIFIED: server/lib/guest-session-resolver.ts] |
| V3 Session Management | yes | Keep `/api/sse` and browser routes cookie-backed because EventSource cannot set custom headers. [VERIFIED: AGENTS.md] |
| V4 Access Control | yes | Continue scoping meal reads/writes by resolved `deviceId`; do not accept raw `deviceId` query/header ownership for protected browser routes. [VERIFIED: AGENTS.md] [VERIFIED: server/routes/meals.ts] |
| V5 Input Validation | yes | Use Zod for tool args and route-side payload guards for direct PATCH. [VERIFIED: server/orchestrator/tools.ts] [VERIFIED: server/routes/meals.ts] |
| V6 Cryptography | no new crypto | Existing guest-session signing remains outside this phase. [VERIFIED: 65-CONTEXT.md] |
| V8 Data Protection / Privacy | yes | `mealPeriod` and candidate source are structured facts; proof artifacts remain metadata-only and exclude raw text/tool payloads. [VERIFIED: 65-CONTEXT.md] [VERIFIED: .planning/PROJECT.md] |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Model-authored authority injection | Tampering | Treat tool args as evidence only; derive persisted authority from backend source-text rules and committed DB facts. [VERIFIED: 65-CONTEXT.md] |
| Cross-device meal mutation/read | Elevation of privilege | Resolve guest session to device ownership in routes; keep service queries scoped by device id. [VERIFIED: server/routes/meals.ts] [VERIFIED: server/services/meal-correction.ts] |
| Raw sensitive payload leakage in proof | Information disclosure | Keep tests/assertions metadata-only; do not save raw prompts, source text, final assistant text, tool payloads, image data, session material, or DB snapshots. [VERIFIED: 65-CONTEXT.md] [VERIFIED: .planning/PROJECT.md] |
| SQL injection through history/search or corrections | Tampering | Existing Drizzle query builder and parameterized better-sqlite3 statements should remain the data access path. [VERIFIED: server/services/history-query.ts] [VERIFIED: server/services/meal-transactions.ts] |

## Sources

### Primary (HIGH confidence)

- `65-CONTEXT.md` - locked decisions for `protein_sources`, meal-period authority, DTO projection, correction handoff, proof guardrails. [VERIFIED: .planning/phases/65-tool-contract-alignment-and-meal-period-authority/65-CONTEXT.md]
- `.planning/REQUIREMENTS.md` - TOOL-01/02/03 and INTENT-01/02/03 requirement wording. [VERIFIED: .planning/REQUIREMENTS.md]
- `.planning/ROADMAP.md` - Phase 65 goal, success criteria, dependencies, and phase boundary. [VERIFIED: .planning/ROADMAP.md]
- `.planning/PROJECT.md` and `.planning/STATE.md` - milestone authority/privacy/history context and v2.3 carry-forward decisions. [VERIFIED: .planning/PROJECT.md] [VERIFIED: .planning/STATE.md]
- `AGENTS.md`, `docs/codex.md`, `nutrition-gen-test`, `nutrition-verify-change` - repo workflow, testing, and verification rules. [VERIFIED: AGENTS.md] [VERIFIED: docs/codex.md] [VERIFIED: .codex/skills/nutrition-gen-test/SKILL.md] [VERIFIED: .codex/skills/nutrition-verify-change/SKILL.md]
- Code paths: `server/orchestrator/tools.ts`, `system-prompt.ts`, `meal-transactions.ts`, `food-logging.ts`, `meal-history.ts`, `history-query.ts`, `meal-correction.ts`, relevant routes, client types/api/helpers, and tests. [VERIFIED: codebase grep/read]
- Official Zod docs for `.parse`, errors, `z.enum`, and `.optional()`. [CITED: https://zod.dev/basics] [CITED: https://zod.dev/api?id=sets]
- Official Node test runner docs for `node:test` and `--test`. [CITED: https://nodejs.org/api/test.html]
- Official Drizzle SQLite docs for schema/migration workflow. [CITED: https://orm.drizzle.team/docs/get-started/sqlite-existing]

### Secondary (MEDIUM confidence)

- Installed package metadata from `node_modules` and `yarn.lock` for exact local versions. [VERIFIED: command probe] [VERIFIED: yarn.lock]

### Tertiary (LOW confidence)

- None used for recommendations. [VERIFIED: source review]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - existing repo dependencies and scripts are already installed and verified locally; no new package is recommended. [VERIFIED: package.json] [VERIFIED: command probe]
- Architecture: HIGH - all major boundaries were traced in local code and locked by context decisions. [VERIFIED: codebase grep/read] [VERIFIED: 65-CONTEXT.md]
- Pitfalls: HIGH - pitfalls map directly to existing conflicting code paths and locked decisions. [VERIFIED: server/orchestrator/tools.ts] [VERIFIED: server/services/meal-correction.ts] [VERIFIED: client/src/components/HomeScreen.tsx] [VERIFIED: 65-CONTEXT.md]
- Migration DDL: MEDIUM - recommended shape is clear, but exact generated SQL should be verified after `drizzle-kit generate`. [VERIFIED: drizzle.config.ts] [CITED: https://orm.drizzle.team/docs/get-started/sqlite-existing]

**Research date:** 2026-05-27  
**Valid until:** 2026-06-26 for local architecture; re-check package/docs versions if dependency changes are introduced.
