# Phase 67: Correction Targeting and Backend Clarification Rendering - Pattern Map

**Mapped:** 2026-05-29  
**Files analyzed:** 12  
**Analogs found:** 12 / 12

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `server/services/meal-correction.ts` | service | CRUD, request-response | `server/services/meal-correction.ts` | exact |
| `server/orchestrator/tools.ts` | service / tool contract | request-response, CRUD guard | `server/orchestrator/tools.ts` | exact |
| `server/orchestrator/index.ts` | orchestrator | request-response, tool-loop | `server/orchestrator/index.ts` | exact |
| `server/orchestrator/mutation-receipts.ts` | utility / renderer | transform | `server/orchestrator/mutation-receipts.ts` | exact |
| `server/orchestrator/system-prompt.ts` | config / prompt | transform | `server/orchestrator/system-prompt.ts` | exact |
| `server/routes/chat.ts` | route | request-response, publish boundary | `server/routes/chat.ts` | role-match |
| `tests/unit/meal-correction.test.ts` | test | CRUD, request-response | `tests/unit/meal-correction.test.ts` | exact |
| `tests/unit/tools.test.ts` | test | request-response, CRUD guard | `tests/unit/tools.test.ts` | exact |
| `tests/unit/orchestrator.test.ts` | test | request-response, tool-loop | `tests/unit/orchestrator.test.ts` | exact |
| `tests/unit/mutation-receipts.test.ts` | test | transform, renderer safety | `tests/unit/mutation-receipts.test.ts` | exact |
| `tests/unit/system-prompt.test.ts` | test | transform, prompt contract | `tests/unit/system-prompt.test.ts` | exact |
| `tests/integration/chat-meal-correction.integration.test.ts` | test | request-response, CRUD, publish boundary | `tests/integration/chat-meal-correction.integration.test.ts` | exact |

## Pattern Assignments

### `server/services/meal-correction.ts` (service, CRUD + request-response)

**Analog:** `server/services/meal-correction.ts`

**Imports and DI pattern** (lines 1-29):
```typescript
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import type { AppDatabase } from "../db/client.js";
import { mealRevisionItems, mealTransactions } from "../db/schema.js";
import { resolveHistoricalDateIntent } from "../lib/historical-date.js";
import { currentAppDate, formatLocalDate } from "../lib/time.js";
import { createTurnStateService } from "./turn-state.js";
import { projectMealDisplay } from "./meal-display.js";
import { normalizeMealPeriod, type MealPeriod } from "../lib/meal-period.js";
```

**Candidate data shape to preserve/extend** (lines 31-86):
```typescript
const PENDING_SELECTION_KIND = "meal_target_selection";
const PENDING_SELECTION_TTL_MS = 15 * 60 * 1000;

export interface MealCorrectionCandidate {
  mealId: string;
  mealRevisionId: string;
  foodName: string;
  itemCount: number;
  itemNames: string[];
  loggedAt: string;
  dateKey: string;
  mealPeriod: MealPeriod;
  mealPeriodSource: "explicit" | "inferred";
}

export interface PendingMealSelectionState {
  action: "update" | "delete";
  candidates: MealCorrectionCandidate[];
}
```

**Current scoring area to replace with evidence tiers** (lines 313-341):
```typescript
function scoreCandidate(
  candidate: MealCorrectionCandidate,
  query: string,
  targetDateKey: string | undefined,
  targetMealPeriod: MealCorrectionCandidate["mealPeriod"] | undefined,
): number {
  const normalizedQuery = normalizeText(extractTargetEvidenceText(query));
  let score = 0;

  if (targetDateKey) {
    if (candidate.dateKey !== targetDateKey) {
      return -1;
    }
    score += 4;
  }

  if (targetMealPeriod && candidate.mealPeriod === targetMealPeriod) {
    score += 2;
  }

  if (matchesCandidateLabel(candidate, normalizedQuery)) {
    score += 5;
  }

  return score;
}
```

**Candidate loading pattern with explicit/inferred period projection** (lines 382-432):
```typescript
async function loadActiveCandidates(deviceId: string, limit = 20): Promise<MealCorrectionCandidate[]> {
  const headers = await db
    .select({
      id: mealTransactions.id,
      loggedAt: mealTransactions.loggedAt,
      mealPeriod: mealTransactions.mealPeriod,
      currentRevisionId: mealTransactions.currentRevisionId,
    })
    .from(mealTransactions)
    .where(and(eq(mealTransactions.deviceId, deviceId), isNull(mealTransactions.deletedAt)))
    .orderBy(asc(mealTransactions.loggedAt));

  const explicitMealPeriod = normalizeMealPeriod(header.mealPeriod);
  return {
    mealId: header.id,
    mealRevisionId: header.currentRevisionId,
    foodName: display.foodName,
    itemNames: revisionItems.map((item) => item.foodName),
    dateKey: formatLocalDate(new Date(header.loggedAt)),
    mealPeriod: explicitMealPeriod ?? inferMealPeriod(header.loggedAt),
    mealPeriodSource: explicitMealPeriod ? "explicit" : "inferred",
  };
}
```

