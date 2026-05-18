---
phase: 64
slug: verification-and-release-proof-hardening
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-19
---

# Phase 64 - Validation Strategy

Per-phase validation contract for feedback sampling during execution.

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node built-in `node:test` with `tsx` |
| **Config file** | `package.json` scripts; no separate test config |
| **Quick run command** | `node scripts/run-node-with-tz.mjs --import tsx --test <files>` |
| **Full suite command** | `yarn test` |
| **Release gate command** | `yarn release:check` |
| **Estimated runtime** | Targeted tests: seconds to minutes; release gate: full local gate |

## Sampling Rate

- **After every task commit:** Run the targeted command for files touched by the task, using the AGENTS.md verification matrix.
- **After every plan wave:** Run the relevant targeted test group plus `yarn tsc --noEmit` for TypeScript edits.
- **Before `$gsd-verify-work`:** Run `yarn tsc --noEmit` and `yarn release:check`.
- **Max feedback latency:** Prefer targeted commands during implementation; reserve full release gate for baseline and closure.

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 64-01-01 | TBD | 1 | PROOF-03 | T-64-01 | Baseline local release gate is classified without staging/main promotion | release gate | `yarn release:check` | yes | pending |
| 64-02-01 | TBD | 1 | PROOF-02 | T-64-02 | Evidence sweep records metadata only and no Tier 1/Tier 2 payloads | unit + sweep | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/verification-artifacts.test.ts tests/unit/llm-chat-trace.test.ts` plus planner-selected sweep command | partial | pending |
| 64-03-01 | TBD | 2 | PROOF-01 | T-64-03 | Goal proposal authority and failed-goal copy are backed by passing evidence or focused false-pass tests | unit + integration | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/update-goals-contract.test.ts tests/integration/chat-goal-update.integration.test.ts` | yes | pending |
| 64-03-02 | TBD | 2 | PROOF-01 | T-64-04 | Summary-failure committed outcomes are backed by passing evidence or focused false-pass tests | unit + integration | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/tools.test.ts tests/integration/chat-api.test.ts tests/integration/chat-streaming.test.ts tests/integration/meals-api.test.ts` | yes | pending |
| 64-03-03 | TBD | 2 | PROOF-01 | T-64-05 | Stale receipt rejection is backed by passing evidence or focused false-pass tests | unit + integration | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/tools.test.ts tests/integration/chat-meal-correction.integration.test.ts tests/integration/meals-api.test.ts` | yes | pending |
| 64-03-04 | TBD | 2 | PROOF-01 | T-64-06 | SSE meal-row freshness is backed by passing evidence or focused false-pass tests | unit + integration | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/sse-client.test.ts tests/unit/sse-summary-coordinator.test.ts tests/integration/sse.test.ts` | yes | pending |
| 64-04-01 | TBD | 3 | PROOF-01, PROOF-02, PROOF-03 | T-64-07 | `64-VERIFICATION.md` records metadata-only closure evidence and no raw payloads | release gate | `yarn tsc --noEmit && yarn release:check` | yes | pending |

## Wave 0 Requirements

- [ ] Define the Phase 64 denylist registry from Tier 1 plus operational Tier 2 terms.
- [ ] Define the metadata-only sweep command or focused test/script for `tests/harness/artifacts/**`, structured logs, trace facts, and route/orchestrator evidence paths.
- [ ] Create `64-VERIFICATION.md` with tables for baseline gate, PROOF-01 coverage, PROOF-02 sweep, closure gates, and escalations.

Existing Node test infrastructure covers the behavior-test requirements. Wave 0 exists to establish the sweep/proof artifacts rather than install new tooling.

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Bucket C closeout exception approval | PROOF-03 | User approval is required if release gate remains red for unrelated Bucket C failures | Present exact Bucket C items and wait for current-thread approval before recording deferred/blocked closeout |
| Gray-zone evidence persistence boundary | PROOF-02 | Request logging, trace callbacks, or CI stdout capture may require project-owner judgment | Escalate path, metadata, match count, and proposed handling without raw matched content |
| Staging/main promotion boundary | PROOF-03 | Promotion is explicitly outside Phase 64 scope | Verify no push, merge, deploy, or promotion command is included in execution evidence |

## Validation Sign-Off

- [x] All known tasks have automated verify commands or Wave 0 dependencies.
- [x] Sampling continuity avoids three consecutive implementation tasks without automated verification.
- [x] Wave 0 covers missing sweep/proof setup references.
- [x] No watch-mode flags are used.
- [x] `nyquist_compliant: true` is set in frontmatter.

**Approval:** pending
