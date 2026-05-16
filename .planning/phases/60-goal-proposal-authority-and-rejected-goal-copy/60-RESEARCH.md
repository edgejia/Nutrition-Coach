# Phase 60: Goal Proposal Authority and Rejected-Goal Copy - Research

**Researched:** 2026-05-17 [VERIFIED: gsd-sdk init.phase-op 60]  
**Domain:** Conversational tool-use mutation authority, deterministic backend copy, SQLite turn-state lifecycle [VERIFIED: .planning/phases/60-goal-proposal-authority-and-rejected-goal-copy/60-CONTEXT.md]  
**Confidence:** HIGH [VERIFIED: codebase grep + official docs + yarn registry checks]

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

## Implementation Decisions

### Proposal Creation Authority
- **D-01:** Add a separate `propose_goals` backend tool/contract. It creates structured backend-owned pending goal proposals instead of parsing assistant prose.
- **D-02:** `propose_goals` must replace the current prompt-only ambiguous goal recommendation flow. Ambiguous goal-change intent naturally asks for concrete confirmable target values, and Phase 60 requires those values to become backend-owned pending proposal state.
- **D-03:** `propose_goals` returns deterministic backend-rendered Traditional Chinese proposal copy. The model must not author the user-visible proposal recommendation.
- **D-04:** Keep proposal and mutation responsibilities split: `propose_goals` persists pending proposals and renders proposal copy; `update_goals` remains the mutation path.

### Proposal Identity and Lifecycle
- **D-05:** Allow one active pending goal proposal per device. This matches the existing `turn_states` `(deviceId, kind)` uniqueness pattern and keeps short confirmations like `好` unambiguous.
- **D-06:** A newer `propose_goals` overwrites the previous pending goal proposal for that device.
- **D-07:** Pending goal proposals expire after 30 minutes.
- **D-08:** Any successful `update_goals` target persistence clears pending proposal state, whether the success came from the proposal path or from current-turn explicit numeric values. Clearing follows committed target persistence, not later `goals_update` publish or summary/recompute success; post-persist publish/recompute failure must not leave the proposal available to reapply.
- **D-09:** Validation failure, source guard failure, proposal mismatch, and execution failure must not mutate targets, must not publish `goals_update`, and should not consume the pending proposal for ordinary retryable failures.
- **D-10:** Expired proposals are cleared or treated as unavailable and must not mutate targets.
- **D-11:** Explicit rejection/cancel terms such as `不要`, `取消`, `先不用`, or `no` should clear the active pending proposal.

### Confirmation Matching Rules
- **D-12:** Short consent text may confirm the latest active proposal, but authorization belongs to a backend predicate, not LLM judgment. Candidate consent terms include `好`, `可以`, `幫我更新`, `就這樣`, and `用這組`.
- **D-13:** Reverse/cancel terms such as `不要`, `取消`, `先不用`, and `no` must be excluded from confirmation.
- **D-14:** Proposal-path `update_goals` must require both explicit consent in the current user message and an active non-expired pending proposal. If either condition is missing, fail closed with deterministic copy, no target mutation, and no `goals_update`.
- **D-15:** Do not use empty args to mean proposal confirmation. `update_goals` needs an explicit proposal mode.
- **D-16:** Prefer hidden `proposal_id` for the explicit proposal mode only if planning proves the next-turn LLM can reliably receive and use it without exposing it in user-facing copy.
- **D-17:** If hidden `proposal_id` handoff cannot be proven reliable, use an explicit single-active latest-proposal mode instead of forcing an internal id through a brittle path.
- **D-18:** Explicit current-turn numeric updates override any pending proposal and, on success, clear pending proposal state.
- **D-19:** Mixed confirmation plus edits, such as `好，但蛋白質 130`, should apply the pending proposal values plus explicit current-turn overrides, then clear the proposal after successful mutation.

### Proposal Copy Shape
- **D-20:** Backend-rendered proposal copy must list the exact proposed targets and include clear confirmation/modification instructions.
- **D-21:** Proposal copy must not include LLM-style rationale or success-tone wording. Exact strings are left for planning and tests.

### Rejected-Goal and Cancel Copy
- **D-22:** Proposal/authority failures share one generic deterministic fail-closed copy. This includes missing, expired, consumed, mismatch, replaced/unavailable, and guard-unauthorized proposal states; planning should not infer that each bucket requires a distinct internal reason enum.
- **D-23:** Validation range failures get field-specific deterministic copy. Internal reason granularity, renderer shape, and multi-field range details are left for planning.
- **D-24:** Explicit cancel is a user-cancel path, not part of the rejected-goal failure taxonomy. Cancel clears active pending proposal, does not mutate targets, does not publish `goals_update`, and returns backend deterministic neutral copy saying the proposal was not applied and the user can later provide new numbers or ask for a new recommendation. Exact wording is left to planning.
- **D-25:** Failed `update_goals` authority/proposal/validation paths and explicit cancel paths must directly control the final reply with backend-owned copy. They must not enter a later LLM rewrite round.
- **D-26:** Final reply metadata should identify rejected-goal/cancel copy as renderer/backend-owned rather than model-authored. Whether that is implemented through tool result, orchestrator branch, or route short-circuit is left for planning after inspecting the existing mutation receipt path.

### Proof Expectations
- **D-27:** Phase 60 proof should use exact-copy assertions for three representative deterministic copies: generic proposal/authority fail-closed copy, field-specific validation range copy, and cancel neutral copy.
- **D-28:** Proof must also assert negative invariants: targets unchanged, no `goals_update` publish, final reply is renderer/backend-owned, no LLM-authored success-style prose, and no forbidden internal terms.
- **D-29:** Do not require every internal reason code to have different exact user copy because proposal/authority failures intentionally share generic copy. Test layering, exact files, and macro matrix are left for planning.

### the agent's Discretion
- Planner may choose the exact schema for explicit proposal mode after proving whether hidden `proposal_id` handoff is reliable.
- Planner may choose exact deterministic Traditional Chinese copy strings and renderer shape, as long as the copy invariants above are preserved and tested.
- Planner may choose the implementation location for backend-owned rejected/cancel final replies after inspecting the existing mutation receipt path.

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| GOAL-01 | User can receive a concrete goal-change proposal without mutating daily targets until the backend persists a structured pending proposal. [VERIFIED: .planning/REQUIREMENTS.md] | Add `propose_goals` as a non-mutating `ToolContract`, backed by `turn_states` and renderer-owned proposal copy. [VERIFIED: server/orchestrator/tools.ts + server/services/turn-state.ts] |
| GOAL-02 | User confirmation text such as `好` can update goals only when it confirms a valid backend proposal id or includes explicit current-turn numeric target values. [VERIFIED: .planning/REQUIREMENTS.md] | Replace current previous-assistant source guard authority with explicit `update_goals` modes and backend consent/proposal predicates. [VERIFIED: server/orchestrator/source-text-guard.ts + 60-CONTEXT.md] |
| GOAL-03 | User cannot apply expired, consumed, mismatched, or missing goal proposals; the backend returns deterministic Traditional Chinese guidance instead. [VERIFIED: .planning/REQUIREMENTS.md] | Use `turnStateService.getState()` expiry behavior, clear after success/cancel, and renderer-owned generic fail-closed copy. [VERIFIED: server/services/turn-state.ts + 60-CONTEXT.md] |
| GOAL-04 | User sees deterministic backend failure copy after `update_goals` validation or guard rejection, with no target persistence, no `goals_update`, and no LLM-authored success-style text. [VERIFIED: .planning/REQUIREMENTS.md] | Extend mutation receipt architecture so controlled failures short-circuit final reply with `finalReplySource: "renderer"` and no publish. [VERIFIED: server/orchestrator/index.ts + server/orchestrator/mutation-receipts.ts] |