**Pending selection pattern to tighten around rendered options** (lines 449-526):
```typescript
async function tryResolvePendingSelection(
  deviceId: string,
  action: "update" | "delete",
  query: string,
): Promise<FindMealsResolvedResult | FindMealsClarificationResult | undefined> {
  const pending = await turnStateService.getState<PendingMealSelectionState>(deviceId, PENDING_SELECTION_KIND);
  if (!pending) return undefined;

  if (pending.action !== action) {
    await turnStateService.clearState(deviceId, PENDING_SELECTION_KIND);
    return undefined;
  }

  const index = extractSelectionIndex(query);
  if (index !== undefined) {
    const candidate = pending.candidates[index];
    if (!candidate) {
      return {
        status: "needs_clarification",
        action: pending.action,
        prompt: buildClarificationPrompt(pending.action, pending.candidates),
        candidates: pending.candidates,
      };
    }
    return {
      status: "resolved",
      action: pending.action,
      resolvedMealId: candidate.mealId,
      mealRevisionId: candidate.mealRevisionId,
      candidate,
      fromPending: true,
    };
  }
}
```

**Find-meals resolver flow to preserve while changing ranking** (lines 570-728):
```typescript
async findMeals(deviceId, action, query, options): Promise<FindMealsResult> {
  const pendingSelection = await tryResolvePendingSelection(deviceId, action, query);
  if (pendingSelection) return pendingSelection;

  const candidates = await loadActiveCandidates(deviceId);
  const dateResolution = resolveFindMealsTargetDateKey(query, action, options);
  if (dateResolution.status === "needs_clarification") {
    return { status: "needs_clarification", action, prompt: dateResolution.prompt, candidates: [] };
  }

  const targetDateKey = dateResolution.targetDateKey;
  const targetMealPeriod = extractMealPeriod(query);
  const normalizedQuery = normalizeText(extractTargetEvidenceText(query));

  let scored = candidates
    .map((candidate) => ({
      candidate,
      score: scoreCandidate(candidate, query, targetDateKey, targetMealPeriod),
      labelMatched: matchesCandidateLabel(candidate, normalizedQuery),
    }))
    .filter((entry) => entry.score >= 0)
    .sort((left, right) => right.score - left.score || right.candidate.loggedAt.localeCompare(left.candidate.loggedAt));

  const narrowed = top.slice(0, 5);
  await turnStateService.putState(deviceId, PENDING_SELECTION_KIND, { action, candidates: narrowed }, PENDING_SELECTION_TTL_MS);
  return { status: "needs_clarification", action, prompt: buildClarificationPrompt(action, narrowed), candidates: narrowed };
}
```

**Mutation stale precondition pattern** (lines 775-894):
```typescript
async updateMeal(deviceId, mealId, input, expectedMealRevisionId) {
  const currentItems = await mealTransactionsService.getCurrentItemsForMutation(
    deviceId,
    mealId,
    expectedMealRevisionId,
  );
  const updated = await mealTransactionsService.updateTransaction(deviceId, mealId, {
    expectedMealRevisionId,
    items: nextItems,
  });
  const summaryOutcome = await buildSummaryOutcomeAfterMealCommit({ deviceId, affectedDate: updated.affectedDateKey, summaryService, foodLoggingService });
  return { updatedMeal: { id: updated.transactionId, mealRevisionId: updated.revisionId }, summaryOutcome };
}

async deleteMeal(deviceId, mealId, expectedMealRevisionId) {
  const deleted = await mealTransactionsService.softDeleteTransaction(deviceId, mealId, expectedMealRevisionId);
  const summaryOutcome = await buildSummaryOutcomeAfterMealCommit({ deviceId, affectedDate: deleted.affectedDateKey, summaryService, foodLoggingService });
  return { deletedMealId: deleted.deletedMeal.mealId, summaryOutcome, deletedMeal: deleted.deletedMeal };
}
```

### `server/orchestrator/tools.ts` (tool contract, request-response + CRUD guard)

**Analog:** `server/orchestrator/tools.ts`

**Imports and controlled reply type pattern** (lines 1-17, 48-105):
```typescript
import { z } from "zod";
import type { ToolDefinition, ToolCall } from "../llm/types.js";
import type { createMealCorrectionService, FindMealsResult } from "../services/meal-correction.js";
import { MealRevisionPreconditionError } from "../services/meal-transactions.js";
import {
  renderMealNumericAuthorityFailureCopy,
  renderMealNumericClarificationCopy,
  renderMealNumericProposalCopy,
} from "./mutation-receipts.js";

export interface ToolExecutionResult {
  controlledReply?: {
    source: "renderer";
    reason:
      | "meal_numeric_authority_failure"
      | "meal_numeric_clarification"
      | "meal_numeric_proposal";
    text: string;
  };
}
```

