---
phase: 60
slug: goal-proposal-authority-and-rejected-goal-copy
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-17
---

# Phase 60 - Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node built-in `node:test` with `tsx` and real SQLite |
| **Config file** | `package.json`, `scripts/run-node-with-tz.mjs`, `drizzle.config.ts` |
| **Quick run command** | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/update-goals-contract.test.ts tests/unit/orchestrator.test.ts` |
| **Full suite command** | `yarn tsc --noEmit && yarn test:unit && yarn test:integration` |
| **Estimated runtime** | ~120 seconds for full local suite; targeted unit runs should stay under 20 seconds |

---

## Sampling Rate

- **After every task commit:** Run the task-specific `node scripts/run-node-with-tz.mjs --import tsx --test ...` command from the plan.
- **After every plan wave:** Run `yarn tsc --noEmit` plus the affected unit/integration files.
- **Before `$gsd-verify-work`:** Run `yarn tsc --noEmit && yarn test:unit && yarn test:integration`; run `yarn release:check` only when preparing promotion.
- **Max feedback latency:** 120 seconds for local phase feedback.

---

## Per-Requirement Verification Map

| Requirement | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|-------------|-----------------|-----------|-------------------|-------------|--------|
| GOAL-01 | `propose_goals` creates backend pending proposal copy without changing daily targets or publishing `goals_update`. | unit + integration | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/update-goals-contract.test.ts tests/integration/chat-goal-update.integration.test.ts` | Yes | pending |
| GOAL-02 | `update_goals` mutates only from current-turn numeric values or active proposal confirmation; empty args and assistant-prose authority fail closed. | unit + integration | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/update-goals-contract.test.ts tests/integration/chat-goal-update.integration.test.ts` | Yes | pending |
| GOAL-03 | Expired, consumed, mismatched, missing, replaced, and canceled proposal states do not mutate and return deterministic Traditional Chinese guidance. | unit + integration | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/update-goals-contract.test.ts tests/integration/chat-goal-update.integration.test.ts` | Yes | pending |
| GOAL-04 | Validation and guard rejection paths preserve targets, do not publish `goals_update`, set renderer-owned final reply metadata, and avoid LLM success-style copy. | unit + integration | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/update-goals-contract.test.ts tests/unit/orchestrator.test.ts tests/integration/chat-goal-update.integration.test.ts` | Yes | pending |
| PROOF-02 support | Logs, traces, and proof artifacts remain metadata-only with no raw prompts, user text, assistant text, tool payloads, provider bodies, images, session material, or database snapshots. | unit + artifact inspection | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/update-goals-contract.test.ts tests/unit/verification-artifacts.test.ts` | Yes | pending |

---

## Wave 0 Requirements

- [ ] Add or extend unit fixtures for pending proposal lifecycle: create, overwrite, expire, clear on success, clear on cancel, consumed replay.
- [ ] Add exact-copy constants or renderer test helpers for generic proposal/authority failure, validation range failure, proposal copy, and cancel neutral copy.
- [ ] Add integration helpers that spy on `RealtimePublisher.publishGoalsUpdate` and final reply metadata for rejected/cancel paths.
- [ ] Confirm whether a dedicated harness scenario is needed after unit/integration proof exists; if not, record why integration evidence is sufficient.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Traditional Chinese deterministic copy quality | GOAL-03, GOAL-04 | Exact-copy tests prove stability but not local phrasing quality. | Product/content reviewer reads the three locked copy strings before execution closes and confirms neutral wording, no success implication, and no internal reason-code leakage. |
| Nutrition wellness boundary | GOAL-01, GOAL-02 | Existing numeric ranges are product policy; a human should confirm the proposal examples are not medical-treatment copy. | Review proposal renderer strings and examples for wellness framing only; no disease-specific treatment claim. |

---

## Validation Sign-Off

- [x] All phase requirements have automated unit or integration verification targets.
- [x] Sampling continuity defined for every task and wave.
- [x] No new test framework or watch-mode command introduced.
- [x] Feedback latency target is under 120 seconds for local phase feedback.
- [x] `nyquist_compliant: true` set in frontmatter.

**Approval:** pending
