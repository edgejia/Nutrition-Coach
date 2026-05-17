---
phase: 60-goal-proposal-authority-and-rejected-goal-copy
verified: 2026-05-17T00:50:50Z
status: passed
score: 16/16 must-haves verified
overrides_applied: 0
---

# Phase 60: Goal Proposal Authority and Rejected-Goal Copy Verification Report

**Phase Goal:** Users can only change daily targets through explicit current-turn numeric values or a valid backend-persisted goal proposal, and rejected goal updates produce deterministic backend copy.
**Verified:** 2026-05-17T00:50:50Z
**Status:** passed
**Re-verification:** No - initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | User can ask for a goal-change recommendation and receive a concrete proposal without daily targets changing yet. | VERIFIED | `propose_goals` is registered as a separate tool, persists pending state with `goalProposalService.putLatest`, returns `renderGoalProposalCopy`, and does not call `deviceService.updateGoals` or `publishGoalsUpdate` in `server/orchestrator/tools.ts:1362-1395`. Integration test covers no `dailyTargets` and no publish at `tests/integration/chat-goal-update.integration.test.ts:171-187`. |
| 2 | User confirmation text such as `好` changes goals only when it confirms a valid unexpired backend proposal or includes explicit current-turn numeric target values. | VERIFIED | `update_goals` requires explicit `mode` via discriminated schema at `server/orchestrator/tools.ts:426-448`; `latest_proposal` requires active `goalProposalService.getLatest` plus `isGoalProposalConsent` at `server/orchestrator/tools.ts:1454-1462`; current-turn numbers are source-checked against current user text only at `server/orchestrator/tools.ts:1434-1448`. Tests cover previous-assistant rejection and active proposal application at `tests/unit/update-goals-contract.test.ts:187-276`. |
| 3 | User cannot apply expired, consumed, mismatched, or missing proposals; backend returns deterministic Traditional Chinese guidance and leaves targets unchanged. | VERIFIED | Proposal state is one active expiring `turn_states` entry with TTL in `server/services/goal-proposals.ts:5-40`; expiry/clear are tested in `tests/unit/goal-proposals.test.ts:107-133`. Missing/replayed proposal confirmations return `renderGoalAuthorityFailureCopy` without `dailyTargets` or publish in integration tests at `tests/integration/chat-goal-update.integration.test.ts:229-265`. Phase chose single-active `latest_proposal` mode rather than hidden ids per D-17, so mismatch/replaced states collapse to unavailable latest proposal behavior. |
| 4 | Failed `update_goals` validation or guard outcomes do not publish `goals_update`, do not persist targets, and do not show LLM-authored success-style copy. | VERIFIED | Validation/guard failures adapt to renderer-owned controlled replies at `server/orchestrator/tools.ts:1636-1657`; orchestrator returns controlled replies before later model messages at `server/orchestrator/index.ts:930-947`. Tests cover validation, empty args, no mode, no success prose, and no second LLM call at `tests/integration/chat-goal-update.integration.test.ts:377-449`. |
| 5 | Backend can persist exactly one active pending goal proposal per device without changing daily targets. | VERIFIED | `createGoalProposalService` wraps `createTurnStateService` and `GOAL_PROPOSAL_KIND`; overwrite proof checks one row for `(device_id, kind)` at `tests/unit/goal-proposals.test.ts:84-105`. |
| 6 | Backend can render deterministic Traditional Chinese proposal, generic fail-closed, validation, and cancel copy without LLM authorship. | VERIFIED | Renderer exports are implemented in `server/orchestrator/mutation-receipts.ts:56-99`; exact-copy and forbidden-term tests are in `tests/unit/mutation-receipts.test.ts:126-185`. |
| 7 | Expired or cleared pending proposal state is unavailable to later confirmation. | VERIFIED | `turnStateService.getState` clears expired state; service tests force expiry and clear state at `tests/unit/goal-proposals.test.ts:107-133`. |
| 8 | The LLM can call `propose_goals` to create a backend pending proposal without mutating targets or publishing `goals_update`. | VERIFIED | Tool contract and integration no-publish spy confirm this; `publishGoalsUpdate` is only called after successful `deviceService.updateGoals` at `server/orchestrator/tools.ts:1469-1472`. |
| 9 | `update_goals` no longer treats empty args or previous assistant prose as proposal confirmation. | VERIFIED | Empty/missing-mode failures return generic renderer rejection in `server/orchestrator/tools.ts:1636-1657`; current-turn-only source checking omits `previousAssistantMessage` for goal numeric fields at `server/orchestrator/tools.ts:1434-1439`. Covered by `tests/unit/update-goals-contract.test.ts:132-148` and `tests/unit/update-goals-contract.test.ts:187-212`. |
| 10 | `update_goals` mutates only from current-turn numeric values or explicit latest-proposal mode with backend consent and active proposal state. | VERIFIED | Explicit mode schema, current-turn source guard, active proposal lookup, consent predicate, mutation, clear, and publish sequence are implemented at `server/orchestrator/tools.ts:426-448` and `server/orchestrator/tools.ts:1424-1472`. |
| 11 | Validation, source guard, unavailable proposal, and cancel outcomes return backend-owned copy and do not mutate or publish. | VERIFIED | Controlled result branches return authority/validation/cancel copy before mutation at `server/orchestrator/tools.ts:1424-1462` and `server/orchestrator/tools.ts:1636-1657`; cancel preflight is also handled before model calls in `server/orchestrator/index.ts:636-648`. |
| 12 | Users receive backend-rendered proposal copy for vague goal-change recommendations, with daily targets unchanged. | VERIFIED | System prompt routes vague goal changes to `propose_goals` at `server/orchestrator/system-prompt.ts:171-177`; integration test verifies exact proposal copy and unchanged target response at `tests/integration/chat-goal-update.integration.test.ts:171-187`. |
| 13 | Users can confirm a valid latest active proposal with short consent, and consumed/expired/missing proposal confirmations fail closed. | VERIFIED | Active proposal confirmation and replay failure are covered at `tests/integration/chat-goal-update.integration.test.ts:195-241`; missing proposal failure at `tests/integration/chat-goal-update.integration.test.ts:251-265`. |
| 14 | Users can cancel an active proposal with cancel terms and receive neutral backend copy without mutation or `goals_update`. | VERIFIED | Shared cancel predicate includes cancel and negated consent patterns at `server/orchestrator/source-text-guard.ts:46-68`; pre-LLM cancel clears active state and returns `renderGoalCancelCopy` at `server/orchestrator/index.ts:636-648`. Integration tests cover `先不用`, `不好`, `不可以`, and `不行` at `tests/integration/chat-goal-update.integration.test.ts:318-374`. |
| 15 | Failed/cancel goal paths directly control final reply with `finalReplySource: renderer` and no later LLM rewrite. | VERIFIED | Orchestrator controlled replies return before `messages.push({ role: "assistant", ... tool_calls })` at `server/orchestrator/index.ts:930-947` and `server/orchestrator/index.ts:1082`; tests assert `chatCalls.length` does not increase and `finalReplySource === "renderer"` at `tests/unit/orchestrator.test.ts:1614-1766`. |
| 16 | Validation, guard, proposal failure, and cancel paths leave targets unchanged and publish no `goals_update`. | VERIFIED | Tool and integration tests cover unchanged targets/no publish across proposal, missing consent, validation, cancel, malformed args, and no-mode cases; targeted command passed 105 tests. |

