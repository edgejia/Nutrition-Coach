# Coding Conventions

**Analysis Date:** 2026-05-29

## Naming Patterns

**Files:**
- Use kebab-case for multi-word modules in server, client, and tests: `server/services/meal-history.ts`, `server/lib/guest-session-resolver.ts`, `client/src/lib/onboarding-stepper-flow.ts`, `tests/integration/history-search-api.test.ts`.
- Use PascalCase for React component files: `client/src/components/ChatPanel.tsx`, `client/src/components/MealTimeline.tsx`, `client/src/components/onboarding/StepGoalClarification.tsx`.
- Use `.test.ts` for unit and integration test files, with some integration names carrying `.integration.test.ts` when the behavior is cross-layer: `tests/unit/device.test.ts`, `tests/integration/chat-api.test.ts`, `tests/integration/chat-meal-correction.integration.test.ts`.
- Use scenario names that map directly to harness CLI names under `tests/harness/scenarios/`: `tests/harness/scenarios/boundary-contracts.ts` runs as `yarn verify:harness -- boundary-contracts`.

**Functions:**
- Use camelCase for functions and factory functions: `createSummaryService()` in `server/services/summary.ts`, `buildApp()` in `server/app.ts`, `createScenarioApp()` in `tests/harness/app-fixture.ts`.
- Use `createXService(db)` factories for server services and return object literals of async methods: `server/services/summary.ts`, `server/services/device.ts`, `server/services/food-logging.ts`.
- Use local helper functions for route/test assertions instead of broad utility modules when the logic is scoped: `parseSSEEvents()` and `assertNoSuccessfulLogInternalCopy()` in `tests/integration/chat-api.test.ts`.
- Use predicate names beginning with `is`, `has`, or `should` for guards and decisions: `isSummaryOutcome()` in `client/src/api.ts`, `shouldComposeSummaryHistoryReply()` in `server/routes/chat.ts`, `hasRecentUserScrollIntent()` in `client/src/components/ChatPanel.tsx`.

**Variables:**
- Use camelCase for runtime values and service handles: `deviceService`, `guestSessionService`, `dailyTargets`, `summaryOutcome` in `server/app.ts` and `client/src/store.ts`.
- Use ALL_CAPS for constants and regular expressions: `ALLOWED_TYPES`, `UNIFIED_FALLBACK`, `CONCRETE_DATE_PATTERN` in `server/routes/chat.ts`; `MAX_CHAT_IMAGE_BYTES` in `client/src/api.ts`.
- Use `...Service` names for injected service dependencies and `...Provider` for LLM implementations: `MockLLMProvider` in `server/llm/mock.ts`, `StreamingLLMProvider` in `tests/harness/streaming-llm.ts`.
- Use explicit `deviceId`, `cookieHeader`, and `otherDeviceId` names in tests to make ownership boundaries visible: `tests/integration/meals-api.test.ts`, `tests/harness/app-fixture.ts`.

**Types:**
- Use PascalCase for interfaces, types, and classes: `AppOptions` and `AppServices` in `server/app.ts`, `DailySummary` in `server/services/summary.ts`, `IntakeValidationError` in `client/src/api.ts`.
- Export interfaces and domain DTO types near the module that owns them: `server/observability/events.ts`, `server/orchestrator/tool-contract.ts`, `client/src/types.ts`.
- Use discriminated unions and literal types for domain status fields: `SummaryOutcome` from `server/services/summary-outcome.ts`, `RouteFallbackReason` in `server/observability/events.ts`, `GuestSessionStatus` in `client/src/store.ts`.

## Code Style

**Formatting:**
- No Prettier, Biome, or ESLint config is present at the repo root; the visible formatting contract comes from existing TypeScript style in `server/app.ts`, `client/src/store.ts`, and `tests/integration/meals-api.test.ts`.
- Use two-space indentation, semicolons, double quotes, and trailing commas in multi-line object, array, and function-call literals: `server/app.ts`, `server/routes/chat.ts`, `tests/harness/scenarios/boundary-contracts.ts`.
- Keep `else` uncommon when early returns are clearer: `client/src/api.ts`, `server/observability/events.ts`, `tests/harness/app-fixture.ts`.
- Preserve strict TypeScript settings from `tsconfig.json`: `strict: true`, `module: "ES2022"`, `moduleResolution: "bundler"`, and `jsx: "react-jsx"`.

**Linting:**
- Not detected. There is no `.eslintrc*`, `eslint.config.*`, `.prettierrc*`, `prettier.config.*`, or `biome.json` at the repo root.
- Use `yarn tsc --noEmit` as the main static quality gate for TypeScript files, as required by `AGENTS.md`, `docs/codex.md`, and `package.json`.
- Do not introduce Jest, Vitest, ESLint, Prettier, or formatter churn without an explicit migration; existing quality automation is in `package.json` and `scripts/release-check.mjs`.

## Import Organization

**Order:**
1. Runtime external or Node imports first: `fastify`, `@fastify/cors`, `node:fs/promises` in `server/app.ts`; `node:test`, `node:assert/strict` in `tests/unit/device.test.ts`.
2. Local runtime imports next, using explicit `.js` specifiers: `./db/client.js`, `./services/device.js`, `../lib/time.js` in `server/app.ts` and `server/routes/chat.ts`.
3. Type-only imports use `import type` and stay adjacent to related runtime imports: `server/app.ts`, `server/routes/chat.ts`, `tests/integration/meals-api.test.ts`.
4. Dynamic imports are used when runtime ordering matters, especially timezone bootstrapping or test module loading: `await import("./lib/time.js")` in `server/app.ts`, `await import("../../client/src/lib/assistant-markdown.js")` in `tests/unit/assistant-markdown.test.ts`.

