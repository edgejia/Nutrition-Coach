# GSD Re-enable Readiness Report

- Decision status: **DECISION_REQUIRED — pause remains active**
- Evidence cutoff: **2026-07-16 Asia/Taipei**
- Temporary GSD Maintenance Pause: **ACTIVE**
- Hardening implementation commit: `060734d393db36d2241d42d46ad340b8c8a8cb33`

This report is a maintainer decision aid. It does not lift the pause, resume v3.4.1 or Phase 115, repair `.planning/**`, authorize a source merge, or authorize production, migration, runtime refresh, Tunnel, or public-smoke work. A tool pass is evidence for the bounded claim named below, not automatic authority for a later workflow step.

## Snapshot identity

| Evidence | Observed value |
| --- | --- |
| local branch | `codex/workflow-hardening`, local-only and not pushed |
| hardening source | `060734d393db36d2241d42d46ad340b8c8a8cb33` |
| readiness evidence source baseline | `49311890ffa393b2ee10b09ed10065a58501ae3d` |
| `origin/main` | `a84370bf0c207b2d3305156ce5baf13c0335f02e` |
| main ruleset | `main-source-release`, ID `18989827`, active, no bypass actors |
| ruleset history | version ID `43165861` |
| required check | strict `Release Check`, GitHub Actions integration ID `15368` |
| remote disposable state | PR #114 closed/unmerged; no open PR, canary ref, temporary ruleset, scratch, or remote `codex/*` branch at the evidence cutoff |
| production side effects | none |
| real `.planning/**` mutation | none |

Every remote claim must be queried again immediately before a decision. The tracked commit and this report do not make a GitHub snapshot fresh.

## Readiness matrix

| Area | Deterministic evidence | Current decision state |
| --- | --- | --- |
| Wave 1.1 — source enforcement | Ruleset configuration/history/effective `main` rules read back as PR + strict App-bound check + deletion + non-fast-forward. The approved exact canary used temporary mirror ruleset ID `19028500`: a normal fast-forward push was rejected with GH013, deletion was rejected with HTTP 422, and failed-check PR #114 was `BLOCKED`. | **IMPLEMENTED AND BEHAVIORALLY VERIFIED WITH A CONTROLLED MIRROR; maintainer acceptance required.** The canary never pushed or merged `main`; non-fast-forward remains API-only because force-push is forbidden. A passing merge and same-PR workflow immutability were not proven. All disposable resources were identity-checked and removed. |
| Wave 1.2 — production recovery | Recovery group **47/47**: real-WAL backup/migration/restore rehearsal, full logical DB digests, signed request/manifest/receipt freshness, config-neutral Git proof, hardlink rejection, no-replace publication, and collision/substitution preservation. | **IMPLEMENTED AND LOCALLY VERIFIED; maintainer acceptance required.** Production B01/R05/B02/R06 remains unauthorized. B01 requires write quiescence while provenance remains available; B02 still needs a durable single-use approval ledger. Bind-mount aliases, directory replacement without `RENAME_NOREPLACE`, and physical power-loss reconciliation remain residual risks. |
| Wave 1.3 — deployment order | Contract fixtures in the final aggregate bind PR-ready branch → PR/CI → human merge → post-merge local archive → separate runtime refresh, followed separately by B01 → R05 → R06 and Tunnel/smoke approvals. | **IMPLEMENTED AND VERIFIED.** No merge, archive, runtime, or production action was performed. |
| Wave 2 — structured receipt | Enforcement group **123/123** covers caller-bound signed receipts, reservation/final CAS, first failing child from process identity rather than child text, absolute deadline, process-group cleanup, privacy allowlist, stale-source rejection, and receipt misclassification regressions. | **IMPLEMENTED AND VERIFIED.** The frozen R03 result remains only `full_test_suite` exit 1; its historical `test_timeout_or_cancelled` locator was not adopted, investigated, repaired, or retried. |
| Wave 2 — state and verification freshness | State suite **17/17** plus verification-seal and artifact-provenance fixtures. The live checker fails closed with exactly five known frozen drift codes and no writeback. | **IMPLEMENTED AND VERIFIED; live state intentionally not ready.** Real `.planning/**` remains frozen. Seal/provenance activation in a real verifier is a post-decision wiring step, not permission to mutate during the pause. |
| Wave 2 — closeout determinism | Historical flat and canonical fixtures prove normalize rerun idempotence, exact terminal STATE/ROADMAP/MILESTONES semantics, signed journal/fences, content and identity freshness, hardlink rejection, and destructive recurrence detection. | **IMPLEMENTED AND VERIFIED.** A successful tool result is not post-merge archive authority; the complete child lifecycle still needs the governed launcher and a separately valid closeout authorization. |
| Wave 3 — planning proof | Plan-proof suite **28/28**, wiring suite **14/14**, tracked planning-proof skill/guidance, exact checker allowlist, closed command grammar, full negative-control suites, and historical false-pass/legitimate-alternative fixtures. | **TOOLING IMPLEMENTED AND VERIFIED; activation conditional.** The real `gsd-planner` and `gsd-plan-checker` bindings are deliberately absent while the pause is active. Applying them requires a later maintainer-approved transition. |
| Wave 4 — provenance and lease | Holder-derived runtime provenance, private capability delegation, signed transition ledger, predecessor-signed live handoff, active/inactive transition invariants, writer fences, and fail-closed takeover/corrupt-mutex paths pass the targeted enforcement aggregate. | **IMPLEMENTED BUT BLOCKING FOR UNCONDITIONAL RE-ENABLE.** Real GSD entrypoints are not activated. Expired takeover and malformed-mutex recovery lack an independently durable authority. A same-account actor can erase a complete local ledger plus attestations without an external append-only head. Physical power-loss behavior remains unproven. |
| Wave 4 — parity and telemetry | Parity unit **9/9** and live result `status: pass`, `readiness: not_ready`; telemetry fixtures bind source/holder/bundle, preserve crash/reconciliation states, minimize data, and demonstrate the detached-child counterexample. | **NOT READY.** Five matrix rows remain blocking and one is deferred. Detached/`setsid` descendants and egress are not contained by an approved macOS boundary. Three representative phases and a trusted run-delta adapter do not exist, so Sol/Luna routing claims must remain deferred. |
| Pilot | Pilot seed contract **15/15** verifies standalone-clone identity, canonical roots, Git-environment sanitization, exclusive publication, repeated terminal evidence, and lock/evidence preservation. | **BLOCKED, NOT APPROVED, NOT EXECUTED.** No approved macOS process container or enforceable egress control exists. The maintainer must explicitly defer the pilot or first approve a revised containment design and later an exact execution bundle. |

