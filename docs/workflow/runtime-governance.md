# Workflow Runtime Governance

These tools make writer identity, artifact provenance, and bounded telemetry explicit. They are maintenance controls, not authority to run GSD. While the Temporary GSD Maintenance Pause is active, use them only in deterministic tests or in a separately approved disposable pilot. Do not point them at this checkout's `.planning/**`.

## Single-writer lease

The lease lives under the repository's Git common directory so worktrees of the same clone contend on one record. The private bearer token and Ed25519 private key must be in a canonical physical absolute path outside both the checkout and Git common directory. The token file must be a current-user-owned, single-link `0600` regular file whose immediate parent is current-user-owned and not group/world writable; every holder read rechecks its descriptor, final path, parent identity, and bytes. The Git-common governance directory itself must remain current-user-owned mode `0700`, and its lease, attestation, mutex, writer, and history records are rejected if hardlinked or changed during a read. The ledger retains the matching public-key attestation and declared runtime, GSD version, and model profile. Renewal cannot silently change those fields.

For an approved disposable checkout:

```bash
PILOT_ROOT=/absolute/path/to/disposable-checkout
TOKEN_DIR=/absolute/private/directory/outside-the-checkout
TOKEN_FILE="$TOKEN_DIR/codex-holder.json"
yarn workflow:lease acquire \
  --project-root="$PILOT_ROOT" \
  --runtime=codex \
  --gsd-version=1.7.0 \
  --model-profile=sol-high \
  --ttl-seconds=900 \
  --token-file="$TOKEN_FILE"
yarn workflow:lease status --project-root="$PILOT_ROOT"
```

`status` exposes the current lease ID and digest without exposing private material. It validates the current public attestation against the full immutable acquisition identity; a missing, replaced, or mismatched attestation makes the lease not ready. Lease and writer authority records are installed from fsynced temporary files with an exclusive hard-link publication step. A long mutation holds a durable lease-bound `writer.lock`; acquire, renew, release, and takeover all fail while that fence is live, and an expired lease cannot use ordinary renewal. Nested governed tools validate the non-secret `NUTRITION_WORKFLOW_FENCE_ID` plus the same private holder token instead of acquiring a second writer.

`takeover` requires the exact observed lease values plus `TAKEOVER:<lease-id>:<lease-digest>:<reason-code>`. A `runtime_handoff` is allowed only while the predecessor lease is live and requires `--predecessor-token-file`; the predecessor private key signs an exact 60-second authorization bundle containing the persisted predecessor-evidence digest, confirmation, successor holder claims, credential-path digest, TTL, and acquisition time. An expired predecessor cannot authorize a handoff with a stale holder token. The successor is atomically installed over the predecessor, and an active successor is ready only when its immutable acquisition fields and predecessor ID/digest/reason match exactly one committed predecessor-signed transition whose predecessor/successor attestations validate. Deleting that transition therefore blocks status and holder assertion while the active lease or retained attestations still anchor the omission.

Expired `abandoned_session` and `operator_recovery` takeover is currently blocked with `lease_operator_takeover_durable_authority_unavailable`, before successor credentials or history are written. The prior HMAC proposal was not independently durable: a successor token holder could replace the stored HMAC/public claim and re-sign transition states with the successor key. Until a separately pinned asymmetric operator trust anchor or verifier-supplied authority proof exists, an operator-intent file is not accepted as recovery authority and no operator-HMAC transition is considered valid history.

Recovery is exceptional. `recover-mutex` requires its exact ID/digest, the recorded recovery deadline, an allowed reason, `RECOVER_MUTEX:<operation-id>:<operation-digest>:<reason-code>`, and proof that the recorded PID/process-start owner is gone. A malformed or schema-invalid atomic-transition lock has no authenticated PID/start-time or registered-child evidence, so age, digest, confirmation text, and operator intent cannot prove quiescence. The legacy-named `recover-corrupt-mutex` command now preserves the bytes and deterministically fails with `lease_corrupt_mutex_recovery_owner_evidence_unavailable`; status reports `corruptMutexRecoveryEligible:false`. Clearing such a lock is a blocking defer until an external containment mechanism can provide independently verifiable owner/child absence. An expired writer fence uses `RECOVER_WRITER:<fence-id>:<fence-digest>:<reason-code>` and refuses recovery while its recorded owner, child-registration transition, or registered process group may still be alive. Never infer staleness from a missing terminal session alone.

