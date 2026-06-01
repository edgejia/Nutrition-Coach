---
quick_task: 260602-2qw
title: Fix v2.5 true-LLM smoke finding after delete
completed: 2026-06-02
commits:
  - 90670af
  - f26936e
key_files:
  - server/orchestrator/index.ts
  - server/routes/chat.ts
  - client/src/types.ts
  - client/src/api.ts
  - client/src/store.ts
  - client/src/components/ChatPanel.tsx
  - tests/unit/store.test.ts
  - tests/unit/api-client.test.ts
  - tests/integration/chat-streaming.test.ts
---

# Quick Task 260602-2qw Summary

Fixed the live-session stale receipt bug after successful `delete_meal`: prior in-memory receipts for the deleted meal now keep display facts but lose edit identity immediately.

## What Changed

- Added `deletedMealId` to `OrchestratorResult` as live-client invalidation metadata derived only from committed `deletedMeal.mealId`.
- Threaded `deletedMealId` through SSE `done`, SSE `stopped`, SSE catch, JSON stream-drain, JSON normal, and JSON catch terminal payloads.
- Added guarded client parsing for `deletedMealId` on `ChatReply`, `sendMessageStream` `done`, and `sendMessageStream` `stopped`.
- Passed `deletedMealId` from `ChatPanel` into the final live store commit path.
- Updated `commitProvisionalBubble` and `commitStoppedProvisionalBubble` to redact matching prior receipt `mealId`, `mealRevisionId`, and `dateKey` before appending the delete confirmation.
- Kept delete confirmations assistant-text-only by continuing to omit `loggedMeal`.

## Tests Added

- Store regression: live delete commit redacts only the matching prior receipt identity while preserving display facts, image fields, and nonmatching receipt edit identity.
- API client regression: stream terminal parsing passes valid string `deletedMealId` for `done` and `stopped`, and omits malformed non-string values.
- Integration regression: committed delete SSE and JSON paths return `deletedMealId` and keep `loggedMeal` omitted.

## Verification

- `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/store.test.ts tests/unit/api-client.test.ts tests/integration/chat-streaming.test.ts` passed.
- `yarn tsc --noEmit` passed.
- `yarn test:unit` passed.
- `yarn test:integration` passed.
- `yarn release:check` passed.

## Deviations

- `.planning/STATE.md` was not updated because the quick-task prompt explicitly assigned state updates to the orchestrator.
- No `ROADMAP.md` update was made because quick tasks are separate from planned phases.

## Known Stubs

None. Stub scan found only ordinary test/runtime initializers, not placeholder behavior or unwired UI data.

## Threat Notes

- `deletedMealId` is not added to compressed history or `ChatMutationOutcomeFact`.
- The client still treats server revision checks as authoritative; redaction is UX invalidation support only.
- Reload/history stale and deleted receipt behavior remains covered by the existing ChatService D-22/D-26 tests, which stayed green under `yarn test:unit` and `yarn release:check`.

## Self-Check: PASSED

- Summary file exists.
- Commit `90670af` exists.
- Commit `f26936e` exists.
