---
name: nutrition-planning-proof
description: Enforce Nutrition Coach planning-proof safety for planner-authored verification commands and independent plan checking.
---

# Nutrition Planning Proof

Read `docs/workflow/planning-proof.md` before creating or checking a plan.

## Planner

0. Before creating or mutating a planning artifact, require the active lease-bound writer fence. Nested governed tools must validate its non-secret fence ID plus the holder token. After writing PLAN/SUMMARY/VERIFICATION, use the signed artifact provenance stamp with an exact file preimage digest, approved source SHA equal to real `HEAD`, and a separately signed committed off-checkout receipt. Never infer the writer runtime from `.planning/config.json`.
1. Treat every `<verify>`/`<automated>` command as code.
2. Keep executable proof inside balanced `<task>` → `<verify>`/`<automated>` scopes. Fences, comments, inline examples, crossed tags, and prose are not proof.
3. State the command's exact claim and one false-pass counterexample. Classify it as all-of, exact cardinality, ordered behavior, or legitimate alternatives.
4. Stay inside the linter's closed read-only command model. Direct Node checkers are an exact allowlist, not a basename heuristic. Move complex shell, parsing, state-machine, or reusable logic into a small reviewed checker invoked through an approved test or package gate.
5. Use per-item all-of checks, exact cardinality assertions, and an actually executed negative control at high-risk boundaries. A prose claim or printed option token is not a negative control.
6. Run `yarn workflow:plan-proof --plan=<plan>` before returning the plan.
7. Fix every finding or add a narrow rationale annotation that the checker can independently reject.

## Plan checker

0. Run the read-only artifact provenance check with the approved source SHA and committed receipt. Fail if the path identity/payload is stale, either Ed25519 provenance/receipt signature or attestation is absent, or source/runtime/GSD identity is invalid.
1. Independently rerun `yarn workflow:plan-proof --plan=<plan>`; do not trust copied output.
2. Review each annotation semantically.
3. Name at least one false-pass counterexample for every high-risk proof and confirm the exact command rejects it.
4. Emit `Proof-command safety: PASS`, `FAIL`, or `HUMAN_DECISION_REQUIRED`.
5. Fail the plan if proof mutates accepted evidence, uses presence as behavior, lacks exact completeness, or cannot reject its counterexample.

## Binding evidence

Before treating this guidance as active, require the read-only wiring check to prove both planner roles contain exactly `.codex/skills/nutrition-planning-proof` and nothing else. It must also prove this `SKILL.md` and its delegated `docs/workflow/planning-proof.md` are mode-`100644` blobs tracked at the approved real `HEAD`, with mode `0644`, matching SHA-256 bytes, and stable config/file/source readback in the worktree. Any active `GSD_WORKSTREAM` overlay fails closed because it could replace the checked root role bindings. Merely finding the skill name in an array is not activation evidence.

This skill does not authorize plan execution, `.planning` mutation, migration, runtime work, GitHub writes, Tunnel work, smoke, or production action.
