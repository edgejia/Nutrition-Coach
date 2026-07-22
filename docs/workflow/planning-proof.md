# Planning Proof Contract

Planner-authored `<verify>` and `<automated>` commands are executable trust-boundary code. A structurally valid plan can still false-pass, mutate evidence, or destroy the state it is supposed to inspect. This contract adds a deterministic first gate and an independent semantic review; neither replaces the other.

## Artifact profile boundary

Nutrition Coach uses the following proportional boundary for this single-maintainer side project:

| Artifact | Normal proof | Optional high-assurance proof |
| --- | --- | --- |
| GSD quick plans under `.planning/quick/**` | Run `plan-proof-lint` and an independent semantic checker. This is the complete normal contract. | The current provenance implementation does not support quick artifact types. Record `artifact_type_not_supported`; do not stamp, sign, or claim a quick PLAN is receipt-backed. |
| Supported phase `*-PLAN.md`, `*-SUMMARY.md`, and `*-VERIFICATION.md` | Run the same linter and semantic checker. | Only when explicitly selected, add the active writer fence, exact source preimage, signed provenance, lease attestation, and separately signed committed receipt. Missing or stale evidence fails closed. |

The bootstrap quick artifact `260723-3a3` has the explicit high-assurance
disposition `artifact_type_not_supported`. A held lease is not a signature, and
passing `workflow:plan-proof` does not make the current PLAN signed. The
deterministic/semantic quick contract remains active while governed high
assurance stays opt-in for the supported phase artifact types above.

## Deterministic gate

Run before a planner returns a plan and again independently inside plan checking:

```bash
yarn workflow:plan-proof --plan=/absolute/or/repo-relative/PHASE-PLAN.md
```

Exit `0` means no known deterministic anti-pattern was found. Exit `1` prints stable JSON findings with rule ID and 1-based line number. The linter is read-only.

| Rule | Rejected proof family |
| --- | --- |
| `PPL001` | `rg`/`grep` OR pattern presented as proof that every all-of marker exists |
| `PPL002` | `tail`, `head -n 1`, or one final line used as complete proof |
| `PPL003` | verification that builds, migrates, regenerates, refreshes harness evidence, edits files, or performs Git mutation |
| `PPL004` | oversized inline `node --eval`/heredoc that should be a reviewed script |
| `PPL005` | searching a template or generated artifact for a pass marker that the same process authored |
| `PPL006` | high-risk production/security/data proof without a negative control or counterexample |
| `PPL007` | count/cardinality proof that checks only an upper bound rather than exact completeness |
| `PPL008` | PLAN with no `<verify>` or `<automated>` proof range |

The scanner canonicalizes the XML entities used by real GSD Markdown before analysis while preserving original line numbers. Only balanced `<task>` scopes with a contained balanced `<verify>` or `<automated>` range count; tags inside fenced code, HTML comments, or inline-code examples are invisible. Crossed, orphaned, or unclosed proof tags cannot satisfy `PPL008`.

Proof commands use a closed read-only command model. Unknown interpreters or commands, command-resolution overrides, every command/backtick/process substitution, unsafe output options/redirection, `sed`, Git configuration mutations, and shell forms the parser cannot classify fail with `PPL003`. Backslash-escaped options are interpreted as the shell will execute them. Multiple attached or separate `rg`/`grep -e` expressions, any pattern-file option, basic-regex `\|`, and same-line search chains that do not use `&&` are treated as all-of false-pass risks. Indirect mutators such as `yarn release:check` are rejected inside proof ranges because they build output as part of the gate. Direct Node checker execution is restricted to the exact allowlist `plan-proof-lint.mjs` and `state-check.mjs`; a safe-looking arbitrary basename such as `evil-check.mjs` is not authority. A proof outside this bounded grammar belongs in a small reviewed checker script invoked through an approved test or package gate and still receives independent semantic review. The allowlist proves command shape, not checker semantics: reviewed tracked source remains the trust boundary.

`git status` is admitted only as `git --no-optional-locks status ...`; an unguarded status command may refresh the index and is therefore rejected as a verification mutation. Other global Git options remain a closed set rather than caller-selected configuration.

Yarn likewise accepts no global project/config routing options: the allowlisted script name must be the first argument. Each script has exact arguments—`tsc` requires only `--noEmit`, `workflow:plan-proof` accepts only one safe relative `--plan=...`, and every other allowlisted package gate accepts no caller-selected arguments. Targeted Node tests use the separate closed Node-test grammar instead of forwarding filters through Yarn.

`PPL006` requires a full run of an exact registered negative-control test file. Node `--test-only`, test-name filters, and skip filters are rejected for every proof because a zero-match or all-skipped selection can exit successfully. None of the direct checker CLIs accepts a generic `--negative-control` flag, so merely writing “negative control” in prose—or passing or printing that token—does not count. The registry currently contains the plan-proof adversarial suite and production-recovery rehearsal; adding another file requires source review of its actual counterexamples. `PPL007` is evaluated per proof statement, so an unrelated exact assertion cannot hide an upper-bound-only cardinality check.

