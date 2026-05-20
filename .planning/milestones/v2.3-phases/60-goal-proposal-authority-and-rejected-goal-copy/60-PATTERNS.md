# Phase 60: Goal Proposal Authority and Rejected-Goal Copy - Pattern Map

**Mapped:** 2026-05-17
**Files analyzed:** 13
**Analogs found:** 13 / 13

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `server/services/goal-proposals.ts` | service | CRUD + expiring state | `server/services/turn-state.ts`; `server/services/meal-correction.ts` | role-match |
| `server/orchestrator/tools.ts` | orchestrator tool registry | request-response + CRUD side effects | `server/orchestrator/tools.ts` `update_goals` contract | exact |
| `server/orchestrator/mutation-receipts.ts` | utility / renderer | transform | `server/orchestrator/mutation-receipts.ts` goal receipt renderer | exact |
| `server/orchestrator/index.ts` | orchestrator | event-driven tool loop + request-response | `server/orchestrator/index.ts` mutation receipt short-circuit | exact |
| `server/orchestrator/source-text-guard.ts` | utility / guard | transform + request-response authorization | `server/orchestrator/source-text-guard.ts` numeric source guard | exact |
| `server/orchestrator/system-prompt.ts` | config / prompt builder | transform | `server/orchestrator/system-prompt.ts` goal update section | exact |
| `server/app.ts` | composition root | dependency injection | `server/app.ts` service/orchestrator wiring | exact |
| `server/routes/chat.ts` | route | request-response + streaming | `server/routes/chat.ts` final reply source propagation | exact |
| `tests/unit/goal-proposals.test.ts` | test | CRUD + expiry | `tests/unit/meal-correction.test.ts` pending turn-state tests | role-match |
| `tests/unit/update-goals-contract.test.ts` | test | request-response + CRUD side effects | `tests/unit/update-goals-contract.test.ts` | exact |
| `tests/unit/mutation-receipts.test.ts` | test | transform | `tests/unit/mutation-receipts.test.ts` | exact |
| `tests/unit/orchestrator.test.ts` | test | event-driven tool loop | `tests/unit/orchestrator.test.ts` renderer/local recovery assertions | role-match |
| `tests/integration/chat-goal-update.integration.test.ts` | test | request-response + integration | `tests/integration/chat-goal-update.integration.test.ts` | exact |

## Pattern Assignments

### `server/services/goal-proposals.ts` (service, CRUD + expiring state)

**Analog:** `server/services/turn-state.ts` and `server/services/meal-correction.ts`

**Imports pattern** (`server/services/turn-state.ts` line 1):
```typescript
import type { AppDatabase } from "../db/client.js";
```

