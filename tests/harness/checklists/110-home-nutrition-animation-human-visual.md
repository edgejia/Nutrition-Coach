# Phase 110 Home Nutrition Animation Human Visual Checklist

Executed by the USER personally on a mobile viewport, either DevTools device emulation or a real device, against a local dev or production build. Record metadata only; do not commit screen recordings. This checklist is the sole verdict for time-based sync perception, which is never auto-read from screenshots per D-06.

## Fixed Binary Checklist

1. [x] PASS / [ ] FAIL - On Home entry, the kcal number, completion percent, ring, macro numbers, macro percents, and bars visibly START together.
2. [x] PASS / [ ] FAIL - On Home entry, all animated nutrition elements visibly FINISH together, with neither numbers nor ring/bar fills lagging.
3. [x] PASS / [ ] FAIL - Replay visibly starts from 0 and empty ring/bars, not from a reduced offset.
4. [x] PASS / [ ] FAIL - An increasing today-meal delta reads as old-to-new count-up plus ring/bar fill growth.
5. [x] PASS / [ ] FAIL - A decreasing today-meal delta after meal update or delete reads as reverse motion/count-down.
6. [x] PASS / [ ] FAIL - An unchanged-value manual refresh still visibly replays from zero.
7. [x] PASS / [ ] FAIL - History to Home lands at the top with Home cards visible, then animates.
8. [x] PASS / [ ] FAIL - Chat to Home lands at the top, then replays when there is no today mutation or plays one delta when there is an unseen today mutation.
9. [x] PASS / [ ] FAIL - Closing settings, meal edit, or day-detail overlays causes no Home nutrition replay.
10. [x] PASS / [ ] FAIL - With reduced motion enabled, final values render with no motion.

## Metadata-Only Results

| Field | Value |
| --- | --- |
| Date | 2026-07-09 |
| Build mode (dev/production) | production bundle on local `localhost:3000` |
| Viewport size | mobile viewport user-approved; exact size not supplied in current-thread report |
| Device or emulation | not supplied in current-thread report |
| Browser | in-app browser |
| Executor | USER |
| Item 1 | PASS |
| Item 2 | PASS |
| Item 3 | PASS |
| Item 4 | PASS |
| Item 5 | PASS |
| Item 6 | PASS |
| Item 7 | PASS |
| Item 8 | PASS |
| Item 9 | PASS |
| Item 10 | PASS |
| Overall verdict | PASS |

Companion auto artifacts can be regenerated with `yarn node tests/harness/scenarios/110-home-nutrition-animation-visual.mjs --output-dir tests/harness/artifacts/110-home-nutrition-animation/latest`.
