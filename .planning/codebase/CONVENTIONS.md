# Coding Conventions

**Analysis Date:** 2026-05-26

## Naming Patterns

**Files:**
- Use kebab-case for most source and test files: `server/services/food-logging.ts`, `server/routes/day-snapshot.ts`, `client/src/lib/onboarding-intake-validation.ts`, `tests/unit/source-text-guard.test.ts`.
- Use PascalCase for React component files: `client/src/components/MessageBubble.tsx`, `client/src/components/Onboarding.tsx`, `client/src/components/DashboardMiniBar.tsx`.
- Use `.test.ts` for Node test files under `tests/unit/` and `tests/integration/`: `tests/unit/food-logging.test.ts`, `tests/integration/meals-api.test.ts`.
- Use `.integration.test.ts` only when the test name needs to call out a larger cross-boundary scenario: `tests/integration/chat-goal-update.integration.test.ts`, `tests/integration/chat-meal-correction.integration.test.ts`.
- Use scenario names as kebab-case under `tests/harness/scenarios/`: `tests/harness/scenarios/daily-rollover.ts`, `tests/harness/scenarios/guest-session-hardening.ts`, `tests/harness/scenarios/provider-auth-failure-localization.ts`.

**Functions:**
- Use camelCase for functions and methods: `createFoodLoggingService()` in `server/services/food-logging.ts`, `registerMealRoutes()` in `server/routes/meals.ts`, `buildApp()` in `server/app.ts`.
- Use `create*Service` factories for domain services that close over dependencies and return method objects: `server/services/food-logging.ts`, `server/services/summary.ts`, `server/services/guest-session.ts`.
- Use `register*Routes` functions for Fastify route modules: `server/routes/meals.ts`, `server/routes/chat.ts`, `server/routes/sse.ts`.
- Use local parser/guard helpers with intent-specific names: `parseMealUpdateBody()`, `isFiniteNonNegativeNumber()`, and `publishDailySummarySafe()` in `server/routes/meals.ts`.
- Use assertion helpers in tests with `assert*` names: `assertMealRevisionPrecondition()` in `tests/unit/food-logging.test.ts`, `assertNoRawImageStorageFields()` in `tests/integration/meals-api.test.ts`.

**Variables:**
- Use camelCase for runtime values and dependency handles: `foodLoggingService`, `guestSessionService`, `deviceCookieHeader`, `otherDeviceId` in `server/app.ts` and `tests/integration/meals-api.test.ts`.
- Use UPPER_SNAKE_CASE for constants that represent protocol limits, pattern tables, event strings, or runtime contracts: `ALLOWED_TYPES`, `UNIFIED_FALLBACK`, `SENSITIVE_IDENTIFIERS` in `server/routes/chat.ts`; `REQUIRED_TZ` in `scripts/run-node-with-tz.mjs`.
- Use `*Id` suffixes for persisted identifiers and ownership boundaries: `deviceId`, `mealId`, `mealRevisionId`, `imageAssetId` in `server/routes/meals.ts`, `client/src/api.ts`, and `tests/integration/meals-api.test.ts`.
- Use `*Dir` suffixes for filesystem roots: `uploadsDir`, `assetsDir`, `clientDistDir` in `server/app.ts` and `server/config.ts`.

**Types:**
- Use PascalCase interfaces/types for DTOs, service payloads, and harness contracts: `AppOptions`, `AppServices` in `server/app.ts`; `MealUpdateBody` in `server/routes/meals.ts`; `ScenarioResult` and `VerificationScenario` in `tests/harness/scenario-types.ts`.
- Use union literal types for protocol state and error codes: `GuestSessionStatus` in `client/src/store.ts`, `MealRevisionConflictCode` in `client/src/api.ts`, `RouteFallbackReason` in `server/observability/events.ts`.
- Use `ReturnType<typeof create...>` to type DI dependencies instead of duplicating service object shapes: `Deps` in `server/routes/meals.ts`, `AppServices` in `server/app.ts`.
- Use `as const` for fixed enum-like tables and step name tuples: `INTAKE_FIELDS` in `server/observability/events.ts`, `STEP_NAMES` in `tests/harness/scenarios/daily-rollover.ts`.

## Code Style

