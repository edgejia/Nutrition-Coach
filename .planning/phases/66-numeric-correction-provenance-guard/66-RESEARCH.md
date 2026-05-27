# Phase 66: Numeric Correction Provenance Guard - Research

**Researched:** 2026-05-28  
**Domain:** Fastify/TypeScript orchestrator authority, SQLite-backed meal revisioning, backend-owned proposal state  
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

The following locked decisions, discretion areas, and deferred ideas are copied from `.planning/phases/66-numeric-correction-provenance-guard/66-CONTEXT.md`. [CITED: .planning/phases/66-numeric-correction-provenance-guard/66-CONTEXT.md]

### Locked Decisions

#### Numeric Evidence Boundary
- **D-01:** Direct `update_meal` numeric mutation authority comes only from explicit current-turn final target values or explicit approval of an active backend-owned numeric correction proposal.
- **D-02:** Ordinary prior assistant prose is not authoritative. If the previous assistant text contains a number, it can authorize mutation only when that value was also stored as a valid backend-owned proposal and the user approves that proposal.
- **D-03:** Explicit final target values may be written as Arabic integers, Arabic decimals, common Chinese numeral compounds, bare Chinese digits when they clearly express the target value, and unit variants such as `28g`, `28 克`, `500 卡`, or `500 kcal`. Units are normalized; the value must express the final target. Planner note: the current `source-text-guard` only emits Arabic integer digit runs and Chinese numeral compounds, so Phase 66 must explicitly cover decimals and bare Chinese-digit cases if they remain accepted.
- **D-04:** Relative or broad quantity phrases do not directly authorize numeric patches. The only Phase 66 proposal-trigger operators are the locked deterministic math cases from current persisted facts: half / reduce by percentage / add N units / subtract N units. Do not expand this operator set in Phase 66.
- **D-05:** Non-computable vague phrases such as `合理一點` or `蛋白質怪怪的` must ask for clarification unless a separately defined deterministic backend estimator exists.
- **D-06:** The guard applies to every numeric nutrition field written by `update_meal`, including top-level `calories` / `protein` / `carbs` / `fat` patch fields and numeric values inside `items[]` replacement payloads. `items[]` must not become a bypass.
- **D-07:** A current-turn explicit meal-level number authorizes a grouped meal total for that field. Phase 66 may keep the existing deterministic proportional distribution across current items. This is a provenance decision only, not a claim that the current protein distribution semantics are nutritionally ideal.

#### Vague Correction Response
- **D-08:** Vague non-computable numeric correction requests do not create numeric proposals by default. The backend should return one concise clarification that helps the user continue.
- **D-09:** Clarification copy should offer supported next inputs: an explicit target number, a computable adjustment such as `減半` / `少 20%`, or a simple direction such as `偏高` / `偏低`.
- **D-10:** Direction alone, such as `偏高`, is not enough to synthesize a number. It should prompt for a target number or computable adjustment next.
- **D-11:** Phase 66 computable signals are limited to deterministic math from current persisted facts. Structured item removal/addition (`少一顆蛋`), food-size heuristics (`雞腿比較小`, `飯少一點`), food database defaults, historical medians, and trusted-protein-aware redistribution are deferred.
- **D-12:** Unauthorized model-supplied numeric values must not be echoed as proposals or offered for approval. A blocked value from a tool call remains non-authoritative.
- **D-13:** Blocked unauthorized numeric `update_meal` calls must short-circuit to renderer-owned Traditional Chinese guidance as the terminal final reply. The model must not get a later chance to rewrite the failure into success-style text.
- **D-14:** Blocked or clarification-required numeric corrections must create no new meal revision, publish no `daily_summary`, and show no LLM-authored mutation success copy. Proof form belongs to plan-phase.
- **D-15:** Clarification copy should start by saying the record was not updated, be field-aware when the blocked field is known, use concise Traditional Chinese, and avoid policy-heavy wording about AI estimates, internal guards, persisted facts, tools, or APIs.

#### Backend Proposal and Approval Lifecycle
- **D-16:** Phase 66 should introduce deterministic backend-owned numeric correction proposals now, but keep the scope narrow.
- **D-17:** Proposal values must come from deterministic backend computation over current persisted meal facts. They must not originate from LLM tool-call arguments or assistant prose; user approval does not make LLM-originated values authoritative.
- **D-18:** A numeric correction proposal is one active single-use proposal per device, scoped to the resolved meal id and exact expected meal revision.
- **D-19:** The proposal should carry proposal id, meal id, expected revision, backend-computed numeric patch or `items[]` result, affected fields, source operator, created time, and expiry.
- **D-20:** Approval commits only if the active proposal still exists, the user explicitly approves it, and the expected meal revision is still current. Stale proposal approval should reuse the existing Phase 62 meal revision precondition path, not a new proposal-specific stale mechanism.
- **D-21:** Creating a new same-kind numeric correction proposal replaces the previous active meal correction proposal for that device. Successful approval, cancel text, expiry, or replacement clears the proposal.
- **D-22:** Reuse Phase 60-style short approval/cancel wording for numeric correction proposals. Exact vocabulary should follow or reuse the existing `isGoalProposalConsent` / `isGoalProposalCancel` helpers: short affirmatives such as `好`, `可以`, `用這組`, `就這樣`, `套用`, or `ok` may commit only when approval rules identify exactly one active backend-owned proposal.
- **D-23:** Cancel phrases such as `不要`, `取消`, `先不用`, `不用`, `不可以`, or `no` take precedence over approval matching.
- **D-24:** Proposal copy should show the target meal, every affected field, before/after numbers, and renderer-owned approval/adjust prompt in concise Traditional Chinese. Use `kcal` for calories and `g` for macros.
- **D-25:** Single-field proposals should show the specific before/after delta. Multi-field proposals should list all affected fields' before/after values so the user knows exactly what approval commits.
- **D-26:** Meal labels in proposal copy must be identifiable, using a single item name or concise combined label for grouped meals when item names are available. Avoid generic labels when item names exist.
- **D-27:** Do not show calculation formulas by default. A short natural operator label such as `減半` is acceptable; formula detail such as `40 x 0.5 = 20` should be omitted unless the user asks how it was calculated.
- **D-27a:** Proposal creation copy should disclose when another proposal kind is also active, so users know bare approval will require kind-specific disambiguation.