**Score:** 16/16 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `server/services/goal-proposals.ts` | Pending proposal service over `turn_states` | VERIFIED | Exports kind, TTL, payload, and service; uses `createTurnStateService`; no schema/migration changes. |
| `server/orchestrator/mutation-receipts.ts` | Deterministic goal proposal/rejection/validation/cancel renderers | VERIFIED | Exports all required renderers and exact-copy tests assert no internal terms. |
| `server/orchestrator/tools.ts` | `propose_goals` and explicit-mode `update_goals` contracts | VERIFIED | Contains bounded schemas, explicit modes, source guard, proposal lookup, clear-after-persist, publish-after-persist, and controlled failure replies. |
| `server/orchestrator/source-text-guard.ts` | Shared consent/cancel predicates | VERIFIED | CR-01 fixed with anchored patterns; cancel excludes negated consent from consent. |
| `server/app.ts` | Goal proposal service DI | VERIFIED | Creates `goalProposalService`, passes it to orchestrator, exposes it through `AppServices`. |
| `server/orchestrator/system-prompt.ts` | Tool routing guidance | VERIFIED | Goal section names `propose_goals`, `current_turn_values`, and `latest_proposal`; no previous-assistant prose authority in active section. |
| `server/orchestrator/index.ts` | Controlled reply short-circuit and cancel preflight | VERIFIED | Returns renderer-owned controlled replies before later LLM rewrite. |
| Unit/integration tests | Lifecycle, copy, tool contract, prompt, orchestrator, and Fastify proof | VERIFIED | Targeted test gate passed 105 tests. |