</phase_requirements>

## Summary

Phase 60 should be planned as a backend/orchestrator authority change, not as a UI feature or prompt-only patch. [VERIFIED: .planning/ROADMAP.md + server/orchestrator/tools.ts] The existing stack already has the right primitives: zod-backed `ToolContract`, `turn_states` with one row per `(device_id, kind)`, renderer-owned mutation receipts, `MockLLMProvider` tests, and a `RealtimePublisher` that emits `goals_update` only when called by mutation code. [VERIFIED: server/orchestrator/tool-contract.ts + server/db/schema.ts + server/services/turn-state.ts + server/orchestrator/mutation-receipts.ts + server/realtime/publisher.ts]

The plan should add `propose_goals`, make `update_goals` explicit-mode, and add renderer-owned proposal/rejection/cancel copy near the mutation receipt code. [VERIFIED: 60-CONTEXT.md + 60-AI-SPEC.md + server/orchestrator/tools.ts] The critical design point is that LLM tool calls are routing hints, while TypeScript predicates own authorization, target persistence, proposal clearing, publish/no-publish behavior, and final reply source. [VERIFIED: 60-AI-SPEC.md + server/orchestrator/tool-contract.ts + server/orchestrator/index.ts]

**Primary recommendation:** Use the existing custom TypeScript orchestrator and `turn_states` pattern; add no new runtime dependency, and prove behavior with targeted `node:test` unit/integration cases plus optional harness only if integration evidence cannot prove the no-publish/final-source invariants. [VERIFIED: package.json + AGENTS.md + tests/unit/update-goals-contract.test.ts + tests/integration/chat-goal-update.integration.test.ts]

## Project Constraints (from AGENTS.md)

- Use `yarn` only; do not introduce `npm` workflows for this repo. [VERIFIED: AGENTS.md]
- Keep changes surgical and avoid unrelated refactors, dependency changes, or cleanup. [VERIFIED: AGENTS.md]
- `server/app.ts` is the backend composition root, and new route/service/orchestrator dependencies should be wired there. [VERIFIED: AGENTS.md + server/app.ts]
- `server/routes/*.ts` own HTTP/SSE boundaries, request validation, auth checks, stream framing, and response shaping. [VERIFIED: AGENTS.md]
- `server/services/*.ts` own reusable domain and persistence logic; services must not instantiate LLM clients. [VERIFIED: AGENTS.md]
- `server/orchestrator/*` owns model workflow, tool definitions, tool execution, prompt construction, and fallback behavior. [VERIFIED: AGENTS.md]
- `server/realtime/publisher.ts` owns realtime fan-out for `daily_summary` and `goals_update`. [VERIFIED: AGENTS.md + server/realtime/publisher.ts]
- Runtime uses `OpenAIProvider`; tests use `MockLLMProvider` or harness providers. [VERIFIED: AGENTS.md + server/app.ts + tests/integration/chat-goal-update.integration.test.ts]
- The repo is ESM and local TypeScript imports use explicit `.js` specifiers. [VERIFIED: AGENTS.md + package.json]
- `TZ=Asia/Taipei` is required for local and test setups. [VERIFIED: AGENTS.md + server/app.ts + package.json]
- `GET /api/sse` uses cookie-backed guest sessions because browser `EventSource` cannot set custom headers. [VERIFIED: AGENTS.md + .planning/codebase/INTEGRATIONS.md]
- Use Node built-in `node:test`; do not introduce Jest or Vitest. [VERIFIED: AGENTS.md + package.json]
- Use real SQLite in tests; `:memory:` is acceptable and DB mocking is not. [VERIFIED: AGENTS.md + tests/unit/update-goals-contract.test.ts]
- TypeScript edits require `yarn tsc --noEmit`; route/service edits require `yarn test:integration`; before promotion run `yarn release:check`. [VERIFIED: AGENTS.md]
- `main` is production; no push, merge, rebase, fast-forward, or promotion to `main` is authorized by this research phase. [VERIFIED: AGENTS.md]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Goal proposal creation | LLM Orchestration Layer [VERIFIED: server/orchestrator/tools.ts] | Domain Service / SQLite [VERIFIED: server/services/turn-state.ts] | The model routes intent to `propose_goals`, but `ToolContract` validation, renderer copy, and `turn_states` persistence own the proposal. [VERIFIED: 60-CONTEXT.md + server/orchestrator/tool-contract.ts] |
| Pending proposal lifecycle | Domain Service / SQLite [VERIFIED: server/services/turn-state.ts + server/db/schema.ts] | LLM Orchestration Layer [VERIFIED: server/orchestrator/tools.ts] | `turn_states` already enforces one active row per device/kind and TTL expiry; orchestration decides when to create, apply, cancel, or clear. [VERIFIED: server/db/schema.ts + server/services/turn-state.ts + 60-CONTEXT.md] |
| Goal mutation authorization | LLM Orchestration Layer [VERIFIED: server/orchestrator/tool-contract.ts] | Domain Service [VERIFIED: server/services/device.ts] | `update_goals` must validate mode, source/current-turn numbers, consent, and proposal state before calling `deviceService.updateGoals`. [VERIFIED: 60-CONTEXT.md + server/orchestrator/tools.ts] |
| Target persistence | Domain Service / SQLite [VERIFIED: server/services/device.ts] | Realtime Publisher [VERIFIED: server/realtime/publisher.ts] | Device targets are persisted by `deviceService.updateGoals`; `goals_update` is a post-persistence fan-out only. [VERIFIED: server/orchestrator/tools.ts + server/realtime/publisher.ts] |
| Deterministic proposal/rejected/cancel copy | LLM Orchestration Layer [VERIFIED: server/orchestrator/mutation-receipts.ts] | Route response shaping [VERIFIED: server/routes/chat.ts] | Existing mutation receipts are renderer-owned and final replies can return with `finalReplySource: "renderer"` before later model rounds. [VERIFIED: server/orchestrator/index.ts + tests/unit/orchestrator.test.ts] |
| No-publish invariant | Realtime Publisher caller sites [VERIFIED: server/orchestrator/tools.ts] | Integration tests [VERIFIED: tests/integration/chat-goal-update.integration.test.ts] | `RealtimePublisher` only publishes when called, so rejected/cancel/proposal paths must avoid calling `publishGoalsUpdate`. [VERIFIED: server/realtime/publisher.ts + 60-CONTEXT.md] |
| Privacy-preserving proof | Verification Layer [VERIFIED: tests/unit/verification-artifacts.test.ts] | Observability hooks [VERIFIED: server/orchestrator/hooks.ts] | Logs and proof must remain metadata-only with field names/outcomes rather than raw user text, tool payloads, provider bodies, device ids, or target values. [VERIFIED: .planning/REQUIREMENTS.md + server/orchestrator/hooks.ts + tests/unit/update-goals-contract.test.ts] |

