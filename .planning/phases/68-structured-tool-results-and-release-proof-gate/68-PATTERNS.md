# Phase 68: Structured Tool Results and Release-Proof Gate - Pattern Map

**Mapped:** 2026-05-29
**Files analyzed:** 11 likely new/modified files
**Analogs found:** 11 / 11

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `server/orchestrator/tools.ts` | orchestrator adapter / service | request-response, transform, CRUD side-effect gating | `server/orchestrator/tools.ts` non-resolved `find_meals`, controlled update/delete/goal mappings | exact |
| `server/orchestrator/mutation-receipts.ts` | utility / renderer | transform | `server/orchestrator/mutation-receipts.ts` correction target and numeric renderer helpers | exact |
| `server/orchestrator/index.ts` | orchestrator service | event-driven tool loop, request-response | `server/orchestrator/index.ts` `controlledReply` terminal path | exact |
| `server/lib/historical-date.ts` | utility | transform | `server/lib/historical-date.ts` `HistoricalDateIntent` union and resolver | exact |
| `server/routes/chat.ts` | route | request-response, streaming, persistence, pub-sub guard | `server/routes/chat.ts` `finalizeAssistantReply()`, JSON/SSE reply paths, `publishSummarySafe()` | exact |
| `tests/unit/tools.test.ts` | test | request-response adapter proof | `tests/unit/tools.test.ts` Phase 67 controlled `find_meals` and guard-result tests | exact |
| `tests/unit/orchestrator.test.ts` | test | event-driven orchestrator proof, source scan | `tests/unit/orchestrator.test.ts` renderer terminal/no-second-LLM and source-scan tests | exact |
| `tests/integration/chat-meal-correction.integration.test.ts` | test | request-response route proof, pub-sub suppression | Phase 67 route clarification/no mutation/no publish test | exact |
| `tests/integration/chat-api.test.ts` | test | request-response JSON proof, persistence | JSON no-mutation and summary history persistence tests | exact |
| `tests/integration/chat-streaming.test.ts` | test | streaming SSE proof, persistence | SSE done/chunk/history persistence tests | exact |
| `.planning/phases/68-structured-tool-results-and-release-proof-gate/68-VERIFICATION.md` | proof doc | batch / release evidence | `67-VERIFICATION.md`, `65-VERIFICATION.md`, `package.json`, `scripts/release-check.mjs` | role-match |

## Pattern Assignments

### `server/orchestrator/tools.ts` (orchestrator adapter, request-response/transform)

**Analog:** `server/orchestrator/tools.ts`

**Imports pattern** (lines 1-59):
```typescript
import { z } from "zod";
import type { ToolDefinition, ToolCall } from "../llm/types.js";
import {
  buildHistoricalLoggedAt,
  resolveHistoricalDateIntent,
  type HistoricalMealPeriod,
} from "../lib/historical-date.js";
import {
  runContract,
  summarizeContractArgsForLog,
  type ToolContract,
  type RunContractContext,
} from "./tool-contract.js";
import {
  renderCorrectionTargetClarificationCopy,
  renderCorrectionTargetNoMealsForDateCopy,
  renderCorrectionTargetSameDateRecoveryCopy,
  renderMealNumericAuthorityFailureCopy,
  renderMealNumericClarificationCopy,
  renderMealNumericProposalCopy,
} from "./mutation-receipts.js";
```

Use explicit `.js` local specifiers and import renderer helpers from `mutation-receipts.ts`, not from the orchestrator loop.

**Current result boundary** (lines 91-109):
```typescript
export interface ToolExecutionResult {
  result: string;
  summary: string;
  success?: boolean;
  executed?: boolean;
  failureReason?: "validation" | "guard" | "execute";
  controlledReply?: {
    source: "renderer";
    reason:
      | "goal_proposal"
      | "goal_authority_failure"
      | "goal_validation_failure"
      | "goal_cancel"
      | "meal_target_clarification"
      | "meal_numeric_authority_failure"
      | "meal_numeric_clarification"
      | "meal_numeric_proposal";
    text: string;
  };
```

Extend this interface with the Phase 68 typed clarification discriminated union. Keep it narrow and renderer-ready; do not expose raw `contractResult` to `index.ts`.

**Historical brittle path to replace** (lines 617-621, 1190-1222, 1387-1408):
```typescript
function buildHistoricalToolMessage(
  result: HistoricalToolClarification | { status: "multiple_targets"; dateKeys: string[] },
): string {
  return JSON.stringify(result);
}
```

```typescript
if (dateIntent.status === "needs_clarification") {
  const clarification: HistoricalToolClarification = {
    status: "needs_clarification",
    prompt: dateIntent.prompt,
    reason: dateIntent.reason,
  };
  return {
    ok: true,
    result: clarification,
    toolMessage: buildHistoricalToolMessage(clarification),
  };
}
```

