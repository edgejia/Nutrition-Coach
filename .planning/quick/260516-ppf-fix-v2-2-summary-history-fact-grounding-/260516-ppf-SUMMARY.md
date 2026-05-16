---
quick_task: 260516-ppf
status: complete
completed_at: 2026-05-16T10:22:00Z
changed_files:
  - server/orchestrator/tools.ts
  - server/orchestrator/index.ts
  - tests/unit/tools.test.ts
  - tests/unit/orchestrator.test.ts
  - tests/integration/chat-api.test.ts
  - tests/integration/chat-streaming.test.ts
commits:
  - 77d36c8
  - b3ef479
  - 0b3faf1
  - c42236d
  - b43499d
---

# Quick Task 260516-ppf Summary

## Result

Fixed summary/history fact grounding so `get_daily_summary` now exposes persisted meal facts alongside the existing daily aggregate. The tool result visible to the model includes `dailySummary` and `meals`, while the human-readable tool summary remains the existing `熱量 ...` macro format.

The no-mutation summary/history guard now treats aggregate day totals and named meal facts as separate authorities. Pure day-total wording can still pass when meal count and total calories match, but named meal claims must match persisted meal names, and per-meal calorie claims must match that persisted meal within the existing tolerance.

JSON and SSE route regressions now prove unsafe model text is replaced before response chunks and assistant history persistence for both daily-total-as-single-meal claims and fake meal lists.

## Commands Run

| Command | Status |
| --- | --- |
| `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/tools.test.ts` | FAIL expected RED before Task 1 implementation |
| `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/tools.test.ts` | PASS after Task 1 implementation |
| `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/orchestrator.test.ts` | FAIL expected RED before Task 2 implementation |
| `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/orchestrator.test.ts` | PASS after Task 2 implementation |
| `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/chat-api.test.ts tests/integration/chat-streaming.test.ts` | PASS |
| `yarn tsc --noEmit` | PASS |
| `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/tools.test.ts tests/unit/orchestrator.test.ts tests/integration/chat-api.test.ts tests/integration/chat-streaming.test.ts` | PASS |
| `yarn test:unit` | PASS |
| `yarn tsc --noEmit` | PASS final |

## Deviations

None requiring code outside the planned files.

Task 3 route tests passed immediately after Task 1 and Task 2 production changes, so no additional production patch was needed for the route layer.

## Known Stubs

None. Stub-pattern scan found only existing initialized arrays/strings and null checks used as normal test/runtime state.

## Threat Flags

None beyond the planned trust-boundary changes in the task threat model.

## TDD Gate Compliance

- RED commit for Task 1: `77d36c8`
- GREEN commit for Task 1: `b3ef479`
- RED commit for Task 2: `0b3faf1`
- GREEN commit for Task 2: `c42236d`
- Task 3 was coverage-only after the lower-layer implementation and committed as `b43499d`.

## Commits

- `77d36c8` - `test(260516-ppf): add failing summary meal facts contract`
- `b3ef479` - `feat(260516-ppf): expose summary meal facts`
- `0b3faf1` - `test(260516-ppf): add failing named meal total guard`
- `c42236d` - `fix(260516-ppf): separate summary and meal fact authority`
- `b43499d` - `test(260516-ppf): cover route summary fact grounding`

## Follow-up Verification Gap Fix

Fixed verifier gaps found after the first execution. The guard now extracts kcal-bearing named meal segments such as `其中包含牛肉飯 900 kcal` instead of skipping them, validates the extracted name against persisted meal facts, and validates any kcal attached to that named segment against that meal's persisted calories before allowing the aggregate day-total branch to preserve the reply.

Coverage was tightened for the verifier's bypass variants:

- Direct guard regression rejects `今天已記錄 2 餐，共 900 kcal，其中包含牛肉飯 900 kcal。`.
- Direct guard regression rejects `今天已記錄 2 餐，共 900 kcal，其中包含雞胸肉 900 kcal。` when persisted `雞胸肉` is 450 kcal.
- JSON route regression now uses the same mixed aggregate plus named-kcal unsafe shapes.
- SSE route regression now uses the same mixed aggregate plus named-kcal unsafe shapes and verifies unsafe chunks/history are absent.

### Follow-up Commands Run

| Command | Status |
| --- | --- |
| `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/orchestrator.test.ts` | FAIL expected RED after adding verifier exact direct-guard regressions |
| `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/orchestrator.test.ts` | PASS after guard fix |
| `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/chat-api.test.ts tests/integration/chat-streaming.test.ts` | PASS |
| `yarn tsc --noEmit` | PASS |
| `yarn test:unit` | PASS |
| `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/tools.test.ts tests/unit/orchestrator.test.ts tests/integration/chat-api.test.ts tests/integration/chat-streaming.test.ts` | PASS |

### Follow-up Gap Status

All verifier-listed gaps are closed by this follow-up patch.
