# Phase 66: Numeric Correction Provenance Guard - Pattern Map

**Mapped:** 2026-05-28
**Files analyzed:** 21
**Analogs found:** 21 / 21

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `server/orchestrator/meal-numeric-authority.ts` | utility | transform + request-response guard | `server/orchestrator/source-text-guard.ts` | role-match |
| `server/services/meal-numeric-proposals.ts` | service | CRUD + TTL state | `server/services/goal-proposals.ts` | exact |
| `server/orchestrator/source-text-guard.ts` | utility | transform | `server/orchestrator/source-text-guard.ts` | exact |
| `server/orchestrator/tool-contract.ts` | utility | request-response validation | `server/orchestrator/tool-contract.ts` | exact |
| `server/orchestrator/tools.ts` | controller/service adapter | request-response + CRUD | `server/orchestrator/tools.ts` | exact |
| `server/orchestrator/index.ts` | controller/orchestrator | request-response + event-driven short-circuit | `server/orchestrator/index.ts` | exact |
| `server/orchestrator/mutation-receipts.ts` | utility/renderer | transform | `server/orchestrator/mutation-receipts.ts` | exact |
| `server/orchestrator/system-prompt.ts` | config | transform | `server/orchestrator/system-prompt.ts` | exact |
| `server/services/meal-correction.ts` | service | CRUD | `server/services/meal-correction.ts` | exact |
| `server/app.ts` | config/composition root | dependency wiring | `server/app.ts` | exact |
| `tests/unit/meal-numeric-authority.test.ts` | test | transform proof | `tests/unit/source-text-guard.test.ts` | role-match |
| `tests/unit/meal-numeric-proposals.test.ts` | test | CRUD + TTL state proof | `tests/unit/goal-proposals.test.ts` | exact |
| `tests/unit/source-text-guard.test.ts` | test | transform proof | `tests/unit/source-text-guard.test.ts` | exact |
| `tests/unit/tool-contract.test.ts` | test | validation/guard proof | `tests/unit/tool-contract.test.ts` | exact |
| `tests/unit/tools.test.ts` | test | tool request-response proof | `tests/unit/tools.test.ts` | exact |
| `tests/unit/orchestrator.test.ts` | test | controlled reply/event loop proof | `tests/unit/orchestrator.test.ts` | exact |
| `tests/unit/mutation-receipts.test.ts` | test | renderer proof | `tests/unit/mutation-receipts.test.ts` | exact |
| `tests/unit/system-prompt.test.ts` | test | prompt contract proof | `tests/unit/system-prompt.test.ts` | exact |
| `tests/unit/meal-correction.test.ts` | test | service CRUD/revision proof | `tests/unit/meal-correction.test.ts` | exact |
| `tests/integration/chat-meal-correction.integration.test.ts` | test | HTTP request-response + DB proof | `tests/integration/chat-meal-correction.integration.test.ts` | exact |
| `tests/integration/chat-streaming.test.ts` | test | SSE streaming proof | `tests/integration/chat-streaming.test.ts` | role-match |

## Pattern Assignments

### `server/services/meal-numeric-proposals.ts` (service, CRUD + TTL state)

**Analog:** `server/services/goal-proposals.ts`

**Imports and constants pattern** (lines 1-6):

```typescript
import type { AppDatabase } from "../db/client.js";
import type { DailyTargets } from "./device.js";
import { createTurnStateService } from "./turn-state.js";

export const GOAL_PROPOSAL_KIND = "goal_proposal";
export const GOAL_PROPOSAL_TTL_MS = 30 * 60 * 1000;
```

**Payload and service wrapper pattern** (lines 8-42):

```typescript
export interface GoalProposalPayload {
  proposalId: string;
  targets: DailyTargets;
  createdAt: string;
}

export function createGoalProposalService(db: AppDatabase) {
  const turnStateService = createTurnStateService(db);

  return {
    async putLatest(deviceId: string, targets: DailyTargets): Promise<GoalProposalPayload> {
      const proposal: GoalProposalPayload = {
        proposalId: crypto.randomUUID(),
        targets: { ...targets },
        createdAt: new Date().toISOString(),
      };

      await turnStateService.putState(deviceId, GOAL_PROPOSAL_KIND, proposal, GOAL_PROPOSAL_TTL_MS);
      return proposal;
    },

    async getLatest(deviceId: string): Promise<GoalProposalPayload | undefined> {
      return turnStateService.getState<GoalProposalPayload>(deviceId, GOAL_PROPOSAL_KIND);
    },

    async clear(deviceId: string): Promise<void> {
      await turnStateService.clearState(deviceId, GOAL_PROPOSAL_KIND);
    },
  };
}
```

**Copy this shape:** new meal proposal payload should add `mealId`, `expectedMealRevisionId`, backend-computed patch or `items`, affected fields, operator, `createdAt`, and expiry-compatible state. Use a distinct kind such as `meal_numeric_correction_proposal`.

### `server/orchestrator/meal-numeric-authority.ts` (utility, transform + guard)

**Analogs:** `server/orchestrator/source-text-guard.ts`, `server/services/meal-correction.ts`

**Consent/cancel vocabulary pattern** from `source-text-guard.ts` (lines 46-68):

```typescript
const GOAL_PROPOSAL_CONSENT_PATTERNS = [
  /^(好|可以|幫我更新|就這樣|用這組|ok|okay|yes|y|sure)(?:$|[，,。!！、]|但)/i,
] as const;
const GOAL_PROPOSAL_CANCEL_PATTERNS = [
  /^(不要|取消|先不用|不用|不好|不可以|不行|不是|不對|no|nope|not)$/i,
  /^(先)?不要/,
] as const;

export function isGoalProposalCancel(message: string): boolean {
  const normalized = normalizeGoalProposalDecisionText(message);
  return normalized.length > 0
    && GOAL_PROPOSAL_CANCEL_PATTERNS.some((pattern) => pattern.test(normalized));
}
```