#### Cross-Kind Proposal Ambiguity
- **D-28:** Bare approval can commit only when exactly one active approvable proposal exists for the device. If both a goal proposal and a meal correction proposal are active, bare approval such as `好`, `可以`, `ok`, or `就這樣` must fail closed and mutate neither.
- **D-29:** When multiple proposal kinds are active, backend-rendered copy should ask the user to specify whether they mean the meal correction or the goal update.
- **D-30:** Kind-specific approval phrases may select the proposal kind, such as `套用餐點修改` / `套用餐點修正` for meal correction or `套用目標更新` / `套用每日目標` for goal updates. This selects only the active backend-owned proposal of that kind and must not reconstruct or alter proposal values from prose.
- **D-31:** Creating a meal correction proposal should not clear an active goal proposal, and creating a goal proposal should not clear an active meal correction proposal. Same-kind replacement still applies.
- **D-32:** Broad cancel wording such as `不要`, `取消`, `先不用`, `不用`, or `no` clears all active approvable proposal kinds for the device and returns renderer-owned no-update copy. Kind-specific cancel can clear one kind, such as `取消餐點修改` or `取消目標更新`.

### the agent's Discretion
- Exact internal naming for the meal numeric proposal state is for planning, but it should follow the existing `turn_states` active-state pattern unless the planner finds a concrete reason not to.
- Exact TTL is for planning calibration. It should be short-lived and compatible with Phase 60's latest-proposal precedent.
- Exact renderer copy can be tuned during implementation, but it must preserve the decisions above: record-not-updated first for blocked paths, concrete values first for proposal paths, concise Traditional Chinese, and no internal policy/tool jargon.

### Deferred Ideas (OUT OF SCOPE)
- Grouped-meal protein distribution currently uses existing proportional distribution, but this can conflict with trusted-protein semantics because persisted items do not carry counted-source / trace-source authority. Track trusted-protein-aware correction distribution as a separate follow-up outside Phase 66.
- Structured item removal/addition corrections such as `少一顆蛋` require stronger item/portion semantics before they can become proposal authority.
- Food-size heuristics such as `雞腿比較小` or `飯少一點`, food database defaults, historical medians, and any deterministic nutrition estimator need separate design before they can create backend-owned correction proposals.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CORR-01 | User can change meal numeric fields through chat only when the current turn provides explicit numeric evidence or an approved backend-owned estimate/proposal. [CITED: .planning/REQUIREMENTS.md] | Enforce provenance before `mealCorrectionService.updateMeal()` for both patch and `items[]` inputs; direct evidence must be current-turn only, while proposal approval must load a stored backend proposal. [VERIFIED: server/orchestrator/tools.ts:1238, server/orchestrator/tools.ts:1288, server/orchestrator/source-text-guard.ts:293] |
| CORR-02 | User requests such as `蛋白質怪怪的，幫我改合理一點` do not mutate meal calories or macros directly; the backend returns deterministic clarification or proposal copy instead. [CITED: .planning/REQUIREMENTS.md] | Use renderer-owned controlled replies for blocked vague numeric update attempts and a separate deterministic proposal path only for locked computable operators. [VERIFIED: server/orchestrator/index.ts:945, server/orchestrator/tools.ts:1835] |
| CORR-03 | A rejected or clarification-required correction does not create a new meal revision, does not publish `daily_summary`, and does not show LLM-authored success-style text. [CITED: .planning/REQUIREMENTS.md] | Controlled replies currently return `didMutateMeal: false`, and route publishing is gated by `didMutateMeal` plus a same-date summary. [VERIFIED: server/orchestrator/index.ts:956, server/routes/chat.ts:407] |
</phase_requirements>

## Summary

Phase 66 should be planned as a backend authority change at the orchestrator/tool boundary, not as prompt tuning. [VERIFIED: server/orchestrator/tools.ts:1238] The existing `update_meal` contract already requires a resolver-owned meal target and expected revision, but it currently accepts model-supplied numeric patches and `items[]` replacement payloads without a meal-specific provenance check. [VERIFIED: server/orchestrator/tools.ts:1281, server/orchestrator/tools.ts:1291]