```typescript
if (dateIntent.status === "resolved_many") {
  const multipleTargets = {
    status: "multiple_targets" as const,
    dateKeys: dateIntent.dateKeys,
  };
  return {
    ok: true,
    result: multipleTargets,
    toolMessage: buildHistoricalToolMessage(multipleTargets),
  };
}
```

Planner should replace behavior dependence on serialized `toolMessage` with typed `ToolExecutionResult` facts plus terminal `controlledReply`.

**Existing controlled adapter pattern to copy** (lines 1953-1981, 2127-2142):
```typescript
function renderFindMealsControlledReply(result: Exclude<FindMealsResult, { status: "resolved" }>): string {
  const noMealsDateKey = dateKeyFromNoMealsPrompt(result.prompt);
  if (noMealsDateKey) {
    return renderCorrectionTargetNoMealsForDateCopy({
      action: result.action,
      dateKey: noMealsDateKey,
    });
  }

  if (result.status === "needs_clarification" && result.candidates.length > 0) {
    return renderCorrectionTargetClarificationCopy({
      action: result.action,
      candidates: result.candidates,
    });
  }

  return result.prompt;
}
```

```typescript
if (toolCall.function.name === "find_meals") {
  const contractResult = outcome.contractResult as FindMealsResult;
  if (contractResult.status !== "resolved") {
    const reply = renderFindMealsControlledReply(contractResult);
    return {
      result: reply,
      summary: `status: ${contractResult.status}`,
      success: false,
      executed: false,
      failureReason: "guard",
      controlledReply: {
        source: "renderer",
        reason: "meal_target_clarification",
        text: reply,
      },
    };
  }
}
```

Apply this shape to historical `log_food` `needs_clarification` and `get_daily_summary` `needs_clarification` / `multiple_targets`: `success:false`, `executed:false`, `failureReason:"guard"`, renderer `controlledReply`, and no mutation fields.

**Do not copy current historical non-terminal shape** (lines 2105-2114, 2217-2235):
```typescript
if (contractResult.status === "needs_clarification") {
  return {
    result: outcome.result,
    summary: "status: needs_clarification",
    success: false,
    executed: false,
    failureReason: "guard",
  };
}
```

That shape lacks `controlledReply`, so `index.ts` continues the tool loop.

---

### `server/orchestrator/mutation-receipts.ts` (utility/renderer, transform)

**Analog:** `server/orchestrator/mutation-receipts.ts`

**Renderer import and forbidden-copy pattern** (lines 1-44):
```typescript
import { currentAppDate, formatLocalDate } from "../lib/time.js";
import type { MealCorrectionCandidate } from "../services/meal-correction.js";

export const FORBIDDEN_RECEIPT_TERMS = [
  "headline",
  "log_food",
  "update_meal",
  "delete_meal",
  "summaryOutcome",
  "dailySummary",
  "JSON",
] as const;

export function assertNoForbiddenReceiptTerms(text: string): string[] {
  return FORBIDDEN_RECEIPT_TERMS.filter((term) => text.includes(term));
}
```

Use this file for Phase 68 terminal clarification copy helpers. Add forbidden internal terms if new helper tests need to protect against serialized/result-copy leakage.

**Candidate option projection pattern** (lines 122-168):
```typescript
function formatCorrectionTargetTime(loggedAt: string): string {
  const local = new Date(loggedAt);
  const hour = `${local.getHours()}`.padStart(2, "0");
  const minute = `${local.getMinutes()}`.padStart(2, "0");
  return `${hour}:${minute}`;
}

function formatCorrectionTargetMealPeriod(candidate: MealCorrectionCandidate): string {
  if (candidate.mealPeriodSource !== "explicit") {
    return "";
  }
  switch (candidate.mealPeriod) {
    case "breakfast":
      return " 早餐";
    case "lunch":
      return " 午餐";
    case "dinner":
      return " 晚餐";
    case "late_night":
      return " 宵夜";
    default:
      return "";
  }
}

function formatCorrectionTargetOption(candidate: MealCorrectionCandidate, index: number): string {
  return `${index + 1}. ${candidate.dateKey} ${formatCorrectionTargetTime(candidate.loggedAt)}${formatCorrectionTargetMealPeriod(candidate)} ${candidate.foodName}`;
}

export function renderCorrectionTargetClarificationCopy(input: CorrectionTargetClarificationCopyInput): string {
  const leadIn = `我找到多筆可能要${correctionTargetActionVerb(input.action)}的餐點，請直接回覆編號：`;
  return [leadIn, ...formatCorrectionTargetOptions(input.candidates)].join("\n");
}
```

For Phase 68 candidate facts, copy the projection idea but avoid exposing full `MealCorrectionCandidate` as the public renderer/proof surface. Default fields: stable option number, `dateKey`, display time, safe display label, and explicit meal-period facts only.