## Standard Stack

### Core

| Library | Locked Version | Registry Latest | Purpose | Why Standard |
|---------|----------------|-----------------|---------|--------------|
| TypeScript | 5.9.3 [VERIFIED: .planning/codebase/STACK.md] | existing lock only [VERIFIED: yarn.lock via .planning/codebase/STACK.md] | Full-stack type checking and ESM source. [VERIFIED: package.json] | Existing repo language and type gate; no phase need to change compiler. [VERIFIED: AGENTS.md + package.json] |
| Fastify | 5.8.4 [VERIFIED: yarn list --pattern fastify] | 5.8.5, published 2026-04-14 [VERIFIED: yarn info fastify --json] | HTTP, multipart chat, SSE routes, and `app.inject()` integration tests. [VERIFIED: server/app.ts + tests/integration/chat-goal-update.integration.test.ts] | Existing transport framework; official docs support Node Test Runner-compatible testing and `app.inject()`. [CITED: fastify.dev/docs/v5.7.x/Guides/Testing/] |
| Zod | 4.3.6 [VERIFIED: yarn list --pattern zod] | 4.4.3, published 2026-05-04 [VERIFIED: yarn info zod --json] | Runtime tool argument validation through `safeParse`. [VERIFIED: server/orchestrator/tool-contract.ts] | Existing `ToolContract` standard; official docs define `.safeParse()` as a non-throwing parse result. [CITED: zod.dev/basics] |
| Drizzle ORM | 0.39.3 [VERIFIED: yarn list --pattern drizzle-orm] | 0.45.2 [VERIFIED: yarn info drizzle-orm --json] | SQLite schema and typed table definitions. [VERIFIED: server/db/schema.ts] | Existing persistence schema uses `sqliteTable`, `index`, and `uniqueIndex`; Drizzle documents SQLite index and unique index declarations. [CITED: orm.drizzle.team/docs/indexes-constraints] |
| better-sqlite3 | 11.10.0 [VERIFIED: .planning/codebase/STACK.md] | existing lock only [VERIFIED: .planning/codebase/STACK.md] | SQLite driver for services/tests. [VERIFIED: server/db/client.ts] | Existing services and tests use real SQLite, including `:memory:` fixtures. [VERIFIED: AGENTS.md + tests/unit/update-goals-contract.test.ts] |
| OpenAI SDK | 4.104.0 [VERIFIED: yarn list --pattern openai] | 6.38.0, published 2026-05-15 [VERIFIED: yarn info openai --json] | Runtime LLM provider behind repo `LLMProvider`. [VERIFIED: server/llm/openai.ts + .planning/codebase/INTEGRATIONS.md] | Existing runtime dependency; Phase 60 should keep Chat Completions and the local provider boundary rather than adopting a new agent framework. [VERIFIED: 60-AI-SPEC.md] |

### Supporting

| Library / Tool | Version | Purpose | When to Use |
|----------------|---------|---------|-------------|
| Node built-in `node:test` | Node 24.14.0 available locally; project requires Node 22+ [VERIFIED: node --version + .planning/codebase/STACK.md] | Unit/integration tests. [VERIFIED: package.json] | Use for all Phase 60 tests; do not add Jest/Vitest. [VERIFIED: AGENTS.md] |
| `tsx` | 4.21.0 [VERIFIED: .planning/codebase/STACK.md] | TypeScript execution for test scripts and harness. [VERIFIED: package.json] | Use existing scripts such as `node scripts/run-node-with-tz.mjs --import tsx --test ...`. [VERIFIED: package.json] |
| `RealtimePublisher` | Repo class [VERIFIED: server/realtime/publisher.ts] | Fan-out for `daily_summary` and `goals_update`. [VERIFIED: server/realtime/publisher.ts] | Spy/stub in unit tests and real route integration tests to prove no `goals_update` on rejected/cancel paths. [VERIFIED: tests/unit/update-goals-contract.test.ts] |
| `MockLLMProvider` | Repo test helper [VERIFIED: tests/integration/chat-goal-update.integration.test.ts] | Deterministic LLM tool-call simulation. [VERIFIED: tests/integration/chat-goal-update.integration.test.ts] | Use in integration tests for proposal creation, confirmation, rejection, and no later LLM rewrite. [VERIFIED: tests/integration/chat-goal-update.integration.test.ts] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Existing custom TypeScript orchestrator [VERIFIED: 60-AI-SPEC.md] | LangGraph TypeScript [VERIFIED: 60-AI-SPEC.md] | Overbuilt for a single pending-proposal lifecycle and would bypass established tool contracts and tests. [VERIFIED: 60-AI-SPEC.md] |
| Existing `turn_states` [VERIFIED: server/services/turn-state.ts] | New `goal_proposals` SQL table [ASSUMED] | A new table could improve auditability later, but Phase 60 explicitly decided one active pending proposal per device and the existing `(device_id, kind)` uniqueness already matches that shape. [VERIFIED: 60-CONTEXT.md + server/db/schema.ts] |
| Zod tool validation [VERIFIED: server/orchestrator/tool-contract.ts] | OpenAI `strict: true` alone [CITED: developers.openai.com/api/docs/guides/function-calling] | OpenAI strict tool schemas require all properties to be required and `additionalProperties: false`; Phase 60 needs partial current-turn updates, so backend validation must remain authoritative. [CITED: developers.openai.com/api/docs/guides/function-calling] |

**Installation:** No new package installation is recommended for Phase 60. [VERIFIED: package.json + 60-AI-SPEC.md]

```bash
yarn install
```

**Version verification:** Locked versions were checked with `yarn list --pattern openai`, `yarn list --pattern zod`, `yarn list --pattern fastify`, and `yarn list --pattern drizzle-orm`; registry latest versions were checked with `yarn info ... --json` because AGENTS.md requires `yarn` workflows in this repo. [VERIFIED: command output + AGENTS.md]

