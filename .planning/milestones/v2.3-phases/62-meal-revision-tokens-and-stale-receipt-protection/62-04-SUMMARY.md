---
phase: 62-meal-revision-tokens-and-stale-receipt-protection
plan: 04
subsystem: client
tags: [meal-revisions, stale-conflict, react, zustand, node-test]

requires:
  - phase: 62-01
    provides: server-side direct expected meal revision enforcement
  - phase: 62-02
    provides: read-side current meal revision identity on meal and receipt surfaces
  - phase: 62-03
    provides: chat/tool target resolution with revision identity
provides:
  - client DTO and normalizer propagation for mealRevisionId
  - direct client update/delete expectedMealRevisionId serialization
  - typed MEAL_REVISION_REQUIRED and MEAL_REVISION_STALE conflict preservation
  - stale Meal Edit guidance, stale instance blocking, row refresh, and receipt redaction
  - Phase 62 targeted TypeScript, unit, and integration closure gates
affects: [phase-62, phase-63, client-stale-conflict, meal-edit]

tech-stack:
  added: []
  patterns:
    - revision-aware client edit payloads
    - typed client conflict errors for stable server codes
    - display-only receipts when edit identity is incomplete

key-files:
  created:
    - .planning/phases/62-meal-revision-tokens-and-stale-receipt-protection/62-04-SUMMARY.md
  modified:
    - client/src/types.ts
    - client/src/api.ts
    - client/src/meal-edit-payload.ts
    - client/src/store.ts
    - client/src/components/MealEditScreen.tsx
    - client/src/components/SummaryDetailScreen.tsx
    - tests/unit/api-client.test.ts
    - tests/unit/meal-edit-payload.test.ts
    - tests/unit/store.test.ts
    - tests/unit/meal-edit-screen.test.ts
    - tests/unit/chat-bubble-contract.test.ts

key-decisions:
  - "Client write inputs send expectedMealRevisionId derived from MealEditPayload.mealRevisionId."
  - "Receipts without mealRevisionId remain display-only because incomplete edit identity must fail closed."
  - "Client stale recovery is UX support only; server 409 precondition checks remain authoritative."
  - "Summary Detail direct delete also passes expectedMealRevisionId because it shares the direct delete API."
  - "MealEntry.mealRevisionId remains optional at the TypeScript boundary for older local fixtures, while edit payload construction fails closed if it is missing."

patterns-established:
  - "Revision identity is preserved on read DTOs and converted to expectedMealRevisionId only at write boundaries."
  - "Stable server revision conflict codes are represented by MealRevisionConflictError instead of generic Error copy."
  - "Stale editor recovery blocks the current editor instance and requires reopening from refreshed facts."

requirements-completed: [FRESH-01, FRESH-03]

duration: 8m 39s
completed: 2026-05-17T12:48:16Z
---

# Phase 62 Plan 04: Client Revision Stale Recovery Summary

**Client meal editing now carries revision identity into direct writes and handles stale server rejections with deterministic Traditional Chinese recovery guidance.**

## Performance

- **Duration:** 8m 39s
- **Started:** 2026-05-17T12:39:37Z
- **Completed:** 2026-05-17T12:48:16Z
- **Tasks:** 3
- **Files modified:** 11 code/test files, 1 summary

## Accomplishments

- Preserved `mealRevisionId` across client meal rows, history snapshots, chat receipts, JSON/SSE parsing, and restored messages.
- Serialized `expectedMealRevisionId` for direct update and delete requests and preserved stable `MEAL_REVISION_REQUIRED` / `MEAL_REVISION_STALE` metadata through `MealRevisionConflictError`.
- Made receipts without revision identity display-only and blocked stale Meal Edit instances after a conflict.
- Added stale conflict UI behavior using exact Traditional Chinese copy, current-day row refresh, affected-date mutation tracking, and receipt identity redaction.
- Closed the plan with targeted client tests, TypeScript, unit, and integration gates passing.

## Task Commits

Each task was committed atomically:

1. **Task 1: Prove client revision payload and stale conflict behavior** - `4327d44` (test)
2. **Task 2: Implement client DTOs, API errors, and stale editor recovery** - `6e478cc` (feat)
3. **Task 3: Run Phase 62 targeted and wave closure gates** - `f168a16` (chore)

**Plan metadata:** final docs commit records this summary and state updates.

## Files Created/Modified