**No-side-effect copy pattern** (lines 230-245):
```typescript
export function renderMealNumericAuthorityFailureCopy(
  input: MealNumericFieldAwareCopyInput = {},
): string {
  const fieldText = input.field
    ? `${mealNumericFieldLabel(input.field)}需要明確目標數字，或改用「減半」、「少 20%」這類可計算調整。`
    : "請提供明確目標數字，或改用「減半」、「少 20%」這類可計算調整。";
  return `這次沒有更新餐點紀錄。${fieldText}`;
}

export function renderMealNumericClarificationCopy(
  input: MealNumericFieldAwareCopyInput = {},
): string {
  const fieldText = input.field
    ? `如果要調整${mealNumericFieldLabel(input.field)}，`
    : "如果要調整餐點數字，";
  return `這次沒有更新餐點紀錄。${fieldText}請給明確目標數字，或說「減半」、「少 20%」、「偏高」這類方向讓我再確認。`;
}
```

Historical clarification helpers should use the same concise renderer-owned style and avoid success verbs like "已記錄" / "已更新".

---

### `server/orchestrator/index.ts` (orchestrator service, event-driven tool loop)

**Analog:** `server/orchestrator/index.ts`

**Imports pattern** (lines 18-40):
```typescript
import {
  getToolDefinitions,
  executeTool,
  isFatalToolError,
  redactToolArgsForHook,
  type ToolExecutionResult,
} from "./tools.js";
import {
  assertNoForbiddenReceiptTerms,
  renderGoalCancelCopy,
  renderMealNumericCancelCopy,
  renderMutationReceipt,
  renderProposalKindAmbiguityCopy,
} from "./mutation-receipts.js";
```

Do not import historical clarification renderers here. `index.ts` should consume `controlledReply` only.

**Terminal controlled reply pattern** (lines 1040-1084):
```typescript
const {
  result,
  summary,
  success,
  failureReason,
  updatedFields,
  publishedEvents,
  dailyTargets,
  affectedDate,
  mealMutationKind,
  deletedMeal,
  summaryHistoryFacts: toolSummaryHistoryFacts,
  controlledReply,
} = await executeTool(toolCall, deviceId, { ... }, {
  currentUserMessage: userMessage,
  previousAssistantMessage,
});
if (controlledReply) {
  opts?.hooks?.onToolResult?.({
    tool: toolCall.function.name,
    success: success !== false,
    executed: success !== false,
    failureReason,
    summary,
    updatedFields,
    publishedEvents,
  });
  opts?.hooks?.onLLMEnd?.(round + 1, true);
  return {
    reply: controlledReply.text,
    didLogMeal: false,
    didMutateMeal: false,
    finalReplySource: controlledReply.source,
    finalReplyShape: classifyPlainReplyShape(controlledReply.text),
  };
}
```

Phase 68 should preserve this exact terminal behavior. Historical clarification must exit here before tool-message persistence, mutation receipt assembly, or a second LLM pass.

**Mutation renderer terminal pattern** (lines 1228-1242):
```typescript
if (mutationEffects) {
  const reply = mutationReceiptText ?? renderCheckedMutationReceipt(mutationEffects);
  opts?.hooks?.onLLMEnd?.(round + 1, true);
  return {
    reply,
    didLogMeal,
    didMutateMeal,
    dailySummary: logMealSummary,
    summaryOutcome: mealSummaryOutcome,
    dailyTargets: successfulGoalTargets,
    affectedDate: resolvedAffectedDate,
    loggedMeal,
    loggedMealToolMessageId,
    finalReplySource: "renderer",
    finalReplyShape: classifyPlainReplyShape(reply),
  };
}
```

Use this as the positive contrast: mutation receipts may include mutation facts; terminal clarification must not include `dailySummary`, `summaryOutcome`, `loggedMeal`, or mutation flags.

---

### `server/lib/historical-date.ts` (utility, transform)

**Analog:** `server/lib/historical-date.ts`

**Discriminated union pattern** (lines 20-39):
```typescript
export type HistoricalDateIntent =
  | {
      status: "resolved";
      dateKey: string;
      isHistorical: boolean;
      source: "default_today" | "explicit" | "carry_forward";
      matchedText: string[];
    }
  | {
      status: "resolved_many";
      dateKeys: string[];
      source: "explicit";
      matchedText: string[];
    }
  | {
      status: "needs_clarification";
      reason: "multiple_dates" | "unsupported" | "unparseable";
      prompt: string;
      matchedText: string[];
    };
```

Phase 68 `ToolExecutionResult` clarification facts should mirror this style: a narrow discriminated union with branch-specific fields.

**Resolver prompt/reason facts** (lines 316-349):
```typescript
if (invalidMatches.length > 0) {
  return {
    status: "needs_clarification",
    reason: "unparseable",
    prompt: "我還不能確定是哪一天，請再說一次日期。",
    matchedText: invalidMatches,
  };
}

if (dateKeys.length > 1) {
  if (mode === "query") {
    return {
      status: "resolved_many",
      dateKeys,
      source: "explicit",
      matchedText,
    };
  }

  return {
    status: "needs_clarification",
    reason: "multiple_dates",
    prompt: "我還不能確定你要記錄哪一天，請一次告訴我一個日期。",
    matchedText,
  };
}
```

