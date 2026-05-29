# Phase 68: Structured Tool Results and Release-Proof Gate - Research

**Researched:** 2026-05-29  
**Domain:** TypeScript Fastify orchestrator/tool-result plumbing, route persistence, metadata-only proof, local release gates [VERIFIED: .planning/ROADMAP.md; VERIFIED: package.json]  
**Confidence:** HIGH for codebase seams and proof surfaces; MEDIUM for exact plan slicing because implementation names remain delegated to plan-phase [VERIFIED: .planning/phases/68-structured-tool-results-and-release-proof-gate/68-CONTEXT.md]

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

#### Structured Result Boundary
- **D-01:** Keep `runContract()` and contract-specific results behind the existing `executeTool()` adapter. Do not pass raw `contractResult` through to `server/orchestrator/index.ts`.
- **D-02:** Extend `ToolExecutionResult` with explicit typed clarification/status facts the orchestrator needs.
- **D-03:** The new typed field must be a narrow discriminated union for renderer-ready clarification facts, not a `find_meals`-only shape.
- **D-04:** The union must support unresolved `find_meals` facts, historical `log_food` prompt/reason facts, and `get_daily_summary` `needs_clarification` / `multiple_targets` facts including `dateKeys`.
- **D-05:** Candidate facts inside the union must use a renderer-ready allowlisted projection, not full service `MealCorrectionCandidate`.
- **D-06:** Candidate projection should default to stable option number, date/time, display label, and explicit meal-period facts when allowed. Plan-phase may decide whether meal id/revision are needed internally, but they should not become part of the renderer/proof surface by default.
- **D-07:** Renderer/copy helpers remain authoritative for terminal clarification copy. Phase 68 must not add clarification rendering into `server/orchestrator/index.ts`.
- **D-08:** Final terminal clarification text must not come from serialized tool-message reparsing or a second LLM pass.
- **D-09:** Plan-phase may calibrate whether historical prompt text is passed through a thin renderer helper or later moved out of tool contracts, but discussion does not require prompt-building relocation.

#### Historical Clarification Behavior
- **D-10:** Historical `log_food` date clarification becomes a renderer-owned terminal reply from typed clarification facts.
- **D-11:** Historical `log_food` ambiguity must not be fed back to the LLM for another pass. Backend date resolution has already determined the date cannot be safely resolved.
- **D-12:** `get_daily_summary` `needs_clarification` becomes a renderer-owned terminal reply from typed prompt/reason facts.
- **D-13:** `get_daily_summary` `multiple_targets` also becomes terminal. It should ask the user to narrow to one date from typed `dateKeys`.
- **D-14:** `multiple_targets` does not introduce multi-date summary aggregation. That would be new feature work outside Phase 68.
- **D-15:** Historical terminal copy should use backend/date-parser prompt and reason facts as source, wrapped by renderer-owned copy helpers.
- **D-16:** Existing `resolveHistoricalDateIntent` prompt text can remain mostly pass-through. `get_daily_summary` `multiple_targets` needs renderer-owned narrow-to-one-date copy because it currently has `dateKeys` but no prompt.
- **D-17:** Terminal historical clarification has a hard no-side-effect invariant: no meal revision, `loggedMeal`, `summaryOutcome`, `daily_summary` publish, success receipt, success-style copy, or second LLM pass.
- **D-18:** Terminal historical clarification should return as a clarification-only turn with `didLogMeal:false`, `didMutateMeal:false`, no `summaryOutcome`, and no logged meal payload.
- **D-18a:** `get_daily_summary` `multiple_targets` narrow-to-one-date copy must not accidentally seed a single explicit historical date for the next turn. `extractPreviousHistoricalDateKey()` parses the previous assistant message for historical date carry-forward, so renderer-owned copy that lists multiple `dateKeys` must be shaped and tested so it cannot be misread as one resolved previous date.
- **D-18b:** Controlled replies exit the orchestrator before assistant-message persistence. Plan-phase must preserve and prove JSON/SSE route persistence of terminal clarification replies through `finalizeAssistantReply()` so multi-turn follow-up behavior has the previous assistant clarification available where required.

#### Proof Strategy
- **D-19:** Default proof is targeted unit plus integration tests. Add deterministic harness coverage only if plan-phase identifies a specific false-pass risk that normal tests cannot close.
- **D-20:** Unit tests should cover `executeTool()` typed clarification facts, renderer helper output, and orchestrator terminal behavior including `finalReplySource === "renderer"` and no consumed queued follow-up LLM response.
- **D-21:** Integration tests should cover route-visible JSON/SSE behavior and publish suppression where affected.
- **D-22:** Prefer existing suites: `tests/unit/tools.test.ts`, `tests/unit/orchestrator.test.ts`, `tests/integration/chat-meal-correction.integration.test.ts`, plus `tests/integration/chat-api.test.ts` and `tests/integration/chat-streaming.test.ts` only for affected JSON/SSE historical log or summary paths.
- **D-23:** Add one small source guard in the existing source-scan idiom to prevent serialized clarification-result reparsing paths from returning.
- **D-24:** PROOF-01 requires a full phase matrix: structured clarification facts for `find_meals`, historical `log_food`, and `get_daily_summary`; terminal renderer ownership; no second LLM pass; hard no-side-effect invariants; JSON/SSE parity where affected; a source guard against serialized reparsing; carry-forward v2.4 behavior families; and local closure gates.
- **D-25:** Carry-forward behavior families include tool schema alignment, explicit meal-period authority, numeric correction authority, target ranking, and clarification rendering.
- **D-26:** Full matrix means traceability, not duplicate new tests for every old requirement. Existing Phase 65-67 tests may satisfy rows only when they still exercise the refactored Phase 68 path or remain otherwise valid; if prior coverage only proved old plumbing, Phase 68 needs a delta test.
- **D-27:** PROOF-02 closes through a verification record if no harness is needed. Do not create a new manually maintained proof artifact format.
- **D-28:** The verification record should note that no harness artifact was generated because normal tests closed the false-pass risk, that normal test evidence is command/file/status metadata only, and that existing `llm-trace.v2` surfaces remain metadata-only for clarification turns.

