# ADR 0001: Metadata-Only LLM Failure Localization

**Status:** Accepted
**Date:** 2026-05-16
**Milestone:** v2.2 LLM Failure Localization Foundation

## Context

Nutrition Coach needs a way to localize hard chat/LLM failures reported by beta users. A useful report needs to connect the user's fallback/error bubble to route logs, orchestrator behavior, provider failure metadata, and deterministic harness evidence.

The risky alternative is raw forensic capture: prompts, transcripts, provider payloads, tool payloads, image data, session material, database snapshots, SSE frames, or final assistant text. That would create privacy, storage, retention, and access-control obligations that are not required for known hard failures.

## Decision

Use metadata-only failure localization as the default hard-failure debugging layer.

The app generates a server-side `turnId` for chat turns and derives short user-visible references from it. Provider failures are normalized at the LLM provider boundary into allowlisted metadata only. Route/orchestrator observability emits structured failure facts, and normal harness traces use `llm-trace.v2` metadata-only events such as `llm_error`, `orchestrator_fallback`, and `route_fallback`.

Routine logs and traces must not persist raw prompt, user input, transcript, tool raw payload, provider body/header, image data, session material, database snapshot, SSE frame transcript, or assistant final text.

## Consequences

- Users can report a compact fallback reference code without exposing internal UUIDs or raw data.
- Maintainers can trace hard failures through SSE/JSON payloads, route logs, orchestrator hooks, provider metadata, route fallback classification, and harness evidence.
- Deterministic tests and harnesses can prove provider-auth-style failure localization without live OpenAI calls.
- Semantic soft-failure capture, production forensic snapshots, and raw debugger replay remain future features requiring explicit trigger, privacy, retention, storage, and access-control decisions.

## Verification

v2.2 archived evidence:

- `.planning/milestones/v2.2/MILESTONE-AUDIT.md`
- `.planning/milestones/v2.2/phases/58-localization-proof-and-release-gate/58-VERIFICATION.md`
- `tests/harness/scenarios/provider-auth-failure-localization.ts`
- `tests/harness/artifacts/provider-auth-failure-localization/latest/`
