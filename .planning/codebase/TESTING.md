---
last_mapped_commit: df5f989b593d494ac44ce3b004307c1c6ada7bec
---

# Testing Patterns

**Analysis Date:** 2026-06-01

## Test Framework

**Runner:**
- Node built-in test runner via `node --test`, launched through `tsx` and the repo timezone wrapper by established project convention.
- Config: no Jest, Vitest, or standalone test config file appears in the scoped paths. Test commands are documented in `README.md`, `README-en.md`, and AGENTS guidance.
- Timezone: `TZ=Asia/Taipei` is a required core environment variable in `README.md` and `README-en.md`; tests and daily-boundary checks must preserve it.

**Assertion Library:**
- Use `node:assert/strict` for TypeScript tests by established repo convention.
- Use `node:test` hooks and `mock.fn` for suites, setup, teardown, and spies by established repo convention.

**Run Commands:**
```bash
yarn tsc --noEmit      # TypeScript check
yarn test:unit         # Unit tests
yarn test:integration  # Integration tests
yarn test              # Full test suite
yarn verify:harness -- behavior-matrix  # Deterministic harness example from README
yarn verify:harness -- guest-session-hardening  # Deterministic harness example from README
yarn verify:harness -- provider-auth-failure-localization  # Deterministic harness example from README
yarn release:check     # Release gate before promotion
```

## Test File Organization

**Location:**
- Unit tests live in `tests/unit/`, as documented in `README.md` and `README-en.md`.
- Integration tests live in `tests/integration/`, as documented in `README.md` and `README-en.md`.
- Deterministic scenario verification and redacted artifacts live under `tests/harness/`, as documented in `README.md`, `README-en.md`, and `CHANGELOG.md`.
- Drizzle migrations live under `drizzle/` with generated snapshots in `drizzle/meta/`; migration behavior should be covered by service, route, integration, or harness tests that exercise the resulting schema.

**Naming:**
- Unit tests use `tests/unit/<subject>.test.ts`.
- Integration tests use `tests/integration/<surface>.test.ts` or `<surface>.integration.test.ts`.
- Harness scenarios use `tests/harness/scenarios/<scenario-name>.ts` and map to `yarn verify:harness -- <scenario-name>`.
- Migration files use `drizzle/<sequence>_<tag>.sql` and matching `drizzle/meta/<sequence>_snapshot.json`; the current journal ends at `drizzle/0008_shiny_stellaris.sql`.

**Structure:**
```text
tests/
├── unit/                 # Pure logic and contract tests
├── integration/          # Routes, services, SSE, and orchestrator boundaries
└── harness/              # Deterministic scenario verification and redacted artifacts

drizzle/
├── 0000_*.sql            # Ordered SQLite migrations
├── 0008_shiny_stellaris.sql
└── meta/                 # Generated Drizzle snapshots and _journal.json
```

## Test Structure

**Suite Organization:**
```typescript
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../../server/db/client.js";
import { createDeviceService } from "../../server/services/device.js";

describe("DeviceService", () => {
  beforeEach(() => {
    const db = createDb(":memory:");
    // create service under test here
  });

  it("rejects invalid input", async () => {
    await assert.rejects(async () => {
      // exercise the failing path
    });
  });
});
```

**Patterns:**
- Prefer exact assertions on DTO shape, status codes, redaction, SSE frames, persisted rows, and migration-visible schema behavior.
- Use fresh `:memory:` SQLite databases for persistence tests; do not mock database behavior.
- Keep route tests on real Fastify boundaries with `app.inject()` or a local ephemeral server.
- For schema changes under `drizzle/`, add or update tests that prove both new rows and migrated/backfilled rows behave correctly.
- Test metadata-only failure localization without asserting raw prompt, provider body, image bytes, session material, or database snapshots. This release invariant is documented in `CHANGELOG.md`.

## Mocking

**Framework:** `node:test` `mock.fn` plus repo-specific deterministic providers.

