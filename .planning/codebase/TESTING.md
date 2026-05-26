# Testing Patterns

**Analysis Date:** 2026-05-26

## Test Framework

**Runner:**
- Node built-in `node:test`.
- Config: package scripts in `package.json`; there is no separate Jest, Vitest, or Node test config file.
- Tests run through `tsx` for TypeScript execution and `scripts/run-node-with-tz.mjs` for the timezone contract.

**Assertion Library:**
- Node built-in `node:assert/strict`.
- Use `assert.equal`, `assert.deepEqual`, `assert.ok`, `assert.rejects`, `assert.match`, `assert.doesNotMatch`, and `assert.doesNotThrow` as shown in `tests/unit/food-logging.test.ts`, `tests/integration/meals-api.test.ts`, `tests/unit/chat-bubble-source-contract.test.ts`, and `tests/unit/sse-client.test.ts`.

**Run Commands:**
```bash
yarn test              # Run unit and integration tests
yarn test:unit         # Run tests/unit/*.test.ts
yarn test:integration  # Run tests/integration/*.test.ts
yarn verify:harness -- <scenario>  # Run one deterministic harness scenario
yarn tsc --noEmit      # TypeScript gate for any TypeScript edit
yarn release:check     # TypeScript, full tests, and frontend build release gate
```

## Test File Organization

**Location:**
- Unit tests live in `tests/unit/` and cover services, pure helpers, client contracts, source scans, and small UI logic.
- Integration tests live in `tests/integration/` and cover Fastify routes, SSE flows, app composition, real SQLite persistence, and server/client boundary behavior.
- Deterministic proof harness scenarios live in `tests/harness/scenarios/` and write redacted evidence to `tests/harness/artifacts/<scenario>/latest/`.
- Harness support code lives in `tests/harness/`: `tests/harness/app-fixture.ts`, `tests/harness/run.ts`, `tests/harness/artifacts.ts`, `tests/harness/sse.ts`, and `tests/harness/scenario-types.ts`.
- Shared unit/integration helper code lives under `tests/helpers/`: `tests/helpers/spy-hooks.ts`.

**Naming:**
- Use `<subject>.test.ts` for normal unit and integration tests: `tests/unit/meal-history.test.ts`, `tests/integration/assets-api.test.ts`.
- Use `<feature>.integration.test.ts` for larger integration regressions where the suffix adds clarity: `tests/integration/chat-goal-update.integration.test.ts`, `tests/integration/chat-meal-correction.integration.test.ts`.
- Use kebab-case scenario module names in `tests/harness/scenarios/`, matching the CLI name passed to `yarn verify:harness -- <scenario>`: `daily-rollover`, `boundary-contracts`, `meal-image-continuity`.
- Visual/browser harness scripts use `.mjs` in `tests/harness/scenarios/` and are not run through `yarn verify:harness`: `tests/harness/scenarios/42.5-ui-fidelity-visual.mjs`, `tests/harness/scenarios/43-sport-ui-built-smoke.mjs`.

**Structure:**
```text
tests/
├── unit/                 # Node test files for pure logic, service behavior, client shims, and source contracts
├── integration/          # Fastify app, route, SSE, DB, and cross-layer tests
├── helpers/              # Shared test helpers such as typed node:test spies
└── harness/
    ├── scenarios/        # Deterministic verification scenarios
    ├── artifacts/        # Generated/redacted scenario evidence
    ├── cases/            # Behavior matrix case definitions
    ├── fixtures/         # Locked JSON fixtures for harness/eval tests
    └── *.ts              # Harness runner, app fixture, assertions, artifact writer
```

## Test Structure

**Suite Organization:**
```typescript
process.env.TZ = "Asia/Taipei";

import { beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../../server/db/client.js";
import { createDeviceService } from "../../server/services/device.js";
import { createFoodLoggingService } from "../../server/services/food-logging.js";

describe("FoodLoggingService", () => {
  let db: ReturnType<typeof createDb>;
  let foodService: ReturnType<typeof createFoodLoggingService>;
  let deviceId: string;

  beforeEach(async () => {
    db = createDb(":memory:");
    const deviceService = createDeviceService(db);
    foodService = createFoodLoggingService(db);
    deviceId = (await deviceService.createDevice("fat_loss")).deviceId;
  });

  it("logs a compatibility meal entry while writing only canonical transaction rows", async () => {
    const meal = await foodService.logFood(deviceId, {
      foodName: "蘋果",
      calories: 95,
      protein: 0.5,
      carbs: 25,
      fat: 0.3,
    });

    assert.equal(meal.foodName, "蘋果");
  });
});
```

