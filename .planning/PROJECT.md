# Nutrition Coach

## What This Is

Nutrition Coach is a chat-first nutrition logging app for personal beta use. Users log meals by saying what they ate or sending a photo, and the system turns that into persisted meals, daily summaries, historical records, concise Traditional Chinese coaching copy, and metadata-only operational evidence for hard chat/LLM failures.

## Core Value

讓記錄比不記錄還要容易--說一句話、傳一張照片，AI 搞定剩下的。

## Current State

**Shipped version:** v2.6 Meal Editing and History Usability on 2026-06-03.
**Active milestone:** None. v2.6 is archived locally with release-proof evidence. Staging/main promotion still requires a separate ship workflow and explicit approval.

v2.3 made backend-committed mutation facts authoritative across goal updates, meal log/update/delete receipts, stale chat receipt edits, and `daily_summary` SSE freshness.

v2.4 closed correction-authority and meal-intent fidelity gaps: AI-estimated numeric meal corrections cannot commit without explicit evidence or backend-owned approval, explicit meal period intent is not overwritten by clock heuristics, and ambiguous correction flows use stable backend-rendered candidate clarification.

v2.5 stabilized structured AI and transport boundaries. Target generation, authoritative DTO ingestion, receipt persistence, compressed history, guest-session production boot, CORS, and route fallback redaction now depend on typed schema-backed facts rather than ad hoc JSON parsing, display-string inference, or caller-specific sanitization.

v2.6 expanded meal editing and history usability from the stabilized v2.5 boundary. Phase 74 added Home Meal Edit entry for complete authoritative rows, revalidated the existing single-item edit/delete contract, and corrected capability matrix claims. Phase 75 added the strict server-owned grouped meal `items[]` direct CRUD contract with revision, summary, publish, and no-chat-persistence proof. Phase 76 added grouped Meal Edit item rows, validation and stale recovery, media-free grouped DTOs, authoritative post-commit refresh, and mobile grouped-editor visual proof. Phase 77 stabilized History cold loading and fast selected-day pending behavior with metadata-only local proof and no promotion authorization.

**Recent shipped capabilities:**

- Server-generated `turnId` correlation across SSE, JSON, route logs, orchestrator logs, trace facts, and frontend fallback reference display.
- Metadata-only OpenAI provider error normalization with allowlisted status, request id, error class/type/code, operation, model, and abort flag.
- Backend-owned structured pending goal proposals, so confirmation text like `好` can only confirm a proposal id or explicit numeric values.
- Committed mutation receipts for meal log, update, delete, and direct meal routes even when daily summary recompute or publish degrades.
- Server-side stale receipt protection with expected meal revision checks and deterministic recovery guidance.
- Strict `daily_summary` SSE envelopes that refresh same-day rows before committing fresher totals and invalidate matching historical surfaces.
- Explicit meal-period intent persists as structured authority across logging, DTOs, receipts, client state, UI labels, and correction candidates.
- Backend-owned meal numeric correction authority with explicit current-turn evidence checks, revision-scoped proposal approval, and no-mutation handling for vague correction requests.
- Backend-rendered correction target clarification and structured historical tool clarification facts through `ToolExecutionResult.clarification`.
- Provider-level structured object output through `LLMProvider.generateObject()` with runtime OpenAI support, mock parity, validator-owned trust, and metadata-only failures.
- Onboarding target generation uses strict structured object output, service-owned Zod validation, retry/fallback classification, and sanitized telemetry.
- Client API, SSE, and store boundaries validate authoritative DTOs before malformed payloads can replace trusted UI state.
- Receipt-bearing chat finalization persists assistant replies, receipt identity, and structured mutation outcome facts atomically or fails closed before exposing receipt identity.
- Compressed history uses validated persisted structured outcomes instead of display strings.
- Production-like runtime rejects missing, default, or too-weak `GUEST_SESSION_SECRET`; CORS is explicit for local development and production same-origin serving.
- Route fallback catch-field redaction is centralized for structured events and `llm-trace.v2`.
- SSE connections no longer start a keepalive after the client disconnects during initial summary loading.
- Home today meal rows can open the existing Meal Edit flow for complete authoritative meals, while incomplete rows remain silently read-only and grouped meals stay under the existing grouped-lock branch.
- Grouped meals can be updated directly through a strict full-list `items[]` server contract for item add/update/delete while preserving expected meal revision checks, summary freshness outcomes, realtime publish behavior, and chat-persistence boundaries.
- Grouped Meal Edit now renders editable item rows with add/delete controls, validates grouped drafts before save, refreshes through `/api/meals` authoritative grouped item DTOs after successful saves, and keeps item-level media mapping explicitly deferred.
- Capability matrix metadata and generated docs now reflect implemented Home edit entry and Day Detail read-only behavior.
- History week/date switching keeps target context stable, suppresses fast transient selected-day pending-copy flicker, and preserves metadata-only local proof with no promotion authorization.

## Last Completed Milestone: v2.6 Meal Editing and History Usability

**Goal:** Make logged meals easier to revisit and edit while keeping revision authority, grouped item writes, and History loading behavior stable.

