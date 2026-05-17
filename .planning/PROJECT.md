# Nutrition Coach

## What This Is

Nutrition Coach is a chat-first nutrition logging app for personal beta use. Users log meals by saying what they ate or sending a photo, and the system turns that into persisted meals, daily summaries, historical records, concise Traditional Chinese coaching copy, and metadata-only operational evidence for hard chat/LLM failures.

## Core Value

讓記錄比不記錄還要容易--說一句話、傳一張照片，AI 搞定剩下的。

## Current State

**Shipped version:** v2.2 LLM Failure Localization Foundation on 2026-05-15.

v2.2 completed the metadata-only failure-localization foundation for the chat/logging LLM path. User-visible fallback/error bubbles can now carry a short reference code derived from a server-generated `turnId`, and maintainers can trace that turn through SSE/JSON route payloads, Fastify child logs, orchestrator hook facts, safe provider metadata, `chat_route_fallback`, and `llm-trace.v2` harness evidence.

**Recent shipped capabilities:**
- Server-generated `turnId` correlation across SSE, JSON, route logs, orchestrator logs, trace facts, and frontend fallback reference display.
- Safe OpenAI provider error normalization with allowlisted status, request id, error class/type/code, operation, model, and abort flag.
- Structured `onLLMError` and fallback hook payloads with route-readable `llm_error` context.
- Separate `chat_turn_completed` and `chat_route_fallback` observability paths so hard fallback turns are not counted as completions.
- `llm-trace.v2` metadata-only failure evidence with provider error counts, route fallback facts, redaction checks, and raw-debugger boundaries preserved.
- Deterministic release proof for auth-style provider failure localization, SSE start ordering, JSON parity, fallback/completion exclusivity, and generic Traditional Chinese fallback copy.

## Current Milestone: v2.3 Authoritative Mutation Outcomes and Fresh Meal State

**Goal:** Close the remaining P1 data-integrity issues from the Notion BUG / FEATURE board before returning to product-polish backlog.

**Target features:**
- Backend-owned structured pending goal proposals, so confirmation text like `好` can only confirm a proposal id or explicit numeric values.
- Deterministic backend failure copy for failed `update_goals` validation or guard outcomes, never LLM-authored success-style text.
- Committed mutation receipts for update, delete, and log flows even when daily summary recompute fails.
- Stale chat receipt protection so older receipts cannot overwrite newer meal facts.
- SSE daily summary freshness so cross-tab/device summary events cannot leave Home/Summary totals newer than visible meal rows.

## Requirements

### Validated

- ✓ Chat-first meal logging with text and image input persists records and updates daily summaries — v1.1-v2.1.
- ✓ Cookie-backed guest sessions protect browser routes and SSE ownership — v1.4.
- ✓ History, Day Detail, Meal Edit, and Home surfaces preserve canonical meal state and image identity — v1.7-v2.0.
- ✓ Redacted `llm-trace.json` harness evidence captures AI workflow sequence without raw prompt, transcript, provider payload, tool payload, image data, session material, or final assistant text — v2.1 Phase 51.
- ✓ Deterministic behavior matrix and renderer-owned mutation receipts protect the highest-risk AI trust paths — v2.1 Phases 52-53.
- ✓ v2.1 production release proof passed local release checks, Railway staging smoke, and Railway production smoke — v2.1 Phase 54.
- ✓ Maintainer can trace failed chat turns from frontend reference code to SSE/JSON payloads, route logs, orchestrator hook logs, provider metadata, route fallback classification, and harness trace evidence — v2.2 Phases 55-58.
- ✓ User-facing fallback/error copy can include a stable short reference code derived from the server-generated `turnId` — v2.2 Phase 55.
- ✓ Provider failure metadata is normalized at the LLM provider boundary and propagated through hooks without logging raw provider bodies, headers, prompts, user input, tool raw payloads, image data, session material, or assistant final text — v2.2 Phase 56.
- ✓ Successful chat completions and fallback paths are represented by separate structured events, so operational summaries do not count fallback as completed — v2.2 Phase 57.
- ✓ Normal `llm-trace.json` can add metadata-only failure events while preserving the raw-debugger boundary documented in `docs/research/logger/llm-trace-raw-debugger-decision.md` — v2.2 Phase 57.
- ✓ Auth-style provider failure localization has deterministic integration and harness proof without persisting user-visible fallback text — v2.2 Phase 58.
- ✓ Backend-owned goal proposals gate ambiguous confirmation text, and rejected goal updates return deterministic backend copy without mutation or publish side effects — v2.3 Phase 60.
- ✓ Meal log, update, delete, and direct meal PATCH/DELETE mutations return committed facts with an explicit summary freshness outcome even when summary recompute or publish degrades — v2.3 Phase 61.

### Active

- [ ] **FRESH-01** Chat receipt actions cannot PATCH stale meal facts over newer meal state.
- [ ] **FRESH-02** Daily summary SSE events refresh or invalidate meal rows alongside summary totals.

### Out of Scope

- Raw payload capture in routine logs/traces — requires separate trigger, access-control, retention, privacy, and storage decisions.
- Production-accessible forensic snapshots — future candidate only; not part of routine metadata-only failure localization.
- User-flagged capture for semantic soft failures — needs its own product/privacy design and is deferred.
- Raw debugger implementation in normal traces — sibling decision remains local-only/default-off future scope until explicitly planned.
- Prompt, transcript, user input, tool raw args, provider raw body/headers, final reply text, image data, session material, or database snapshots in routine logs/traces — excluded to preserve the normal trace contract.
- Metrics, sampling strategy, and production trace productization — useful later, but not required for v2.2 hard failure localization.
- `deviceId` as admin or forensic access control — explicitly rejected for future raw/forensic work.
- Water tracking, monthly history, onboarding animation, motion system, and visual polish not required for P1 integrity closure — deferred until this data-integrity milestone is complete.

