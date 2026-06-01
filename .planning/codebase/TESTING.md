---
last_mapped_commit: 782a04005f8f328f7f86ac589eb1253060471b5f
---

# Testing Patterns

**Analysis Date:** 2026-06-01

## Test Framework

**Runner:**
- Node built-in test runner via `node --test`, launched through `tsx` and the repo timezone wrapper in `package.json`.
- Config: no Jest, Vitest, or standalone test config file appears in the scoped paths. Test commands are defined directly in `package.json`.
- Timezone: `TZ=Asia/Taipei` is required by `.env.example` and enforced for Node test commands by `scripts/run-node-with-tz.mjs`.

**Assertion Library:**
- Use Node's built-in assertion library by project convention. The scoped test runner does not add Chai, Jest, Vitest, or Testing Library dependencies in `package.json`.

**Run Commands:**
```bash
yarn tsc --noEmit                    # TypeScript check
yarn test:unit                       # Node test runner over tests/unit/*.test.ts
yarn test:integration                # Node test runner over tests/integration/*.test.ts
yarn test                            # Unit and integration test suite
yarn verify:harness -- <scenario>    # Deterministic harness runner
yarn matrix:gen:check                # Capability matrix generated-doc check
yarn matrix:check                    # Capability matrix source scans plus generated-doc check
yarn behavior-matrix:gen:check       # Behavior matrix generated-doc check
yarn release:check                   # Release gate: timezone, TypeScript, tests, build
```

## Test File Organization

**Location:**
- Unit tests are targeted by `package.json` through `tests/unit/*.test.ts`.
- Integration tests are targeted by `package.json` through `tests/integration/*.test.ts`.
- Harness scenarios are executed through `yarn verify:harness`, which maps to `node scripts/run-node-with-tz.mjs --import tsx tests/harness/run.ts` in `package.json`.
- Generated-doc checks for capability and behavior matrices are driven by scripts under `scripts/` and compare source data to generated Markdown.
- Drizzle migrations live under `drizzle/` with generated snapshots in `drizzle/meta/`; migration behavior should be covered by tests that exercise the resulting SQLite schema.

**Naming:**
- Unit test glob: `tests/unit/*.test.ts` in `package.json`.
- Integration test glob: `tests/integration/*.test.ts` in `package.json`.
- Harness command shape: `yarn verify:harness -- <scenario>` from `package.json`.
- Matrix contract test names are explicit in `package.json`: `tests/unit/capability-matrix-contract.test.ts` and `tests/unit/capability-matrix-source-scan.test.ts`.
- Migration files use `drizzle/<sequence>_<tag>.sql` with matching `drizzle/meta/<sequence>_snapshot.json`; the current journal ends at `drizzle/0008_shiny_stellaris.sql`.

**Structure:**
```text
package.json                         # Test and verification command definitions
scripts/run-node-with-tz.mjs          # TZ wrapper for tests and harnesses
scripts/release-check.mjs             # Full release gate
scripts/generate-*-matrix-doc.mjs     # Generated-doc checks
drizzle/
├── 0000_*.sql                        # Ordered SQLite migrations
├── 0008_shiny_stellaris.sql
└── meta/                             # Generated Drizzle snapshots and _journal.json
```

## Test Structure

**Suite Organization:**
```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";

describe("scoped behavior", () => {
  it("preserves the contract", async () => {
    assert.equal(actual, expected);
  });
});
```

**Patterns:**
- Wrap Node-based tests and harnesses with `scripts/run-node-with-tz.mjs` so `TZ=Asia/Taipei` is always present.
- Prefer exact generated-output comparisons for documentation generators. `scripts/generate-capability-matrix-doc.mjs` and `scripts/generate-behavior-matrix-doc.mjs` render full Markdown and compare it to the current file in `--check` mode.
- Keep release verification deterministic. `scripts/release-check.mjs` always validates timezone, then runs `yarn tsc --noEmit`, `yarn test`, and `yarn build` unless `--dry-run` is passed.
- For schema changes under `drizzle/`, add or update tests that prove constraints, indexes, and backfilled rows behave through the application surfaces that depend on them.
- Preserve metadata-only verification evidence. `CHANGELOG.md` records that release proof should avoid raw prompts, user text, assistant final text, tool payloads, provider bodies, image data, session material, and database snapshots.

## Mocking

**Framework:** Node built-in test tooling by repo convention; scoped files do not introduce a separate mocking library.

**Patterns:**
```typescript
import { mock } from "node:test";

const onEvent = mock.fn();
```

**What to Mock:**
- Mock external model/provider boundaries in tests outside this scoped path set, using the repo's established deterministic providers.
- Mock callback hooks or spies only when call counts, payload shape, or ordering are the contract being tested.
- Generated-doc checks should not mock their source data; they should import the source matrices and compare rendered output.