Do not rebuild date parsing for Phase 68. Use these prompt/reason/dateKeys facts as the source of terminal historical clarification rendering.

**Carry-forward constraint source** (lines 362-369):
```typescript
if (previousDateKey && dayKeyToDate(previousDateKey) && isObviousHistoricalFollowUp(trimmed)) {
  return {
    status: "resolved",
    dateKey: previousDateKey,
    isHistorical: previousDateKey !== todayKey,
    source: "carry_forward",
    matchedText: [],
  };
}
```

`get_daily_summary` `multiple_targets` copy must not look like one explicit resolved previous date. Add proof around this because `extractPreviousHistoricalDateKey()` feeds prior assistant text back through this resolver.

---

### `server/routes/chat.ts` (route, request-response/streaming/persistence)

**Analog:** `server/routes/chat.ts`

**Imports and ownership pattern** (lines 1-31):
```typescript
import type { FastifyInstance, FastifyRequest, FastifyBaseLogger } from "fastify";
import type { createOrchestrator } from "../orchestrator/index.js";
import type { createChatService } from "../services/chat.js";
import type { RealtimePublisher } from "../realtime/publisher.js";
import type { ToolExecutionResult } from "../orchestrator/tools.js";
import { resolveGuestSession } from "../lib/guest-session-resolver.js";
```

Routes own transport, response shaping, signed guest-session resolution, assistant persistence, and publish fan-out. They should not render historical clarification copy.

**Assistant persistence primitive** (lines 227-246):
```typescript
async function finalizeAssistantReply(
  chatService: ReturnType<typeof createChatService>,
  deviceId: string,
  rawReply: string,
  receiptIdentity?: ReceiptIdentity,
  opts?: { status?: "complete" | "stopped" | "error" },
): Promise<{ sanitized: string; assistantMessageId: string }> {
  const sanitized = sanitizeReply(rawReply);
  const assistantMessage = await chatService.saveMessage(
    deviceId,
    "assistant",
    sanitized,
    opts?.status ? { status: opts.status } : undefined,
  );
```

D-18b proof should assert controlled replies are persisted through this route boundary before follow-up turns.

**Publish suppression gate** (lines 388-414):
```typescript
function publishSummarySafe(
  publisher: RealtimePublisher,
  deviceId: string,
  didMutateMeal: boolean,
  dailySummary: unknown,
  affectedDate: unknown,
  log: FastifyBaseLogger,
): void {
  const summaryDate = dailySummary && typeof dailySummary === "object" && "date" in dailySummary
    ? (dailySummary as DailySummary).date
    : undefined;
  const publishAffectedDate = typeof affectedDate === "string" && affectedDate
    ? affectedDate
    : summaryDate;
  if (!didMutateMeal || !publishAffectedDate || !summaryDate || summaryDate !== publishAffectedDate) {
    return;
  }
```

Terminal historical clarification should make this return early by carrying `didMutateMeal:false` and no daily summary.

**SSE controlled/non-stream reply pattern** (lines 1010-1053):
```typescript
const { reply: replyText, didLogMeal, dailySummary, summaryOutcome, summaryHistoryFacts, dailyTargets, affectedDate, loggedMeal } = result;
streamDidLogMeal = didLogMeal;
streamDidMutateMeal = result.didMutateMeal ?? didLogMeal;
const shouldComposeSummaryHistory = result.finalReplySource !== "renderer"
  && !result.fallbackOutcomeContext;
const normalizedReply = normalizeRouteFinalReply(
  appendHistoricalDateSuffixIfMissing(replyText, affectedDate),
  didLogMeal,
  streamDidMutateMeal,
  summaryHistoryFacts,
  {
    composeSummaryHistory: shouldComposeSummaryHistory,
    rendererOwnedSummaryHistory: result.finalReplySource === "renderer",
  },
).reply;
const { sanitized: sanitizedFallback } = await finalizeAssistantReply(
  deps.chatService,
  deviceId,
  normalizedReply,
  streamReceiptIdentity,
);
stream.write(`event: chunk\ndata: ${JSON.stringify({ token: sanitizedFallback })}\n\n`);
const doneData = {
  turnId: stopControl.turnId,
  didLogMeal,
  didMutateMeal: streamDidMutateMeal,
  ...(summaryOutcome ? { summaryOutcome } : {}),
};
stream.write(`event: done\ndata: ${JSON.stringify(doneData)}\n\n`);
```

For renderer-owned terminal clarification, `summaryOutcome` and `dailySummary` should be omitted and `didMutateMeal` should be false in `done`.