**Find-meals contract pattern** (lines 1281-1330):
```typescript
const findMealsContract: ToolContract<FindMealsArgs, FindMealsResult> = {
  name: "find_meals",
  description: "解析要修改或刪除的歷史餐點目標，只能回傳資料庫候選或要求澄清。",
  zodSchema: findMealsSchema,
  execute: async (args, context) => {
    const deps = context.deps?.toolDeps as ToolDeps | undefined;
    const deviceId = context.deps?.deviceId as string | undefined;
    if (!deps?.mealCorrectionService || !deviceId) {
      throw new Error("find_meals contract missing mealCorrectionService/deviceId in context");
    }

    const result = await deps.mealCorrectionService.findMeals(deviceId, args.action, args.query.trim(), {
      currentDate: currentAppDate(),
      previousDateKey: extractPreviousHistoricalDateKey(context.previousAssistantMessage, currentDate),
    });
    if (deps.toolSessionState) {
      deps.toolSessionState.resolvedMealTargets = result.status === "resolved"
        ? [{ mealId: result.resolvedMealId, mealRevisionId: result.mealRevisionId }]
        : [];
    }
    return { ok: true, result, toolMessage: JSON.stringify(result) };
  },
};
```

**Update/delete resolver-owned target guard** (lines 1454-1518, 1639-1664):
```typescript
const resolvedTarget = findResolvedMealTarget(deps.toolSessionState, args.meal_id);
if (!resolvedTarget) {
  throw new FatalToolError("meal target unresolved");
}

try {
  updated = await deps.mealCorrectionService.updateMeal(
    deviceId,
    args.meal_id,
    serviceInput,
    resolvedTarget.mealRevisionId,
  );
} catch (error) {
  if (error instanceof MealRevisionPreconditionError) {
    throw revisionPreconditionFatalError(error);
  }
  throw error;
}

await deps.mealCorrectionService.clearPendingSelection(deviceId);
if (deps.toolSessionState) {
  deps.toolSessionState.resolvedMealTargets = [];
}
```

**Controlled reply mapping precedent to copy for `find_meals` ambiguity** (lines 2053-2075, 2160-2174):
```typescript
if (toolCall.function.name === "find_meals") {
  const contractResult = outcome.contractResult as FindMealsResult;
  return {
    result: outcome.result,
    summary: `status: ${contractResult.status}`,
  };
}

if (toolCall.function.name === "propose_meal_numeric_correction") {
  const contractResult = outcome.contractResult as ProposeMealNumericCorrectionResult;
  const isProposal = contractResult.reason === "meal_numeric_proposal";
  return {
    result: contractResult.reply,
    summary: isProposal ? "status: proposal" : "failureReason: guard",
    success: isProposal,
    executed: isProposal,
    ...(isProposal ? {} : { failureReason: "guard" as const }),
    controlledReply: {
      source: "renderer",
      reason: contractResult.reason,
      text: contractResult.reply,
    },
  };
}
```

### `server/orchestrator/index.ts` (orchestrator, tool-loop)

**Analog:** `server/orchestrator/index.ts`

**Imports pattern** (lines 1-24, 34-45):
```typescript
import type { createMealCorrectionService } from "../services/meal-correction.js";
import { MealRevisionPreconditionError } from "../services/meal-transactions.js";
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

**Current anti-pattern to remove/avoid: raw user target label rendering** (lines 397-427):
```typescript
function extractUserCorrectionTarget(userMessage: string): string {
  const targetSide = userMessage.match(/^(.*?)(?:改成|改為|改到|變成|換成|調成)/)?.[1] ?? userMessage;
  return targetSide.replace(/^(?:請|麻煩|幫我)?把?/, "").replace(/(?:的)?$/, "").trim();
}