## Architecture Patterns

### System Architecture Diagram

```text
User chat turn
  |
  v
Fastify /api/chat route
  | resolves signed guest session, parses multipart/SSE boundary
  v
Orchestrator round
  | builds system prompt and receives model tool call
  v
ToolContract registry
  |-- propose_goals ----------------------.
  |     zod validates full target set       |
  |     persists turn_states kind           |
  |     renders proposal copy               |
  |     no device target mutation           |
  |     no goals_update publish             |
  |                                        v
  |-- update_goals mode=current_turn_values -> source-field guard -> deviceService.updateGoals
  |                                        |          |             -> clear proposal
  |                                        |          |             -> publishGoalsUpdate
  |                                        |          v
  |-- update_goals mode=latest_proposal ---- consent + pending-state predicate
  |              |                          |
  |              '-> validation/guard/proposal failure/cancel
  |                     -> deterministic renderer copy
  |                     -> unchanged targets
  |                     -> no goals_update
  v
Renderer-owned final reply
  |
  v
JSON/SSE route payload with finalReplySource metadata
```

This flow keeps assistant prose outside the authority path and makes backend state the only authority for proposal confirmation. [VERIFIED: 60-CONTEXT.md + server/orchestrator/tool-contract.ts + server/services/turn-state.ts]

### Recommended Project Structure

```text
server/
├── app.ts                         # wire goalProposalService into orchestrator deps [VERIFIED: server/app.ts]
├── services/
│   ├── turn-state.ts              # existing generic TTL state primitive [VERIFIED: server/services/turn-state.ts]
│   └── goal-proposals.ts          # thin wrapper around turn-state for proposal semantics [VERIFIED: .planning/ROADMAP.md]
├── orchestrator/
│   ├── tools.ts                   # add propose_goals and explicit update_goals modes [VERIFIED: server/orchestrator/tools.ts]
│   ├── tool-contract.ts           # preserve parse/zod/source guard flow [VERIFIED: server/orchestrator/tool-contract.ts]
│   ├── mutation-receipts.ts       # add proposal/rejection/cancel renderers or sibling [VERIFIED: server/orchestrator/mutation-receipts.ts]
│   ├── system-prompt.ts           # route ambiguous goal intent to propose_goals [VERIFIED: server/orchestrator/system-prompt.ts]
│   └── index.ts                   # short-circuit renderer-owned controlled failures [VERIFIED: server/orchestrator/index.ts]
tests/
├── unit/update-goals-contract.test.ts
├── unit/goal-proposals.test.ts
└── integration/chat-goal-update.integration.test.ts
```

### Pattern 1: Thin Goal Proposal Service over `turn_states`

**What:** Wrap `createTurnStateService(db)` with `createGoalProposalService(db)` so `GOAL_PROPOSAL_KIND`, TTL, payload schema, create/get/clear semantics, and proposal id generation are not scattered through `tools.ts`. [VERIFIED: server/services/turn-state.ts + .planning/ROADMAP.md]

**When to use:** Use this service for proposal creation, lookup, clearing after success/cancel, and expiry handling; do not create a migration unless the planner intentionally rejects the existing `turn_states` pattern. [VERIFIED: 60-CONTEXT.md + server/db/schema.ts]

**Example:**

```typescript
// Source: server/services/turn-state.ts + 60-CONTEXT.md
const GOAL_PROPOSAL_KIND = "goal_proposal";
const GOAL_PROPOSAL_TTL_MS = 30 * 60 * 1000;

export function createGoalProposalService(turnStateService: ReturnType<typeof createTurnStateService>) {
  return {
    put(deviceId: string, payload: GoalProposalPayload) {
      return turnStateService.putState(deviceId, GOAL_PROPOSAL_KIND, payload, GOAL_PROPOSAL_TTL_MS);
    },
    get(deviceId: string) {
      return turnStateService.getState<GoalProposalPayload>(deviceId, GOAL_PROPOSAL_KIND);
    },
    clear(deviceId: string) {
      return turnStateService.clearState(deviceId, GOAL_PROPOSAL_KIND);
    },
  };
}
```

### Pattern 2: Explicit `update_goals` Modes

**What:** Replace partial-only args with a discriminated mode schema, so proposal confirmation is not represented by empty args or model-inferred previous prose. [VERIFIED: 60-CONTEXT.md + server/orchestrator/tools.ts]

**When to use:** Use `current_turn_values` when the current user message contains numeric targets; use `latest_proposal` unless planning proves hidden `proposal_id` handoff is reliable. [VERIFIED: 60-CONTEXT.md]

**Example:**

```typescript
// Source: 60-AI-SPEC.md + server/orchestrator/tool-contract.ts
const updateGoalsSchema = z.union([
  z.object({
    mode: z.literal("current_turn_values"),
    calories: z.number().min(500).max(8000).optional(),
    protein: z.number().min(0).max(400).optional(),
    carbs: z.number().min(0).max(1000).optional(),
    fat: z.number().min(0).max(300).optional(),
  }).strict().refine((args) =>
    ["calories", "protein", "carbs", "fat"].some((field) => args[field as keyof typeof args] !== undefined),
  ),
  z.object({ mode: z.literal("latest_proposal") }).strict(),
]);
```

### Pattern 3: Renderer-Owned Controlled Failure Reply

**What:** Controlled `update_goals` validation, guard, proposal-unavailable, and cancel outcomes should return deterministic copy from backend code and stop before another model round. [VERIFIED: 60-CONTEXT.md + server/orchestrator/index.ts]

**When to use:** Use it for all failed `update_goals` authority and validation paths and explicit cancel; keep ordinary non-goal tool failures on the existing fallback path unless the phase explicitly touches them. [VERIFIED: 60-CONTEXT.md + server/orchestrator/index.ts]

**Example:**

```typescript
// Source: server/orchestrator/index.ts existing renderer receipt branch
if (goalControlledReply) {
  return {
    reply: goalControlledReply.text,
    didLogMeal,
    didMutateMeal,
    dailySummary: logMealSummary,
    dailyTargets: successfulGoalTargets,
    finalReplySource: "renderer",
    finalReplyShape: classifyPlainReplyShape(goalControlledReply.text),
  };
}
```

### Anti-Patterns to Avoid

