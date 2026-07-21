# Production Storage Recovery

This runbook defines the recovery gate that must precede any production SQLite migration. It does not authorize a production stop, backup, migration, restore, source checkout, runtime restart, Tunnel change, or public smoke. Each action keeps its existing approval boundary.

The executable is `yarn recovery:storage`. It requires absolute paths, an off-checkout Ed25519 attestation key pair, the separately approved public-key digest, and explicit SHA bindings; it never reads `.env`, never chooses a production path, and never writes a receipt to `.planning/**`. Successful commands print one metadata-only, Ed25519-signed JSON receipt. The signature covers the canonical JSON payload containing every property except `receiptSignature`, so changing a decision boolean invalidates the receipt. Every `verify` and `assess` request also supplies a fresh UUID challenge; its signed receipt binds that `requestId`, `issuedAt`, and a five-minute `notAfter`, and the consumer must reject a mismatched challenge or expired receipt. A signed private integrity manifest remains inside the off-checkout backup bundle.

## Three-gate deployment order

1. **Source release:** The source PR is merged into `main` by maintainer
   decision, and Post-merge local planning archive is complete from updated
   `main` when the GSD workflow is active. An active GSD maintenance pause
   blocks this step rather than allowing it to be skipped.
2. **Runtime safety and refresh:** A fresh runtime-refresh decision selects the
   exact merged source SHA; **B01** receives fresh approval for bounded runtime
   quiescence and storage backup; the backup is independently verified and
   remains current while writes stay quiesced; **R05** receives separate fresh
   approval for `yarn db:migrate`; and **R06** receives separate fresh approval
   for build/start or restart.
3. **Public validation:** Tunnel changes and public smoke remain separate later
   approvals.

B01 does not authorize R05 or R06. R05 does not authorize B02. **B02 restore is destructive and always requires its own fresh exact approval.**

## Protected storage

- `DB_PATH`: durable SQLite state, including any live `-wal` and `-shm` sidecars.
- `ASSETS_DIR`: durable uploaded image assets.
- `UPLOADS_STAGING_DIR`: request-local staging. B01 captures it while writes are quiesced so recovery evidence is complete, but B02 does not restore it unless the operator explicitly selects `--restore-uploads` together with `--restore-assets`.

The backup and quarantine roots must be pre-existing, owner-controlled mode-`0700` directories on already provisioned durable storage; root creation is an operator action outside this tool and must be included in the applicable exact approval. This removes any false claim that recursively creating a root made all ancestor directory entries durable. The backup root must be outside the runtime checkout. The public and private attestation key files must be outside both the checkout and the entire backup/quarantine roots—not merely outside one backup bundle—and their expected public-key digest must be pinned in the approval bundle rather than copied from a produced manifest. Every command binds an explicit canonical Git top-level `--checkout-root`; ambient `GIT_*` authority is discarded. Git queries disable replacement objects and optional locks, override repository fsmonitor/untracked-cache configuration, reject every assume-unchanged or skip-worktree entry, and compare the intended commit tree, stage-zero index, and stable worktree bytes/modes directly. `git status` is not accepted as the clean-tree proof. In `production` scope, the on-disk `package.json`, timezone launcher, and recovery executable must byte-match their blobs at the intended source commit. The tool rejects a nested/non-top-level checkout, a backup bundle at or below that root, symlinked path components, hard-link file aliases, overlapping DB/assets/uploads/backup/quarantine/key paths, special files, relative paths, a pre-existing backup destination, source changes during backup, and any database/tree mismatch. Bind-mount directory aliases cannot be portably identified by Node path metadata and remain an explicit fail-closed operator concern.

## B01: backup and verify

Before approval, display the exact source SHA, currently served runtime SHA, backup ID, path categories, the write-quiescence mechanism, the commands below, and all effects. Do not display secrets or directory contents. The current executable re-observes the local `/api/runtime-provenance` endpoint both before and after capture, so the approved quiescence mechanism must stop every storage writer while leaving that local read-only endpoint reachable. If the only available mechanism is a full process stop, B01 is blocked: do not substitute a caller-claimed SHA or briefly restart the server; a separately designed signed pre-stop provenance handoff is required first. Any runtime lifecycle or write-routing action needed to establish this boundary remains a production action inside the exact B01 approval.

