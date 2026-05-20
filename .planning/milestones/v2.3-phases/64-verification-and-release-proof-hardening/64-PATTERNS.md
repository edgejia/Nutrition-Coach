# Phase 64: Verification and Release-Proof Hardening - Pattern Map

**Mapped:** 2026-05-19
**Files analyzed:** 11 likely new/modified targets
**Analogs found:** 11 / 11

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `.planning/phases/64-verification-and-release-proof-hardening/64-VERIFICATION.md` | documentation / proof report | batch verification evidence | `.planning/phases/63-sse-meal-row-freshness-and-affected-date-invalidation/63-VERIFICATION.md` | exact |
| `.planning/phases/64-verification-and-release-proof-hardening/64-deferred-items.md` | documentation / deferral log | event-driven triage | `.planning/phases/63-sse-meal-row-freshness-and-affected-date-invalidation/deferred-items.md` | role-match |
| `tests/unit/verification-artifacts.test.ts` | test | file-I/O, transform | `tests/unit/verification-artifacts.test.ts` | exact |
| `tests/unit/llm-chat-trace.test.ts` | test | event-driven, transform | `tests/unit/llm-chat-trace.test.ts` | exact |
| `tests/integration/chat-goal-update.integration.test.ts` | test | request-response, CRUD side effects | `tests/integration/chat-goal-update.integration.test.ts` | exact |
| `tests/integration/meals-api.test.ts` | test | request-response, CRUD side effects | `tests/integration/meals-api.test.ts` | exact |
| `tests/unit/sse-summary-coordinator.test.ts` | test | event-driven, async ordering | `tests/unit/sse-summary-coordinator.test.ts` | exact |
| `tests/integration/sse.test.ts` | test | streaming, request-response | `tests/integration/sse.test.ts` | role-match |
| `scripts/phase64-metadata-sweep.mjs` (optional if a script is needed) | script / utility | batch file-I/O | `scripts/release-check.mjs` | role-match |
| `tests/harness/scenarios/<focused-proof>.ts` (conditional only) | harness scenario | streaming, event-driven, file-I/O | `tests/harness/scenarios/text-log.ts` | role-match |
| `tests/harness/artifacts.ts` (modify only if producer leak is found) | harness utility | file-I/O, transform | `tests/harness/artifacts.ts` | exact |

## Pattern Assignments

### `.planning/phases/64-verification-and-release-proof-hardening/64-VERIFICATION.md` (documentation / proof report, batch verification evidence)

**Analog:** `.planning/phases/63-sse-meal-row-freshness-and-affected-date-invalidation/63-VERIFICATION.md`

**Frontmatter pattern** (lines 1-11):
```markdown
---
phase: 63-sse-meal-row-freshness-and-affected-date-invalidation
verified: 2026-05-18T08:40:59Z
status: passed
score: 4/4 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Live same-day SSE freshness flow"
    expected: "When a meal mutation updates today's summary through SSE, visible Home/Summary meal rows refresh before or with the updated totals; users do not see newer totals beside stale rows."
    why_human: "The deterministic tests verify the event and state contracts, but the end-to-end realtime browser experience still benefits from human observation."
---
```

**Observable truth table pattern** (lines 20-31):
```markdown
## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | Same-day `daily_summary` SSE events include enough freshness metadata for the client to refresh or invalidate affected meal rows. | VERIFIED | Server initial frames emit `{ summary, affectedDate: summary.date, source: "initial" }` in `server/routes/sse.ts`; mutation routes publish `{ summary, affectedDate, source: "meal_mutation" }`; client parser accepts only strict envelopes and passes `affectedDate` downstream. |

**Score:** 4/4 roadmap truths verified.
```

**Required artifacts pattern** (lines 33-45):
```markdown
### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `server/realtime/publisher.ts` | Strict `DailySummarySSEPayload`; fan-out only | VERIFIED | Exports `DailySummarySSESource`/`DailySummarySSEPayload`; `publishDailySummary` accepts only the envelope and delegates to private `publish`; no DB or summary-service reads. |
| Tests and harness consumers | Contract and behavior proof | VERIFIED | Unit/source-contract, SSE integration, meal-delete/text-log integrations, full integration, and daily-rollover harness all pass. Harness consumers now unwrap strict envelopes; the old `deferred-items.md` note is stale, not an active code gap. |
```

**Command result pattern** (lines 71-80):
```markdown
### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| Initial and mutation SSE envelope behavior | `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/sse.test.ts` | 8/8 pass | PASS |
| TypeScript gate | `yarn tsc --noEmit` | pass | PASS |
| Full integration suite | `yarn test:integration` | 304/304 pass | PASS |
```

**Requirements coverage pattern** (lines 88-96):
```markdown
### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| REAL-01 | 63-01, 63-02, 63-03 | Same-day `daily_summary` SSE events include enough freshness metadata for clients to refresh or invalidate meal rows. | SATISFIED | Server initial/mutation envelopes include `summary`, `affectedDate`, and `source`; client strict parser exposes envelope to coordinator. |

No orphaned Phase 63 requirement IDs found in `.planning/REQUIREMENTS.md`; REAL-01, REAL-02, and REAL-03 are all claimed by phase plans and mapped to implementation evidence.
```