- **Parsing assistant prose as proposal authority:** The current guard accepts numbers from the previous assistant message when current user text is an explicit confirmation, but Phase 60 requires backend-persisted proposal state instead. [VERIFIED: server/orchestrator/source-text-guard.ts + 60-CONTEXT.md]
- **Empty args as confirmation:** Empty `update_goals` args currently fail validation and must remain invalid; proposal confirmation needs explicit mode. [VERIFIED: tests/unit/update-goals-contract.test.ts + 60-CONTEXT.md]
- **Publishing before persistence or on rejection:** `publishGoalsUpdate` should be called only after `deviceService.updateGoals` succeeds. [VERIFIED: server/orchestrator/tools.ts + 60-CONTEXT.md]
- **Letting failed goal outcomes continue to a model rewrite:** Existing success receipts short-circuit the model; Phase 60 should apply the same renderer authority to rejected/cancel copy. [VERIFIED: server/orchestrator/index.ts + tests/unit/orchestrator.test.ts]
- **Logging raw proposal/target payloads in proof metadata:** Existing log summaries intentionally include field names, not target values; Phase 60 should preserve that. [VERIFIED: server/orchestrator/tool-contract.ts + tests/unit/update-goals-contract.test.ts]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Tool argument validation | Ad hoc JSON/path checks in `tools.ts` [VERIFIED: server/orchestrator/tool-contract.ts] | Existing `ToolContract` + Zod `safeParse` [VERIFIED: server/orchestrator/tool-contract.ts] | The runner already maps parse/schema/guard/execute failures into controlled metadata. [VERIFIED: server/orchestrator/tool-contract.ts] |
| Pending proposal TTL and one-active-per-device | A custom process-local `Map` [VERIFIED: server/routes/chat.ts activeChatTurns is process-local only] | SQLite `turn_states` via `createTurnStateService` [VERIFIED: server/services/turn-state.ts] | `turn_states` persists across process state, enforces `(device_id, kind)` uniqueness, and clears expired rows on read. [VERIFIED: server/db/schema.ts + server/services/turn-state.ts] |
| Goal success/failure copy | LLM-authored final prose [VERIFIED: tests/integration/chat-goal-update.integration.test.ts current failing pattern] | Backend renderer near `mutation-receipts.ts` [VERIFIED: server/orchestrator/mutation-receipts.ts] | Existing receipts prove renderer-owned final replies avoid model-added success prose. [VERIFIED: tests/unit/orchestrator.test.ts] |
| SSE fan-out | Direct writes from tool contracts [VERIFIED: server/realtime/publisher.ts] | `RealtimePublisher.publishGoalsUpdate` after committed persistence [VERIFIED: server/orchestrator/tools.ts] | The publisher centralizes subscriber cleanup and event framing. [VERIFIED: server/realtime/publisher.ts] |
| OpenAI strict schema as mutation authority | Model schema adherence as the only guard [CITED: developers.openai.com/api/docs/guides/function-calling] | Backend zod + source/proposal predicates [VERIFIED: server/orchestrator/tool-contract.ts] | Official docs say strict schema has structural requirements; product authority still belongs to backend code. [CITED: developers.openai.com/api/docs/guides/function-calling] |

**Key insight:** The hard part is not making the model call the right tool; it is ensuring every possible tool outcome is authorized, persisted, cleared, published, rendered, and logged by backend code. [VERIFIED: 60-AI-SPEC.md + server/orchestrator/index.ts + server/orchestrator/tool-contract.ts]

## Common Pitfalls

### Pitfall 1: Previous Assistant Text Still Authorizes Confirmation

**What goes wrong:** A short `好` can still apply numbers from the previous assistant prose because `checkSourceFields()` currently allows assistant-message numbers when `hasExplicitConfirmation()` passes. [VERIFIED: server/orchestrator/source-text-guard.ts]  
**Why it happens:** The old design relied on prompt-rendered recommendation text rather than persisted backend proposal state. [VERIFIED: tests/integration/chat-goal-update.integration.test.ts + 60-CONTEXT.md]  
**How to avoid:** Make `update_goals` proposal mode load active backend proposal values and ignore model-supplied target numbers in that mode. [VERIFIED: 60-CONTEXT.md + 60-AI-SPEC.md]  
**Warning signs:** Tests that queue a prose recommendation, then `update_goals` numeric args on `好`, still pass without a `turn_states` row. [VERIFIED: tests/integration/chat-goal-update.integration.test.ts]

### Pitfall 2: Rejection Copy Falls Through to the LLM

**What goes wrong:** Validation or guard failure becomes a second LLM reply such as "請提供..." instead of exact deterministic backend copy. [VERIFIED: tests/integration/chat-goal-update.integration.test.ts]  
**Why it happens:** Current controlled `update_goals` failures append tool results and continue the model loop. [VERIFIED: server/orchestrator/index.ts]  
**How to avoid:** Add a goal-specific controlled-outcome branch that returns renderer-owned failure/cancel copy immediately. [VERIFIED: 60-CONTEXT.md]  
**Warning signs:** `MockLLMProvider.chatCalls.length` is greater than one after a rejected goal update. [VERIFIED: tests/unit/orchestrator.test.ts existing success receipt assertions]

### Pitfall 3: Proposal Is Cleared Too Late

**What goes wrong:** A successful persistence followed by publish/recompute failure leaves the proposal reusable. [VERIFIED: 60-CONTEXT.md]  
**Why it happens:** Clearing is coupled to post-commit publish or summary refresh instead of target persistence. [VERIFIED: 60-CONTEXT.md]  
**How to avoid:** Persist targets, clear proposal immediately after commit, then publish `goals_update`. [VERIFIED: 60-CONTEXT.md + 60-AI-SPEC.md]  
**Warning signs:** A test with a throwing publisher can replay the same proposal and mutate again. [VERIFIED: 60-CONTEXT.md]

### Pitfall 4: Proposal Creation Publishes or Mutates

**What goes wrong:** `propose_goals` accidentally calls `deviceService.updateGoals` or `publishGoalsUpdate`. [VERIFIED: 60-CONTEXT.md]  
**Why it happens:** Proposal and mutation responsibilities are implemented in the same contract branch. [VERIFIED: 60-CONTEXT.md]  
**How to avoid:** Keep `propose_goals` as non-mutating state write + renderer copy only. [VERIFIED: 60-CONTEXT.md]  
**Warning signs:** Targets differ after "我想少吃一點" proposal turn, or test publisher captures `goals_update`. [VERIFIED: GOAL-01 in .planning/REQUIREMENTS.md]

### Pitfall 5: Metadata Evidence Leaks Raw Content or Target Values

**What goes wrong:** Logs or harness artifacts store raw user text, final assistant text, device ids, target numbers, or full tool payloads. [VERIFIED: .planning/REQUIREMENTS.md]  
**Why it happens:** Debugging rejected goal paths tempts direct serialization of tool calls and DB snapshots. [VERIFIED: 60-AI-SPEC.md]  
**How to avoid:** Preserve field-name-only summaries and assert no raw target values in log metadata. [VERIFIED: server/orchestrator/tool-contract.ts + tests/unit/update-goals-contract.test.ts]  
**Warning signs:** Serialized metadata includes `1800`, `130`, `deviceId`, raw message text, or full proposal payload. [VERIFIED: tests/unit/update-goals-contract.test.ts + server/orchestrator/mutation-receipts.ts forbidden terms]