**JSON controlled/non-stream reply pattern** (lines 1399-1450):
```typescript
const { reply: replyText, didLogMeal, dailySummary, summaryHistoryFacts, dailyTargets, affectedDate } = result;
const shouldComposeSummaryHistory = result.finalReplySource !== "renderer"
  && !result.fallbackOutcomeContext;
const normalizedReply = normalizeRouteFinalReply(
  appendHistoricalDateSuffixIfMissing(replyText, affectedDate),
  didLogMeal,
  jsonDidMutateMeal,
  summaryHistoryFacts,
  {
    composeSummaryHistory: shouldComposeSummaryHistory,
    rendererOwnedSummaryHistory: result.finalReplySource === "renderer",
  },
).reply;
const { sanitized: sanitizedJson } = await finalizeAssistantReply(
  chatService,
  deviceId,
  normalizedReply,
  jsonReceiptIdentity,
);
traceRecorder?.recordFinalReply({
  source: result.finalReplySource ?? "model",
  shape: result.finalReplyShape ?? "empty_or_missing",
});
publishSummarySafe(publisher, deviceId, jsonDidMutateMeal, dailySummary, affectedDate, turnLog);
return {
  turnId,
  reply: sanitizedJson,
  didLogMeal,
  ...(result.didMutateMeal !== undefined ? { didMutateMeal: result.didMutateMeal } : {}),
  ...(jsonSummaryOutcome ? { summaryOutcome: jsonSummaryOutcome } : {}),
};
```

JSON tests should assert the response and the persisted history row, not just the HTTP body.

---

### `tests/unit/tools.test.ts` (unit test, adapter proof)

**Analog:** `tests/unit/tools.test.ts`

**Imports/fixture pattern** (lines 1-23, 51-57):
```typescript
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../../server/db/client.js";
import { createDeviceService } from "../../server/services/device.js";
import { createMealCorrectionService } from "../../server/services/meal-correction.js";
import { createFoodLoggingService } from "../../server/services/food-logging.js";
import { createSummaryService } from "../../server/services/summary.js";
import {
  executeTool,
  type ToolDeps,
} from "../../server/orchestrator/tools.js";
import type { ToolCall } from "../../server/llm/types.js";

beforeEach(async () => {
  db = createDb(":memory:");
  const deviceService = createDeviceService(db);
  foodLoggingService = createFoodLoggingService(db);
  summaryService = createSummaryService(db);
  deviceId = (await deviceService.createDevice("fat_loss")).deviceId;
});
```

Use real SQLite and direct `executeTool()` calls.

**Controlled `find_meals` proof pattern** (lines 1310-1336):
```typescript
const result = await executeTool({
  id: "call_find_meals_renderer_clarification",
  type: "function",
  function: {
    name: "find_meals",
    arguments: JSON.stringify({
      action: "update",
      query: "把 4/18 的鴨腿便當改成 500 卡",
    }),
  },
}, deviceId, {
  foodLoggingService,
  summaryService,
  mealCorrectionService,
  toolSessionState,
} as unknown as ToolDeps);

assert.equal(result.summary, "status: needs_clarification");
assert.equal(result.success, false);
assert.equal(result.executed, false);
assert.equal(result.failureReason, "guard");
assert.deepEqual(result.controlledReply, {
  source: "renderer",
  reason: "meal_target_clarification",
  text: result.result,
});
```

Add analogous assertions for `clarification` typed facts on `find_meals`, historical `log_food`, and historical `get_daily_summary`.

**Current serialized result assertion to retire** (lines 2046-2074):
```typescript
assert.equal(result.success, false);
assert.equal(result.executed, false);
assert.equal(result.failureReason, "guard");
assert.equal(result.summary, "status: multiple_targets");
assert.deepEqual(JSON.parse(result.result), {
  status: "multiple_targets",
  dateKeys: [formatLocalDate(yesterday), formatLocalDate(dayBeforeYesterday)],
});
```

Replace `JSON.parse(result.result)` behavior proof with typed `result.clarification` assertions and renderer-controlled text assertions.

---

### `tests/unit/orchestrator.test.ts` (unit test, orchestrator/source-scan proof)

**Analog:** `tests/unit/orchestrator.test.ts`

**Imports and mock provider pattern** (lines 1-24, 70-127):
```typescript
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createDb } from "../../server/db/client.js";
import { MockLLMProvider } from "../../server/llm/mock.js";
import { createOrchestrator, guardNoMutationLoggingClaim } from "../../server/orchestrator/index.js";

class StreamingLLMProvider implements LLMProvider {
  private chatQueue: Array<LLMResponse | Error> = [];
  private roundQueue: Array<LLMRoundResult | Error> = [];
  public chatCalls: Array<{ messages: ChatMessage[]; tools: ToolDefinition[] }> = [];

  queueChatResponse(response: LLMResponse) {
    this.chatQueue.push(response);
  }

  async chat(messages: ChatMessage[], tools: ToolDefinition[]): Promise<LLMResponse> {
    this.chatCalls.push({ messages, tools });
    ...
  }
}
```

Use queued second LLM responses to prove terminal clarification does not consume them.

