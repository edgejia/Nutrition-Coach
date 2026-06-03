---
phase: 74
slug: home-meal-edit-entry-and-existing-edit-contract-review
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-06-02
---

# Phase 74 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node built-in `node:test` through `tsx` |
| **Config file** | `package.json` scripts; `scripts/run-node-with-tz.mjs` preserves `TZ=Asia/Taipei` |
| **Quick run command** | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/home-dashboard-contract.test.ts tests/unit/meal-edit-payload.test.ts tests/unit/meal-edit-screen.test.ts tests/unit/meal-edit-refresh.test.ts` |
| **Full suite command** | `yarn test` plus `yarn matrix:check` |
| **Estimated runtime** | ~60-180 seconds for focused checks; full suite depends on integration load |

---

## Sampling Rate

- **After every task commit:** Run the focused command for files changed by that task.
- **After capability matrix edits:** Run `yarn matrix:check`; run `yarn matrix:gen` first if generated docs are stale.
- **After any TypeScript edit:** Run `yarn tsc --noEmit`.
- **After server route/service contract proof:** Run `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/meals-api.test.ts`.
- **Before `$gsd-verify-work`:** `yarn tsc --noEmit`, focused unit/source checks, `yarn matrix:check`, and `tests/integration/meals-api.test.ts` must be green.
- **Max feedback latency:** Keep task-local feedback under 3 minutes unless running the full suite.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 74-W0-01 | TBD | 0 | HOME-EDIT-01 | T-74-03 | Home does not fabricate edit identity for incomplete rows. | unit/source contract | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/home-dashboard-contract.test.ts tests/unit/meal-edit-payload.test.ts` | yes | pending |
| 74-W0-02 | TBD | 0 | HOME-EDIT-02 | T-74-04 | Capability matrix source and generated docs agree with implemented Home and Day Detail handlers. | generated-doc check | `yarn matrix:check` | yes | pending |
| 74-W0-03 | TBD | 0 | EDIT-BASE-01 | T-74-01 | Save/delete continue to send `expectedMealRevisionId` and refresh through shared mutation helper. | unit/source contract | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-edit-screen.test.ts tests/unit/meal-edit-refresh.test.ts` | yes | pending |
| 74-W0-04 | TBD | 0 | EDIT-BASE-01 | T-74-01 / T-74-02 | Missing/stale revisions and grouped direct PATCH remain server-rejected. | integration | `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/meals-api.test.ts` | yes | pending |
| 74-W0-05 | TBD | 0 | HOME-EDIT-01, HOME-EDIT-02, EDIT-BASE-01 | - | All edited TypeScript remains type-correct. | static | `yarn tsc --noEmit` | yes | pending |

*Status: pending, green, red, flaky*

---

## Wave 0 Requirements

- [ ] `tests/unit/home-dashboard-contract.test.ts` - update read-only Home row assertions to cover eligible button semantics and ineligible silent fallback.
- [ ] `tests/unit/meal-edit-payload.test.ts` - add nullable safe-wrapper coverage if the helper lands in `client/src/meal-edit-payload.ts`.
- [ ] `tests/unit/meal-edit-screen.test.ts` - prove grouped-lock behavior and Home-origin back-label behavior where changed.
- [ ] `tests/unit/capability-matrix-contract.test.ts` - preserve active-handler invariants while correcting Home and Day Detail metadata.
- [ ] `docs/capability-matrix.md` - regenerate with `yarn matrix:gen` after source matrix edits.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Home row visual continuity | HOME-EDIT-01 | Source tests can prove semantics, but final visual polish is easiest to confirm in the browser. | Run the client, open Home with today meals, confirm eligible meal rows preserve existing visual hierarchy while receiving focus and hover states. |

---

## Validation Sign-Off

- [x] All tasks have automated verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all known missing references
- [x] No watch-mode flags
- [x] Feedback latency target documented
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** pending execution