**Phase 64 application:** Add dedicated sections for baseline `yarn release:check`, PROOF-01 coverage, `PROOF-02 Metadata-Only Sweep`, closure `yarn tsc --noEmit`, closure `yarn release:check`, and any escalations. Tables must store metadata only: surface/path, command, count, status, and facts proven. Do not store raw matches, raw payloads, prompt text, user text, provider bodies, tool payloads, DB snapshots, or raw screenshots.

---

### `.planning/phases/64-verification-and-release-proof-hardening/64-deferred-items.md` (documentation / deferral log, event-driven triage)

**Analog:** `.planning/phases/63-sse-meal-row-freshness-and-affected-date-invalidation/deferred-items.md`

**Deferral table pattern** (lines 1-5):
```markdown
# Phase 63 Deferred Items

| Category | Item | Status | Deferred At |
| --- | --- | --- | --- |
| harness_consumer_migration | `meal-delete-consistency`, `text-log`, and `daily-rollover` harness consumers needed to unwrap Phase 63 `daily_summary` SSE envelopes before asserting summary fields. | resolved in `fix(63): unwrap SSE summary envelopes in harness`; `yarn test:integration` passes 304/304 | 63-02 |
```

**Phase 64 application:** Use this only for routine Bucket C items. Add columns for `Command`, `Failure`, `Bucket C Rationale`, `Suspected Owner`, `Relevant Passing Checks`, and `Follow-up Context`. Cross-link the row from `64-VERIFICATION.md`. If classification is uncertain or broad-impact, escalate before deferring.

---

### `tests/unit/verification-artifacts.test.ts` (test, file-I/O and transform)

**Analog:** `tests/unit/verification-artifacts.test.ts`

**Imports and helper pattern** (lines 8-15, 68-74):
```typescript
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { writeScenarioArtifacts } from "../harness/artifacts.js";
import type { ScenarioResult } from "../harness/scenario-types.js";

function artifactFileNames(tmpDir: string, scenarioName: string): string[] {
  return fs.readdirSync(path.join(tmpDir, scenarioName, "latest")).sort();
}

function readArtifact(tmpDir: string, scenarioName: string, fileName: string): string {
  return fs.readFileSync(path.join(tmpDir, scenarioName, "latest", fileName), "utf-8");
}
```

**Temp artifact isolation pattern** (lines 78-95):
```typescript
describe("verification-artifacts", () => {
  let tmpDir: string;
  const originalEnv = process.env.HARNESS_ARTIFACTS_DIR;

  before(() => {
    tmpDir = makeTmpDir();
    process.env.HARNESS_ARTIFACTS_DIR = tmpDir;
  });

  after(() => {
    if (originalEnv === undefined) {
      delete process.env.HARNESS_ARTIFACTS_DIR;
    } else {
      process.env.HARNESS_ARTIFACTS_DIR = originalEnv;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
```

**Artifact file shape assertion pattern** (lines 97-139):
```typescript
test("writeScenarioArtifacts creates summary.json, steps.json, snapshots.json, and scenario-result.json for a passing run", async () => {
  const result = makePassResult("text-log");
  await writeScenarioArtifacts("text-log", result);

  const latestDir = path.join(tmpDir, "text-log", "latest");
  assert.ok(fs.existsSync(latestDir), `expected directory: ${latestDir}`);
  assert.ok(fs.existsSync(path.join(latestDir, "summary.json")), "summary.json missing");
  assert.ok(fs.existsSync(path.join(latestDir, "steps.json")), "steps.json missing");
  assert.ok(fs.existsSync(path.join(latestDir, "snapshots.json")), "snapshots.json missing");
  assert.ok(fs.existsSync(path.join(latestDir, "scenario-result.json")), "scenario-result.json missing");
});
```

**Denylist assertion pattern** (lines 387-440):
```typescript
test("persisted llm-trace.json removes forbidden raw payload keys but preserves allowed trace metadata", async () => {
  const result = makePassResult("trace-redaction-forbidden-keys") as ScenarioResult & {
    llmTrace?: Record<string, unknown>;
  };

  await writeScenarioArtifacts("trace-redaction-forbidden-keys", result);

  const raw = readArtifact(tmpDir, "trace-redaction-forbidden-keys", "llm-trace.json");
  const trace = JSON.parse(raw) as {
    summary: {
      prompt: { version: string; sectionIds: string[] };
      finalReply: { source: string; shape: string };
    };
    timeline: Array<{ tool: string; success: boolean; executed: boolean; source: string; shape: string }>;
  };

  assert.equal(trace.summary.prompt.version, "system-prompt.test");
  assert.deepEqual(trace.summary.prompt.sectionIds, ["role", "daily-targets"]);
  assert.deepEqual(trace.timeline[0], {
    tool: "log_food",
    success: true,
    executed: true,
    source: "orchestrator",
    shape: "tool_result",
  });
  assert.doesNotMatch(
    raw,
    /apiKey|api_key|OPENAI_API_KEY|cookie|set-cookie|guestSession|sessionToken|bearer|messages|rawMessages|rawPrompt|promptText|providerPayload|rawProviderPayload|arguments|rawArguments|toolArguments|toolResult|rawToolResult|finalAnswer|assistantContent|finalAssistantContent/,
  );
});
```