#### Release Evidence Shape
- **D-29:** Final release-proof evidence belongs in `.planning/phases/68-structured-tool-results-and-release-proof-gate/68-VERIFICATION.md`.
- **D-30:** `68-VERIFICATION.md` must record the PROOF-01 requirement-to-test traceability matrix, PROOF-03 command evidence for `yarn tsc --noEmit` and `yarn release:check`, PROOF-02 no-harness rationale, metadata-only `llm-trace.v2` confirmation, and explicit local-closure scope.
- **D-31:** `yarn release:check` is a final local closure gate after targeted tests pass. It is not a per-plan iteration command and must not be deferred only to a later ship workflow.
- **D-32:** If `yarn release:check` fails, fix the failure and rerun. "Final closure" is a gate position, not a run-exactly-once rule.
- **D-33:** The verification matrix should mark each row as Phase 68 added/changed coverage, relies on still-valid prior coverage, or prior coverage plus Phase 68 delta.
- **D-34:** After local closure evidence is recorded, stop and present the separate ship/promotion workflow as the next step if the user wants promotion.
- **D-35:** Phase 68 local closure must explicitly say no push, merge, deploy, Railway smoke, staging promotion, or main promotion was performed.

### the agent's Discretion
- Exact TypeScript names for the clarification union and discriminants are for plan-phase.
- Exact renderer helper organization and copy normalization are for plan-phase as long as renderer ownership, typed facts, no serialized reparsing, and no second LLM pass remain locked.
- Exact candidate projection type is for plan-phase, with the default constraint that renderer/proof surfaces stay allowlisted and narrow.
- Exact test placement can be calibrated by the planner, but should prefer existing suites unless a new file clearly reduces duplication or fixture complexity.

### Deferred Ideas (OUT OF SCOPE)
None - discussion stayed within Phase 68 scope.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TARGET-03 | `find_meals` and historical tool clarification results are carried as structured tool results through the orchestrator instead of reparsing serialized tool-message JSON. [VERIFIED: .planning/REQUIREMENTS.md] | `runContract()` already exposes `contractResult`, while `ToolExecutionResult` and `executeTool()` are the adapter boundary to extend. [VERIFIED: server/orchestrator/tool-contract.ts:45; VERIFIED: server/orchestrator/tools.ts:91; VERIFIED: server/orchestrator/tools.ts:1995] |
| PROOF-01 | Targeted unit and integration tests cover v2.4 behavior families and structured result plumbing. [VERIFIED: .planning/REQUIREMENTS.md] | Existing suites already cover Phase 65-67 families; Phase 68 needs delta tests for structured facts, terminal historical clarification, route persistence, and source guards. [VERIFIED: tests/unit/tools.test.ts:1280; VERIFIED: tests/unit/orchestrator.test.ts:189; VERIFIED: tests/integration/chat-meal-correction.integration.test.ts:1638] |
| PROOF-02 | Harness or artifact evidence remains metadata-only and excludes raw sensitive payload categories. [VERIFIED: .planning/REQUIREMENTS.md] | Existing artifact tests enforce raw prompt/user/final/tool/provider redaction and `llm-trace.v2` metadata shape. [VERIFIED: tests/unit/verification-artifacts.test.ts:340; VERIFIED: tests/unit/verification-artifacts.test.ts:570] |
| PROOF-03 | Local closure runs `yarn tsc --noEmit` and `yarn release:check`, with no staging or main promotion. [VERIFIED: .planning/REQUIREMENTS.md] | `release:check` runs TypeScript, full tests, and build under `TZ=Asia/Taipei`; AGENTS forbids staging/main promotion without explicit approval. [VERIFIED: scripts/release-check.mjs:91; VERIFIED: scripts/release-check.mjs:130; VERIFIED: AGENTS.md] |
</phase_requirements>

## Summary

Phase 68 should be planned as a narrow backend/orchestrator proof phase, not a new feature phase. [VERIFIED: .planning/ROADMAP.md] The core code seam is `executeTool()`: `runContract()` already preserves structured `contractResult`, and `server/orchestrator/index.ts` already terminates renderer-owned `controlledReply` without a second model pass. [VERIFIED: server/orchestrator/tool-contract.ts:181; VERIFIED: server/orchestrator/tools.ts:2012; VERIFIED: server/orchestrator/index.ts:1067]

The brittle paths are historical clarification results that still become `toolMessage: JSON.stringify(...)` and then continue through the model loop as failed tool summaries instead of terminal renderer replies. [VERIFIED: server/orchestrator/tools.ts:617; VERIFIED: server/orchestrator/tools.ts:1200; VERIFIED: server/orchestrator/tools.ts:1387; VERIFIED: server/orchestrator/tools.ts:2217] `find_meals` is already terminal through `controlledReply`, but Phase 68 should add typed renderer-ready facts for it as part of the same discriminated union so TARGET-03 is not solved only for historical tools. [VERIFIED: server/orchestrator/tools.ts:2127; VERIFIED: .planning/phases/68-structured-tool-results-and-release-proof-gate/68-CONTEXT.md]

**Primary recommendation:** extend `ToolExecutionResult` with one narrow `clarification` discriminated union, render all terminal clarification copy in `mutation-receipts.ts` helpers, map that union to `controlledReply` inside `executeTool()`, then prove JSON/SSE persistence and no-side-effect behavior before writing `68-VERIFICATION.md` and running `yarn release:check`. [VERIFIED: server/orchestrator/tools.ts:91; VERIFIED: server/orchestrator/mutation-receipts.ts:159; VERIFIED: server/routes/chat.ts:227; VERIFIED: .planning/phases/68-structured-tool-results-and-release-proof-gate/68-CONTEXT.md]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Tool contract execution and validation | API / Backend | — | `runContract()` validates JSON/Zod input and returns `contractResult` before adapter mapping. [VERIFIED: server/orchestrator/tool-contract.ts:111] |
| Structured clarification transport | API / Backend | — | `ToolExecutionResult` is the existing orchestrator-facing adapter contract consumed by `index.ts`. [VERIFIED: server/orchestrator/tools.ts:91; VERIFIED: server/orchestrator/index.ts:1037] |
| Terminal clarification rendering | API / Backend | — | Renderer/copy helpers already live in `mutation-receipts.ts`, and CONTEXT forbids adding rendering to `index.ts`. [VERIFIED: server/orchestrator/mutation-receipts.ts:159; VERIFIED: .planning/phases/68-structured-tool-results-and-release-proof-gate/68-CONTEXT.md] |
| JSON/SSE persistence proof | API / Backend | Database / Storage | `finalizeAssistantReply()` saves assistant replies; JSON and SSE routes call it for non-stream terminal replies. [VERIFIED: server/routes/chat.ts:227; VERIFIED: server/routes/chat.ts:1036; VERIFIED: server/routes/chat.ts:1412] |
| `daily_summary` publish suppression | API / Backend | Realtime | `publishSummarySafe()` returns unless `didMutateMeal` and affected summary dates are valid. [VERIFIED: server/routes/chat.ts:388] |
| Release-proof evidence | Static / Repo Docs | API / Backend | CONTEXT locks `68-VERIFICATION.md` as the final evidence record and locks local gates only. [VERIFIED: .planning/phases/68-structured-tool-results-and-release-proof-gate/68-CONTEXT.md] |