**Formatting:**
- Formatting is TypeScript-first with no detected Prettier, ESLint, Biome, Jest, or Vitest config files at the repo root. `tsconfig.json` is the enforceable style/type gate.
- Use two-space indentation, semicolons, double quotes for string literals, and trailing commas in multiline object/array/function call layouts. Examples: `server/app.ts`, `client/src/components/MessageBubble.tsx`, `tests/integration/meals-api.test.ts`.
- Keep narrow helper functions near their consumers. Route-local parsing and publishing helpers live above `registerMealRoutes()` in `server/routes/meals.ts`; component-local formatting and presentation helpers live above `MessageBubble` in `client/src/components/MessageBubble.tsx`.
- Prefer explicit object shapes and type predicates over ad hoc casts. Examples: `isRecord()` and response guards in `client/src/api.ts`, `isSummaryOutcome()` in `client/src/api.ts`, `sanitizeFields()` in `server/observability/events.ts`.

**Linting:**
- Not detected: `.eslintrc*`, `eslint.config.*`, `.prettierrc*`, `biome.json`, `jest.config.*`, and `vitest.config.*`.
- Use `yarn tsc --noEmit` as the primary repository-wide static gate. The command is required by `AGENTS.md` for any `*.ts` edit and is part of `yarn release:check` in `scripts/release-check.mjs`.
- `tsconfig.json` sets `"strict": true`, `"module": "ES2022"`, `"moduleResolution": "bundler"`, `"jsx": "react-jsx"`, and includes `server/**/*.ts`, `tests/**/*.ts`, `client/src/**/*.ts`, `client/src/**/*.tsx`, and `client/vite.config.ts`.

## Import Organization

**Order:**
1. External runtime/library imports first: `fastify`, `@fastify/cors`, `drizzle-orm`, `react`, `zustand`.
2. Node built-ins with `node:` specifiers: `node:fs/promises`, `node:path`, `node:test`, `node:assert/strict`, `node:stream`.
3. Local implementation imports with explicit `.js` specifiers: `./db/client.js`, `../services/assets.js`, `../../server/app.js`, `./AssistantMarkdown.js`.
4. Type-only imports use `import type` and are grouped beside the related value imports: `server/app.ts`, `server/routes/meals.ts`, `client/src/components/MessageBubble.tsx`.

**Path Aliases:**
- Not detected. Use relative imports throughout the repo.
- Local TypeScript imports must include explicit `.js` specifiers because the repo is ESM: `server/app.ts`, `client/src/api.ts`, `tests/unit/food-logging.test.ts`, and `tests/harness/run.ts` all follow this pattern.
- Do not introduce CommonJS `require` or extensionless local imports.

## Error Handling

**Patterns:**
- Route handlers return explicit HTTP responses with stable error payloads at the transport boundary. Examples: `reply.code(401).send({ error: session.error })`, `reply.code(400).send({ error: "Invalid meal update" })`, and `sendMealRevisionConflict()` in `server/routes/meals.ts`.
- Service/domain errors use typed `Error` subclasses or stable error messages/codes when callers need branching behavior. Examples: `MealRevisionPreconditionError` consumed by `server/routes/meals.ts`; `MealRevisionConflictError` and `IntakeValidationError` in `client/src/api.ts`.
- Treat observability and realtime fan-out as best-effort when product state is already committed. `publishDailySummarySafe()` in `server/routes/meals.ts` catches publisher failures and logs a warning without changing the route response.
- Sanitize user-facing or persisted fallback text before emitting or saving it. `sanitizeReply()` and `normalizeRouteFinalReply()` in `server/routes/chat.ts` strip internal tool identifiers and guard false meal-logging claims.
- Fail fast on runtime contracts that would corrupt product behavior. `validateTimezone()` in `server/lib/time.ts` throws unless `TZ` is explicitly `Asia/Taipei`; `buildApp()` invokes it during app boot in `server/app.ts`.
- Close resources in `catch`/`finally` paths. `createDb()` closes SQLite before rethrowing schema errors in `server/db/client.ts`; integration tests close Fastify and delete temp dirs in `afterEach()` in `tests/integration/meals-api.test.ts`.

## Logging

**Framework:** Fastify logger plus selected `console` output in scripts/harnesses.