function buildCorrectionClarificationReply(result: CorrectionToolResult, userMessage: string): string | undefined {
  const verb = result.action === "update" ? "修改" : "刪除";
  const userTarget = extractUserCorrectionTarget(userMessage);
  const targetLabel = userTarget ? `「${userTarget}」` : "這筆餐點";
  if (result.status === "needs_clarification" && candidates.length > 0) {
    return `我找到多筆可能要${verb}的${targetLabel}，請直接回覆編號：\n${lines.join("\n")}`;
  }
}
```

**Controlled reply terminal short-circuit pattern** (lines 1103-1150):
```typescript
const {
  result,
  summary,
  success,
  failureReason,
  controlledReply,
} = await executeTool(toolCall, deviceId, toolDeps, {
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

### `server/orchestrator/mutation-receipts.ts` (renderer utility, transform)

**Analog:** `server/orchestrator/mutation-receipts.ts`

**Forbidden implementation-copy guard** (lines 9-43):
```typescript
export const FORBIDDEN_RECEIPT_TERMS = [
  "log_food",
  "update_meal",
  "delete_meal",
  "revision",
  "deviceId",
  "mealMutationKind",
  "summaryOutcome",
  "dailySummary",
] as const;

export function assertNoForbiddenReceiptTerms(text: string): string[] {
  return FORBIDDEN_RECEIPT_TERMS.filter((term) => text.includes(term));
}
```

**Renderer-owned proposal/failure copy style** (lines 121-156):
```typescript
export function renderMealNumericProposalCopy(input: MealNumericProposalCopyInput): string {
  const mealLabel = formatMealProposalLabel(input);
  const fieldLines = input.affectedFields.map((field) => `• ${formatAffectedMealNumericField(field)}`);
  return [
    `我可以幫你把${mealLabel}這樣調整：`,
    ...fieldLines,
    "如果要套用，請回覆「好」；如果要調整，請直接給新的目標數字。",
  ].join("\n");
}

export function renderMealNumericAuthorityFailureCopy(input: MealNumericFieldAwareCopyInput = {}): string {
  const fieldText = input.field
    ? `${mealNumericFieldLabel(input.field)}需要明確目標數字，或改用「減半」、「少 20%」這類可計算調整。`
    : "請提供明確目標數字，或改用「減半」、「少 20%」這類可計算調整。";
  return `這次沒有更新餐點紀錄。${fieldText}`;
}
```

**Mutation receipt pattern not to use for clarification** (lines 229-242):
```typescript
export function renderMutationReceipt(effects: MutationEffects): string {
  switch (effects.kind) {
    case "update":
      return `已更新${datePrefix}${effects.meal.foodName}，${formatNumber(effects.meal.calories)} kcal，蛋白質 ${formatNumber(effects.meal.protein)} g。`;
    case "delete":
      return `已刪除${datePrefix}${effects.deletedMeal.foodName}，已從當日紀錄移除。`;
  }
}
```

### `server/orchestrator/system-prompt.ts` (prompt config, transform)

**Analog:** `server/orchestrator/system-prompt.ts`

**Meal correction prompt support pattern** (lines 180-194):
```typescript
sections.push({
  id: SYSTEM_PROMPT_SECTION_IDS.mealCorrections,
  content: `歷史餐點修正規則：
1. 當使用者要修改或刪除舊餐點時，先解析目標餐點，再決定是否執行 mutation；不要把修正需求當成新的 log_food。
2. 修改或刪除歷史餐點前，必須先呼叫 find_meals。只有當 find_meals 已解析出唯一目標時，才可以呼叫 update_meal 或 delete_meal。
3. 如果 find_meals 回傳多筆候選或找不到目標，就用簡短繁體中文向使用者追問澄清；這一輪不要更新或刪除任何餐點。
11. 呼叫 find_meals 時，find_meals.query 必須保留使用者原本列出的 grouped 餐點名稱與 item 名稱，例如「雞腿、白飯、滷蛋、青菜」和「滷蛋」要原樣放進 query；不要把它們改寫成「中午雞腿便當」這類口語集合名稱。
12. 成功修改歷史餐點時，要明確表示是更新原本那筆紀錄，不是新增一筆。成功刪除時，要明確表示已刪除原本那筆餐點。`,
});
```

### `server/routes/chat.ts` (route, response + publish boundary)

**Analog:** `server/routes/chat.ts`

**Route dependency and guest-session pattern** (lines 1-40):
```typescript
import type { FastifyInstance, FastifyRequest, FastifyBaseLogger } from "fastify";
import type { createOrchestrator } from "../orchestrator/index.js";
import type { RealtimePublisher } from "../realtime/publisher.js";
import { CHOICE_PROMPT_PATTERN } from "../orchestrator/patterns.js";
import { createStructuredHooks } from "../orchestrator/hooks.js";
import { resolveGuestSession } from "../lib/guest-session-resolver.js";
```

**JSON response and publish boundary pattern** (lines 1399-1452):
```typescript
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

publishSummarySafe(publisher, deviceId, jsonDidMutateMeal, dailySummary, affectedDate, turnLog);
return {
  turnId,
  reply: sanitizedJson,
  didLogMeal,
  ...(result.didMutateMeal !== undefined ? { didMutateMeal: result.didMutateMeal } : {}),
  ...(dailySummary ? { dailySummary } : {}),
  ...(jsonSummaryOutcome ? { summaryOutcome: jsonSummaryOutcome } : {}),
  ...(affectedDate ? { affectedDate } : {}),
};
```

## Test Pattern Assignments

### `tests/unit/meal-correction.test.ts` (unit test, service CRUD + resolver)

**Analog:** `tests/unit/meal-correction.test.ts`

**Imports and fixed timezone/date fixture** (lines 1-69):
```typescript
process.env.TZ = "Asia/Taipei";

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../../server/db/client.js";
import { createDeviceService } from "../../server/services/device.js";
import { createFoodLoggingService } from "../../server/services/food-logging.js";
import { createMealCorrectionService } from "../../server/services/meal-correction.js";

beforeEach(async () => {
  globalThis.Date = FixedDate as DateConstructor;
  db = createDb(":memory:");
  const deviceService = createDeviceService(db);
  foodLoggingService = createFoodLoggingService(db);
  mealCorrectionService = createMealCorrectionService(db);
  deviceId = (await deviceService.createDevice("fat_loss")).deviceId;
});
```

**Label/item and no-fallback tests** (lines 270-319):
```typescript
const grouped = await foodLoggingService.logGroupedMeal(deviceId, {
  loggedAt: "2026-04-19T09:30:00.000Z",
  items: [
    { foodName: "雞腿", calories: 260, protein: 24, carbs: 0, fat: 12 },
    { foodName: "白飯", calories: 280, protein: 4, carbs: 62, fat: 0.5 },
    { foodName: "滷蛋", calories: 90, protein: 7, carbs: 2, fat: 6 },
  ],
});

const itemOnly = await mealCorrectionService.findMeals(deviceId, "update", "滷蛋改成兩顆水煮蛋");
assert.equal(itemOnly.status, "resolved");
assert.equal(itemOnly.resolvedMealId, grouped.id);

const result = await mealCorrectionService.findMeals(deviceId, "update", "把中午鴨腿便當改成 500 卡");
assert.equal(result.status, "needs_clarification");
assert.match(result.prompt, /補充日期、餐別或食物名稱|不能確定/);
```

**Meal-period source tests** (lines 345-378):
```typescript
const lunch = await foodLoggingService.logGroupedMeal(deviceId, {
  loggedAt: "2026-04-19T00:30:00.000Z",
  mealPeriod: "lunch",
  items: [{ foodName: "雞腿便當", calories: 680, protein: 32, carbs: 84, fat: 22 }],
});

const result = await mealCorrectionService.findMeals(deviceId, "update", "把午餐那餐改成 600 卡");
assert.equal(result.status, "resolved");
assert.equal(result.resolvedMealId, lunch.id);
assert.equal(result.candidate.mealPeriod, "lunch");
assert.equal(result.candidate.mealPeriodSource, "explicit");
```

**Pending selection and action mismatch tests** (lines 526-584):
```typescript
const firstPass = await mealCorrectionService.findMeals(deviceId, "delete", "把今天午餐的雞腿飯刪掉");
assert.equal(firstPass.status, "needs_clarification");
assert.equal(firstPass.candidates.length, 2);
assert.match(firstPass.prompt, /請直接回覆編號/);

const secondPass = await mealCorrectionService.findMeals(deviceId, "delete", "第二個");
assert.equal(secondPass.status, "resolved");
assert.equal(secondPass.action, "delete");
assert.equal(secondPass.fromPending, true);

const staleAction = await mealCorrectionService.findMeals(deviceId, "update", "第二個");
assert.notEqual(staleAction.status, "resolved");
```

**Stale revision service proof** (lines 720-790):
```typescript
await assert.rejects(
  () => mealCorrectionService.updateMeal(deviceId, meal.id, { patch: { calories: 420 } }, meal.mealRevisionId),
  (error) => {
    assert.ok(error instanceof MealRevisionPreconditionError);
    assert.equal(error.code, "MEAL_REVISION_STALE");
    assert.equal(error.mealId, meal.id);
    assert.equal(error.currentMealRevisionId, `${meal.id}:r2`);
    return true;
  },
);
```

### `tests/unit/tools.test.ts` (unit test, tool contract)

**Analog:** `tests/unit/tools.test.ts`

**Imports and tool execution pattern** (lines 1-23):
```typescript
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../../server/db/client.js";
import { createMealCorrectionService } from "../../server/services/meal-correction.js";
import {
  executeTool,
  getToolDefinitions,
  toolRegistry,
  type ToolDeps,
} from "../../server/orchestrator/tools.js";
import type { ToolCall } from "../../server/llm/types.js";
```

**Resolver-owned id/revision proof** (lines 1240-1278):
```typescript
const toolSessionState = {
  resolvedMealTargets: [] as Array<{ mealId: string; mealRevisionId: string }>,
};

const result = await executeTool(call, deviceId, {
  foodLoggingService,
  summaryService,
  mealCorrectionService,
  toolSessionState,
} as unknown as ToolDeps);

assert.equal(result.summary, "status: resolved");
assert.deepEqual(toolSessionState.resolvedMealTargets, [{
  mealId: created.id,
  mealRevisionId: created.mealRevisionId,
}]);
```

**Stale update/delete fail-closed proof** (lines 1372-1479):
```typescript
const staleUpdate = await executeTool(updateCall, deviceId, {
  foodLoggingService,
  summaryService,
  mealCorrectionService,
  toolSessionState: {
    resolvedMealTargets: [{ mealId: updateTarget.id, mealRevisionId: updateTarget.mealRevisionId }],
  },
});

assert.equal(staleUpdate.success, false);
assert.equal(staleUpdate.executed, false);
assert.match(staleUpdate.result, /MEAL_REVISION_STALE/);
assert.equal(staleUpdate.mealMutationKind, undefined);
assert.equal(staleUpdate.summaryOutcome, undefined);
```

**Controlled reply and no-write numeric guard proof** (lines 1930-1960):
```typescript
const result = await executeTool(call, deviceId, {
  mealCorrectionService: {
    ...mealCorrectionService,
    async updateMeal(...args) {
      updateCalls += 1;
      return mealCorrectionService.updateMeal(...args);
    },
  },
  toolSessionState: {
    resolvedMealTargets: [{ mealId: created.id, mealRevisionId: created.mealRevisionId }],
  },
} as ToolDeps, {
  currentUserMessage: "蛋白質怪怪的，幫我改合理一點",
});

assert.equal(result.success, false);
assert.equal(result.executed, false);
assert.equal(result.failureReason, "guard");
assert.deepEqual(result.controlledReply, {
  source: "renderer",
  reason: "meal_numeric_authority_failure",
  text: renderMealNumericAuthorityFailureCopy({ field: "protein" }),
});
assert.equal(updateCalls, 0);
assert.equal(result.summaryOutcome, undefined);
```

### `tests/unit/orchestrator.test.ts` (unit test, orchestrator)

**Analog:** `tests/unit/orchestrator.test.ts`

**Imports and fixture pattern** (lines 1-23, 325-369):
```typescript
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../../server/db/client.js";
import { MockLLMProvider } from "../../server/llm/mock.js";
import { createOrchestrator, guardNoMutationLoggingClaim } from "../../server/orchestrator/index.js";
import { renderGoalAuthorityFailureCopy } from "../../server/orchestrator/mutation-receipts.js";

beforeEach(async () => {
  const db = createDb(":memory:");
  deviceService = createDeviceService(db);
  foodLoggingService = createFoodLoggingService(db);
  mealCorrectionService = createMealCorrectionService(db);
  mockLLM = new MockLLMProvider();
  orchestrator = createOrchestrator({
    llmProvider: mockLLM,
    chatService,
    summaryService,
    foodLoggingService,
    mealCorrectionService,
    deviceService,
  });
});
```

**Existing clarification copy test to update from model-driven to renderer-owned** (lines 1095-1156):
```typescript
localLLM.queueChatResponse({
  toolCalls: [{
    id: "find_ambiguous_grouped_item",
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
localLLM.queueChatResponse({ content: "你是要修改中午雞腿便當嗎？" });

const result = await orchestrator.handleMessage(localDeviceId, "滷蛋改成兩顆水煮蛋");

assert.equal(result.didMutateMeal, false);
assert.match(result.reply, /滷蛋/);
assert.match(result.reply, /雞腿、白飯、滷蛋、青菜/);
assert.doesNotMatch(result.reply, /中午雞腿便當/);
```

**No-mutation false-success guard pattern** (lines 1462-1471):
```typescript
mockLLM.queueChatResponse({ content: "已記錄牛肉飯，650 kcal，蛋白質 28 g。" });

const result = await orchestrator.handleMessage(deviceId, "你好");

assert.ok("reply" in result);
assert.equal(result.didLogMeal, false);
assert.equal(result.didMutateMeal, false);
assert.doesNotMatch(result.reply, /已記錄|完成記錄/);
assert.match(result.reply, /尚未|沒有|無法|補充/);
```

**Controlled reply no-second-round proof** (lines 1940-1955):
```typescript
mockLLM.queueChatResponse({
  toolCalls: [{ function: { name: "update_goals", arguments: JSON.stringify({ calories: 1800 }) } }],
});
mockLLM.queueChatResponse({ content: "模型後續改寫：已經幫你更新每日目標。" });

const result = await orchestrator.handleMessage(deviceId, "卡路里 1800");

assert.equal(result.reply, renderGoalAuthorityFailureCopy());
assert.equal(result.finalReplySource, "renderer");
assert.equal(result.finalReplyShape, "plain_text");
assert.equal(mockLLM.chatCalls.length, 1);
```

### `tests/unit/mutation-receipts.test.ts` (unit test, renderer transform)

**Analog:** `tests/unit/mutation-receipts.test.ts`

**Imports and forbidden-term assertion pattern** (lines 1-67):
```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FORBIDDEN_RECEIPT_TERMS,
  assertNoForbiddenReceiptTerms,
  renderMealNumericAuthorityFailureCopy,
  renderMealNumericClarificationCopy,
  renderMealNumericProposalCopy,
} from "../../server/orchestrator/mutation-receipts.js";

function assertNoMealNumericInternalTerms(text: string) {
  const leaked = MEAL_NUMERIC_INTERNAL_TERMS.filter((term) => text.includes(term));
  assert.deepEqual(leaked, []);
  assert.deepEqual(assertNoForbiddenReceiptTerms(text), []);
}
```

**Apply to Plan 67-03:** add correction-target renderer helper tests beside existing mutation receipt tests. Use the same Node `node:test` and `node:assert/strict` pattern, assert exact Traditional Chinese copy when stable, and keep explicit forbidden-term checks for tool names, revision internals, `summaryOutcome`, `dailySummary`, calories/macros, inferred-period labels, and raw correction echo. The test should import exported helpers from `server/orchestrator/mutation-receipts.ts`, not duplicate renderer logic in the test.

### `tests/unit/system-prompt.test.ts` (unit test, prompt transform)

**Analog:** `tests/unit/system-prompt.test.ts`

**Section extraction and prompt assertion pattern** (lines 1-20):
```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ACTIVE_SYSTEM_PROMPT_VERSION,
  SYSTEM_PROMPT_SECTION_IDS,
  buildSystemPrompt,
} from "../../server/orchestrator/system-prompt.js";

function mealCorrectionSection(prompt: string): string {
  const match = /歷史餐點修正規則：[\s\S]*?(?=\n\n歷史日期規則：)/.exec(prompt);
  assert.ok(match, "meal correction section must be present");
  return match[0];
}
```

**Legacy snapshot normalization pattern** (lines 21-55):
```typescript
const LEGACY_MEAL_CORRECTION_SECTION = `歷史餐點修正規則：
1. 當使用者要修改或刪除舊餐點時，先解析目標餐點，再決定是否執行 mutation；不要把修正需求當成新的 log_food。
2. 修改或刪除歷史餐點前，必須先呼叫 find_meals。只有當 find_meals 已解析出唯一目標時，才可以呼叫 update_meal 或 delete_meal。
...`;

function normalizeSectionsForLegacySnapshot(prompt: string): string {
  return prompt
    .replace(goalUpdateSection(prompt), LEGACY_GOAL_UPDATE_SECTION)
    .replace(mealCorrectionSection(prompt), LEGACY_MEAL_CORRECTION_SECTION);
}
```

**Apply to Plan 67-04:** keep byte-for-byte legacy snapshot tests maintainable by updating `LEGACY_MEAL_CORRECTION_SECTION` only when the production prompt section intentionally changes. Add focused assertions against `mealCorrectionSection(prompt)` for support-only guidance: call `find_meals` before update/delete, preserve user food/item/date/period words in `find_meals.query`, never choose from candidate lists, never rewrite backend-rendered clarification, and keep Phase 66 vague numeric authority guidance intact. Do not call external LLMs from this test.

### `tests/integration/chat-meal-correction.integration.test.ts` (integration test, route + real SQLite)

**Analog:** `tests/integration/chat-meal-correction.integration.test.ts`

**Fastify app + MockLLM fixture pattern** (lines 1-87):
```typescript
process.env.TZ = "Asia/Taipei";

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import type { FastifyInstance } from "fastify";
import { buildApp, type AppServices } from "../../server/app.js";
import { MockLLMProvider } from "../../server/llm/mock.js";

beforeEach(async () => {
  globalThis.Date = FixedDate as DateConstructor;
  mockLLM = new MockLLMProvider();
  publishDailySummaryCalls = [];
  app = await buildApp({
    dbPath: ":memory:",
    llmProvider: mockLLM,
    onServicesReady: (ready) => {
      ready.publisher.publishDailySummary = (...args) => {
        publishDailySummaryCalls.push(args);
        return originalPublishDailySummary(...args);
      };
      services = ready;
    },
  });
});
```

**Ambiguity no-mutation route proof** (lines 616-660):
```typescript
mockLLM.queueChatResponse({
  toolCalls: [{
    id: "find_ambiguous_meal",
    type: "function",
    function: {
      name: "find_meals",
      arguments: JSON.stringify({ action: "delete", query: "把今天午餐的雞腿飯刪掉" }),
    },
  }],
});
mockLLM.queueChatResponse({ content: "我找到多筆今天的雞腿飯，請直接回覆編號。" });

const { status, body } = await postChat("把今天的雞腿飯刪掉");

assert.equal(status, 200);
assert.equal(body.didLogMeal, false);
assert.equal(body.didMutateMeal, false);
assert.match(body.reply, /多筆|回覆編號/);
assert.equal((await getMeals()).length, 2);
```

**Grouped clarification no raw echo proof** (lines 950-990):
```typescript
mockLLM.queueChatResponse({
  toolCalls: [{
    id: "find_ambiguous_grouped_item",
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
mockLLM.queueChatResponse({ content: "你是要修改中午雞腿便當嗎？" });

const { status, body } = await postChat("滷蛋改成兩顆水煮蛋");
assert.equal(status, 200);
assert.equal(body.didLogMeal, false);
assert.equal(body.didMutateMeal, false);
assert.match(body.reply, /滷蛋/);
```

**Pending selection follow-up mutation proof** (lines 1000-1069):
```typescript
const firstTurn = await postChat("把今天午餐的雞腿飯刪掉");
assert.equal(firstTurn.status, 200);

mockLLM.queueChatResponse({
  toolCalls: [{
    id: "find_pending_choice",
    type: "function",
    function: { name: "find_meals", arguments: JSON.stringify({ action: "delete", query: "第二個" }) },
  }],
});
mockLLM.queueChatResponse({
  toolCalls: [{
    id: "delete_selected_meal",
    type: "function",
    function: { name: "delete_meal", arguments: JSON.stringify({ meal_id: first.id }) },
  }],
});

const { status, body } = await postChat("第二個");
assert.equal(status, 200);
assert.equal(body.didLogMeal, false);
assert.equal(body.didMutateMeal, true);
assert.match(body.reply, /已刪除雞腿飯，已從當日紀錄移除。/);
```

**Stale/no-publish fail-closed proof** (lines 1131-1218):
```typescript
services.publisher.publishDailySummary = (...args) => {
  publishCalls.push(args);
  return { sent: 0 };
};

mockLLM.queueChatResponse({
  toolCalls: [{
    id: "apply_stale_update",
    type: "function",
    function: { name: "update_meal", arguments: JSON.stringify({ meal_id: original.id, protein: 22 }) },
  }],
});
mockLLM.queueChatResponse({
  content: "這筆餐點已經有較新的紀錄，請重新整理後再修改。",
});

const staleTurn = await postChat("改成 22g");
assert.equal(staleTurn.body.didMutateMeal, false);
assert.equal(Object.prototype.hasOwnProperty.call(staleTurn.body, "summaryOutcome"), false);
assert.doesNotMatch(staleTurn.body.reply, /已更新/);
assert.deepEqual(publishCalls, []);
```

## Shared Patterns

### Backend-Owned Resolver Authority

**Source:** `server/orchestrator/tools.ts` lines 1307-1324 and 1461-1503  
**Apply to:** `server/services/meal-correction.ts`, `server/orchestrator/tools.ts`, `tests/unit/tools.test.ts`, integration tests

Keep the `find_meals -> toolSessionState.resolvedMealTargets -> update/delete` chain. Mutators must use resolver-owned `mealId` plus `mealRevisionId`; never trust model-selected target ids or same-label retargeting.

### Renderer-Owned Terminal Output

**Source:** `server/orchestrator/index.ts` lines 1133-1150 and `server/orchestrator/tools.ts` lines 2160-2174  
**Apply to:** `find_meals` clarification/not-found/invalid-selection/stale-recovery paths

Correction clarification should become a `controlledReply` with `source: "renderer"` so the loop returns immediately and `mockLLM.chatCalls.length` proves no second model rewrite.

### Safe Copy and Forbidden Terms

**Source:** `server/orchestrator/mutation-receipts.ts` lines 9-43 and 121-156  
**Apply to:** correction clarification renderer helpers, `tests/unit/mutation-receipts.test.ts`, and orchestrator/integration assertions

Renderer copy should not include tool names, revision ids, `summaryOutcome`, `dailySummary`, or success-style update/delete wording on unresolved/stale paths. Reuse the local renderer-helper style: small pure functions, Traditional Chinese strings, deterministic lists joined with `\n`.

### Real SQLite Tests with TZ Guard

**Source:** `tests/unit/meal-correction.test.ts` lines 1-69 and `tests/integration/chat-meal-correction.integration.test.ts` lines 1-87  
**Apply to:** all Phase 67 tests, including `tests/unit/mutation-receipts.test.ts` and `tests/unit/system-prompt.test.ts`

Use Node `node:test`, `node:assert/strict`, `createDb(":memory:")`, `MockLLMProvider`, `buildApp()`, and `process.env.TZ = "Asia/Taipei"`. Do not introduce Jest/Vitest or DB mocks.

### Publish Boundary

**Source:** `server/routes/chat.ts` lines 1399-1452 and `tests/integration/chat-meal-correction.integration.test.ts` lines 1131-1218  
**Apply to:** unresolved clarification, invalid number, stale/deleted selection failure

No unresolved/stale correction path should set `didMutateMeal: true`, expose `summaryOutcome`, or call `publishDailySummary`. Integration tests should spy on `services.publisher.publishDailySummary` and assert no calls.

## No Analog Found

All expected Phase 67 files have close existing analogs. No new package, framework, route family, or harness shape is required.

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| none | — | — | Existing service/orchestrator/test surfaces cover the phase. |

## Metadata

**Analog search scope:** `server/services`, `server/orchestrator`, `server/routes`, `tests/unit`, `tests/integration`, repo-local `.codex/skills`  
**Files scanned:** 10 target files plus 8 repo-local skill indexes  
**Pattern extraction date:** 2026-05-29