**Status:** Archived locally. All v2.6 phases are executed, the milestone audit passed, local release proof is green, phase directories are archived, and no staging/main promotion has been performed.

**Delivered features:**

- Home today meal rows open existing revision-safe Meal Edit for complete authoritative meals.
- Grouped meal direct item add/update/delete through strict server-owned `items[]` replacement.
- Grouped Meal Edit item rows with validation, stale recovery, media-free DTOs, and authoritative post-commit refresh.
- History cold week/date switching keeps stable target context and suppresses fast pending-copy flicker.
- Metadata-only local proof, visual harness evidence, TypeScript, build, and `yarn release:check` passed without promotion.

**Archives:**

- Roadmap: `.planning/milestones/v2.6/ROADMAP.md`
- Requirements: `.planning/milestones/v2.6/REQUIREMENTS.md`
- Audit: `.planning/milestones/v2.6/MILESTONE-AUDIT.md`
- Phases: `.planning/milestones/v2.6/phases/`

## Requirements

### Validated

- ✓ Chat-first meal logging with text and image input persists records and updates daily summaries — v1.1-v2.1.
- ✓ Cookie-backed guest sessions protect browser routes and SSE ownership — v1.4.
- ✓ History, Day Detail, Meal Edit, and Home surfaces preserve canonical meal state and image identity — v1.7-v2.0.
- ✓ Metadata-only hard-failure localization traces failed chat turns through frontend reference code, SSE/JSON payloads, logs, provider metadata, structured fallback events, and `llm-trace.v2` without raw prompt/user/tool/provider/image/session/assistant text payloads — v2.2.
- ✓ Backend-owned goal proposals, committed mutation facts, stale receipt protection, and strict `daily_summary` freshness make mutation outcomes authoritative — v2.3.
- ✓ Explicit meal-period authority, numeric correction provenance, backend-rendered correction clarification, and structured tool-result plumbing protect correction and intent fidelity — v2.4.
- ✓ Provider-level structured object output exists across runtime and test providers with typed success/failure behavior and metadata-only failures — v2.5 Phase 69.
- ✓ Onboarding target generation uses schema-backed provider output, strict Zod validation, deterministic fallback, abort propagation, and sanitized failure telemetry — v2.5 Phase 70.
- ✓ Authoritative client state accepts validated server payloads for summaries, goals, history, and day snapshots, with malformed payloads rejected or omitted before Zustand writes — v2.5 Phase 71.
- ✓ Assistant receipt identity and compressed-history mutation facts are persisted atomically as structured state, with JSON/SSE routes failing closed before exposing receipt identity when persistence fails — v2.5 Phase 72.
- ✓ Production boot rejects missing/default/weak guest-session secrets, CORS is explicit, and route fallback redaction is centralized for events and traces — v2.5 Phase 73.
- ✓ v2.5 has targeted local tests, metadata-only evidence, `yarn tsc --noEmit`, and `yarn release:check` proof with no staging/main promotion — v2.5 Phase 73.
- ✓ Home today meal rows enter the existing Meal Edit flow for complete authoritative meals, existing single-item edit/delete remains revision-safe, and Home/Day Detail capability matrix claims match source — v2.6 Phase 74.
- ✓ Grouped meal direct item add/update/delete is implemented through a strict server-owned `items[]` replacement contract with revision, summary, publish, and no-chat-persistence proof — v2.6 Phase 75.
- ✓ Grouped Meal Edit renders editable item rows with add/delete controls, validation/stale/unsupported recovery, media-free item DTOs, authoritative post-commit refresh, and mobile ergonomics proof — v2.6 Phase 76.
- ✓ History week/date switching keeps stable target context, suppresses fast transient selected-day pending-copy flicker, preserves longer cold-load inline pending copy, and closes with metadata-only local proof plus `yarn release:check` — v2.6 Phase 77.

### Active

- [ ] Prepare v2.6 ship workflow. Staging/main promotion remains unapproved until explicitly requested in the current thread.

### Out of Scope

- Raw payload capture in routine logs/traces — requires separate trigger, access-control, retention, privacy, and storage decisions.
- Production-accessible forensic snapshots — future candidate only; not part of routine metadata-only failure localization.
- User-flagged capture for semantic soft failures — needs its own product/privacy design and is deferred.
- Raw debugger implementation in normal traces — sibling decision remains local-only/default-off future scope until explicitly planned.
- Prompt, transcript, user input, tool raw args, provider raw body/headers, final reply text, image data, session material, or database snapshots in routine logs/traces — excluded to preserve the normal trace contract.
- Metrics, sampling strategy, and production trace productization — useful later, but not required for hard failure localization.
- `deviceId` as admin or forensic access control — explicitly rejected for future raw/forensic work.
- Water tracking, monthly history, onboarding animation, motion system, and visual polish — deferred to future milestone planning.
- Richer general coaching copy and Markdown polish — deferred until correction authority and structured LLM boundaries remain stable in use.
- Client-only correction prevention — server-side authority checks are required; UI discouragement alone is insufficient.

## Context