**Phase 64 application:** Extend this file only if the PROOF-02 sweep finds a false-pass gap in persisted artifact redaction. For a broad artifact enumeration sweep, prefer a new focused unit test or small script that reuses the same `fs`, `path`, `readArtifact`, and `assert.doesNotMatch` style.

---

### `tests/unit/llm-chat-trace.test.ts` (test, event-driven transform)

**Analog:** `tests/unit/llm-chat-trace.test.ts`

**Imports and allowlisted provider metadata pattern** (lines 1-13, 15-37):
```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createLlmTraceRecorder,
  type LlmTraceFinalReplyShape,
  type LlmTraceFinalReplySource,
} from "../../server/orchestrator/llm-trace.js";
import { createStructuredHooks } from "../../server/orchestrator/hooks.js";
import type { ProviderErrorMetadata } from "../../server/llm/types.js";

const providerMetadataKeys = [
  "provider",
  "operation",
  "model",
  "aborted",
  "status",
  "providerRequestId",
  "errorName",
  "errorType",
  "errorCode",
];
```

**Metadata-only trace shape pattern** (lines 75-104):
```typescript
it("builds a timeline-plus-summary artifact without grouped primary schema", () => {
  const recorder = createLlmTraceRecorder();
  const hooks = recorder.asOrchestratorHooks();

  hooks.onLLMStart?.(1);
  hooks.onToolReceived?.("get_daily_summary", "{}");
  hooks.onToolResult?.({ tool: "get_daily_summary", success: true, executed: true });
  hooks.onLLMEnd?.(1, true);
  recorder.recordFinalReply({ source: "model", shape: "plain_text" });
  recorder.recordMetrics({ latencyMs: 42 });

  const trace = recorder.build({ scenario: "unit-trace", status: "pass" });

  assert.deepEqual(Object.keys(trace), ["schemaVersion", "scenario", "status", "summary", "timeline"]);
  assert.equal(trace.schemaVersion, "llm-trace.v2");
  assert.equal(trace.summary.roundCount, 1);
  assert.equal("rounds" in trace, false);
  assert.equal("tools" in trace, false);
  assert.equal("fallbacks" in trace, false);
});
```

**Forbidden value exclusion pattern** (lines 201-237):
```typescript
const traceJson = JSON.stringify(recorder.build({ scenario: "unit-trace", status: "pass" }));
const forbiddenValues = [
  "data:image/png;base64,SECRETIMAGE",
  "guest_session=secret",
  "Bearer secret-token",
  "raw prompt text",
  "raw tool arguments",
  "raw tool results",
  "final assistant text",
];

for (const value of forbiddenValues) {
  assert.equal(traceJson.includes(value), false, `trace should exclude ${value}`);
}

for (const key of [
  "tool",
  "success",
  "executed",
  "failureReason",
  "roundCount",
  "toolCount",
  "fallbackCount",
  "latencyMs",
  "finalReply",
  "source",
  "shape",
]) {
  assert.equal(traceJson.includes(key), true, `trace should include ${key}`);
}
```

**Structured log capture pattern** (lines 461-519):
```typescript
it("structured hooks log exact metadata-only LLM error and fallback payloads", () => {
  const captured: Array<Record<string, unknown>> = [];
  const log = {
    info(payload: Record<string, unknown>) {
      captured.push(payload);
    },
    warn(payload: Record<string, unknown>) {
      captured.push(payload);
    },
  };
  const hooks = createStructuredHooks(log as never);

  hooks.onLLMError?.({ round: 3, lastTool: "get_daily_summary", providerMetadata });
  hooks.onFallback?.({
    reason: "llm_error",
    round: 3,
    lastTool: "get_daily_summary",
    providerMetadata,
  });

  assert.deepEqual(Object.keys(captured[0]), ["event", "round", "lastTool", "providerMetadata"]);
  assert.deepEqual(Object.keys(captured[1]), ["event", "reason", "round", "lastTool", "providerMetadata"]);
});
```

**Phase 64 application:** Copy this pattern for structured logs, route/orchestrator trace facts, and gray-zone emission paths. Assert allowlisted keys and absence of raw payload material; do not persist raw captured log lines in `64-VERIFICATION.md`.

---

### `tests/integration/chat-goal-update.integration.test.ts` (test, request-response and CRUD side effects)

**Analog:** `tests/integration/chat-goal-update.integration.test.ts`