**Numeric candidate normalization pattern** from `source-text-guard.ts` (lines 255-285):

```typescript
export function normalizeNumericSourceText(text: string): string[] {
  const stripped = stripFormatting(text);
  const candidates = new Set<string>();

  const digitRe = /\d+/g;
  let match: RegExpExecArray | null;
  while ((match = digitRe.exec(stripped)) !== null) {
    const end = match.index + match[0].length;
    const nextCh = stripped[end];
    if (nextCh === APPROX_SUFFIX) continue;
    candidates.add(match[0].replace(/^0+/, "") || "0");
  }

  return [...candidates];
}
```

**Grouped meal numeric distribution pattern** from `meal-correction.ts` (lines 218-277):

```typescript
function distributePatchedTotal(items: MealTransactionItemInput[], field: NumericItemField, targetTotal: number) {
  if (items.length === 1) {
    return [{ ...items[0]!, [field]: targetTotal }];
  }

  const currentTotal = items.reduce((sum, item) => sum + item[field], 0);
  let remaining = targetTotal;

  return items.map((item, index) => {
    if (index === items.length - 1) return { ...item, [field]: roundPatchValue(remaining) };
    const nextValue = currentTotal > 0
      ? roundPatchValue(targetTotal * (item[field] / currentTotal))
      : roundPatchValue(targetTotal / items.length);
    remaining -= nextValue;
    return { ...item, [field]: nextValue };
  });
}
```

**Apply this to:** direct current-turn explicit numeric authorization, nested `items[]` numeric diff checks, and deterministic half/percent/add/subtract proposal computation. Do not use the previous-assistant authorization branch for meal direct mutations.

### `server/orchestrator/source-text-guard.ts` (utility, transform)

**Analog:** same file.

**Current guard behavior to preserve for goal targets** (lines 293-328):

```typescript
export function checkSourceFields(
  args: Record<string, unknown>,
  sourceFields: readonly string[],
  context: SourceGuardContext,
): SourceGuardResult {
  const userCandidates = normalizeNumericSourceText(context.currentUserMessage ?? "");
  const assistantCandidates = context.previousAssistantMessage
    ? normalizeNumericSourceText(context.previousAssistantMessage)
    : [];
  const userAllowed = new Set<string>(userCandidates);
  const assistantAllowed = new Set<string>(assistantCandidates);
  const confirmedAssistantRecommendation = hasExplicitConfirmation(context.currentUserMessage ?? "");

  const guardedFields: string[] = [];
  for (const field of sourceFields) {
    const value = args[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      guardedFields.push(field);
      continue;
    }
    const key = String(value);
    if (userAllowed.has(key)) continue;
    if (assistantAllowed.has(key) && confirmedAssistantRecommendation) continue;
    guardedFields.push(field);
  }

  return { ok: guardedFields.length === 0, guardedFields };
}
```

**Phase 66 adjustment:** extend numeric normalization for decimals and accepted bare Chinese digits, but either add meal-specific "current user only" helper or keep previous-assistant allowance out of meal authority.

### `server/orchestrator/tool-contract.ts` (utility, request-response validation)

**Analog:** same file.

**Contract definition pattern** (lines 7-33):

```typescript
export interface ToolContract<Args = unknown, Result = unknown> {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  zodSchema: ZodType<Args>;
  sourceFields?: readonly (keyof Args)[];
  execute: (
    args: Args,
    context: RunContractContext,
  ) => Promise<{ ok: true; result: Result; toolMessage: string }>;
  logSummary: (args: Args) => Record<string, unknown>;
}
```

**Controlled validation/guard pattern** (lines 152-177):

```typescript
if (contract.sourceFields && contract.sourceFields.length > 0) {
  const { checkSourceFields } = await import("./source-text-guard.js");
  const guardResult = checkSourceFields(args as Record<string, unknown>, contract.sourceFields as readonly string[], {
    currentUserMessage: context.currentUserMessage,
    previousAssistantMessage: context.previousAssistantMessage,
  });
  if (!guardResult.ok) {
    return {
      success: false,
      executed: false,
      failureReason: "guard",
      result: stringifyFailure({ reason: "source_text_guard", failureReason: "guard", guardedFields: guardResult.guardedFields }),
      logSummary: contract.logSummary(args),
    };
  }
}
```

**Phase 66 fit:** generic `sourceFields` is not enough for `items[]`; add a meal-specific contract hook only if it keeps nested numeric authorization controlled and redacted. Keep parse/Zod/fatal error behavior unchanged.

### `server/orchestrator/tools.ts` (tool adapter, request-response + CRUD)

**Analog:** same file.

**Imports and dependency injection pattern** (lines 1-42, 57-70):

```typescript
import { z } from "zod";
import type { createMealCorrectionService, FindMealsResult } from "../services/meal-correction.js";
import { MealRevisionPreconditionError } from "../services/meal-transactions.js";
import type { createGoalProposalService } from "../services/goal-proposals.js";
import { runContract, summarizeContractArgsForLog, type ToolContract, type RunContractContext } from "./tool-contract.js";
import { checkSourceFields, isGoalProposalCancel, isGoalProposalConsent } from "./source-text-guard.js";
import { renderGoalAuthorityFailureCopy, renderGoalCancelCopy, renderGoalProposalCopy, renderGoalValidationFailureCopy } from "./mutation-receipts.js";

export interface ToolDeps {
  mealCorrectionService?: ReturnType<typeof createMealCorrectionService>;
  goalProposalService?: ReturnType<typeof createGoalProposalService>;
  toolSessionState?: {
    resolvedMealTargets: Array<{ mealId: string; mealRevisionId: string }>;
  };
}
```