**State write / overwrite pattern** (`server/services/turn-state.ts` lines 13-20, 26-53):
```typescript
export function createTurnStateService(db: AppDatabase) {
  return {
    async putState<T>(
      deviceId: string,
      kind: string,
      payload: T,
      ttlMs: number,
    ): Promise<void> {
      const now = new Date();
      const createdAt = now.toISOString();
      const updatedAt = createdAt;
      const expiresAt = new Date(now.getTime() + ttlMs).toISOString();

      db.$client
        .prepare(
          `
            INSERT INTO turn_states (
              id,
              device_id,
              kind,
              payload,
              expires_at,
              created_at,
              updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(device_id, kind) DO UPDATE SET
              payload = excluded.payload,
              expires_at = excluded.expires_at,
              updated_at = excluded.updated_at
          `,
        )
        .run(
          `${deviceId}:${kind}`,
          deviceId,
          kind,
          JSON.stringify(payload),
          expiresAt,
          createdAt,
          updatedAt,
        );
```

**Expiry and clear pattern** (`server/services/turn-state.ts` lines 56-90):
```typescript
async getState<T>(deviceId: string, kind: string): Promise<T | undefined> {
  const row = db.$client
    .prepare(
      `
        SELECT
          id,
          device_id AS deviceId,
          kind,
          payload,
          expires_at AS expiresAt,
          created_at AS createdAt,
          updated_at AS updatedAt
        FROM turn_states
        WHERE device_id = ? AND kind = ?
        LIMIT 1
      `,
    )
    .get(deviceId, kind) as TurnStateRow | undefined;

  if (!row) {
    return undefined;
  }

  if (new Date(row.expiresAt).getTime() <= Date.now()) {
    await this.clearState(deviceId, kind);
    return undefined;
  }

  return JSON.parse(row.payload) as T;
},

async clearState(deviceId: string, kind: string): Promise<void> {
  db.$client
    .prepare("DELETE FROM turn_states WHERE device_id = ? AND kind = ?")
    .run(deviceId, kind);
},
```

**Domain wrapper pattern** (`server/services/meal-correction.ts` lines 378-388, 428-440, 617-634):
```typescript
async function rememberResolvedCandidate(
  deviceId: string,
  action: "update" | "delete",
  candidate: MealCorrectionCandidate,
): Promise<void> {
  await turnStateService.putState(
    deviceId,
    PENDING_SELECTION_KIND,
    { action, candidates: [candidate] },
    PENDING_SELECTION_TTL_MS,
  );
}

const pending = await turnStateService.getState<PendingMealSelectionState>(deviceId, PENDING_SELECTION_KIND);
if (!pending) {
  return undefined;
}

if (pending.action !== action) {
  await turnStateService.clearState(deviceId, PENDING_SELECTION_KIND);
  return undefined;
}

await turnStateService.putState(
  deviceId,
  PENDING_SELECTION_KIND,
  { action, candidates: narrowed },
  PENDING_SELECTION_TTL_MS,
);

async clearPendingSelection(deviceId: string): Promise<void> {
  await turnStateService.clearState(deviceId, PENDING_SELECTION_KIND);
},
```

**Apply to Phase 60:** Create a thin `createGoalProposalService(db)` wrapper with `GOAL_PROPOSAL_KIND`, `GOAL_PROPOSAL_TTL_MS = 30 * 60 * 1000`, `putLatest`, `getLatest`, and `clear`. Use `turnStateService.getState()` expiry behavior; do not add a table unless planning intentionally rejects the locked `turn_states` decision.

---

### `server/orchestrator/tools.ts` (orchestrator tool registry, request-response + CRUD)

**Analog:** `server/orchestrator/tools.ts` `update_goals` and registry patterns

**Imports / dependency surface** (`server/orchestrator/tools.ts` lines 1-20, 35-45):
```typescript
import { z } from "zod";
import type { ToolDefinition, ToolCall } from "../llm/types.js";
import type { createFoodLoggingService } from "../services/food-logging.js";
import type { createSummaryService, DailySummary } from "../services/summary.js";
import type { createDeviceService, DailyTargets } from "../services/device.js";
import type { createMealCorrectionService, FindMealsResult } from "../services/meal-correction.js";
import type { RealtimePublisher } from "../realtime/publisher.js";
import {
  runContract,
  summarizeContractArgsForLog,
  type ToolContract,
  type RunContractContext,
} from "./tool-contract.js";

export interface ToolDeps {
  foodLoggingService: ReturnType<typeof createFoodLoggingService>;
  summaryService: ReturnType<typeof createSummaryService>;
  mealCorrectionService?: ReturnType<typeof createMealCorrectionService>;
  deviceService?: ReturnType<typeof createDeviceService>;
  publisher?: Pick<RealtimePublisher, "publishGoalsUpdate">;
```

**Existing goal mutation contract pattern** (`server/orchestrator/tools.ts` lines 1259-1298):
```typescript
const updateGoalsContract: ToolContract<Partial<DailyTargets>, UpdateGoalsResult> = {
  name: "update_goals",
  description:
    "更新使用者每日營養目標。只有當使用者在目前訊息提供 calories/protein/carbs/fat 的具體數字，或明確同意上一輪助理推薦的具體數字時才可呼叫；模糊意圖必須先推薦具體目標值並請使用者確認。",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      calories: { type: "number", minimum: 500, maximum: 8000 },
      protein: { type: "number", minimum: 0, maximum: 400 },
      carbs: { type: "number", minimum: 0, maximum: 1000 },
      fat: { type: "number", minimum: 0, maximum: 300 },
    },
  },
  zodSchema: updateGoalsSchema,
  sourceFields: ["calories", "protein", "carbs", "fat"] as const,
  logSummary: (args) => ({
    tool: "update_goals",
    updatedFields: updatedGoalFields(args),
  }),
  execute: async (args, context) => {
    const deps = context.deps?.toolDeps as ToolDeps | undefined;
    const deviceId = context.deps?.deviceId as string | undefined;
    if (!deps?.deviceService || !deps.publisher || !deviceId) {
      throw new Error("update_goals contract missing deviceService/publisher/deviceId in context");
    }

    const updatedFields = updatedGoalFields(args);
    const targets = await deps.deviceService.updateGoals(deviceId, args);
    deps.publisher.publishGoalsUpdate(deviceId, targets);
```

**Registry pattern** (`server/orchestrator/tools.ts` lines 1306-1313):
```typescript
export const toolRegistry: Map<string, ToolContract<any, any>> = new Map([
  [logFoodContract.name, logFoodContract as ToolContract<any, any>],
  [findMealsContract.name, findMealsContract as ToolContract<any, any>],
  [updateMealContract.name, updateMealContract as ToolContract<any, any>],
  [deleteMealContract.name, deleteMealContract as ToolContract<any, any>],
  [getDailySummaryContract.name, getDailySummaryContract as ToolContract<any, any>],
  [updateGoalsContract.name, updateGoalsContract as ToolContract<any, any>],
]);
```

**Controlled failure wrapper pattern** (`server/orchestrator/tools.ts` lines 1393-1435, 1438-1467):
```typescript
const ctx: RunContractContext = {
  currentUserMessage: sourceContext?.currentUserMessage ?? "",
  previousAssistantMessage: sourceContext?.previousAssistantMessage,
  deps: { toolDeps: deps, deviceId },
};

const outcome = await runContract(contract, toolCall, ctx);

if (!outcome.success) {
  if (
    toolCall.function.name === "find_meals"
    || toolCall.function.name === "update_goals"
    || toolCall.function.name === "update_meal"
    || toolCall.function.name === "delete_meal"
  ) {
    const updatedFields =
      typeof outcome.logSummary === "object" &&
      outcome.logSummary !== null &&
      Array.isArray(outcome.logSummary.updatedFields)
        ? (outcome.logSummary.updatedFields as string[])
        : undefined;
    return {
      result: outcome.result,
      summary: `failureReason: ${outcome.failureReason ?? "validation"}`,
      success: false,
      executed: false,
      failureReason: outcome.failureReason,
      updatedFields,
    };
  }

  let failureMessage = "tool execution failed";
  try {
    const parsed = JSON.parse(outcome.result) as Record<string, unknown>;
    if (typeof parsed.message === "string" && parsed.message.length > 0) {
      failureMessage = parsed.message;
    } else if (typeof parsed.failureReason === "string") {
      failureMessage = `tool failed: ${parsed.failureReason}`;
    }
  } catch {
    // result was not JSON; keep generic message
  }
```

**Success result projection** (`server/orchestrator/tools.ts` lines 1567-1577):
```typescript
if (toolCall.function.name === "update_goals") {
  const contractResult = outcome.contractResult as UpdateGoalsResult;
  return {
    result: outcome.result,
    summary: `updatedFields: ${contractResult.updatedFields.join(",")}`,
    success: true,
    executed: true,
    updatedFields: [...contractResult.updatedFields],
    publishedEvents: [...contractResult.publishedEvents],
    dailyTargets: contractResult.targets,
```

**Apply to Phase 60:** Add `propose_goals` as a sibling `ToolContract`; keep `logSummary` field-name-only. Refactor `update_goals` to explicit modes and make proposal mode load backend state. Call `deviceService.updateGoals` only after validation, source/proposal authorization, and cancel checks. Clear the proposal immediately after successful persistence, before `publishGoalsUpdate`.

---

### `server/orchestrator/mutation-receipts.ts` (utility / renderer, transform)

**Analog:** existing backend-owned mutation receipt renderer

**Imports and forbidden copy terms** (`server/orchestrator/mutation-receipts.ts` lines 1-35):
```typescript
import { currentAppDate, formatLocalDate } from "../lib/time.js";
import type { MutationEffects } from "./mutation-effects.js";

export const FORBIDDEN_RECEIPT_TERMS = [
  "headline",
  "先抓低",
  "保守估算",
  "log_food",
  "update_meal",
  "delete_meal",
  "update_goals",
  "revision",
  "deviceId",
  "mealMutationKind",
  "dailySummary",
  "dailyTargets",
  "API",
  "endpoint",
  "route",
  "payload",
  "field",
  "request",
  "response",
  "JSON",
  "PATCH",
  "POST",
  "DELETE",
  "/api",
  "body",
  "status code",
] as const;

export function assertNoForbiddenReceiptTerms(text: string): string[] {
  return FORBIDDEN_RECEIPT_TERMS.filter((term) => text.includes(term));
}
```

**Formatting helpers and goal receipt shape** (`server/orchestrator/mutation-receipts.ts` lines 51-53, 72-94):
```typescript
function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1).replace(/\.0$/, "");
}

export function renderMutationReceipt(effects: MutationEffects): string {
  switch (effects.kind) {
    case "goals":
      return [
        "已更新每日目標：",
        `• 卡路里 ${formatNumber(effects.targets.calories)} kcal`,
        `• 蛋白質 ${formatNumber(effects.targets.protein)} g`,
        `• 碳水 ${formatNumber(effects.targets.carbs)} g`,
        `• 脂肪 ${formatNumber(effects.targets.fat)} g`,
      ].join("\n");
  }
}
```

**Test pattern for exact copy and forbidden terms** (`tests/unit/mutation-receipts.test.ts` lines 200-212, 214-248):
```typescript
it("renders goal receipts with all four committed target rows", () => {
  const text = renderMutationReceipt({
    kind: "goals",
    affectedDate: "2026-05-10",
    committedSummary,
    committedTargets,
    targets: committedTargets,
    updatedFields: ["calories", "protein"],
  });

  assert.equal(text, "已更新每日目標：\n• 卡路里 1800 kcal\n• 蛋白質 130 g\n• 碳水 150 g\n• 脂肪 50 g");
  assert.deepEqual(assertNoForbiddenReceiptTerms(text), []);
});

it("rejects implementation and API-like forbidden terms", () => {
  const rejected = [
    "headline",
    "先抓低",
    "保守估算",
    "log_food",
    "update_meal",
    "delete_meal",
    "update_goals",
```

**Apply to Phase 60:** Add renderer functions/constants for proposal copy, generic proposal/authority fail-closed copy, field-specific validation range copy, and cancel neutral copy here or a close sibling. Use exact-copy tests and extend forbidden terms if new internal words are possible. Do not let the model author these strings.

---

### `server/orchestrator/index.ts` (orchestrator, event-driven tool loop)

**Analog:** mutation receipt construction and renderer-owned final reply short-circuit

**Imports and orchestrator dependency pattern** (`server/orchestrator/index.ts` lines 1-17, 37-45):
```typescript
import type { LLMProvider, ChatMessage, ProviderErrorMetadata } from "../llm/types.js";
import { isLLMProviderError } from "../llm/errors.js";
import type { createChatService } from "../services/chat.js";
import type { createSummaryService, DailySummary } from "../services/summary.js";
import type { createFoodLoggingService } from "../services/food-logging.js";
import type { createDeviceService, DailyTargets } from "../services/device.js";
import type { createMealCorrectionService } from "../services/meal-correction.js";
import type { RealtimePublisher } from "../realtime/publisher.js";
import { loadHistory } from "./history.js";
import { buildSystemPrompt } from "./system-prompt.js";
import {
  getToolDefinitions,
  executeTool,
  isFatalToolError,
  redactToolArgsForHook,
  type ToolExecutionResult,
} from "./tools.js";

interface OrchestratorDeps {
  llmProvider: LLMProvider;
  chatService: ReturnType<typeof createChatService>;
  summaryService: ReturnType<typeof createSummaryService>;
  foodLoggingService: ReturnType<typeof createFoodLoggingService>;
  mealCorrectionService?: ReturnType<typeof createMealCorrectionService>;
  deviceService: ReturnType<typeof createDeviceService>;
  publisher?: Pick<RealtimePublisher, "publishGoalsUpdate">;
}
```

**Checked renderer pattern** (`server/orchestrator/index.ts` lines 362-369):
```typescript
function renderCheckedMutationReceipt(effects: MutationEffects): string {
  const reply = renderMutationReceipt(effects);
  const forbiddenTerms = assertNoForbiddenReceiptTerms(reply);
  if (forbiddenTerms.length > 0) {
    throw new Error(`Mutation receipt contains forbidden terms: ${forbiddenTerms.join(", ")}`);
  }
  return reply;
}
```

**Existing `update_goals` success effect pattern** (`server/orchestrator/index.ts` lines 978-992):
```typescript
if (toolCall.function.name === "update_goals") {
  successfulGoalTargets = dailyTargets;
  if (!dailyTargets) {
    throw new Error("update_goals succeeded without dailyTargets");
  }
  mutationEffects = {
    kind: "goals",
    affectedDate: formatLocalDate(currentAppDate()),
    committedSummary: await deps.summaryService.getDailySummary(deviceId, currentAppDate()),
    committedTargets: dailyTargets,
    targets: dailyTargets,
    updatedFields: updatedFields as Array<keyof DailyTargets>,
  };
  mutationReceiptText = renderCheckedMutationReceipt(mutationEffects);
}
```

**Renderer-owned final reply pattern** (`server/orchestrator/index.ts` lines 1046-1060):
```typescript
if (mutationEffects) {
  const reply = mutationReceiptText ?? renderCheckedMutationReceipt(mutationEffects);
  opts?.hooks?.onLLMEnd?.(round + 1, true);
  return {
    reply,
    didLogMeal,
    didMutateMeal,
    dailySummary: logMealSummary,
    dailyTargets: successfulGoalTargets,
    affectedDate: resolvedAffectedDate,
    loggedMeal,
    loggedMealToolMessageId,
    finalReplySource: "renderer",
    finalReplyShape: classifyPlainReplyShape(reply),
  };
}
```

**Fallback after mutation pattern** (`server/orchestrator/index.ts` lines 789-803):
```typescript
if (mutationReceiptText && mutationEffects) {
  return {
    reply: mutationReceiptText,
    didLogMeal,
    didMutateMeal,
    dailySummary: logMealSummary,
    dailyTargets: successfulGoalTargets,
    affectedDate: resolvedAffectedDate,
    loggedMeal,
    loggedMealToolMessageId,
    finalReplySource: "renderer",
    finalReplyShape: classifyPlainReplyShape(mutationReceiptText),
    providerFallbackContext,
    fallbackOutcomeContext,
  };
}
```

**Apply to Phase 60:** Add a controlled goal outcome path before appending failed `update_goals` tool results for another model round. Proposal creation, authority failure, validation failure, and cancel should return backend copy with `finalReplySource: "renderer"` and no second LLM call.

---

### `server/orchestrator/source-text-guard.ts` (utility / guard, transform)

**Analog:** current numeric source guard. This is also the pattern to replace for proposal confirmation authority.

**Consent / cancel vocabulary guard** (`server/orchestrator/source-text-guard.ts` lines 46-62):
```typescript
function hasExplicitConfirmation(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/\s+/g, "");
  if (!normalized) return false;

  if (/(不要|不用|不行|不好|不是|不對|取消|先不要|先不用|no|not)/i.test(normalized)) {
    return false;
  }

  if (/^(好|可以|可|是|對|嗯|恩|ok|okay|yes|y|sure)$/.test(normalized)) {
    return true;
  }
  if (/(^|[，,。!！、])(好|可以|可|是|對|ok|okay|yes|y|sure)($|[，,。!！、])/.test(normalized)) {
    return true;
  }

  return /(幫我|直接)?(更新|套用|改成|照這樣|就這樣|用這組|照這組)/.test(normalized);
}
```

**Numeric field authorization pattern** (`server/orchestrator/source-text-guard.ts` lines 269-304):
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
  const confirmedAssistantRecommendation = hasExplicitConfirmation(
    context.currentUserMessage ?? "",
  );

  const guardedFields: string[] = [];
  for (const field of sourceFields) {
    const value = args[field];
    if (value === undefined || value === null) continue;
    if (typeof value !== "number" || !Number.isFinite(value)) {
      guardedFields.push(field);
      continue;
    }
    const key = String(value);
    if (userAllowed.has(key)) {
      continue;
    }
    if (assistantAllowed.has(key) && confirmedAssistantRecommendation) {
      continue;
    }
    guardedFields.push(field);
  }

  return { ok: guardedFields.length === 0, guardedFields };
}
```

**Apply to Phase 60:** Keep current-turn numeric authorization for `mode: "current_turn_values"`. Do not let `assistantAllowed.has(key) && confirmedAssistantRecommendation` authorize proposal mode. Add/export backend-owned `hasGoalConsent` and `hasGoalCancel` predicates or move them near the goal proposal service/tool contract.

---

### `server/orchestrator/system-prompt.ts` (config / prompt builder, transform)

**Analog:** existing sectioned system prompt builder

**Imports / builder style** (`server/orchestrator/system-prompt.ts` lines 1-17):
```typescript
import type { DailyTargets } from "../services/device.js";