## Context

Current codebase state after v2.2:
- The backend remains Fastify + SQLite + TypeScript with route-owned HTTP/SSE boundaries and OpenAI access isolated behind the LLM provider boundary.
- The frontend remains the Sport UI React/Vite client with Zustand as the state boundary.
- Active planning history for v2.2 is archived under `.planning/milestones/v2.2/`.
- Pre-existing generated harness artifact diffs under `tests/harness/artifacts/text-log/latest/` and `tests/harness/artifacts/image-log-failure/latest/` were inspected during closeout. They contained only regenerated UUID, timestamp, and latency noise, so they were restored instead of included in the v2.2 tag.

Known non-blocking debt accepted at v2.2 close:
- Phase 58 proof-hardening warning: auth-detail denylist omits `401`, `Unauthorized`, and `invalid_request_error` in user-visible fallback assertions.
- Phase 58 proof-hardening warning: provider-auth-failure-localization failure evidence can persist the matched forbidden snippet on a failing run.
- Dependency review found high advisories in `drizzle-orm`, `fastify`, and transitive `fast-uri`; defer package upgrade and regression gates to the next milestone.

v2.3 integrity context:
- The Notion BUG / FEATURE board surfaced remaining P1 risks around ambiguous goal confirmations, failed mutation outcomes, post-commit summary recompute failure handling, stale chat receipt edits, and cross-tab/device meal freshness after daily summary SSE events.
- Success for this milestone means no user-visible success claim can be authored only by LLM prose after a failed mutation or guard rejection.
- Verification must include targeted unit/integration coverage, relevant SSE/client state coverage, `yarn tsc --noEmit`, and `yarn release:check`.

## Constraints

- **Privacy:** Provider metadata must remain metadata-only. Do not log raw provider body, headers, prompts, messages, tools, user input, tool raw payloads, image data, session material, database snapshots, or final reply text.
- **Trace contract:** Normal `llm-trace.json` remains redacted harness evidence. Metadata-only `llm_error` events are allowed; raw forensic replay is not.
- **Transport:** `GET /api/sse` relies on cookie-backed guest sessions because browser `EventSource` cannot set custom headers.
- **Timezone:** `TZ=Asia/Taipei` remains a boot and test boundary.
- **Verification:** TypeScript edits require `yarn tsc --noEmit`; route/service edits require integration tests; harness scenario changes require the matching harness verification.
- **Release:** Before any feature branch promotion to `staging` or `main`, run `yarn release:check`. Do not promote to `main` without explicit current-thread approval.

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Build metadata-only failure localization before raw forensic capture | Hard failures can be localized without storing sensitive payloads, and the user needs a reportable reference code now. | Validated in v2.2 |
| Use server-generated `turnId` as the cross-layer correlation id | Fastify `reqId` is server-only and does not span frontend fallback display, orchestrator hooks, trace events, and JSON/SSE parity. | Validated in v2.2 |
| Normalize provider errors at the LLM provider boundary | The provider boundary sees SDK-specific fields and can expose only allowlisted metadata before orchestration/logging. | Validated in Phase 56 |
| Keep provider error logging in hooks/structured logs rather than raw provider logger calls | Existing architecture routes orchestration observability through hooks and keeps services/providers free of direct logger ownership. | Validated in Phase 56 |
| Separate fallback and completion observability | HTTP delivery success is not the same as a completed chat turn; fallback paths need their own event and trace facts. | Validated in Phase 57 |
| Keep user-visible fallback copy checks non-persisted | Release evidence should prove localization/privacy while keeping artifacts metadata-only. | Validated in Phase 58 |
| Use backend-owned active proposal state for ambiguous goal confirmations | Short confirmation text is too ambiguous to trust model-authored assistant prose; mutation authority now requires explicit current-turn numeric values or the latest active backend proposal. | Validated in Phase 60 |
| Treat renderer-owned goal rejection/cancel replies as terminal final replies | Failed goal updates, missing proposals, malformed calls, and cancel text must not be rewritten by a later LLM round into success-style prose. | Validated in Phase 60 |
| Separate committed meal mutation facts from summary freshness | Persisted meal log/update/delete/direct route facts are authoritative even when summary recompute, recovery, or publish degrades; `summaryOutcome` carries freshness status. | Validated in Phase 61 |
| Defer raw debugger/user-flagged capture | Those features require trigger, access-control, retention, privacy notice, content scope, and storage decisions first. | Still deferred |

## Archived Previous State

<details>
<summary>v2.2 active milestone brief</summary>

v2.2 built metadata-only failure localization so a user-visible chatbot fallback can be traced through frontend reference code, SSE/JSON route logs, orchestrator hooks, provider error metadata, and harness trace evidence.

Target features included a server-generated `turnId` correlation spine, safe OpenAI provider error normalization, orchestrator hook and trace schema expansion, route fallback logging split, sanitized route catch metadata, JSON path parity, and SSE `event: start` contract.

</details>

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `$gsd-transition`):
1. Requirements invalidated? -> Move to Out of Scope with reason
2. Requirements validated? -> Move to Validated with phase reference
3. New requirements emerged? -> Add to Active
4. Decisions to log? -> Add to Key Decisions
5. "What This Is" still accurate? -> Update if drifted

**After each milestone** (via `$gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check -- still the right priority?
3. Audit Out of Scope -- reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-05-17 after Phase 61 completion*