The transition ledger is append-only evidence. Every retained non-active lease attestation must have exactly one committed outgoing release or takeover, every active takeover successor must have exactly one matching committed incoming handoff, and an active lease must have no committed outgoing transition. This makes deletion of a terminal release record fail inactive status closed while its attestation remains. It is detection against remaining anchored evidence, not an external transparency log: a same-account actor that removes both a transition and every matching lease attestation, or replaces the whole ledger consistently, can erase that local anchor. That full-history truncation remains a readiness blocker/defer.

Release the lease with the current private token:

```bash
yarn workflow:lease release \
  --project-root="$PILOT_ROOT" \
  --token-file="$TOKEN_FILE"
```

A receipt with `cleanupRequired: true` or `status: needs_reconciliation` exits non-zero and is not success: preserve the structured output and resolve the named private-token, history, writer, or receipt residual before another writer starts.

## Lease-bound artifact provenance

Only `*-PLAN.md`, `*-SUMMARY.md`, and `*-VERIFICATION.md` are accepted. Stamping requires an active holder token, expected runtime, the exact SHA-256 of the current file, and a new receipt path outside the checkout. Replacing an existing stamp additionally requires its exact provenance digest.

```bash
ARTIFACT=.planning/phases/999-pilot/999-01-PLAN.md
ARTIFACT_SHA=$(shasum -a 256 "$PILOT_ROOT/$ARTIFACT" | awk '{print $1}')
SOURCE_SHA=$(git -C "$PILOT_ROOT" rev-parse HEAD)
yarn workflow:artifact-provenance stamp \
  --project-root="$PILOT_ROOT" \
  --artifact="$ARTIFACT" \
  --token-file="$TOKEN_FILE" \
  --runtime=codex \
  --confirm-sha256="$ARTIFACT_SHA" \
  --source-sha="$SOURCE_SHA" \
  --receipt="$TOKEN_DIR/plan-provenance.json"
yarn workflow:artifact-provenance check \
  --project-root="$PILOT_ROOT" \
  --artifact="$ARTIFACT" \
  --receipt="$TOKEN_DIR/plan-provenance.json" \
  --runtime=codex \
  --gsd-version=1.7.0 \
  --source-sha="$SOURCE_SHA"
```

The stamp holds a writer fence through its file CAS and receipt commit. It derives `execution_runtime`, `gsd_version`, `model_profile`, lease/fence IDs, public attestation digest, worktree identity, and Git-common identity from the holder; it requires the caller's approved source SHA to equal the real checkout `HEAD` both before entering and immediately before artifact replacement. The Ed25519-signed payload includes the normalized artifact-relative identity plus both checkout identities, preventing path or linked-worktree replay. The committed off-checkout receipt has its own lease-key signature and strictly binds the artifact identity, before/after hashes, provenance signature, source, runtime/version/model, and artifact/receipt fence IDs.

Receipt preparation embeds the already signed committed receipt. Recovery is rebound to the caller-confirmed artifact SHA/device/inode and accepts only exact signed before/after states owned by the current lease/runtime; an authenticated orphan artifact temp is removed and recomputed, never promoted without a signed transaction. Normal and recovery success reread the canonical artifact/receipt pair, recheck both snapshots and real `HEAD`, and assert the holder at the final boundary. Invalid, multiple, old-holder, or otherwise ambiguous temps are preserved as reconciliation evidence. The checker separately requires both signatures, the immutable Git-common public attestation, current payload hash, exact receipt correlation, current worktree/Git-common identity, and expected source SHA. `.planning/config.json` is never a writer-identity source, and the CLI has no caller-selectable Git common-directory override. These checks are cooperative filesystem freshness evidence, not universal atomicity against a non-cooperating same-account writer after the final return.

This proves possession of the private key issued to a declared lease identity and exact path/payload/receipt correlation. The signed fence UUID is still a holder-signed claim: until a durable begin/end fence ledger is implemented and checked, it is not offline proof that the fence was live at signing time. The signature also does not independently attest the physical host, model provider, or semantic correctness of the artifact.