**`update_meal` schema + nested `items[]` shape** (lines 1238-1274):

```typescript
const updateMealContract: ToolContract<UpdateMealArgs, UpdateMealResult> = {
  name: "update_meal",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      meal_id: { type: "string" },
      food_name: { type: "string" },
      calories: { type: "number" },
      protein: { type: "number" },
      carbs: { type: "number" },
      fat: { type: "number" },
      items: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            food_name: { type: "string" },
            calories: { type: "number" },
            protein: { type: "number" },
            carbs: { type: "number" },
            fat: { type: "number" },
          },
          required: ["food_name", "calories", "protein", "carbs", "fat"],
        },
      },
    },
    required: ["meal_id"],
  },
  zodSchema: updateMealSchema,
  logSummary: (args) => ({ tool: "update_meal", itemCount: "items" in args ? args.items.length : 1 }),
```

**Write path and revision precondition pattern** (lines 1281-1315):

```typescript
const resolvedTarget = findResolvedMealTarget(deps.toolSessionState, args.meal_id);
if (!resolvedTarget) {
  throw new FatalToolError("meal target unresolved");
}

try {
  updated = await deps.mealCorrectionService.updateMeal(
    deviceId,
    args.meal_id,
    "items" in args
      ? { items: args.items.map((item) => ({ foodName: item.food_name.trim(), calories: item.calories, protein: item.protein, carbs: item.carbs, fat: item.fat })) }
      : { patch: { ...(args.calories !== undefined ? { calories: args.calories } : {}), ...(args.protein !== undefined ? { protein: args.protein } : {}) } },
    resolvedTarget.mealRevisionId,
  );
} catch (error) {
  if (error instanceof MealRevisionPreconditionError) {
    throw revisionPreconditionFatalError(error);
  }
}
```

**Goal proposal approval precedent** (lines 1474-1499):

```typescript
if (args.mode === "current_turn_values") {
  updatePatch = overridePatch;
} else {
  const proposal = await deps.goalProposalService.getLatest(deviceId);
  if (!proposal || !isGoalProposalConsent(context.currentUserMessage)) {
    const reply = renderGoalAuthorityFailureCopy();
    return { ok: true, result: makeGoalControlledResult("goal_authority_failure", reply), toolMessage: reply };
  }
  updatePatch = { ...proposal.targets, ...overridePatch };
}

const targets = await deps.deviceService.updateGoals(deviceId, updatePatch);
try {
  await deps.goalProposalService.clear(deviceId);
} catch {
  // Targets are already committed; cleanup failure must not alter the user-visible outcome.
}
```

**Controlled failure adapter pattern** (lines 1659-1700):

```typescript
if (toolCall.function.name === "find_meals"
  || toolCall.function.name === "update_goals"
  || toolCall.function.name === "update_meal"
  || toolCall.function.name === "delete_meal") {
  if (toolCall.function.name === "update_goals") {
    const reply = hasValidationFields ? renderGoalValidationFailureCopy(validationFields) : renderGoalAuthorityFailureCopy();
    return {
      result: reply,
      success: false,
      executed: false,
      failureReason: outcome.failureReason,
      controlledReply: { source: "renderer", reason: hasValidationFields ? "goal_validation_failure" : "goal_authority_failure", text: reply },
    };
  }
  return { result: outcome.result, success: false, executed: false, failureReason: outcome.failureReason };
}
```

**Phase 66 fit:** add meal numeric guard before line 1288 can call `updateMeal`; add controlled meal authority/clarification reasons to `ToolExecutionResult["controlledReply"]`; add proposal creation/apply tooling only with backend-computed values.

### `server/orchestrator/index.ts` (orchestrator, request-response + controlled short-circuit)

**Analog:** same file.

**Pre-model cancel precedent** (lines 621-654):

```typescript
const history = await loadHistory(chatService, deviceId, 10);
const displayHistory = await chatService.getHistory(deviceId, 3);
const previousAssistantMessage = [...displayHistory].reverse().find((message) => message.role === "assistant")?.content;

await chatService.saveMessage(deviceId, "user", userMessage, { imagePath });
opts?.onUserMessageSaved?.();

if (isGoalProposalCancel(userMessage) && deps.goalProposalService) {
  const proposal = await deps.goalProposalService.getLatest(deviceId);
  if (proposal) {
    await deps.goalProposalService.clear(deviceId);
    const reply = renderGoalCancelCopy();
    return {
      reply,
      didLogMeal: false,
      didMutateMeal: false,
      finalReplySource: "renderer",
      finalReplyShape: classifyPlainReplyShape(reply),
    };
  }
}
```

**Tool execution and controlled reply short-circuit** (lines 900-963):

```typescript
for (const toolCall of response.toolCalls) {
  const { result, summary, dailySummary, summaryOutcome: toolSummaryOutcome, loggedMeal: toolLoggedMeal, success, failureReason, controlledReply } =
    await executeTool(toolCall, deviceId, { mealCorrectionService: deps.mealCorrectionService, goalProposalService: deps.goalProposalService, toolSessionState }, {
      currentUserMessage: userMessage,
      previousAssistantMessage,
    });

  if (controlledReply) {
    opts?.hooks?.onToolResult?.({ tool: toolCall.function.name, success: success !== false, executed: success !== false, failureReason, summary });
    opts?.hooks?.onLLMEnd?.(round + 1, true);
    return {
      reply: controlledReply.text,
      didLogMeal: false,
      didMutateMeal: false,
      finalReplySource: controlledReply.source,
      finalReplyShape: classifyPlainReplyShape(controlledReply.text),
    };
  }
}
```