**Source-scan idiom** (lines 189-197):
```typescript
it("Phase 67 D-26/D-27/D-28 removes raw-message correction clarification rendering from orchestrator", () => {
  const source = readFileSync(new URL("../../server/orchestrator/index.ts", import.meta.url), "utf8");

  assert.doesNotMatch(source, /buildCorrectionClarificationReply/);
  assert.doesNotMatch(source, /extractUserCorrectionTarget/);
  assert.doesNotMatch(source, /formatCorrectionCandidate/);
  assert.doesNotMatch(source, /parseCorrectionToolResult/);
  assert.doesNotMatch(source, /correctionClarificationReply/);
});
```

Add one small Phase 68 scan here for serialized clarification-result reparsing in `index.ts`. Allow legitimate JSON parsing in `tool-contract.ts`, SSE parsing tests, and raw tool-call argument handling.

**No-second-LLM terminal proof pattern** (lines 1206-1236):
```typescript
localLLM.queueChatResponse({
  toolCalls: [{
    id: "find_renderer_owned_target",
    type: "function",
    function: {
      name: "find_meals",
      arguments: JSON.stringify({ action: "update", query: "..." }),
    },
  }],
});
localLLM.queueChatResponse({
  content: "已更新中午雞腿便當的滷蛋。",
});

const result = await orchestrator.handleMessage(localDeviceId, "...");

assert.equal(localLLM.chatCalls.length, 1, "renderer-owned clarification must not ask the model to rewrite it");
assert.equal(result.didLogMeal, false);
assert.equal(result.didMutateMeal, false);
assert.equal(result.finalReplySource, "renderer");
assert.equal(result.finalReplyShape, "plain_text");
assert.doesNotMatch(result.reply, /已更新|已套用|蛋白質|kcal|calories|protein/);
```

Copy this for historical `log_food` and `get_daily_summary` terminal clarification.

---

### `tests/integration/chat-meal-correction.integration.test.ts` (integration test, request-response/no-publish proof)

**Analog:** `tests/integration/chat-meal-correction.integration.test.ts`

**Route no-side-effect proof pattern** (lines 1638-1687):
```typescript
mockLLM.queueChatResponse({
  toolCalls: [{
    id: "find_route_renderer_owned_clarification",
    type: "function",
    function: {
      name: "find_meals",
      arguments: JSON.stringify({
        action: "update",
        query: "把中午雞腿便當的滷蛋改成兩顆水煮蛋",
      }),
    },
  }],
});
mockLLM.queueChatResponse({ content: "已更新中午雞腿便當的滷蛋。" });

const { status, body } = await postChat("把中午雞腿便當的滷蛋改成兩顆水煮蛋");

assert.equal(status, 200);
assert.equal(mockLLM.chatCalls.length, 1);
assert.equal(body.didLogMeal, false);
assert.equal(body.didMutateMeal, false);
assert.equal(Object.prototype.hasOwnProperty.call(body, "summaryOutcome"), false);
assert.equal(Object.prototype.hasOwnProperty.call(body, "dailySummary"), false);
assert.doesNotMatch(body.reply, /中午雞腿便當|滷蛋改成|已更新|已套用|kcal|蛋白質/);
assert.deepEqual(publishDailySummaryCalls, []);
```

Use this pattern for JSON route historical clarification where publish suppression is in scope.

---

### `tests/integration/chat-api.test.ts` (integration test, JSON persistence proof)

**Analog:** `tests/integration/chat-api.test.ts`

**Test stack pattern** (lines 1-19):
```typescript
process.env.TZ = "Asia/Taipei";

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";
import { buildApp } from "../../server/app.js";
import type { AppServices } from "../../server/app.js";
import { MockLLMProvider } from "../../server/llm/mock.js";
```

Preserve `TZ=Asia/Taipei`; use `buildApp()` and real services.

**JSON response plus history persistence pattern** (lines 353-378):
```typescript
const res = await fetch(`${address}/api/chat`, {
  method: "POST",
  headers: { cookie: sessionCookieHeader },
  body: form,
});

assert.equal(res.status, 200);
const body = await res.json() as {
  reply?: string;
  didLogMeal?: boolean;
  didMutateMeal?: boolean;
};

assert.equal(body.didLogMeal, false);
assert.equal(body.didMutateMeal, false);
assert.doesNotMatch(body.reply ?? "", /已記錄|完成記錄/);

const history = await services?.chatService.getHistory(deviceId, 10);
const assistant = [...(history ?? [])].reverse().find((message) => message.role === "assistant");
assert.ok(assistant);
assert.doesNotMatch(String(assistant.content), /已記錄|完成記錄/);
```

Phase 68 JSON tests should assert terminal clarification body, omitted side-effect fields, and persisted assistant clarification text.

---

### `tests/integration/chat-streaming.test.ts` (integration test, SSE persistence proof)

**Analog:** `tests/integration/chat-streaming.test.ts`

**Streaming mock pattern** (lines 1-24):
```typescript
process.env.TZ = "Asia/Taipei";

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../../server/app.js";
import type { AppServices } from "../../server/app.js";

class StreamingLLMProvider implements LLMProvider {
  private chatQueue: Array<LLMResponse | Error> = [];
  private roundQueue: Array<RoundQueueItem> = [];
  public chatCalls: Array<{ messages: ChatMessage[]; tools: ToolDefinition[] }> = [];
```