interface IntakeContext {
  sex?: string | null;
  age?: number | null;
  heightCm?: number | null;
  weightKg?: number | null;
  activityLevel?: string | null;
  trainingFrequency?: string | null;
  allergies?: string | null;
  goalClarification?: string | null;
  bodyFatPercent?: number | null;
  tdee?: number | null;
  advancedNotes?: string | null;
}
```

**Goal update prompt section to replace** (`server/orchestrator/system-prompt.ts` lines 169-176):
```typescript
sections.push({
  id: SYSTEM_PROMPT_SECTION_IDS.goalUpdates,
  content: `目標更新規則：
1. 只有當使用者提供每日目標的具體數字時，才可以更新卡路里、蛋白質、碳水或脂肪目標。
2. 像「少吃一點」、「提高蛋白質」、「血糖控制」這類模糊目標變更意圖，不要直接更新；你要先根據目前每日目標與已提供的個人資料推薦一組具體數值，並詢問使用者是否要套用。
3. 若上一輪你已推薦具體數值，而使用者回覆「好」、「可以」、「幫我更新」、「就這樣」等明確同意，才可以依上一輪推薦的數字更新目標。
4. 成功更新後，最終回覆必須原文呈現工具回傳的收據文字，包含「已更新每日目標：」開頭與四行目標數值。
5. 不要向使用者提及內部工具名稱或系統欄位。`,
});
```

**Apply to Phase 60:** Rewrite this section so ambiguous goal changes call `propose_goals`, confirmations call explicit proposal-mode `update_goals`, cancel terms do not call mutation tools, and backend-rendered proposal/rejection/cancel copy must be preserved.

---

### `server/app.ts` (composition root, dependency injection)

**Analog:** existing service creation and orchestrator wiring

**Imports pattern** (`server/app.ts` lines 7-19):
```typescript
import { createDb } from "./db/client.js";
import { createDeviceService } from "./services/device.js";
import { createFoodLoggingService } from "./services/food-logging.js";
import { createSummaryService } from "./services/summary.js";
import { createDaySnapshotService } from "./services/day-snapshot.js";
import { createHistoryQueryService } from "./services/history-query.js";
import { createChatService } from "./services/chat.js";
import { createAssetService } from "./services/assets.js";
import { createMealCorrectionService } from "./services/meal-correction.js";
import { createGuestSessionService } from "./services/guest-session.js";
import { createOrchestrator } from "./orchestrator/index.js";
import { createTargetGenerationService } from "./services/target-generation.js";
import { RealtimePublisher } from "./realtime/publisher.js";
```

**Service creation and DI pattern** (`server/app.ts` lines 81-108):
```typescript
const deviceService = createDeviceService(db);
const targetGenerationService = createTargetGenerationService(llmProvider, app.log);
const foodLoggingService = createFoodLoggingService(db);
const guestSessionService = createGuestSessionService({
  secret: config.guestSessionSecret,
  activeCookieName: config.guestSessionCookieName,
  resumeCookieName: config.guestSessionResumeCookieName,
  activeTtlSeconds: config.guestSessionTtlSeconds,
  resumeTtlSeconds: config.guestSessionResumeTtlSeconds,
  secure: config.guestSessionCookieSecure,
});
const summaryService = createSummaryService(db);
const historyQueryService = createHistoryQueryService(db, { summaryService });
const daySnapshotService = createDaySnapshotService({ summaryService, foodLoggingService });
const chatService = createChatService(db);
const assetService = createAssetService(db, { assetsDir: opts.assetsDir ?? config.assetsDir });
const mealCorrectionService = createMealCorrectionService(db);
const publisher = new RealtimePublisher();