`gsd-sdk query verify.artifacts` passed for all three plan files: 12/12 declared artifacts.

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `goal-proposals.ts` | `turn-state.ts` | `createTurnStateService`, `putState/getState/clearState` | VERIFIED | SDK key-link check passed; direct source shows wrapper only. |
| `tools.ts` | `goal-proposals.ts` | `putLatest/getLatest/clear` | VERIFIED | Proposal creation, latest proposal application, successful clear, and cancel clear are wired. |
| `app.ts` | `tools.ts` | `ToolDeps.goalProposalService` | VERIFIED | `goalProposalService` flows through `createOrchestrator` and `executeTool` deps. |
| `tools.ts` | `source-text-guard.ts` | Shared consent/cancel predicates | VERIFIED | Imports shared helpers; no local consent/cancel list in tools. |
| `tools.ts` | `RealtimePublisher` | `publishGoalsUpdate` after persisted update | VERIFIED | Publish happens only after `deviceService.updateGoals` and proposal clear. |
| `tools.ts` | `index.ts` | `ToolExecutionResult.controlledReply` | VERIFIED | Controlled replies return before later model/tool-message flow. |
| `index.ts` | `routes/chat.ts` | `finalReplySource/finalReplyShape` | VERIFIED | Route records renderer ownership and suppresses summary composition for renderer replies. |
| `chat-goal-update.integration.test.ts` | `RealtimePublisher` | Publish spy | VERIFIED | Integration test wraps `publishGoalsUpdate` through `onServicesReady`. |

`gsd-sdk query verify.key-links` passed for all three plan files: 9/9 declared links.

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|---|---|---|---|---|
| `server/services/goal-proposals.ts` | `GoalProposalPayload` | `turn_states` via `createTurnStateService(db)` | Yes | VERIFIED |
| `server/orchestrator/tools.ts` | Proposed/applied `DailyTargets` | `propose_goals` args, `goalProposalService.getLatest`, `deviceService.updateGoals` | Yes | VERIFIED |
| `server/orchestrator/index.ts` | `controlledReply.text/source` | `executeTool(...).controlledReply` or cancel preflight renderer | Yes | VERIFIED |
| `server/routes/chat.ts` | `finalReplySource/finalReplyShape/dailyTargets` | `OrchestratorResult` | Yes | VERIFIED |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| TypeScript and Phase 60 targeted proof pass | `yarn tsc --noEmit && node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/goal-proposals.test.ts tests/unit/mutation-receipts.test.ts tests/unit/update-goals-contract.test.ts tests/unit/system-prompt.test.ts tests/unit/orchestrator.test.ts tests/integration/chat-goal-update.integration.test.ts` | Passed: typecheck plus 105 tests, 0 failures | PASS |
| No schema/migration changes | `git diff --name-only -- server/db/schema.ts drizzle | wc -l` | `0` | PASS |

### Probe Execution