- `client/src/types.ts` - Added revision-aware client DTO fields and write input contracts.
- `client/src/api.ts` - Preserves read-side revision identity, sends expected write revisions, and throws typed stale conflict errors.
- `client/src/meal-edit-payload.ts` - Copies history revision identity and rejects receipt edit payloads with incomplete identity.
- `client/src/store.ts` - Redacts `mealRevisionId` with stale receipt identity and records affected mutation dates.
- `client/src/components/MealEditScreen.tsx` - Sends expected revisions, shows stale guidance, refreshes rows, redacts stale receipts, and blocks stale editor reuse.
- `client/src/components/SummaryDetailScreen.tsx` - Passes expected revision identity for direct summary-row delete.
- `tests/unit/api-client.test.ts` - Covers revision normalization, write serialization, delete bodies, and typed conflict metadata.
- `tests/unit/meal-edit-payload.test.ts` - Covers revision identity in history/receipt edit payloads and display-only missing revision receipts.
- `tests/unit/store.test.ts` - Covers receipt revision redaction and affected-date mutation tracking.
- `tests/unit/meal-edit-screen.test.ts` - Covers exact stale UI copy, refresh/invalidation behavior, and blocked stale editor reuse.
- `tests/unit/chat-bubble-contract.test.ts` - Covers display-only receipt affordances when revision identity is missing.
- `.planning/phases/62-meal-revision-tokens-and-stale-receipt-protection/62-04-SUMMARY.md` - Execution summary and verification record.

## Decisions Made

- Client write requests use `expectedMealRevisionId`; the read-side field remains `mealRevisionId`.
- Missing receipt revision identity disables edit affordances instead of attempting a best-effort mutation.
- `MealRevisionConflictError` preserves the stable server conflict code and metadata so UI copy does not depend on brittle message strings.
- Stale conflict recovery blocks the current editor instance and requires the user to reopen from fresh rows or receipts.
- `MealEntry.mealRevisionId` is optional at the TypeScript boundary for compatibility with older local fixtures, but edit payload builders fail closed when a history row lacks it.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Updated Summary Detail direct delete call site**
- **Found during:** Task 2 (Implement client DTOs, API errors, and stale editor recovery)
- **Issue:** `deleteMeal` now requires `expectedMealRevisionId`, and `SummaryDetailScreen` was an additional direct delete caller outside the plan's modified file list.
- **Fix:** Changed the summary detail delete callback to receive the full `MealEntry`, require `mealRevisionId`, and pass it to `deleteMeal`.
- **Files modified:** `client/src/components/SummaryDetailScreen.tsx`
- **Verification:** `yarn tsc --noEmit`, `yarn test:unit`, and `yarn test:integration` passed.
- **Committed in:** `6e478cc`

**2. [Rule 3 - Blocking] Preserved older local fixture compatibility while failing closed for edits**
- **Found during:** Task 2 TypeScript verification
- **Issue:** Making `MealEntry.mealRevisionId` unconditionally required caused older local test and harness fixtures to fail typechecking even though runtime edit surfaces must still require revision identity.
- **Fix:** Kept `MealEntry.mealRevisionId` optional at the DTO boundary and made `buildHistoryMealEditPayload` throw `MEAL_REVISION_REQUIRED` when a history edit row lacks revision identity.
- **Files modified:** `client/src/types.ts`, `client/src/meal-edit-payload.ts`, `tests/unit/meal-edit-payload.test.ts`
- **Verification:** Targeted client tests, `yarn tsc --noEmit`, `yarn test:unit`, and `yarn test:integration` passed.
- **Committed in:** `6e478cc`

---

**Total deviations:** 2 auto-fixed (Rule 3 blocking)
**Impact on plan:** Both adjustments were required to complete the revision-aware client contract without broad refactors or fixture churn.

## Verification

- RED gate failed as intended before implementation:
  - `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/api-client.test.ts tests/unit/meal-edit-payload.test.ts tests/unit/store.test.ts tests/unit/meal-edit-screen.test.ts tests/unit/chat-bubble-contract.test.ts`
  - Failures covered missing revision normalization, missing expected write revisions, generic conflict handling, editable missing-revision receipts, stale UI copy, and stale editor blocking.
- PASS: `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/api-client.test.ts tests/unit/meal-edit-payload.test.ts tests/unit/store.test.ts tests/unit/meal-edit-screen.test.ts tests/unit/chat-bubble-contract.test.ts`
- PASS: `yarn tsc --noEmit`
- PASS: `yarn test:unit`
- PASS: `yarn test:integration`

## Issues Encountered

- Pre-existing generated harness artifact diffs under `tests/harness/artifacts/image-log-failure/latest/` remained dirty throughout execution and were intentionally preserved outside all commits.

## User Setup Required

None - no external service configuration required.

## Known Stubs

None. Stub-pattern scanning found only ordinary null checks, empty test arrays, input validation, and existing placeholder attribute/source strings that do not represent incomplete Plan 62 behavior.

## Threat Flags

None. The plan touched existing client write/read and UI boundaries only; no new endpoints, auth paths, file access, schema changes, or sensitive logging surfaces were introduced.

## Next Phase Readiness

Phase 62 now has server direct-write enforcement, read-side revision identity, chat/tool revision targeting, and client stale recovery. Phase 63 can build on this contract for future SSE-driven meal-row freshness without changing the direct write precondition model.

## Self-Check: PASSED

- Summary exists: `.planning/phases/62-meal-revision-tokens-and-stale-receipt-protection/62-04-SUMMARY.md`
- Task commits found: `4327d44`, `6e478cc`, `f168a16`

---
*Phase: 62-meal-revision-tokens-and-stale-receipt-protection*
*Completed: 2026-05-17T12:48:16Z*