**SSE chunk/done/history pattern** (lines 2744-2779):
```typescript
const res = await fetch(`${address}/api/chat`, {
  method: "POST",
  headers: { cookie: sessionCookieHeader, "Accept": "text/event-stream" },
  signal: controller.signal,
  body: form,
});

assert.ok(res.body);
const text = await readStreamUntil(res.body.getReader(), "event: done");
const events = parseSSEEvents(text);
const chunkText = events
  .filter((event) => event.event === "chunk")
  .map((event) => JSON.parse(event.data) as { token: string })
  .map((payload) => payload.token)
  .join("");
const donePayload = JSON.parse(events.find((event) => event.event === "done")!.data) as {
  didLogMeal?: boolean;
  didMutateMeal?: boolean;
  dailySummary?: { mealCount?: number; totalCalories?: number };
};

assert.equal(donePayload.didLogMeal, false);
assert.equal(donePayload.didMutateMeal, false);
assert.equal(chunkText, canonicalSummaryText);

const historyRes = await fetch(`${address}/api/chat/history?limit=10`, {
  headers: { cookie: sessionCookieHeader },
});
const historyJson = await historyRes.json() as { messages: Array<{ role: string; content: string }> };
const assistantMsgs = historyJson.messages.filter((message) => message.role === "assistant");
assert.equal(assistantMsgs.length, 1);
assert.equal(assistantMsgs[0]!.content, chunkText);
```

Use this for SSE parity: terminal historical clarification should emit `chunk`, then `done`, with no summary fields and persisted history.

---

### `.planning/phases/68-structured-tool-results-and-release-proof-gate/68-VERIFICATION.md` (proof doc, batch/release evidence)

**Analog:** `.planning/phases/67-correction-targeting-and-backend-clarification-rendering/67-VERIFICATION.md`

**Verification report frontmatter and overview pattern** (lines 1-15):
```markdown
---
phase: 67-correction-targeting-and-backend-clarification-rendering
verified: "2026-05-29T07:27:12Z"
status: passed
score: "12/12 must-haves verified"
overrides_applied: 0
gaps: []
---

# Phase 67: Correction Targeting and Backend Clarification Rendering Verification Report

**Phase Goal:** Ambiguous correction requests surface the right candidate set and use stable backend-rendered clarification copy.  
**Verified:** 2026-05-29T07:27:12Z  
**Status:** passed  
```

**Traceability matrix pattern** (lines 21-34, 81-88):
```markdown
| # | Truth | Status | Evidence |
|---|---|---|---|
| 9 | Non-resolved `find_meals` results terminate as renderer-owned controlled replies before any mutator can run. | VERIFIED | `server/orchestrator/tools.ts` returns guarded controlled replies for non-resolved `find_meals`; `server/orchestrator/index.ts` returns immediately on `controlledReply` with no second final answer. |

| Behavior | Command | Result | Status |
|---|---|---|---|
| TypeScript gate | `yarn tsc --noEmit` | exited 0 | PASS |
| Unit suite | `yarn test:unit` | 902 tests passed | PASS |
| Integration suite | `yarn test:integration` | 330 tests passed | PASS |
```

Phase 68 verification must include PROOF-01 requirement-to-test traceability, PROOF-02 no-harness rationale/metadata-only statement, PROOF-03 `yarn tsc --noEmit` and `yarn release:check`, and explicit no push/merge/deploy/Railway/staging/main actions.

**Release gate command sources** (`package.json` lines 10, 14-16; `scripts/release-check.mjs` lines 91-99, 130-138):
```json
"release:check": "node scripts/run-node-with-tz.mjs --env-file=.env scripts/release-check.mjs",
"test": "node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/*.test.ts tests/integration/*.test.ts",
"test:unit": "node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/*.test.ts",
"test:integration": "node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/*.test.ts"
```

```javascript
function validateTimezoneContract() {
  const runtimeTz = process.env.TZ;
  if (runtimeTz !== REQUIRED_TZ) {
    console.error(`[release-check] FAIL: TZ must be ${REQUIRED_TZ}; received ${received}`);
    process.exit(1);
  }
}

runStep("TypeScript gate", ["tsc", "--noEmit"]);
runStep("Full test suite", ["test"]);
runStep("Frontend build", ["build"]);
```

Record command/status metadata only; do not paste raw prompts, raw tool payloads, provider payloads, or assistant content into verification evidence.

## Shared Patterns

### Contract Boundary and Validation

**Source:** `server/orchestrator/tools.ts` lines 1995-2013 and `server/orchestrator/tool-contract.ts` through `runContract()`

Apply to: `server/orchestrator/tools.ts`, `tests/unit/tools.test.ts`

