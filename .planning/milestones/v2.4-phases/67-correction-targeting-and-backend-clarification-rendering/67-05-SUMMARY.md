---
phase: 67-correction-targeting-and-backend-clarification-rendering
plan: "05"
subsystem: service
tags: [meal-correction, pending-selection, stale-revision, fastify, node-test]
dependency_graph:
  requires:
    - "67-04: terminal renderer-owned clarification contract"
  provides:
    - "Pending option revalidation before delayed selected target resolution"
    - "Renderer-owned stale selected update/delete recovery without mutation metadata"
    - "Fastify proof for invalid-number, stale/deleted delayed selection, mixed follow-up, and no publish"
  affects:
    - phase-67
    - TARGET-01
    - TARGET-02
    - correction-targeting
    - backend-clarification-rendering
tech_stack:
  added: []
  patterns:
    - pending rendered-option revalidation
    - renderer-owned stale target recovery
    - Fastify no-publish regression proof
key_files:
  created:
    - .planning/phases/67-correction-targeting-and-backend-clarification-rendering/67-05-SUMMARY.md
  modified:
    - server/services/meal-correction.ts
    - server/orchestrator/tools.ts
    - tests/unit/meal-correction.test.ts
    - tests/unit/tools.test.ts
    - tests/integration/chat-meal-correction.integration.test.ts
key_decisions:
  - "Delayed pending selections now resolve only after device-scoped active candidate revalidation confirms the same meal id and original revision id."
  - "Stale selected update/delete writes recover through meal_target_clarification controlled replies when pending scope is available; direct stale resolver errors keep existing Phase 62 stable error behavior."
  - "Same-label replacement meals may be shown as fresh choices inside recovered scope but are never auto-selected as the stale target replacement."
patterns_established:
  - "Use recoverStalePendingSelection() for selected-option stale write recovery before falling back to raw revision precondition fatal errors."
  - "Route tests assert publishDailySummary zero calls and no summaryOutcome for no-mutation clarification paths."
requirements_completed:
  - TARGET-01
  - TARGET-02
metrics:
  duration: "8m 52s"
  completed_at: "2026-05-28T20:38:48Z"
  tasks_completed: 2
  files_modified: 5
---

# Phase 67 Plan 05: Delayed Selection Revalidation Summary

Delayed correction selections now revalidate meal identity and revision before mutation, with Fastify no-publish proof for stale/deleted and mixed follow-up paths.

## Work Completed

### Task 1: Revalidate delayed selections and fail closed stale/deleted selected targets

- Added unit coverage proving delayed selected targets resolve only against the originally rendered meal revision.
- Updated pending option resolution to reload active device-scoped candidates and reject stale or deleted selected options before mutation.
- Added stale selected update/delete recovery through renderer-owned `meal_target_clarification` replies when the pending scope can be recovered.
- Preserved no-mutation metadata semantics for recovery replies: `executed: false`, `failureReason: "guard"`, no `summaryOutcome`.

### Task 2: Route-level clarification, no-publish, and mixed follow-up proof

- Added Fastify regression coverage for invalid numbered follow-up replies after correction ambiguity.
- Added route proof that a deleted delayed selection with same-label replacement does not auto-retarget.
- Asserted no mutation, no summary publish, no `summaryOutcome`, and terminal backend copy on no-mutation clarification paths.

## Commits

| Task | Commit | Type | Description |
| ---- | ------ | ---- | ----------- |
| 1 RED | `e252b53` | test | Add failing stale pending selection coverage |
| 1 GREEN | `e721ae7` | feat | Fail closed stale pending meal selections |
| 2 | `40e42d5` | test | Prove route stale selection recovery |

## Verification

All required gates passed:

- `node scripts/run-node-with-tz.mjs --import tsx --test --test-name-pattern "Phase 67 D-39|Phase 67 D-41|Phase 67 D-46|Phase 67 D-44" tests/unit/meal-correction.test.ts tests/unit/tools.test.ts`
- `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-correction.test.ts tests/unit/tools.test.ts`
- `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/chat-meal-correction.integration.test.ts`
- `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-correction.test.ts tests/unit/tools.test.ts tests/integration/chat-meal-correction.integration.test.ts`
- `yarn tsc --noEmit`
- `yarn test:unit`
- `yarn test:integration`

## Deviations from Plan

None - plan executed as written.

## TDD Gate Compliance

- RED gate commit present: `e252b53`
- GREEN gate commit present after RED: `e721ae7`
- Task 2 was proof-only route coverage; Task 1 implementation already satisfied the route-level behavior, so no additional GREEN source commit was required.

## Known Stubs

None. Stub scan found only test fixtures, local empty arrays, and existing typed accumulator initialization; no UI-flowing placeholders or unwired data stubs were introduced.

## Auth Gates

None.

## Self-Check: PASSED

- Summary file created: `.planning/phases/67-correction-targeting-and-backend-clarification-rendering/67-05-SUMMARY.md`
- Task commits found: `e252b53`, `e721ae7`, `40e42d5`
- Key source/test files verified through targeted, unit, integration, and TypeScript gates.