The safest plan is to add a meal numeric authority layer before any meal update write: direct current-turn final target extraction for explicit values, a narrow deterministic proposal creation service for computable relative adjustments, and a proposal decision router that handles approval/cancel/cross-kind ambiguity before the model can rewrite outcomes. [VERIFIED: server/orchestrator/source-text-guard.ts:255, server/services/turn-state.ts:15, server/orchestrator/index.ts:641] This keeps Phase 62 stale revision checks and Phase 61 summary outcome behavior intact because successful commits still call the existing meal correction transaction path. [VERIFIED: server/services/meal-transactions.ts:230, server/services/meal-correction.ts:710]

**Primary recommendation:** implement a `meal_numeric_correction_proposal` turn-state service plus a meal-specific numeric provenance guard in `update_meal`; direct explicit values may commit, vague values become renderer-owned clarification, and computable relative adjustments become single-use backend proposals. [CITED: .planning/phases/66-numeric-correction-provenance-guard/66-CONTEXT.md]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Numeric correction provenance enforcement | API / Backend | Frontend Server / Orchestrator | `update_meal` writes originate in orchestrator tool execution and must be blocked before `mealCorrectionService.updateMeal()`. [VERIFIED: server/orchestrator/tools.ts:1288] |
| Explicit numeric evidence parsing | API / Backend | — | Existing source-text normalization is server-side and receives current user text from `executeTool()`. [VERIFIED: server/orchestrator/tools.ts:1636, server/orchestrator/source-text-guard.ts:293] |
| Backend-owned meal correction proposal state | Database / Storage | API / Backend | Existing active proposals use `turn_states` with `(device_id, kind)` uniqueness and TTL-based lookup. [VERIFIED: server/db/schema.ts:179, server/services/turn-state.ts:15] |
| Proposal approval/cancel ambiguity | API / Backend | Orchestrator | Goal cancel is already handled before model calls, and Phase 66 needs cross-kind fail-closed behavior before mutation tools run. [VERIFIED: server/orchestrator/index.ts:641] |
| Meal revision conflict protection | Database / Storage | API / Backend | Revision preconditions are enforced inside `meal-transactions` before update revisions are inserted. [VERIFIED: server/services/meal-transactions.ts:230, server/services/meal-transactions.ts:507] |
| No-mutation reply and publish suppression | API / Backend | SSE route | Controlled replies terminate the orchestrator with `didMutateMeal: false`; chat route summary publish requires `didMutateMeal`. [VERIFIED: server/orchestrator/index.ts:945, server/routes/chat.ts:407] |

## Project Constraints (from AGENTS.md)

- Use `yarn` only; do not use `npm` for project workflows. [CITED: AGENTS.md]
- Keep TypeScript ESM imports with explicit `.js` specifiers. [CITED: AGENTS.md]
- Use Node built-in `node:test`, not Jest or Vitest, unless explicitly migrating. [CITED: AGENTS.md]
- Use real SQLite in tests; `:memory:` is acceptable, but DB mocking is not. [CITED: AGENTS.md]
- Wire new services through `server/app.ts`, keep HTTP/SSE transport behavior in `server/routes/*.ts`, keep domain/persistence logic in `server/services/*.ts`, and keep model workflow/tool execution in `server/orchestrator/*`. [CITED: AGENTS.md]
- Preserve `TZ=Asia/Taipei` day-boundary behavior. [CITED: AGENTS.md]
- For any `*.ts` edit, run `yarn tsc --noEmit`; for route/service edits, run `yarn test:integration`; for unit test edits, run `yarn test:unit`. [CITED: AGENTS.md]
- Before staging or main promotion, run `yarn release:check`; no staging/main promotion is authorized by this research. [CITED: AGENTS.md]

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js | 24.14.0 | Runtime and built-in `node:test` runner | Existing scripts run tests through Node with `tsx` and `scripts/run-node-with-tz.mjs`. [VERIFIED: node --version; package.json] |
| TypeScript | 5.9.3 installed | Static type gate | The repo verification matrix requires `yarn tsc --noEmit` for TypeScript edits. [VERIFIED: node_modules/typescript/package.json; AGENTS.md] |
| tsx | 4.21.0 installed | ESM TypeScript execution for tests/server scripts | Existing scripts use `--import tsx`. [VERIFIED: node_modules/tsx/package.json; package.json] |
| Zod | 4.3.6 installed | Runtime tool argument validation | Tool contracts use Zod schemas before execution. [VERIFIED: node_modules/zod/package.json; server/orchestrator/tool-contract.ts:130] |
| better-sqlite3 | 11.10.0 installed | SQLite runtime driver | Existing services use real SQLite and the project forbids DB mocks in tests. [VERIFIED: node_modules/better-sqlite3/package.json; AGENTS.md] |
| Drizzle ORM | 0.39.3 installed | Typed DB schema/query builders | Meal and turn-state schema use Drizzle table definitions. [VERIFIED: node_modules/drizzle-orm/package.json; server/db/schema.ts] |
| Fastify | 5.8.4 installed | HTTP/SSE route runtime | Chat and SSE behavior is routed through Fastify app composition. [VERIFIED: node_modules/fastify/package.json; server/app.ts] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| Existing `turn_states` service | local code | Active per-device proposal state with TTL | Use for the new meal correction proposal kind. [VERIFIED: server/services/turn-state.ts:15] |
| Existing `goal-proposals` service | local code | Proposal lifecycle precedent | Copy shape and TTL semantics where useful, but do not reuse `goal_proposal` kind. [VERIFIED: server/services/goal-proposals.ts:5] |
| Existing `source-text-guard` | local code | Numeric source candidate extraction and consent/cancel helpers | Extend or wrap for meal-specific rules; do not rely on previous assistant prose for meal direct mutations. [VERIFIED: server/orchestrator/source-text-guard.ts:46, server/orchestrator/source-text-guard.ts:255] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `turn_states` proposal storage | New table | A new table adds migration/release risk without solving a broader persistence need; `turn_states` already supports per-device/per-kind uniqueness and expiry. [VERIFIED: server/db/schema.ts:192] |
| Backend deterministic proposal tool | Prompt-only instruction | Prompt-only cannot enforce blocked `update_meal` calls because model tool args are accepted today before meal update writes. [VERIFIED: server/orchestrator/tools.ts:1288] |
| Meal-specific guard helper | Generic `sourceFields` only | Generic `sourceFields` can check top-level keys but cannot inspect nested `items[]` numeric replacement payloads. [VERIFIED: server/orchestrator/tool-contract.ts:153, server/orchestrator/tools.ts:1251] |

