# Testing Patterns

**Analysis Date:** 2026-05-29

## Test Framework

**Runner:**
- Node built-in test runner via `node --test`, launched through `tsx` and `scripts/run-node-with-tz.mjs`.
- Config: no Jest, Vitest, or standalone test config file is present. Test commands are defined in `package.json`.
- Timezone wrapper: `scripts/run-node-with-tz.mjs` forces `TZ=Asia/Taipei` for `yarn test`, `yarn test:unit`, `yarn test:integration`, and `yarn verify:harness`.

**Assertion Library:**
- Use `node:assert/strict` everywhere: `tests/unit/device.test.ts`, `tests/integration/meals-api.test.ts`, `tests/integration/verification-image.test.ts`.
- Use `node:test` hooks and mocks: `describe`, `it`, `test`, `beforeEach`, `afterEach`, and `mock.fn` in `tests/helpers/spy-hooks.ts`.

**Run Commands:**
```bash
yarn test              # Run unit and integration tests through scripts/run-node-with-tz.mjs
yarn test:unit         # Run tests/unit/*.test.ts
yarn test:integration  # Run tests/integration/*.test.ts and *.integration.test.ts
yarn verify:harness -- boundary-contracts  # Run one deterministic harness scenario
yarn tsc --noEmit      # TypeScript gate for any TypeScript edit
yarn release:check     # TypeScript, full tests, and frontend build gate before promotion
```

## Test File Organization

**Location:**
- Unit tests live in `tests/unit/` and cover pure logic, client rendering contracts, services, matrix contracts, and provider wrappers.
- Integration tests live in `tests/integration/` and cover Fastify routes, SSE behavior, SQLite-backed service boundaries, orchestrator behavior, and harness replay assertions.
- Deterministic harness scenarios live in `tests/harness/scenarios/` with shared helpers in `tests/harness/`.
- Browser/visual harness scripts use `.mjs` under `tests/harness/scenarios/` and write artifacts outside the normal `node --test` suite.

**Naming:**
- Unit tests: `tests/unit/<subject>.test.ts`, such as `tests/unit/device.test.ts`, `tests/unit/openai-provider.test.ts`, and `tests/unit/assistant-markdown.test.ts`.
- Integration tests: `tests/integration/<surface>.test.ts` or `<surface>.integration.test.ts`, such as `tests/integration/chat-api.test.ts` and `tests/integration/chat-goal-update.integration.test.ts`.
- Harness scenarios: `tests/harness/scenarios/<scenario-name>.ts`, matching `yarn verify:harness -- <scenario-name>`.

**Structure:**
```text
tests/
├── unit/                 # node:test files for pure logic, services, UI contracts, provider wrappers
├── integration/          # Fastify app, route, SSE, SQLite, and orchestrator integration tests
├── helpers/              # Reusable test-only helpers such as typed node:test spies
└── harness/
    ├── scenarios/        # Deterministic scenario runners with artifact output
    ├── cases/            # AI behavior cases reused by harness flows
    ├── app-fixture.ts    # Full app fixture with :memory: SQLite and seeded guest session
    ├── run.ts            # Harness CLI and importable runScenarioByName()
    └── artifacts.ts      # Redacted artifact writer
```

## Test Structure

**Suite Organization:**
```typescript
// Pattern from tests/unit/device.test.ts
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../../server/db/client.js";
import { createDeviceService } from "../../server/services/device.js";

describe("DeviceService", () => {
  let service: ReturnType<typeof createDeviceService>;

  beforeEach(() => {
    const db = createDb(":memory:");
    service = createDeviceService(db);
  });

  it("rejects an invalid goal", async () => {
    await assert.rejects(() => service.createDevice("invalid_goal" as any), { message: /Invalid goal/ });
  });
});
```

**Patterns:**
- Set `process.env.TZ = "Asia/Taipei";` at the top of time-sensitive integration tests before imports that boot server time logic: `tests/integration/chat-api.test.ts`, `tests/integration/meals-api.test.ts`, `tests/integration/verification-image.test.ts`.
- Use `beforeEach` to create a fresh `:memory:` database or full app fixture: `tests/unit/device.test.ts`, `tests/integration/meals-api.test.ts`.
- Use `afterEach` to close Fastify and remove temporary directories: `tests/integration/meals-api.test.ts`, `tests/harness/app-fixture.ts`.
- Prefer exact assertions on DTO shape, status codes, redaction, SSE frames, and persisted rows over broad truthiness: `tests/integration/observability-api.test.ts`, `tests/integration/verification-image.test.ts`, `tests/integration/history-search-api.test.ts`.
- Keep reusable assertion helpers close to the suite unless used across files: `assertNoRawImageStorageFields()` in `tests/integration/meals-api.test.ts`; shared spies live in `tests/helpers/spy-hooks.ts`.