**Patterns:**
- Set `process.env.TZ = "Asia/Taipei"` at the top of tests that directly boot app or time-sensitive service code. Examples: `tests/unit/food-logging.test.ts`, `tests/integration/meals-api.test.ts`.
- Use `describe()` for domain/service/route groupings and `it()` or `test()` for cases. Both appear in the repo: `tests/unit/food-logging.test.ts` uses `it()`, while `tests/unit/insight-fixtures.test.ts` uses `test()`.
- Use `beforeEach()` to create fresh app, DB, mock provider, fake browser globals, and localStorage state. Examples: `tests/integration/meals-api.test.ts`, `tests/unit/api-client.test.ts`, `tests/unit/sse-client.test.ts`.
- Use `afterEach()` to close Fastify, restore globals, reset fake EventSource state, and remove temp dirs. Examples: `tests/integration/meals-api.test.ts`, `tests/unit/api-client.test.ts`.
- Keep helper functions inside the suite when they are specific to one file: `toCookieHeader()`, `postChatMessage()`, and `assertNoRawImageStorageFields()` in `tests/integration/meals-api.test.ts`.
- Prefer exact contract assertions over broad truthiness. Assert status codes, response fields, DB row counts, SSE event payloads, and absence of forbidden fields.

## Mocking

**Framework:** Node `node:test` `mock.fn` for spies, manual fakes for browser globals, and repo-specific deterministic LLM providers.

**Patterns:**
```typescript
import { mock } from "node:test";
import type { OrchestratorHooks } from "../../server/orchestrator/hooks.js";

export function createSpyHooks(): OrchestratorHooks & {
  onLLMStart: ReturnType<typeof mock.fn<NonNullable<OrchestratorHooks["onLLMStart"]>>>;
} {
  return {
    onLLMStart: mock.fn<NonNullable<OrchestratorHooks["onLLMStart"]>>(),
  };
}
```

```typescript
const mockLLM = new MockLLMProvider();
mockLLM.queueChatResponse({
  toolCalls: [{
    id: "call_1",
    type: "function",
    function: {
      name: "log_food",
      arguments: JSON.stringify({ food_name: "早餐", calories: 350 }),
    },
  }],
});
```

```typescript
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  public listeners = new Map<string, FakeEventHandler[]>();

  emit(type: string, data: string) {
    for (const handler of this.listeners.get(type) ?? []) {
      handler({ data } as MessageEvent<string>);
    }
  }
}

(globalThis as { EventSource?: unknown }).EventSource = FakeEventSource;
```

**What to Mock:**
- Mock LLM/provider behavior with `MockLLMProvider` from `server/llm/mock.ts` or deterministic harness providers from `tests/harness/streaming-llm.ts`.
- Mock browser-only globals in client unit tests: `localStorage`, `fetch`, `EventSource`, `location`, `document`, and `createImageBitmap` in files such as `tests/unit/api-client.test.ts` and `tests/unit/sse-client.test.ts`.
- Mock observer hooks with `node:test` spies created inside `beforeEach()` using `tests/helpers/spy-hooks.ts`.
- Mock network responses for client transport helpers by replacing `globalThis.fetch` and restoring it in `afterEach()` as in `tests/unit/api-client.test.ts`.

**What NOT to Mock:**
- Do not mock SQLite. Use real `better-sqlite3`/Drizzle through `createDb(":memory:")` or `buildApp({ dbPath: ":memory:" })`. Examples: `tests/unit/food-logging.test.ts`, `tests/integration/meals-api.test.ts`, `tests/harness/app-fixture.ts`.
- Do not stub Fastify route transport for integration coverage. Use `app.inject()` for route assertions or a real ephemeral `app.listen({ port: 0 })` when fetch/SSE behavior requires an address, as in `tests/integration/meals-api.test.ts`.
- Do not instantiate runtime OpenAI clients in tests. Use `MockLLMProvider` or harness providers through `buildApp()` dependency injection.

## Fixtures and Factories

**Test Data:**
```typescript
const deviceRes = await app.inject({
  method: "POST",
  url: "/api/device",
  payload: { goal: "fat_loss" },
});
const deviceCookieHeader = toCookieHeader(deviceRes.headers["set-cookie"]);
```

```typescript
const fixture = await createScenarioApp({});
try {
  const beforeMeal = await fixture.services.foodLoggingService.logFood(fixture.deviceId, {
    foodName: "TPE 23:59 meal",
    calories: 100,
    protein: 10,
    carbs: 12,
    fat: 3,
    loggedAt: "2026-03-25T15:59:00.000Z",
  });
} finally {
  await fixture.close();
}
```

**Location:**
- App fixture for harness scenarios: `tests/harness/app-fixture.ts`.
- Harness scenario contracts: `tests/harness/scenario-types.ts`.
- Harness behavior cases: `tests/harness/cases/*.ts`.
- Harness insight JSON fixtures: `tests/harness/fixtures/insights/*.json`.
- Test spies: `tests/helpers/spy-hooks.ts`.
- Temp filesystem roots are created per test using `mkdtemp(path.join(tmpdir(), "..."))` and removed with `rm(..., { recursive: true, force: true })` in `tests/integration/meals-api.test.ts`.

