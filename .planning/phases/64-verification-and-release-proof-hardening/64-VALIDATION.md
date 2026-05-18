---
phase: 64
slug: verification-and-release-proof-hardening
status: draft
nyquist_compliant: true
wave_0_complete: true
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
| 64-01-01 | 64-01 | 1 | PROOF-03 | T-64-01, T-64-02, T-64-03 | Baseline local release gate is classified without staging/main promotion | release gate | `yarn release:check` | yes | pending |
| 64-01-02 | 64-01 | 1 | PROOF-03 | T-64-02 | Baseline failure policy records green triage, A/B blockers, or routine Bucket C deferrals without silent pass | proof record | `grep -Eq 'A/B/C|Bucket A|Bucket B|Bucket C|empty at baseline' .planning/phases/64-verification-and-release-proof-hardening/64-VERIFICATION.md` | yes | pending |
| 64-02-01 | 64-02 | 2 | PROOF-02 | T-64-04, T-64-05, T-64-07 | Phase 64 metadata sweep test records metadata only and no Tier 1/Tier 2 payloads | unit + sweep | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/phase64-metadata-sweep.test.ts && yarn tsc --noEmit && yarn test:unit` | to create | pending |
| 64-02-02 | 64-02 | 2 | PROOF-02 | T-64-04, T-64-05, T-64-06, T-64-07 | PROOF-02 report records inspected surfaces, counts, escalation status, and D-39 producer-path remediation for persisted matches | unit + proof record | `grep -q 'PROOF-02 Metadata-Only Sweep' .planning/phases/64-verification-and-release-proof-hardening/64-VERIFICATION.md && node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/phase64-metadata-sweep.test.ts tests/unit/verification-artifacts.test.ts tests/unit/llm-chat-trace.test.ts` | yes | pending |
| 64-03-01 | 64-03 | 3 | PROOF-01 | T-64-08, T-64-09, T-64-10, T-64-11 | All five PROOF-01 behavior families are backed by passing evidence or specific false-pass gaps | unit + integration | `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/update-goals-contract.test.ts tests/integration/chat-goal-update.integration.test.ts && node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/tools.test.ts tests/integration/chat-api.test.ts tests/integration/chat-streaming.test.ts tests/integration/meals-api.test.ts && node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/chat-meal-correction.integration.test.ts tests/integration/meals-api.test.ts && node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/sse-client.test.ts tests/unit/sse-summary-coordinator.test.ts tests/integration/sse.test.ts` | yes | pending |
| 64-03-02 | 64-03 | 3 | PROOF-01 | T-64-10, T-64-11 | Behavior-test gap decision is recorded without broad tests or default harness unless a D-34 trigger exists | proof record | `grep -Eq 'No new PROOF-01 behavior tests added|False-pass gap|PROOF-01 Coverage' .planning/phases/64-verification-and-release-proof-hardening/64-VERIFICATION.md` | yes | pending |
| 64-04-01 | 64-04 | 4 | PROOF-03 | T-64-12, T-64-14, T-64-15 | Closure TypeScript and release gates are recorded metadata-only without promotion | release gate | `yarn tsc --noEmit && yarn release:check` | yes | pending |
| 64-04-02 | 64-04 | 4 | PROOF-01, PROOF-02, PROOF-03 | T-64-13, T-64-14, T-64-15 | Final proof status maps PROOF-01/02/03 and records no staging/main promotion | proof record | `grep -q 'PROOF-01' .planning/phases/64-verification-and-release-proof-hardening/64-VERIFICATION.md && grep -q 'PROOF-02' .planning/phases/64-verification-and-release-proof-hardening/64-VERIFICATION.md && grep -q 'PROOF-03' .planning/phases/64-verification-and-release-proof-hardening/64-VERIFICATION.md && grep -Eqi 'no staging|no main|staging/main' .planning/phases/64-verification-and-release-proof-hardening/64-VERIFICATION.md` | yes | pending |

## Plan-Owned Setup Requirements

- `64-01` creates or updates `64-VERIFICATION.md` with the baseline gate table and A/B/C triage path.
- `64-02` creates the Phase 64 denylist registry inside `tests/unit/phase64-metadata-sweep.test.ts`, defines the metadata-only sweep for `tests/harness/artifacts/**`, and records PROOF-02 tables.
- `64-03` adds the PROOF-01 behavior-family coverage table and gap/no-gap decision.
- `64-04` records closure TypeScript/release gates, final PROOF-01/02/03 status, and any approved Bucket C limitations.

Existing Node test infrastructure covers the behavior-test requirements. Setup is owned by the executable plans above rather than a separate pre-execution wave.

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Bucket C closeout exception approval | PROOF-03 | User approval is required if release gate remains red for unrelated Bucket C failures | Present exact Bucket C items and wait for current-thread approval before recording deferred/blocked closeout |
| Gray-zone evidence persistence boundary | PROOF-02 | Request logging, trace callbacks, or CI stdout capture may require project-owner judgment | Escalate path, metadata, match count, and proposed handling without raw matched content |
| Staging/main promotion boundary | PROOF-03 | Promotion is explicitly outside Phase 64 scope | Verify no push, merge, deploy, or promotion command is included in execution evidence |

## Validation Sign-Off

- [x] All known tasks have automated verify commands.
- [x] Sampling continuity avoids three consecutive implementation tasks without automated verification.
- [x] Sweep/proof setup references are assigned to executable plans.
- [x] No watch-mode flags are used.
- [x] `nyquist_compliant: true` is set in frontmatter.

**Approval:** pending
