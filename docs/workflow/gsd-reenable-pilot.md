# GSD Re-enable Pilot Contract

Status: **prepared contract, currently blocked, not approved, not executed**.

This is a low-risk behavioral proof contract for a maintainer decision. Pilot success does not lift the Temporary GSD Maintenance Pause and does not resume v3.4.1 or Phase 115. Execution requires a separate current-thread approval naming the exact source commit, two local runtime commands, cost ceiling, disposable root, and cleanup command.

Current blocking precondition: the repository's pure-Node telemetry owns only one POSIX process group and rejects `command-label=pilot`; a detached or `setsid` descendant can escape that group. No approved macOS VM/container job boundary or equivalent recovery-aware containment provider is installed, and the separately required egress enforcement is also unspecified. Therefore no exact execution bundle can yet be presented or approved. The behavioral sequence below is a future contract, not an executable instruction.

## Approval bundle

The operator must present one exact bundle before execution:

| Field | Required value |
| --- | --- |
| source | clean maintenance-branch commit SHA; no dirty or untracked input |
| location | a newly created local disposable clone outside this checkout |
| branch | exact local pilot branch name expected by the seed tool; detached HEAD or substitution is forbidden |
| remotes | removed before any workflow command; GitHub/Git/deploy/storage/Tunnel network is forbidden; only the two exact inference runtime launches may use network |
| state | synthetic `.planning` milestone/phase only; never copied from Phase 115 |
| runtimes | exact Codex and Claude CLI commands, versions, models, and reasoning-effort settings |
| cost | exact runtime launches, session/subagent count, model/effort, wall-time and command-timeout ceilings; token/currency is recorded only if a trusted provider adapter exposes it |
| data | no `.env`, SQLite database, ignored runtime durable-asset store, uploads/staging data, production manifest, Tunnel credentials, or user content; tracked static assets from the approved commit are allowed |
| writes | disposable clone/local pilot branch and commits, exact private token/receipt directory, Git-common-directory governance records, and only the exact evidence target below |
| evidence | either current-thread output only, or one exact absolute outside-root path that must not exist and is created exclusively as metadata-only `0600` evidence |
| cleanup | exact `rm -rf -- <one-disposable-root>` after preserved metadata-only receipts are summarized |

Approval is invalid if any path is missing, globbed, relative, or later substituted. Both runtime launchers, prompts, working directory, model, effort, timeout, and maximum session/subagent count must be fully expanded. Lease TTL must exceed the longest command timeout plus reconciliation margin. If any source SHA, runtime version, command, bound, or remote state drifts, stop and request a new bundle.

## Setup proof