## Project Constraints (from AGENTS.md)

- Use `yarn` only; do not introduce `npm` workflow commands. [VERIFIED: AGENTS.md]
- Use Node built-in `node:test`; do not introduce Jest or Vitest. [VERIFIED: AGENTS.md]
- Use real SQLite in tests; `:memory:` is acceptable, mocked DBs are not. [VERIFIED: AGENTS.md]
- Preserve ESM imports with explicit `.js` specifiers for local TypeScript imports. [VERIFIED: AGENTS.md]
- Keep `server/orchestrator/*` responsible for model workflow, tool definitions, tool execution, prompt construction, and fallback behavior. [VERIFIED: AGENTS.md]
- Keep `server/routes/*.ts` responsible for HTTP/SSE transport boundaries, stream framing, response shaping, and auth checks. [VERIFIED: AGENTS.md]
- Keep `server/services/*.ts` responsible for reusable domain and persistence logic; do not instantiate LLM clients inside services. [VERIFIED: AGENTS.md]
- Preserve `TZ=Asia/Taipei` in local and test setups because day boundaries depend on it. [VERIFIED: AGENTS.md]
- Any `*.ts` edit requires `yarn tsc --noEmit`; route/service edits require `yarn test:integration`; final promotion readiness uses `yarn release:check`. [VERIFIED: AGENTS.md]
- Do not push, merge, deploy, smoke-test, or promote `staging`/`main` inside Phase 68 without explicit current-thread approval. [VERIFIED: AGENTS.md; VERIFIED: .planning/phases/68-structured-tool-results-and-release-proof-gate/68-CONTEXT.md]

## Standard Stack

### Core

| Library / Tool | Version | Purpose | Why Standard |
|----------------|---------|---------|--------------|
| TypeScript | `^5.7.0` | Static type boundary for `ToolExecutionResult` and discriminated unions. [VERIFIED: package.json] | Existing repo is TypeScript ESM and all touched backend/test files are `.ts`. [VERIFIED: package.json; VERIFIED: AGENTS.md] |
| Node.js | `v24.14.0` installed | Runtime for `node:test`, route tests, and release scripts. [VERIFIED: node --version; VERIFIED: package.json] | Existing scripts run Node directly through `scripts/run-node-with-tz.mjs`. [VERIFIED: package.json] |
| Fastify | `^5.2.0` | JSON/SSE route execution via `buildApp()` and `/api/chat`. [VERIFIED: package.json; VERIFIED: server/routes/chat.ts:1184] | Existing integration tests use the real app/transport boundary. [VERIFIED: tests/integration/chat-api.test.ts:10] |
| better-sqlite3 | `^11.8.0` | Real SQLite-backed tests and services. [VERIFIED: package.json] | AGENTS requires real SQLite instead of mocked DBs. [VERIFIED: AGENTS.md] |
| Zod | `^4.3.6` | Runtime tool argument validation in `tool-contract.ts` and `tools.ts`. [VERIFIED: package.json; VERIFIED: server/orchestrator/tool-contract.ts:133] | Existing tool contracts use Zod `safeParse` before execution. [VERIFIED: server/orchestrator/tool-contract.ts:133] |

### Supporting

| Library / Tool | Version | Purpose | When to Use |
|----------------|---------|---------|-------------|
| `tsx` | `^4.19.0` | Run TypeScript tests and scripts without separate build. [VERIFIED: package.json] | Use existing `node scripts/run-node-with-tz.mjs --import tsx --test ...` targeted commands. [VERIFIED: package.json] |
| `yarn release:check` | repo script | Final local closure gate. [VERIFIED: package.json; VERIFIED: scripts/release-check.mjs:130] | Run after targeted tests and `yarn tsc --noEmit` are green; record metadata in `68-VERIFICATION.md`. [VERIFIED: .planning/phases/68-structured-tool-results-and-release-proof-gate/68-CONTEXT.md] |
| `nutrition-gen-test` skill | project-local | Repo-native test planning rules. [VERIFIED: .codex/skills/nutrition-gen-test/SKILL.md] | Use for unit/integration test tasks; avoid Jest/Vitest and mocked DBs. [VERIFIED: .codex/skills/nutrition-gen-test/SKILL.md] |
| `nutrition-verify-change` skill | project-local | Path-triggered verification selection. [VERIFIED: .codex/skills/nutrition-verify-change/SKILL.md] | Use after implementation to choose targeted gates and final release gate. [VERIFIED: .codex/skills/nutrition-verify-change/SKILL.md] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Extend `ToolExecutionResult` | Pass raw `contractResult` into `index.ts` | Rejected by locked decision D-01; it would widen orchestrator responsibility. [VERIFIED: .planning/phases/68-structured-tool-results-and-release-proof-gate/68-CONTEXT.md] |
| Renderer helpers in `mutation-receipts.ts` | Inline copy construction in `index.ts` | Rejected by D-07; existing renderer helper precedent keeps copy out of the tool loop. [VERIFIED: .planning/phases/68-structured-tool-results-and-release-proof-gate/68-CONTEXT.md; VERIFIED: server/orchestrator/mutation-receipts.ts:159] |
| Harness scenario by default | Unit/integration proof | Rejected as default by D-19 unless a false-pass risk remains after normal tests. [VERIFIED: .planning/phases/68-structured-tool-results-and-release-proof-gate/68-CONTEXT.md] |