**Mutation receipt short-circuit after committed update** (lines 1003-1019):

```typescript
if (mealMutationKind === "update" || mealMutationKind === "delete") {
  didMutateMeal = true;
  mealSummaryOutcome = requireSummaryOutcomeForMealMutation(toolSummaryOutcome);
  if (mealMutationKind === "update") {
    loggedMeal = toolLoggedMeal;
    if (!toolLoggedMeal) throw new Error("update_meal succeeded without loggedMeal");
    mutationEffects = { kind: "update", affectedDate: affectedDate ?? toolLoggedMeal.dateKey, summaryOutcome: mealSummaryOutcome, committedTargets: getDeviceTargets(device), meal: toolLoggedMeal };
    mutationReceiptText = renderCheckedMutationReceipt(mutationEffects);
  }
}
```

**Phase 66 fit:** add pre-model router for broad cancel, cross-kind bare approval ambiguity, and kind-specific meal approval/cancel. Blocked/proposal/ambiguity replies should return before later LLM rewrite and with `didMutateMeal: false`.

### `server/orchestrator/mutation-receipts.ts` (renderer, transform)

**Analog:** same file.

**Forbidden-term guard** (lines 5-39):

```typescript
export const FORBIDDEN_RECEIPT_TERMS = [
  "log_food",
  "update_meal",
  "delete_meal",
  "update_goals",
  "revision",
  "deviceId",
  "summaryOutcome",
  "dailySummary",
  "API",
] as const;

export function assertNoForbiddenReceiptTerms(text: string): string[] {
  return FORBIDDEN_RECEIPT_TERMS.filter((term) => text.includes(term));
}
```

**Proposal copy pattern** (lines 55-68):

```typescript
function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

export function renderGoalProposalCopy(targets: DailyTargets): string {
  return [
    "我可以先幫你改成這組每日目標：",
    `• 卡路里 ${formatNumber(targets.calories)} kcal`,
    `• 蛋白質 ${formatNumber(targets.protein)} g`,
    `• 碳水 ${formatNumber(targets.carbs)} g`,
    `• 脂肪 ${formatNumber(targets.fat)} g`,
    "如果要套用，請回覆「好」；如果要調整，請直接給新的數字。",
  ].join("\n");
}
```

**Meal update receipt pattern** (lines 122-131):

```typescript
export function renderMutationReceipt(effects: MutationEffects): string {
  switch (effects.kind) {
    case "update": {
      const datePrefix = formatDatePrefix(effects.meal.dateKey || effects.affectedDate);
      return `已更新${datePrefix}${effects.meal.foodName}，${formatNumber(effects.meal.calories)} kcal，蛋白質 ${formatNumber(effects.meal.protein)} g。`;
    }
  }
}
```

**Phase 66 fit:** add meal proposal, blocked clarification, cancel, and cross-kind disambiguation renderers here. Copy should start "這次沒有更新..." on blocked paths and avoid internal terms.

### `server/orchestrator/system-prompt.ts` (config, transform)

**Analog:** same file.

**Goal update prompt contract pattern** (lines 171-177):

```typescript
content: `目標更新規則：
1. 像「少吃一點」、「提高蛋白質」、「血糖控制」這類模糊目標變更意圖，必須呼叫 propose_goals，推薦一組具體數值提案，提供 calories、protein、carbs、fat 四個具體提案數字；成功提案文字由後端產生並詢問使用者是否要套用。
2. 使用者在本輪直接提供每日目標數字時，才呼叫 update_goals 並使用 mode: "current_turn_values"；只放入本輪使用者訊息明確出現的 calories、protein、carbs、fat 數字。
3. 使用者以「好」、「可以」、「幫我更新」、「就這樣」、「用這組」這類短句明確同意目前有效的後端提案時，才呼叫 update_goals 並使用 mode: "latest_proposal"。
6. 這些規則只是工具路由指引；是否能套用更新由後端工具驗證、提案狀態與使用者本輪文字決定。不要向使用者提及內部工具名稱或系統欄位。`,
```

**Meal correction prompt section to replace** (lines 182-191):

```typescript
content: `歷史餐點修正規則：
...
7. 若使用者已明確授權你自行估一個合理數字（例如「正常平均幾g就幾g」），就先決定一個具體數字，再直接套用；不要再回報格式錯誤或要求同一句提供完整整筆欄位。
...
9. 成功修改歷史餐點時，要明確表示是更新原本那筆紀錄，不是新增一筆。成功刪除時，要明確表示已刪除原本那筆餐點。`,
```

**Phase 66 fit:** remove model-estimated direct numeric application. Mirror the goal prompt style: route direct explicit values, route locked computable adjustments to proposal, ask clarification for vague requests, and state backend validation remains authoritative.

### `server/services/meal-correction.ts` (service, CRUD)

**Analog:** same file.

**Service imports and pending-state pattern** (lines 1-27, 343-347):