const orchestrator = createOrchestrator({
  llmProvider,
  chatService,
  summaryService,
  foodLoggingService,
  mealCorrectionService,
  deviceService,
  publisher,
});
```

**Test service exposure pattern** (`server/app.ts` lines 110-119):
```typescript
opts.onServicesReady?.({
  assetService,
  chatService,
  foodLoggingService,
  guestSessionService,
  historyQueryService,
  mealCorrectionService,
  orchestrator,
  summaryService,
});
```

**Apply to Phase 60:** Instantiate `goalProposalService` in `buildApp`, pass it into `createOrchestrator`, and expose it through `AppServices` only if integration tests need direct service access.

---

### `server/routes/chat.ts` (route, request-response + streaming)

**Analog:** final reply source and renderer-owned normalization behavior

**Final reply metadata types** (`server/routes/chat.ts` lines 19-24, 87-96):
```typescript
import type {
  LlmTraceFinalReplyShape,
  LlmTraceFinalReplySource,
  LlmTraceRecorder,
} from "../orchestrator/llm-trace.js";

interface StreamingReplyResult {
  fullReply: string;
  didLogMeal: boolean;
  dailySummary?: unknown;
  summaryHistoryFacts?: SummaryHistoryFacts;
  stopped?: boolean;
  tokensStreamed: number;
  finalReplySource: LlmTraceFinalReplySource;
  finalReplyShape: LlmTraceFinalReplyShape;
}
```

**SSE final source recording** (`server/routes/chat.ts` lines 931-934, 984-1008):
```typescript
recorder?.recordFinalReply({
  source: streamResult.finalReplySource,
  shape: streamResult.finalReplyShape,
});