**Installation:** No new packages should be installed for Phase 68. [VERIFIED: .planning/phases/68-structured-tool-results-and-release-proof-gate/68-CONTEXT.md; VERIFIED: package.json]

## Package Legitimacy Audit

No external package installation is recommended, so the package legitimacy gate is not applicable. [VERIFIED: .planning/phases/68-structured-tool-results-and-release-proof-gate/68-CONTEXT.md]  
**Packages removed due to slopcheck [SLOP] verdict:** none. [VERIFIED: no recommended external packages]  
**Packages flagged as suspicious [SUS]:** none. [VERIFIED: no recommended external packages]

## Architecture Patterns

### System Architecture Diagram

```text
LLM tool call
  -> runContract()
     -> JSON parse + Zod validation
     -> contract execute returns contractResult
  -> executeTool() adapter
     -> maps success/mutation facts
     -> maps clarification facts to ToolExecutionResult.clarification + controlledReply
  -> orchestrator index.ts
     -> controlledReply? terminal renderer reply, no second model call
     -> otherwise continue tool loop or mutation receipt path
  -> route layer
     -> finalizeAssistantReply() persists assistant text
     -> JSON reply or SSE chunk/done payload
     -> publishSummarySafe() only if didMutateMeal + date match
```

This flow matches the existing `runContract()` to `executeTool()` to `controlledReply` route; Phase 68 should change the facts crossing the adapter, not the route architecture. [VERIFIED: server/orchestrator/tool-contract.ts:111; VERIFIED: server/orchestrator/tools.ts:1995; VERIFIED: server/orchestrator/index.ts:1067; VERIFIED: server/routes/chat.ts:227]

### Recommended Project Structure

```text
server/
├── orchestrator/
│   ├── tools.ts              # ToolExecutionResult union, executeTool adapter mapping
│   ├── mutation-receipts.ts  # renderer-owned clarification copy helpers
│   └── index.ts              # consume controlledReply only; no rendering/parsing
├── lib/
│   └── historical-date.ts    # prompt/reason/dateKeys source facts
└── routes/
    └── chat.ts               # JSON/SSE persistence and publish suppression
tests/
├── unit/
│   ├── tools.test.ts
│   ├── orchestrator.test.ts
│   └── verification-artifacts.test.ts
└── integration/
    ├── chat-api.test.ts
    ├── chat-streaming.test.ts
    └── chat-meal-correction.integration.test.ts
```

The file map above is derived from current imports, route ownership, and CONTEXT proof surface guidance. [VERIFIED: .planning/phases/68-structured-tool-results-and-release-proof-gate/68-CONTEXT.md; VERIFIED: server/orchestrator/tools.ts:1; VERIFIED: server/routes/chat.ts:1184]

### Pattern 1: Adapter-Owned Structured Facts

**What:** Keep contract-specific results inside `executeTool()` and expose only narrow `ToolExecutionResult` facts to `index.ts`. [VERIFIED: .planning/phases/68-structured-tool-results-and-release-proof-gate/68-CONTEXT.md; VERIFIED: server/orchestrator/tools.ts:91]  
**When to use:** Use this for `find_meals`, historical `log_food`, and historical `get_daily_summary` clarification states. [VERIFIED: .planning/phases/68-structured-tool-results-and-release-proof-gate/68-CONTEXT.md]

```typescript
// Source: server/orchestrator/tools.ts current adapter shape.
if (toolCall.function.name === "find_meals") {
  const contractResult = outcome.contractResult as FindMealsResult;
  if (contractResult.status !== "resolved") {
    const reply = renderFindMealsControlledReply(contractResult);
    return {
      result: reply,
      summary: `status: ${contractResult.status}`,
      success: false,
      executed: false,
      failureReason: "guard",
      controlledReply: { source: "renderer", reason: "meal_target_clarification", text: reply },
    };
  }
}
```

### Pattern 2: Renderer-Owned Terminal Reply

**What:** Terminal clarification should use renderer helpers and return before any second LLM pass. [VERIFIED: server/orchestrator/index.ts:1067; VERIFIED: server/orchestrator/mutation-receipts.ts:159]  
**When to use:** Use this whenever backend date or target resolution determines the tool should not mutate or aggregate. [VERIFIED: .planning/phases/68-structured-tool-results-and-release-proof-gate/68-CONTEXT.md]

