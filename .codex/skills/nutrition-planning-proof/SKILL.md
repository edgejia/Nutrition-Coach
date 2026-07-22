---
name: nutrition-planning-proof
description: Enforce Nutrition Coach planning-proof safety for planner-authored verification commands and independent plan checking.
---

# Nutrition Planning Proof

Read `docs/workflow/planning-proof.md` before creating or checking a plan.

## Proof profiles

This side project has two deliberately different proof profiles:

| Artifact scope | Normal contract | High-assurance contract |
| --- | --- | --- |
| GSD quick plans (`.planning/quick/**`, including quick IDs) | Deterministic `plan-proof-lint` plus an independent semantic checker. No signed artifact claim is required. | Not supported by the current provenance CLI; record `artifact_type_not_supported` and stop at the deterministic/semantic boundary. |
| Supported phase `*-PLAN.md`, `*-SUMMARY.md`, and `*-VERIFICATION.md` artifacts | The same deterministic and semantic checks remain useful. | Only when explicitly selected: active lease-bound writer fence, exact source preimage, signed provenance, and a separately signed committed receipt. |

The quick artifact `260723-3a3` is intentionally recorded as
`artifact_type_not_supported` for the high-assurance profile. It was not signed,
receipt-backed, or governed by a high-assurance entrypoint. Do not infer a
signature from a lease held while planning, from `.planning/config.json`, or
from a passing linter.

Passing `workflow:plan-proof` does not make the current PLAN signed.

## Planner

1. Run the deterministic linter before returning any plan:
   `yarn workflow:plan-proof --plan=/absolute/or/repo-relative/PLAN.md`.
2. Run an independent semantic checker; it must inspect the plan itself rather
   than trust copied linter output. A quick plan stops after these two checks.
3. For each proof command, state the exact claim, one false-pass counterexample,
   its claim shape (all-of, exact cardinality, ordered behavior, or legitimate
   alternatives), and why the command is read-only.
4. Treat every `<verify>`/`<automated>` command as code. Keep executable proof
   inside balanced `<task>` → `<verify>`/`<automated>` scopes.
5. Stay inside the linter's closed read-only command model. Direct Node
   checkers are an exact allowlist, not a basename heuristic. Move complex
   parsing or state-machine proof into a small reviewed checker invoked through
   an approved test or package gate.
6. Use per-item all-of checks, exact cardinality assertions, and an actually
   executed negative control at high-risk boundaries.
7. If a maintainer explicitly selects the supported phase high-assurance
   profile, first obtain the active lease-bound writer fence. After writing a
   supported phase PLAN/SUMMARY/VERIFICATION artifact, stamp its exact preimage
   with signed provenance and a separately signed committed off-checkout
   receipt. Never infer runtime or source identity from shared config.

## Plan checker

1. Independently rerun `yarn workflow:plan-proof --plan=<plan>` and the semantic
   checker. Never accept copied planner output.
2. For a quick artifact, report the normal lint-plus-semantic result and retain
   the explicit `artifact_type_not_supported` high-assurance disposition. Do
   not require or imply a signed quick artifact.
3. For a supported phase artifact when high assurance was explicitly selected,
   require the approved source SHA, current path identity, valid Ed25519
   provenance/receipt signatures, lease attestation, and exact payload
   correlation. Missing or stale evidence fails closed.
4. Name at least one counterexample for every high-risk proof and explain
   whether the exact command rejects it.
5. Emit `Proof-command safety: PASS`, `FAIL`, or `HUMAN_DECISION_REQUIRED`.
   Fail the plan if proof mutates accepted evidence, uses presence as behavior,
   lacks exact completeness, or cannot reject its counterexample.

## Binding evidence

Capability and skill binding are active independently of the optional signed
governed entrypoint. Before treating this guidance as active, require the
read-only wiring check to prove both `gsd-planner` and `gsd-plan-checker`
contain exactly the single value `.codex/skills/nutrition-planning-proof` and
nothing else. It must also prove this `SKILL.md` and its delegated
`docs/workflow/planning-proof.md` are mode-`100644` blobs tracked at the
approved real `HEAD`, with mode `0644`, matching SHA-256 bytes, and stable
config/file/source readback in the worktree. Any non-empty `GSD_WORKSTREAM`
fails closed because a selected overlay could replace the root role bindings.
Merely finding the skill name in an array is not activation evidence.

The high-assurance profile does not authorize plan execution, `.planning`
mutation for an unsupported artifact, migration, runtime work, GitHub writes,
Tunnel work, smoke, production action, or source release. Those remain
separate approvals.