const { reply: replyText, didLogMeal, dailySummary, summaryHistoryFacts, dailyTargets, affectedDate, loggedMeal } = result;
recorder?.recordFinalReply({
  source: result.finalReplySource ?? "model",
  shape: result.finalReplyShape ?? "empty_or_missing",
});
streamDidLogMeal = didLogMeal;
streamDidMutateMeal = result.didMutateMeal ?? didLogMeal;
streamDailySummary = dailySummary;
streamDailyTargets = dailyTargets;
streamAffectedDate = affectedDate;
streamLoggedMeal = loggedMeal ? buildPartialSuccessLoggedReply(loggedMeal) : undefined;
streamLoggedMealReceipt = projectLoggedMealReceipt(loggedMeal);
streamReceiptIdentity = buildReceiptIdentity(loggedMeal, result.loggedMealToolMessageId);
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
```

**JSON final source and publish boundary** (`server/routes/chat.ts` lines 1370-1395):
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
publishSummarySafe(publisher, deviceId, jsonDidMutateMeal, dailySummary, turnLog);
```

**Apply to Phase 60:** Prefer solving final rejected/cancel copy in orchestrator so both JSON and SSE paths inherit `finalReplySource: "renderer"`. Touch `chat.ts` only if new metadata shape is needed; keep renderer-owned replies out of route summary composition.

---

### `tests/unit/goal-proposals.test.ts` (test, CRUD + expiry)

**Analog:** `tests/unit/meal-correction.test.ts`

**Fixture imports and fixed time pattern** (`tests/unit/meal-correction.test.ts` lines 1-12):
```typescript
process.env.TZ = "Asia/Taipei";

import { afterEach, beforeEach, describe, it } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../../server/db/client.js";
import { createDeviceService } from "../../server/services/device.js";
import { createFoodLoggingService } from "../../server/services/food-logging.js";
import { createMealCorrectionService } from "../../server/services/meal-correction.js";

const REAL_DATE = Date;
const FIXED_NOW = new REAL_DATE("2026-04-19T12:00:00+08:00");
```

**Real SQLite setup pattern** (`tests/unit/meal-correction.test.ts` lines 54-66):
```typescript
beforeEach(async () => {
  globalThis.Date = FixedDate as DateConstructor;
  db = createDb(":memory:");
  const deviceService = createDeviceService(db);
  foodLoggingService = createFoodLoggingService(db);
  mealCorrectionService = createMealCorrectionService(db);
  deviceId = (await deviceService.createDevice("fat_loss")).deviceId;
  foreignDeviceId = (await deviceService.createDevice("muscle_gain")).deviceId;
});

afterEach(() => {
  globalThis.Date = REAL_DATE;
});
```