**Integration fixture pattern** (lines 1-14, 82-111):
```typescript
process.env.TZ = "Asia/Taipei";

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { buildApp, type AppServices } from "../../server/app.js";
import { MockLLMProvider } from "../../server/llm/mock.js";
import { createLlmTraceRecorder } from "../../server/orchestrator/llm-trace.js";
import type { FastifyInstance } from "fastify";

beforeEach(async () => {
  mockLLM = new MockLLMProvider();
  publishCalls = [];
  traceRecorders = [];
  app = await buildApp({
    dbPath: ":memory:",
    llmProvider: mockLLM,
    llmTraceRecorderFactory() {
      const recorder = createLlmTraceRecorder();
      traceRecorders.push(recorder);
      return recorder;
    },
    onServicesReady(services: AppServices) {
      const originalPublishGoalsUpdate = services.publisher.publishGoalsUpdate.bind(services.publisher);
      services.publisher.publishGoalsUpdate = (deviceId, targets) => {
        publishCalls.push({ event: "goals_update" });
        return originalPublishGoalsUpdate(deviceId, targets);
      };
    },
  });
});

afterEach(async () => {
  if (app.server.listening) {
    await app.close();
  }
});
```

**Backend authority behavior pattern** (lines 165-187, 244-266):
```typescript
it("creates a backend proposal for vague intent without mutating targets or publishing", async () => {
  mockLLM.queueChatResponse({
    toolCalls: [{
      id: "goal_proposal",
      type: "function",
      function: {
        name: "propose_goals",
        arguments: JSON.stringify(PROPOSAL_TARGETS),
      },
    }],
  });

  const { status, body } = await postChat("我想少吃一點，幫我建議一組目標");

  assert.equal(status, 200);
  assert.equal(body.didMutateMeal, false);
  assert.equal(body.reply, renderGoalProposalCopy(PROPOSAL_TARGETS));
  assert.equal(body.dailyTargets, undefined);
  assert.deepEqual(await readTargets(), DEFAULT_TARGETS);
  assert.deepEqual(publishCalls, []);
});

it("fails closed for missing proposal confirmation without publishing or success prose", async () => {
  const { status, body } = await postChat("好");

  assert.equal(status, 200);
  assert.equal(body.reply, renderGoalAuthorityFailureCopy());
  assert.equal(body.dailyTargets, undefined);
  assert.doesNotMatch(body.reply, SUCCESS_STYLE_COPY);
  assert.deepEqual(await readTargets(), DEFAULT_TARGETS);
  assert.deepEqual(publishCalls, []);
});
```

**Metadata-only trace proof pattern** (lines 268-316):
```typescript
it("records rejected goal final reply metadata as renderer-owned without raw text evidence", async () => {
  const { status, body } = await postChat("好");

  assert.equal(status, 200);
  assert.equal(body.reply, renderGoalAuthorityFailureCopy());
  const trace = traceRecorders.at(-1)?.build({ scenario: "goal-missing-proposal", status: "pass" });
  assert.ok(trace);
  assert.deepEqual(trace.summary.finalReply, {
    source: "renderer",
    shape: "plain_text",
  });
  const toolResult = trace.timeline.find((event) => event.type === "tool_result");
  assert.deepEqual(toolResult, {
    type: "tool_result",
    round: 1,
    tool: "update_goals",
    success: false,
    executed: false,
    failureReason: "guard",
    updatedFields: [],
  });

  const traceJson = JSON.stringify(trace);
  for (const forbidden of [
    "guest_session",
    "data:image",
    "provider body",
    "database",
  ]) {
    assert.equal(traceJson.includes(forbidden), false, `trace should exclude ${forbidden}`);
  }
});
```

**Phase 64 application:** Cite this file in the PROOF-01 coverage table for goal proposal authority and deterministic failed-goal copy. Add tests here only if the baseline or PROOF-02 sweep reveals a concrete false-pass risk in goal proof.

---

### `tests/integration/meals-api.test.ts` (test, request-response and CRUD side effects)

**Analog:** `tests/integration/meals-api.test.ts`

**Imports and app fixture pattern** (lines 1-14, 33-62):
```typescript
process.env.TZ = "Asia/Taipei";

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { buildApp } from "../../server/app.js";
import type { AppServices } from "../../server/app.js";
import { formatLocalDate } from "../../server/lib/time.js";
import { MockLLMProvider } from "../../server/llm/mock.js";

beforeEach(async () => {
  mockLLM = new MockLLMProvider();
  tempRoot = await mkdtemp(path.join(tmpdir(), "nutrition-meals-api-"));
  uploadsDir = path.join(tempRoot, "uploads");
  assetsDir = path.join(tempRoot, "assets");
  app = await buildApp({
    dbPath: ":memory:",
    llmProvider: mockLLM,
    uploadsDir,
    assetsDir,
    onServicesReady: (readyServices) => {
      services = readyServices;
    },
  });
});

afterEach(async () => {
  if (app.server.listening) {
    await app.close();
  }
  await rm(tempRoot, { recursive: true, force: true });
});
```

**Response and publish-envelope guard pattern** (lines 104-137):
```typescript
function assertNoPublishFailureFields(value: unknown) {
  const serialized = JSON.stringify(value);
  assert.ok(!serialized.includes("publish_failed"), "publish failure must not appear in meal route response bodies");
}

function assertNoSummaryFields(value: Record<string, unknown>) {
  assert.equal(Object.prototype.hasOwnProperty.call(value, "summaryOutcome"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(value, "dailySummary"), false);
}

function assertMealMutationSummaryEnvelope(payload: unknown, affectedDate: string) {
  assert.ok(payload && typeof payload === "object");
  const envelope = payload as {
    source?: unknown;
    affectedDate?: unknown;
    summary?: { date?: unknown };
    summaryOutcome?: unknown;
  };
  assert.equal(envelope.source, "meal_mutation");
  assert.equal(envelope.affectedDate, affectedDate);
  assert.ok(envelope.summary && typeof envelope.summary === "object");
  assert.equal(envelope.summary.date, affectedDate);
  assert.equal(Object.prototype.hasOwnProperty.call(envelope, "summaryOutcome"), false);
}
```