Known historical families are minimized under `tests/fixtures/workflow/plan-proof-lint/`; the linter never needs ignored `.planning` history at runtime.

## Planner contract

For each proof command, the planner must state:

1. the exact claim the command proves;
2. at least one concrete state that would false-pass a weaker command;
3. whether the claim is all-of, exact cardinality, ordered behavior, or legitimate alternatives;
4. the negative control for any migration, production, security, authorization, storage, runtime, ruleset, or release gate;
5. why the command is read-only and does not rewrite timestamps, artifacts, generated docs, schema, caches, or runtime state.

Prefer a tested script when a proof needs parsing, transactions, state machines, more than a short inline expression, or reuse in a second plan. Source-token presence is not behavioral proof unless the claim itself is only source presence. Quick plans do not enter the signed provenance path; use the optional high-assurance profile only for a supported phase artifact after its artifact type is accepted.

## Plan-checker contract

The checker independently reruns the linter. It must not accept a planner's copied linter output. Its report includes one explicit line:

```text
Proof-command safety: PASS | FAIL | HUMAN_DECISION_REQUIRED
```

For every high-risk proof, the checker names at least one counterexample and explains whether the command rejects it. It also reviews any annotation as a semantic exception; annotation syntax only suppresses a deterministic heuristic and never self-approves the proof.

For quick plans, the checker independently reports the lint-plus-semantic result
and preserves `artifact_type_not_supported` as the high-assurance disposition;
it must not invent a signed receipt or infer one from a writer lease. For a
supported phase PLAN/SUMMARY/VERIFICATION artifact under explicit high
assurance, it additionally verifies the source SHA, lease attestation, signed
provenance, committed receipt, path identity, and exact payload correlation.

## Narrow annotations

Place an annotation at most three lines before the affected command. A rationale shorter than 12 characters is rejected.

```text
# proof-lint: allow-or rationale=both values are canonical terminal alternatives
# proof-lint: allow-single-line rationale=the claim is specifically the final sentinel line
# proof-lint: allow-verify-mutation rationale=fixture-only mutation occurs in a disposable copy
# proof-lint: allow-inline-eval rationale=bounded expression is generated and separately reviewed
# proof-lint: allow-pass-marker rationale=the pass token is external immutable input
# proof-lint: allow-no-negative-control rationale=claim is read-only and has no high-risk boundary
```

The semantic checker may still reject an annotated command. `allow-verify-mutation` is intended only for disposable fixture setup, never production, live storage, `.planning`, or accepted evidence.

## Wiring and activation boundary

The project skill is `nutrition-planning-proof`. Both `gsd-planner` and `gsd-plan-checker` must bind exactly the single value `.codex/skills/nutrition-planning-proof`; extra, duplicate, or non-string role values fail closed. The read-only wiring check pins both `SKILL.md` and its delegated `docs/workflow/planning-proof.md` to their exact tracked `100644` blobs at real `HEAD`, requires both worktree files to remain mode `0644`, compares their SHA-256 values with `O_NOFOLLOW` worktree snapshots, and rereads source, config, and both file identities before returning. Any non-empty `GSD_WORKSTREAM` fails closed because a selected overlay could replace the root role bindings. Apply uses a config-digest CAS under the writer fence, reasserts holder/source/config/file evidence immediately before rename, and verifies the renamed config plus file/source evidence again before success. Node does not expose a directory-fd-relative compare-and-rename primitive, so a non-cooperating local process retains a narrow final path-swap race; the writer lease is the mandatory cooperative exclusion boundary. Artifact mutation additionally requires the lease-bound writer fence; PLAN/SUMMARY/VERIFICATION acceptance requires the approved source SHA to equal real `HEAD`, a valid path-identity-bound lease signature, and a separately signed committed off-checkout receipt.

The state invariant checker likewise parses only an immutable, size-bounded two-pass snapshot. Duplicate canonical frontmatter keys, headings, progress sections, phase declarations, SUMMARY status keys, mismatched scalar quotes, unsafe integers, unknown active-phase tree entries, or planning files with off-tree hardlink aliases are errors. A ROADMAP `**Plans**: completed/total` numerator is bound to complete SUMMARY evidence and must stay within its denominator; it is not discarded as presentation prose. Its final source/tree readback includes device, inode, link count, timestamp, mode, size, and digest identity, so an in-place A→B→A restore is stale evidence rather than a pass. Closeout strict verification independently binds the same logical tree to a full identity-bearing freshness snapshot and rejects multi-link files, so replacing an artifact with identical bytes or changing it through an alias cannot pass as fresh.

Capability/skill binding is active: the read-only wiring check must keep both
planner roles bound exactly to the tracked skill and delegated guidance. The
signed governed entrypoint and high-assurance artifact profile remain deferred
opt-in controls; a successful wiring check does not activate them and proof
tooling never grants that authority. The project state is routed by the current
`.planning/STATE.md` and the pinned GSD new-milestone query, not by a stale
handoff document.
