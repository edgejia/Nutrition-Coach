---
quick_task: 260516-nwi
status: complete
commit: 74bbf40
completed_at: 2026-05-16T09:37:43Z
changed_files:
  - server/orchestrator/index.ts
  - server/routes/chat.ts
  - tests/unit/orchestrator.test.ts
  - tests/integration/chat-api.test.ts
  - tests/integration/chat-streaming.test.ts
  - tests/harness/sse.ts
  - tests/unit/harness-foundation.test.ts
  - tests/harness/scenarios/image-log-failure.ts
---

# Quick Task 260516-nwi Summary

## Result

Replaced the summary/history no-mutation regex allowance with fact-grounded validation. No-mutation replies that claim meal logging now pass only when extracted meal names, meal count, and calories match persisted summary/history facts. The documented aggregate calorie tolerance is `SUMMARY_HISTORY_CALORIE_TOLERANCE_KCAL = 10`.

JSON, drained non-SSE streams, true SSE streams, and persisted assistant history now use the same guard facts. Summary-context SSE text remains buffered until final classification, so unsafe model text is not emitted before fallback replacement.

Follow-up orchestration review found and fixed one additional edge: aggregate count/calorie matches no longer bypass meal-name validation when the same reply also references a specific fake item, such as `牛肉飯`.

## SSE Harness Contract

`tests/harness/sse.ts` now includes `readStreamThroughClose()`, which reads through stream close and returns raw SSE text, parsed ordered events, `closed`, `firstDoneIndex`, `eventsAfterFirstDone`, and `nonEmptyChunkBeforeDone`.

`image-log-failure` now records and enforces:

- stream close observed
- `done` is terminal
- no `chunk` or `status` after first `done`
- at least one non-empty `chunk` before first `done`

Regenerated `tests/harness/artifacts/image-log-failure/latest/steps.json` showed all three sub-scenarios with `closed: true`, empty `terminalViolationEvents`, and `nonEmptyChunkBeforeDone: true`.

## Commands Run

| Command | Status |
| --- | --- |
| `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/orchestrator.test.ts` | FAIL expected RED before implementation |
| `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/orchestrator.test.ts` | PASS after implementation |
| `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/chat-api.test.ts tests/integration/chat-streaming.test.ts` | PASS |
| `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/harness-foundation.test.ts` | PASS |
| `yarn verify:harness -- image-log-failure` | PASS |
| `rg -n "SUMMARY_OR_HISTORY_ALLOWED_LOGGING_REFERENCE_PATTERNS" server/orchestrator/index.ts; test $? -ne 0` | PASS |
| `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/orchestrator.test.ts tests/unit/harness-foundation.test.ts` | PASS |
| aggregate totals plus fake meal-name regression in `tests/unit/orchestrator.test.ts` | PASS |
| `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/chat-api.test.ts tests/integration/chat-streaming.test.ts` | PASS after amendment |
| `yarn verify:harness -- image-log` | PASS |
| `yarn verify:harness -- protein-trust` | PASS |
| `yarn test:unit` | PASS |
| `yarn tsc --noEmit` | PASS |
| `yarn release:check` | PASS |

## Deviations

None. Implementation stayed within the plan-owned files.

## Known Stubs

None.

## Blockers

None.

## Commit

- `74bbf40` - `fix(260516-nwi): ground summary logging claims in facts`