**Installation:**

```bash
# No new package installation is recommended for Phase 66.
```

**Version verification:** existing versions were read from `node_modules/*/package.json`, `node --version`, and `yarn --version`; no registry install is planned. [VERIFIED: local environment]

## Package Legitimacy Audit

No external packages are recommended or installed for Phase 66, so the Package Legitimacy Gate is not applicable. [VERIFIED: package.json; .planning/phases/66-numeric-correction-provenance-guard/66-CONTEXT.md]

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| none | — | — | — | — | not run | No package install planned |

**Packages removed due to slopcheck [SLOP] verdict:** none.  
**Packages flagged as suspicious [SUS]:** none.

## Architecture Patterns

### System Architecture Diagram

```text
User chat turn
  |
  v
server/routes/chat.ts
  |
  v
server/orchestrator/index.ts
  |
  +--> Active proposal decision router
  |      |
  |      +--> broad cancel? clear active meal + goal proposals -> renderer no-update copy
  |      +--> bare approval with multiple proposal kinds? -> renderer disambiguation copy
  |      +--> kind-specific meal approval? -> load stored meal proposal -> existing meal update path
  |
  v
LLM tool loop
  |
  +--> find_meals resolves mealId + mealRevisionId
  |
  +--> update_meal
  |      |
  |      +--> meal numeric provenance guard
  |             |
  |             +--> explicit current-turn final target? -> allow update
  |             +--> stored approved proposal? -> allow update
  |             +--> vague/non-computable/model-only number? -> controlled renderer reply
  |
  +--> propose_meal_numeric_correction
         |
         +--> locked operator from current user text
         +--> compute patch/items from persisted current meal facts
         +--> store single-use turn_state proposal
         +--> renderer proposal copy
```

### Recommended Project Structure

```text
server/
├── orchestrator/
│   ├── source-text-guard.ts          # extend numeric normalization and approval/cancel helpers
│   ├── meal-numeric-authority.ts     # recommended new pure guard/operator helper
│   ├── mutation-receipts.ts          # add meal proposal/block/cancel/disambiguation copy
│   ├── tools.ts                      # add proposal tool and enforce update_meal guard
│   └── index.ts                      # handle cross-kind proposal decision routing
├── services/
│   ├── meal-correction.ts            # expose/read current meal facts as needed; keep writes existing
│   ├── meal-numeric-proposals.ts     # recommended new turn_state wrapper
│   └── turn-state.ts                 # existing backing store
tests/
├── unit/
│   ├── source-text-guard.test.ts
│   ├── tools.test.ts
│   ├── meal-correction.test.ts
│   └── orchestrator.test.ts
└── integration/
    ├── chat-meal-correction.integration.test.ts
    └── chat-streaming.test.ts
```

### Pattern 1: Enforce Provenance Before Meal Writes

**What:** validate/authorize all numeric `update_meal` payloads before `mealCorrectionService.updateMeal()` can insert a new revision. [VERIFIED: server/orchestrator/tools.ts:1288]  
**When to use:** every `update_meal` call with top-level `calories`/`protein`/`carbs`/`fat` or nested `items[]` numeric fields. [CITED: .planning/phases/66-numeric-correction-provenance-guard/66-CONTEXT.md]  
**Example:**

```typescript
// Source: recommended shape based on server/orchestrator/tools.ts:1288 and source-text-guard.ts:293
const authority = authorizeMealNumericUpdate({
  args,
  currentUserMessage: context.currentUserMessage,
  activeApprovedProposal,
});
if (!authority.ok) {
  return mealNumericAuthorityFailure(authority);
}
```

### Pattern 2: Store Only Backend-Computed Proposal Values

**What:** proposal payloads should contain a generated proposal id, meal id, expected revision, affected fields, operator, created time, expiry, and backend-computed patch/items. [CITED: .planning/phases/66-numeric-correction-provenance-guard/66-CONTEXT.md]  
**When to use:** locked computable cases: half, reduce by percentage, add N units, subtract N units. [CITED: .planning/phases/66-numeric-correction-provenance-guard/66-CONTEXT.md]  
**Example:**

```typescript
// Source: recommended shape based on server/services/goal-proposals.ts:18 and turn-state.ts:15
await turnStateService.putState(
  deviceId,
  "meal_numeric_correction_proposal",
  proposalPayload,
  MEAL_NUMERIC_PROPOSAL_TTL_MS,
);
```