**Stale write fail-closed pattern** (lines 390-437):
```typescript
it("PATCH and DELETE /api/meals/:id fail closed on missing or stale expected revisions", async () => {
  assert.ok(services, "expected onServicesReady to capture app services");

  const meal = await services.foodLoggingService.logFood(deviceId, {
    foodName: "雞胸肉沙拉",
    calories: 420,
    protein: 32,
    carbs: 14,
    fat: 22,
  });

  let summaryCalls = 0;
  let publishCalls = 0;
  const originalGetDailySummary = services.summaryService.getDailySummary.bind(services.summaryService);
  const originalPublishDailySummary = services.publisher.publishDailySummary.bind(services.publisher);
  services.summaryService.getDailySummary = async (...args) => {
    summaryCalls += 1;
    return originalGetDailySummary(...args);
  };
  services.publisher.publishDailySummary = (...args) => {
    publishCalls += 1;
    return originalPublishDailySummary(...args);
  };

  try {
    const missingPatch = await app.inject({
      method: "PATCH",
      url: `/api/meals/${meal.id}`,
      headers: { cookie: deviceCookieHeader },
      payload: {
        foodName: "雞胸肉沙拉半份",
        calories: 260,
        protein: 20,
        carbs: 8,
        fat: 12,
        imageAssetId: null,
      },
    });
    assert.equal(missingPatch.statusCode, 409);
    assert.deepEqual(missingPatch.json(), {
      error: "MEAL_REVISION_REQUIRED",
      mealId: meal.id,
      affectedDate: formatLocalDate(new Date(meal.loggedAt)),
      currentMealRevisionId: meal.mealRevisionId,
    });
    assertNoSummaryFields(missingPatch.json());
    assert.equal(summaryCalls, 0);
    assert.equal(publishCalls, 0);
```

**Phase 64 application:** Cite this file for stale receipt rejection and summary-failure committed outcome coverage. Add route tests here only for a concrete false-pass gap around direct PATCH/DELETE response shape, publish failure privacy, or stale-revision side effects.

---

### `tests/unit/sse-summary-coordinator.test.ts` (test, event-driven async ordering)

**Analog:** `tests/unit/sse-summary-coordinator.test.ts`

**Controlled async harness pattern** (lines 14-22, 60-79):
```typescript
function createControlledMeals(): ControlledMeals {
  let resolve!: (value: { meals: Meal[] }) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<{ meals: Meal[] }>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

function createHarness() {
  const getMealsCalls: Array<{ refreshReason?: "day_rollover" | "meal_mutation" }> = [];
  const pendingMeals: ControlledMeals[] = [];
  const commits: Array<{ type: "meals"; rows: Meal[] } | { type: "summary"; summary: DailySummary } | { type: "historical"; affectedDate: string }> = [];

  const coordinator = createSSESummaryCoordinator<Meal>({
    getMeals: (options) => {
      getMealsCalls.push(options ?? {});
      const controlled = createControlledMeals();
      pendingMeals.push(controlled);
      return controlled.promise;
    },
    setMeals: (rows) => commits.push({ type: "meals", rows }),
    setDailySummary: (summary) => commits.push({ type: "summary", summary }),
    recordMealMutation: (affectedDate) => commits.push({ type: "historical", affectedDate }),
    todayKey: () => "2026-05-18",
  });

  return { coordinator, getMealsCalls, pendingMeals, commits };
}
```

**Rows-before-summary proof pattern** (lines 82-99):
```typescript
it("refetches same-day mutation rows before committing rows then summary", async () => {
  const { coordinator, getMealsCalls, pendingMeals, commits } = createHarness();
  const payload = envelopeForDate("2026-05-18", 640, "meal_mutation");
  const rows = [meal("latest", 640)];

  const handling = coordinator.handleSummary(payload);

  assert.deepEqual(getMealsCalls, [{ refreshReason: "meal_mutation" }]);
  assert.deepEqual(commits, []);

  pendingMeals[0]?.resolve({ meals: rows });
  await handling;

  assert.deepEqual(commits, [
    { type: "meals", rows },
    { type: "summary", summary: payload.summary },
  ]);
});
```