```typescript
import { createMealTransactionsService, type MealTransactionItemInput } from "./meal-transactions.js";
import { createTurnStateService } from "./turn-state.js";
import { createSummaryService, type DailySummary } from "./summary.js";

const PENDING_SELECTION_KIND = "meal_target_selection";
const PENDING_SELECTION_TTL_MS = 15 * 60 * 1000;

export function createMealCorrectionService(db: AppDatabase, deps: MealCorrectionServiceDeps = {}) {
  const mealTransactionsService = createMealTransactionsService(db);
  const turnStateService = createTurnStateService(db);
  const summaryService = deps.summaryService ?? createSummaryService(db);
}
```

**Candidate facts pattern for proposal computation** (lines 380-400):

```typescript
return limitedHeaders.map((header) => {
  const revisionItems = itemsByRevisionId.get(header.currentRevisionId) ?? [];
  const display = projectMealDisplay(revisionItems, "未知餐點");
  return {
    mealId: header.id,
    mealRevisionId: header.currentRevisionId,
    foodName: display.foodName,
    itemCount: display.itemCount,
    itemNames: revisionItems.map((item) => item.foodName),
    calories: revisionItems.reduce((sum, item) => sum + item.calories, 0),
    protein: revisionItems.reduce((sum, item) => sum + item.protein, 0),
    carbs: revisionItems.reduce((sum, item) => sum + item.carbs, 0),
    fat: revisionItems.reduce((sum, item) => sum + item.fat, 0),
    dateKey: formatLocalDate(new Date(header.loggedAt)),
  };
});
```

**Update path pattern** (lines 660-749):

```typescript
async updateMeal(deviceId: string, mealId: string, input: MealCorrectionUpdateInput, expectedMealRevisionId?: string | null) {
  const items = "items" in input ? input.items : input.patch;
  let nextItems: MealTransactionItemInput[];

  if (Array.isArray(items)) {
    nextItems = items;
  } else {
    const currentItems = await mealTransactionsService.getCurrentItemsForMutation(deviceId, mealId, expectedMealRevisionId);
    nextItems = applyMealPatch(currentItems, items);
  }

  const updated = await mealTransactionsService.updateTransaction(deviceId, mealId, { expectedMealRevisionId, items: nextItems });
  const summaryOutcome = await buildSummaryOutcomeAfterMealCommit({ deviceId, affectedDate: updated.affectedDateKey, summaryService, foodLoggingService });
  const dailySummary = dailySummaryFromOutcome(summaryOutcome);
  return { updatedMeal: { id: updated.transactionId, mealRevisionId: updated.revisionId }, affectedDate: updated.affectedDateKey, summaryOutcome, ...(dailySummary ? { dailySummary } : {}) };
}
```

**Phase 66 fit:** proposal approval should call this existing update path with stored `expectedMealRevisionId`; no parallel stale mechanism.

### `server/app.ts` (composition root, dependency wiring)

**Analog:** same file.

**Service creation and orchestrator wiring pattern** (lines 84-113):

```typescript
const foodLoggingService = createFoodLoggingService(db);
const summaryService = createSummaryService(db);
const chatService = createChatService(db);
const mealCorrectionService = createMealCorrectionService(db, { summaryService, foodLoggingService });
const goalProposalService = createGoalProposalService(db);
const publisher = new RealtimePublisher();

const orchestrator = createOrchestrator({
  llmProvider,
  chatService,
  summaryService,
  foodLoggingService,
  mealCorrectionService,
  deviceService,
  goalProposalService,
  publisher,
});
```

**Test service exposure pattern** (lines 115-126):

```typescript
opts.onServicesReady?.({
  foodLoggingService,
  goalProposalService,
  mealCorrectionService,
  orchestrator,
  publisher,
  summaryService,
});
```

**Phase 66 fit:** if a new `mealNumericProposalService` is injected, create it here, pass it into `createOrchestrator`, and expose it in `AppServices` only if integration tests need direct state seeding.

## Test Pattern Assignments

### `tests/unit/meal-numeric-proposals.test.ts` (test, CRUD + TTL state)

**Analog:** `tests/unit/goal-proposals.test.ts`

**Imports and fixed time pattern** (lines 1-13):

```typescript
process.env.TZ = "Asia/Taipei";

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../../server/db/client.js";
import { createDeviceService } from "../../server/services/device.js";
import { GOAL_PROPOSAL_KIND, createGoalProposalService } from "../../server/services/goal-proposals.js";

const REAL_DATE = Date;
const FIXED_NOW = new REAL_DATE("2026-05-17T08:30:00+08:00");
```

**Replacement/expiry/clear proof pattern** (lines 65-133):

```typescript
const proposal = await service.putLatest(deviceId, { calories: 1400, protein: 120, carbs: 130, fat: 45 });
assert.match(proposal.proposalId, /^[0-9a-f-]{36}$/);
assert.equal(proposal.createdAt, FIXED_NOW.toISOString());
assert.deepEqual(await service.getLatest(deviceId), proposal);

const count = db.$client
  .prepare("SELECT COUNT(*) AS count FROM turn_states WHERE device_id = ? AND kind = ?")
  .get(deviceId, GOAL_PROPOSAL_KIND) as { count: number };
assert.equal(count.count, 1);

db.$client.prepare("UPDATE turn_states SET expires_at = ? WHERE device_id = ? AND kind = ?")
  .run("2026-05-16T00:00:00.000Z", deviceId, GOAL_PROPOSAL_KIND);
assert.equal(await service.getLatest(deviceId), undefined);
```

### `tests/unit/meal-numeric-authority.test.ts` and `tests/unit/source-text-guard.test.ts` (test, transform proof)

**Analog:** `tests/unit/source-text-guard.test.ts`

**Numeric matrix pattern** (lines 8-31):