### Pattern 3: Use Existing Revision Preconditions for Proposal Approval

**What:** approval should pass the stored `expectedMealRevisionId` into the existing update path instead of inventing a proposal-specific stale mechanism. [CITED: .planning/phases/66-numeric-correction-provenance-guard/66-CONTEXT.md]  
**When to use:** applying a stored meal correction proposal. [VERIFIED: server/services/meal-transactions.ts:230]  
**Example:**

```typescript
// Source: recommended shape based on server/services/meal-correction.ts:660
await mealCorrectionService.updateMeal(
  deviceId,
  proposal.mealId,
  proposal.updateInput,
  proposal.expectedMealRevisionId,
);
```

### Anti-Patterns to Avoid

- **Prompt-only prevention:** the current prompt explicitly allows model-estimated direct meal corrections, so prompt changes must support backend guards, not replace them. [VERIFIED: server/orchestrator/system-prompt.ts:189]
- **Trusting previous assistant numbers:** existing generic numeric guard can authorize prior assistant numbers after confirmation, but Phase 66 forbids that for direct meal mutation unless a backend proposal exists. [VERIFIED: server/orchestrator/source-text-guard.ts:321; CITED: .planning/phases/66-numeric-correction-provenance-guard/66-CONTEXT.md]
- **Guarding only top-level patch fields:** `items[]` replacement carries the same numeric fields and currently maps straight into service writes. [VERIFIED: server/orchestrator/tools.ts:1251, server/orchestrator/tools.ts:1291]
- **Creating revisions before checking authority:** `updateTransaction()` inserts a new meal revision after revision validation, so authority must be checked before this call. [VERIFIED: server/services/meal-transactions.ts:543]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Active proposal persistence | A new ad hoc table or in-memory map | `turn_states` through a dedicated meal proposal service | `turn_states` already has per-device/per-kind replacement and expiry. [VERIFIED: server/db/schema.ts:192, server/services/turn-state.ts:39] |
| Stale proposal conflict handling | New stale-proposal error codes | Existing `MealRevisionPreconditionError` from meal transaction updates | Phase 62 already made expected revision checks authoritative. [VERIFIED: server/services/meal-transactions.ts:230] |
| Final blocked reply text | LLM-authored failure prose | `controlledReply` renderer path | Controlled replies currently stop the tool loop and return renderer-owned final text. [VERIFIED: server/orchestrator/index.ts:945] |
| Summary publish suppression | Custom publisher flags | Existing `didMutateMeal` route publish gate | Route publish already returns early when no mutation happened. [VERIFIED: server/routes/chat.ts:407] |
| Nutrition estimation | Food DB defaults or heuristic estimator | Explicit target or locked deterministic math proposal only | Estimators and food-size heuristics are deferred out of Phase 66. [CITED: .planning/phases/66-numeric-correction-provenance-guard/66-CONTEXT.md] |

**Key insight:** Phase 66 is an authority/provenance boundary, not a nutrition-estimation phase. [CITED: .planning/phases/66-numeric-correction-provenance-guard/66-CONTEXT.md]

## Common Pitfalls

### Pitfall 1: `items[]` Replacement Bypass

**What goes wrong:** top-level patch fields are guarded, but a model-supplied full `items[]` replacement can still alter calories/macros. [VERIFIED: server/orchestrator/tools.ts:1251]  
**Why it happens:** `ToolContract.sourceFields` only checks named top-level fields and does not traverse nested item arrays. [VERIFIED: server/orchestrator/tool-contract.ts:153]  
**How to avoid:** implement meal-specific numeric extraction over both patch and `items[]`, and require every changed numeric field/value to be explicitly authorized or proposal-owned. [CITED: .planning/phases/66-numeric-correction-provenance-guard/66-CONTEXT.md]  
**Warning signs:** tests only cover `{ protein: 22 }` and not item replacement payloads with changed numbers. [VERIFIED: tests/integration/chat-meal-correction.integration.test.ts:459]

### Pitfall 2: Decimal and Bare Chinese Digit Gaps

**What goes wrong:** accepted Phase 66 evidence such as decimals may fail matching, or digit runs inside decimals may authorize the wrong integer. [VERIFIED: server/orchestrator/source-text-guard.ts:259]  
**Why it happens:** `normalizeNumericSourceText()` currently uses `/\d+/g`, returns stringified integers, and the Chinese parser rejects bare single Chinese digits. [VERIFIED: server/orchestrator/source-text-guard.ts:120, server/orchestrator/source-text-guard.ts:259]  
**How to avoid:** extend numeric normalization with exact decimal tokens, unit-stripped values, and the D-03 accepted Chinese forms; add tests before wiring the guard into `update_meal`. [CITED: .planning/phases/66-numeric-correction-provenance-guard/66-CONTEXT.md]  
**Warning signs:** `source-text-guard.test.ts` currently covers integers, comma/space formatting, units, and Chinese compounds, but no decimal or bare Chinese-digit final targets. [VERIFIED: tests/unit/source-text-guard.test.ts:8]

### Pitfall 3: Previous Assistant Prose Authority Leak

