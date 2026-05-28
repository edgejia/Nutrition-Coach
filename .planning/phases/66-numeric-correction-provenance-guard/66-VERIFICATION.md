---
phase: 66-numeric-correction-provenance-guard
verified: 2026-05-28T08:54:31Z
status: passed
score: 11/11 must-haves verified
overrides_applied: 0
---

# Phase 66: Numeric Correction Provenance Guard Verification Report

**Phase Goal:** Users cannot have meal calories or macros changed by model-estimated chat patches unless the current turn supplies explicit numeric evidence or the backend owns an approved estimate/proposal.
**Verified:** 2026-05-28T08:54:31Z
**Status:** passed
**Re-verification:** No - initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Explicit numeric correction text such as `蛋白質改成 28g` can update the resolved meal through existing revision checks. | VERIFIED | `tests/integration/chat-meal-correction.integration.test.ts:179-184` asserts `POST /api/chat` with `雞腿飯蛋白質改成 28g` returns `didMutateMeal: true` and updated receipt copy. `server/orchestrator/tools.ts:1470-1503` loads current facts, authorizes numeric evidence, then calls `mealCorrectionService.updateMeal` with the resolved revision id. |
| 2 | Vague requests such as `蛋白質怪怪的，幫我改合理一點` do not mutate meal calories/macros directly. | VERIFIED | `server/orchestrator/meal-numeric-authority.ts:62-67` classifies vague/direction/relative text separately. `server/orchestrator/tools.ts:1478-1494` returns `meal_numeric_authority_failure` before service write when authority fails. Integration coverage at `tests/integration/chat-meal-correction.integration.test.ts:195-242` proves no mutation and no publish. |
| 3 | Rejected or clarification-required numeric corrections do not create a new meal revision, do not publish `daily_summary`, and do not show success-style text. | VERIFIED | Route tests assert unchanged revision count, no `summaryOutcome`, and no `publishDailySummary` calls for vague, proposal, stale, ambiguous, and cancel paths (`tests/integration/chat-meal-correction.integration.test.ts:237-242`, `293-300`, `345-349`, `475-491`). Route publish is gated by `didMutateMeal` in `server/routes/chat.ts:388-420`. |
| 4 | Backend-rendered guidance explains the needed numeric input or proposal step in concise Traditional Chinese. | VERIFIED | Renderer-owned copy starts with no-update semantics and asks for explicit target numbers or computable adjustments in `server/orchestrator/mutation-receipts.ts:140-155`. Proposal copy lists meal label, affected fields, before/after values, and approval guidance at `server/orchestrator/mutation-receipts.ts:121-137`; tests cover forbidden internal terms and no-success wording at `tests/unit/mutation-receipts.test.ts:235-294`. |
| 5 | Direct meal numeric mutation authority is current-turn explicit final target evidence only, never ordinary prior assistant prose. | VERIFIED | `authorizeMealNumericUpdate` accepts only `currentUserMessage` (`server/orchestrator/meal-numeric-authority.ts:285-304`). Unit tests reject prior assistant numbers and confirm current-turn explicit values only (`tests/unit/meal-numeric-authority.test.ts:47-60`, `100-112`). |
| 6 | Negated numeric values are not treated as authorized evidence. | VERIFIED | `NEGATED_VALUE_RE` and filtering are implemented in `server/orchestrator/meal-numeric-authority.ts:69`, `124-141`, `148-170`. Unit tests cover `蛋白質不是 30g，改成 28g` and reject a negated `30g` write at `tests/unit/meal-numeric-authority.test.ts:40-45`, `118-132`. |
| 7 | Bare Chinese numeral targets and accepted unit variants are recognized when they clearly express final values. | VERIFIED | Bare Chinese target handling exists in `server/orchestrator/meal-numeric-authority.ts:68`, `108-119`, `138-143`; shared numeric normalization handles bare Chinese digits with nutrition units at `server/orchestrator/source-text-guard.ts:287-291`. Unit tests cover `脂肪改成五` and `蛋白質改為八` at `tests/unit/meal-numeric-authority.test.ts:23-37`. |
| 8 | Top-level nutrition fields and changed `items[]` numeric values share the same authorization boundary. | VERIFIED | `collectPatchUnauthorized` and `collectItemsUnauthorized` cover all four numeric fields and nested replacements at `server/orchestrator/meal-numeric-authority.ts:225-271`. Unit tests prove changed `items[]` values require current-turn evidence at `tests/unit/meal-numeric-authority.test.ts:155-181`. |
| 9 | Backend-owned proposals are stored as active, same-kind replaceable, revision-scoped state and never originate from LLM numeric target values. | VERIFIED | `createMealNumericProposalService` stores `proposalId`, `mealId`, `expectedMealRevisionId`, backend-computed update shape, affected fields, operator, and expiry via `turnStateService` (`server/services/meal-numeric-proposals.ts:49-91`). `propose_meal_numeric_correction` schema accepts only meal id, fields, operator, and optional operator value; backend preview computes before/after from persisted facts (`server/orchestrator/tools.ts:1532-1597`). |
| 10 | Proposal approval, cancellation, and cross-kind ambiguity are routed before model execution and mutate only through stored backend proposal state. | VERIFIED | `server/orchestrator/index.ts:731-840` loads active goal/meal proposals before the LLM loop at `908+`, handles broad/kind-specific cancel, fails closed on both-active bare approval, and applies meal approval using `activeMealProposal` plus `expectedMealRevisionId`. Tests cover bare approval, broad cancel, stale approval, and stored proposal approval (`tests/unit/orchestrator.test.ts:2001-2139`; `tests/integration/chat-meal-correction.integration.test.ts:314-491`). |
| 11 | Prompt and route/stream behavior no longer rely on model-estimated direct numeric commits. | VERIFIED | Prompt guidance requires current-turn final numbers for direct `update_meal`, routes computable operators through `propose_meal_numeric_correction`, and says backend validation/state decide authority (`server/orchestrator/system-prompt.ts:182-194`). Tests assert old direct-estimation instruction is absent and proposal guidance is present (`tests/unit/system-prompt.test.ts:469-499`). SSE blocked correction proof asserts renderer no-update chunk, `didMutateMeal: false`, no success text, and no `summaryOutcome` (`tests/integration/chat-streaming.test.ts:1656-1705`). |