1. Require no other writer in the original checkout. Clone the approved local commit with copied Git objects (`--no-hardlinks`), verify the approved SHA, create only the approved local pilot branch, remove every remote, and prove `git status --porcelain=v1` is empty before creating the marker. The disposable project must be a standalone primary clone whose Git common directory is the exact plain directory `<project-root>/.git`; linked worktrees, separate Git directories, bare repositories, and any sibling worktree registration are forbidden so one-root cleanup covers every pilot ref, config, and governance record. Source/pilot worktrees must be ancestor-disjoint, their Git common directories must differ, and each repository's Git common directory must also be disjoint from the other repository's worktree/common directory.
2. Prove the disposable root is neither this checkout nor either checkout's Git common directory. Record this checkout's `HEAD`, porcelain status, and metadata-only `yarn workflow:tree-fingerprint --root=<absolute-original-.planning> --summary-only=true` result before the pilot; the tool requires two consecutive identical full-tree passes. Preserve only its digest/count/byte summary, never entry paths or symlink targets.
3. Prove the disposable clone contains no private/runtime data named in the approval table. Install dependencies only from the already approved local cache; any network request other than the two exact inference launches stops the pilot.
4. Write the exact `.nutrition-gsd-pilot-root` marker and prove it is the only porcelain entry. Run `yarn workflow:pilot-seed` with the exact source root, project root, pilot ID, approved SHA, expected branch, and confirmation string. Both declared roots must already be canonical plain directories—not symlinks or paths with aliased ancestors—so the approval and cleanup scopes cannot retarget. Every lease token and receipt must likewise resolve physically outside both disposable worktree and Git common directory; private holder files must be current-user-owned, single-link `0600` files in a current-user-owned non-group/world-writable parent, and the Git-common governance directory must remain current-user-owned mode `0700`. Ambient Git routing variables (`GIT_DIR`, `GIT_WORK_TREE`, `GIT_COMMON_DIR`, `GIT_INDEX_FILE`, and object-directory or alternate-object overrides) are forbidden before any repository operation; every Git subprocess also strips all ambient `GIT_*` values and disables system/global config. The tool requires independent and cross-disjoint Git common directories, a clean source with no bypass, and matching project/source HEADs. Every Git read disables replacement refs and optional locks, including each status check, so verification cannot refresh either index. It first acquires an exclusive owner-capability pilot-seed lock, then reads only the closed path/mode/SHA-256 seed manifest from the approved commit object (never moving `HEAD`), rejects Phase 115/v3.4.1 references, builds and fsyncs a same-parent temporary tree, creates the absent `.planning`, and installs every staged directory/file with no-replace operations plus fsync. The state checker runs on the fully published tree before success; an invalid state therefore preserves the published evidence and lock for reconciliation. This is fail-closed exclusive publication, not an all-tree atomic rename: a collision or post-publication ambiguity preserves the partial evidence and lock rather than overwriting or recursively deleting concurrent bytes. The lock remains held while both Git common directories, standalone-primary-clone layout, cross-repository boundaries, canonical roots, source/project HEAD/branch/remotes/status, marker identity/digest, and the identical published tree fingerprint are rechecked. That complete bundle is repeated immediately before unlock; any new linked-worktree registration preserves the published evidence and lock. Lock identity, link count, record bytes, and the private owner capability are then revalidated after a directory durability preflight; unlink is the terminal success operation, with no fallible post-unlink check. A same-account mutation in the final check-to-unlink micro-window still requires reconciliation rather than claiming stronger host isolation. A crash may conservatively make the lock reappear, and an ambiguous unlink result likewise requires reconciliation rather than retry. No LLM or inline shell may improvise the seed.
5. Apply planner/checker bindings only to the synthetic config using its exact preimage digest, then require `yarn workflow:gsd-wiring check` to pass. The real config in this checkout remains byte-for-byte unchanged.

## Behavioral sequence

Every mutation below is lease-gated and every PLAN, SUMMARY, and VERIFICATION write is followed by a provenance stamp plus read-only check.

Before step 1, the approved containment provider must start before user command execution, persist its identity outside the child, kill and prove empty across all sessions/process groups, and expose the same empty proof to recovery. Hostile detached/double-fork fixtures must fail without a delayed marker. The current process-group-only wrapper cannot satisfy this precondition.

1. **Codex ownership:** Codex acquires the lease as the declared runtime/model and creates one synthetic PLAN whose proof commands include exact-cardinality, negative-control, read-only, and ordered assertions.
2. **Planning gate:** both planner-side and independent checker-side `plan-proof-lint` runs pass on the valid plan. Historical false-pass fixtures for OR-as-all-of, last-line-only, mutating verification, missing negative control, and one-sided cardinality must each fail with the expected rule ID.
3. **Concurrent-writer denial:** while Codex holds the live writer fence, Claude attempts the bounded lease acquisition or holder assertion only. It must fail before any artifact mutation; candidate token must not exist and pre/post tree fingerprints must match.
4. **Explicit handoff:** after the writer fence ends, read-only status captures the predecessor lease ID/digest and confirms that the predecessor lease is still live. Claude takes over with the exact `runtime_handoff` confirmation, new private token, and the still-valid predecessor token supplied as `--predecessor-token-file`. The predecessor key must sign the exact short-lived takeover bundle, including canonical persisted predecessor evidence and exact successor claims; a stale/expired predecessor token must fail. After committed history and both lease attestations validate, the predecessor token must fail holder assertion, then be explicitly unlinked and proven absent. History must link predecessor and successor without a no-lease observation.
5. **Claude ownership:** Claude creates one synthetic SUMMARY from the approved fixture task, stamps it as Claude despite shared config `runtime: codex`, and emits a metadata-only telemetry record.
6. **Codex return:** while the Claude lease is still live, Codex takes over through the same predecessor-signed exact handoff, using the Claude token only as `--predecessor-token-file` and a distinct new Codex token. Verify the committed authorization envelope plus both attestations, prove the stale Claude token no longer has holder authority, remove it, create the synthetic VERIFICATION, and stamp it as Codex. Expired operator recovery is blocked pending an independently durable trust anchor and cannot be substituted into this handoff proof.
7. **Freshness and closeout:** run each known state drift, stale verification dependency, receipt misclassification input, and closeout recurrence/alias case in a separate sibling disposable fixture copy. Never corrupt and then “repair” the accepted pilot state. Each bad copy must fail; the continuously pristine accepted root must pass state, seal, signed provenance/receipt correlation, closeout strict check, and receipt classification together.
8. **Terminal lease:** release the final lease, require the private holder token to be removed, and prove there is no `lease.json`, `operation.lock`, or `writer.lock`. Classify every `cleanupRequired` field. Any unresolved true value fails the pilot.