**What goes wrong:** a prior assistant recommendation like `建議 28g` becomes authoritative after the user says `好`, even though no backend proposal stored that value. [VERIFIED: server/orchestrator/source-text-guard.ts:321]  
**Why it happens:** the generic goal-era guard allows immediately previous assistant numbers with confirmation. [VERIFIED: tests/unit/source-text-guard.test.ts:75]  
**How to avoid:** direct meal numeric mutation should use current-turn evidence only; assistant-number approval must go through stored backend proposal state. [CITED: .planning/phases/66-numeric-correction-provenance-guard/66-CONTEXT.md]  
**Warning signs:** a direct `update_meal` test passes when the user only says `好` and the number appears solely in prior assistant text. [CITED: .planning/phases/66-numeric-correction-provenance-guard/66-CONTEXT.md]

### Pitfall 4: Cross-Kind Bare Approval Ambiguity

**What goes wrong:** both goal and meal proposals are active, and bare `好` commits one of them through model-selected tooling. [CITED: .planning/phases/66-numeric-correction-provenance-guard/66-CONTEXT.md]  
**Why it happens:** existing goal cancel checks only goal proposal state before the model, and goal approval is still tool-loop mediated. [VERIFIED: server/orchestrator/index.ts:641, server/orchestrator/tools.ts:1478]  
**How to avoid:** before model calls, inspect active goal and meal proposal kinds for broad cancel and bare approval ambiguity; return renderer-owned disambiguation when more than one proposal kind is active. [CITED: .planning/phases/66-numeric-correction-provenance-guard/66-CONTEXT.md]  
**Warning signs:** tests seed both proposal kinds and bare `好` still reaches the LLM tool loop. [CITED: .planning/phases/66-numeric-correction-provenance-guard/66-CONTEXT.md]

### Pitfall 5: Mutation Side Effects on Rejection

**What goes wrong:** a blocked correction still creates a meal revision, publishes `daily_summary`, or returns success-style text. [CITED: .planning/REQUIREMENTS.md]  
**Why it happens:** authority failure is detected after service update, or returned as a normal model-visible tool failure that lets another model round write the final reply. [VERIFIED: server/orchestrator/tools.ts:1693]  
**How to avoid:** blocked numeric corrections should return `controlledReply` from the tool adapter or pre-model router, with `didMutateMeal: false` and no `dailySummary`. [VERIFIED: server/orchestrator/index.ts:945]  
**Warning signs:** `mealRevisions` count increments, `publishDailySummary` spy is called, or reply matches `已更新`. [VERIFIED: tests/integration/chat-meal-correction.integration.test.ts:841]

## Code Examples

### Active State Wrapper

```typescript
// Source: server/services/goal-proposals.ts:18
async putLatest(deviceId: string, targets: DailyTargets): Promise<GoalProposalPayload> {
  const proposal: GoalProposalPayload = {
    proposalId: crypto.randomUUID(),
    targets: { ...targets },
    createdAt: new Date().toISOString(),
  };

  await turnStateService.putState(
    deviceId,
    GOAL_PROPOSAL_KIND,
    proposal,
    GOAL_PROPOSAL_TTL_MS,
  );

  return proposal;
}
```

### Controlled Reply Short-Circuit

```typescript
// Source: server/orchestrator/index.ts:945
if (controlledReply) {
  opts?.hooks?.onLLMEnd?.(round + 1, true);
  return {
    reply: controlledReply.text,
    didLogMeal: false,
    didMutateMeal: false,
    finalReplySource: controlledReply.source,
    finalReplyShape: classifyPlainReplyShape(controlledReply.text),
  };
}
```

### Existing Revision Precondition