**False-pass protection pattern** (lines 101-130):
```typescript
it("drops same-day mutation summary and rows when row refetch fails silently", async () => {
  const { coordinator, pendingMeals, commits } = createHarness();
  const handling = coordinator.handleSummary(envelopeForDate("2026-05-18", 700, "meal_mutation"));

  pendingMeals[0]?.reject(new Error("network unavailable"));
  await assert.doesNotReject(handling);

  assert.deepEqual(commits, []);
});

it("commits only the latest overlapping same-day mutation token", async () => {
  const { coordinator, pendingMeals, commits } = createHarness();
  const olderPayload = envelopeForDate("2026-05-18", 500, "meal_mutation");
  const newerPayload = envelopeForDate("2026-05-18", 900, "meal_mutation");

  const olderHandling = coordinator.handleSummary(olderPayload);
  const newerHandling = coordinator.handleSummary(newerPayload);

  pendingMeals[1]?.resolve({ meals: newerRows });
  await newerHandling;
  pendingMeals[0]?.resolve({ meals: olderRows });
  await olderHandling;

  assert.deepEqual(commits, [
    { type: "meals", rows: newerRows },
    { type: "summary", summary: newerPayload.summary },
  ]);
});
```

**Phase 64 application:** Cite this file for SSE meal-row freshness in PROOF-01. Add tests here only if a new false-pass risk appears around event ordering, failed row refresh, latest-wins suppression, historical invalidation, or future-date no-op.

---

### `scripts/phase64-metadata-sweep.mjs` (optional script / utility, batch file-I/O)

**Analog:** `scripts/release-check.mjs`

**Node ESM CLI imports and constants pattern** (lines 1-8):
```javascript
#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import process from "node:process";

const YARN_BIN = process.platform === "win32" ? "yarn.cmd" : "yarn";
const REQUIRED_TZ = "Asia/Taipei";
const DRY_RUN_FLAG = "--dry-run";
```

**Safe command execution pattern** (lines 83-100):
```javascript
function runStep(label, args) {
  console.log(`\n[release-check] ${label}`);
  const result = spawnSync(YARN_BIN, args, { stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function validateTimezoneContract() {
  const runtimeTz = process.env.TZ;
  if (runtimeTz !== REQUIRED_TZ) {
    const received = runtimeTz === undefined ? "<missing>" : runtimeTz;
    console.error(`[release-check] FAIL: TZ must be ${REQUIRED_TZ}; received ${received}`);
    process.exit(1);
  }

  console.log(`[release-check] Timezone contract: ${REQUIRED_TZ}`);
}
```

**Main flow pattern** (lines 102-140):
```javascript
const args = process.argv.slice(2);
const isDryRun = args.includes(DRY_RUN_FLAG);

console.log("[release-check] Starting release verification");
validateTimezoneContract();

if (isDryRun) {
  console.log("\n[release-check] Dry run complete");
  process.exit(0);
}

runStep("TypeScript gate", ["tsc", "--noEmit"]);
runStep("Full test suite", ["test"]);
runStep("Frontend build", ["build"]);

console.log("\n[release-check] PASS");
```

**Phase 64 application:** Prefer a unit test if assertions fit Node's test runner. Add a script only if the planner needs a reusable metadata-only sweep over arbitrary artifact paths. Any script must print counts, statuses, and paths only; it must not print raw matched text.

---

### `tests/harness/scenarios/<focused-proof>.ts` (conditional harness scenario, streaming/event-driven/file-I/O)

**Analog:** `tests/harness/scenarios/text-log.ts`

**Scenario imports and helpers pattern** (lines 17-20, 60-78, 94-103):
```typescript
import { StreamingLLMProvider } from "../streaming-llm.js";
import { parseSSEEvents, readStreamUntilEvent } from "../sse.js";
import { createLlmTraceRecorder } from "../../../server/orchestrator/llm-trace.js";
import type { VerificationScenario, ScenarioContext, ScenarioResult, ScenarioStepResult } from "../scenario-types.js";

function pass(name: string, actual?: unknown): ScenarioStepResult {
  return { name, ok: true, actual };
}

function fail(name: string, error: string, actual?: unknown): ScenarioStepResult {
  return { name, ok: false, error, actual };
}

function failResult(
  scenarioName: string,
  steps: ScenarioStepResult[],
  failedStepName: string,
  artifacts: Record<string, unknown>,
  llmTrace?: Record<string, unknown>,
): ScenarioResult {
  const result: ScenarioResult = {
    ok: false,
    failedStep: failedStepName,
    steps,
    artifacts,
    consoleSummary: `FAIL ${scenarioName} ${failedStepName}`,
  };
  if (llmTrace !== undefined) {
    result.llmTrace = llmTrace;
  }
  return result;
}

const STEP_NAMES = [
  "bootstrap",
  "subscribe_summary",
  "post_chat",
  "collect_stream",
  "verify_history",
  "verify_meals",
  "verify_summary",
  "verify_llm_trace",
] as const;
```

**Fixture and cleanup pattern** (lines 131-180, 819-832):
```typescript
const textLogScenario: VerificationScenario = {
  name: "text-log",

  async run(_ctx: ScenarioContext): Promise<ScenarioResult> {
    const scenarioName = "text-log";
    const steps: ScenarioStepResult[] = [];
    const artifacts: Record<string, unknown> = {};
    let llmTrace: Record<string, unknown> | undefined;

    const { createScenarioApp } = await import("../app-fixture.js");
    const provider = new StreamingLLMProvider();
    const recorder = createLlmTraceRecorder();
    const buildTrace = (status: "pass" | "fail"): Record<string, unknown> => {
      return recorder.build({ scenario: scenarioName, status }) as unknown as Record<string, unknown>;
    };

    const fixture = await createScenarioApp({
      llmProvider: provider,
      llmTraceRecorderFactory: () => recorder,
    });

    try {
      // scenario steps
      const passedCount = steps.filter((s) => s.ok).length;
      return {
        ok: true,
        steps,
        artifacts,
        llmTrace,
        consoleSummary: `PASS ${scenarioName} ${passedCount}/${steps.length}`,
      };
    } finally {
      await fixture.close();
    }
  },
};
```