**Score:** 11/11 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `server/orchestrator/meal-numeric-authority.ts` | Evidence extraction, adjustment classification, top-level/items[] authorization | VERIFIED | Exists, substantive, exports required helpers, wired into `tools.ts`. |
| `server/services/meal-numeric-proposals.ts` | Turn-state-backed meal numeric proposal storage | VERIFIED | Exists, substantive, uses `putState/getState/clearState`, stores revision-scoped proposal payloads. |
| `server/orchestrator/mutation-receipts.ts` | Renderer-owned blocked/proposal/cancel/ambiguity copy | VERIFIED | Copy helpers present and tested for no-update wording, before/after values, and forbidden terms. |
| `server/orchestrator/tools.ts` | Tool-boundary enforcement and backend-computed proposal creation | VERIFIED | Manual trace confirms authorization before `updateMeal`; SDK key-link same-line regex false-negative overridden by code evidence, not a formal override. |
| `server/services/meal-correction.ts` | Current persisted facts and deterministic preview methods | VERIFIED | `loadCurrentMealFacts` and `previewMealNumericCorrection` read persisted revision/items and compute locked operator results. |
| `server/orchestrator/index.ts` | Pre-model proposal approval/cancel/ambiguity router | VERIFIED | Active proposals loaded and routed before first provider call. |
| `server/app.ts` | Composition-root service wiring | VERIFIED | `createMealNumericProposalService(db)` passed into `createOrchestrator`. |
| `server/orchestrator/system-prompt.ts` | Support-only prompt contract | VERIFIED | Direct model-estimation commit wording absent from actual prompt section. |
| `tests/unit/meal-numeric-authority.test.ts` | Helper proof for explicit, negated, vague, relative, and items[] cases | VERIFIED | Targeted verifier-run passed. |
| `tests/integration/chat-meal-correction.integration.test.ts` | Route-level JSON proof | VERIFIED | Targeted verifier-run passed. |
| `tests/integration/chat-streaming.test.ts` | SSE no-mutation terminal parity proof | VERIFIED | Source proof present for blocked numeric correction. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `meal-numeric-authority.ts` | `source-text-guard.ts` | `normalizeNumericSourceText` | WIRED | SDK key-link verified. |
| `meal-numeric-proposals.ts` | `turn-state.ts` | `putState/getState/clearState` | WIRED | SDK key-link verified. |
| `tools.ts` | `meal-correction.ts` | `authorizeMealNumericUpdate` before `updateMeal` | WIRED | Manual trace: `tools.ts:1478-1494` authorizes/fails before `tools.ts:1498-1503` service write. |
| `tools.ts` | `meal-correction.ts` | `loadCurrentMealFacts` and `previewMealNumericCorrection` | WIRED | SDK key-link verified and source trace at `tools.ts:1582-1597`. |
| `index.ts` | `meal-numeric-proposals.ts` | Active proposal decision router before model calls | WIRED | SDK key-link verified; provider call begins after router at `index.ts:908`. |
| `chat-meal-correction.integration.test.ts` | `server/routes/chat.ts` | Fastify JSON/SSE behavior with real SQLite and `MockLLMProvider` | WIRED | SDK key-link verified. |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `tools.ts` `update_meal` | `currentFacts`, `changedNumericUpdate`, `authority` | `mealCorrectionService.loadCurrentMealFacts()` reads current meal revision/items via `getCurrentItemsForMutation` | Yes | FLOWING |
| `tools.ts` `propose_meal_numeric_correction` | `preview`, `proposal` | `previewMealNumericCorrection(currentFacts, operatorIntent)` computes from persisted totals; `putLatest` stores backend payload | Yes | FLOWING |
| `index.ts` proposal router | `activeGoalProposal`, `activeMealProposal` | `goalProposalService.getLatest` and `mealNumericProposalService.getLatest` before LLM calls | Yes | FLOWING |
| `routes/chat.ts` publish path | `didMutateMeal`, `dailySummary`, `affectedDate` | Orchestrator result from actual mutation success path | Yes; publish is blocked unless `didMutateMeal` is true | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Numeric authority helper and route-level chat correction proof | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-numeric-authority.test.ts tests/integration/chat-meal-correction.integration.test.ts` | 27 tests passed, exit 0 | PASS |
| Parent full local gate evidence | Parent run reported `yarn tsc --noEmit`, `yarn test:unit`, `yarn test:integration`, `yarn build`, and `yarn test` passed | Not rerun in full by verifier; targeted command above rerun directly | PASS (parent evidence plus targeted verifier spot-check) |

### Probe Execution

| Probe | Command | Result | Status |
|-------|---------|--------|--------|
| None declared | `find scripts -path '*/tests/probe-*.sh' -type f`; grep phase plans/summaries for probe paths | No Phase 66 probes found | SKIPPED |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| CORR-01 | 66-01 through 66-05 | User can change meal numeric fields through chat only with current-turn explicit numeric evidence or approved backend-owned proposal. | SATISFIED | Direct updates require `authorizeMealNumericUpdate`; proposals are backend-computed and approval uses stored payload plus expected revision. |
| CORR-02 | 66-01 through 66-05 | Vague requests do not mutate directly; backend returns deterministic clarification/proposal copy. | SATISFIED | Vague request integration test proves no mutation/publish; renderer copy is backend-owned Traditional Chinese. |
| CORR-03 | 66-02 through 66-05 | Rejected or clarification-required correction creates no revision, publishes no `daily_summary`, and shows no LLM success copy. | SATISFIED | Route tests assert no revision/publish/success text; SSE test covers terminal no-mutation parity. |

No additional Phase 66 requirements are orphaned in `.planning/REQUIREMENTS.md`.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| None | - | - | - | Stub/debt scan found no blocking `TBD`, `FIXME`, or `XXX`. Benign matches were existing placeholder constants, parser `return null`, and test/local empty arrays. |

### Human Verification Required

None. Phase 66 behavior is backend/tool/route/SSE authority logic with automated proof; the plans declare no deferred human checks.

### Gaps Summary

No blocking gaps found. The phase goal is achieved: chat meal numeric corrections cannot commit model-estimated calories/macros unless authorized by explicit current-turn numeric evidence or stored backend-owned proposal approval.

---

_Verified: 2026-05-28T08:54:31Z_
_Verifier: the agent (gsd-verifier)_