```typescript
// Source: server/services/meal-transactions.ts:233
if (!expected) {
  throw new MealRevisionPreconditionError({
    code: "MEAL_REVISION_REQUIRED",
    mealId: existing.id,
    affectedDate,
    currentMealRevisionId: existing.currentRevisionId,
  });
}

if (expected !== existing.currentRevisionId) {
  throw new MealRevisionPreconditionError({
    code: "MEAL_REVISION_STALE",
    mealId: existing.id,
    affectedDate,
    currentMealRevisionId: existing.currentRevisionId,
  });
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Goal confirmations could rely on assistant/model prose | Goal updates require explicit current-turn values or a backend-owned active proposal | Phase 60 / v2.3 [VERIFIED: .planning/STATE.md] | Reuse proposal authority pattern for meal numeric corrections. [VERIFIED: server/services/goal-proposals.ts:5] |
| Meal mutation receipts depended on post-commit summary success | Meal mutations return committed facts with `summaryOutcome` freshness status | Phase 61 / v2.3 [VERIFIED: .planning/STATE.md] | Blocked Phase 66 paths must not fabricate `summaryOutcome`; committed paths keep existing behavior. [VERIFIED: server/orchestrator/tools.ts:1765] |
| Meal edits could race stale receipts | Meal writes require expected meal revision identity | Phase 62 / v2.3 [VERIFIED: .planning/STATE.md] | Proposal approval should pass the stored expected revision into the same write path. [VERIFIED: server/services/meal-transactions.ts:507] |
| Meal-period candidate facts could be inferred only from time | Phase 65 adds explicit/inferred meal-period provenance on candidates | Phase 65 / v2.4 [VERIFIED: server/services/meal-correction.ts:397] | Proposal labels and target context can use candidate names and period facts without changing ranking policy. [VERIFIED: server/services/meal-correction.ts:385] |
| Prompt permits model-estimated reasonable meal correction values | Phase 66 must forbid direct model-estimated commits unless proposal-owned | Pending Phase 66 [CITED: .planning/phases/66-numeric-correction-provenance-guard/66-CONTEXT.md] | Update prompt support text, but enforce at backend. [VERIFIED: server/orchestrator/system-prompt.ts:189] |

**Deprecated/outdated:**
- Meal correction prompt rule 7 is now unsafe for Phase 66 because it instructs the model to decide and directly apply a reasonable number after user authorization. [VERIFIED: server/orchestrator/system-prompt.ts:189]
- The generic previous-assistant numeric authorization behavior is unsafe for meal direct mutations unless tied to stored backend proposals. [VERIFIED: server/orchestrator/source-text-guard.ts:321; CITED: .planning/phases/66-numeric-correction-provenance-guard/66-CONTEXT.md]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | A pre-model proposal decision router is the cleanest way to enforce broad cancel and cross-kind bare approval ambiguity. [ASSUMED] | Architecture Patterns | Planner could instead put all proposal decisions into tool contracts, but must still prevent both-active bare approval before any commit. |
| A2 | A new dedicated `meal-numeric-authority.ts` helper is preferable to expanding `source-text-guard.ts` with all meal-specific policy. [ASSUMED] | Recommended Project Structure | Planner may choose a different file split; risk is only organization if tests cover the same behavior. |

## Open Questions

1. **Exact meal numeric proposal TTL**
   - What we know: goal proposals use 30 minutes. [VERIFIED: server/services/goal-proposals.ts:6]
   - What's unclear: Phase 66 context leaves exact TTL to planning calibration. [CITED: .planning/phases/66-numeric-correction-provenance-guard/66-CONTEXT.md]
   - Recommendation: use 30 minutes unless planner finds UX evidence for shorter, because it matches the existing active proposal precedent. [ASSUMED]

2. **How much of goal approval should move into the pre-model proposal router**
   - What we know: goal cancel is pre-model, while goal approval is currently tool-loop mediated. [VERIFIED: server/orchestrator/index.ts:641, server/orchestrator/tools.ts:1478]
   - What's unclear: Phase 66 only requires cross-kind fail-closed behavior, not a full goal proposal refactor. [CITED: .planning/phases/66-numeric-correction-provenance-guard/66-CONTEXT.md]
   - Recommendation: implement the minimum router needed for cross-kind ambiguity, broad cancel, kind-specific meal approval, and kind-specific meal cancel; leave goal-only approval on existing path unless the planner can keep the change smaller by centralizing all proposal decisions. [ASSUMED]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | test/runtime scripts | yes | 24.14.0 | none needed [VERIFIED: node --version] |
| Yarn | project scripts | yes | 1.22.22 | none; repo forbids npm workflows [VERIFIED: yarn --version; AGENTS.md] |
| SQLite CLI | optional DB inspection | yes | 3.51.0 | better-sqlite3 test runtime if CLI unused [VERIFIED: sqlite3 --version] |
| ctx7 | external docs lookup fallback | no | — | local codebase research; no new external library docs needed [VERIFIED: command -v ctx7] |

**Missing dependencies with no fallback:** none. [VERIFIED: local environment]  
**Missing dependencies with fallback:** `ctx7` is missing, but Phase 66 uses existing local stack and no new library docs are required. [VERIFIED: local environment]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Node built-in `node:test` under Node 24.14.0 [VERIFIED: package.json; node --version] |
| Config file | none dedicated; scripts use `scripts/run-node-with-tz.mjs --import tsx --test ...` [VERIFIED: package.json] |
| Quick run command | `yarn test:unit` [CITED: AGENTS.md] |
| Full suite command | `yarn test` or `yarn release:check` for closure/promotion gate [CITED: AGENTS.md] |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| CORR-01 | Direct explicit numeric `update_meal` commits only when current-turn target values authorize every changed numeric field, including `items[]`. [CITED: .planning/REQUIREMENTS.md] | unit + integration | `yarn test:unit && yarn test:integration` | yes; extend existing files [VERIFIED: tests/unit/source-text-guard.test.ts, tests/unit/tools.test.ts, tests/integration/chat-meal-correction.integration.test.ts] |
| CORR-01 | Approved backend-owned meal numeric proposal commits through existing expected revision path. [CITED: .planning/REQUIREMENTS.md] | unit + integration | `yarn test:unit && yarn test:integration` | partial; add new tests [VERIFIED: tests/unit/orchestrator.test.ts, tests/unit/meal-correction.test.ts] |
| CORR-02 | Vague `合理一點` / `怪怪的` requests do not mutate and return backend-rendered clarification. [CITED: .planning/REQUIREMENTS.md] | integration | `yarn test:integration` | yes; add case to chat correction integration [VERIFIED: tests/integration/chat-meal-correction.integration.test.ts] |
| CORR-03 | Blocked/clarification-required corrections create no new revision, publish no `daily_summary`, and show no success-style text. [CITED: .planning/REQUIREMENTS.md] | integration | `yarn test:integration` | yes; extend stale/no-mutation patterns [VERIFIED: tests/integration/chat-meal-correction.integration.test.ts:759] |

### Sampling Rate

- **Per task commit:** run targeted `node scripts/run-node-with-tz.mjs --import tsx --test <specific test file>` for changed tests plus `yarn tsc --noEmit` after TypeScript edits. [CITED: AGENTS.md]
- **Per wave merge:** `yarn test:unit` and `yarn test:integration` for orchestrator/service/route changes. [CITED: AGENTS.md]
- **Phase gate:** `yarn tsc --noEmit` plus `yarn release:check`; no staging/main promotion. [CITED: AGENTS.md; .planning/REQUIREMENTS.md]

### Wave 0 Gaps

- [ ] `tests/unit/meal-numeric-authority.test.ts` or equivalent helper coverage for explicit value extraction, decimals, bare Chinese digits, relative operator classification, and `items[]` numeric diff authorization. [ASSUMED]
- [ ] `tests/unit/meal-numeric-proposals.test.ts` or service-level coverage for put/get/clear/expiry/same-kind replacement payloads if proposal service is separated. [ASSUMED]
- [ ] `tests/unit/orchestrator.test.ts` additions for renderer-owned proposal, blocked correction, cross-kind ambiguity, and broad cancel before second model round. [VERIFIED: tests/unit/orchestrator.test.ts]
- [ ] `tests/integration/chat-meal-correction.integration.test.ts` additions for no revision/no publish/no success reply on vague correction and stale proposal approval. [VERIFIED: tests/integration/chat-meal-correction.integration.test.ts]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | yes | Preserve cookie-backed guest session route ownership; do not reintroduce raw `deviceId` trust. [CITED: AGENTS.md] |
| V3 Session Management | yes | Existing browser `EventSource` uses cookie-backed sessions for SSE. [CITED: AGENTS.md] |
| V4 Access Control | yes | Meal updates remain scoped by `deviceId` and meal id through existing services. [VERIFIED: server/services/meal-transactions.ts:492] |
| V5 Input Validation | yes | Zod schemas validate tool args before execution; add meal-specific provenance validation before mutation. [VERIFIED: server/orchestrator/tool-contract.ts:130] |
| V6 Cryptography | no new crypto | No new cryptographic primitive is needed for Phase 66. [VERIFIED: .planning/phases/66-numeric-correction-provenance-guard/66-CONTEXT.md] |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Model tool-call tampering of numeric meal facts | Tampering | Treat LLM tool args as untrusted and require source/proposal authority before write. [VERIFIED: server/orchestrator/tool-contract.ts:130; CITED: .planning/phases/66-numeric-correction-provenance-guard/66-CONTEXT.md] |
| Cross-kind proposal confusion causing unintended commit | Elevation of privilege / Tampering | Fail closed when multiple active proposal kinds exist and approval is bare. [CITED: .planning/phases/66-numeric-correction-provenance-guard/66-CONTEXT.md] |
| Sensitive trace leakage while proving behavior | Information disclosure | Keep proof metadata-only; do not persist raw prompts, user text, final replies, raw tool payloads, images, sessions, or DB snapshots. [CITED: .planning/PROJECT.md] |
| SQL injection through proposal state | Tampering | Use existing prepared statements / Drizzle services rather than string interpolation. [VERIFIED: server/services/turn-state.ts:26, server/services/meal-transactions.ts:501] |

## Sources

### Primary (HIGH confidence)

- `.planning/phases/66-numeric-correction-provenance-guard/66-CONTEXT.md` - locked decisions, discretion, deferred scope. [CITED]
- `.planning/REQUIREMENTS.md` - CORR-01 through CORR-03. [CITED]
- `.planning/STATE.md` and `.planning/PROJECT.md` - v2.3/v2.4 authority history and privacy constraints. [CITED]
- `.planning/ROADMAP.md` - Phase 66 goal, dependency, success criteria. [CITED]
- `AGENTS.md` - project workflow, commands, architecture, testing, and release constraints. [CITED]
- `server/orchestrator/tools.ts` - tool contracts, update_meal path, proposal precedent, tool adapter. [VERIFIED: codebase grep]
- `server/orchestrator/source-text-guard.ts` - numeric normalization and consent/cancel helpers. [VERIFIED: codebase grep]
- `server/orchestrator/index.ts` - controlled reply short-circuit and proposal cancel precedent. [VERIFIED: codebase grep]
- `server/services/meal-correction.ts` and `server/services/meal-transactions.ts` - correction writes and revision preconditions. [VERIFIED: codebase grep]
- `server/services/turn-state.ts`, `server/services/goal-proposals.ts`, and `server/db/schema.ts` - active proposal state precedent. [VERIFIED: codebase grep]
- Existing unit/integration tests under `tests/unit` and `tests/integration`. [VERIFIED: codebase grep]

### Secondary (MEDIUM confidence)

- None needed; no external ecosystem choice is required. [VERIFIED: local research scope]

### Tertiary (LOW confidence)

- Assumptions A1-A2 in the Assumptions Log are planning recommendations, not locked facts. [ASSUMED]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - versions and scripts are present locally, and no new package is recommended. [VERIFIED: package.json; node_modules]
- Architecture: HIGH - core integration points are directly in inspected source files and existing tests. [VERIFIED: codebase grep]
- Pitfalls: HIGH for direct bypasses and revision/publish behavior; MEDIUM for exact helper/file split because that remains a planning choice. [VERIFIED: codebase grep; ASSUMED]

**Research date:** 2026-05-28  
**Valid until:** 2026-06-27 for local code architecture, or until `update_meal` / proposal code changes materially.