## Signed command receipts and verification seals

A release-check receipt path is accepted only when `--receipt`, caller-generated `--run-id`, `--workflow-token`, and `--workflow-runtime` are supplied together in an approved disposable checkout. The physical receipt path must be outside both the checkout and Git common directory. The reservation and final schema-v2 receipt are separately signed by the active lease holder and bind the real source SHA, canonical worktree/Git-common identities, holder identity, stable before/after workspace fingerprints, exact gate, and process termination. The strict `verifyCommandReceipt` API/CLI requires independently expected run ID, outcome, before/after workspace digests, source, lease ID, runtime, GSD version, and model profile; it also recomputes live source/workspace state and rereads the receipt before returning. A passed receipt is accepted only for `release_check_complete`, exit code `0`, and an unchanged workspace. An authenticated failed receipt remains failure and the verifier CLI exits non-zero. These caller bindings prevent an old valid green receipt or a receipt from another attempted run from satisfying the current decision. Without holder authority, release-check may print a privacy-minimized schema-v1 classification in memory/stdout or stderr, but no API or CLI path persists it; every unsigned `receiptPath` request fails before directory creation or child execution.

```bash
RUN_ID=$(node -e 'process.stdout.write(require("node:crypto").randomUUID())')
EXPECTED_WORKSPACE_SHA256=$(cd "$PILOT_ROOT" && node --input-type=module -e \
  'import { stableCommandWorkspaceFingerprint } from "./scripts/workflow/command-receipt.mjs"; process.stdout.write(stableCommandWorkspaceFingerprint(process.cwd()))')
(cd "$PILOT_ROOT" && \
  yarn release:check --base=HEAD \
    --run-id="$RUN_ID" \
    --receipt="$TOKEN_DIR/release-check.json" \
    --workflow-token="$TOKEN_FILE" \
    --workflow-runtime=codex)
yarn workflow:command-receipt verify \
  --project-root="$PILOT_ROOT" \
  --receipt="$TOKEN_DIR/release-check.json" \
  --source-sha="$SOURCE_SHA" \
  --run-id="$RUN_ID" \
  --outcome=passed \
  --workspace-before-sha256="$EXPECTED_WORKSPACE_SHA256" \
  --workspace-after-sha256="$EXPECTED_WORKSPACE_SHA256" \
  --lease-id="$EXPECTED_LEASE_ID" \
  --runtime=codex \
  --gsd-version=1.7.0 \
  --model-profile=sol-high
```

The run ID and expected workspace digest above are caller evidence captured before launch, not values learned from the completed receipt. The signed release command must run with the governed checkout as its current directory; release-check rejects ambient Git routing variables before scope discovery, pins all Git and child operations to that canonical project root, strips ambient `GIT_*` routing/configuration, and disables Git replacement refs. The Yarn wrapper also loads checkout-local `.env`. The prepared no-`.env` pilot contract therefore cannot execute this block; creating `.env` or relaxing that pilot boundary requires a separately reviewed contract and approval.

Receipt parent safety is checked before any missing directory is created and checked again afterward. Reservation and final reads use `O_NOFOLLOW`, device/inode/digest stability, a final CAS check, directory fsync, and a post-publication reread. These controls fail closed on symlink ancestors, reservation replacement, holder changes, source changes, and signed-content tampering.

Verification seal creation first captures an unsigned dependency draft. Persistence does not accept caller-supplied runtime/version/model claims: schema-v2 identity, lease/fence IDs, and the attestation digest are derived from the active holder and the final seal is signed by that holder. The read-only checker requires the explicit expected lease ID, runtime, GSD version, and model profile and verifies the immutable lease attestation. Both create/write and check use `O_NOFOLLOW` two-pass snapshots and a final seal/input/source pair check, so a dependency or seal that changes during verification cannot produce `verification_fresh`.

## Closeout archive and provenance order

Closeout deliberately has no provenance-relocation contract. A PLAN, SUMMARY, or VERIFICATION artifact may receive its first provenance stamp only after it is at its final canonical archive path under `.planning/milestones/<version>/phases/**`. The normalizer rejects provenance-bearing artifacts in the legacy movable `.planning/milestones/<version>-phases/**` tree. The deterministic order is therefore:

