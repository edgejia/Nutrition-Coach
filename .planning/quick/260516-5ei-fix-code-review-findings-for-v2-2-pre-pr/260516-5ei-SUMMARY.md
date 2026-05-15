---
phase: quick
plan: 260516-5ei
subsystem: chat-orchestrator
tags: [code-review-fix, no-mutation-guard, image-harness, grouped-serving]
completed_at: 2026-05-15T20:15:11Z
key_files:
  modified:
    - server/orchestrator/index.ts
    - server/orchestrator/system-prompt.ts
    - server/orchestrator/tools.ts
    - server/routes/chat.ts
    - tests/unit/orchestrator.test.ts
    - tests/unit/system-prompt.test.ts
    - tests/unit/tools.test.ts
    - tests/integration/chat-api.test.ts
    - tests/integration/chat-streaming.test.ts
    - tests/harness/scenarios/image-log.ts
    - tests/harness/scenarios/image-log-failure.ts
    - tests/integration/verification-image.test.ts
commits:
  - 438b544
  - ec95f25
  - 3e387b0
  - 4678bf0
---

# Quick Task 260516-5ei Summary

Strengthened false-log defenses and regression evidence for v2.2 pre-PR review findings.

## Completed Work

| Task | Result | Commit |
| --- | --- | --- |
| Guard no-mutation model replies | Added `guardNoMutationLoggingClaim`, wired JSON and SSE paths, removed stale reachable prompt copy containing `headline` and `保守估算`, and added unit/integration coverage for persisted and streamed replies. | 438b544, 3e387b0 |
| Recognize grouped serving quantities | Treated top-level grouped serving metadata such as `一份`, `半碗`, and `兩份` as quantity evidence without relying on source text. | ec95f25 |
| Harden image harness proof | Made image-log chunk parsing fail on malformed/empty chunks, required `done.loggedMeal` receipt shape proof, and recorded false-log chunk evidence for image failure paths. | 4678bf0 |

## Changed Files

- `server/orchestrator/index.ts`
- `server/orchestrator/system-prompt.ts`
- `server/orchestrator/tools.ts`
- `server/routes/chat.ts`
- `tests/unit/orchestrator.test.ts`
- `tests/unit/system-prompt.test.ts`
- `tests/unit/tools.test.ts`
- `tests/integration/chat-api.test.ts`
- `tests/integration/chat-streaming.test.ts`
- `tests/harness/scenarios/image-log.ts`
- `tests/harness/scenarios/image-log-failure.ts`
- `tests/integration/verification-image.test.ts`

## Verification

| Command | Result |
| --- | --- |
| `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/orchestrator.test.ts tests/unit/system-prompt.test.ts tests/unit/tools.test.ts tests/integration/chat-api.test.ts tests/integration/verification-image.test.ts` | PASS |
| `! rg -n "headline|保守估算" server/orchestrator/system-prompt.ts` | PASS |
| `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/chat-streaming.test.ts` | PASS |
| `yarn verify:harness -- image-log-failure` | PASS |
| `yarn verify:harness -- image-log` | PASS |
| `yarn verify:harness -- protein-trust` | PASS |
| `yarn test:unit` | PASS |
| `yarn tsc --noEmit` | PASS |
| `yarn release:check` | PASS |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Avoided `Array.prototype.findLast` for the current TypeScript target**
- **Found during:** `yarn tsc --noEmit`
- **Issue:** The new integration assertions used `findLast`, which is unavailable under the repo's configured library target.
- **Fix:** Replaced it with reverse-and-find over a copied history array.
- **Files modified:** `tests/integration/chat-api.test.ts`
- **Commit:** 3e387b0

**2. [Rule 1 - Bug] Preserved safe progressive streaming for no-mutation replies**
- **Found during:** `yarn release:check`
- **Issue:** The initial no-mutation guard buffered all model text and regressed stopped-stream partial persistence/progressive streaming expectations.
- **Fix:** Replaced full buffering with a short rolling false-log detector that streams safe prefixes while suppressing claims such as `已記錄` and `完成記錄`.
- **Files modified:** `server/routes/chat.ts`, `tests/integration/chat-streaming.test.ts`
- **Commit:** 3e387b0

## Known Stubs

None.

## Threat Flags

None.

## Blockers

None.

## Self-Check: PASSED

- Found summary file at `.planning/quick/260516-5ei-fix-code-review-findings-for-v2-2-pre-pr/260516-5ei-SUMMARY.md`.
- Verified commits exist: `438b544`, `ec95f25`, `3e387b0`, `4678bf0`.