## Code Examples

### `propose_goals` Contract Shape

```typescript
// Source: server/orchestrator/tools.ts ToolContract pattern + 60-CONTEXT.md
const proposeGoalsSchema = z.object({
  calories: z.number().min(500).max(8000),
  protein: z.number().min(0).max(400),
  carbs: z.number().min(0).max(1000),
  fat: z.number().min(0).max(300),
}).strict();

const proposeGoalsContract: ToolContract<DailyTargets, GoalProposalResult> = {
  name: "propose_goals",
  description: "建立一組待使用者確認的每日目標提案；不更新每日目標。",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      calories: { type: "number", minimum: 500, maximum: 8000 },
      protein: { type: "number", minimum: 0, maximum: 400 },
      carbs: { type: "number", minimum: 0, maximum: 1000 },
      fat: { type: "number", minimum: 0, maximum: 300 },
    },
    required: ["calories", "protein", "carbs", "fat"],
  },
  zodSchema: proposeGoalsSchema,
  logSummary: () => ({ tool: "propose_goals", proposedFields: ["calories", "protein", "carbs", "fat"] }),
  execute: async (targets, context) => {
    const deps = context.deps?.toolDeps as ToolDeps;
    const deviceId = context.deps?.deviceId as string;
    const proposal = await deps.goalProposalService.putLatest(deviceId, targets);
    return { ok: true, result: proposal, toolMessage: renderGoalProposalCopy(proposal.targets) };
  },
};
```

### Consent and Cancel Predicates

```typescript
// Source: 60-CONTEXT.md
const GOAL_CONSENT_TERMS = new Set(["好", "可以", "幫我更新", "就這樣", "用這組"]);
const GOAL_CANCEL_TERMS = new Set(["不要", "取消", "先不用", "no"]);

function normalizeGoalDecisionText(message: string): string {
  return message.trim().toLowerCase();
}

function hasGoalConsent(message: string): boolean {
  return GOAL_CONSENT_TERMS.has(normalizeGoalDecisionText(message));
}

function hasGoalCancel(message: string): boolean {
  return GOAL_CANCEL_TERMS.has(normalizeGoalDecisionText(message));
}
```

### No-Publish Rejection Test Skeleton