## Coverage

**Requirements:** No numeric coverage threshold is enforced in `package.json` or separate coverage config. Coverage expectations are behavior-driven by path and risk.

**View Coverage:**
```bash
Not configured
```

**Verification Matrix:**
- Any `*.ts` edit: run `yarn tsc --noEmit`.
- `tests/unit/*.test.ts`: run `yarn test:unit`.
- `server/routes/*.ts` or `server/services/*.ts`: run `yarn test:integration`.
- `tests/harness/scenarios/*.ts`: run `yarn verify:harness -- <scenario>` and inspect `tests/harness/artifacts/<scenario>/latest/`.
- `tests/harness/scenarios/*.mjs`: follow the matching artifact README or phase docs; these are direct browser/visual harness scripts, not `yarn verify:harness` scenarios.
- `tests/harness/checks/*.test.ts`: run `node scripts/run-node-with-tz.mjs --import tsx --test <file>`.
- Before promoting to `staging` or `main`: run `yarn release:check`.

## Test Types

**Unit Tests:**
- Scope: pure functions, services with in-memory SQLite, client transport helpers, Zustand store behavior, UI/source contracts, orchestrator helpers, matrix/document generation contracts.
- Files: `tests/unit/food-logging.test.ts`, `tests/unit/api-client.test.ts`, `tests/unit/sse-client.test.ts`, `tests/unit/source-text-guard.test.ts`, `tests/unit/chat-bubble-source-contract.test.ts`.
- Approach: instantiate the smallest dependency set, use real SQLite where persistence is involved, and assert exact DTOs/guards/source invariants.

**Integration Tests:**
- Scope: Fastify routes, app composition, SSE, cookie-backed guest sessions, file assets, history/search endpoints, orchestrator boundaries, and web app serving.
- Files: `tests/integration/meals-api.test.ts`, `tests/integration/chat-api.test.ts`, `tests/integration/sse.test.ts`, `tests/integration/assets-api.test.ts`, `tests/integration/web-app.test.ts`.
- Approach: build the real app with `buildApp({ dbPath: ":memory:", llmProvider: new MockLLMProvider(), ... })`, seed devices through `/api/device`, preserve cookie headers, use `app.inject()` or fetch against an ephemeral `app.listen({ port: 0 })`, and close the app in `afterEach()`.

**E2E Tests:**
- Full browser E2E framework is not detected.
- Deterministic product/boundary proof lives in `tests/harness/scenarios/*.ts` and runs with `yarn verify:harness -- <scenario>`.
- Visual/browser harness scripts live in `tests/harness/scenarios/*.mjs` with evidence under `tests/harness/artifacts/*`, for example `tests/harness/artifacts/49-history-dashboard-polish/latest/*.png`.

## Common Patterns

**Async Testing:**
```typescript
it("GET /api/meals returns today's meals in ascending timeline order", async () => {
  const res = await app.inject({
    method: "GET",
    url: "/api/meals",
    headers: { cookie: deviceCookieHeader },
  });

  assert.equal(res.statusCode, 200);
  const body = res.json();
  assert.deepEqual(body.meals.map((meal: { foodName: string }) => meal.foodName), ["早餐", "晚餐"]);
});
```

**Error Testing:**
```typescript
await assert.rejects(
  () => api.submitIntake(intake),
  (error: unknown) => {
    assert.ok(error instanceof api.IntakeValidationError);
    assert.equal(error.kind, "validation");
    assert.equal(error.step, 2);
    return true;
  },
);
```

**Source-Contract Testing:**
```typescript
const messageBubble = await readSource("../../client/src/components/MessageBubble.tsx");
assert.match(messageBubble, /PersistedAssetImage/);
assert.doesNotMatch(messageBubble, /dangerouslySetInnerHTML/);
```

**Harness Scenario Pattern:**
```typescript
const STEP_NAMES = ["bootstrap", "verify_artifacts"] as const;

const scenario: VerificationScenario = {
  name: "daily-rollover",
  async run(): Promise<ScenarioResult> {
    const fixture = await createScenarioApp({});
    try {
      const steps: ScenarioStepResult[] = [];
      const artifacts: Record<string, unknown> = {};
      steps.push({ name: "bootstrap", ok: true });
      return {
        ok: true,
        steps,
        artifacts,
        consoleSummary: `PASS daily-rollover 1/${STEP_NAMES.length}`,
      };
    } finally {
      await fixture.close();
    }
  },
};
```

**Artifact Handling:**
- Treat `tests/harness/artifacts/**` as generated verification evidence.
- Do not hand-edit generated JSON, screenshots, or manifests under `tests/harness/artifacts/**`.
- Regenerate artifacts with the matching harness command and inspect `latest/summary.json`, `latest/steps.json`, `latest/snapshots.json`, `latest/scenario-result.json`, and optional `latest/llm-trace.json`.

---

*Testing analysis: 2026-05-26*