**Pending state behavior assertions** (`tests/unit/meal-correction.test.ts` lines 375-404, 406-433):
```typescript
it("creates a pending clarification state when multiple meals match and resolves the next numbered reply", async () => {
  const firstPass = await mealCorrectionService.findMeals(deviceId, "delete", "把今天午餐的雞腿飯刪掉");
  assert.equal(firstPass.status, "needs_clarification");
  assert.equal(firstPass.candidates.length, 2);
  assert.match(firstPass.prompt, /請直接回覆編號/);

  const secondPass = await mealCorrectionService.findMeals(deviceId, "delete", "第二個");
  assert.equal(secondPass.status, "resolved");
  assert.equal(secondPass.action, "delete");
  assert.equal(secondPass.resolvedMealId, first.id);
  assert.notEqual(secondPass.resolvedMealId, second.id);
  assert.equal(secondPass.fromPending, true);
});

it("does not reuse a pending selection for a different mutation action", async () => {
  const firstPass = await mealCorrectionService.findMeals(deviceId, "delete", "把今天午餐的雞腿飯刪掉");
  assert.equal(firstPass.status, "needs_clarification");

  const staleAction = await mealCorrectionService.findMeals(deviceId, "update", "第二個");

  assert.notEqual(staleAction.status, "resolved");
});
```

**Apply to Phase 60:** Cover create, overwrite, expire, clear on success, clear on cancel, and consumed replay. Use real SQLite and controlled `Date.now()` / `globalThis.Date` rather than mocking the DB.

---

### `tests/unit/update-goals-contract.test.ts` (test, request-response + CRUD side effects)

**Analog:** existing `update_goals` contract tests

**Imports and tool-call helper** (`tests/unit/update-goals-contract.test.ts` lines 1-22):
```typescript
import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { createDb } from "../../server/db/client.js";
import { createDeviceService, type DailyTargets } from "../../server/services/device.js";
import { createFoodLoggingService } from "../../server/services/food-logging.js";
import { createSummaryService } from "../../server/services/summary.js";
import {
  executeTool,
  toolRegistry,
  type ToolDeps,
} from "../../server/orchestrator/tools.js";
import type { ToolCall } from "../../server/llm/types.js";

function updateGoalsCall(args: unknown): ToolCall {
  return {
    id: "call_update_goals",
    type: "function",
    function: {
      name: "update_goals",
      arguments: JSON.stringify(args),
```

**Fixture and publisher spy pattern** (`tests/unit/update-goals-contract.test.ts` lines 33-50):
```typescript
beforeEach(async () => {
  const db = createDb(":memory:");
  deviceService = createDeviceService(db);
  foodLoggingService = createFoodLoggingService(db);
  summaryService = createSummaryService(db);
  deviceId = (await deviceService.createDevice("fat_loss")).deviceId;
  published = [];
  deps = {
    foodLoggingService,
    summaryService,
    deviceService,
    publisher: {
      publishGoalsUpdate(id: string, targets: DailyTargets) {
        published.push({ deviceId: id, targets });
        return { sent: 1 };
      },
    },
  } as ToolDeps;
});
```

**Validation and no-execute pattern** (`tests/unit/update-goals-contract.test.ts` lines 53-67):
```typescript
it("Test 1: rejects empty args and unknown fields with failureReason:\"validation\"", async () => {
  const empty = await executeTool(updateGoalsCall({}), deviceId, deps, {
    currentUserMessage: "",
  });
  assert.equal(empty.success, false);
  assert.equal(empty.executed, false);
  assert.equal(empty.failureReason, "validation");

  const unknown = await executeTool(updateGoalsCall({ calories: 1800, sugar: 20 }), deviceId, deps, {
    currentUserMessage: "卡路里 1800",
  });
  assert.equal(unknown.success, false);
  assert.equal(unknown.executed, false);
  assert.equal(unknown.failureReason, "validation");
});
```

**Success and publish pattern** (`tests/unit/update-goals-contract.test.ts` lines 101-115, 128-148):
```typescript
const result = await executeTool(updateGoalsCall({ calories: 1800, protein: 130 }), deviceId, deps, {
  currentUserMessage: "卡路里改 1800，蛋白質 130 克",
});

assert.equal(result.success, true);
assert.equal(result.result, "已更新每日目標：\n• 卡路里 1800 kcal\n• 蛋白質 130 g\n• 碳水 150 g\n• 脂肪 50 g");
assert.equal(result.summary, "updatedFields: calories,protein");

const device = await deviceService.getDevice(deviceId);
assert.equal(device?.dailyCalories, 1800);
assert.equal(device?.dailyProtein, 130);

await executeTool(updateGoalsCall({ calories: 1800 }), deviceId, localDeps, {
  currentUserMessage: "卡路里 1800",
});

assert.equal(getSummaryCalls, 0, "summaryService.getDailySummary must not be called");
assert.equal(published.length, 1);
```

**Apply to Phase 60:** Extend this file for explicit modes, proposal-mode consent, cancel, validation exact copy, field-name-only summaries, unchanged targets, no publish, and proposal clearing order.

---

### `tests/unit/mutation-receipts.test.ts` (test, transform)

**Analog:** existing exact-copy renderer tests

**Imports pattern** (`tests/unit/mutation-receipts.test.ts` lines 1-11):
```typescript
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { DailyTargets } from "../../server/services/device.js";
import type { DailySummary } from "../../server/services/summary.js";
import type { MutationEffects } from "../../server/orchestrator/mutation-effects.js";
import {
  FORBIDDEN_RECEIPT_TERMS,
  assertNoForbiddenReceiptTerms,
  renderMutationReceipt,
} from "../../server/orchestrator/mutation-receipts.js";
```

**Apply to Phase 60:** Add exact-copy tests for proposal copy, generic proposal/authority failure, field-specific validation range failure, and cancel neutral copy. Reuse `assertNoForbiddenReceiptTerms`.

---

### `tests/unit/orchestrator.test.ts` (test, event-driven tool loop)

**Analog:** mock LLM and local renderer short-circuit assertions