**Raw-leak guard pattern** (lines 772-809):
```typescript
const forbiddenSnippets = [
  USER_INPUT_TEXT,
  streamedReplyText,
  finalAssistantContent,
  "/uploads/",
  "data:image",
  "device_",
  "guest_session",
  "authorization",
  "api_key",
  "messages",
  "rawPrompt",
  "promptText",
  "providerPayload",
  "rawProviderPayload",
  "headers",
  "body",
  "toolArguments",
  "toolResult",
  "historySnapshot",
  "mealsSnapshot",
  "streamFrames",
  "token",
].filter((snippet): snippet is string => typeof snippet === "string" && snippet.length > 0);
const leakedSnippet = forbiddenSnippets.find((snippet) => serializedTrace.includes(snippet));
if (leakedSnippet !== undefined) {
  const stepResult = fail("verify_llm_trace", "Trace serialization leaked raw scenario evidence or content", {
    leakedSnippetLength: leakedSnippet.length,
  });
  steps.push(stepResult);
  return failScenario("verify_llm_trace");
}
```

**Harness type contract pattern** (`tests/harness/scenario-types.ts` lines 39-62):
```typescript
export interface ScenarioResult {
  ok: boolean;
  failedStep?: string;
  steps: ScenarioStepResult[];
  artifacts: Record<string, unknown>;
  llmTrace?: Record<string, unknown>;
  consoleSummary: string;
}

export interface VerificationScenario {
  name: string;
  run(ctx: ScenarioContext): Promise<ScenarioResult>;
}
```

**Phase 64 application:** Do not plan a harness by default. Use this only if a named trigger appears: PROOF-02 needs an observed persisted multi-turn evidence path, PROOF-01 false-pass risk falls on SSE/multi-turn/artifact emission, or an existing harness is stale after Phase 60-63 contracts.

---

### `tests/harness/artifacts.ts` (harness utility, file-I/O transform)

**Analog:** `tests/harness/artifacts.ts`

**Redaction import and constants pattern** (lines 17-20, 43-45):
```typescript
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ScenarioResult, ScenarioStepResult } from "./scenario-types.js";

const REDACTED = "[REDACTED]";
const REDACTED_PATH = "[REDACTED_PATH]";
```

**Recursive redaction pattern** (lines 50-89):
```typescript
export function redact(value: unknown): unknown {
  if (typeof value === "string") {
    return redactString(value);
  }
  if (Array.isArray(value)) {
    return value.map(redact);
  }
  if (value !== null && typeof value === "object") {
    return redactObject(value as Record<string, unknown>);
  }
  return value;
}

function redactObject(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(obj)) {
    if (shouldOmitKey(key)) {
      continue;
    } else if (shouldRedactKey(key)) {
      result[key] = REDACTED;
    } else {
      result[key] = redact(val);
    }
  }
  return result;
}
```

**Omitted keys denylist pattern** (lines 106-151):
```typescript
const OMITTED_KEYS = new Set([
  "apikey",
  "arguments",
  "assistantmessage",
  "authorization",
  "body",
  "content",
  "cookie",
  "finalanswer",
  "finalassistantcontent",
  "guestsession",
  "historysnapshot",
  "headers",
  "imagebase64",
  "imagedata",
  "messages",
  "providerpayload",
  "rawmessages",
  "rawprompt",
  "rawproviderpayload",
  "rawsse",
  "rawstreamframes",
  "rawtoolresult",
  "sessiontoken",
  "setcookie",
  "ssetranscript",
  "streamframes",
  "token",
  "toolarguments",
  "toolresult",
  "uploadstagingpath",
  "usermealtext",
  "rawusermessage",
]);
```

**Write only redacted artifacts pattern** (lines 197-248):
```typescript
export async function writeScenarioArtifacts(
  scenarioName: string,
  result: ScenarioResult,
): Promise<void> {
  const dir = latestDir(scenarioName);

  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const summary = buildSummary(scenarioName, result);
  fs.writeFileSync(
    path.join(dir, "summary.json"),
    JSON.stringify(summary, null, 2),
    "utf-8",
  );

  const steps = result.steps.map((s: ScenarioStepResult) => ({
    name: s.name,
    ok: s.ok,
    ...(s.actual !== undefined ? { actual: redact(s.actual) } : {}),
    ...(s.expected !== undefined ? { expected: redact(s.expected) } : {}),
    ...(s.error !== undefined ? { error: REDACTED } : {}),
  }));
  fs.writeFileSync(path.join(dir, "steps.json"), JSON.stringify(steps, null, 2), "utf-8");

  const snapshots = redact(result.artifacts);
  fs.writeFileSync(
    path.join(dir, "snapshots.json"),
    JSON.stringify(snapshots, null, 2),
    "utf-8",
  );

  if (result.llmTrace !== undefined) {
    fs.writeFileSync(
      path.join(dir, "llm-trace.json"),
      JSON.stringify(redact(result.llmTrace), null, 2),
      "utf-8",
    );
  }

  const scenarioResult = redact(result);
  fs.writeFileSync(
    path.join(dir, "scenario-result.json"),
    JSON.stringify(scenarioResult, null, 2),
    "utf-8",
  );
}
```