## Mocking

**Framework:** `node:test` `mock.fn` plus repo-specific deterministic providers.

**Patterns:**
```typescript
// Pattern from tests/helpers/spy-hooks.ts
import { mock } from "node:test";

export function createSpyHooks() {
  return {
    onLLMStart: mock.fn(),
    onLLMEnd: mock.fn(),
    onToolReceived: mock.fn(),
    onToolResult: mock.fn(),
    onLLMError: mock.fn(),
    onFallback: mock.fn(),
  };
}
```

```typescript
// Pattern from tests/integration/meals-api.test.ts
mockLLM = new MockLLMProvider();
app = await buildApp({
  dbPath: ":memory:",
  llmProvider: mockLLM,
  uploadsDir,
  assetsDir,
  onServicesReady: (readyServices) => {
    services = readyServices;
  },
});
```

**What to Mock:**
- Mock LLM/provider boundaries with `MockLLMProvider` in `server/llm/mock.ts` for integration tests and `StreamingLLMProvider` in `tests/harness/streaming-llm.ts` for deterministic streaming scenarios.
- Mock browser/network surfaces only in browser harness `.mjs` scripts when static visual proof is the goal: `tests/harness/scenarios/49-history-dashboard-polish-visual.mjs`.
- Use `mock.fn` for callback hooks and spies only when call counts or arguments are the contract: `tests/helpers/spy-hooks.ts`.

**What NOT to Mock:**
- Do not mock SQLite. Use real `better-sqlite3` via `createDb(":memory:")` or `buildApp({ dbPath: ":memory:" })`: `tests/unit/device.test.ts`, `tests/integration/meals-api.test.ts`, `tests/harness/app-fixture.ts`.
- Do not stub Fastify route transport when testing routes. Use `app.inject()` or real local `fetch()` against `app.listen({ port: 0 })`: `tests/integration/meals-api.test.ts`, `tests/harness/scenarios/boundary-contracts.ts`.
- Do not instantiate real OpenAI clients in route/service tests. Provider behavior is isolated in `tests/unit/openai-provider.test.ts`.

## Fixtures and Factories

**Test Data:**
```typescript
// Pattern from tests/harness/app-fixture.ts
export async function createScenarioApp(opts: ScenarioAppOptions): Promise<ScenarioAppContext> {
  process.env.TZ = "Asia/Taipei";
  const { buildApp } = await import("../../server/app.js");
  const app = await buildApp({ dbPath: ":memory:", llmProvider, onServicesReady });
  const deviceRes = await app.inject({
    method: "POST",
    url: "/api/device",
    payload: { goal: "fat_loss" },
  });
  const address = await app.listen({ port: 0, host: "127.0.0.1" });
  return { app, address, deviceId, cookieHeader, services, close };
}
```

**Location:**
- Full app fixture: `tests/harness/app-fixture.ts`.
- Deterministic streaming provider: `tests/harness/streaming-llm.ts`.
- Typed hook spies: `tests/helpers/spy-hooks.ts`.
- Insight and behavior fixture data: `tests/harness/fixtures/insights/*.json`, `tests/harness/insight-fixtures.ts`, `tests/harness/behavior-matrix.ts`.
- Scenario artifacts: `tests/harness/artifacts/**` are generated evidence and must be regenerated, not hand-edited.

## Coverage

**Requirements:** No numeric coverage threshold is enforced. Coverage is contract-based through focused unit tests, route integration tests, deterministic harness scenarios, matrix contract tests, and release gates.

**View Coverage:**
```bash
# No coverage script is defined in package.json.
yarn test
yarn verify:harness -- <scenario-name>
```

## Test Types

**Unit Tests:**
- Scope: pure logic, formatting/parsing helpers, client UI contracts through server rendering, source-contract scans, provider wrappers, and individual SQLite-backed services.
- Approach: use `node:test`, `node:assert/strict`, direct source imports, and real `:memory:` SQLite where persistence exists.
- Examples: `tests/unit/assistant-markdown.test.ts`, `tests/unit/device.test.ts`, `tests/unit/openai-provider.test.ts`, `tests/unit/release-check.test.ts`.