```typescript
describe("normalizeNumericSourceText digit + unit matrix", () => {
  it("Test 1a: plain 1800 is authorized", () => {
    const candidates = normalizeNumericSourceText("1800");
    assert.ok(candidates.includes("1800"));
  });

  it("Test 1d: unit suffix 1800卡 yields 1800", () => {
    const candidates = normalizeNumericSourceText("1800卡");
    assert.ok(candidates.includes("1800"));
  });
});
```

**Guard scope proof pattern** (lines 64-130):

```typescript
const result = checkSourceFields(
  { calories: 1800, protein: 130 },
  ["calories", "protein"],
  { currentUserMessage: "卡路里 1800" },
);
assert.equal(result.ok, false);
assert.deepEqual(result.guardedFields, ["protein"]);
```

**Phase 66 additions:** add decimals (`28.5g`), bare Chinese digits accepted by D-03, unit variants, relative phrase classification, current-turn-only rejection for previous assistant prose, and nested `items[]` bypass tests.

### `tests/unit/tool-contract.test.ts` (test, validation/guard proof)

**Analog:** same file.

**Fake contract pattern** (lines 13-50):

```typescript
interface FakeGoalArgs {
  calories?: number;
  protein?: number;
}

function makeFakeGoalContract(overrides: { sourceFields?: readonly (keyof FakeGoalArgs)[] } = {}): ToolContract<FakeGoalArgs, { ok: true }> {
  return {
    name: "fake_goal",
    parameters: { type: "object", properties: { calories: { type: "number" } }, additionalProperties: false },
    zodSchema: fakeGoalSchema,
    sourceFields: overrides.sourceFields,
    logSummary: (args) => ({ updatedFields: Object.keys(args) }),
    execute: async () => ({ ok: true, result: { ok: true }, toolMessage: "done" }),
  };
}
```

**Guard failure proof pattern** (lines 179-200):

```typescript
const res = await runContract(contract, call, {
  currentUserMessage: "幫我提高一點",
  previousAssistantMessage: "要調整嗎?",
});
assert.equal(res.success, false);
assert.equal(res.executed, false);
assert.equal(res.failureReason, "guard");
assert.equal(executed, false);
assert.deepEqual(JSON.parse(res.result).guardedFields, ["calories"]);
```

### `tests/unit/tools.test.ts` (test, tool request-response proof)

**Analog:** same file.

**Resolved revision identity setup** (lines 1179-1231):

```typescript
const result = await executeTool(call, deviceId, {
  foodLoggingService,
  summaryService,
  mealCorrectionService,
  toolSessionState: {
    resolvedMealTargets: [{ mealId: created.id, mealRevisionId: created.mealRevisionId }],
  },
});

assert.equal(result.mealMutationKind, "update");
assert.equal(result.loggedMeal.mealId, created.id);
assert.notEqual(result.loggedMeal.mealRevisionId, created.mealRevisionId);
```

**Fail-closed stale proof** (lines 1404-1470):

```typescript
const staleUpdate = await executeTool({ function: { name: "update_meal", arguments: JSON.stringify({ meal_id: updateTarget.id, calories: 48 }) } } as ToolCall, deviceId, {
  foodLoggingService,
  summaryService,
  mealCorrectionService,
  toolSessionState: { resolvedMealTargets: [{ mealId: updateTarget.id, mealRevisionId: updateTarget.mealRevisionId }] },
});

assert.equal(staleUpdate.success, false);
assert.equal(staleUpdate.executed, false);
assert.match(staleUpdate.result, /MEAL_REVISION_STALE/);
assert.equal(staleUpdate.mealMutationKind, undefined);
assert.equal(staleUpdate.summaryOutcome, undefined);
```

**Phase 66 additions:** direct explicit allowed update, vague blocked update controlled reply, `items[]` numeric bypass rejection, proposal approval application through stored revision, and stale proposal approval via `MEAL_REVISION_STALE`.

### `tests/unit/orchestrator.test.ts` (test, controlled reply/event loop proof)

**Analog:** same file.

**DI fixture pattern** (lines 640-660):

```typescript
const localGoalProposalService = createGoalProposalService(db);
const localDeviceId = (await localDeviceService.createDevice("fat_loss")).deviceId;
const localLLM = new MockLLMProvider();

orchestrator = createOrchestrator({
  llmProvider: localLLM,
  chatService: localChatService,
  summaryService: localSummaryService,
  foodLoggingService: localFoodLoggingService,
  deviceService: localDeviceService,
  goalProposalService: localGoalProposalService,
  publisher: { publishGoalsUpdate() { return { sent: 1 }; } },
});
```

**Renderer-owned no-second-round pattern** (lines 1837-1869):

```typescript
mockLLM.queueChatResponse({
  toolCalls: [{ function: { name: "propose_goals", arguments: JSON.stringify({ calories: 1750, protein: 125, carbs: 180, fat: 55 }) } }],
});
mockLLM.queueChatResponse({ content: "模型後續改寫：已經幫你更新好了。" });

const result = await orchestrator.handleMessage(deviceId, "幫我建議一組減脂目標");

assert.equal(result.reply, renderGoalProposalCopy({ calories: 1750, protein: 125, carbs: 180, fat: 55 }));
assert.equal(result.didMutateMeal, false);
assert.equal(result.finalReplySource, "renderer");
assert.equal(mockLLM.chatCalls.length, 1);
```

**Phase 66 additions:** blocked correction renderer must not call a later model round; cross-kind bare `好` with both proposals active mutates neither; kind-specific meal approval applies only stored meal proposal.

### `tests/unit/mutation-receipts.test.ts` (test, renderer proof)

**Analog:** same file.