```typescript
// Source: server/orchestrator/index.ts controlledReply terminal path.
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

### Pattern 3: Route Persistence as Proof Boundary

**What:** Controlled replies returned from the orchestrator are persisted only in the route, so JSON/SSE tests must assert visible reply and later history. [VERIFIED: server/routes/chat.ts:227; VERIFIED: server/routes/chat.ts:1036; VERIFIED: server/routes/chat.ts:1412]  
**When to use:** Use for D-18b proof that terminal clarification replies are available to follow-up turns. [VERIFIED: .planning/phases/68-structured-tool-results-and-release-proof-gate/68-CONTEXT.md]

```typescript
// Source: server/routes/chat.ts persistence primitive.
const sanitized = sanitizeReply(rawReply);
const assistantMessage = await chatService.saveMessage(deviceId, "assistant", sanitized, opts?.status ? { status: opts.status } : undefined);
return { sanitized, assistantMessageId: assistantMessage.id };
```

### Anti-Patterns to Avoid

- **Raw `contractResult` in `index.ts`:** violates D-01 and spreads contract-specific branching into the orchestrator loop. [VERIFIED: .planning/phases/68-structured-tool-results-and-release-proof-gate/68-CONTEXT.md]
- **Serialized clarification JSON as behavior source:** `buildHistoricalToolMessage()` currently stringifies historical clarification facts; Phase 68 should not make terminal behavior depend on reparsing that string. [VERIFIED: server/orchestrator/tools.ts:617]
- **LLM rewrite for clarification:** the queued follow-up model response must remain unconsumed for terminal clarification cases. [VERIFIED: tests/unit/orchestrator.test.ts:1206; VERIFIED: .planning/phases/68-structured-tool-results-and-release-proof-gate/68-CONTEXT.md]
- **Full service candidates in renderer/proof surface:** D-05 requires an allowlisted projection, not full `MealCorrectionCandidate`. [VERIFIED: .planning/phases/68-structured-tool-results-and-release-proof-gate/68-CONTEXT.md]
- **Release gate as promotion:** `yarn release:check` is local closure evidence only and does not authorize staging/main work. [VERIFIED: AGENTS.md; VERIFIED: .planning/STATE.md]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Tool argument validation | Custom JSON/schema parser | Existing `runContract()` with Zod schemas. [VERIFIED: server/orchestrator/tool-contract.ts:111] | Current contracts already parse JSON, run Zod, and return controlled validation failures. [VERIFIED: server/orchestrator/tool-contract.ts:116] |
| Final reply ownership | LLM paraphrase or ad hoc route copy | `controlledReply` plus renderer helper. [VERIFIED: server/orchestrator/index.ts:1067] | Existing path stops the loop and records `finalReplySource: "renderer"`. [VERIFIED: server/orchestrator/index.ts:1079] |
| Historical date parsing | New date parser | `resolveHistoricalDateIntent()`. [VERIFIED: server/lib/historical-date.ts:306] | It already returns `needs_clarification`, `resolved_many`, and resolved/carry-forward statuses. [VERIFIED: server/lib/historical-date.ts:20] |
| SSE/JSON persistence | Parallel persistence path | `finalizeAssistantReply()`. [VERIFIED: server/routes/chat.ts:227] | Existing route code centralizes sanitization and assistant-message save. [VERIFIED: server/routes/chat.ts:234] |
| Proof artifact format | New manual proof JSON | `68-VERIFICATION.md` plus existing test metadata. [VERIFIED: .planning/phases/68-structured-tool-results-and-release-proof-gate/68-CONTEXT.md] | D-27 rejects a new manually maintained proof artifact format. [VERIFIED: .planning/phases/68-structured-tool-results-and-release-proof-gate/68-CONTEXT.md] |

**Key insight:** this phase is mostly about moving already-computed backend facts across a typed boundary and proving they stay terminal; building a new renderer, parser, or harness by default would increase false-pass risk. [VERIFIED: server/orchestrator/tool-contract.ts:181; VERIFIED: server/orchestrator/tools.ts:2217; VERIFIED: .planning/phases/68-structured-tool-results-and-release-proof-gate/68-CONTEXT.md]

## Common Pitfalls

### Pitfall 1: Historical Clarification Still Continues Through the Model
**What goes wrong:** `log_food` or `get_daily_summary` clarification returns `success:false` without `controlledReply`, so `index.ts` saves a tool summary and continues to another model round. [VERIFIED: server/orchestrator/tools.ts:2107; VERIFIED: server/orchestrator/tools.ts:2219; VERIFIED: server/orchestrator/index.ts:1086]  
**Why it happens:** current historical branches return JSON tool messages but no terminal controlled reply. [VERIFIED: server/orchestrator/tools.ts:617; VERIFIED: server/orchestrator/tools.ts:1209; VERIFIED: server/orchestrator/tools.ts:1396]  
**How to avoid:** adapter-map historical clarification facts to typed clarification plus `controlledReply` in `executeTool()`. [VERIFIED: .planning/phases/68-structured-tool-results-and-release-proof-gate/68-CONTEXT.md]  
**Warning signs:** a test needs `JSON.parse(result.result)` for clarification or `mockLLM.chatCalls.length > 1` after a clarification. [VERIFIED: tests/unit/tools.test.ts:2071; VERIFIED: tests/unit/orchestrator.test.ts:1226]

### Pitfall 2: `multiple_targets` Copy Seeds Carry-Forward
**What goes wrong:** the assistant asks about multiple dates in a form that `extractPreviousHistoricalDateKey()` can parse as one explicit historical date. [VERIFIED: server/orchestrator/tools.ts:631; VERIFIED: .planning/phases/68-structured-tool-results-and-release-proof-gate/68-CONTEXT.md]  
**Why it happens:** carry-forward parses the previous assistant message with `resolveHistoricalDateIntent(..., mode: "mutation")` and accepts one explicit historical date only. [VERIFIED: server/orchestrator/tools.ts:639; VERIFIED: server/orchestrator/tools.ts:644]  
**How to avoid:** render `multiple_targets` as a narrow-to-one-date prompt that lists choices but does not look like a single resolved prior date; add a unit test around the helper or behavior. [VERIFIED: .planning/phases/68-structured-tool-results-and-release-proof-gate/68-CONTEXT.md]  
**Warning signs:** a follow-up such as "再加一杯豆漿" resolves to one listed date after a multi-date summary clarification. [VERIFIED: server/lib/historical-date.ts:362]

### Pitfall 3: Route Tests Assert Payload But Not Persistence
**What goes wrong:** JSON/SSE replies look correct, but `finalizeAssistantReply()` is bypassed and follow-up context loses the assistant clarification. [VERIFIED: server/routes/chat.ts:227; VERIFIED: .planning/phases/68-structured-tool-results-and-release-proof-gate/68-CONTEXT.md]  
**Why it happens:** controlled replies exit `index.ts` before assistant-message persistence, so only routes save them. [VERIFIED: server/orchestrator/index.ts:1078; VERIFIED: server/routes/chat.ts:1412]  
**How to avoid:** integration tests should query `/api/chat/history` after terminal JSON/SSE clarification and assert the assistant clarification persisted. [VERIFIED: tests/integration/chat-streaming.test.ts:2122]  
**Warning signs:** tests only assert HTTP `reply` or SSE `chunk` and never inspect history. [VERIFIED: tests/integration/chat-api.test.ts:1586; VERIFIED: tests/integration/chat-streaming.test.ts:1372]

### Pitfall 4: No-Side-Effect Proof Is Incomplete
**What goes wrong:** terminal clarification has correct copy but still includes `summaryOutcome`, `loggedMeal`, mutation flags, or publishes `daily_summary`. [VERIFIED: .planning/phases/68-structured-tool-results-and-release-proof-gate/68-CONTEXT.md]  
**Why it happens:** route publish is downstream of orchestrator flags, and response fields are assembled separately for JSON/SSE. [VERIFIED: server/routes/chat.ts:388; VERIFIED: server/routes/chat.ts:984; VERIFIED: server/routes/chat.ts:1442]  
**How to avoid:** assert no `loggedMeal`, no `dailySummary`, no `summaryOutcome`, `didLogMeal:false`, `didMutateMeal:false`, and empty publish calls. [VERIFIED: tests/integration/chat-meal-correction.integration.test.ts:1675]  
**Warning signs:** a terminal clarification test omits publisher instrumentation or response-field absence checks. [VERIFIED: tests/integration/chat-meal-correction.integration.test.ts:1679]

## Code Examples

### Typed Historical Clarification Mapping Target

```typescript
// Source pattern: server/orchestrator/tools.ts current historical branches.
if (summary.status === "needs_clarification") {
  return {
    result: outcome.result,
    summary: "status: needs_clarification",
    success: false,
    executed: false,
    failureReason: "guard",
  };
}
```

Planner should turn the above shape into the same terminal controlled pattern used by `find_meals`, with typed clarification facts retained on `ToolExecutionResult`. [VERIFIED: server/orchestrator/tools.ts:2219; VERIFIED: server/orchestrator/tools.ts:2127]

### Source Guard Style

```typescript
// Source: tests/unit/orchestrator.test.ts source-scan idiom.
const source = readFileSync(new URL("../../server/orchestrator/index.ts", import.meta.url), "utf8");
assert.doesNotMatch(source, /parseCorrectionToolResult/);
```

Phase 68 should extend this idiom to guard against serialized clarification-result reparsing paths, while allowing legitimate JSON parsing of LLM tool-call arguments and test SSE payloads. [VERIFIED: tests/unit/orchestrator.test.ts:189; VERIFIED: server/orchestrator/tool-contract.ts:116]

### Metadata-Only Trace Proof

```typescript
// Source: tests/unit/verification-artifacts.test.ts forbidden raw trace keys.
assert.doesNotMatch(
  raw,
  /apiKey|api_key|OPENAI_API_KEY|cookie|set-cookie|guestSession|sessionToken|bearer|messages|rawMessages|rawPrompt|promptText|providerPayload|rawProviderPayload|arguments|rawArguments|toolArguments|toolResult|rawToolResult|finalAnswer|assistantContent|finalAssistantContent/,
);
```

Use existing metadata-only artifact tests and record in `68-VERIFICATION.md` that normal test evidence is command/file/status metadata unless a new harness is justified. [VERIFIED: tests/unit/verification-artifacts.test.ts:610; VERIFIED: .planning/phases/68-structured-tool-results-and-release-proof-gate/68-CONTEXT.md]

## State of the Art

| Old Approach | Current / Target Approach | When Changed | Impact |
|--------------|---------------------------|--------------|--------|
| Orchestrator reparsed serialized `find_meals` result and built correction clarification copy. | `find_meals` non-resolved results now return renderer-owned `controlledReply`; Phase 68 should add typed clarification facts. [VERIFIED: .planning/STATE.md; VERIFIED: server/orchestrator/tools.ts:2127] | Phase 67 [VERIFIED: .planning/STATE.md] | Planner should preserve Phase 67 behavior while broadening structured facts. [VERIFIED: .planning/phases/68-structured-tool-results-and-release-proof-gate/68-CONTEXT.md] |
| Historical `log_food` clarification returns JSON tool message and continues. | Target is terminal renderer-owned clarification from prompt/reason facts. [VERIFIED: server/orchestrator/tools.ts:1200; VERIFIED: .planning/phases/68-structured-tool-results-and-release-proof-gate/68-CONTEXT.md] | Phase 68 target [VERIFIED: .planning/REQUIREMENTS.md] | Prevents mutation and second LLM pass on unresolved historical mutation. [VERIFIED: .planning/phases/68-structured-tool-results-and-release-proof-gate/68-CONTEXT.md] |
| Historical `get_daily_summary` `multiple_targets` returns JSON `{status,dateKeys}`. | Target is terminal renderer-owned narrow-to-one-date prompt from typed `dateKeys`. [VERIFIED: server/orchestrator/tools.ts:1399; VERIFIED: .planning/phases/68-structured-tool-results-and-release-proof-gate/68-CONTEXT.md] | Phase 68 target [VERIFIED: .planning/REQUIREMENTS.md] | Avoids accidental multi-date aggregation and carry-forward poisoning. [VERIFIED: .planning/phases/68-structured-tool-results-and-release-proof-gate/68-CONTEXT.md] |
| Release proof left to later ship workflow. | Phase 68 owns local `yarn tsc --noEmit` and `yarn release:check` evidence without promotion. [VERIFIED: .planning/phases/68-structured-tool-results-and-release-proof-gate/68-CONTEXT.md] | Phase 68 target [VERIFIED: .planning/ROADMAP.md] | Closes v2.4 locally while preserving promotion boundary. [VERIFIED: AGENTS.md] |

**Deprecated/outdated:** serialized clarification-result reparsing for behavior is deprecated for Phase 68 scope; JSON parsing remains valid for raw tool-call arguments, SSE frames, and artifact/test payload parsing. [VERIFIED: .planning/REQUIREMENTS.md; VERIFIED: server/orchestrator/tool-contract.ts:116; VERIFIED: tests/integration/chat-streaming.test.ts:1413]

## Assumptions Log

All claims in this research were verified against local project artifacts, code, or command output; no `[ASSUMED]` claims are used. [VERIFIED: local research session]

## Open Questions (RESOLVED)

All items below are resolved for Phase 68 planning.

1. **Should candidate projection include meal id/revision internally?**  
   **RESOLVED:** Candidate ids/revisions stay out of renderer and proof surfaces by default; executors may use internal service state only where existing code paths already require it.  
   What we know: renderer/proof surfaces should default to option number, date/time, label, and explicit meal-period facts, while meal id/revision should not become visible by default. [VERIFIED: .planning/phases/68-structured-tool-results-and-release-proof-gate/68-CONTEXT.md]  
   Resolved planning note: plan-phase may decide whether internal ids are useful for adapter tests or only service state. [VERIFIED: .planning/phases/68-structured-tool-results-and-release-proof-gate/68-CONTEXT.md]  
   Recommendation: keep ids out of copy and proof assertions; include them only if needed for internal typed state. [VERIFIED: .planning/phases/68-structured-tool-results-and-release-proof-gate/68-CONTEXT.md]

2. **Is any deterministic harness needed?**  
   **RESOLVED:** No deterministic harness is planned unless execution identifies a named normal-test false-pass risk that targeted unit/integration tests cannot close.  
   What we know: D-19 says default proof is unit plus integration. [VERIFIED: .planning/phases/68-structured-tool-results-and-release-proof-gate/68-CONTEXT.md]  
   Resolved planning note: a harness may be justified only if JSON/SSE persistence plus metadata-only trace cannot be proven by existing integration tests. [VERIFIED: .planning/phases/68-structured-tool-results-and-release-proof-gate/68-CONTEXT.md]  
   Recommendation: plan no harness by default; add one only after a concrete false-pass risk is identified. [VERIFIED: .planning/phases/68-structured-tool-results-and-release-proof-gate/68-CONTEXT.md]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | TypeScript tests and release scripts | yes [VERIFIED: node --version] | `v24.14.0` [VERIFIED: node --version] | none required |
| Yarn | Project scripts | yes [VERIFIED: yarn --version] | `1.22.22` [VERIFIED: yarn --version] | none; AGENTS says use yarn only. [VERIFIED: AGENTS.md] |
| GSD SDK | Phase init/commit workflow | yes [VERIFIED: command -v gsd-sdk] | installed at `/Users/jia/.local/bin/gsd-sdk` [VERIFIED: command -v gsd-sdk] | none required |
| Context7 CLI | External library docs | no [VERIFIED: command -v ctx7] | — | Not needed because Phase 68 is codebase-internal and installs no new package. [VERIFIED: .planning/phases/68-structured-tool-results-and-release-proof-gate/68-CONTEXT.md] |
| slopcheck | Package legitimacy gate | no [VERIFIED: command -v slopcheck] | — | Not needed because no new package is recommended. [VERIFIED: no recommended external packages] |

**Missing dependencies with no fallback:** none for this research/planning phase. [VERIFIED: environment probes]  
**Missing dependencies with fallback:** Context7 and slopcheck are absent, but no external library or package install research is required. [VERIFIED: environment probes; VERIFIED: no recommended external packages]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Node built-in `node:test` through repo scripts. [VERIFIED: AGENTS.md; VERIFIED: package.json] |
| Config file | no standalone test config; scripts pass `--import tsx --test`. [VERIFIED: package.json] |
| Quick run command | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/tools.test.ts tests/unit/orchestrator.test.ts` [VERIFIED: package.json; VERIFIED: .planning/phases/68-structured-tool-results-and-release-proof-gate/68-CONTEXT.md] |
| Full suite command | `yarn test`; closure gate `yarn release:check`. [VERIFIED: package.json; VERIFIED: scripts/release-check.mjs:130] |