**What NOT to Mock:**
- Do not mock SQLite for migration-backed behavior. Use a real SQLite database when validating schema created by `drizzle/*.sql`.
- Do not mock `scripts/run-node-with-tz.mjs` in command-level verification; its purpose is to prove process-level timezone propagation.
- Do not replace `scripts/release-check.mjs` with partial checks for promotion readiness; it is the scoped release gate.

## Fixtures and Factories

**Test Data:**
```typescript
const env = {
  ...process.env,
  TZ: "Asia/Taipei",
};
```

**Location:**
- Environment template values live in `.env.example`.
- Drizzle migration state lives in `drizzle/meta/_journal.json` and `drizzle/meta/*_snapshot.json`.
- Capability matrix generation reads `client/src/contracts/capability-matrix.ts` through `scripts/generate-capability-matrix-doc.mjs`.
- Behavior matrix generation reads `tests/harness/behavior-matrix.ts` through `scripts/generate-behavior-matrix-doc.mjs`.

## Coverage

**Requirements:** No numeric coverage threshold is documented in scoped files. Coverage is command- and contract-based through `yarn test`, harness scenarios, generated-doc checks, and `yarn release:check`.

**View Coverage:**
```bash
# No coverage report command is defined in package.json.
yarn test
yarn release:check
```

## Test Types

**Unit Tests:**
- Scope: files matching `tests/unit/*.test.ts` in `package.json`.
- Approach: run through `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/*.test.ts`.
- Matrix-specific unit coverage is encoded in `yarn matrix:check`, which runs `tests/unit/capability-matrix-contract.test.ts`, `tests/unit/capability-matrix-source-scan.test.ts`, and `yarn matrix:gen:check`.

**Integration Tests:**
- Scope: files matching `tests/integration/*.test.ts` in `package.json`.
- Approach: run through `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/*.test.ts`.
- Release coverage: `scripts/release-check.mjs` runs the full `yarn test` command, which includes unit and integration tests.

**E2E Tests:**
- Framework: deterministic harness command, not Playwright Test, in scoped `package.json`.
- Command: `yarn verify:harness -- <scenario>` maps to `tests/harness/run.ts` through `scripts/run-node-with-tz.mjs`.
- Additional browser/mobile evidence scripts may live under `scripts/`, such as `scripts/phase45-mobile-evidence.mjs`, and should be documented by the phase or artifact that invokes them.

## Common Patterns

**Async Testing:**
```typescript
await assert.rejects(async () => {
  await runInvalidOperation();
});
```

**Error Testing:**
```typescript
const result = spawnSync(process.execPath, process.argv.slice(2), {
  stdio: "inherit",
  env: {
    ...process.env,
    TZ: "Asia/Taipei",
  },
});

process.exit(result.status ?? 1);
```

**Generated Document Checks:**
```typescript
const nextContent = renderMarkdown();

if (process.argv.includes("--check")) {
  const currentContent = await readFile(OUTPUT_PATH, "utf8").catch(() => null);
  if (currentContent !== nextContent) {
    console.error(`${OUTPUT_PATH} is out of sync with ${SOURCE_PATH}`);
    process.exit(1);
  }
  process.exit(0);
}
```

**Release Gate Shape:**
```typescript
runStep("TypeScript gate", ["tsc", "--noEmit"]);
runStep("Full test suite", ["test"]);
runStep("Frontend build", ["build"]);
```

**Verification Matrix:**
- Any TypeScript edit included by `tsconfig.json`: run `yarn tsc --noEmit`.
- Unit test changes matching `tests/unit/*.test.ts`: run `yarn test:unit`.
- Integration test changes matching `tests/integration/*.test.ts`: run `yarn test:integration`.
- Harness scenario changes: run `yarn verify:harness -- <scenario>`.
- Capability matrix source or generated doc changes: run `yarn matrix:check`.
- Behavior matrix source or generated doc changes: run `yarn behavior-matrix:gen:check`.
- Migration changes under `drizzle/*.sql` or `drizzle/meta/*.json`: run affected schema tests plus `yarn db:migrate` against a disposable `DB_PATH`.
- Promotion or release readiness: run `yarn release:check`.

## Scoped Path Notes

- `scripts/run-node-with-tz.mjs` is the timezone-preserving wrapper for tests, harnesses, and release checks.
- `scripts/release-check.mjs` accepts `--dry-run` to validate release-check setup without running TypeScript, tests, or build.
- `package.json` uses `yarn` scripts only; do not add npm-oriented verification instructions.
- `tsconfig.json` includes `server/**/*.ts`, `tests/**/*.ts`, `client/src/**/*.ts`, `client/src/**/*.tsx`, and `client/vite.config.ts`; type checks cover all of those included paths.
- `.env.example` is the only env file in scope and contains placeholder values only.
- `CHANGELOG.md` records release verification in Traditional Chinese and should continue to summarize command/status evidence rather than raw sensitive data.

---

*Testing analysis: 2026-06-01*
