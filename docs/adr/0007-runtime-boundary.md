# ADR 0007: Runtime Boundary

**Status:** Accepted
**Date:** 2026-06-22
**Milestone:** v3.1 Runtime & LLM Dependency Trust Baseline
**Requirement:** RUNT-01 / RUNT-02

## Context

Nutrition Coach currently runs as a local production-mode Fastify service exposed through the documented release/runtime path. The codebase uses SQLite, local asset files, local upload staging, and process-local realtime publish behavior.

Future runtime work may change those assumptions, but source docs need one durable record of the current production-equivalent boundary so developers and operators do not infer a broader deployment contract from successful source checks, local smoke, or release closeout.

## Decision

The supported production-equivalent runtime is exactly:

- one Fastify process
- one SQLite database path
- stable local asset directories
- request-local upload staging
- process-local SSE fan-out

This ADR is the canonical runtime-boundary record for RUNT-01 and the prerequisite record for RUNT-02. It records current support and prerequisites only.

Before any multi-instance claim, all of these blockers must be resolved and evidenced:

- [ ] shared persistence: database writes, reads, transactions, and backups use a storage design safe for more than one app process.
- [ ] migration coordination: schema migrations have a single-run coordination mechanism and a rollback/retry policy.
- [ ] shared asset storage: uploaded and generated assets are durable and readable by every serving process.
- [ ] upload staging semantics: in-flight upload staging has ownership, cleanup, and handoff rules that remain correct across processes.
- [ ] cross-process realtime delivery: daily summary, goals, and chat-related realtime events reach clients connected to any process.
- [ ] session/cookie behavior: guest-session signing, revocation, epoch checks, cookie scope, and protected route ownership behave consistently across processes.
- [ ] smoke evidence: source, runtime refresh, public-domain smoke, and rollback evidence prove the intended topology end to end.

This ADR does not implement or authorize multi-instance deployment, production runtime refresh, Cloudflare Tunnel changes, public smoke, tag movement, or `main` promotion. Those actions remain separate explicit gates in the release and deployment runbooks.

## Consequences

- Architecture and release docs should point readers here when they need the source-of-truth runtime boundary.
- Successful CI, local release checks, GSD closeout, or PR readiness do not change the runtime boundary recorded here.
- Any future runtime topology change needs a new plan that resolves the prerequisite checklist and updates this ADR or supersedes it with a new decision record.

## Verification

Use source checks to verify the boundary stays explicit:

- The ADR contains the five runtime-boundary phrases: one Fastify process, one SQLite database path, stable local asset directories, request-local upload staging, and process-local SSE fan-out.
- The ADR contains the seven prerequisite phrases: shared persistence, migration coordination, shared asset storage, upload staging semantics, cross-process realtime delivery, session/cookie behavior, and smoke evidence.
- The ADR states that it does not authorize multi-instance deployment or runtime refresh.
