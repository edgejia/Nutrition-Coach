---
name: nutrition-planning-proof
description: Nutrition Coach project evidence selection for planner and plan-checker verification.
---

# Nutrition Planning Proof

GSD owns plan structure, command review, semantic checking, and lifecycle. This
skill contains only project evidence-selection rules.

Use the nearest real project command and behavioral test for every planned
risk. Prefer a targeted command that cannot silently match zero tests, skip a
failure path, or rely on a generated/private artifact.

When a PLAN touches guest-session/upload/SSE, SQLite recovery,
harness false-pass, timezone, or another project boundary, include its existing
negative control or closest equivalent:

- guest-session ownership: `tests/integration/ownership-boundary-api.test.ts`
- upload/asset cleanup: `tests/harness/scenarios/image-log-failure.ts`
- SSE terminal ordering: `tests/integration/phase-128-sse-negative-controls.test.ts`
- SQLite recovery/migration: `tests/integration/production-recovery-rehearsal.test.ts`
- harness lifecycle/artifact privacy: the phase-128 harness/artifact controls
- timezone/day boundaries: `tests/integration/timezone-guard.integration.test.ts`

Reject proof that uses zero-match/skipped tests, weak cardinality checks,
missing failure cases, arbitrary checker scripts, or private/generated output.
Check `AGENTS.md` for the touched risk and require targeted regression
coverage.

PLAN verification must not include `yarn release:check`, migrations, runtime
actions, Tunnel work, or public smoke; those remain independent gates.

Quick artifacts are not signed provenance. If a signed receipt, seal, or
attestation is requested, record `artifact_type_not_supported` and do not
invent one.