**Mock provider pattern** (`tests/unit/orchestrator.test.ts` lines 132-144):
```typescript
async chat(messages: ChatMessage[], tools: ToolDefinition[]): Promise<LLMResponse> {
  this.chatCalls.push({ messages, tools });
  const item = this.chatQueue.shift();
  if (item instanceof Error) {
    throw item;
  }
  return item ?? { content: "Mock: 已記錄您的飲食！" };
}

async *chatStream(messages: ChatMessage[], tools: ToolDefinition[]): AsyncGenerator<string> {
  this.chatCalls.push({ messages, tools });
  yield* streamTokens(this.streamTokens);
}
```

**Source-scan pattern for committed mutation families** (`tests/unit/orchestrator.test.ts` lines 169-177):
```typescript
it("builds committed MutationEffects for every successful mutation family", () => {
  const source = readFileSync(new URL("../../server/orchestrator/index.ts", import.meta.url), "utf8");

  assert.match(source, /let mutationEffects: MutationEffects \| undefined/);
  for (const kind of ["log", "update", "delete", "goals"]) {
    assert.match(source, new RegExp(`kind: "${kind}"`));
  }
  assert.doesNotMatch(source, /successfulGoalReceipt|ensureGoalReceipt/);
});
```

**No-model local recovery pattern** (`tests/unit/orchestrator.test.ts` lines 1064-1082):
```typescript
it("recovers locally when the user replies 2 to a previously hallucinated choice prompt", async () => {
  await chatService.saveMessage(deviceId, "user", "(圖片)", { imagePath: "asset:meal-image" });
  await chatService.saveMessage(deviceId, "tool", "成功", { toolName: "log_food" });
  await chatService.saveMessage(
    deviceId,
    "assistant",
    "已收到圖片。若你選擇方式1，我會請你補充份量；若你選擇方式2，我會直接估算並記錄。",
  );

  const result = await orchestrator.handleMessage(deviceId, "2");

  if (!("reply" in result)) throw new Error("expected reply result");
  assert.equal(result.didLogMeal, false);
  assert.equal(
    result.reply,
    "這餐剛剛已先依目前估算完成記錄。若你想更精準，我可以再依份量幫你調整。"
  );
  assert.equal(mockLLM.chatCalls.length, 0, "recovery path should not call the model again");
});
```

**Apply to Phase 60:** Add assertions that rejected/cancel goal paths return `finalReplySource: "renderer"` and do not request a second model reply. Prefer direct orchestrator tests for short-circuit semantics, with integration tests covering route payloads.

---

### `tests/integration/chat-goal-update.integration.test.ts` (test, request-response + integration)

**Analog:** existing goal update HTTP integration suite

**Imports and app fixture** (`tests/integration/chat-goal-update.integration.test.ts` lines 1-7, 27-39):
```typescript
process.env.TZ = "Asia/Taipei";

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { buildApp } from "../../server/app.js";
import { MockLLMProvider } from "../../server/llm/mock.js";
import type { FastifyInstance } from "fastify";

beforeEach(async () => {
  mockLLM = new MockLLMProvider();
  app = await buildApp({ dbPath: ":memory:", llmProvider: mockLLM });
  const res = await app.inject({ method: "POST", url: "/api/device", payload: { goal: "fat_loss" } });
  sessionCookieHeader = toCookieHeader(res.headers["set-cookie"]);
  address = await app.listen({ port: 0 });
});

afterEach(async () => {
  if (app.server.listening) {
    await app.close();
  }
});
```

**HTTP helper and target readback pattern** (`tests/integration/chat-goal-update.integration.test.ts` lines 41-69):
```typescript
async function postChat(message: string): Promise<{
  status: number;
  body: { reply: string; didLogMeal: boolean; dailyTargets?: DailyTargets };
}> {
  const form = new FormData();
  form.append("message", message);

  const res = await fetch(`${address}/api/chat`, {
    method: "POST",
    headers: { cookie: sessionCookieHeader },
    body: form,
  });

  return { status: res.status, body: await res.json() };
}

async function readTargets(): Promise<DailyTargets> {
  const res = await fetch(`${address}/api/device/goals`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      cookie: sessionCookieHeader,
    },
    body: JSON.stringify({ fat: 50 }),
  });
```

**Renderer-owned success proof pattern** (`tests/integration/chat-goal-update.integration.test.ts` lines 109-139, 141-171):
```typescript
it("returns only the deterministic receipt when the final model reply tries to add prose", async () => {
  mockLLM.queueChatResponse({
    toolCalls: [{
      id: "goal_success_omitted_receipt",
      type: "function",
      function: {
        name: "update_goals",
        arguments: JSON.stringify({ calories: 1800, protein: 130 }),
      },
    }],
  });
  mockLLM.queueChatResponse({ content: "已經幫你更新好了。" });

  const { status, body } = await postChat("卡路里改成 1800，蛋白質 130 克");

  assert.equal(status, 200);
  assert.equal(body.reply, "已更新每日目標：\n• 卡路里 1800 kcal\n• 蛋白質 130 g\n• 碳水 150 g\n• 脂肪 50 g");
  assert.doesNotMatch(body.reply, /已經幫你更新好了/);
});

it("returns the deterministic receipt without calling final reply generation after mutation", async () => {
  mockLLM.queueChatResponse({
    toolCalls: [{
      id: "goal_success_reply_error",
      type: "function",
      function: {
        name: "update_goals",
        arguments: JSON.stringify({ calories: 1800, protein: 130 }),
      },
    }],
  });
  mockLLM.queueChatError(new Error("reply generation failed"));

  const { status, body } = await postChat("卡路里改成 1800，蛋白質 130 克");

  assert.equal(status, 200);
  assert.equal(body.reply, "已更新每日目標：\n• 卡路里 1800 kcal\n• 蛋白質 130 g\n• 碳水 150 g\n• 脂肪 50 g");
  assert.equal(mockLLM.chatCalls.length, 1);
});
```

