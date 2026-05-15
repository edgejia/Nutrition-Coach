# Changelog

## v2.2 - 2026-05-15

### Added

- Server-generated chat `turnId` correlation across SSE start/done payloads, JSON responses, route logs, orchestrator child logs, trace facts, and frontend fallback references.
- Short user-visible fallback reference codes such as `引用碼 t-XXXXXXXX` for finalized assistant fallback/error bubbles, while full UUID turn ids remain internal.
- Metadata-only OpenAI provider failure normalization with allowlisted status, provider request id, error class/type/code, operation, model, and abort flag.
- Structured orchestrator `onLLMError` and fallback hook payloads that carry safe provider metadata through route-readable fallback context.
- `llm-trace.v2` harness evidence with metadata-only `llm_error`, `orchestrator_fallback`, `route_fallback`, and provider error counts.
- Dedicated `provider-auth-failure-localization` harness proof for auth-style provider failures.

### Changed

- Chat completion observability now separates true completed turns from hard fallback paths through `chat_turn_completed` and `chat_route_fallback`.
- Route catch logging now uses sanitized/truncated route error facts instead of empty catch bindings or raw thrown messages.
- Provider stream continuation failures are classified as metadata-only `llm_error` route fallbacks instead of successful completions.
- Auth-style fallback copy checks stay in runtime memory; generated release artifacts persist metadata counts and booleans, not user-visible assistant text.

### Verified

- v2.2 milestone audit passed `20/20` requirements, `4/4` phases, `4/4` integration checks, `4/4` E2E flows, and `4/4` Nyquist validation coverage.
- Phase 58 verification records targeted JSON/SSE integration tests, `provider-auth-failure-localization`, `text-log`, auth trace shape/privacy scans, `yarn tsc --noEmit`, `yarn build`, `yarn test`, and `yarn release:check` as passed.
- No staging or production promotion was performed during v2.2 closeout.

## v2.1 - 2026-05-12

### Added

- Active prompt version and stable section IDs for chat/logging LLM workflows.
- Generalized redacted `llm-trace.json` artifacts for chat/logging harness runs, including prompt metadata, workflow sequence, final reply source/shape, latency, round count, and tool count.
- Shared AI behavior assertions plus the 8-case `behavior-matrix` harness for high-risk logging, prompt-injection, medical-boundary, and receipt-consistency regressions.
- Deterministic mutation receipt renderer backed by committed `MutationEffects` for successful log, update, delete, and goal changes.

### Changed

- Successful mutation fact replies are renderer-sourced instead of model-passthrough while ordinary non-mutation chat can remain model-generated.
- Onboarding Step 6 now uses real result/loading/failure/fallback states instead of showing mock target numbers before a real result exists.
- Chat receipts, Meal Edit, History, and Day Detail now use localized/product-facing copy for the scoped trust surfaces.
- Behavior-matrix evidence remains separate from `yarn release:check`; release promotion still depends on local release gates plus real Railway staging and production smoke.

### Verified

- v2.1 milestone audit passed `28/28` requirements.
- Phase 50-54 review reports are clean after the Phase 54 warning fix.
- Phase 50 and Phase 54 security reports closed all documented threats with `threats_open: 0`.
- `yarn release:check` passed before staging/main promotion.
- Railway production deployment `3377daaf-820d-4954-9085-8c822ba43d28` passed production text chat, image-backed meal logging, protected asset fetch, refresh persistence, and 390px mobile smoke.

## v2.0 - 2026-05-07

### Added

- Capability matrix and source-contract checks for supported, read-only, hidden, and future-scope Sport UI affordances.
- Graceful Chat stop lifecycle for in-progress AI generation or meal analysis.
- Durable meal image continuity across Chat receipts, Today rows, History, Day Detail, Meal Edit, and authorized asset fetches.
- Canonical grouped meal logging semantics with item counts, grouped correction routing, grouped Meal Edit read-only item detail, and deterministic grouped-meal harness coverage.
- Redacted validation diagnostics for controlled goal and `log_food` validation failures.
- History stale-while-revalidate behavior and Home dashboard count-up / reduced-motion contracts.

### Changed

- Mobile app shell, Chat composer, compact Chat header, keyboard handling, and visual viewport behavior were hardened for primary logging flows.
- Successful meal logging and mutation replies are projected from normalized server state instead of relying on model-authored final text.
- `PATCH /api/device/goals` is documented as the canonical partial-update route while `PUT /api/device/goals` remains supported for compatibility.
- Meal Edit whole-photo framing now avoids fixed-ratio clipping and prevents portrait photos from overlaying grouped item rows.

### Verified

- `yarn release:check` passed before staging promotion and again before main promotion.
- Staging smoke passed on `https://nutrition-coach-stagin.up.railway.app/`.
- Production smoke passed on `https://nutrition-coach-production.up.railway.app/`.
- Phase 49 true-stack UAT passed 7/7 scenarios with real client/API/SQLite data and no route mocks.