**Integration Tests:**
- Scope: Fastify routes, SSE streams, image upload/persistence, guest-session cookies, orchestrator boundaries, observability redaction, history queries, and route DTO shaping.
- Approach: boot `buildApp()` from `server/app.ts` with `dbPath: ":memory:"`, `MockLLMProvider`, temp upload/assets dirs, and `app.inject()` or local `fetch()`.
- Examples: `tests/integration/chat-api.test.ts`, `tests/integration/meals-api.test.ts`, `tests/integration/chat-streaming.test.ts`, `tests/integration/history-search-api.test.ts`.

**E2E Tests:**
- Framework: deterministic harness plus direct browser `.mjs` scripts, not Playwright Test.
- Scenario runner: `tests/harness/run.ts` imports `tests/harness/scenarios/<name>.js`, executes `VerificationScenario.run()`, writes redacted artifacts through `tests/harness/artifacts.ts`, and exits nonzero on failure.
- Browser/visual checks: `tests/harness/scenarios/43-sport-ui-built-smoke.mjs`, `tests/harness/scenarios/49-history-dashboard-polish-visual.mjs`, and `scripts/phase45-mobile-evidence.mjs`.
- Real deployed-domain smoke is documented in `docs/deploy/railway-beta.md` and invoked by workflow, not by `yarn test`.

## Common Patterns

**Async Testing:**
```typescript
// Pattern from tests/integration/meals-api.test.ts
beforeEach(async () => {
  tempRoot = await mkdtemp(path.join(tmpdir(), "nutrition-meals-api-"));
  app = await buildApp({ dbPath: ":memory:", llmProvider: mockLLM, uploadsDir, assetsDir });
  const deviceRes = await app.inject({ method: "POST", url: "/api/device", payload: { goal: "fat_loss" } });
  deviceCookieHeader = toCookieHeader(deviceRes.headers["set-cookie"]);
  address = await app.listen({ port: 0 });
});

afterEach(async () => {
  if (app.server.listening) await app.close();
  await rm(tempRoot, { recursive: true, force: true });
});
```

**Error Testing:**
```typescript
// Pattern from tests/unit/openai-provider.test.ts
async function captureProviderError(action: () => Promise<unknown>): Promise<LLMProviderError> {
  try {
    await action();
  } catch (error) {
    if (!isLLMProviderError(error)) {
      assert.fail("Expected LLMProviderError");
    }
    return error;
  }

  assert.fail("Expected LLMProviderError");
}
```

**SSE Testing:**
```typescript
// Pattern from tests/integration/chat-api.test.ts
function parseSSEEvents(raw: string) {
  return raw
    .split("\n\n")
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const lines = block.split("\n");
      return {
        event: lines.find((line) => line.startsWith("event: "))?.slice("event: ".length) ?? "",
        data: lines.find((line) => line.startsWith("data: "))?.slice("data: ".length) ?? "",
      };
    });
}
```

**Harness Scenario Shape:**
```typescript
// Pattern from tests/harness/scenarios/boundary-contracts.ts
const fixture = await createScenarioApp({ llmProvider: llm, uploadsDir: UPLOADS_DIR, assetsDir });
try {
  const chatRes = await fetch(`${fixture.address}/api/chat`, {
    method: "POST",
    headers: { cookie: fixture.cookieHeader, Accept: "text/event-stream" },
    body: form,
  });
  steps.push(pass("post_image_chat", { status: chatRes.status }));
} finally {
  await fixture.close();
}
```

**Verification Matrix:**
- Any `*.ts` edit: run `yarn tsc --noEmit`.
- `tests/unit/*.test.ts`: run `yarn test:unit`.
- `server/routes/*.ts` or `server/services/*.ts`: run `yarn test:integration`.
- `tests/harness/scenarios/*.ts`: run `yarn verify:harness -- <scenario-name>` and inspect `tests/harness/artifacts/<scenario-name>/latest/`.
- `tests/harness/scenarios/*.mjs`: follow the matching artifact README or phase docs; these are not covered by `yarn verify:harness`.
- Promotion or release readiness: run `yarn release:check` from `package.json`.

---

*Testing analysis: 2026-05-29*