**Current rejection behavior to replace** (`tests/integration/chat-goal-update.integration.test.ts` lines 232-285):
```typescript
it("turns source-guard rejection into clarification and does not mutate targets", async () => {
  mockLLM.queueChatResponse({
    toolCalls: [{
      id: "goal_guard",
      type: "function",
      function: {
        name: "update_goals",
        arguments: JSON.stringify({ calories: 1700 }),
      },
    }],
  });
  mockLLM.queueChatResponse({ content: "你想把卡路里調整成多少？請提供具體數字。" });

  const { status, body } = await postChat("我想少吃一點");

  assert.equal(status, 200);
  assert.equal(body.didLogMeal, false);
  assert.match(body.reply, /具體數字|調整成多少/);
  assert.doesNotMatch(body.reply, /已更新每日目標：/);
  assert.deepEqual(await readTargets(), {
    calories: 1500,
    protein: 120,
    carbs: 150,
    fat: 50,
  });
});
```

**Apply to Phase 60:** Update this suite so vague intent uses `propose_goals`, short consent uses proposal mode, source/validation/proposal/cancel failures return exact backend copy, targets remain unchanged, `mockLLM.chatCalls.length` proves no rewrite, and route responses expose renderer-owned source through trace/metadata where available.

## Shared Patterns

### Tool Validation and Controlled Failures
**Source:** `server/orchestrator/tool-contract.ts` lines 7-33, 111-188  
**Apply to:** `server/orchestrator/tools.ts`, `tests/unit/update-goals-contract.test.ts`
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

const validated = contract.zodSchema.safeParse(rawParsed);
if (!validated.success) {
  const fields = extractFieldPaths(validated.error.issues);
  return {
    success: false,
    executed: false,
    failureReason: "validation",
    result: stringifyFailure({
      reason: "schema_validation",
      failureReason: "validation",
      fields,
    }),
    logSummary: `<${contract.name} args>`,
  };
}
```

### One-Active Pending State
**Source:** `server/db/schema.ts` lines 175-190 and `server/services/turn-state.ts` lines 39-42  
**Apply to:** `server/services/goal-proposals.ts`
```typescript
export const turnStates = sqliteTable(
  "turn_states",
  {
    id: text("id").primaryKey(),
    deviceId: text("device_id")
      .notNull()
      .references(() => devices.id),
    kind: text("kind").notNull(),
    payload: text("payload").notNull(),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("turn_states_device_kind_uq").on(table.deviceId, table.kind),
    index("turn_states_device_expires_idx").on(table.deviceId, table.expiresAt),
  ],
);

ON CONFLICT(device_id, kind) DO UPDATE SET
  payload = excluded.payload,
  expires_at = excluded.expires_at,
  updated_at = excluded.updated_at
```

### Renderer-Owned Replies
**Source:** `server/orchestrator/index.ts` lines 1046-1060 and `server/routes/chat.ts` lines 997-1008  
**Apply to:** `server/orchestrator/index.ts`, `server/routes/chat.ts`, renderer tests
```typescript
if (mutationEffects) {
  const reply = mutationReceiptText ?? renderCheckedMutationReceipt(mutationEffects);
  opts?.hooks?.onLLMEnd?.(round + 1, true);
  return {
    reply,
    didLogMeal,
    didMutateMeal,
    dailySummary: logMealSummary,
    dailyTargets: successfulGoalTargets,
    finalReplySource: "renderer",
    finalReplyShape: classifyPlainReplyShape(reply),
  };
}

const shouldComposeSummaryHistory = result.finalReplySource !== "renderer"
  && !result.fallbackOutcomeContext;
```

### Publish Boundary
**Source:** `server/orchestrator/tools.ts` lines 1286-1295 and `tests/unit/update-goals-contract.test.ts` lines 128-148  
**Apply to:** `server/orchestrator/tools.ts`, integration tests
```typescript
const updatedFields = updatedGoalFields(args);
const targets = await deps.deviceService.updateGoals(deviceId, args);
deps.publisher.publishGoalsUpdate(deviceId, targets);

return {
  ok: true,
  result: {
    targets,
    updatedFields,
    publishedEvents: ["goals_update"],
  },
```

Phase 60 must preserve the positive publish pattern only for committed target persistence. Proposal creation, proposal rejection, validation failure, guard failure, and cancel must not call `publishGoalsUpdate`.

### Metadata-Only Logging
**Source:** `server/orchestrator/tool-contract.ts` lines 28-32 and `tests/unit/update-goals-contract.test.ts` lines 117-126  
**Apply to:** all new/changed tool contracts and tests
```typescript
/**
 * Redacted log summary. Must not include raw user text or raw numeric
 * values (D-30). Field names and booleans only.
 */
logSummary: (args: Args) => Record<string, unknown>;

const summary = contract.logSummary({ calories: 1800, protein: 130 });
const serialized = JSON.stringify(summary);
assert.match(serialized, /calories/);
assert.match(serialized, /protein/);
assert.doesNotMatch(serialized, /1800/);
assert.doesNotMatch(serialized, /130/);
```

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| None | - | - | All planned files have close repo analogs. |

## Planner Notes

- Prefer latest-active proposal mode unless planning proves a hidden `proposal_id` can be passed to the next-turn model without exposing it in user-visible copy. The current repo has no distinct hidden model-visible proposal-id channel.
- Do not modify `server/db/schema.ts` for Phase 60 unless rejecting the locked `turn_states` storage decision.
- Do not add runtime dependencies; existing Zod, ToolContract, SQLite, and MockLLMProvider patterns cover the phase.
- Verification commands should come from `60-VALIDATION.md`: targeted `node scripts/run-node-with-tz.mjs --import tsx --test ...`, then `yarn tsc --noEmit && yarn test:unit && yarn test:integration` before verification closure.

## Metadata

**Analog search scope:** `server/orchestrator`, `server/services`, `server/routes`, `server/realtime`, `tests/unit`, `tests/integration`  
**Files scanned:** 117 repo files from the target server/test scopes, plus `AGENTS.md` and local `.codex/skills/*/SKILL.md` project skills  
**Pattern extraction date:** 2026-05-17