**Forbidden internal terms pattern** (lines 55-70):

```typescript
const GOAL_INTERNAL_TERMS = [
  "proposalId",
  "turn_states",
  "update_goals",
  "propose_goals",
  "schema_validation",
  "source_text_guard",
  "API",
] as const;

function assertNoGoalInternalTerms(text: string) {
  const leaked = GOAL_INTERNAL_TERMS.filter((term) => text.includes(term));
  assert.deepEqual(leaked, []);
  assert.deepEqual(assertNoForbiddenReceiptTerms(text), []);
}
```

**Exact proposal copy assertion pattern** (lines 148-163):

```typescript
const text = renderGoalProposalCopy({ calories: 1400, protein: 120, carbs: 130, fat: 45 });

assert.equal(
  text,
  "我可以先幫你改成這組每日目標：\n• 卡路里 1400 kcal\n• 蛋白質 120 g\n• 碳水 130 g\n• 脂肪 45 g\n如果要套用，請回覆「好」；如果要調整，請直接給新的數字。",
);
assert.doesNotMatch(text, /已更新每日目標/);
assertNoGoalInternalTerms(text);
```

### `tests/unit/meal-correction.test.ts` (test, service CRUD/revision proof)

**Analog:** same file.

**Real SQLite fixture pattern** (lines 1-12, 57-68):

```typescript
process.env.TZ = "Asia/Taipei";
import { createDb } from "../../server/db/client.js";
import { createFoodLoggingService } from "../../server/services/food-logging.js";
import { createMealCorrectionService } from "../../server/services/meal-correction.js";

beforeEach(async () => {
  globalThis.Date = FixedDate as DateConstructor;
  db = createDb(":memory:");
  foodLoggingService = createFoodLoggingService(db);
  mealCorrectionService = createMealCorrectionService(db);
});
```

**Grouped numeric patch proof** (lines 247-267):

```typescript
const grouped = await foodLoggingService.logGroupedMeal(deviceId, {
  items: [
    { foodName: "雞胸肉", calories: 220, protein: 30, carbs: 0, fat: 5 },
    { foodName: "白飯", calories: 180, protein: 4, carbs: 40, fat: 0.5 },
    { foodName: "花椰菜", calories: 50, protein: 3, carbs: 8, fat: 0.5 },
  ],
});

const result = await mealCorrectionService.updateMeal(deviceId, grouped.id, { patch: { protein: 22 } }, grouped.mealRevisionId);
assert.equal(result.updatedMeal.foodName, "雞胸肉、白飯、花椰菜");
assert.equal(result.updatedMeal.protein, 22);
```

**Stale revision assertion pattern** (lines 731-745):

```typescript
await assert.rejects(
  () => mealCorrectionService.updateMeal(deviceId, meal.id, { patch: { calories: 420 } }, meal.mealRevisionId),
  (error) => {
    assert.ok(error instanceof MealRevisionPreconditionError);
    assert.equal(error.code, "MEAL_REVISION_STALE");
    assert.equal(error.currentMealRevisionId, `${meal.id}:r2`);
    return true;
  },
);
```

### `tests/integration/chat-meal-correction.integration.test.ts` (test, HTTP + DB proof)

**Analog:** same file.

**Fastify app fixture and HTTP helper** (lines 59-109):

```typescript
beforeEach(async () => {
  globalThis.Date = FixedDate as DateConstructor;
  mockLLM = new MockLLMProvider();
  app = await buildApp({
    dbPath: ":memory:",
    llmProvider: mockLLM,
    onServicesReady: (ready) => { services = ready; },
  });
  const res = await app.inject({ method: "POST", url: "/api/device", payload: { goal: "fat_loss" } });
  deviceId = res.json().deviceId;
  sessionCookieHeader = toCookieHeader(res.headers["set-cookie"]);
  address = await app.listen({ port: 0 });
});

async function postChat(message: string) {
  const form = new FormData();
  form.append("message", message);
  const res = await fetch(`${address}/api/chat`, { method: "POST", headers: { cookie: sessionCookieHeader }, body: form });
  return { status: res.status, body: await res.json() };
}
```

**Successful update proof pattern** (lines 138-181):

```typescript
mockLLM.queueChatResponse({ toolCalls: [{ function: { name: "find_meals", arguments: JSON.stringify({ action: "update", query: "把今天早餐的雞腿飯改成雞胸飯 500 卡" }) } }] });
mockLLM.queueChatResponse({ toolCalls: [{ function: { name: "update_meal", arguments: JSON.stringify({ meal_id: original.id, food_name: "雞胸飯", calories: 500, protein: 42, carbs: 48, fat: 12 }) } }] });

const { status, body } = await postChat("把今天早餐的雞腿飯改成雞胸飯 500 卡");
assert.equal(status, 200);
assert.equal(body.didMutateMeal, true);
assert.match(body.reply, /已更新雞胸飯，500 kcal，蛋白質 42 g/);
assert.equal(body.dailySummary?.totalCalories, 500);
```

**No-mutation stale/publish suppression proof** (lines 800-846):

```typescript
const publishCalls: unknown[] = [];
services.publisher.publishDailySummary = (...args) => {
  publishCalls.push(args);
  return { sent: 0 };
};

const staleTurn = await postChat("改成 22g");
assert.equal(staleTurn.body.didMutateMeal, false);
assert.equal(Object.prototype.hasOwnProperty.call(staleTurn.body, "summaryOutcome"), false);
assert.doesNotMatch(staleTurn.body.reply, /已更新/);
assert.deepEqual(publishCalls, []);
```