```typescript
// Source: tests/unit/update-goals-contract.test.ts existing test style
it("rejects latest_proposal without active proposal without mutating or publishing", async () => {
  const before = await deviceService.getDevice(deviceId);
  const result = await executeTool(updateGoalsCall({ mode: "latest_proposal" }), deviceId, deps, {
    currentUserMessage: "好",
  });

  assert.equal(result.success, false);
  assert.equal(result.executed, false);
  assert.equal(result.failureReason, "guard");
  assert.equal(published.length, 0);
  assert.deepEqual(await deviceService.getDevice(deviceId), before);
  assert.equal(result.result, GENERIC_GOAL_PROPOSAL_UNAVAILABLE_COPY);
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Prompt-only goal recommendation followed by `update_goals` using previous assistant numbers. [VERIFIED: tests/integration/chat-goal-update.integration.test.ts] | Backend-owned `propose_goals` state and explicit proposal-mode `update_goals`. [VERIFIED: 60-CONTEXT.md] | Phase 60 planning, 2026-05-17. [VERIFIED: gsd-sdk init.phase-op 60] | Short consent text becomes fail-closed unless backend state authorizes it. [VERIFIED: GOAL-02 in .planning/REQUIREMENTS.md] |
| Controlled `update_goals` validation/guard failures continue to LLM clarification. [VERIFIED: server/orchestrator/index.ts + tests/integration/chat-goal-update.integration.test.ts] | Deterministic backend failure/cancel copy short-circuits final reply. [VERIFIED: 60-CONTEXT.md] | Phase 60 planning, 2026-05-17. [VERIFIED: 60-CONTEXT.md] | Failed goal paths cannot display model-authored success-style copy. [VERIFIED: GOAL-04 in .planning/REQUIREMENTS.md] |
| Success receipts are renderer-owned; rejected goal copy is not. [VERIFIED: server/orchestrator/mutation-receipts.ts + tests/unit/orchestrator.test.ts] | Success, proposal, rejection, validation failure, and cancel replies are all renderer-owned. [VERIFIED: 60-CONTEXT.md] | Phase 60 planning, 2026-05-17. [VERIFIED: 60-CONTEXT.md] | Exact-copy tests can prove user-visible copy. [VERIFIED: 60-CONTEXT.md D-27] |

**Deprecated/outdated:**
- Previous-assistant numeric source authorization for goal confirmations is outdated for Phase 60, because proposal authority must come from backend-persisted state. [VERIFIED: server/orchestrator/source-text-guard.ts + 60-CONTEXT.md]
- LLM-authored rejected-goal clarification is outdated for Phase 60, because failed `update_goals` paths must directly control final copy with backend-rendered text. [VERIFIED: tests/integration/chat-goal-update.integration.test.ts + 60-CONTEXT.md]
- OpenAI `strict: true` is not a drop-in replacement for current partial `update_goals` schemas, because official docs require `additionalProperties: false` and all fields required for strict function schemas. [CITED: developers.openai.com/api/docs/guides/function-calling]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | A new dedicated `goal_proposals` SQL table could improve auditability later. [ASSUMED] | Standard Stack / Alternatives Considered | Low for Phase 60 because the locked decision and existing schema favor `turn_states`; future analytics/audit requirements might revisit storage shape. |

## Open Questions

1. **Should proposal confirmation use hidden `proposal_id` or latest-active mode?** [VERIFIED: 60-CONTEXT.md]
   - What we know: The user locked a preference for hidden `proposal_id` only if planning can prove reliable next-turn handoff without exposing it in user-facing copy. [VERIFIED: 60-CONTEXT.md]
   - What's unclear: Current code does not expose a hidden model-visible proposal id channel distinct from user-visible assistant text. [VERIFIED: server/orchestrator/index.ts + server/services/chat.ts via code search]
   - Recommendation: Plan latest-active proposal mode first, and add an explicit proof task if attempting hidden id handoff. [VERIFIED: 60-CONTEXT.md]

2. **Where exactly should rejected/cancel renderer metadata attach?** [VERIFIED: 60-CONTEXT.md]
   - What we know: Existing success receipts return `finalReplySource: "renderer"` from `server/orchestrator/index.ts`. [VERIFIED: server/orchestrator/index.ts]
   - What's unclear: Planner must choose whether failed/cancel replies are represented as a `ToolExecutionResult`, a controlled orchestrator branch, or a route-level short-circuit. [VERIFIED: 60-CONTEXT.md]
   - Recommendation: Keep it in orchestrator/tool outcome handling so JSON and SSE chat paths share the same source metadata. [VERIFIED: server/orchestrator/index.ts + server/routes/chat.ts]

3. **Should a harness scenario be added in Phase 60 or deferred to Phase 64?** [VERIFIED: .planning/ROADMAP.md]
   - What we know: Roadmap Phase 64 owns milestone-wide verification hardening, but Phase 60 proof must include exact-copy and negative invariants. [VERIFIED: .planning/ROADMAP.md + 60-CONTEXT.md]
   - What's unclear: Integration tests may be enough if they prove no publish, unchanged targets, final source, and no second model round. [VERIFIED: tests/integration/chat-goal-update.integration.test.ts]
   - Recommendation: Plan unit/integration coverage as required, then add a focused harness scenario only if no-publish/final-source evidence is weak. [VERIFIED: nutrition-new-harness-scenario skill + AGENTS.md]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | TypeScript tests/scripts [VERIFIED: package.json] | Yes [VERIFIED: node --version] | 24.14.0 [VERIFIED: node --version] | Project requires Node 22+, so local version is sufficient. [VERIFIED: .planning/codebase/STACK.md] |
| Yarn classic | All repo commands [VERIFIED: AGENTS.md] | Yes [VERIFIED: yarn --version] | 1.22.22 [VERIFIED: yarn --version] | None; repo rule says use Yarn only. [VERIFIED: AGENTS.md] |
| SQLite CLI | Optional local inspection [VERIFIED: command probe] | Yes [VERIFIED: sqlite3 --version] | 3.51.0 [VERIFIED: sqlite3 --version] | Tests use `better-sqlite3`, so CLI is not required for automated proof. [VERIFIED: package.json + tests/unit/update-goals-contract.test.ts] |
| Git | Optional commit_docs workflow [VERIFIED: gsd-sdk init.phase-op 60] | Yes [VERIFIED: git --version] | 2.50.1 [VERIFIED: git --version] | None needed. [VERIFIED: command probe] |
| OpenAI API key | Live runtime only [VERIFIED: .planning/codebase/INTEGRATIONS.md] | Not probed because `.env` is secret-bearing [VERIFIED: .planning/codebase/INTEGRATIONS.md] | — | Phase 60 tests should use `MockLLMProvider`, not live OpenAI. [VERIFIED: AGENTS.md + tests/integration/chat-goal-update.integration.test.ts] |

**Missing dependencies with no fallback:** None for planning and local deterministic tests. [VERIFIED: command probe + package.json]

**Missing dependencies with fallback:** OpenAI live credentials were intentionally not inspected; deterministic Phase 60 proof should use mock/harness providers. [VERIFIED: .planning/codebase/INTEGRATIONS.md + AGENTS.md]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Node built-in `node:test` with `node:assert/strict`. [VERIFIED: package.json + tests/unit/update-goals-contract.test.ts] |
| Config file | None for test runner; scripts use `scripts/run-node-with-tz.mjs` to enforce timezone. [VERIFIED: package.json] |
| Quick run command | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/update-goals-contract.test.ts tests/integration/chat-goal-update.integration.test.ts` [VERIFIED: package.json + existing test files] |
| Full suite command | `yarn test` and final local closure `yarn tsc --noEmit`; `yarn release:check` is required before promotion/closure gates. [VERIFIED: package.json + AGENTS.md + .planning/REQUIREMENTS.md] |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| GOAL-01 | Proposal turn persists pending proposal, renders exact proposal copy, leaves targets unchanged, and publishes no `goals_update`. [VERIFIED: .planning/REQUIREMENTS.md] | unit + integration | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/goal-proposals.test.ts tests/integration/chat-goal-update.integration.test.ts` | No for `goal-proposals.test.ts`; integration file exists. [VERIFIED: tests/integration/chat-goal-update.integration.test.ts] |
| GOAL-02 | `好` applies only active backend proposal or explicit current-turn numeric targets; empty args invalid. [VERIFIED: .planning/REQUIREMENTS.md] | unit + integration | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/update-goals-contract.test.ts tests/integration/chat-goal-update.integration.test.ts` | Yes, needs expansion. [VERIFIED: tests/unit/update-goals-contract.test.ts + tests/integration/chat-goal-update.integration.test.ts] |
| GOAL-03 | Expired, consumed, canceled, missing, or unavailable proposals fail closed with generic exact copy and unchanged targets. [VERIFIED: .planning/REQUIREMENTS.md] | unit + integration | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/goal-proposals.test.ts tests/integration/chat-goal-update.integration.test.ts` | No for lifecycle unit file; integration file exists. [VERIFIED: file search] |
| GOAL-04 | Validation/guard/proposal failures do not mutate, do not publish, and return renderer-owned deterministic copy without model success prose. [VERIFIED: .planning/REQUIREMENTS.md] | unit + integration | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/update-goals-contract.test.ts tests/unit/orchestrator.test.ts tests/integration/chat-goal-update.integration.test.ts` | Yes, needs expansion. [VERIFIED: tests/unit/update-goals-contract.test.ts + tests/unit/orchestrator.test.ts + tests/integration/chat-goal-update.integration.test.ts] |

### Sampling Rate

- **Per task commit:** Run the targeted unit/integration command for touched files plus `yarn tsc --noEmit` for TypeScript edits. [VERIFIED: AGENTS.md]
- **Per wave merge:** Run `yarn test` after route/service/orchestrator changes stabilize. [VERIFIED: package.json + AGENTS.md]
- **Phase gate:** Run `yarn tsc --noEmit`; use `yarn release:check` only as local closure or promotion gate, not as authorization to touch `main`. [VERIFIED: .planning/REQUIREMENTS.md + AGENTS.md]

### Wave 0 Gaps