**Patterns:**
```typescript
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

**What to Mock:**
- Mock LLM/provider boundaries with `MockLLMProvider` or deterministic harness providers. `README.md` and `README-en.md` state local development calls OpenAI, while tests and some harness flows use mock providers.
- Mock callback hooks and spies only when call counts or arguments are part of the contract.
- Browser/visual harness scripts may mock browser/network surfaces when static visual proof is the goal.

**What NOT to Mock:**
- Do not mock SQLite. Use real SQLite, usually `:memory:`, for unit, integration, and harness tests that touch persistence.
- Do not stub Fastify transport for route coverage. Exercise `server/routes/*` through the app boundary.
- Do not instantiate real OpenAI clients in route or service tests; isolate provider behavior separately.

## Fixtures and Factories

**Test Data:**
```typescript
const app = await buildApp({
  dbPath: ":memory:",
  llmProvider: mockLLM,
  uploadsDir,
  assetsDir,
});

const deviceRes = await app.inject({
  method: "POST",
  url: "/api/device",
  payload: { goal: "fat_loss" },
});
```

**Location:**
- Full app fixture: `tests/harness/app-fixture.ts` by established repo convention.
- Deterministic harness scenarios: `tests/harness/scenarios/`.
- Redacted generated evidence: `tests/harness/artifacts/**`; ignored by `.gitignore` and excluded from Docker by `.dockerignore`.
- Temporary harness files: `tests/harness/tmp/`; ignored by `.gitignore`.
- Migration state: `drizzle/meta/_journal.json` and `drizzle/meta/*_snapshot.json`.

## Coverage

**Requirements:** No numeric coverage threshold is documented in scoped files. Coverage is contract-based through unit tests, route integration tests, deterministic harnesses, release proof, and changelog-recorded verification.

**View Coverage:**
```bash
# No coverage command is documented in scoped files.
yarn test
yarn verify:harness -- <scenario-name>
```

## Test Types

**Unit Tests:**
- Scope: pure logic, formatting/parsing helpers, source-contract scans, provider wrappers, and isolated service behavior.
- Approach: use `node:test`, `node:assert/strict`, direct imports, and real `:memory:` SQLite where persistence exists.
- Add unit coverage when changing code referenced by README reuse points, such as `server/orchestrator/tool-contract.ts`, `server/llm/errors.ts`, or `server/observability/events.ts`.

**Integration Tests:**
- Scope: Fastify routes, SSE streams, image upload/persistence, guest-session cookies, orchestrator boundaries, Drizzle/SQLite schema behavior, and route DTO shaping.
- Approach: boot `server/app.ts` with `dbPath: ":memory:"`, a mock LLM provider, temp upload/assets directories, and real route calls.
- Add integration coverage for migration-backed behavior introduced in `drizzle/`, including constraints, indexes that affect query paths, and backfilled ownership rows.

**E2E Tests:**
- Framework: deterministic harness plus direct browser `.mjs` scripts by established repo convention, not Playwright Test.
- Harness examples documented in `README.md` and `README-en.md`: `behavior-matrix`, `guest-session-hardening`, and `provider-auth-failure-localization`.
- Real deployed-domain smoke remains separate from local `yarn test`; deployment proof is recorded in release/changelog materials such as `CHANGELOG.md`.

## Common Patterns

**Async Testing:**
```typescript
beforeEach(async () => {
  process.env.TZ = "Asia/Taipei";
  app = await buildApp({ dbPath: ":memory:", llmProvider: mockLLM });
});

afterEach(async () => {
  if (app.server.listening) {
    await app.close();
  }
});
```

**Error Testing:**
```typescript
await assert.rejects(
  async () => {
    await service.doWork(invalidInput);
  },
  /Invalid/,
);
```

**SSE Testing:**
```typescript
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
const result = await runScenarioByName("provider-auth-failure-localization");
assert.equal(result.status, "passed");
```

**Verification Matrix:**
- Any `*.ts` edit: run `yarn tsc --noEmit`.
- `tests/unit/*.test.ts`: run `yarn test:unit`.
- `tests/integration/*.test.ts` or route/service changes: run `yarn test:integration`.
- `tests/harness/scenarios/*.ts`: run `yarn verify:harness -- <scenario-name>` and inspect `tests/harness/artifacts/<scenario-name>/latest/`.
- `tests/harness/scenarios/*.mjs`: follow the matching artifact README or phase docs; these are not covered by `yarn verify:harness`.
- `drizzle/*.sql` or `drizzle/meta/*.json`: run the tests covering affected services/routes plus `yarn db:migrate` against a disposable database when validating migration application.
- Promotion or release readiness: run `yarn release:check`.

## Scoped Path Notes

- `.gitignore` keeps `.planning/`, `tests/harness/artifacts/`, `tests/harness/tmp/`, local DBs, runtime data, secrets, and build output out of git.
- `.dockerignore` excludes `tests`, `docs`, `.planning`, local agent state, logs, databases, and caches from production images.
- `Dockerfile` does not run tests during image build; it installs with `yarn install --frozen-lockfile`, builds with `yarn build`, and starts with `yarn db:migrate && yarn start`.
- `CHANGELOG.md` records v2.4 release proof with `yarn tsc --noEmit`, `yarn release:check`, 1,245 passing tests, and frontend build completion.

---

*Testing analysis: 2026-06-01*