Keep writes quiesced from immediately before `backup` through R05 and the subsequent R06 decision. An online SQLite snapshot alone cannot make SQLite, assets, and upload staging one atomic cross-resource snapshot.

```bash
yarn recovery:storage backup \
  --scope=production \
  --checkout-root="$ABS_RUNTIME_CHECKOUT_ROOT" \
  --db="$ABS_DB_PATH" \
  --assets="$ABS_ASSETS_DIR" \
  --uploads="$ABS_UPLOADS_STAGING_DIR" \
  --backup-root="$ABS_OFF_CHECKOUT_BACKUP_ROOT" \
  --backup-id="$BACKUP_ID" \
  --intended-source-sha="$INTENDED_SOURCE_SHA" \
  --pre-refresh-runtime-sha="$PRE_REFRESH_RUNTIME_SHA" \
  --runtime-provenance-origin="$EXACT_LOCAL_RUNTIME_ORIGIN" \
  --attestation-private-key="$ABS_OFF_CHECKOUT_RECOVERY_PRIVATE_KEY" \
  --attestation-public-key="$ABS_OFF_CHECKOUT_RECOVERY_PUBLIC_KEY" \
  --expected-attestation-key-sha256="$APPROVED_RECOVERY_PUBLIC_KEY_SHA256" \
  --quiesced

yarn recovery:storage verify \
  --scope=production \
  --checkout-root="$ABS_RUNTIME_CHECKOUT_ROOT" \
  --backup-dir="$ABS_OFF_CHECKOUT_BACKUP_ROOT/$BACKUP_ID" \
  --backup-id="$BACKUP_ID" \
  --intended-source-sha="$INTENDED_SOURCE_SHA" \
  --pre-refresh-runtime-sha="$PRE_REFRESH_RUNTIME_SHA" \
  --request-id="$FRESH_VERIFY_REQUEST_UUID" \
  --attestation-private-key="$ABS_OFF_CHECKOUT_RECOVERY_PRIVATE_KEY" \
  --attestation-public-key="$ABS_OFF_CHECKOUT_RECOVERY_PUBLIC_KEY" \
  --expected-attestation-key-sha256="$APPROVED_RECOVERY_PUBLIC_KEY_SHA256"
```

The tool proves `INTENDED_SOURCE_SHA` against the checkout's real `HEAD` with config-neutral, no-optional-lock Git reads and, in production scope, proves the executing tool surface against that commit. It observes `PRE_REFRESH_RUNTIME_SHA` itself from the exact approved origin's `GET /api/runtime-provenance` before and after capture. The private manifest binds the complete logical SQLite state: every table's string-safe row count and deterministic content digest, the complete `sqlite_schema` table/index/view/trigger set, integrity and foreign-key results, selected PRAGMA state, migration journal, snapshot hash, asset/upload tree metadata and modes, both SHAs, scope, and backup ID. SQLite integers are preserved as decimal strings rather than rounded JavaScript numbers. The manifest may contain relative filenames and content hashes and must remain private. The backup container and asset/upload directory tree use owner-only modes (`0700` directories and `0600` files); the copied database and private manifest are mode `0600`. Every later verification rechecks those modes and ownership. Before returning success, the tool fsyncs the complete staged bundle, rechecks the final destination absence and exact staging inode, exclusively creates the final backup directory, and installs every staged directory/file with no-replace `mkdir` or hard-link/unlink operations. It never replaces an existing backup namespace. The final tree and backup root are fsynced, the canonical signed bundle is re-verified, and checkout/key freshness is rechecked. Publication is intentionally fail-closed rather than falsely all-tree atomic: once the final namespace is claimed, any partial install, collision, identity drift, or later failure returns `backup_reconciliation_required` and preserves the namespace as evidence. Before that claim, cleanup is allowed only when the staging directory still has the exact inode and mode created by this invocation; a substituted path is preserved and also returns reconciliation-required. The original backup receipt exposes `publishedDurably: true`; a later signed `verify` receipt exposes `bundleReadbackVerified: true`. Both receipts contain booleans, identifiers, the pinned public-key digest, signed-manifest digest/signature, and receipt signature only; neither contains paths, filenames, rows, counts, content digests, prompts, cookies, or secrets. `verify` requires the approved private key only to authenticate its fresh observation; verification of the backup manifest and any receipt still uses the separately pinned public key. Generate a new `FRESH_VERIFY_REQUEST_UUID` for every invocation and accept the receipt only after verifying its signature, exact `requestId`, `issuedAt`, and unexpired five-minute `notAfter`; a previously valid receipt is not fresh evidence for another request. The tool is stateless, so duplicate delivery of the exact same still-unexpired signed challenge response is indistinguishable; the maintainer evidence ledger must mark each request UUID consumed and never reuse it.