## Live verifier evidence

`yarn workflow:runtime-parity` from the clean readiness-evidence baseline `49311890ffa393b2ee10b09ed10065a58501ae3d` returned:

```text
status: pass
readiness: not_ready
sourceSha: 49311890ffa393b2ee10b09ed10065a58501ae3d
matrixSha256: 9216675cae90b7df0d316884aa76157638582974cfb4635d4023bbbea145ed80
projectVerifierBundleSha256: c0048cdae5984a2d752baa89f59f249dbc04f1e1a652d235cb5218a8ea26288c
evidenceSnapshotSha256: e2cda0e9b7139f866cd1dcb487497284600dbcce4accfef586bb53759153011b
rows: 4 equivalent, 1 intentional_difference, 5 blocking, 1 deferred
expected wiring findings: gsd-plan-checker missing; gsd-planner missing
unexpected findings: none
```

`yarn workflow:state-check` returned exit 1 as the required fail-closed live result:

```text
planningTreeSha256: 9e4dce55f3c529167f8c3a2f885f1058f3c201eab1deadda7833d5f7c0e1058d
roadmap_progress_mismatch
roadmap_summary_completion_mismatch
state_completed_plan_count_mismatch
state_internal_plan_count_mismatch
state_session_continuity_stopped_at_mismatch
```

No repair flag or writeback path was used.

## Verification ledger

The final targeted command selected the following 20 files and reported **22 suites, 344 tests, 344 pass, 0 fail**. Test 344 is the tracked report's own non-authority/evidence contract.

```text
node scripts/run-node-with-tz.mjs --import tsx --test \
  tests/unit/demo-runbook-contract.test.ts \
  tests/unit/release-check.test.ts \
  tests/unit/reviewer-tour-contract.test.ts \
  tests/unit/artifact-provenance.test.ts \
  tests/unit/command-receipt.test.ts \
  tests/unit/deployment-runbook-contract.test.ts \
  tests/unit/gsd-pilot-seed.test.ts \
  tests/unit/gsd-wiring.test.ts \
  tests/unit/plan-proof-lint.test.ts \
  tests/unit/planning-closeout.test.ts \
  tests/unit/pr-check-workflow-contract.test.ts \
  tests/unit/production-recovery.test.ts \
  tests/integration/production-recovery-rehearsal.test.ts \
  tests/unit/runtime-parity.test.ts \
  tests/unit/tree-fingerprint.test.ts \
  tests/unit/verification-seal.test.ts \
  tests/unit/workflow-governance-docs.test.ts \
  tests/unit/workflow-lease.test.ts \
  tests/unit/workflow-state-check.test.ts \
  tests/unit/workflow-telemetry.test.ts
```

Additional results:

| Command/check | Result |
| --- | --- |
| `yarn tsc --noEmit` | pass |
| `yarn matrix:check` | 13/13 plus generated-doc check pass |
| `yarn behavior-matrix:gen:check` | pass |
| `yarn policy-taxonomy:check` | 3/3 plus generated-doc check pass |
| `node --check` on every workflow/release script | pass |
| package/parity/compatibility JSON parsing | pass |
| both Actions YAML files parsing | pass |
| `git diff --cached --check` before the implementation commit | pass |
| `git diff HEAD^ -- .planning` | empty |

The following broad commands were deliberately **not run**:

- `yarn test` and `yarn release:check`, because the maintainer froze the Phase 115 R03 full-suite boundary and prohibited investigation/retry;
- `yarn build`, because it can rewrite the serving `dist` tree and is not needed for these workflow-only targeted claims.

The targeted result must not be presented as a full release gate.

## Wave 1.1 controlled canary ledger

The maintainer approved `APPROVE RULESET CANARY BUNDLE 20260716-060734d3`. The bounded behavioral proof produced:

| Evidence | Verified result |
| --- | --- |
| fixed identity | base and unchanged `main`: `a84370bf0c207b2d3305156ce5baf13c0335f02e`; source marker commit: `cc6755bdbf69f34157d3f6bf66af10c58be29402`, whose only changed path was the approved marker |
| temporary enforcement | active exact-target mirror ruleset ID `19028500`, no bypass, `current_user_can_bypass: never`, with PR + strict App `15368` `Release Check` + deletion + non-fast-forward |
| normal fast-forward probe | rejected with GH013: changes must be made through a pull request and `Release Check` was expected; target SHA remained the fixed base |
| deletion probe | rejected with HTTP 422, `Cannot delete this branch`; target SHA remained the fixed base |
| failed-check PR | PR #114, source `cc6755b…` to fixed-base `main`, reached `mergeStateStatus: BLOCKED`; Actions run `29473605875`, job/check-run `87541721750`, App ID `15368`, conclusion `failure` |
| actionable failure | `Run PR policy` reported no linked issue and no changelog update/label; later release steps were skipped, so the failure was intentional rather than an unrelated test or infrastructure failure |
| never-merge boundary | PR #114 was closed with `mergedAt: null`; no merge endpoint was called and `main` was never pushed, deleted, or rewritten |
| cleanup | PR closed; ruleset ID `19028500`, target ref, and source ref independently returned 404; exact target effective rules returned `[]`; scratch absent |
| post-cleanup invariant | `main` SHA, main ruleset ID `18989827`, ruleset history version `43165861`, and its four rules were unchanged; open PR list was empty |

This establishes behavior for an exact disposable mirror plus failed-check blocking on the real `main` PR path. It does not establish a force-push/non-fast-forward probe, a passing PR merge, or immunity against a PR modifying the same-repository `Release Check` workflow.

## Required maintainer decisions

Before the pause can be reconsidered, the maintainer must independently decide each open item:

1. Accept the bounded Wave 1.1 mirror/failed-check evidence and its named residuals, or continue the pause pending stronger independently protected required-workflow proof.
2. Accept the non-production recovery contract and its named production residuals, or continue the pause pending stronger recovery authority/proof.
3. Approve a post-pause activation transition for the two planning-proof role bindings and governed real entrypoints, or explicitly defer activation.
4. Accept deferral of the external lease-ledger trust anchor, physical power-loss proof, detached-child/egress containment, representative telemetry, and routing reevaluation—or keep the pause active.
5. Explicitly choose **resume** or **continue-defer** in the current thread. No prior approval, test result, canary result, or document edit substitutes for this final choice.

The required-check workflow is still source in the same repository that a pull request can edit. Ruleset behavioral proof can establish branch/ruleset enforcement, but cannot prove that a future PR cannot weaken the `Release Check` implementation itself. Moving enforcement to an independently protected required workflow or equivalent immutable authority remains a governance defer decision.

## Side-effect and cleanup statement

The only approved external-write bundle created two disposable refs, source marker commit `cc6755bdbf69f34157d3f6bf66af10c58be29402`, temporary ruleset ID `19028500`, and PR #114. The normal push and deletion probes were rejected; the PR was never merged. Cleanup closed the PR and removed the exact ruleset, refs, and scratch after identity checks. No temporary remote resource exists.

There was no hardening-branch push, issue, merge, tag, production migration, restore, runtime refresh, Tunnel change, public smoke, or GSD mutation. The main SHA/ruleset/history were unchanged, the ignored collaborative handoff is not staged or committed, and the real `.planning/**` tree was not changed. The pause remains active until the maintainer explicitly chooses `resume`; `continue-defer` keeps it active.