**Patterns:**
- `server/app.ts` defaults Fastify logging to `false` for tests and accepts `AppOptions.logger` for production or capture-based tests.
- Route logs use structured payloads with an `event` field: `request.log.info({ event: "day_rollover" }, ...)` in `server/routes/meals.ts`, `logChatTurnCompleted()` and `logChatRouteFallback()` in `server/routes/chat.ts`.
- Observability event builders sanitize and allowlist fields before logging. Use `server/observability/events.ts` for onboarding, chat fallback, device goals, and SSE connection events.
- Scripts and harnesses print concise operational summaries: `scripts/release-check.mjs` prints `[release-check]` labeled steps, and `tests/harness/run.ts` prints `PASS <scenario> <passed>/<total>` or `FAIL <scenario> <step>`.

## Comments

**When to Comment:**
- Comment runtime invariants, test fixture mechanics, or non-obvious safety gates. Examples: timezone contract comments in `server/lib/time.ts`, upload parser limit comment in `server/app.ts`, and EventSource shim comments in `tests/unit/sse-client.test.ts`.
- Use comments to document generated or deterministic harness behavior, especially artifact and fixture ownership. Examples: `tests/harness/app-fixture.ts`, `tests/harness/run.ts`, `tests/harness/scenarios/daily-rollover.ts`.
- Avoid comments for simple assignments or self-evident code. Most service methods in `server/services/food-logging.ts` are uncommented and rely on names and types.

**JSDoc/TSDoc:**
- Use short block comments for exported app/harness option fields where callers need behavior details: `AppOptions` in `server/app.ts`, `ScenarioAppOptions` in `tests/harness/app-fixture.ts`, `VerificationScenario` in `tests/harness/scenario-types.ts`.
- Use JSDoc on reusable test helpers only when lifecycle usage is important. `createSpyHooks()` in `tests/helpers/spy-hooks.ts` documents that spies must be created inside `beforeEach()`.

## Function Design

**Size:** Keep ordinary helpers small and purpose-specific. Larger route and orchestration modules exist where protocol coordination is inherently complex: `server/routes/chat.ts` owns SSE, upload, fallback, trace, and cleanup behavior; split new reusable logic into `server/orchestrator/*`, `server/services/*`, or `server/lib/*` when it becomes independent of route transport.

**Parameters:** Pass explicit dependencies through factory options instead of importing singletons inside services or routes. `buildApp()` wires services and route dependencies in `server/app.ts`; route modules receive a `Deps` object, as in `server/routes/meals.ts`; tests inject `MockLLMProvider`, temp dirs, and `onServicesReady` through `buildApp()` in `tests/integration/meals-api.test.ts`.

**Return Values:** Prefer typed DTO objects at boundaries and small discriminated outcomes for parse/validation results. Examples: `ParseHomeCtaClientEventResult` in `server/observability/events.ts`, `SummaryOutcome` in `server/services/summary-outcome.ts`, `ScenarioResult` in `tests/harness/scenario-types.ts`.

## Module Design

**Exports:** Use named exports. Examples: `export async function buildApp()` in `server/app.ts`, `export function createFoodLoggingService()` in `server/services/food-logging.ts`, `export function MessageBubble()` in `client/src/components/MessageBubble.tsx`.

**Barrel Files:** Not detected. Import concrete modules directly by relative path, such as `../services/food-logging.js`, `../../server/lib/time.js`, and `./components/Onboarding.js`.

**Project-Specific Constraints:**
- Use `yarn` commands only. `package.json` defines the repo-native scripts.
- Preserve ESM discipline: `"type": "module"` in `package.json`, explicit `.js` local imports, and no CommonJS escape hatches.
- Preserve dependency injection: runtime uses `OpenAIProvider` through `server/index.ts`/`server/app.ts`; tests use `MockLLMProvider` from `server/llm/mock.ts` or deterministic harness providers from `tests/harness/streaming-llm.ts`.
- Preserve the cookie-backed guest-session contract for browser routes. `server/lib/guest-session-resolver.ts` and route modules such as `server/routes/meals.ts` derive ownership from cookies rather than raw `deviceId` query params or `x-device-id` headers.

---

*Convention analysis: 2026-05-26*