`restoreReady: true` is necessary but does not authorize migration or restore.

## R05: migrate under a separate approval

Immediately before R05, re-run `verify`. Stop if the backup changed, the selected source SHA changed, writes resumed, or any path identity is uncertain. Then obtain fresh exact R05 approval for only:

```bash
yarn db:migrate
```

After the command exits, keep the runtime stopped and assess the live storage against B01:

```bash
yarn recovery:storage assess \
  --scope=production \
  --checkout-root="$ABS_RUNTIME_CHECKOUT_ROOT" \
  --backup-dir="$ABS_OFF_CHECKOUT_BACKUP_ROOT/$BACKUP_ID" \
  --backup-id="$BACKUP_ID" \
  --intended-source-sha="$INTENDED_SOURCE_SHA" \
  --pre-refresh-runtime-sha="$PRE_REFRESH_RUNTIME_SHA" \
  --request-id="$FRESH_ASSESS_REQUEST_UUID" \
  --attestation-private-key="$ABS_OFF_CHECKOUT_RECOVERY_PRIVATE_KEY" \
  --attestation-public-key="$ABS_OFF_CHECKOUT_RECOVERY_PUBLIC_KEY" \
  --expected-attestation-key-sha256="$APPROVED_RECOVERY_PUBLIC_KEY_SHA256" \
  --expected-private-manifest-sha256="$APPROVED_PRIVATE_MANIFEST_SHA256" \
  --expected-backup-bundle-sha256="$APPROVED_BACKUP_BUNDLE_SHA256" \
  --db="$ABS_DB_PATH" \
  --assets="$ABS_ASSETS_DIR" \
  --uploads="$ABS_UPLOADS_STAGING_DIR" \
  --runtime-stopped
```

A successful schema migration normally makes `exactPreBackupState` false. The assessment requires the runtime-stopped assertion, re-verifies the signed backup, and accepts a decision result only when two complete live-storage snapshots match. Its decision booleans, fresh request UUID, five-minute validity interval, and correlated manifest/bundle digests are covered by `receiptSignature`; an unsigned, expired, challenge-mismatched, or failed-signature assessment is not evidence. The assertion remains an operator contract: any resumed or uncooperative writer invalidates the result. The assessment exists to identify which safe booleans changed; it is not a migration-success oracle and does not authorize the next gate.

## Failure decision

| Observation | Default action |
| --- | --- |
| Migration exits non-zero and assessment still has `exactPreBackupState: true` | Do not restore. Preserve the failure receipt, diagnose outside the paused Phase 115 workflow, then repeat B01 and request a new R05 approval before retrying. |
| Migration exits non-zero and database integrity, journal, content, or storage trees cannot be proven | Keep runtime stopped. Choose forward repair or request fresh B02 approval; do not guess that the migration transaction rolled back. |
| Migration succeeds but new runtime cannot boot | Prefer a bounded forward fix. If returning to the previous runtime is required, restore both the B01 storage snapshot and its bound pre-refresh runtime/source SHA under B02. |
| Runtime boots but later smoke fails without data-integrity evidence | Prefer diagnosing the runtime/Tunnel/browser boundary; do not restore storage merely because smoke failed. |
| Durable row content or assets are proven corrupted | Stop all writes and request B02 approval bound to the exact backup ID, target SHA, and restore scope. |

## B02: separately approved destructive restore

Before approval, independently run `verify`. Display the exact backup ID, backup intended/new source SHA, target source SHA, currently served/runtime state, restore selections, explicit same-filesystem quarantine root, exact confirmation string, and effects. The target source SHA must equal the manifest's pre-refresh runtime SHA; the intended/new SHA identifies the backup but is never a valid rollback target unless both SHAs were already identical. Never combine B02 approval with B01, R05, R06, Tunnel, or smoke approval. The `RESTORE:...` confirmation is an exact-input guard, not cryptographic proof of current-thread approval, and the local tool has no authenticated channel to consume maintainer intent. Record the approved invocation as single-use in the maintainer ledger and never replay its confirmation; a durable independently verifiable restore-approval token remains an explicit governance residual.

