---
phase: 76
slug: grouped-meal-edit-ui-and-conditional-item-media-decision
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-03
---

# Phase 76 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node built-in `node:test` with `tsx` |
| **Config file** | `scripts/run-node-with-tz.mjs`; no Jest/Vitest config |
| **Quick run command** | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-edit-screen.test.ts tests/unit/api-client.test.ts tests/unit/meal-edit-payload.test.ts tests/unit/meal-edit-refresh.test.ts` |
| **Full suite command** | `yarn test` |
| **Estimated runtime** | ~60-180 seconds for targeted unit checks; full suite varies |

---

## Sampling Rate

- **After every task commit:** Run the targeted command for files touched by the task plus `yarn tsc --noEmit` for TypeScript edits.
- **After every plan wave:** Run `yarn test:unit`; if `server/routes/*.ts` or `server/services/*.ts` changed, also run `yarn test:integration`.
- **Before `$gsd-verify-work`:** Run `yarn tsc --noEmit` and all targeted unit/integration checks required by changed paths.
- **Max feedback latency:** One task commit without an automated check is acceptable only for source-contract test authoring; no two consecutive implementation tasks should skip automated verification.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 76-01-01 | 01 | 1 | GROUP-UI-01 | T-76-01 | Grouped editor controls render only from authoritative item details | unit/source | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-edit-screen.test.ts` | yes | pending |
| 76-01-02 | 01 | 1 | GROUP-UI-02 | T-76-02 | Invalid grouped drafts block save before network mutation | unit/source | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-edit-screen.test.ts` | yes | pending |
| 76-02-01 | 02 | 1 | GROUP-UI-01 | T-76-03 | Grouped payload builds full ordered `items[]` with contiguous zero-based positions | unit | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-edit-grouped-draft.test.ts` | no - create if helper extracted | pending |
| 76-02-02 | 02 | 1 | MEDIA-DECISION-01 | T-76-04 | Grouped item edits do not add item media fields or grouped PATCH image fields | unit/source | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-edit-payload.test.ts tests/unit/api-client.test.ts` | yes | pending |
| 76-03-01 | 03 | 2 | GROUP-UI-03 | T-76-05 | Successful grouped saves refresh through authoritative DTO/store paths | unit/integration | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-edit-refresh.test.ts tests/integration/meals-api.test.ts` | yes | pending |
| 76-03-02 | 03 | 2 | GROUP-UI-02 | T-76-06 | Stale conflicts stale-block grouped Save/Delete and expose recovery | unit/source | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-edit-screen.test.ts tests/unit/api-client.test.ts` | yes | pending |

*Status: pending / green / red / flaky*

---

## Wave 0 Requirements

- [ ] `tests/unit/meal-edit-screen.test.ts` - replace grouped-lock source expectations with grouped editor, validation, dirty discard, stale recovery, unsupported state, and media-defer contracts.
- [ ] `tests/unit/api-client.test.ts` - add grouped `updateMeal` body pass-through and grouped stale conflict proof.
- [ ] `tests/unit/meal-edit-grouped-draft.test.ts` - create only if grouped draft parsing/validation is extracted into `client/src/meal-edit-grouped-draft.ts`.
- [ ] `tests/integration/meals-api.test.ts` - update only if `/api/meals` starts returning grouped `items[]`; assert flat item details and no media fields.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Mobile grouped edit ergonomics | GROUP-UI-01 | Source contracts can prove controls/copy, but final density and row expansion need browser inspection | Run the client locally, open a grouped meal in Meal Edit on a mobile viewport, verify one expanded row, 44px controls, no overlap, and visible live totals. |
| Whole-meal image copy does not imply item evidence | MEDIA-DECISION-01 | Copy can be source-tested, but visual placement beside rows should be inspected | Confirm the image remains above the grouped editor and no row displays thumbnails, crops, badges, or item-evidence language. |

---

## Validation Sign-Off

- [x] All tasks have automated verify commands or explicit Wave 0 dependencies.
- [x] Sampling continuity: no two consecutive implementation tasks should proceed without automated verification.
- [x] Wave 0 covers currently missing grouped editor and grouped transport source contracts.
- [x] No watch-mode flags.
- [x] Feedback latency target is bounded by targeted Node/Yarn checks.
- [x] `nyquist_compliant: true` set in frontmatter.

**Approval:** approved 2026-06-03