**Phase 64 application:** Modify this producer only if the sweep proves a persisted leak can be recreated. Delete-only remediation is insufficient when the producer remains capable of re-emitting the leak.

## Shared Patterns

### Node Test Framework
**Source:** `tests/unit/verification-artifacts.test.ts`, `tests/integration/meals-api.test.ts`
**Apply to:** All Phase 64 unit/integration tests

Use Node built-in `node:test` and `node:assert/strict`. Keep local TypeScript imports with explicit `.js` specifiers. Use real SQLite through `buildApp({ dbPath: ":memory:" })` or existing service factories when persistence matters. Do not add Jest, Vitest, or DB mocks.

### Timezone and Commands
**Source:** `AGENTS.md`, `scripts/release-check.mjs`
**Apply to:** All changed TypeScript, tests, scripts, and closure proof

Any `*.ts` edit requires `yarn tsc --noEmit`. Unit test edits require `yarn test:unit`; route/service edits require `yarn test:integration`; harness scenario edits require `yarn verify:harness -- <scenario>`. Phase 64 closure must explicitly run `yarn tsc --noEmit` and `yarn release:check`. No staging/main promotion is in scope.

### Metadata-Only Evidence
**Source:** `tests/harness/artifacts.ts`, `tests/unit/verification-artifacts.test.ts`, `tests/unit/llm-chat-trace.test.ts`
**Apply to:** `64-VERIFICATION.md`, sweep tests/scripts, trace/log tests, harness artifacts

Record counts, paths, statuses, schema keys, event names, and facts proven. Do not store raw matches, raw prompts, user text, assistant final text, tool payloads, provider bodies, raw SSE transcripts, session/cookie values, upload paths, image payloads, or DB snapshots in planning proof.

### PROOF-01 Evidence-First Rule
**Source:** `64-CONTEXT.md`, `64-VALIDATION.md`, existing Phase 60-63 tests
**Apply to:** Goal, mutation outcome, stale receipt, and SSE freshness testing

Fill the PROOF-01 coverage table from existing passing evidence first. New behavior tests are justified only when baseline or sweep results expose a concrete false-pass risk.

### Harness Default-Off Rule
**Source:** `64-CONTEXT.md`, `nutrition-new-harness-scenario`
**Apply to:** Any `tests/harness/scenarios/*` work

Harness work must name the trigger: multi-turn or persisted evidence path, SSE/multi-turn/artifact false-pass risk, or stale existing harness evidence. Otherwise keep Phase 64 in unit/integration/sweep/report space.

### Project Skill Guidance
**Source:** `.codex/skills/nutrition-gen-test/SKILL.md`, `.codex/skills/nutrition-verify-change/SKILL.md`, `.codex/skills/nutrition-new-harness-scenario/SKILL.md`, `.codex/skills/nutrition-security-review/SKILL.md`, `.codex/skills/nutrition-harness-review/SKILL.md`
**Apply to:** Planning and execution of Phase 64

- `nutrition-gen-test`: choose unit for pure/source-contract privacy assertions, integration for Fastify/SSE/SQLite behavior, and harness only for multi-step boundary proof.
- `nutrition-verify-change`: select gates from edited paths; keep `release:check` for baseline and closure rather than every edit.
- `nutrition-new-harness-scenario`: if harness is triggered, copy `VerificationScenario`, `STEP_NAMES`, `pass`/`fail`/`failResult`, `createScenarioApp()`, and `finally fixture.close()` patterns.
- `nutrition-security-review`: treat persisted prompts, session material, provider bodies, upload paths, and raw image payloads as information-disclosure risks.
- `nutrition-harness-review`: review any harness change for false-pass risk, assertion strength, artifact quality, and fixture isolation.

## No Analog Found

No likely Phase 64 file lacks an analog. The only unresolved decision is whether the PROOF-02 sweep is best implemented as:

| Candidate | Role | Data Flow | Reason Planner Decides |
|-----------|------|-----------|------------------------|
| `tests/unit/<phase64-sweep>.test.ts` | test | file-I/O, transform | Preferred if Node assertions over files can close the false-pass risk. |
| `scripts/phase64-metadata-sweep.mjs` | script / utility | batch file-I/O | Use only if planner needs a reusable command over arbitrary artifact surfaces and can keep output metadata-only. |

## Metadata

**Analog search scope:** `.planning/phases`, `tests/unit`, `tests/integration`, `tests/harness`, `scripts`, `.codex/skills`
**Files scanned:** Required phase/codebase context files plus 13 analog/source files
**Pattern extraction date:** 2026-05-19
