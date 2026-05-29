---
phase: 68
slug: structured-tool-results-and-release-proof-gate
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-29
---

# Phase 68 - Validation Strategy

Per-phase validation contract for structured tool-result plumbing and v2.4 local release proof.

## Test Infrastructure

| Property | Value |
|----------|-------|
| Framework | Node built-in `node:test` through repo scripts |
| Config file | none; scripts pass `--import tsx --test` |
| Quick run command | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/tools.test.ts tests/unit/orchestrator.test.ts` |
| Full suite command | `yarn test`; closure gate `yarn release:check` |
| Estimated runtime | Targeted unit commands should stay under a few minutes; `release:check` is the final local gate |

## Sampling Rate

- After every TypeScript task commit: run the targeted unit or integration command matching touched files, plus `yarn tsc --noEmit`.
- After route/service changes: run the affected integration suite.
- Before phase verification: run `yarn tsc --noEmit` and `yarn release:check`.
- Max feedback latency: use targeted Node test commands during implementation; reserve `release:check` for closure.

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 68-W0-tools | TBD | 0 | TARGET-03 | T-68-01 | Tool calls expose typed clarification facts without leaking raw contract payloads to `index.ts` | unit | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/tools.test.ts` | yes | pending |
| 68-W0-orchestrator | TBD | 0 | TARGET-03 | T-68-02 | Terminal clarification replies are renderer-owned and do not consume a second LLM response | unit/source scan | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/orchestrator.test.ts` | yes | pending |
| 68-route-json-sse | TBD | TBD | PROOF-01 | T-68-03 | JSON/SSE terminal clarification has no mutation, no summary, no publish, and persists assistant reply | integration | `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/chat-api.test.ts tests/integration/chat-streaming.test.ts` | yes | pending |
| 68-correction-carry-forward | TBD | TBD | PROOF-01 | T-68-04 | Existing v2.4 correction authority, target ranking, and clarification behavior remain covered after the refactor | unit/integration | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/meal-correction.test.ts tests/integration/chat-meal-correction.integration.test.ts` | yes | pending |
| 68-metadata-proof | TBD | TBD | PROOF-02 | T-68-05 | Verification evidence and trace surfaces remain metadata-only and raw-payload-free | unit | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/verification-artifacts.test.ts` | yes | pending |
| 68-release-closure | TBD | final | PROOF-03 | T-68-06 | Local closure passes without push, merge, deploy, Railway smoke, staging promotion, or main promotion | command gate | `yarn tsc --noEmit && yarn release:check` | yes | pending |

## Wave 0 Requirements

- [ ] Extend `tests/unit/tools.test.ts` for typed clarification facts on `find_meals`, historical `log_food`, and historical `get_daily_summary`.
- [ ] Extend `tests/unit/orchestrator.test.ts` for historical terminal renderer ownership, no second LLM pass, and a source guard against serialized clarification-result reparsing.
- [ ] Keep harness creation out of the default plan unless implementation identifies a concrete false-pass risk that normal tests cannot close.

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Promotion boundary | PROOF-03 | Promotion requires explicit current-thread approval and is outside Phase 68 local closure | Confirm `68-VERIFICATION.md` states no push, merge, deploy, Railway smoke, staging promotion, or main promotion was performed |

## Validation Sign-Off

- [x] All planned behavior families have an automated proof path or explicit manual promotion-boundary check.
- [x] Sampling continuity uses targeted unit/integration checks before the final release gate.
- [x] Wave 0 covers missing structured-result and terminal-renderer proof.
- [x] No watch-mode flags.
- [x] `nyquist_compliant: true` set in frontmatter.

**Approval:** pending
