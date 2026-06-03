---
phase: 75-grouped-meal-direct-crud-contract
plan: 03
subsystem: api-testing
tags: [fastify, sqlite, meals-api, grouped-meals, meal-revisions]

requires:
  - phase: 75-02
    provides: strict grouped PATCH parser and direct grouped replacement route
provides:
  - Grouped conflict and validation side-effect regression proof
  - Transaction-level ordered full-list revision persistence proof
  - Final Phase 75 no-chat-persistence source gate proof
affects: [phase-75, grouped-meal-edit, meals-api, meal-revisions]

tech-stack:
  added: []
  patterns:
    - focused Fastify route spies for summary and realtime side-effect suppression
    - direct SQLite revision-row assertions ordered by meal_revision_items.position
    - source negative gate for direct route/service chat persistence boundaries

key-files:
  created:
    - .planning/phases/75-grouped-meal-direct-crud-contract/75-03-SUMMARY.md
  modified:
    - tests/integration/meals-api.test.ts
    - tests/unit/meal-transactions.test.ts

key-decisions:
  - "Plan 03 remained proof-only; no production route, service, schema, package, UI, media, staging, or main-promotion work was introduced."
  - "Direct grouped route edits remain represented by meal revision history and aggregate route responses, not chat receipts or compressed-history mutation outcomes."

patterns-established:
  - "Grouped missing/stale revision tests assert exact existing 409 DTOs and unchanged current meal rows before side-effect checks."
  - "Transaction tests prove submitted array order by querying mealRevisionItems ordered by persisted zero-based position."

requirements-completed: [GROUP-EDIT-01, GROUP-EDIT-02, GROUP-EDIT-03, GROUP-EDIT-04]

duration: 3m 28s
completed: 2026-06-03T10:07:06Z
---

# Phase 75 Plan 03: Grouped CRUD Proof Summary

**Grouped direct meal replacement now has route-level conflict proof and transaction-level ordered revision persistence proof.**

## Performance

- **Duration:** 3m 28s
- **Started:** 2026-06-03T10:03:38Z
- **Completed:** 2026-06-03T10:07:06Z
- **Tasks:** 2
- **Files modified:** 2

## Accomplishments

- Added grouped `PATCH /api/meals/:id` conflict coverage for valid `items[]` payloads with missing and stale `expectedMealRevisionId`.
- Proved grouped conflicts, malformed grouped bodies, and empty `items[]` validation do not trigger summary recompute, realtime publish, or whole-meal deletion semantics.
- Added transaction-service proof that full-list updates create new revisions with submitted item order, duplicate names preserved as distinct rows, superseding revision identity, and image identity preservation.
- Ran the final unit, integration, TypeScript, and no-chat-persistence source gates for Phase 75.

## Task Commits

1. **Task 1: Prove grouped conflict and failure side effects** - `4f61976` (test)
2. **Task 2: Prove ordered persistence and run final gates** - `f0aae1d` (test)

**Plan metadata:** summary generated locally; `.planning/phases/**` is gitignored in this repo, so summary commit may be skipped by the GSD helper rather than force-staged.

## Files Created/Modified

- `tests/integration/meals-api.test.ts` - Adds grouped revision-conflict assertions and strengthens invalid grouped empty-list non-delete proof.
- `tests/unit/meal-transactions.test.ts` - Adds revision/item-row assertions for ordered full-list updates, duplicate names, and image preservation.
- `.planning/phases/75-grouped-meal-direct-crud-contract/75-03-SUMMARY.md` - Execution summary and verification record.

## Decisions Made

- Kept Phase 75 Plan 03 proof-only because Plan 02 implementation already satisfied the route contract.
- Used existing route spies and SQLite queries instead of adding app service exposure for chat receipts or mutation outcomes.
- Treated the negative source gate as the Phase 75 boundary for direct route/service chat persistence, matching D-29.

## Deviations from Plan

None - plan executed exactly as written.

## Verification

- PASS: `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/meals-api.test.ts`
  - 30 Meals API tests passed.
- PASS: `yarn test:unit`
  - 990 unit tests passed.
- PASS: `yarn test:integration`
  - 354 integration tests passed.
- PASS: `yarn tsc --noEmit`
- PASS: `! rg -n "chatMealReceipts|chatMutationOutcomes|chatService|saveAssistantReply|chat_messages" server/routes/meals.ts server/services/food-logging.ts server/services/meal-transactions.ts`
  - No matches.

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None. Stub scan found only existing test-local capture arrays such as `publishedPayloads: unknown[] = []`; these are assertion plumbing, not placeholder UI/data stubs.

## Threat Flags

None. The changes are test-only and introduce no new production endpoint, auth path, file access pattern, schema change, package, or runtime trust-boundary surface.

## Next Phase Readiness

Phase 75 server-contract proof is complete. Phase 76 can build grouped Meal Edit UI on top of the strict grouped PATCH contract and revision/item persistence guarantees.

## Self-Check: PASSED

- FOUND: `tests/integration/meals-api.test.ts`
- FOUND: `tests/unit/meal-transactions.test.ts`
- FOUND: `.planning/phases/75-grouped-meal-direct-crud-contract/75-03-SUMMARY.md`
- FOUND commits: `4f61976`, `f0aae1d`
- No tracked file deletions in task commits.
- Final source negative gate passed with no matches.

---
*Phase: 75-grouped-meal-direct-crud-contract*
*Completed: 2026-06-03T10:07:06Z*