- [ ] `tests/unit/goal-proposals.test.ts` — covers pending proposal service TTL/overwrite/clear semantics for GOAL-01 and GOAL-03. [VERIFIED: file search + 60-CONTEXT.md]
- [ ] Expand `tests/unit/update-goals-contract.test.ts` — covers explicit modes, latest proposal apply, current-turn override, empty args rejection, validation exact copy, and no publish. [VERIFIED: tests/unit/update-goals-contract.test.ts + 60-CONTEXT.md]
- [ ] Expand `tests/integration/chat-goal-update.integration.test.ts` — covers proposal-only turn, short consent apply, missing/expired/consumed/cancel failures, final renderer source, and no second LLM rewrite. [VERIFIED: tests/integration/chat-goal-update.integration.test.ts + 60-CONTEXT.md]
- [ ] Optional harness scenario only if integration tests cannot produce strong no-publish/final-source evidence. [VERIFIED: AGENTS.md + nutrition-new-harness-scenario skill]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | Yes [VERIFIED: .planning/codebase/INTEGRATIONS.md] | Continue signed guest-session route ownership; do not authorize browser routes from raw `deviceId`. [VERIFIED: AGENTS.md + server/lib/guest-session-resolver.ts] |
| V3 Session Management | Yes [VERIFIED: .planning/codebase/INTEGRATIONS.md] | Keep proposal state keyed by authorized device id resolved from existing session flow. [VERIFIED: server/routes/chat.ts + server/services/turn-state.ts] |
| V4 Access Control | Yes [VERIFIED: .planning/codebase/ARCHITECTURE.md] | Route uses cookie-backed device ownership; tool contracts receive device id from orchestrator deps, not user-provided args. [VERIFIED: server/orchestrator/tools.ts + server/routes/chat.ts] |
| V5 Input Validation | Yes [VERIFIED: server/orchestrator/tool-contract.ts] | Zod schemas, explicit modes, field ranges, source guard, consent/cancel predicates, and backend proposal lookup. [VERIFIED: server/orchestrator/tool-contract.ts + 60-CONTEXT.md] |
| V6 Cryptography | Yes, indirectly for sessions [VERIFIED: .planning/codebase/INTEGRATIONS.md] | Reuse existing HMAC-signed guest sessions; do not add crypto for proposal ids beyond opaque `crypto.randomUUID()` if needed. [VERIFIED: server/services/guest-session.ts + 60-AI-SPEC.md] |
| V7 Error Handling and Logging | Yes [VERIFIED: .planning/REQUIREMENTS.md] | Metadata-only hooks/log summaries and deterministic user copy; no raw user/provider/tool/session payloads. [VERIFIED: server/orchestrator/hooks.ts + server/orchestrator/tool-contract.ts] |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Prompt injection asks model to bypass goal rules. [VERIFIED: 60-AI-SPEC.md] | Elevation of Privilege | Backend `update_goals` predicate must fail closed without valid current-turn numbers or active proposal. [VERIFIED: 60-CONTEXT.md] |
| Short consent replays consumed/expired proposal. [VERIFIED: GOAL-03 in .planning/REQUIREMENTS.md] | Tampering | Clear proposal after successful persistence/cancel and treat expired `getState()` as unavailable. [VERIFIED: server/services/turn-state.ts + 60-CONTEXT.md] |
| Rejected path publishes `goals_update`. [VERIFIED: GOAL-04 in .planning/REQUIREMENTS.md] | Tampering / Information Disclosure | Only call `publishGoalsUpdate` after `deviceService.updateGoals` succeeds. [VERIFIED: server/orchestrator/tools.ts] |
| Logs leak health/diet or target payload data. [VERIFIED: .planning/REQUIREMENTS.md] | Information Disclosure | Use field-name-only `logSummary`, forbidden-term tests, and metadata-only artifacts. [VERIFIED: server/orchestrator/tool-contract.ts + tests/unit/update-goals-contract.test.ts] |
| User-facing copy implies success after failed mutation. [VERIFIED: GOAL-04 in .planning/REQUIREMENTS.md] | Spoofing / Repudiation | Renderer-owned exact failure/cancel copy with `finalReplySource: "renderer"`. [VERIFIED: server/orchestrator/index.ts + 60-CONTEXT.md] |

## Sources

### Primary (HIGH confidence)

- `.planning/phases/60-goal-proposal-authority-and-rejected-goal-copy/60-CONTEXT.md` — locked decisions, discretion, proof expectations. [VERIFIED: file read]
- `.planning/phases/60-goal-proposal-authority-and-rejected-goal-copy/60-AI-SPEC.md` — AI contract, guardrails, eval strategy. [VERIFIED: file read]
- `.planning/REQUIREMENTS.md` — GOAL-01 through GOAL-04. [VERIFIED: file read]
- `.planning/ROADMAP.md` — Phase 60 dependency, success criteria, implementation notes. [VERIFIED: file read]
- `.planning/STATE.md` — current phase state and v2.3 decisions. [VERIFIED: file read]
- `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/STACK.md`, `.planning/codebase/INTEGRATIONS.md` — architecture, stack, integration boundaries. [VERIFIED: file read]
- `AGENTS.md` — project constraints, test matrix, branch/promotion policy. [VERIFIED: file read]
- `server/orchestrator/tool-contract.ts`, `server/orchestrator/tools.ts`, `server/orchestrator/index.ts`, `server/orchestrator/mutation-receipts.ts`, `server/services/turn-state.ts`, `server/db/schema.ts`, `server/realtime/publisher.ts` — implementation boundaries. [VERIFIED: codebase grep/read]
- `tests/unit/update-goals-contract.test.ts`, `tests/integration/chat-goal-update.integration.test.ts`, `tests/unit/orchestrator.test.ts` — existing proof patterns. [VERIFIED: codebase read]
- OpenAI Function Calling docs — tool-calling and strict schema requirements. [CITED: https://developers.openai.com/api/docs/guides/function-calling]
- OpenAI Structured Outputs docs — use function calling when connecting model to tools/functions/data. [CITED: https://developers.openai.com/api/docs/guides/structured-outputs]
- Zod basic usage docs — `.safeParse()` behavior. [CITED: https://zod.dev/basics]
- Fastify testing docs — compatibility with Node Test Runner and `app.inject()` testing. [CITED: https://fastify.dev/docs/v5.7.x/Guides/Testing/]
- Drizzle indexes/constraints docs — SQLite `index` and `uniqueIndex` declarations. [CITED: https://orm.drizzle.team/docs/indexes-constraints]

### Secondary (MEDIUM confidence)

- `yarn info` registry output for `openai`, `zod`, `fastify`, and `drizzle-orm` latest versions and publish metadata. [VERIFIED: yarn info commands]
- Local environment probes for Node, Yarn, SQLite CLI, and Git. [VERIFIED: command probes]

### Tertiary (LOW confidence)

- None. [VERIFIED: sources above]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — existing lockfile/package scripts and registry checks were verified; no new dependency is recommended. [VERIFIED: package.json + yarn list + yarn info]
- Architecture: HIGH — target integration points are explicit in codebase maps and source files. [VERIFIED: .planning/codebase/ARCHITECTURE.md + server/orchestrator/* + server/services/turn-state.ts]
- Pitfalls: HIGH — pitfalls are grounded in current tests and code paths that Phase 60 must replace or extend. [VERIFIED: tests/integration/chat-goal-update.integration.test.ts + server/orchestrator/source-text-guard.ts + server/orchestrator/index.ts]
- Security/privacy: HIGH — metadata-only constraints are repeated in requirements, AI-SPEC, AGENTS.md, and existing log-summary tests. [VERIFIED: .planning/REQUIREMENTS.md + 60-AI-SPEC.md + AGENTS.md + tests/unit/update-goals-contract.test.ts]

**Research date:** 2026-05-17 [VERIFIED: environment_context]  
**Valid until:** 2026-06-16 for codebase architecture; re-check registry/OpenAI docs within 7 days before dependency or model API changes. [VERIFIED: package registry checked 2026-05-17 + OpenAI docs crawled recently by web search]