```typescript
const contract = toolRegistry.get(toolCall.function.name);
if (!contract) {
  throw new FatalToolError("unknown tool");
}

const ctx: RunContractContext = {
  currentUserMessage: sourceContext?.currentUserMessage ?? "",
  previousAssistantMessage: sourceContext?.previousAssistantMessage,
  deps: { toolDeps: deps, deviceId },
};

const outcome = await runContract(contract, toolCall, ctx);
```

Keep raw `contractResult` handling inside `executeTool()` and expose only `ToolExecutionResult` facts.

### Renderer-Owned Terminal Replies

**Source:** `server/orchestrator/tools.ts` lines 2127-2142; `server/orchestrator/index.ts` lines 1067-1084

Apply to: `find_meals`, historical `log_food`, historical `get_daily_summary`

```typescript
controlledReply: {
  source: "renderer",
  reason: "meal_target_clarification",
  text: reply,
}
```

```typescript
if (controlledReply) {
  opts?.hooks?.onLLMEnd?.(round + 1, true);
  return {
    reply: controlledReply.text,
    didLogMeal: false,
    didMutateMeal: false,
    finalReplySource: controlledReply.source,
    finalReplyShape: classifyPlainReplyShape(controlledReply.text),
  };
}
```

### Historical Date Facts

**Source:** `server/lib/historical-date.ts` lines 20-39 and 316-349

Apply to: `server/orchestrator/tools.ts`, `server/orchestrator/mutation-receipts.ts`, `tests/unit/tools.test.ts`

Use `prompt`, `reason`, and `dateKeys` from `resolveHistoricalDateIntent()`; do not introduce a second parser or LLM disambiguation pass.

### Route Persistence and Publish Suppression

**Source:** `server/routes/chat.ts` lines 227-246, 388-414, 1010-1053, 1399-1450

Apply to: JSON/SSE tests for historical terminal clarification

Assert:
- reply body/chunk text is the renderer-owned terminal clarification
- assistant clarification is persisted in `/api/chat/history` or `chatService.getHistory(...)`
- `didLogMeal:false`
- `didMutateMeal:false`
- no `loggedMeal`
- no `summaryOutcome`
- no `dailySummary` unless the path is a non-clarification summary query
- no `daily_summary` publish

### Source Guards

**Source:** `tests/unit/orchestrator.test.ts` lines 189-197

Apply to: `tests/unit/orchestrator.test.ts`

```typescript
const source = readFileSync(new URL("../../server/orchestrator/index.ts", import.meta.url), "utf8");

assert.doesNotMatch(source, /parseCorrectionToolResult/);
```

Add a Phase 68 guard for serialized clarification-result reparsing in `index.ts`. Keep the regex specific so it does not block legitimate JSON parsing of LLM tool-call arguments or SSE test frames.

### Metadata-Only Evidence

**Source:** `tests/unit/verification-artifacts.test.ts` lines 590-613

Apply to: `68-VERIFICATION.md` and any optional harness/artifact evidence

```typescript
assert.doesNotMatch(
  raw,
  /apiKey|api_key|OPENAI_API_KEY|cookie|set-cookie|guestSession|sessionToken|bearer|messages|rawMessages|rawPrompt|promptText|providerPayload|rawProviderPayload|arguments|rawArguments|toolArguments|toolResult|rawToolResult|finalAnswer|assistantContent|finalAssistantContent/,
);
```

If no harness is created, `68-VERIFICATION.md` should explicitly say normal unit/integration tests closed the false-pass risk and no harness artifact was generated.

### Verification Commands

**Source:** `AGENTS.md` lines 73-81; `.codex/skills/nutrition-verify-change/SKILL.md` lines 28-41; `package.json` lines 10-17

Apply to: planner verification sections and `68-VERIFICATION.md`

Use:
- `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/tools.test.ts tests/unit/orchestrator.test.ts`
- `node scripts/run-node-with-tz.mjs --import tsx --test tests/integration/chat-api.test.ts tests/integration/chat-streaming.test.ts tests/integration/chat-meal-correction.integration.test.ts`
- `node scripts/run-node-with-tz.mjs --import tsx --test tests/unit/verification-artifacts.test.ts` if metadata proof is touched
- `yarn tsc --noEmit`
- final local closure: `yarn release:check`

Do not use `npm`, Jest, Vitest, mocked DBs, Railway smoke, deploy, push, merge, staging promotion, or main promotion for this phase.

## No Analog Found

None. Every likely Phase 68 source, test, and proof artifact has a close in-repo analog.

## Metadata

**Analog search scope:** `server/orchestrator`, `server/lib`, `server/routes`, `tests/unit`, `tests/integration`, `.planning/phases/*-VERIFICATION.md`, `package.json`, `scripts/release-check.mjs`, `.codex/skills/*/SKILL.md`

**Files scanned:** 23 direct files plus phase context/research/project rules

**Project skills read:** `nutrition-verify-change`, `nutrition-gen-test`, `nutrition-new-harness-scenario`, `nutrition-harness-review`, `nutrition-security-review`, `nutrition-code-review`, `nutrition-railway-smoke`, `nutrition-milestone-closeout`

**Pattern extraction date:** 2026-05-29