**Phase 66 additions:** vague non-computable correction no revision/no publish/no success copy; proposal creation no mutation; approval commits; stale approval fails through existing stale path; both-active bare approval disambiguates.

### `tests/integration/chat-streaming.test.ts` (test, SSE streaming proof)

**Analog:** same file.

**SSE update mutation done payload pattern** (lines 1453-1510):

```typescript
mockLLM.queueRoundResponse({
  toolCalls: [
    createFindMealsToolCall("update", "2026-03-25 晚餐牛肉麵"),
    createUpdateMealToolCall(mealId),
  ],
});

const text = await readStreamUntil(res.body.getReader(), "event: done");
const events = parseSSEEvents(text);
const donePayload = JSON.parse(doneDataMatch[1]) as {
  didLogMeal: boolean;
  didMutateMeal?: boolean;
  affectedDate?: string;
  loggedMeal?: { mealId?: string; mealRevisionId?: string; dateKey?: string };
};

assert.equal(donePayload.didLogMeal, false);
assert.equal(donePayload.didMutateMeal, true);
assert.equal(donePayload.affectedDate, "2026-03-25");
assert.equal(donePayload.loggedMeal?.mealId, mealId);
```

**No-mutation stream assertion pattern** (lines 2460-2477):

```typescript
const events = parseSSEEvents(text);
const chunkText = events
  .filter((event) => event.event === "chunk")
  .map((event) => JSON.parse(event.data) as { token: string })
  .map((payload) => payload.token)
  .join("");
const donePayload = JSON.parse(events.find((event) => event.event === "done")!.data) as {
  didLogMeal?: boolean;
  didMutateMeal?: boolean;
};

assert.equal(donePayload.didLogMeal, false);
assert.equal(donePayload.didMutateMeal, false);
assert.doesNotMatch(chunkText, /已記錄牛肉飯|牛肉飯，650 kcal/);
```

## Shared Patterns

### Turn-State Active Proposal Storage

**Source:** `server/services/turn-state.ts`
**Apply to:** `server/services/meal-numeric-proposals.ts`, orchestrator proposal router.

```typescript
// lines 15-24, 39-42
async putState<T>(deviceId: string, kind: string, payload: T, ttlMs: number): Promise<void> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + ttlMs).toISOString();
  db.$client.prepare(`
    INSERT INTO turn_states (...) VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(device_id, kind) DO UPDATE SET
      payload = excluded.payload,
      expires_at = excluded.expires_at,
      updated_at = excluded.updated_at
  `);
}
```

**Schema support:** `server/db/schema.ts` lines 179-195 defines `turn_states` and `uniqueIndex("turn_states_device_kind_uq").on(table.deviceId, table.kind)`, which supports same-kind replacement and cross-kind coexistence.

### Revision Preconditions

**Source:** `server/services/meal-transactions.ts`
**Apply to:** proposal approval and direct `update_meal`.

```typescript
// lines 229-253
function assertExpectedMealRevision(existing: MealRevisionAssertionTarget, expectedMealRevisionId: string | null | undefined) {
  const expected = typeof expectedMealRevisionId === "string" ? expectedMealRevisionId.trim() : "";
  if (!expected) {
    throw new MealRevisionPreconditionError({ code: "MEAL_REVISION_REQUIRED", mealId: existing.id, affectedDate, currentMealRevisionId: existing.currentRevisionId });
  }
  if (expected !== existing.currentRevisionId) {
    throw new MealRevisionPreconditionError({ code: "MEAL_REVISION_STALE", mealId: existing.id, affectedDate, currentMealRevisionId: existing.currentRevisionId });
  }
}
```

`updateTransaction()` calls the assertion before inserting a revision (`server/services/meal-transactions.ts` lines 501-543). Do not create a parallel stale mechanism for proposals.

### No-Mutation Publish Suppression

**Source:** `server/routes/chat.ts`
**Apply to:** blocked correction, clarification, proposal creation, ambiguity, cancel.

```typescript
// lines 407-414
if (
  !didMutateMeal
  || !publishAffectedDate
  || !summaryDate
  || summaryDate !== publishAffectedDate
) {
  return;
}
```

### Test Verification Conventions

**Source:** `AGENTS.md` and local skill indexes.
**Apply to:** all Phase 66 test plans.

Use `process.env.TZ = "Asia/Taipei"`, Node built-in `node:test`, real SQLite `:memory:`, `MockLLMProvider`, and explicit `.js` imports. Verification expected by touched paths:

- `yarn tsc --noEmit` for TypeScript edits.
- `yarn test:unit` for `tests/unit/*.test.ts`.
- `yarn test:integration` for service/route/integration behavior.

## No Analog Found

None. New Phase 66 files have strong role-match analogs:

| File | Role | Data Flow | Analog |
|---|---|---|---|
| `server/orchestrator/meal-numeric-authority.ts` | utility | transform + guard | `source-text-guard.ts`, `meal-correction.ts` |
| `server/services/meal-numeric-proposals.ts` | service | CRUD + TTL state | `goal-proposals.ts`, `turn-state.ts` |
| `tests/unit/meal-numeric-authority.test.ts` | test | transform proof | `source-text-guard.test.ts` |
| `tests/unit/meal-numeric-proposals.test.ts` | test | CRUD + TTL proof | `goal-proposals.test.ts` |

## Metadata

**Analog search scope:** `server/orchestrator`, `server/services`, `server/routes`, `server/db`, `tests/unit`, `tests/integration`, project `.codex/skills`.
**Files scanned:** 100+ via `rg --files`; 15 primary analog files inspected with line-numbered excerpts.
**Pattern extraction date:** 2026-05-28