| Probe | Command | Result | Status |
|---|---|---|---|
| None declared or discovered | `find scripts -path '*/tests/probe-*.sh' -type f` and phase grep | No probe files/references found | SKIPPED |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| GOAL-01 | 60-01, 60-02, 60-03 | Concrete goal proposal without target mutation until backend persists structured pending proposal | SATISFIED | `propose_goals` persists pending state and returns backend copy without mutation/publish; integration confirms no `dailyTargets`. |
| GOAL-02 | 60-02, 60-03 | `好` updates only with valid backend proposal id or explicit current-turn numeric target values | SATISFIED | Phase implementation uses D-17 single-active `latest_proposal` as the valid backend proposal authority; proposal payload still has `proposalId`, but user/model confirmation does not rely on hidden id handoff. Current-turn numeric mode is separately source-guarded. |
| GOAL-03 | 60-01, 60-02, 60-03 | Expired, consumed, mismatched, or missing proposals fail closed with deterministic Traditional Chinese guidance | SATISFIED | Expiry/clear tests, replay failure, missing proposal failure, generic deterministic copy, and no-publish assertions all pass. |
| GOAL-04 | 60-01, 60-02, 60-03 | Validation/guard rejection has deterministic backend copy, no persistence, no publish, no LLM success prose | SATISFIED | Renderer-controlled validation/authority failure branches; integration tests for validation, empty args, no mode, missing proposal, and metadata-only renderer source. |

No orphaned Phase 60 requirement IDs found in `.planning/REQUIREMENTS.md`: GOAL-01 through GOAL-04 are all claimed by phase plans and traced to implementation.

### Fixed Code Review Blockers

| Finding | Status | Evidence |
|---|---|---|
| CR-01 negated consent could apply proposal | VERIFIED FIXED | Commit `506471d` exists; `isGoalProposalCancel` now matches `不好`, `不可以`, and `不行`, while `isGoalProposalConsent` returns false for cancel text at `server/orchestrator/source-text-guard.ts:46-68`. Unit and integration tests cover negated consent at `tests/unit/update-goals-contract.test.ts:279-300` and `tests/integration/chat-goal-update.integration.test.ts:347-374`. |
| CR-02 malformed `update_goals.mode` could fall through to LLM-authored final text | VERIFIED FIXED | Commit `ca5b27e` exists; malformed `update_goals` failures now return renderer-owned generic rejection copy at `server/orchestrator/tools.ts:1636-1657`, and orchestrator short-circuits controlled replies at `server/orchestrator/index.ts:930-947`. Tests cover `{}` and `{ calories: 1800 }` at `tests/unit/orchestrator.test.ts:1676-1720` and `tests/integration/chat-goal-update.integration.test.ts:404-449`. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| `server/orchestrator/source-text-guard.ts` | 118, 122, 126, 245 | `return null` | INFO | Legitimate parser miss path, not a stub. |
| `server/orchestrator/tools.ts` | 606, 1567 | `return []` | INFO | Legitimate empty list fallback for parsing/sanitizing, not user-visible hollow data. |
| `server/orchestrator/index.ts` | 53, 164 | `IMAGE_PLACEHOLDER` | INFO | Existing image-only message sentinel, not Phase 60 placeholder UI/copy. |
| Tests | various | empty callbacks / stream cancellation | INFO | Test harness cleanup patterns, not runtime stubs. |

No unreferenced `TBD`, `FIXME`, or `XXX` markers found in files modified by this phase.

### Human Verification Required

None. This phase is backend/tooling behavior with deterministic unit and Fastify integration coverage; no visual, external service, or manual deployed-domain behavior is required for the phase goal.

### Gaps Summary

No blocking gaps found. The phase goal is achieved in the codebase. The only semantic note is that GOAL-02's "proposal id" wording is implemented through the phase-approved single-active `latest_proposal` backend state mode rather than a hidden id handoff; the implementation still enforces backend-persisted proposal authority and tests replay/missing/consumed failure paths.

---

_Verified: 2026-05-17T00:50:50Z_
_Verifier: the agent (gsd-verifier)_