### Phase Requirements -> Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| TARGET-03 | `executeTool()` exposes typed clarification facts for `find_meals`, historical `log_food`, and historical `get_daily_summary`. [VERIFIED: .planning/REQUIREMENTS.md] | unit | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/tools.test.ts` | yes; extend existing file. [VERIFIED: tests/unit/tools.test.ts:1280] |
| TARGET-03 | Orchestrator terminal replies are renderer-owned and do not consume queued second LLM response. [VERIFIED: .planning/phases/68-structured-tool-results-and-release-proof-gate/68-CONTEXT.md] | unit | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/orchestrator.test.ts` | yes; extend existing file. [VERIFIED: tests/unit/orchestrator.test.ts:1206] |
| TARGET-03 | Source guard blocks serialized clarification-result reparsing in `index.ts`. [VERIFIED: .planning/phases/68-structured-tool-results-and-release-proof-gate/68-CONTEXT.md] | unit/source scan | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/orchestrator.test.ts` | yes; extend existing source-scan idiom. [VERIFIED: tests/unit/orchestrator.test.ts:189] |
| PROOF-01 | Route-visible JSON/SSE terminal clarification has no mutation, no summary, no publish, and persists assistant reply. [VERIFIED: .planning/REQUIREMENTS.md] | integration | `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/chat-api.test.ts tests/integration/chat-streaming.test.ts tests/integration/chat-meal-correction.integration.test.ts` | yes. [VERIFIED: tests/integration/chat-api.test.ts:1586; VERIFIED: tests/integration/chat-streaming.test.ts:1372; VERIFIED: tests/integration/chat-meal-correction.integration.test.ts:1638] |
| PROOF-01 | Carry-forward v2.4 behavior families remain covered after refactor. [VERIFIED: .planning/phases/68-structured-tool-results-and-release-proof-gate/68-CONTEXT.md] | unit/integration traceability | `yarn test:unit && yarn test:integration` | yes; use existing Phase 65-67 tests and record rows in `68-VERIFICATION.md`. [VERIFIED: .planning/STATE.md] |
| PROOF-02 | Metadata-only proof and `llm-trace.v2` surfaces remain raw-payload-free. [VERIFIED: .planning/REQUIREMENTS.md] | unit | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/verification-artifacts.test.ts` | yes. [VERIFIED: tests/unit/verification-artifacts.test.ts:340] |
| PROOF-03 | Local closure gates pass with no promotion. [VERIFIED: .planning/REQUIREMENTS.md] | command gate | `yarn tsc --noEmit && yarn release:check` | yes. [VERIFIED: package.json; VERIFIED: scripts/release-check.mjs:130] |

### Sampling Rate

- **Per task commit:** run the narrow unit/integration command matching touched files plus `yarn tsc --noEmit` for TypeScript edits. [VERIFIED: AGENTS.md; VERIFIED: .codex/skills/nutrition-verify-change/SKILL.md]
- **Per wave merge:** run targeted Phase 68 unit/integration tests that cover the changed seam. [VERIFIED: .planning/phases/68-structured-tool-results-and-release-proof-gate/68-CONTEXT.md]
- **Phase gate:** run `yarn tsc --noEmit` and `yarn release:check`, then record command/status metadata only in `68-VERIFICATION.md`. [VERIFIED: .planning/phases/68-structured-tool-results-and-release-proof-gate/68-CONTEXT.md]

### Wave 0 Gaps

- [ ] Extend `tests/unit/tools.test.ts` for typed clarification facts on `find_meals`, historical `log_food`, and historical `get_daily_summary`. [VERIFIED: tests/unit/tools.test.ts:2046; VERIFIED: .planning/phases/68-structured-tool-results-and-release-proof-gate/68-CONTEXT.md]
- [ ] Extend `tests/unit/orchestrator.test.ts` for historical terminal renderer ownership, no second LLM pass, and source scan against serialized clarification-result reparsing. [VERIFIED: tests/unit/orchestrator.test.ts:1206; VERIFIED: tests/unit/orchestrator.test.ts:189]
- [ ] Extend `tests/integration/chat-api.test.ts` and `tests/integration/chat-streaming.test.ts` only for JSON/SSE historical clarification paths affected by the refactor. [VERIFIED: .planning/phases/68-structured-tool-results-and-release-proof-gate/68-CONTEXT.md]
- [ ] Create `68-VERIFICATION.md` after implementation to hold PROOF-01/02/03 traceability and local closure evidence. [VERIFIED: .planning/phases/68-structured-tool-results-and-release-proof-gate/68-CONTEXT.md]

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no direct auth change | Existing protected browser routes derive ownership from signed guest sessions. [VERIFIED: AGENTS.md] |
| V3 Session Management | no direct session change | Do not change cookie-backed `/api/sse` behavior. [VERIFIED: AGENTS.md] |
| V4 Access Control | yes, indirectly | Keep device-scoped service calls and do not widen raw `deviceId` authority. [VERIFIED: AGENTS.md; VERIFIED: server/orchestrator/tools.ts:1328] |
| V5 Input Validation | yes | Keep Zod validation inside `runContract()` and existing tool schemas. [VERIFIED: server/orchestrator/tool-contract.ts:133; VERIFIED: server/orchestrator/tools.ts:435] |
| V6 Cryptography | no new crypto | No crypto or secret handling change is planned. [VERIFIED: .planning/phases/68-structured-tool-results-and-release-proof-gate/68-CONTEXT.md] |
| V8 Data Protection / Privacy | yes | Proof artifacts and traces must remain metadata-only. [VERIFIED: .planning/REQUIREMENTS.md; VERIFIED: tests/unit/verification-artifacts.test.ts:340] |

### Known Threat Patterns for This Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| LLM tool-call tampering | Tampering | Validate through Zod and backend service logic before any side effect. [VERIFIED: server/orchestrator/tool-contract.ts:133] |
| Clarification transformed into success copy | Spoofing / Tampering | Use renderer-owned terminal `controlledReply` and assert `finalReplySource === "renderer"`. [VERIFIED: server/orchestrator/index.ts:1067; VERIFIED: tests/unit/orchestrator.test.ts:1229] |
| Raw prompt/tool/provider evidence leakage | Information disclosure | Keep `llm-trace.v2` and artifacts metadata-only; source/test deny lists already exist. [VERIFIED: tests/unit/verification-artifacts.test.ts:610] |
| Accidental historical mutation on ambiguous date | Tampering | Terminal clarification must set `didLogMeal:false`, `didMutateMeal:false`, no logged meal, no summary outcome, and no publish. [VERIFIED: .planning/phases/68-structured-tool-results-and-release-proof-gate/68-CONTEXT.md; VERIFIED: server/routes/chat.ts:388] |

## Sources

### Primary (HIGH confidence)

- `.planning/phases/68-structured-tool-results-and-release-proof-gate/68-CONTEXT.md` - locked Phase 68 decisions, proof strategy, and release evidence shape. [VERIFIED: local file]
- `.planning/REQUIREMENTS.md` - TARGET-03 and PROOF-01 through PROOF-03 definitions. [VERIFIED: local file]
- `.planning/ROADMAP.md` - Phase 68 goal, dependency, and success criteria. [VERIFIED: local file]
- `.planning/STATE.md` and `.planning/PROJECT.md` - accumulated v2.4 decisions, metadata-only privacy boundary, and release scope history. [VERIFIED: local file]
- `AGENTS.md` and `docs/codex.md` - project workflow, testing, skills, and promotion constraints. [VERIFIED: local file]
- `server/orchestrator/tools.ts`, `server/orchestrator/tool-contract.ts`, `server/orchestrator/index.ts`, `server/orchestrator/mutation-receipts.ts`, `server/lib/historical-date.ts`, `server/routes/chat.ts` - implementation seams and current brittle paths. [VERIFIED: codebase grep]
- `tests/unit/tools.test.ts`, `tests/unit/orchestrator.test.ts`, `tests/unit/verification-artifacts.test.ts`, `tests/integration/chat-api.test.ts`, `tests/integration/chat-streaming.test.ts`, `tests/integration/chat-meal-correction.integration.test.ts` - existing proof surfaces. [VERIFIED: codebase grep]

### Secondary (MEDIUM confidence)

- Project-local skills `nutrition-gen-test`, `nutrition-verify-change`, `nutrition-new-harness-scenario`, `nutrition-harness-review`, `nutrition-security-review`, and `nutrition-code-review` - planning guidance for downstream execution/review tasks. [VERIFIED: .codex/skills/*/SKILL.md]

### Tertiary (LOW confidence)

- None. [VERIFIED: local research session]

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH - versions and commands are from `package.json`, `node --version`, and `yarn --version`. [VERIFIED: package.json; VERIFIED: environment probes]
- Architecture: HIGH - code paths were traced through `runContract()`, `executeTool()`, `controlledReply`, `finalizeAssistantReply()`, and route publish gates. [VERIFIED: server/orchestrator/tool-contract.ts:111; VERIFIED: server/orchestrator/tools.ts:1995; VERIFIED: server/orchestrator/index.ts:1067; VERIFIED: server/routes/chat.ts:227]
- Pitfalls: HIGH - each pitfall maps to a current code branch, locked decision, or existing test idiom. [VERIFIED: server/orchestrator/tools.ts:2217; VERIFIED: tests/unit/orchestrator.test.ts:189; VERIFIED: .planning/phases/68-structured-tool-results-and-release-proof-gate/68-CONTEXT.md]
- Exact TypeScript naming: MEDIUM - CONTEXT explicitly leaves names/discriminants to plan-phase. [VERIFIED: .planning/phases/68-structured-tool-results-and-release-proof-gate/68-CONTEXT.md]

**Research date:** 2026-05-29  
**Valid until:** 2026-06-05 because this phase targets fast-moving local code and pending v2.4 planning state. [VERIFIED: .planning/STATE.md]