No step may route, plan, execute, verify, ship, close out, repair, or otherwise mutate the real project's `.planning`. The pilot must not call GitHub, production storage, migration commands, runtime refresh, Cloudflare Tunnel, public smoke, merge, tag, or push.

## Deterministic pass criteria

The pilot passes only if all of these are true in one run:

- all accepted artifacts have valid lease-bound provenance with the expected runtime transitions;
- the concurrent writer and stale predecessor token are rejected before mutation;
- every named historical false-pass fixture fails for its expected reason and every restored good fixture passes;
- telemetry records contain no argv, prompt, output, path, environment, credential, or user-content fields; unavailable usage metrics stay null and caller-declared metrics remain ineligible for routing evidence;
- command receipts report the actual child termination and never infer `test_timeout_or_cancelled` from output text; the strict decision binds the independently chosen run ID, expected outcome, before/after workspace digests, source, and holder, and an authenticated failure still exits non-zero;
- this checkout's `HEAD`, porcelain status, and `.planning` tree digest exactly equal the recorded pre-pilot values;
- the disposable clone has no remotes, all temporary lease/token/mutex state is reconciled, and the single exact cleanup command removes only the approved disposable root.

Any missing receipt, unexpected network access, semantic ambiguity, non-zero cleanup residual, or digest mismatch is a fail-closed result—not a partial pass or retry authorization. Unavailable token/currency telemetry is reported as unavailable; it cannot be promoted to a pass claim or used for routing, but it does not contradict the separately enforceable launch/session/wall-time limits.

The approval bundle must name an enforceable egress-control mechanism that denies every destination except the two exact inference launches; a prompt instruction or launcher convention alone is not proof. Until that mechanism is displayed and approved, the pilot remains unexecutable. A prepared, partial, or tampered lease transition journal fails the run and requires the exact signed recovery/reconciliation path; it is never treated as an implicit retry authorization.

## Evidence package and decision boundary

Preserve only a metadata-only summary through the exact approved evidence target or current-thread output: approved bundle digest, source SHA, runtime/version/model identities, lease transition IDs/digests, checker result codes, telemetry aggregate counts, cleanup receipt, and the pre/post invariants for this checkout. The runtime child must not choose or write this target. Do not preserve prompts, model transcripts, child output, private tokens, absolute paths, `.planning` bodies, or user data.

The maintainer then decides independently among: authorize real config activation after lifting the pause; continue the pause and defer activation; or request a revised pilot. Three representative real phase samples for cost/quality telemetry remain a separate post-resume evidence requirement and cannot be manufactured by this synthetic pilot.

## Residual risk

- A disposable dual-host pilot proves the bounded commands and cooperative lease path, not that every global or future GSD writer is wrapped.
- Host sandboxes and dispatch differ by design; equivalent artifact outcomes do not imply identical orchestration internals.
- Actual model calls can incur bounded cost and can still be nondeterministic; deterministic acceptance comes from checkers and fixture results, not prose quality alone.
- Deleting the disposable root is destructive and therefore remains inside the separately approved exact cleanup bundle.