1. run `workflow:closeout normalize --dry-run` and preserve its exact `planSha256`;
2. run the lease-bound normalize apply with that hash, source SHA, holder token, and runtime;
3. stamp the now-canonical artifacts and write each exact direct `<phase-id>-SEAL.json`;
4. run the strict checker with the same holder token/runtime and one off-checkout receipt per artifact.

```bash
yarn workflow:closeout normalize \
  --project-root="$PILOT_ROOT" \
  --planning-root="$PILOT_ROOT/.planning" \
  --milestone=v999.0 \
  --dry-run
yarn workflow:closeout normalize \
  --project-root="$PILOT_ROOT" \
  --planning-root="$PILOT_ROOT/.planning" \
  --milestone=v999.0 \
  --source-sha="$SOURCE_SHA" \
  --token-file="$TOKEN_FILE" \
  --runtime=codex \
  --confirm-plan-sha256="$PLAN_SHA256"
yarn workflow:closeout check \
  --project-root="$PILOT_ROOT" \
  --planning-root="$PILOT_ROOT/.planning" \
  --milestone=v999.0 \
  --strict \
  --source-sha="$SOURCE_SHA" \
  --gsd-version=1.7.0 \
  --token-file="$TOKEN_FILE" \
  --runtime=codex \
  --provenance-receipt="$TOKEN_DIR/artifact-1.json"
```

The signed closeout journal binds the initial tree for both moved and already-canonical archives; a canonical normalization with no file operations still commits a signed no-op journal. Root routing state is closed, not keyword-based: `STATE.md` and `ROADMAP.md` must equal their exact terminal templates, while `MILESTONES.md` must contain exactly one canonical record for the milestone (`- <version> complete` or the shipped H2 form). Contradictory `Status`, active/non-archived roadmap text, negated completion prose, and duplicate milestone records fail normalization and strict checking instead of being rewritten from ambiguous input. Strict evolution permits only a provenance change whose clean payload still matches the signed initial artifact, the exact direct seal for an existing phase directory, and separately governed retained sidecars with their required rationale. Journal reads require canonical bytes; publication is exclusive, replacement uses raw-byte/device/inode CAS under the writer fence, and destructive effects reassert the holder immediately before mutation. Strict verification holds its own writer fence for the whole check and revalidates Git source, planning tree, canonical journal ledger (including inode ABA), artifact/receipt pairs, off-checkout receipt snapshots, and lease attestations at the final checkpoint.

## Privacy-bounded telemetry

The telemetry wrapper asserts the active holder, creates an immutable signed `0600` running record under the Git common directory, fsyncs both the record directory and its governance parent before spawn, runs exactly one child command, and atomically commits a newly signed termination record. A crash may leave a truthful `running` record; it must not be rewritten as a pass.

```bash
node scripts/workflow/workflow-telemetry.mjs \
  --project-root="$PILOT_ROOT" \
  --token-file="$TOKEN_FILE" \
  --runtime=codex \
  --phase=synthetic-999 \
  --command-label=maintenance_check \
  --reasoning-effort=high \
  --timeout-seconds=300 \
  --source-sha="$SOURCE_SHA" \
  --bundle-sha256="$APPROVED_BUNDLE_SHA256" \
  --artifact=.planning/phases/999-pilot/999-01-PLAN.md \
  --event=retry \
  -- yarn workflow:plan-proof --plan=.planning/phases/999-pilot/999-01-PLAN.md
```

The direct Node entrypoint is intentional: ordinary Yarn 1 output adds banners to stdout, while this boundary reserves stdout for one structured receipt and discards child stdout/stderr. The caller-selectable semantic labels are closed to `maintenance_check` (with `pilot` rejected); records instead carry `authorizationProfile: signed_exact_bundle` and a holder-signed SHA-256 over the exact argv, environment digest, source, phase, timeout, artifact/event declarations, and metrics-path digest. An optional `expectedBundleSha256` API argument makes a separately reviewed bundle digest an execution precondition. Neither argv nor environment values are stored.