- The backend remains Fastify + SQLite + TypeScript with route-owned HTTP/SSE boundaries and OpenAI access isolated behind the LLM provider boundary.
- The frontend remains the Sport UI React/Vite client with Zustand as the single authoritative state boundary.
- `.planning/phases/` is empty after v2.6 closeout; planning history for v2.3, v2.4, v2.5, and v2.6 is archived under `.planning/milestones/`.
- v2.6 local closeout ran `yarn release:check` successfully with 1362 tests and did not perform staging or main promotion.
- `origin/staging` remains the deployment/test branch and is ahead of `origin/main`; staging/main promotion is not authorized by milestone planning.
- `.planning/**` is mostly local ignored GSD state after `origin/staging` stopped tracking planning artifacts; keep review summaries explicit about which changes are code/docs versus local planning status.

Known non-blocking debt carried forward:

- Phase 58 proof-hardening warning: auth-detail denylist omits `401`, `Unauthorized`, and `invalid_request_error` in user-visible fallback assertions.
- Phase 58 proof-hardening warning: provider-auth-failure-localization failure evidence can persist the matched forbidden snippet on a failing run.
- Dependency review found high advisories in `drizzle-orm`, `fastify`, and transitive `fast-uri`; package upgrade and regression gates remain future work.
- Phase 67 invalid-selection guidance can drop the service's valid-number wording in one same-date renderer path, though stable numbered options still render.
- One Phase 67 orchestrator test helper can false-pass if uncertainty copy disappears.
- `server/orchestrator/tools.ts` and `server/services/meal-correction.ts` are large authority modules and should be split in a future targeted refactor.

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
| Use metadata-only failure localization before raw forensic capture | Hard failures can be localized without storing sensitive payloads, and users need a reportable reference code. | Validated in v2.2 |
| Normalize provider errors at the LLM provider boundary | The provider boundary sees SDK-specific fields and can expose only allowlisted metadata before orchestration/logging. | Validated in v2.2 |
| Use backend-owned active proposal state for ambiguous goal confirmations | Short confirmation text is too ambiguous to trust model-authored assistant prose. | Validated in v2.3 |
| Separate committed meal mutation facts from summary freshness | Persisted meal mutations are authoritative even when summary recompute, recovery, or publish degrades. | Validated in v2.3 |
| Use expected meal revision checks for stale receipt protection | Server-side precondition checks are authoritative; client refresh/redaction is UX support only. | Validated in v2.3 |
| Treat vague numeric meal corrections as non-authoritative | Model-estimated macro patches can silently rewrite persisted meal facts without user evidence. | Validated in v2.4 |
| Treat explicit meal-period text as higher authority than clock heuristics | A user saying `午餐` is stronger evidence than the hour they logged it. | Validated in v2.4 |
| Move clarification plumbing toward structured tool results | Re-parsing serialized tool messages makes correction/historical clarification brittle. | Validated in v2.4 |
| Add provider-owned structured object output instead of local prose parsing | Services need typed schema-backed object results without duplicating JSON cleanup logic. | Validated in v2.5 |
| Keep target-generation validation service-owned and fail-closed | Invalid model output should affect fallback frequency, not persisted target safety. | Validated in v2.5 |
| Guard authoritative client state at API, SSE, and store boundaries | Malformed server payloads should not replace trusted UI state. | Validated in v2.5 |
| Persist assistant replies, receipt references, and mutation outcome facts atomically | Chat history must not expose receipt-derived identity without matching structured receipt facts. | Validated in v2.5 |
| Generate compressed history from persisted structured outcomes | Display copy is localized UX text, not durable mutation authority. | Validated in v2.5 |
| Enforce deployed-like guest-session secret quality at app boot | Signed guest-session ownership depends on non-default production signing material. | Validated in v2.5 |
| Keep local release proof separate from promotion | Green local gates do not authorize deploy, staging promotion, or production promotion. | Validated through v2.3-v2.6 |
| Use existing Meal Edit for Home row edits | Home should not create a Home-only edit contract; complete rows pass through the same revision-safe Meal Edit payload and grouped-lock behavior. | Validated in v2.6 Phase 74 |
| Represent grouped direct item edits as full-list replacement | Stable item ids and partial item operations are deferred; the direct route accepts a strict ordered `items[]` result so add/update/delete are represented by the next authoritative revision. | Validated in v2.6 Phase 75 |
| Keep grouped item media deferred while enabling item editing | Whole-meal photo identity remains meal-level until item-level mapping has an explicit persistence and UI contract. | Validated in v2.6 Phase 76 |

## Evolution

This document evolves at phase transitions and milestone boundaries.

Last updated: 2026-06-04

**After each phase transition**:
1. Requirements invalidated? Move to Out of Scope with reason.
2. Requirements validated? Move to Validated with phase reference.
3. New requirements emerged? Add to Active.
4. Decisions to log? Add to Key Decisions.
5. "What This Is" still accurate? Update if drifted.

**After each milestone**:
1. Full review of all sections.
2. Core Value check: still the right priority?
3. Audit Out of Scope: reasons still valid?
4. Update Context with current state.

---
*Last updated: 2026-06-04 after v2.6 milestone closeout*