The restore stages and verifies replacement data before moving live files. Before acquiring the lock it stats both every selected existing source object and its parent—including DB/WAL/SHM sidecars and selected directory mountpoints—and rejects any device mismatch with the quarantine filesystem. It then captures the exact DB/WAL/SHM and selected-directory prestate and acquires a signed, DB-scoped exclusive restore lock whose immutable payload binds the signed private-prestate digest. Any surviving lock, orphan restore directory, or incomplete journal blocks recurrence with `restore_reconciliation_required`. Before the first live move it writes mode-`0600` `private-prestate.json` under the pre-existing same-filesystem quarantine, signs that private evidence, recaptures the live state after lock acquisition, and creates one exclusive identity-pinned `replacement-staging` namespace inside its new mode-`0700` quarantine directory. Cleanup is allowed only for that exact owned namespace; an existing or identity-swapped namespace is preserved and forces reconciliation. The tool then re-verifies the approved manifest/bundle digests, public/private key freshness, canonical checkout source, clean production tree, and production tool blobs immediately before durably publishing the prepared journal. Every move has a signed intent record before the effect and a signed completion record after the effect and parent-directory fsync. Actual effects are tracked only after a move is observed; a pre-move failure never invents an install effect that can strand earlier quarantine work. Regular files use a no-replace hard-link/unlink move with identity rechecks; directories require the approved runtime-stopped cooperative boundary, an absent destination check, identity recheck, and exclusive restore lock because Node does not expose `renameat2(RENAME_NOREPLACE)`. It moves the prior DB/WAL/SHM and selected directories into quarantine and never deletes them. The staged and installed database remain mode `0600`; restored asset/upload directories are normalized to `0700` and their files to `0600`, with every mode bound in the private manifest. Success is returned only after installed replacements and exact quarantined prestate are fsynced and reread and a signed commit record and metadata-only receipt correlate to the same private-prestate digest. Before releasing the fence, every signer/identity/content readback and lock-file/parent fsync occurs while the durable lock still exists; an injectable fault at that boundary leaves the lock present. The owner/key-CAS `unlink` is the terminal operation, with no fallible readback or fsync after a successful unlink. A crash may conservatively leave the durable lock visible and block recurrence. A failed in-process apply records `rolled_back` only after each actual-effect destination passes exact identity-and-content CAS, and no-replace rollback restores and revalidates every exact original prestate item. Missing, tampered, recreated, or colliding prestate, stage ownership drift, lock identity drift, lock-release ambiguity, or any ambiguous private-prestate/journal/key/source/evidence/fsync/rollback boundary returns `restore_reconciliation_required` and preserves foreign live bytes, unknown stages, quarantine, journal, and lock rather than moving or overwriting them as owned data.

SIGKILL, host crash, or power loss can still require maintainer reconciliation; the journal makes that condition observable and blocks every later restore instead of guessing or silently replaying. After any abnormal termination, keep the runtime stopped, preserve every exact path, do not rerun `restore`, and inspect the signed journal. A physical power-cut recovery exercise remains outside this non-production logical-fault rehearsal; this contract proves durable ordering and fail-closed detection, not automatic destructive recovery.

```bash
yarn recovery:storage restore \
  --scope=production \
  --checkout-root="$ABS_RUNTIME_CHECKOUT_ROOT" \
  --backup-dir="$ABS_OFF_CHECKOUT_BACKUP_ROOT/$BACKUP_ID" \
  --backup-id="$BACKUP_ID" \
  --intended-source-sha="$INTENDED_SOURCE_SHA" \
  --target-source-sha="$TARGET_SOURCE_SHA" \
  --pre-refresh-runtime-sha="$PRE_REFRESH_RUNTIME_SHA" \
  --attestation-private-key="$ABS_OFF_CHECKOUT_RECOVERY_PRIVATE_KEY" \
  --attestation-public-key="$ABS_OFF_CHECKOUT_RECOVERY_PUBLIC_KEY" \
  --expected-attestation-key-sha256="$APPROVED_RECOVERY_PUBLIC_KEY_SHA256" \
  --expected-private-manifest-sha256="$APPROVED_PRIVATE_MANIFEST_SHA256" \
  --expected-backup-bundle-sha256="$APPROVED_BACKUP_BUNDLE_SHA256" \
  --db="$ABS_DB_PATH" \
  --assets="$ABS_ASSETS_DIR" \
  --uploads="$ABS_UPLOADS_STAGING_DIR" \
  --quarantine-root="$ABS_SAME_FILESYSTEM_QUARANTINE_ROOT" \
  --runtime-stopped \
  --restore-assets \
  --confirm="RESTORE:$BACKUP_ID:$TARGET_SOURCE_SHA:$RESTORE_SELECTION:$APPROVED_PRIVATE_MANIFEST_SHA256:$APPROVED_BACKUP_BUNDLE_SHA256"
```