**Path Aliases:**
- Not detected. `tsconfig.json` defines no `paths` aliases.
- Use relative imports with explicit `.js` specifiers for local TypeScript modules. The source scan found no local extensionless imports under `server/`, `client/src/`, or `tests/`.
- Do not use CommonJS `require`; the repo is ESM via `"type": "module"` in `package.json`.

## Error Handling

**Patterns:**
- Use domain-specific error classes when client or service callers need structured handling: `IntakeValidationError` and `MealRevisionConflictError` in `client/src/api.ts`, `FatalToolError` in `server/orchestrator/tools.ts`, `LLMProviderError` in `server/llm/errors.ts`.
- Convert unsafe external/provider failures into metadata-only errors before logging or serializing: `OpenAIProvider` behavior is locked by `tests/unit/openai-provider.test.ts`.
- Routes should return controlled status codes and DTOs at HTTP boundaries: `server/routes/chat.ts`, `server/routes/device.ts`, `server/routes/meals.ts`.
- Catch blocks that protect user-facing flows should sanitize or suppress raw internals: `sanitizeRouteCatchError()` in `server/observability/events.ts`, `sanitizeReply()` and `UNIFIED_FALLBACK` in `server/routes/chat.ts`.
- Test error paths with `assert.rejects()`, `assert.throws()`, or explicit response status assertions: `tests/unit/device.test.ts`, `tests/integration/observability-api.test.ts`, `tests/integration/chat-api.test.ts`.

## Logging

**Framework:** Fastify/Pino logger plus console output for CLI scripts.

**Patterns:**
- Runtime logging should flow through Fastify loggers, not direct `console.*`: `server/app.ts` creates Fastify with optional `logger`, `server/orchestrator/hooks.ts` accepts `FastifyBaseLogger`, and `server/observability/events.ts` emits redacted structured events.
- Keep observability event payloads allowlisted and redacted: `RedactedObservabilityEvent` in `server/observability/events.ts`; tests assert no prompts, device IDs, image paths, or provider raw data leak in `tests/integration/observability-api.test.ts` and `tests/unit/openai-provider.test.ts`.
- Use `console.log` and `console.error` in command-line scripts and harness runners only: `scripts/release-check.mjs`, `tests/harness/run.ts`, `scripts/generate-capability-matrix-doc.mjs`.
- Capture logger output with a `Writable` stream when asserting logs: `tests/integration/chat-api.test.ts`, `tests/integration/chat-streaming.test.ts`, `tests/harness/scenarios/provider-auth-failure-localization.ts`.

## Comments

**When to Comment:**
- Add comments for boundary contracts, runtime invariants, and test harness behavior: `server/app.ts` comments on timezone validation, multipart limits, and logger redaction; `tests/harness/app-fixture.ts` documents fixture ownership.
- Keep comments short and tied to an invariant that future edits must preserve: `server/routes/chat.ts`, `client/src/store.ts`, `tests/helpers/spy-hooks.ts`.
- Avoid narrative comments for self-explanatory helpers; most service factories such as `server/services/summary.ts` rely on names and types instead.

**JSDoc/TSDoc:**
- Use JSDoc for public fixtures, CLI runners, and reusable testing helpers: `tests/harness/app-fixture.ts`, `tests/harness/run.ts`, `tests/helpers/spy-hooks.ts`.
- Use inline interface comments for options whose defaults affect runtime/test behavior: `AppOptions` in `server/app.ts`, `ScenarioAppOptions` in `tests/harness/app-fixture.ts`.
- Do not require full TSDoc for every exported function; existing modules use targeted comments only where behavior is non-obvious.

## Function Design

**Size:** Keep pure helpers and services small where practical; route and orchestrator modules are larger because they own transport and workflow coordination. New logic should prefer focused helpers near the owning module, as in `server/routes/chat.ts`, `client/src/api.ts`, and `tests/integration/meals-api.test.ts`.

**Parameters:** Prefer object parameters for dependency bundles and multi-field inputs: `buildApp(opts: AppOptions)` in `server/app.ts`, `createScenarioApp(opts: ScenarioAppOptions)` in `tests/harness/app-fixture.ts`, service methods such as `logFood(deviceId, input)` in `server/services/food-logging.ts`.

**Return Values:** Use typed DTOs and explicit status/result objects rather than ambiguous primitives: `DailySummary` in `server/services/summary.ts`, `ParseHomeCtaClientEventResult` in `server/observability/events.ts`, `ScenarioResult` in `tests/harness/scenario-types.ts`.

## Module Design

**Exports:** Prefer named exports. Service modules export `createXService()` factories; React component modules export named components such as `ChatPanel` in `client/src/components/ChatPanel.tsx`; tests import exact symbols from source files.

**Barrel Files:** Not detected. There are no central barrel exports in `server/`, `client/src/`, or `tests/`; import directly from the owning file such as `../../server/app.js` or `../lib/time.js`.

**Architecture Constraints From Local Skills:**
- Keep dependency injection through `buildApp()` in `server/app.ts`; tests use `MockLLMProvider` in `server/llm/mock.ts` or harness providers in `tests/harness/streaming-llm.ts`.
- Do not instantiate runtime LLM clients inside services. Runtime provider wiring belongs in `server/index.ts` and `server/app.ts`; services under `server/services/` should receive dependencies or database handles.
- Keep `GET /api/sse` and browser-protected routes cookie-backed because EventSource cannot set custom headers; relevant code lives in `server/routes/sse.ts`, `server/lib/guest-session-resolver.ts`, and `client/src/sse.ts`.
- Preserve `TZ=Asia/Taipei` behavior. Time-sensitive code lives in `server/lib/time.ts`, `client/src/lib/time.ts`, and `scripts/run-node-with-tz.mjs`.

---

*Convention analysis: 2026-05-29*