The timeout plus 30-second reconciliation margin must be shorter than the remaining lease. On POSIX, the wrapper registers a dedicated child process group in the writer fence, sends TERM then KILL to that group on timeout or leaked same-group descendants, and proves only that original group is quiescent before the fence can be released. It requires the approved source SHA to equal real `HEAD` before and after the child. Post-child measurement, source, or holder-check failures commit a metadata-only `needs_reconciliation` record. After publication it rereads the signed record and rechecks real `HEAD`, holder authority, and the exact command-bundle digest before returning a separately signed receipt; any mismatch is reconciliation, never success. The strict receipt verifier requires independently expected run ID, phase, semantic status, child outcome, source, bundle, lease, runtime, version, and model. The strict record verifier additionally accepts only the canonical Git-common record path and an expected final state of `completed` or `needs_reconciliation`, verifies the same holder/source/bundle identities, and rereads the final record and live source. A signed `running` record is crash evidence, never final success. These bindings prevent a different valid local holder, copied record, intermediate record, or prior run from being silently substituted.

This is deliberately `limited_observation`, never a pass: a child can call `setsid` or a detached spawn and escape into another session that a pure unprivileged Node process cannot enumerate or contain without races. `pilot` is rejected before spawn with `telemetry_pilot_containment_unavailable`; every receipt has `pilotEligible:false` and `routingEvidenceEligible:false`. A future pilot needs an approved kernel/VM containment provider whose lifecycle and recovery both prove the entire container empty. Process-tree scans, environment markers, and prompt conventions are not accepted substitutes.

Records contain only allowlisted identifiers, before/after source SHA, lease-derived runtime/version/model identity, reasoning-effort class, caller-declared retry/replan/repair counts, before/after artifact counts and byte totals, wall time, and exact process termination. They never contain child argv, prompts, transcripts, output, artifact paths, repository paths, environment values, or secrets.

Token, tool-call, and agent-session counts default to explicit `unavailable/null`. A bounded exact-schema file may carry a runtime-matching `codex_usage_api` or `claude_usage_api` source claim, but the current adapter marks every such value `caller_declared`, `not_run_delta_verified`, and `routingEvidenceEligible: false`. No routing or cost conclusion may treat it as authoritative until a trusted before/after provider adapter binds a run-level delta.

## Residual risk

- The lease is cooperative and scoped to worktrees sharing one Git common directory. Another clone, OS account, or unwrapped command can bypass it.
- Token and Git-common-directory writes are not one cross-filesystem transaction. Receipts expose cleanup residuals, but power loss can still require human reconciliation.
- Release and takeover now use signed `prepared`/`committed` transition WAL records with deterministic replay/recovery at the tested logical crash boundaries. That guarantee does not extend to acquire, renew, writer-fence begin/update/end, or mutex/writer recovery history; there is no general reconcile command for those transitions, and an ambiguous physical power loss remains blocking evidence rather than success.
- Expired operator takeover is blocked until an independently pinned asymmetric authority or verifier-supplied proof exists; stored HMAC shape/digest plus a successor signature is not durable operator authority.
- A malformed mutex is preserved because it contains no trustworthy owner/child identity. No local digest/age confirmation can safely authorize deletion without external containment evidence.
- Transition/attestation graph checks detect missing active handoffs and release-history deletion while another local anchor remains. Full consistent ledger truncation or replacement by the same OS account is not detectable without an external append-only head and remains a readiness blocker.
- A crash between marking child registration pending and recording the process-group ID intentionally leaves recovery blocked because the unknown child cannot be proven absent.
- Public-key provenance proves possession of a declared lease key, not an independently verified host/model identity or artifact semantics. The same OS account can still create a different declared lease ledger.
- Node does not expose dirfd-based `renameat`; repeated ancestor/inode/digest checks reduce, but cannot eliminate, a hostile same-account micro-TOCTOU.
- Telemetry records process-level measurements; declared events are not observed events, and unavailable provider metrics remain unavailable and may not be imputed.
- POSIX process-group observation is not a process container. Detached or `setsid` descendants can escape it, so no current telemetry result is pilot-eligible; macOS requires an external disposable VM/container or equivalently enforceable job boundary before the pilot can run.
- None of these controls authorizes GSD resume, source release, production migration, runtime refresh, Tunnel, smoke, merge, or tag actions.