Set `RESTORE_SELECTION` to the exact selection implied by the flags: `database`, `database+assets`, or `database+assets+uploads`. Omit `--restore-assets` when only SQLite needs restoration. Upload staging is intentionally not restored by the normal command. Adding `--restore-uploads` is a separate exact scope choice and is rejected unless assets restoration is also selected. Programmatic callers must pass literal booleans for both restore selections; truthy strings are rejected.

After storage restoration, selecting/checking out the old source SHA, installing, building, starting, reading `/api/runtime-provenance`, changing the Tunnel, and running smoke are separate actions with their own existing gates.

## Non-production rehearsal

The deterministic rehearsal uses a temporary real WAL SQLite database at the schema immediately before migration `0011`, nested asset/upload fixtures, the same backup verifier, the real `runMigrations()` entrypoint, a simulated post-migration content failure, and B02 restore. It must prove:

- backup integrity, foreign keys, PRAGMA state, complete schema objects, every table's string-safe row count/content digest, and storage trees match, including integers beyond JavaScript's safe range;
- the copy migrates through the current migration;
- restore returns the exact pre-migration schema, journal, seeded values, and selected asset bytes;
- upload staging stays untouched unless explicitly selected;
- wrong backup/SHA/selection/evidence-digest confirmation makes no mutation;
- every public decision receipt is signature-verifiable and any changed verification/assessment boolean, request UUID, or validity timestamp fails signature validation; challenge mismatch or expiry rejects replay, and receipts contain no private path, filename, row, count, or storage-content digest, only attestation/manifest/journal evidence digests.
- canonical path checks reject nested Git roots, ambient Git authority, assume-unchanged/skip-worktree entries, fsmonitor false-clean configuration, optional-lock dependence, symlink, hard-link, and case-alias overlap; roots must be pre-provisioned, and copied, staged, installed, bundle-container, and private evidence files use enforced restrictive permissions.
- a terminal-window backup-destination collision is preserved, a substituted staging inode is never recursively removed, and any failure after the final namespace is claimed returns `backup_reconciliation_required` instead of inviting blind reuse.
- a structurally valid current-schema signed incomplete restore journal and private-prestate record block recurrence with `restore_reconciliation_required`, while committed journals, the initial lock, signed private prestate, and final metadata-only receipt all correlate by digest.
- crash injection after private-prestate publication proves that the surviving signed lock and journal identify the exact captured prestate.
- concurrent restores serialize on the DB-scoped lock; every selected existing source object and sidecar is device-preflighted, a destination recreated at the install boundary is preserved in place, and tampered quarantine bytes are refused rather than moved as owned, with the lock retained.
- a colliding unowned stage namespace is preserved, and backup evidence, signing-key identity, or checkout commit changed at the immediate pre-move freshness gate causes no live storage move.
- a pre-move install fault rolls back earlier observed quarantine effects; rollback cannot claim `rolled_back` unless every exact captured prestate item passes identity/content CAS, is restored, and is reverified. Missing prestate, collision, tamper, or any fallible lock-release preflight fault preserves the signed journal and lock for manual reconciliation.

Run only against disposable test storage:

```bash
node scripts/run-node-with-tz.mjs --import tsx --test \
  tests/unit/production-recovery.test.ts \
  tests/integration/production-recovery-rehearsal.test.ts
```

Passing this rehearsal proves the tool contract against a non-production copy. It does not prove an historical runtime binary boots, authorize production B01/R05/B02/R06, or refresh production.
