import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createDb } from "../../server/db/client.js";
import { createDeviceService } from "../../server/services/device.js";
import { createFoodLoggingService } from "../../server/services/food-logging.js";
import { createGoalProposalService } from "../../server/services/goal-proposals.js";
import { createMealCorrectionService } from "../../server/services/meal-correction.js";
import { createMealDeleteProposalService } from "../../server/services/meal-delete-proposals.js";
import { createMealNumericProposalService } from "../../server/services/meal-numeric-proposals.js";
import { createProposalActionService } from "../../server/services/proposal-actions.js";
import { createProposalCardService } from "../../server/services/proposal-cards.js";
import { createSummaryService } from "../../server/services/summary.js";
import { createChatService } from "../../server/services/chat.js";
import { DEFAULT_SESSION_ID } from "../../server/services/turn-state.js";
import { MockLLMProvider } from "../../server/llm/mock.js";
import { RealtimePublisher } from "../../server/realtime/publisher.js";
import type {
  ChatMessage,
  GenerateObjectRequest,
  GenerateObjectResult,
  ToolDefinition,
  LLMResponse,
  LLMRoundResult,
  LLMProvider,
} from "../../server/llm/types.js";
import { createOrchestrator, guardNoMutationSuccessClaim } from "../../server/orchestrator/index.js";
import {
  createEmptyCommittedMutationState,
  mutationOutcomeFactFromEffects,
  projectCommittedMutationState,
  type CommittedMutationState,
} from "../../server/orchestrator/mutation-effects.js";
import type { MutationEffects } from "../../server/orchestrator/mutation-effects.js";
import { currentAppDate, formatLocalDate } from "../../server/lib/time.js";
import {
  renderGoalAuthorityFailureCopy,
  renderGoalCancelCopy,
  renderGoalProposalCopy,
  renderGoalValidationFailureCopy,
  renderMealDeleteCancelCopy,
  renderMealNumericCancelCopy,
  renderMutationReceipt,
  renderProposalInactiveCopy,
  renderProposalKindAmbiguityCopy,
} from "../../server/orchestrator/mutation-receipts.js";
import { CHOICE_PROMPT_PATTERN } from "../../server/orchestrator/patterns.js";

function assertString(value: unknown): asserts value is string {
  assert.equal(typeof value, "string");
}

type ExpectedMutationOutcomeFact = {
  action: "log_food" | "update_meal" | "delete_meal" | "update_goals";
  affectedDate: string;
  [key: string]: unknown;
};

function getMutationOutcomeFact(result: unknown): Record<string, unknown> | undefined {
  const maybeResult = result as { mutationOutcomeFact?: Record<string, unknown> };
  return maybeResult.mutationOutcomeFact;
}

function assertNoForbiddenOutcomeFactSurface(
  fact: object,
  forbiddenValues: string[] = [],
) {
  for (const forbiddenKey of [
    "mealId",
    "mealRevisionId",
    "deviceId",
    "rawToolArgs",
    "rawToolResult",
    "toolArgs",
    "toolResult",
    "summaryOutcome",
    "providerMetadata",
    "assistantFinalText",
    "finalReply",
    "debug",
    "protocol",
  ]) {
    assert.equal(forbiddenKey in fact, false, forbiddenKey);
  }

  const serialized = JSON.stringify(fact);
  for (const forbiddenValue of forbiddenValues) {
    assert.equal(serialized.includes(forbiddenValue), false, forbiddenValue);
  }
}

function assertMutationOutcomeFact(
  result: unknown,
  expected: ExpectedMutationOutcomeFact,
  forbiddenValues: string[] = [],
) {
  const fact = getMutationOutcomeFact(result);
  assert.deepEqual(fact, expected, "missing mutationOutcomeFact propagation");
  assertNoForbiddenOutcomeFactSurface(fact, forbiddenValues);
}

describe("mutationOutcomeFactFromEffects", () => {
  const committedTargets = {
    calories: 1800,
    protein: 130,
    carbs: 190,
    fat: 55,
  };
  const summaryOutcome = { status: "unavailable", reason: "recompute_failed" } as const;

  it("maps committed log effects to safe log_food facts", () => {
    const effects: MutationEffects = {
      kind: "log",
      affectedDate: "2026-03-25",
      committedTargets,
      summaryOutcome,
      meal: {
        mealId: "meal-internal",
        mealRevisionId: "revision-internal",
        dateKey: "2026-03-25",
        loggedAt: "2026-03-25T04:30:00.000Z",
        foodName: "牛肉麵",
        calories: 520,
        protein: 24,
        carbs: 68,
        fat: 16,
        itemCount: 1,
      },
    };

    const fact = mutationOutcomeFactFromEffects(effects);

    assert.deepEqual(fact, {
      action: "log_food",
      affectedDate: "2026-03-25",
      foodName: "牛肉麵",
      calories: 520,
      protein: 24,
      carbs: 68,
      fat: 16,
    });
    assertNoForbiddenOutcomeFactSurface(fact, [
      "meal-internal",
      "revision-internal",
      "recompute_failed",
    ]);
  });

  it("maps committed update effects to safe update_meal facts", () => {
    const effects: MutationEffects = {
      kind: "update",
      affectedDate: "2026-03-25",
      committedTargets,
      summaryOutcome,
      meal: {
        mealId: "updated-meal-internal",
        mealRevisionId: "updated-revision-internal",
        dateKey: "2026-03-25",
        loggedAt: "2026-03-25T04:30:00.000Z",
        foodName: "半份雞腿便當",
        calories: 360,
        protein: 20,
        carbs: 45,
        fat: 10,
        itemCount: 1,
      },
    };

    const fact = mutationOutcomeFactFromEffects(effects);

    assert.deepEqual(fact, {
      action: "update_meal",
      affectedDate: "2026-03-25",
      foodName: "半份雞腿便當",
      calories: 360,
      protein: 20,
      carbs: 45,
      fat: 10,
    });
    assertNoForbiddenOutcomeFactSurface(fact, [
      "updated-meal-internal",
      "updated-revision-internal",
      "recompute_failed",
    ]);
  });

  it("maps committed delete effects from deletedMeal, not receipt copy", () => {
    const effects: MutationEffects = {
      kind: "delete",
      affectedDate: "2026-03-25",
      committedTargets,
      summaryOutcome,
      deletedMeal: {
        mealId: "deleted-meal-internal",
        dateKey: "2026-03-25",
        loggedAt: "2026-03-25T04:30:00.000Z",
        foodName: "雞腿便當",
        calories: 620,
        protein: 24,
      },
    };

    const fact = mutationOutcomeFactFromEffects(effects);

    assert.deepEqual(fact, {
      action: "delete_meal",
      affectedDate: "2026-03-25",
      foodName: "雞腿便當",
      calories: 620,
      protein: 24,
    });
    assertNoForbiddenOutcomeFactSurface(fact, [
      "deleted-meal-internal",
      "已刪除雞腿便當",
      "recompute_failed",
    ]);
  });

  it("maps committed goal effects to changed goal values only", () => {
    const effects: MutationEffects = {
      kind: "goals",
      affectedDate: "2026-03-25",
      committedTargets,
      targets: committedTargets,
      updatedFields: ["calories", "protein"],
    };

    const fact = mutationOutcomeFactFromEffects(effects);

    assert.deepEqual(fact, {
      action: "update_goals",
      affectedDate: "2026-03-25",
      updatedGoals: [
        { label: "卡路里", value: 1800, unit: "kcal" },
        { label: "蛋白質", value: 130, unit: "g" },
      ],
    });
    assertNoForbiddenOutcomeFactSurface(fact, ["carbs", "fat"]);
  });
});

describe("direct orchestrator mutation receipt egress", () => {
  it("routes log, update, delete, and goals receipts through the guarded wrapper", () => {
    const source = orchestratorIndexSourceWithoutComments();

    assert.match(source, /renderGuardedMutationReceipt/);
    assert.match(source, /const renderReceipt = \(effects: MutationEffects\) =>\s*renderGuardedMutationReceipt/);
    assert.doesNotMatch(source, /function renderCheckedMutationReceipt/);
    assert.doesNotMatch(source, /assertNoForbiddenReceiptTerms/);
    assert.equal(
      (source.match(/mutationReceiptText\s*=\s*renderReceipt\(mutationEffects\)/g) ?? []).length,
      4,
    );
  });
});

describe("no-mutation success-claim guard", () => {
  const committedTargets = {
    calories: 1800,
    protein: 130,
    carbs: 190,
    fat: 55,
  };
  const summaryOutcome = { status: "unavailable", reason: "recompute_failed" } as const;
  const today = formatLocalDate(currentAppDate());

  function guardWithState(reply: string, state: CommittedMutationState = createEmptyCommittedMutationState()) {
    const projection = projectCommittedMutationState(state);
    return guardNoMutationSuccessClaim(reply, projection);
  }

  function stateFor(effects: MutationEffects): CommittedMutationState {
    return {
      effects,
      receiptText: renderMutationReceipt(effects),
      mutationOutcomeFact: mutationOutcomeFactFromEffects(effects),
      affectedDate: effects.affectedDate,
    };
  }

  const logEffects: MutationEffects = {
    kind: "log",
    affectedDate: today,
    committedTargets,
    summaryOutcome,
    meal: {
      mealId: "log-meal",
      mealRevisionId: "log-meal:r1",
      dateKey: today,
      loggedAt: `${today}T04:30:00.000Z`,
      foodName: "雞腿便當",
      calories: 620,
      protein: 24,
      carbs: 70,
      fat: 18,
      itemCount: 1,
    },
  };
  const updateEffects: MutationEffects = {
    kind: "update",
    affectedDate: today,
    committedTargets,
    summaryOutcome,
    meal: {
      mealId: "update-meal",
      mealRevisionId: "update-meal:r2",
      dateKey: today,
      loggedAt: `${today}T04:30:00.000Z`,
      foodName: "半份雞腿便當",
      calories: 360,
      protein: 20,
      carbs: 45,
      fat: 10,
      itemCount: 1,
    },
  };
  const deleteEffects: MutationEffects = {
    kind: "delete",
    affectedDate: today,
    committedTargets,
    summaryOutcome,
    deletedMeal: {
      mealId: "delete-meal",
      dateKey: today,
      loggedAt: `${today}T04:30:00.000Z`,
      foodName: "雞腿便當",
      calories: 620,
      protein: 24,
    },
  };
  const goalsEffects: MutationEffects = {
    kind: "goals",
    affectedDate: today,
    committedTargets,
    targets: committedTargets,
    updatedFields: ["calories", "protein", "carbs", "fat"],
  };

  it("falls back when no committed mutation exists but copy claims any mutation verb succeeded", () => {
    for (const claim of [
      "已記錄雞腿便當，620 kcal，蛋白質 24 g。",
      "已更新雞腿便當，620 kcal，蛋白質 24 g。",
      "已刪除雞腿便當，已從當日紀錄移除。",
      "已更新每日目標：\n• 卡路里 1800 kcal",
    ]) {
      const guarded = guardWithState(claim);
      assert.notEqual(guarded, claim);
      assert.doesNotMatch(guarded, /已記錄雞腿便當|已更新雞腿便當|已刪除雞腿便當|已更新每日目標/);
    }
  });

  it("blocks cross-verb success claims when the committed kind does not match the copy", () => {
    assert.notEqual(guardWithState("已刪除雞腿便當，已從當日紀錄移除。", stateFor(logEffects)), "已刪除雞腿便當，已從當日紀錄移除。");
    assert.notEqual(guardWithState("已更新雞腿便當，620 kcal，蛋白質 24 g。", stateFor(deleteEffects)), "已更新雞腿便當，620 kcal，蛋白質 24 g。");
    assert.notEqual(guardWithState("已記錄雞腿便當，620 kcal，蛋白質 24 g。", stateFor(updateEffects)), "已記錄雞腿便當，620 kcal，蛋白質 24 g。");
    assert.notEqual(guardWithState("已更新每日目標：\n• 卡路里 1800 kcal", stateFor(updateEffects)), "已更新每日目標：\n• 卡路里 1800 kcal");
  });

  it("preserves canonical committed receipts byte-for-byte for matching mutation kinds", () => {
    for (const effects of [logEffects, updateEffects, deleteEffects, goalsEffects]) {
      const receipt = renderMutationReceipt(effects);
      assert.equal(guardWithState(receipt, stateFor(effects)), receipt);
    }
    assert.equal(renderMutationReceipt(goalsEffects), "已更新每日目標：\n• 卡路里 1800 kcal\n• 蛋白質 130 g\n• 碳水 190 g\n• 脂肪 55 g");
    assert.equal(renderMutationReceipt(updateEffects), "已更新半份雞腿便當，360 kcal，蛋白質 20 g。");
  });
});

function codePointLength(value: string) {
  return [...value].length;
}

function orchestratorIndexSourceWithoutComments() {
  const source = readFileSync(new URL("../../server/orchestrator/index.ts", import.meta.url), "utf8");
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"))
    .join("\n");
}

function assertSuccessfulLogReplyShape(
  reply: string,
  opts: {
    fullFoodName: string;
    expectsUncertainty: boolean;
    allowsNextStep?: boolean;
  },
) {
  assert.doesNotMatch(reply, /\n/, "successful log replies must not contain newlines");
  assert.doesNotMatch(reply, /[\u{1F300}-\u{1FAFF}]/u, "successful log replies must not contain emoji");
  assert.doesNotMatch(reply, /^#/m, "successful log replies must not contain markdown headings");
  assert.doesNotMatch(reply, /(?:^|\n)\s*[-*•]\s|[|].*[|]/, "successful log replies must not contain bullets or tables");
  assert.match(reply, /已記錄/);
  assert.match(reply, new RegExp(opts.fullFoodName));
  assert.match(reply, /kcal/);
  assert.match(reply, /蛋白質\s*\d+(?:\.\d+)?\s*g/);
  assert.ok(codePointLength(reply) <= 120, "successful log replies must be <= 120 JavaScript code points");

  const nextStepClauses = reply
    .split("。")
    .filter((clause) => /(下次|建議|可以再|若你|如果|調整)/.test(clause));
  assert.ok(nextStepClauses.length <= 1, "successful log replies may include at most one next-step clause");
  if (opts.allowsNextStep === false) {
    assert.equal(nextStepClauses.length, 0, "successful log replies without deterministic precision trigger should not include a next step");
  }

  if (opts.expectsUncertainty === true) {
    assert.doesNotMatch(reply, /\d+\s*[-~－]\s*\d+\s*kcal|區間/);
    assert.doesNotMatch(reply, /(份量|油脂與飯量|湯底與份量).*主要誤差/);
  } else {
    assert.doesNotMatch(reply, /\d+\s*[-~－]\s*\d+\s*kcal|區間/);
    assert.doesNotMatch(reply, /(份量|油脂與飯量|湯底與份量).*主要誤差/);
  }

  assert.doesNotMatch(reply, /log_food|protein_sources|usedConservativeAssumption|quantityUncertaintyReason|missing_quantity/);
}

class StreamingLLMProvider implements LLMProvider {
  private chatQueue: Array<LLMResponse | Error> = [];
  private roundQueue: Array<LLMRoundResult | Error> = [];
  private callIndex = 0;
  public chatCalls: Array<{ messages: ChatMessage[]; tools: ToolDefinition[] }> = [];

  queueChatResponse(response: LLMResponse) {
    this.chatQueue.push(response);
  }

  queueChatError(error: Error) {
    this.chatQueue.push(error);
  }

  queueChatStream(tokens: string[]) {
    this.roundQueue.push({ kind: "stream", streamGenerator: streamTokens(tokens) });
  }

  queueChatStreamError(tokens: string[], error: Error) {
    this.roundQueue.push({ kind: "stream", streamGenerator: streamTokensThenThrow(tokens, error) });
  }

  queueRoundResponse(response: LLMResponse) {
    this.roundQueue.push({ kind: "response", response });
  }

  async chat(messages: ChatMessage[], tools: ToolDefinition[]): Promise<LLMResponse> {
    this.chatCalls.push({ messages, tools });
    if (this.callIndex < this.chatQueue.length) {
      const item = this.chatQueue[this.callIndex++];
      if (item instanceof Error) {
        throw item;
      }
      return item;
    }

    return { content: "Mock: 已記錄您的飲食！" };
  }

  async chatRound(messages: ChatMessage[], tools: ToolDefinition[]): Promise<LLMRoundResult> {
    this.chatCalls.push({ messages, tools });
    const item = this.roundQueue.shift();
    if (item instanceof Error) {
      throw item;
    }
    if (item) {
      return item;
    }
    return { kind: "response", response: { content: "Mock: 已記錄您的飲食！" } };
  }

  async generateObject<T>(
    _messages: ChatMessage[],
    _request: GenerateObjectRequest<T>,
  ): Promise<GenerateObjectResult<T>> {
    throw new Error("generateObject unexpectedly called by this test provider");
  }

  reset() {
    this.chatQueue = [];
    this.roundQueue = [];
    this.callIndex = 0;
    this.chatCalls = [];
  }
}

class ChatStreamOnlyProvider implements LLMProvider {
  private chatQueue: Array<LLMResponse | Error> = [];
  private streamTokens: string[] = [];
  public chatCalls: Array<{ messages: ChatMessage[]; tools: ToolDefinition[] }> = [];

  queueChatResponse(response: LLMResponse) {
    this.chatQueue.push(response);
  }

  queueChatStream(tokens: string[]) {
    this.streamTokens = tokens;
  }

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

  async generateObject<T>(
    _messages: ChatMessage[],
    _request: GenerateObjectRequest<T>,
  ): Promise<GenerateObjectResult<T>> {
    throw new Error("generateObject unexpectedly called by this test provider");
  }
}

async function* streamTokens(tokens: string[]): AsyncGenerator<string> {
  for (const token of tokens) {
    yield token;
  }
}

async function* streamTokensThenThrow(tokens: string[], error: Error): AsyncGenerator<string> {
  for (const token of tokens) {
    yield token;
  }
  throw error;
}

describe("orchestrator shared patterns", () => {
  const noMutationProjection = projectCommittedMutationState(createEmptyCommittedMutationState());

  it("matches the known 方式1/方式2 hallucinated choice prompt shape", () => {
    assert.equal(
      CHOICE_PROMPT_PATTERN.test("若你選擇方式1，我會請你補充份量；若你選擇方式2，我會直接估算。"),
      true,
    );
    assert.equal(CHOICE_PROMPT_PATTERN.test("我會直接依照片估算並完成記錄。"), false);
  });

  it("builds committed MutationEffects for every successful mutation family", () => {
    const source = readFileSync(new URL("../../server/orchestrator/index.ts", import.meta.url), "utf8");

    assert.match(source, /let mutationEffects: MutationEffects \| undefined/);
    for (const kind of ["log", "update", "delete", "goals"]) {
      assert.match(source, new RegExp(`kind: "${kind}"`));
    }
    assert.doesNotMatch(source, /successfulGoalReceipt|ensureGoalReceipt/);
  });

  it("Phase 67 D-26/D-27/D-28 removes raw-message correction clarification rendering from orchestrator", () => {
    const source = readFileSync(new URL("../../server/orchestrator/index.ts", import.meta.url), "utf8");

    assert.doesNotMatch(source, /buildCorrectionClarificationReply/);
    assert.doesNotMatch(source, /extractUserCorrectionTarget/);
    assert.doesNotMatch(source, /formatCorrectionCandidate/);
    assert.doesNotMatch(source, /parseCorrectionToolResult/);
    assert.doesNotMatch(source, /correctionClarificationReply/);
  });

  it("Phase 68 D-01/D-07/D-08/D-23 keeps serialized clarification parsing out of orchestrator source", () => {
    const source = orchestratorIndexSourceWithoutComments();

    assert.match(source, /controlledReply/);
    assert.doesNotMatch(source, /JSON\.parse\s*\(/);
    assert.doesNotMatch(source, /\bcontractResult\b/);
    assert.doesNotMatch(source, /\bbuildHistoricalToolMessage\b/);
    assert.doesNotMatch(source, /\brenderHistorical(?:LogFood|Summary)/);
    assert.doesNotMatch(source, /\bneeds_clarification\b/);
    assert.doesNotMatch(source, /\bmultiple_targets\b/);
  });

  it("guards no-mutation meal-specific summary claims against actual facts", () => {
    const emptyFactsReply = guardNoMutationSuccessClaim(
      "今天已記錄牛肉飯，650 kcal。",
      noMutationProjection,
      {
        summaryHistoryFacts: {
          dailySummary: {
            totalCalories: 0,
            totalProtein: 0,
            totalCarbs: 0,
            totalFat: 0,
            mealCount: 0,
            date: "2026-05-16",
          },
          meals: [],
        },
      },
    );
    assert.doesNotMatch(emptyFactsReply, /已記錄牛肉飯|650 kcal/);
    assert.match(emptyFactsReply, /還沒有把這餐寫入紀錄/);

    const mismatchedFactsReply = guardNoMutationSuccessClaim(
      "今天已記錄牛肉飯，650 kcal。",
      noMutationProjection,
      {
        summaryHistoryFacts: {
          dailySummary: {
            totalCalories: 520,
            totalProtein: 24,
            totalCarbs: 70,
            totalFat: 14,
            mealCount: 1,
            date: "2026-05-16",
          },
          meals: [{ foodName: "豆腐飯", calories: 520 }],
        },
      },
    );
    assert.doesNotMatch(mismatchedFactsReply, /已記錄牛肉飯|650 kcal/);

    const matchingFactsReply = guardNoMutationSuccessClaim(
      "目前已記錄的餐點有豆腐飯，約 520 kcal。",
      noMutationProjection,
      {
        summaryHistoryFacts: {
          dailySummary: {
            totalCalories: 520,
            totalProtein: 24,
            totalCarbs: 70,
            totalFat: 14,
            mealCount: 1,
            date: "2026-05-16",
          },
          meals: [{ foodName: "豆腐飯", calories: 520 }],
        },
      },
    );
    assert.equal(matchingFactsReply, "目前已記錄的餐點有豆腐飯，約 520 kcal。");
  });

  it("guards no-mutation aggregate summary claims against count and calorie facts", () => {
    const facts = {
      summaryHistoryFacts: {
        dailySummary: {
          totalCalories: 900,
          totalProtein: 80,
          totalCarbs: 75,
          totalFat: 24,
          mealCount: 2,
          date: "2026-05-16",
        },
        meals: [
          { foodName: "雞胸肉", calories: 450 },
          { foodName: "鮭魚飯", calories: 450 },
        ],
      },
    };

    assert.equal(
      guardNoMutationSuccessClaim("今天已記錄 2 餐，共 900 kcal。", noMutationProjection, facts),
      "今天已記錄 2 餐，共 900 kcal。",
    );

    const dayTotalAsSingleMeal = guardNoMutationSuccessClaim(
      "今天已記錄雞胸肉，900 kcal。",
      noMutationProjection,
      facts,
    );
    assert.doesNotMatch(dayTotalAsSingleMeal, /已記錄雞胸肉|900 kcal/);

    const wrongCount = guardNoMutationSuccessClaim("今天已記錄 3 餐，共 900 kcal。", noMutationProjection, facts);
    assert.doesNotMatch(wrongCount, /今天已記錄 3 餐/);

    const wrongCalories = guardNoMutationSuccessClaim("今天已記錄 2 餐，共 1200 kcal。", noMutationProjection, facts);
    assert.doesNotMatch(wrongCalories, /1200 kcal/);

    const aggregateWithWrongMeal = guardNoMutationSuccessClaim(
      "今天已記錄 2 餐，共 900 kcal，其中包含牛肉飯。",
      noMutationProjection,
      facts,
    );
    assert.doesNotMatch(aggregateWithWrongMeal, /牛肉飯/);

    const aggregateWithWrongMealCalories = guardNoMutationSuccessClaim(
      "今天已記錄 2 餐，共 900 kcal，其中包含牛肉飯 900 kcal。",
      noMutationProjection,
      facts,
    );
    assert.doesNotMatch(aggregateWithWrongMealCalories, /牛肉飯|其中包含牛肉飯 900 kcal/);

    const aggregateWithWrongMealAttribution = guardNoMutationSuccessClaim(
      "今天已記錄 2 餐，共 900 kcal，其中包含雞胸肉 900 kcal。",
      noMutationProjection,
      facts,
    );
    assert.doesNotMatch(aggregateWithWrongMealAttribution, /其中包含雞胸肉 900 kcal/);

    const aggregateWithMatchingMeal = guardNoMutationSuccessClaim(
      "今天已記錄 2 餐，共 900 kcal，其中包含雞胸肉。",
      noMutationProjection,
      facts,
    );
    assert.equal(aggregateWithMatchingMeal, "今天已記錄 2 餐，共 900 kcal，其中包含雞胸肉。");
  });
});

describe("Orchestrator - didLogMeal", () => {
  let db: ReturnType<typeof createDb>;
  let orchestrator: ReturnType<typeof createOrchestrator>;
  let mockLLM: MockLLMProvider;
  let deviceId: string;
  let deviceService: ReturnType<typeof createDeviceService>;
  let foodLoggingService: ReturnType<typeof createFoodLoggingService>;
  let mealCorrectionService: ReturnType<typeof createMealCorrectionService>;
  let goalProposalService: ReturnType<typeof createGoalProposalService>;
  let mealDeleteProposalService: ReturnType<typeof createMealDeleteProposalService>;
  let mealNumericProposalService: ReturnType<typeof createMealNumericProposalService>;
  let proposalCardService: ReturnType<typeof createProposalCardService>;
  let proposalActionService: ReturnType<typeof createProposalActionService>;
  let publisher: RealtimePublisher;
  let summaryService: ReturnType<typeof createSummaryService>;
  let chatService: ReturnType<typeof createChatService>;
  let shouldFailSummary = false;

  beforeEach(async () => {
    db = createDb(":memory:");
    deviceService = createDeviceService(db);
    foodLoggingService = createFoodLoggingService(db);
    mealCorrectionService = createMealCorrectionService(db);
    summaryService = createSummaryService(db);
    chatService = createChatService(db);
    proposalCardService = createProposalCardService(db);
    const baseGoalProposalService = createGoalProposalService(db);
    const baseMealDeleteProposalService = createMealDeleteProposalService(db);
    const baseMealNumericProposalService = createMealNumericProposalService(db);
    goalProposalService = {
      ...baseGoalProposalService,
      async putLatest(input) {
        const proposal = await baseGoalProposalService.putLatest(input);
        const assistant = await chatService.saveMessage(input.deviceId, "assistant", "請確認這組每日目標提案。");
        await proposalCardService.saveAssistantProposalCard({
          deviceId: input.deviceId,
          assistantMessageId: assistant.id,
          proposalId: proposal.proposalId,
          proposalKind: "goal",
          proposalLane: "goal",
          title: "請確認這組每日目標提案。",
          details: {
            rows: [
              { label: "卡路里", after: `${input.targets.calories} kcal` },
              { label: "蛋白質", after: `${input.targets.protein} g` },
            ],
          },
          actions: {
            approveLabel: "套用目標",
            editLabel: "調整目標",
            rejectLabel: "取消提案",
          },
        });
        return proposal;
      },
    };
    mealDeleteProposalService = {
      ...baseMealDeleteProposalService,
      async putLatest(input) {
        const proposal = await baseMealDeleteProposalService.putLatest(input);
        const assistant = await chatService.saveMessage(input.deviceId, "assistant", "請確認是否刪除這筆餐點。");
        await proposalCardService.saveAssistantProposalCard({
          deviceId: input.deviceId,
          assistantMessageId: assistant.id,
          proposalId: proposal.proposalId,
          proposalKind: "meal_delete",
          proposalLane: "meal_mutation",
          title: "請確認是否刪除這筆餐點。",
          details: {
            rows: [
              { label: "餐點", value: input.input.snapshot.mealLabel },
              { label: "熱量", value: `${input.input.snapshot.calories} kcal` },
            ],
          },
          actions: {
            approveLabel: "確認刪除",
            editLabel: "改用文字調整",
            rejectLabel: "取消提案",
          },
          expiresAt: proposal.expiresAt,
        });
        return proposal;
      },
    };
    mealNumericProposalService = {
      ...baseMealNumericProposalService,
      async putLatest(input) {
        const proposal = await baseMealNumericProposalService.putLatest(input);
        const proposalKind = input.input.provenance === "model_estimate" ? "meal_estimate" : "meal_numeric";
        const assistant = await chatService.saveMessage(input.deviceId, "assistant", "請確認這組餐點修正提案。");
        await proposalCardService.saveAssistantProposalCard({
          deviceId: input.deviceId,
          assistantMessageId: assistant.id,
          proposalId: proposal.proposalId,
          proposalKind,
          proposalLane: "meal_mutation",
          title: "請確認這組餐點修正提案。",
          details: {
            rows: input.input.affectedFields.map((field) => ({
              label: field.field,
              before: String(field.before),
              after: String(field.after),
            })),
          },
          actions: {
            approveLabel: "套用修改",
            editLabel: "改用文字調整",
            rejectLabel: "取消提案",
          },
          expiresAt: proposal.expiresAt,
        });
        return proposal;
      },
    };
    publisher = new RealtimePublisher();
    proposalActionService = createProposalActionService({
      db,
      chatService,
      proposalCardService,
      goalProposalService,
      mealDeleteProposalService,
      mealNumericProposalService,
      mealCorrectionService,
      deviceService,
      publisher,
    });
    mockLLM = new MockLLMProvider();
    shouldFailSummary = false;

    orchestrator = createOrchestrator({
      llmProvider: mockLLM,
      chatService,
      summaryService: {
        async getDailySummary(deviceId, date) {
          if (shouldFailSummary) {
            throw new Error("summary recomputation failed");
          }

          return summaryService.getDailySummary(deviceId, date);
        },
      },
      foodLoggingService,
      mealCorrectionService,
      deviceService,
      goalProposalService,
      mealDeleteProposalService,
      mealNumericProposalService,
      proposalActionService,
      publisher: {
        publishGoalsUpdate() {
          return { sent: 1 };
        },
      },
    });

    deviceId = (await deviceService.createDevice("fat_loss")).deviceId;
  });

  it("forwards device intake data into the system prompt", async () => {
    const { deviceId: intakeDeviceId } = await deviceService.createDevice("fat_loss", {
      sex: "male",
      age: 30,
      heightCm: 175,
      weightKg: 80,
      activityLevel: "moderate",
      trainingFrequency: "3_4",
      allergies: "花生",
      goalClarification: "不想影響重訓表現",
      bodyFatPercent: 18,
      tdee: 1800,
      advancedNotes: "晚餐常外食",
    });

    mockLLM.queueChatResponse({ content: "已收到" });

    await orchestrator.handleMessage(intakeDeviceId, "我想先看一下建議");

    const systemPrompt = mockLLM.chatCalls[0]?.messages[0]?.content;
    assertString(systemPrompt);
    assert.match(systemPrompt, /使用者背景資料/);
    assert.match(systemPrompt, /性別：男/);
    assert.match(systemPrompt, /年齡：30/);
    assert.match(systemPrompt, /身高：175 cm/);
    assert.match(systemPrompt, /體重：80 kg/);
    assert.match(systemPrompt, /活動量：moderate/);
    assert.match(systemPrompt, /訓練頻率：3_4/);
    assert.match(systemPrompt, /過敏\/飲食限制：花生/);
    assert.match(systemPrompt, /目標補充：不想影響重訓表現/);
    assert.match(systemPrompt, /體脂率：18%/);
    assert.match(systemPrompt, /TDEE：1800 kcal/);
    assert.match(systemPrompt, /備註：晚餐常外食/);
  });

  it("handleMessage returns { reply, didLogMeal: true } when log_food is executed", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_1",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({ items: [{ food_name: "蘋果", calories: 100, protein: 1, carbs: 20, fat: 0.5 }] }),
        },
      }],
    });
    const result = await orchestrator.handleMessage(deviceId, "我吃了雞腿便當");
    if (!("reply" in result)) throw new Error("expected reply result");
    assertSuccessfulLogReplyShape(result.reply, {
      fullFoodName: "蘋果",
      expectsUncertainty: true,
      allowsNextStep: true,
    });
    assert.match(result.reply, /蛋白質 0 g/);
    assert.equal(result.didLogMeal, true);

    const history = await chatService.getHistory(deviceId, 10);
    assert.equal(history.filter((message) => message.role === "assistant").length, 0);
  });

  it("handleMessage returns { reply, didLogMeal: false } when log_food is not called", async () => {
    mockLLM.queueChatResponse({ content: "今天天氣真好！" });

    const result = await orchestrator.handleMessage(deviceId, "今天天氣怎麼樣？");
    if (!("reply" in result)) throw new Error("expected reply result");
    assert.equal(result.reply, "今天天氣真好！");
    assert.equal(result.didLogMeal, false);
  });

  it("returns affectedDate when a historical log succeeds", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_historical_log",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({
            items: [
              {
                food_name: "牛肉麵",
                calories: 520,
                protein: 24,
                carbs: 68,
                fat: 16,
              },
            ],
            date_text: "2026-03-25",
            meal_period: "dinner",
          }),
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "已幫你記到 3/25。" });

    const result = await orchestrator.handleMessage(deviceId, "幫我補記 2026-03-25 晚餐吃牛肉麵");
    if (!("reply" in result)) throw new Error("expected reply result");

    assert.equal(result.didLogMeal, true);
    assert.equal(result.affectedDate, "2026-03-25");
    assert.equal(result.dailySummary?.date, "2026-03-25");
  });

  it("returns affectedDate for non-today summary queries", async () => {
    await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-03-25T04:00:00.000Z",
      items: [
        { foodName: "雞胸肉", calories: 220, protein: 32, carbs: 0, fat: 5 },
      ],
    });
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_historical_summary",
        type: "function",
        function: {
          name: "get_daily_summary",
          arguments: JSON.stringify({ date_text: "2026-03-25" }),
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "你在 3/25 共吃了 32g 蛋白質。" });

    const result = await orchestrator.handleMessage(deviceId, "2026-03-25 吃了多少蛋白質？");
    if (!("reply" in result)) throw new Error("expected reply result");

    assert.equal(result.didLogMeal, false);
    assert.equal(result.affectedDate, "2026-03-25");
    assert.equal(result.dailySummary?.date, "2026-03-25");
  });

  it("Phase 68 D-08/D-11/D-17/D-18 returns historical log_food ambiguity from renderer without a second LLM pass", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_historical_log_ambiguous",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({
            items: [
              {
                food_name: "蛋餅",
                calories: 320,
                protein: 7,
                carbs: 48,
                fat: 10,
              },
            ],
            date_text: "昨天和前天",
            protein_sources: [
              { name: "蛋餅", protein: 7, is_primary: true, certainty: "clear" },
            ],
          }),
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "已幫你補記昨天的蛋餅。" });

    const result = await orchestrator.handleMessage(deviceId, "幫我補昨天和前天吃蛋餅");

    assert.ok("reply" in result);
    assert.equal(mockLLM.chatCalls.length, 1, "terminal historical clarification must not consume a second LLM response");
    assert.equal(result.finalReplySource, "renderer");
    assert.equal(result.finalReplyShape, "plain_text");
    assert.equal(result.didLogMeal, false);
    assert.equal(result.didMutateMeal, false);
    assert.equal(result.loggedMeal, undefined);
    assert.equal(result.summaryOutcome, undefined);
    assert.equal(result.dailySummary, undefined);
    assert.match(result.reply, /一次告訴我一個日期/);
    assert.doesNotMatch(result.reply, /已幫你|已記錄|補記|summaryOutcome|dailySummary|loggedMeal/);
  });

  it("Phase 68 D-12-D-18 returns get_daily_summary needs_clarification from renderer without mutation facts", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_summary_needs_clarification",
        type: "function",
        function: {
          name: "get_daily_summary",
          arguments: JSON.stringify({ date_text: "前幾天" }),
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "前幾天你已記錄 2 餐，共 900 kcal。" });

    const result = await orchestrator.handleMessage(deviceId, "前幾天吃多少蛋白質？");

    assert.ok("reply" in result);
    assert.equal(mockLLM.chatCalls.length, 1, "terminal summary clarification must not consume a second LLM response");
    assert.equal(result.finalReplySource, "renderer");
    assert.equal(result.finalReplyShape, "plain_text");
    assert.equal(result.didLogMeal, false);
    assert.equal(result.didMutateMeal, false);
    assert.equal(result.loggedMeal, undefined);
    assert.equal(result.summaryOutcome, undefined);
    assert.equal(result.dailySummary, undefined);
    assert.match(result.reply, /我還不能確定是哪一天/);
    assert.doesNotMatch(result.reply, /已記錄|共\s*\d+|kcal|summaryOutcome|dailySummary|loggedMeal/);
  });

  it("Phase 68 D-13/D-16/D-17 returns get_daily_summary multiple_targets from renderer without aggregate success copy", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_summary_multiple_targets",
        type: "function",
        function: {
          name: "get_daily_summary",
          arguments: JSON.stringify({}),
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "昨天和前天合計 2 餐，共 900 kcal。" });

    const result = await orchestrator.handleMessage(deviceId, "昨天和前天各吃多少蛋白質？");

    assert.ok("reply" in result);
    assert.equal(mockLLM.chatCalls.length, 1, "terminal multi-date clarification must not consume a second LLM response");
    assert.equal(result.finalReplySource, "renderer");
    assert.equal(result.finalReplyShape, "plain_text");
    assert.equal(result.didLogMeal, false);
    assert.equal(result.didMutateMeal, false);
    assert.equal(result.loggedMeal, undefined);
    assert.equal(result.summaryOutcome, undefined);
    assert.equal(result.dailySummary, undefined);
    assert.match(result.reply, /請.*一天|一個日期|哪一天/);
    assert.doesNotMatch(result.reply, /合計|共\s*\d+|kcal|已記錄|summaryOutcome|dailySummary|loggedMeal/);
  });

  it("handleMessage returns didLogMeal: true with projected copy after log_food succeeds", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_1",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({
            items: [
              {
                food_name: "雞腿便當",
                calories: 620,
                protein: 30,
                carbs: 70,
                fat: 18,
              },
            ],
            protein_sources: [
              { name: "雞腿", protein: 24, is_primary: true, certainty: "clear" },
              { name: "白飯", protein: 4, is_primary: false, certainty: "clear" },
              { name: "青菜", protein: 2, is_primary: false, certainty: "clear" },
            ],
          }),
        },
      }],
    });
    const result = await orchestrator.handleMessage(deviceId, "我吃了蘋果");
    assert.equal(result.didLogMeal, true);
    if (!("reply" in result)) throw new Error("expected reply result");
    assertSuccessfulLogReplyShape(result.reply, {
      fullFoodName: "雞腿便當",
      expectsUncertainty: true,
      allowsNextStep: true,
    });
    assert.match(result.reply, /蛋白質 24 g。/);
    assert.doesNotMatch(result.reply, /已完成記錄，但回覆生成失敗|headline/);
  });

  it("handleMessage returns a committed log receipt when summary recomputation fails after persistence", async () => {
    shouldFailSummary = true;
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_1",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({ items: [{ food_name: "蘋果", calories: 100, protein: 1, carbs: 20, fat: 0.5 }] }),
        },
      }],
    });

    const result = await orchestrator.handleMessage(deviceId, "我吃了蘋果");

    assert.ok("reply" in result);
    assert.equal(result.didLogMeal, true);
    assert.equal(result.didMutateMeal, true);
    assert.equal(result.finalReplySource, "renderer");
    assert.equal(result.finalReplyShape, "plain_text");
    assert.match(result.reply, /已記錄蘋果/);
    assert.match(result.reply, /蛋白質 0 g。/);
    assert.equal(result.dailySummary?.mealCount, 1);
    assert.equal(result.dailySummary?.totalCalories, 100);
    assert.equal(result.summaryOutcome?.status, "recovered");
    assert.equal(result.summaryOutcome?.reason, "recompute_failed");
    assert.equal(result.summaryOutcome?.dailySummary.mealCount, 1);

    const meals = await foodLoggingService.getMealsByDate(deviceId, new Date());
    assert.equal(meals.length, 1);
    assert.equal(meals[0]?.foodName, "蘋果");
  });

  it("handleMessage returns a renderer-owned log receipt when summaryOutcome is unavailable", async () => {
    const db = createDb(":memory:");
    const localDeviceService = createDeviceService(db);
    const localFoodLoggingService = createFoodLoggingService(db);
    const localSummaryService = createSummaryService(db);
    const localChatService = createChatService(db);
    const localLLM = new MockLLMProvider();
    const localDeviceId = (await localDeviceService.createDevice("fat_loss")).deviceId;

    orchestrator = createOrchestrator({
      llmProvider: localLLM,
      chatService: localChatService,
      summaryService: {
        async getDailySummary() {
          throw new Error("summary recomputation failed");
        },
      },
      foodLoggingService: {
        ...localFoodLoggingService,
        async getMealsByDate() {
          throw new Error("persisted meal recovery failed");
        },
      },
      mealCorrectionService: createMealCorrectionService(db),
      deviceService: localDeviceService,
    });

    localLLM.queueChatResponse({
      toolCalls: [{
        id: "call_unavailable_log",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({ items: [{ food_name: "蘋果", calories: 100, protein: 1, carbs: 20, fat: 0.5 }] }),
        },
      }],
    });

    const result = await orchestrator.handleMessage(localDeviceId, "我吃了蘋果");

    assert.ok("reply" in result);
    assert.equal(result.reply, "已記錄蘋果，100 kcal，蛋白質 0 g。若份量不同，可以再調整。");
    assert.equal(result.didLogMeal, true);
    assert.equal(result.didMutateMeal, true);
    assert.equal(result.finalReplySource, "renderer");
    assert.equal(result.finalReplyShape, "plain_text");
    assert.deepEqual(result.summaryOutcome, { status: "unavailable", reason: "recompute_failed" });
    assert.equal(result.dailySummary, undefined);
    assert.equal(result.loggedMeal?.foodName, "蘋果");
    assert.doesNotMatch(result.reply, /summaryOutcome|recompute_failed|dailySummary|publish_failed/);

    const meals = await localFoodLoggingService.getMealsByDate(localDeviceId, new Date());
    assert.equal(meals.length, 1);
    assert.equal(meals[0]?.foodName, "蘋果");
  });

  it("handleMessage returns didLogMeal: false after MAX_ROUNDS fallback", async () => {
    for (let i = 0; i < 3; i++) {
      mockLLM.queueChatResponse({
        toolCalls: [{
          id: `call_${i}`,
          type: "function",
          function: { name: "get_daily_summary", arguments: "{}" },
        }],
      });
    }

    const result = await orchestrator.handleMessage(deviceId, "test");
    if (!("reply" in result)) throw new Error("expected reply result");
    assert.equal(result.reply, "抱歉，我現在無法完成這個請求，請稍後再試。");
    assert.equal(result.didLogMeal, false);

    const history = await chatService.getHistory(deviceId, 10);
    assert.equal(history.filter((message) => message.role === "assistant").length, 0);
  });

  it("returns a renderer-owned goal update receipt before any later model rounds", async () => {
    const db = createDb(":memory:");
    const localDeviceService = createDeviceService(db);
    const localFoodLoggingService = createFoodLoggingService(db);
    const localSummaryService = createSummaryService(db);
    const localChatService = createChatService(db);
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
      publisher: {
        publishGoalsUpdate() {
          return { sent: 1 };
        },
      },
    });

    localLLM.queueChatResponse({
      toolCalls: [{
        id: "goal_max_rounds",
        type: "function",
        function: {
          name: "update_goals",
          arguments: JSON.stringify({ mode: "current_turn_values", calories: 1800, protein: 130 }),
        },
      }],
    });
    localLLM.queueChatResponse({ content: "模型前綴：我已經幫你更新好了。" });

    const result = await orchestrator.handleMessage(localDeviceId, "卡路里 1800 蛋白質 130");

    assert.ok("reply" in result);
    assert.equal(result.reply, "已更新每日目標：\n• 卡路里 1800 kcal\n• 蛋白質 130 g\n• 碳水 150 g\n• 脂肪 50 g");
    assert.equal(result.finalReplySource, "renderer");
    assert.equal(result.finalReplyShape, "plain_text");
    assert.equal(result.didLogMeal, false);
    assert.equal(localLLM.chatCalls.length, 1);
  });

  it("returns the goal update receipt when a later tool in the same batch fails fatally", async () => {
    const db = createDb(":memory:");
    const localDeviceService = createDeviceService(db);
    const localFoodLoggingService = createFoodLoggingService(db);
    const localSummaryService = createSummaryService(db);
    const localChatService = createChatService(db);
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
      publisher: {
        publishGoalsUpdate() {
          return { sent: 1 };
        },
      },
    });

    localLLM.queueChatResponse({
      toolCalls: [
        {
          id: "goal_batch_success",
          type: "function",
          function: {
            name: "update_goals",
            arguments: JSON.stringify({ mode: "current_turn_values", calories: 1800, protein: 130 }),
          },
        },
        {
          id: "unknown_after_goal",
          type: "function",
          function: { name: "unknown_tool", arguments: "{}" },
        },
      ],
    });

    const result = await orchestrator.handleMessage(localDeviceId, "卡路里 1800 蛋白質 130");

    assert.ok("reply" in result);
    assert.equal(result.reply, "已更新每日目標：\n• 卡路里 1800 kcal\n• 蛋白質 130 g\n• 碳水 150 g\n• 脂肪 50 g");
    const device = await localDeviceService.getDevice(localDeviceId);
    assert.equal(device?.dailyCalories, 1800);
    assert.equal(device?.dailyProtein, 130);
  });

  it("returns the log receipt when a later tool in the same batch fails fatally", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [
        {
          id: "log_batch_success",
          type: "function",
          function: {
            name: "log_food",
            arguments: JSON.stringify({
              items: [
                {
                  food_name: "雞腿便當",
                  calories: 620,
                  protein: 30,
                  carbs: 70,
                  fat: 18,
                },
              ],
              protein_sources: [
                { name: "雞腿", protein: 24, is_primary: true, certainty: "clear" },
                { name: "白飯", protein: 4, is_primary: false, certainty: "clear" },
                { name: "青菜", protein: 2, is_primary: false, certainty: "clear" },
              ],
            }),
          },
        },
        {
          id: "unknown_after_log",
          type: "function",
          function: { name: "unknown_tool", arguments: "{}" },
        },
      ],
    });

    const result = await orchestrator.handleMessage(deviceId, "我吃了雞腿便當");

    assert.ok("reply" in result);
    assert.equal(result.reply, "已記錄雞腿便當，620 kcal，蛋白質 24 g。若份量不同，可以再調整。");
    assert.equal(result.didLogMeal, true);
    assert.equal(result.didMutateMeal, true);
    assert.equal(result.finalReplySource, "renderer");
    assert.equal(result.finalReplyShape, "plain_text");
    assert.equal(result.dailySummary?.mealCount, 1);
    assert.equal(result.dailySummary?.totalProtein, 24);
  });

  it("returns the update receipt when a later tool in the same batch fails fatally", async () => {
    const seeded = await foodLoggingService.logGroupedMeal(deviceId, {
      items: [
        { foodName: "雞腿便當", calories: 620, protein: 24, carbs: 70, fat: 18 },
      ],
    });
    mockLLM.queueChatResponse({
      toolCalls: [
        {
          id: "find_update_target",
          type: "function",
          function: {
            name: "find_meals",
            arguments: JSON.stringify({ action: "update", query: "雞腿便當" }),
          },
        },
        {
          id: "update_batch_success",
          type: "function",
          function: {
            name: "update_meal",
            arguments: JSON.stringify({
              meal_id: seeded.id,
              food_name: "半份雞腿便當",
              calories: 360,
              protein: 20,
              carbs: 45,
              fat: 10,
            }),
          },
        },
        {
          id: "unknown_after_update",
          type: "function",
          function: { name: "unknown_tool", arguments: "{}" },
        },
      ],
    });

    const result = await orchestrator.handleMessage(deviceId, "把雞腿便當改成半份雞腿便當，360 kcal，蛋白質 20 g，碳水 45 g，脂肪 10 g");

    assert.ok("reply" in result);
    assert.equal(result.reply, "已更新半份雞腿便當，360 kcal，蛋白質 20 g。");
    assert.equal(result.didLogMeal, false);
    assert.equal(result.didMutateMeal, true);
    assert.equal(result.finalReplySource, "renderer");
    assert.equal(result.finalReplyShape, "plain_text");
    assert.equal(result.loggedMeal?.mealId, seeded.id);
    assert.equal(result.loggedMeal?.foodName, "半份雞腿便當");
    assert.equal(result.dailySummary?.mealCount, 1);
    assert.equal(result.dailySummary?.totalCalories, 360);
    assert.equal(result.dailySummary?.totalProtein, 20);
  });

  it("returns a renderer-owned update receipt when summaryOutcome is unavailable", async () => {
    const db = createDb(":memory:");
    const localDeviceService = createDeviceService(db);
    const localFoodLoggingService = createFoodLoggingService(db);
    const localChatService = createChatService(db);
    const localLLM = new MockLLMProvider();
    const localDeviceId = (await localDeviceService.createDevice("fat_loss")).deviceId;
    const seeded = await localFoodLoggingService.logGroupedMeal(localDeviceId, {
      items: [
        { foodName: "雞腿便當", calories: 620, protein: 24, carbs: 70, fat: 18 },
      ],
    });

    orchestrator = createOrchestrator({
      llmProvider: localLLM,
      chatService: localChatService,
      summaryService: {
        async getDailySummary() {
          throw new Error("summary recomputation failed");
        },
      },
      foodLoggingService: {
        ...localFoodLoggingService,
        async getMealsByDate() {
          throw new Error("persisted meal recovery failed");
        },
      },
      mealCorrectionService: createMealCorrectionService(db, {
        summaryService: {
          async getDailySummary() {
            throw new Error("summary recomputation failed");
          },
        },
        foodLoggingService: {
          async getMealsByDate() {
            throw new Error("persisted meal recovery failed");
          },
        },
      }),
      deviceService: localDeviceService,
    });

    localLLM.queueChatResponse({
      toolCalls: [
        {
          id: "find_update_target_unavailable",
          type: "function",
          function: {
            name: "find_meals",
            arguments: JSON.stringify({ action: "update", query: "雞腿便當" }),
          },
        },
        {
          id: "update_unavailable",
          type: "function",
          function: {
            name: "update_meal",
            arguments: JSON.stringify({
              meal_id: seeded.id,
              food_name: "半份雞腿便當",
              calories: 360,
              protein: 20,
              carbs: 45,
              fat: 10,
            }),
          },
        },
      ],
    });

    const result = await orchestrator.handleMessage(
      localDeviceId,
      "把雞腿便當改成半份雞腿便當，360 kcal，蛋白質 20 g，碳水 45 g，脂肪 10 g",
    );

    assert.ok("reply" in result);
    assert.equal(result.reply, "已更新半份雞腿便當，360 kcal，蛋白質 20 g。");
    assert.equal(result.didLogMeal, false);
    assert.equal(result.didMutateMeal, true);
    assert.equal(result.finalReplySource, "renderer");
    assert.deepEqual(result.summaryOutcome, { status: "unavailable", reason: "recompute_failed" });
    assert.equal(result.dailySummary, undefined);
    assert.equal(result.loggedMeal?.mealId, seeded.id);
    assert.equal(result.loggedMeal?.foodName, "半份雞腿便當");
    assert.doesNotMatch(result.reply, /summaryOutcome|recompute_failed|dailySummary|publish_failed/);
  });

  it("previews delete setup before confirmation commits the delete receipt", async () => {
    const seeded = await foodLoggingService.logGroupedMeal(deviceId, {
      items: [
        { foodName: "雞腿便當", calories: 620, protein: 24, carbs: 70, fat: 18 },
      ],
    });
    mockLLM.queueChatResponse({
      toolCalls: [
        {
          id: "find_delete_target",
          type: "function",
          function: {
            name: "find_meals",
            arguments: JSON.stringify({ action: "delete", query: "雞腿便當" }),
          },
        },
        {
          id: "delete_batch_success",
          type: "function",
          function: {
            name: "delete_meal",
            arguments: JSON.stringify({ meal_id: seeded.id }),
          },
        },
        {
          id: "unknown_after_delete",
          type: "function",
          function: { name: "unknown_tool", arguments: "{}" },
        },
      ],
    });

    const setupResult = await orchestrator.handleMessage(deviceId, "刪掉雞腿便當");

    assert.ok("reply" in setupResult);
    assert.match(setupResult.reply, /即將刪除：雞腿便當/);
    assert.equal(setupResult.didLogMeal, false);
    assert.equal(setupResult.didMutateMeal, false);
    assert.equal(setupResult.finalReplySource, "renderer");
    assert.equal(setupResult.finalReplyShape, "plain_text");
    assert.equal(setupResult.deletedMealId, undefined);
    assert.equal(setupResult.dailySummary, undefined);

    const result = await orchestrator.handleMessage(deviceId, "好");

    assert.ok("reply" in result);
    assert.equal(result.reply, "已刪除雞腿便當，已從當日紀錄移除。");
    assert.equal(result.didLogMeal, false);
    assert.equal(result.didMutateMeal, true);
    assert.equal(result.finalReplySource, "renderer");
    assert.equal(result.finalReplyShape, "plain_text");
    assert.equal(result.loggedMeal, undefined);
    assert.equal(result.dailySummary?.mealCount, 0);
    assert.equal(result.dailySummary?.totalCalories, 0);
  });

  it("returns a renderer-owned delete receipt when summaryOutcome is unavailable", async () => {
    const db = createDb(":memory:");
    const localDeviceService = createDeviceService(db);
    const localFoodLoggingService = createFoodLoggingService(db);
    const localChatService = createChatService(db);
    const localProposalCardService = createProposalCardService(db);
    const localGoalProposalService = createGoalProposalService(db);
    const localMealNumericProposalService = createMealNumericProposalService(db);
    const localMealDeleteProposalService = createMealDeleteProposalService(db);
    const localLLM = new MockLLMProvider();
    const localDeviceId = (await localDeviceService.createDevice("fat_loss")).deviceId;
    const seeded = await localFoodLoggingService.logGroupedMeal(localDeviceId, {
      items: [
        { foodName: "雞腿便當", calories: 620, protein: 24, carbs: 70, fat: 18 },
      ],
    });
    const localMealCorrectionService = createMealCorrectionService(db, {
      summaryService: {
        async getDailySummary() {
          throw new Error("summary recomputation failed");
        },
      },
      foodLoggingService: {
        async getMealsByDate() {
          throw new Error("persisted meal recovery failed");
        },
      },
    });
    const localProposalActionService = createProposalActionService({
      db,
      chatService: localChatService,
      proposalCardService: localProposalCardService,
      goalProposalService: localGoalProposalService,
      mealDeleteProposalService: localMealDeleteProposalService,
      mealNumericProposalService: localMealNumericProposalService,
      mealCorrectionService: localMealCorrectionService,
      deviceService: localDeviceService,
      publisher: new RealtimePublisher(),
    });

    orchestrator = createOrchestrator({
      llmProvider: localLLM,
      chatService: localChatService,
      summaryService: {
        async getDailySummary() {
          throw new Error("summary recomputation failed");
        },
      },
      foodLoggingService: {
        ...localFoodLoggingService,
        async getMealsByDate() {
          throw new Error("persisted meal recovery failed");
        },
      },
      mealCorrectionService: localMealCorrectionService,
      deviceService: localDeviceService,
      goalProposalService: localGoalProposalService,
      mealDeleteProposalService: localMealDeleteProposalService,
      mealNumericProposalService: localMealNumericProposalService,
      proposalActionService: localProposalActionService,
    });

    localLLM.queueChatResponse({
      toolCalls: [
        {
          id: "find_delete_target_unavailable",
          type: "function",
          function: {
            name: "find_meals",
            arguments: JSON.stringify({ action: "delete", query: "雞腿便當" }),
          },
        },
        {
          id: "delete_unavailable",
          type: "function",
          function: {
            name: "delete_meal",
            arguments: JSON.stringify({ meal_id: seeded.id }),
          },
        },
      ],
    });

    const setupResult = await orchestrator.handleMessage(localDeviceId, "刪掉雞腿便當");

    assert.ok("reply" in setupResult);
    assert.match(setupResult.reply, /即將刪除：雞腿便當/);
    assert.equal(setupResult.didMutateMeal, false);
    assert.equal(setupResult.summaryOutcome, undefined);
    assert.equal(setupResult.dailySummary, undefined);
    if (!setupResult.proposalCard) {
      throw new Error("expected pending delete proposal card");
    }
    const setupAssistant = await localChatService.saveMessage(localDeviceId, "assistant", setupResult.reply);
    await localProposalCardService.saveAssistantProposalCard({
      ...setupResult.proposalCard,
      deviceId: localDeviceId,
      assistantMessageId: setupAssistant.id,
    });

    const result = await orchestrator.handleMessage(localDeviceId, "好");

    assert.ok("reply" in result);
    assert.equal(result.reply, "已刪除雞腿便當，已從當日紀錄移除。");
    assert.equal(result.didLogMeal, false);
    assert.equal(result.didMutateMeal, true);
    assert.equal(result.finalReplySource, "renderer");
    assert.deepEqual(result.summaryOutcome, { status: "unavailable", reason: "recompute_failed" });
    assert.equal(result.dailySummary, undefined);
    assert.equal(result.loggedMeal, undefined);
    assert.doesNotMatch(result.reply, /summaryOutcome|recompute_failed|dailySummary|publish_failed/);
  });

  it("D-11/D-13/D-14 exposes a safe structured outcome fact for successful log_food", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "outcome_fact_log",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({
            items: [
              {
                food_name: "牛肉麵",
                calories: 520,
                protein: 24,
                carbs: 68,
                fat: 16,
              },
            ],
            date_text: "2026-03-25",
          }),
        },
      }],
    });

    const result = await orchestrator.handleMessage(deviceId, "幫我補記 2026-03-25 吃牛肉麵");

    assert.ok("reply" in result);
    assertMutationOutcomeFact(result, {
      action: "log_food",
      affectedDate: "2026-03-25",
      foodName: "牛肉麵",
      calories: 520,
      protein: 24,
      carbs: 68,
      fat: 16,
    }, [
      result.loggedMeal?.mealId ?? "",
      result.loggedMeal?.mealRevisionId ?? "",
      deviceId,
      result.reply,
    ].filter(Boolean));
  });

  it("D-11/D-13/D-14 exposes a safe structured outcome fact for successful update_meal", async () => {
    const seeded = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-03-25T04:30:00.000Z",
      items: [
        { foodName: "雞腿便當", calories: 620, protein: 24, carbs: 70, fat: 18 },
      ],
    });
    mockLLM.queueChatResponse({
      toolCalls: [
        {
          id: "find_update_outcome_target",
          type: "function",
          function: {
            name: "find_meals",
            arguments: JSON.stringify({ action: "update", query: "雞腿便當" }),
          },
        },
        {
          id: "outcome_fact_update",
          type: "function",
          function: {
            name: "update_meal",
            arguments: JSON.stringify({
              meal_id: seeded.id,
              food_name: "半份雞腿便當",
              calories: 360,
              protein: 20,
              carbs: 45,
              fat: 10,
            }),
          },
        },
      ],
    });

    const result = await orchestrator.handleMessage(
      deviceId,
      "把雞腿便當改成半份雞腿便當，360 kcal，蛋白質 20 g，碳水 45 g，脂肪 10 g",
    );

    assert.ok("reply" in result);
    assertMutationOutcomeFact(result, {
      action: "update_meal",
      affectedDate: "2026-03-25",
      foodName: "半份雞腿便當",
      calories: 360,
      protein: 20,
      carbs: 45,
      fat: 10,
    }, [
      seeded.id,
      seeded.mealRevisionId,
      result.loggedMeal?.mealRevisionId ?? "",
      deviceId,
      result.reply,
    ].filter(Boolean));
  });

  it("D-11/D-13/D-14 exposes a safe structured outcome fact for successful delete_meal", async () => {
    const seeded = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-03-25T04:30:00.000Z",
      items: [
        { foodName: "雞腿便當", calories: 620, protein: 24, carbs: 70, fat: 18 },
      ],
    });
    mockLLM.queueChatResponse({
      toolCalls: [
        {
          id: "find_delete_outcome_target",
          type: "function",
          function: {
            name: "find_meals",
            arguments: JSON.stringify({ action: "delete", query: "雞腿便當" }),
          },
        },
        {
          id: "outcome_fact_delete",
          type: "function",
          function: {
            name: "delete_meal",
            arguments: JSON.stringify({ meal_id: seeded.id }),
          },
        },
      ],
    });

    const setupResult = await orchestrator.handleMessage(deviceId, "刪掉雞腿便當");

    assert.ok("reply" in setupResult);
    assert.match(setupResult.reply, /即將刪除：雞腿便當/);
    assert.equal(setupResult.didMutateMeal, false);
    assert.equal(getMutationOutcomeFact(setupResult), undefined);

    const result = await orchestrator.handleMessage(deviceId, "好");

    assert.ok("reply" in result);
    assertMutationOutcomeFact(result, {
      action: "delete_meal",
      affectedDate: "2026-03-25",
      foodName: "雞腿便當",
      calories: 620,
      protein: 24,
    }, [
      seeded.id,
      seeded.mealRevisionId,
      deviceId,
      result.reply,
    ].filter(Boolean));
  });

  it("D-11/D-13/D-14 exposes a safe structured outcome fact for successful update_goals", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "outcome_fact_goals",
        type: "function",
        function: {
          name: "update_goals",
          arguments: JSON.stringify({ mode: "current_turn_values", calories: 1800, protein: 130 }),
        },
      }],
    });

    const result = await orchestrator.handleMessage(deviceId, "卡路里 1800 蛋白質 130");

    assert.ok("reply" in result);
    assertMutationOutcomeFact(result, {
      action: "update_goals",
      affectedDate: formatLocalDate(currentAppDate()),
      updatedGoals: [
        { label: "卡路里", value: 1800, unit: "kcal" },
        { label: "蛋白質", value: 130, unit: "g" },
      ],
    }, [
      deviceId,
      result.reply,
    ]);
  });

  it("D-14/HIST-02 omits mutationOutcomeFact for failed tools, controlled replies, and summary-only tools", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "failed_goal_fact",
        type: "function",
        function: {
          name: "update_goals",
          arguments: JSON.stringify({ mode: "current_turn_values", calories: 100 }),
        },
      }],
    });
    const failedGoalResult = await orchestrator.handleMessage(deviceId, "卡路里 100");
    assert.equal(getMutationOutcomeFact(failedGoalResult), undefined);

    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "controlled_historical_log_fact",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({
            items: [
              {
                food_name: "蛋餅",
                calories: 320,
                protein: 7,
                carbs: 48,
                fat: 10,
              },
            ],
            date_text: "昨天和前天",
          }),
        },
      }],
    });
    const controlledReplyResult = await orchestrator.handleMessage(deviceId, "幫我補昨天和前天吃蛋餅");
    assert.equal(getMutationOutcomeFact(controlledReplyResult), undefined);

    await foodLoggingService.logGroupedMeal(deviceId, {
      items: [
        { foodName: "雞胸肉", calories: 220, protein: 32, carbs: 0, fat: 5 },
      ],
    });
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "summary_only_fact",
        type: "function",
        function: {
          name: "get_daily_summary",
          arguments: JSON.stringify({}),
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "今天有雞胸肉。" });
    const summaryOnlyResult = await orchestrator.handleMessage(deviceId, "今天吃了什麼？");
    assert.equal(getMutationOutcomeFact(summaryOnlyResult), undefined);
  });

  it("returns a deterministic logged reply for image-only uploads after log_food succeeds", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_1",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({
            items: [
              {
                food_name: "豬肉燒烤飯盒",
                calories: 680,
                protein: 35,
                carbs: 86,
                fat: 22,
              },
            ],
            protein_sources: [
              { name: "豬肉", protein: 28, is_primary: true, certainty: "clear" },
              { name: "白飯", protein: 5, is_primary: false, certainty: "clear" },
              { name: "青菜", protein: 2, is_primary: false, certainty: "clear" },
            ],
          }),
        },
      }],
    });

    const result = await orchestrator.handleMessage(
      deviceId,
      "(圖片)",
      "data:image/png;base64,abc123",
      "asset:meal-image",
    );

    if (!("reply" in result)) throw new Error("expected reply result");
    assert.equal(result.didLogMeal, true);
    assertSuccessfulLogReplyShape(result.reply, {
      fullFoodName: "豬肉燒烤飯盒",
      expectsUncertainty: true,
      allowsNextStep: true,
    });
    assert.match(result.reply, /蛋白質 28 g。/);
    assert.doesNotMatch(result.reply, /保守估算|headline/);
    assert.equal(mockLLM.chatCalls.length, 1, "image-only logging should not require a second LLM round");
  });

  it("projects correction clarification copy from user terms and full grouped candidate names", async () => {
    const db = createDb(":memory:");
    const localDeviceService = createDeviceService(db);
    const localFoodLoggingService = createFoodLoggingService(db);
    const localSummaryService = createSummaryService(db);
    const localChatService = createChatService(db);
    const localMealCorrectionService = createMealCorrectionService(db);
    const localLLM = new MockLLMProvider();
    const localDeviceId = (await localDeviceService.createDevice("fat_loss")).deviceId;

    await localFoodLoggingService.logGroupedMeal(localDeviceId, {
      loggedAt: "2026-04-19T09:30:00.000Z",
      items: [
        { foodName: "雞腿", calories: 260, protein: 24, carbs: 0, fat: 12 },
        { foodName: "白飯", calories: 280, protein: 4, carbs: 62, fat: 0.5 },
        { foodName: "滷蛋", calories: 90, protein: 7, carbs: 2, fat: 6 },
        { foodName: "青菜", calories: 80, protein: 2, carbs: 10, fat: 4 },
      ],
    });
    await localFoodLoggingService.logGroupedMeal(localDeviceId, {
      loggedAt: "2026-04-19T10:00:00.000Z",
      items: [
        { foodName: "排骨", calories: 300, protein: 26, carbs: 8, fat: 18 },
        { foodName: "白飯", calories: 280, protein: 4, carbs: 62, fat: 0.5 },
        { foodName: "滷蛋", calories: 90, protein: 7, carbs: 2, fat: 6 },
        { foodName: "青菜", calories: 80, protein: 2, carbs: 10, fat: 4 },
      ],
    });

    orchestrator = createOrchestrator({
      llmProvider: localLLM,
      chatService: localChatService,
      summaryService: localSummaryService,
      foodLoggingService: localFoodLoggingService,
      mealCorrectionService: localMealCorrectionService,
      deviceService: localDeviceService,
    });

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

    if (!("reply" in result)) throw new Error("expected reply result");
    assert.equal(result.didMutateMeal, false);
    assert.match(result.reply, /滷蛋/);
    assert.match(result.reply, /雞腿、白飯、滷蛋、青菜/);
    assert.match(result.reply, /排骨、白飯、滷蛋、青菜/);
    assert.doesNotMatch(result.reply, /中午雞腿便當/);
  });

  it("Phase 67 D-28/D-32 returns backend-rendered correction clarification after one model call without raw correction echo", async () => {
    const db = createDb(":memory:");
    const localDeviceService = createDeviceService(db);
    const localFoodLoggingService = createFoodLoggingService(db);
    const localSummaryService = createSummaryService(db);
    const localChatService = createChatService(db);
    const localMealCorrectionService = createMealCorrectionService(db);
    const localLLM = new MockLLMProvider();
    const localDeviceId = (await localDeviceService.createDevice("fat_loss")).deviceId;

    await localFoodLoggingService.logGroupedMeal(localDeviceId, {
      loggedAt: "2026-04-19T09:30:00.000Z",
      items: [
        { foodName: "雞腿", calories: 260, protein: 24, carbs: 0, fat: 12 },
        { foodName: "白飯", calories: 280, protein: 4, carbs: 62, fat: 0.5 },
        { foodName: "滷蛋", calories: 90, protein: 7, carbs: 2, fat: 6 },
        { foodName: "青菜", calories: 80, protein: 2, carbs: 10, fat: 4 },
      ],
    });
    await localFoodLoggingService.logGroupedMeal(localDeviceId, {
      loggedAt: "2026-04-19T10:00:00.000Z",
      items: [
        { foodName: "排骨", calories: 300, protein: 26, carbs: 8, fat: 18 },
        { foodName: "白飯", calories: 280, protein: 4, carbs: 62, fat: 0.5 },
        { foodName: "滷蛋", calories: 90, protein: 7, carbs: 2, fat: 6 },
        { foodName: "青菜", calories: 80, protein: 2, carbs: 10, fat: 4 },
      ],
    });

    orchestrator = createOrchestrator({
      llmProvider: localLLM,
      chatService: localChatService,
      summaryService: localSummaryService,
      foodLoggingService: localFoodLoggingService,
      mealCorrectionService: localMealCorrectionService,
      deviceService: localDeviceService,
    });

    localLLM.queueChatResponse({
      toolCalls: [{
        id: "find_renderer_owned_target",
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
    localLLM.queueChatResponse({
      content: "已更新中午雞腿便當的滷蛋。",
    });

    const result = await orchestrator.handleMessage(localDeviceId, "把中午雞腿便當的滷蛋改成兩顆水煮蛋");

    if (!("reply" in result)) throw new Error("expected reply result");
    assert.equal(localLLM.chatCalls.length, 1, "renderer-owned clarification must not ask the model to rewrite it");
    assert.equal(result.didLogMeal, false);
    assert.equal(result.didMutateMeal, false);
    assert.equal(result.finalReplySource, "renderer");
    assert.equal(result.finalReplyShape, "plain_text");
    assert.match(result.reply, /請直接回覆編號/);
    assert.match(result.reply, /1\./);
    assert.match(result.reply, /2\./);
    assert.match(result.reply, /雞腿、白飯、滷蛋、青菜/);
    assert.match(result.reply, /排骨、白飯、滷蛋、青菜/);
    assert.doesNotMatch(result.reply, /中午雞腿便當|滷蛋改成|已更新|已套用|蛋白質|kcal|calories|protein/);
  });

  it("renders missing-quantity successful logs from committed facts without implementation copy", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_grouped_image",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({
            items: [
              { food_name: "雞腿", calories: 260, protein: 24, carbs: 0, fat: 12 },
              { food_name: "白飯", calories: 280, protein: 4, carbs: 62, fat: 0.5 },
              { food_name: "青菜", calories: 80, protein: 2, carbs: 10, fat: 4 },
            ],
            protein_sources: [
              { name: "雞腿", protein: 24, is_primary: true, certainty: "clear" },
              { name: "白飯", protein: 4, is_primary: false, certainty: "clear" },
              { name: "青菜", protein: 2, is_primary: false, certainty: "clear" },
            ],
          }),
        },
      }],
    });

    const result = await orchestrator.handleMessage(
      deviceId,
      "(圖片)",
      "data:image/png;base64,abc123",
      "asset:grouped-image",
    );

    if (!("reply" in result)) throw new Error("expected reply result");
    assert.equal(result.loggedMeal?.quantityUncertaintyReason, "missing_quantity");
    assertSuccessfulLogReplyShape(result.reply, {
      fullFoodName: "雞腿、白飯、青菜",
      expectsUncertainty: true,
      allowsNextStep: true,
    });
    assert.doesNotMatch(result.reply, /可再補份量修正/);
    assert.doesNotMatch(result.reply, /保守估算/);
  });

  it("omits uncertainty and next steps for clear quantified image logs", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_quantified_image",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({
            items: [
              { food_name: "雞胸肉 120g", calories: 198, protein: 37, carbs: 0, fat: 4, quantity_g: 120 },
            ],
            protein_sources: [
              { name: "雞胸肉", protein: 37, is_primary: true, certainty: "clear" },
            ],
          }),
        },
      }],
    });

    const result = await orchestrator.handleMessage(
      deviceId,
      "(圖片)",
      "data:image/png;base64,abc123",
      "asset:clear-image",
    );

    if (!("reply" in result)) throw new Error("expected reply result");
    assertSuccessfulLogReplyShape(result.reply, {
      fullFoodName: "雞胸肉 120g",
      expectsUncertainty: false,
      allowsNextStep: false,
    });
    assert.doesNotMatch(result.reply, /可再補份量修正/);
  });

  it("renders high-variance image categories from committed facts without uncertainty prose", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_high_variance_image",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({
            items: [
              {
                food_name: "牛肉麵",
                calories: 650,
                protein: 31,
                carbs: 82,
                fat: 20,
                quantity: 1,
                unit: "碗",
              },
            ],
            protein_sources: [
              { name: "牛肉", protein: 31, is_primary: true, certainty: "clear" },
            ],
          }),
        },
      }],
    });

    const result = await orchestrator.handleMessage(
      deviceId,
      "(圖片)",
      "data:image/png;base64,abc123",
      "asset:noodle-image",
    );

    if (!("reply" in result)) throw new Error("expected reply result");
    assertSuccessfulLogReplyShape(result.reply, {
      fullFoodName: "牛肉麵",
      expectsUncertainty: true,
      allowsNextStep: false,
    });
    assert.doesNotMatch(result.reply, /湯底與份量.*主要誤差/);
    assert.doesNotMatch(result.reply, /可再補份量修正/);
  });

  it("adds a concrete date for historical successful image logs", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_historical_image",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({
            items: [
              {
                food_name: "鮭魚飯",
                calories: 520,
                protein: 34,
                carbs: 58,
                fat: 16,
                quantity: 1,
                unit: "份",
              },
            ],
            date_text: "2026-03-25",
            meal_period: "dinner",
            protein_sources: [
              { name: "鮭魚", protein: 34, is_primary: true, certainty: "clear" },
            ],
          }),
        },
      }],
    });

    const result = await orchestrator.handleMessage(
      deviceId,
      "(圖片)",
      "data:image/png;base64,abc123",
      "asset:historical-image",
    );

    if (!("reply" in result)) throw new Error("expected reply result");
    assertSuccessfulLogReplyShape(result.reply, {
      fullFoodName: "鮭魚飯",
      expectsUncertainty: false,
      allowsNextStep: false,
    });
    assert.match(result.reply, /3\/25/);
  });

  it("recovers locally when the user replies 2 to a previously hallucinated choice prompt", async () => {
    const meal = await foodLoggingService.logGroupedMeal(deviceId, {
      items: [
        { foodName: "鮭魚飯", calories: 540, protein: 34, carbs: 58, fat: 18 },
      ],
    });
    await chatService.saveMessage(deviceId, "user", "(圖片)", { imagePath: "asset:meal-image" });
    const toolMessage = await chatService.saveMessage(deviceId, "tool", "成功", { toolName: "log_food" });
    await chatService.saveAssistantReplyWithReceipt({
      deviceId,
      content: "已收到圖片。若你選擇方式1，我會請你補充份量；若你選擇方式2，我會直接估算並記錄。",
      receipt: {
        toolMessageId: toolMessage.id,
        mealTransactionId: meal.id,
        mealRevisionId: meal.mealRevisionId,
      },
      mutationOutcomeFact: {
        action: "log_food",
        affectedDate: formatLocalDate(currentAppDate()),
        foodName: "鮭魚飯",
        calories: 540,
        protein: 34,
        carbs: 58,
        fat: 18,
      },
    });

    const result = await orchestrator.handleMessage(deviceId, "2");

    if (!("reply" in result)) throw new Error("expected reply result");
    assert.equal(result.didLogMeal, false);
    assert.equal(
      result.reply,
      "這餐剛剛已先依目前估算完成記錄。若你想更精準，我可以再依份量幫你調整。"
    );
    assert.equal(mockLLM.chatCalls.length, 0, "recovery path should not call the model again");
  });

  it("does not recover locally when a hallucinated choice prompt has no successful mutation evidence", async () => {
    await chatService.saveMessage(deviceId, "user", "(圖片)", { imagePath: "asset:meal-image" });
    await chatService.saveMessage(
      deviceId,
      "assistant",
      "已收到圖片。若你選擇方式1，我會請你補充份量；若你選擇方式2，我會直接估算並記錄。",
    );
    mockLLM.queueChatResponse({ content: "請補充份量，我再幫你估算。" });

    const result = await orchestrator.handleMessage(deviceId, "2");

    if (!("reply" in result)) throw new Error("expected reply result");
    assert.equal(result.didLogMeal, false);
    assert.equal(result.reply, "請補充份量，我再幫你估算。");
    assert.doesNotMatch(result.reply, /已記錄|完成記錄/);
    assert.equal(mockLLM.chatCalls.length, 1, "normal path should call the model");
  });

  it("does not recover locally when the prior log_food tool summary failed", async () => {
    await chatService.saveMessage(deviceId, "user", "(圖片)", { imagePath: "asset:meal-image" });
    await chatService.saveMessage(deviceId, "tool", "Error: validation failed", { toolName: "log_food" });
    await chatService.saveMessage(
      deviceId,
      "assistant",
      "已收到圖片。若你選擇方式1，我會請你補充份量；若你選擇方式2，我會直接估算並記錄。",
    );
    mockLLM.queueChatResponse({ content: "我需要你補充餐點內容，才能完成估算。" });

    const result = await orchestrator.handleMessage(deviceId, "2");

    if (!("reply" in result)) throw new Error("expected reply result");
    assert.equal(result.didLogMeal, false);
    assert.equal(result.reply, "我需要你補充餐點內容，才能完成估算。");
    assert.doesNotMatch(result.reply, /已記錄|完成記錄/);
    assert.equal(mockLLM.chatCalls.length, 1, "failed tool summary must not trigger local recovery");
  });

  it("handleMessage projects successful text log replies from normalized loggedMeal instead of model stream", async () => {
    const streamingLLM = new StreamingLLMProvider();
    const db = createDb(":memory:");
    const localDeviceService = createDeviceService(db);
    const localFoodLoggingService = createFoodLoggingService(db);
    const localSummaryService = createSummaryService(db);
    const localChatService = createChatService(db);
    const localGoalProposalService = createGoalProposalService(db);
    const localDeviceId = (await localDeviceService.createDevice("fat_loss")).deviceId;

    orchestrator = createOrchestrator({
      llmProvider: streamingLLM,
      chatService: localChatService,
      summaryService: localSummaryService,
      foodLoggingService: localFoodLoggingService,
      deviceService: localDeviceService,
    });

    streamingLLM.queueChatResponse({
      toolCalls: [{
        id: "call_1",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({ items: [{ food_name: "蘋果", calories: 100, protein: 1, carbs: 20, fat: 0.5 }] }),
        },
      }],
    });
    streamingLLM.queueRoundResponse({
      toolCalls: [{
        id: "call_1",
        type: "function",
        function: {
          name: "log_food",
          arguments: JSON.stringify({ items: [{ food_name: "蘋果", calories: 100, protein: 1, carbs: 20, fat: 0.5 }] }),
        },
      }],
    });
    streamingLLM.queueChatStream(["已幫", "你記錄", "蘋果！"]);

    const result = await orchestrator.handleMessage(localDeviceId, "我吃了蘋果");

    assert.ok("reply" in result);
    assert.equal(result.didLogMeal, true);
    assert.ok(result.dailySummary);
    assert.equal(streamingLLM.chatCalls.length, 1);
    assertSuccessfulLogReplyShape(result.reply, {
      fullFoodName: "蘋果",
      expectsUncertainty: true,
      allowsNextStep: true,
    });
    assert.match(result.reply, /蛋白質 0 g/);
    assert.doesNotMatch(result.reply, /已幫你記錄蘋果/);

    const historyBeforeStream = await localChatService.getHistory(localDeviceId, 10);
    assert.equal(historyBeforeStream.filter((message) => message.role === "assistant").length, 0);
  });

  it("handleMessage streams direct text replies when the provider exposes a round-level stream", async () => {
    const streamingLLM = new StreamingLLMProvider();
    const db = createDb(":memory:");
    const localDeviceService = createDeviceService(db);
    const localFoodLoggingService = createFoodLoggingService(db);
    const localSummaryService = createSummaryService(db);
    const localChatService = createChatService(db);
    const localGoalProposalService = createGoalProposalService(db);
    const localDeviceId = (await localDeviceService.createDevice("fat_loss")).deviceId;

    orchestrator = createOrchestrator({
      llmProvider: streamingLLM,
      chatService: localChatService,
      summaryService: localSummaryService,
      foodLoggingService: localFoodLoggingService,
      deviceService: localDeviceService,
    });

    streamingLLM.queueChatStream(["直接", "回覆"]);

    const result = await orchestrator.handleMessage(localDeviceId, "你好");

    assert.ok("streamGenerator" in result);
    const streamedTokens: string[] = [];
    for await (const token of result.streamGenerator) {
      streamedTokens.push(token);
    }
    assert.deepEqual(streamedTokens, ["直接", "回覆"]);
    assert.equal(result.didLogMeal, false);
    assert.equal(streamingLLM.chatCalls.length, 1);
  });

  it("handleMessage replaces no-mutation model replies that claim logging", async () => {
    mockLLM.queueChatResponse({ content: "已記錄牛肉飯，650 kcal，蛋白質 28 g。" });

    const result = await orchestrator.handleMessage(deviceId, "你好");

    assert.ok("reply" in result);
    assert.equal(result.didLogMeal, false);
    assert.equal(result.didMutateMeal, false);
    assert.doesNotMatch(result.reply, /已記錄|完成記錄/);
    assert.match(result.reply, /尚未|沒有|無法|補充/);
  });

  it("preserves get_daily_summary replies that mention recorded meals without mutation", async () => {
    await foodLoggingService.logGroupedMeal(deviceId, {
      items: [
        { foodName: "雞胸肉", calories: 450, protein: 45, carbs: 30, fat: 10 },
      ],
    });
    await foodLoggingService.logGroupedMeal(deviceId, {
      items: [
        { foodName: "鮭魚飯", calories: 450, protein: 35, carbs: 45, fat: 14 },
      ],
    });
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_summary_today",
        type: "function",
        function: {
          name: "get_daily_summary",
          arguments: "{}",
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "今天已記錄 2 餐，共 900 kcal。" });

    const result = await orchestrator.handleMessage(deviceId, "今天吃了多少？");

    assert.ok("reply" in result);
    assert.equal(result.didLogMeal, false);
    assert.equal(result.didMutateMeal, false);
    assert.equal(result.reply, "今天已記錄 2 餐，共 900 kcal：雞胸肉 450 kcal、鮭魚飯 450 kcal。");
  });

  it("replaces false new-log claims after get_daily_summary without mutation", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_summary_false_log",
        type: "function",
        function: {
          name: "get_daily_summary",
          arguments: "{}",
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "今天已記錄牛肉飯，650 kcal。" });

    const result = await orchestrator.handleMessage(deviceId, "今天吃了什麼？");

    assert.ok("reply" in result);
    assert.equal(result.didLogMeal, false);
    assert.equal(result.didMutateMeal, false);
    assert.doesNotMatch(result.reply, /已記錄牛肉飯|650 kcal/);
    assert.equal(result.reply, "今天已記錄 0 餐，共 0 kcal。");
  });

  it("does not let broad summary words bypass the no-mutation false-log guard", async () => {
    const falseClaims = [
      "今天已記錄牛肉飯，650 kcal。",
      "目前已記錄牛肉飯，650 kcal。",
      "共已記錄牛肉飯，650 kcal。",
      "攝取已記錄牛肉飯，650 kcal。",
    ];

    for (const claim of falseClaims) {
      mockLLM.queueChatResponse({
        toolCalls: [{
          id: `call_summary_false_log_${falseClaims.indexOf(claim)}`,
          type: "function",
          function: {
            name: "get_daily_summary",
            arguments: "{}",
          },
        }],
      });
      mockLLM.queueChatResponse({ content: claim });

      const { deviceId: localDeviceId } = await deviceService.createDevice("fat_loss");
      const result = await orchestrator.handleMessage(localDeviceId, "今天吃了什麼？");

      assert.ok("reply" in result);
      assert.equal(result.didLogMeal, false);
      assert.equal(result.didMutateMeal, false);
      assert.doesNotMatch(result.reply, /已記錄牛肉飯|650 kcal/);
      assert.equal(result.reply, "今天已記錄 0 餐，共 0 kcal。");
    }
  });

  it("preserves summary history replies after get_daily_summary without mutation", async () => {
    await foodLoggingService.logGroupedMeal(deviceId, {
      items: [
        { foodName: "豆腐飯", calories: 520, protein: 24, carbs: 70, fat: 14 },
      ],
    });
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_summary_history",
        type: "function",
        function: {
          name: "get_daily_summary",
          arguments: "{}",
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "目前已記錄的餐點有豆腐飯，約 520 kcal。" });

    const result = await orchestrator.handleMessage(deviceId, "列出今天記錄的餐點");

    assert.ok("reply" in result);
    assert.equal(result.didLogMeal, false);
    assert.equal(result.didMutateMeal, false);
    assert.equal(result.reply, "今天已記錄 1 餐，共 520 kcal：豆腐飯 520 kcal。");
  });

  it("composes summary history replies from persisted meal facts instead of unsafe model facts", async () => {
    await foodLoggingService.logGroupedMeal(deviceId, {
      items: [
        { foodName: "豆腐飯", calories: 520, protein: 24, carbs: 70, fat: 14 },
      ],
    });
    await foodLoggingService.logGroupedMeal(deviceId, {
      items: [
        { foodName: "鮭魚飯", calories: 380, protein: 28, carbs: 42, fat: 12 },
      ],
    });
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_summary_renderer_unsafe",
        type: "function",
        function: {
          name: "get_daily_summary",
          arguments: "{}",
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "今天已記錄牛肉飯，900 kcal。" });

    const result = await orchestrator.handleMessage(deviceId, "今天吃了什麼？");

    assert.ok("reply" in result);
    assert.equal(result.didLogMeal, false);
    assert.equal(result.didMutateMeal, false);
    assert.match(result.reply, /豆腐飯 520 kcal/);
    assert.match(result.reply, /鮭魚飯 380 kcal/);
    assert.match(result.reply, /今天已記錄 2 餐，共 900 kcal/);
    assert.doesNotMatch(result.reply, /牛肉飯/);
  });

  it("appends safe generic advice after deterministic summary history facts", async () => {
    await foodLoggingService.logGroupedMeal(deviceId, {
      items: [
        { foodName: "豆腐飯", calories: 520, protein: 24, carbs: 70, fat: 14 },
      ],
    });
    await foodLoggingService.logGroupedMeal(deviceId, {
      items: [
        { foodName: "鮭魚飯", calories: 380, protein: 28, carbs: 42, fat: 12 },
      ],
    });
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_summary_renderer_advice",
        type: "function",
        function: {
          name: "get_daily_summary",
          arguments: "{}",
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "可以保持清淡，晚餐多補水。" });

    const result = await orchestrator.handleMessage(deviceId, "今天記錄摘要");

    assert.ok("reply" in result);
    assert.equal(
      result.reply,
      "今天已記錄 2 餐，共 900 kcal：豆腐飯 520 kcal、鮭魚飯 380 kcal。\n\n可以保持清淡，晚餐多補水。",
    );
  });

  it("renders empty summary history days without no-mutation fallback copy", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_summary_renderer_empty",
        type: "function",
        function: {
          name: "get_daily_summary",
          arguments: "{}",
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "今天已記錄牛肉飯，900 kcal。" });

    const result = await orchestrator.handleMessage(deviceId, "今天有吃東西嗎？");

    assert.ok("reply" in result);
    assert.match(result.reply, /今天已記錄 0 餐，共 0 kcal/);
    assert.doesNotMatch(result.reply, /我還沒有把這餐寫入紀錄/);
    assert.doesNotMatch(result.reply, /牛肉飯|900 kcal/);
  });

  it("marks summary history plain replies as renderer owned", async () => {
    await foodLoggingService.logGroupedMeal(deviceId, {
      items: [
        { foodName: "豆腐飯", calories: 520, protein: 24, carbs: 70, fat: 14 },
      ],
    });
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "call_summary_renderer_metadata",
        type: "function",
        function: {
          name: "get_daily_summary",
          arguments: "{}",
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "可以保持清淡。" });

    const result = await orchestrator.handleMessage(deviceId, "今天摘要");

    assert.ok("reply" in result);
    assert.equal(result.finalReplySource, "renderer");
    assert.equal(result.finalReplyShape, "plain_text");
  });

  it("returns a renderer goal receipt instead of streaming model prefix/suffix text", async () => {
    const streamingLLM = new StreamingLLMProvider();
    const db = createDb(":memory:");
    const localDeviceService = createDeviceService(db);
    const localFoodLoggingService = createFoodLoggingService(db);
    const localSummaryService = createSummaryService(db);
    const localChatService = createChatService(db);
    const localGoalProposalService = createGoalProposalService(db);
    const localDeviceId = (await localDeviceService.createDevice("fat_loss")).deviceId;

    orchestrator = createOrchestrator({
      llmProvider: streamingLLM,
      chatService: localChatService,
      summaryService: localSummaryService,
      foodLoggingService: localFoodLoggingService,
      deviceService: localDeviceService,
      goalProposalService: localGoalProposalService,
      publisher: {
        publishGoalsUpdate() {
          return { sent: 1 };
        },
      },
    });

    streamingLLM.queueRoundResponse({
      toolCalls: [{
        id: "goal_stream",
        type: "function",
        function: {
          name: "update_goals",
          arguments: JSON.stringify({ mode: "current_turn_values", calories: 1800, protein: 130 }),
        },
      }],
    });
    streamingLLM.queueChatStream(["已經", "更新好了"]);

    const result = await orchestrator.handleMessage(localDeviceId, "卡路里 1800 蛋白質 130");

    assert.ok("reply" in result);
    assert.equal(result.reply, "已更新每日目標：\n• 卡路里 1800 kcal\n• 蛋白質 130 g\n• 碳水 150 g\n• 脂肪 50 g");
    assert.equal(result.finalReplySource, "renderer");
    assert.equal(result.finalReplyShape, "plain_text");
    const device = await localDeviceService.getDevice(localDeviceId);
    assert.equal(device?.dailyCalories, 1800);
    assert.equal(device?.dailyProtein, 130);
  });

  it("does not wait for a streamed final reply after a goal mutation succeeds", async () => {
    const streamingLLM = new StreamingLLMProvider();
    const db = createDb(":memory:");
    const localDeviceService = createDeviceService(db);
    const localFoodLoggingService = createFoodLoggingService(db);
    const localSummaryService = createSummaryService(db);
    const localChatService = createChatService(db);
    const localGoalProposalService = createGoalProposalService(db);
    const localDeviceId = (await localDeviceService.createDevice("fat_loss")).deviceId;

    orchestrator = createOrchestrator({
      llmProvider: streamingLLM,
      chatService: localChatService,
      summaryService: localSummaryService,
      foodLoggingService: localFoodLoggingService,
      deviceService: localDeviceService,
      goalProposalService: localGoalProposalService,
      publisher: {
        publishGoalsUpdate() {
          return { sent: 1 };
        },
      },
    });

    streamingLLM.queueRoundResponse({
      toolCalls: [{
        id: "goal_stream_error",
        type: "function",
        function: {
          name: "update_goals",
          arguments: JSON.stringify({ mode: "current_turn_values", calories: 1800, protein: 130 }),
        },
      }],
    });
    streamingLLM.queueChatStreamError(["處理中"], new Error("stream broke"));

    const result = await orchestrator.handleMessage(localDeviceId, "卡路里 1800 蛋白質 130");

    assert.ok("reply" in result);
    assert.equal(result.reply, "已更新每日目標：\n• 卡路里 1800 kcal\n• 蛋白質 130 g\n• 碳水 150 g\n• 脂肪 50 g");
    assert.equal(result.finalReplySource, "renderer");
  });

  it("does not enter legacy chatStream after a goal mutation succeeds", async () => {
    const streamingLLM = new ChatStreamOnlyProvider();
    const db = createDb(":memory:");
    const localDeviceService = createDeviceService(db);
    const localFoodLoggingService = createFoodLoggingService(db);
    const localSummaryService = createSummaryService(db);
    const localChatService = createChatService(db);
    const localGoalProposalService = createGoalProposalService(db);
    const localDeviceId = (await localDeviceService.createDevice("fat_loss")).deviceId;

    orchestrator = createOrchestrator({
      llmProvider: streamingLLM,
      chatService: localChatService,
      summaryService: localSummaryService,
      foodLoggingService: localFoodLoggingService,
      deviceService: localDeviceService,
      goalProposalService: localGoalProposalService,
      publisher: {
        publishGoalsUpdate() {
          return { sent: 1 };
        },
      },
    });

    streamingLLM.queueChatResponse({
      toolCalls: [{
        id: "goal_legacy_stream",
        type: "function",
        function: {
          name: "update_goals",
          arguments: JSON.stringify({ mode: "current_turn_values", calories: 1800, protein: 130 }),
        },
      }],
    });
    streamingLLM.queueChatStream(["已經", "更新好了"]);

    const result = await orchestrator.handleMessage(localDeviceId, "卡路里 1800 蛋白質 130");

    assert.ok("reply" in result);
    assert.equal(result.reply, "已更新每日目標：\n• 卡路里 1800 kcal\n• 蛋白質 130 g\n• 碳水 150 g\n• 脂肪 50 g");
    assert.equal(result.finalReplySource, "renderer");
  });

  it("short-circuits propose_goals with exact proposal copy and no second model round", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "proposal_copy",
        type: "function",
        function: {
          name: "propose_goals",
          arguments: JSON.stringify({
            calories: 1750,
            protein: 125,
            carbs: 180,
            fat: 55,
          }),
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "模型後續改寫：已經幫你更新好了。" });

    const result = await orchestrator.handleMessage(deviceId, "幫我建議一組減脂目標");

    assert.ok("reply" in result);
    assert.equal(result.reply, renderGoalProposalCopy({
      calories: 1750,
      protein: 125,
      carbs: 180,
      fat: 55,
    }));
    assert.equal(result.didLogMeal, false);
    assert.equal(result.didMutateMeal, false);
    assert.equal(result.finalReplySource, "renderer");
    assert.equal(result.finalReplyShape, "plain_text");
    assert.equal(mockLLM.chatCalls.length, 1);
  });

  it("short-circuits update_goals validation copy with unchanged targets and no second model round", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "goal_validation_copy",
        type: "function",
        function: {
          name: "update_goals",
          arguments: JSON.stringify({
            mode: "current_turn_values",
            calories: 100,
          }),
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "模型後續改寫：更新好了。" });

    const result = await orchestrator.handleMessage(deviceId, "卡路里 100");

    assert.ok("reply" in result);
    assert.equal(result.reply, renderGoalValidationFailureCopy(["calories"]));
    assert.equal(result.finalReplySource, "renderer");
    assert.equal(result.finalReplyShape, "plain_text");
    assert.equal(mockLLM.chatCalls.length, 1);
    const device = await deviceService.getDevice(deviceId);
    assert.equal(device?.dailyCalories, 1500);
    assert.equal(device?.dailyProtein, 120);
  });

  it("short-circuits empty update_goals args with generic rejection copy and no second model round", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "goal_empty_args",
        type: "function",
        function: {
          name: "update_goals",
          arguments: JSON.stringify({}),
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "模型後續改寫：已經幫你更新每日目標。" });

    const result = await orchestrator.handleMessage(deviceId, "好");

    assert.ok("reply" in result);
    assert.equal(result.reply, renderGoalAuthorityFailureCopy());
    assert.equal(result.finalReplySource, "renderer");
    assert.equal(result.finalReplyShape, "plain_text");
    assert.equal(mockLLM.chatCalls.length, 1);
    const device = await deviceService.getDevice(deviceId);
    assert.equal(device?.dailyCalories, 1500);
    assert.equal(device?.dailyProtein, 120);
  });

  it("short-circuits update_goals without mode with generic rejection copy and no second model round", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "goal_missing_mode",
        type: "function",
        function: {
          name: "update_goals",
          arguments: JSON.stringify({ calories: 1800 }),
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "模型後續改寫：已經幫你更新每日目標。" });

    const result = await orchestrator.handleMessage(deviceId, "卡路里 1800");

    assert.ok("reply" in result);
    assert.equal(result.reply, renderGoalAuthorityFailureCopy());
    assert.equal(result.finalReplySource, "renderer");
    assert.equal(result.finalReplyShape, "plain_text");
    assert.equal(mockLLM.chatCalls.length, 1);
    const device = await deviceService.getDevice(deviceId);
    assert.equal(device?.dailyCalories, 1500);
    assert.equal(device?.dailyProtein, 120);
  });

  it("short-circuits unavailable proposal confirmation with generic copy and no second model round", async () => {
    mockLLM.queueChatResponse({
      toolCalls: [{
        id: "missing_goal_proposal",
        type: "function",
        function: {
          name: "update_goals",
          arguments: JSON.stringify({ mode: "latest_proposal" }),
        },
      }],
    });
    mockLLM.queueChatResponse({ content: "模型後續改寫：已經幫你更新每日目標。" });

    const result = await orchestrator.handleMessage(deviceId, "好");

    assert.ok("reply" in result);
    assert.equal(result.reply, renderGoalAuthorityFailureCopy());
    assert.equal(result.finalReplySource, "renderer");
    assert.equal(result.finalReplyShape, "plain_text");
    assert.equal(mockLLM.chatCalls.length, 1);
  });

  it("clears an active proposal on cancel before any model call", async () => {
    await goalProposalService.putLatest({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      targets: {
        calories: 1750,
        protein: 125,
        carbs: 180,
        fat: 55,
      },
    });
    mockLLM.queueChatResponse({ content: "模型不應該被呼叫" });

    const result = await orchestrator.handleMessage(deviceId, "先不用");

    assert.ok("reply" in result);
    assert.equal(result.reply, renderGoalCancelCopy());
    assert.equal(result.didLogMeal, false);
    assert.equal(result.didMutateMeal, false);
    assert.equal(result.finalReplySource, "renderer");
    assert.equal(result.finalReplyShape, "plain_text");
    assert.equal(mockLLM.chatCalls.length, 0);
    assert.equal(await goalProposalService.getLatest({ deviceId, sessionId: DEFAULT_SESSION_ID }), undefined);
  });

  it("fails closed on bare consent when goal and meal proposals are both active", async () => {
    const meal = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:00:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 650, protein: 30, carbs: 80, fat: 20 },
      ],
    });
    await goalProposalService.putLatest({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      targets: {
        calories: 1750,
        protein: 125,
        carbs: 180,
        fat: 55,
      },
    });
    await mealNumericProposalService.putLatest({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      input: {
        mealId: meal.id,
        expectedMealRevisionId: meal.mealRevisionId,
        updateInput: { protein: 15 },
        affectedFields: [{ field: "protein", before: 30, after: 15 }],
        sourceOperator: "half",
      },
    });
    mockLLM.queueChatResponse({ content: "模型不應該被呼叫" });

    const result = await orchestrator.handleMessage(deviceId, "好");

    assert.ok("reply" in result);
    assert.equal(result.reply, renderProposalKindAmbiguityCopy());
    assert.equal(result.didLogMeal, false);
    assert.equal(result.didMutateMeal, false);
    assert.equal(result.finalReplySource, "renderer");
    assert.equal(result.finalReplyShape, "plain_text");
    assert.equal(mockLLM.chatCalls.length, 0);
    assert.ok(await goalProposalService.getLatest({ deviceId, sessionId: DEFAULT_SESSION_ID }));
    assert.ok(await mealNumericProposalService.getLatest({ deviceId, sessionId: DEFAULT_SESSION_ID }));
    const meals = await foodLoggingService.getMealsByDate(deviceId, new Date("2026-04-19T12:00:00.000Z"));
    assert.equal(meals.find((current) => current.id === meal.id)?.protein, 30);
  });

  it("fails closed on bare consent when goal and delete proposals are both active", async () => {
    const meal = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:00:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 650, protein: 30, carbs: 80, fat: 20 },
      ],
    });
    await goalProposalService.putLatest({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      targets: {
        calories: 1750,
        protein: 125,
        carbs: 180,
        fat: 55,
      },
    });
    await mealDeleteProposalService.putLatest({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      input: {
        mealId: meal.id,
        expectedMealRevisionId: meal.mealRevisionId,
        snapshot: {
          mealId: meal.id,
          expectedMealRevisionId: meal.mealRevisionId,
          mealLabel: "雞腿飯",
          calories: 650,
          protein: 30,
          carbs: 80,
          fat: 20,
          dateKey: "2026-04-19",
          loggedAt: meal.loggedAt,
          mealPeriod: "lunch",
        },
      },
    });
    mockLLM.queueChatResponse({ content: "模型不應該被呼叫" });

    for (const message of ["好", "確認", "確定"]) {
      const result = await orchestrator.handleMessage(deviceId, message);

      assert.ok("reply" in result);
      assert.equal(result.reply, renderProposalKindAmbiguityCopy(), message);
      assert.equal(result.didLogMeal, false);
      assert.equal(result.didMutateMeal, false);
      assert.equal(result.finalReplySource, "renderer");
      assert.equal(result.finalReplyShape, "plain_text");
      assert.equal(mockLLM.chatCalls.length, 0);
      assert.ok(await goalProposalService.getLatest({ deviceId, sessionId: DEFAULT_SESSION_ID }));
      assert.ok(await mealDeleteProposalService.getLatest({ deviceId, sessionId: DEFAULT_SESSION_ID }));
      const meals = await foodLoggingService.getMealsByDate(deviceId, new Date("2026-04-19T12:00:00.000Z"));
      assert.equal(meals.find((current) => current.id === meal.id)?.calories, 650);
    }
  });

  it("treats negated delete phrases as cancel instead of approval", async () => {
    const meal = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:00:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 650, protein: 30, carbs: 80, fat: 20 },
      ],
    });

    for (const message of ["我不想刪除", "先別刪除"]) {
      await mealDeleteProposalService.putLatest({
        deviceId,
        sessionId: DEFAULT_SESSION_ID,
        input: {
          mealId: meal.id,
          expectedMealRevisionId: meal.mealRevisionId,
          snapshot: {
            mealId: meal.id,
            expectedMealRevisionId: meal.mealRevisionId,
            mealLabel: "雞腿飯",
            calories: 650,
            protein: 30,
            carbs: 80,
            fat: 20,
            dateKey: "2026-04-19",
            loggedAt: meal.loggedAt,
            mealPeriod: "lunch",
          },
        },
      });

      const result = await orchestrator.handleMessage(deviceId, message);

      assert.ok("reply" in result);
      assert.equal(result.reply, renderMealDeleteCancelCopy(), message);
      assert.equal(result.didLogMeal, false);
      assert.equal(result.didMutateMeal, false);
      assert.equal(result.finalReplySource, "renderer");
      assert.equal(result.finalReplyShape, "plain_text");
      assert.equal(mockLLM.chatCalls.length, 0);
      assert.equal(await mealDeleteProposalService.getLatest({ deviceId, sessionId: DEFAULT_SESSION_ID }), undefined);
      const meals = await foodLoggingService.getMealsByDate(deviceId, new Date("2026-04-19T12:00:00.000Z"));
      assert.equal(meals.find((current) => current.id === meal.id)?.calories, 650);
    }
  });

  it("clears goal and meal proposals on broad cancel before any model call", async () => {
    const meal = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:00:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 650, protein: 30, carbs: 80, fat: 20 },
      ],
    });
    await goalProposalService.putLatest({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      targets: {
        calories: 1750,
        protein: 125,
        carbs: 180,
        fat: 55,
      },
    });
    await mealNumericProposalService.putLatest({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      input: {
        mealId: meal.id,
        expectedMealRevisionId: meal.mealRevisionId,
        updateInput: { protein: 15 },
        affectedFields: [{ field: "protein", before: 30, after: 15 }],
        sourceOperator: "half",
      },
    });
    mockLLM.queueChatResponse({ content: "模型不應該被呼叫" });

    const result = await orchestrator.handleMessage(deviceId, "不要");

    assert.ok("reply" in result);
    assert.equal(result.reply, renderProposalKindAmbiguityCopy());
    assert.equal(result.didLogMeal, false);
    assert.equal(result.didMutateMeal, false);
    assert.equal(result.finalReplySource, "renderer");
    assert.equal(result.finalReplyShape, "plain_text");
    assert.equal(mockLLM.chatCalls.length, 0);
    assert.ok(await goalProposalService.getLatest({ deviceId, sessionId: DEFAULT_SESSION_ID }));
    assert.ok(await mealNumericProposalService.getLatest({ deviceId, sessionId: DEFAULT_SESSION_ID }));
  });

  it("clears only the meal proposal on kind-specific meal cancel", async () => {
    const meal = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:00:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 650, protein: 30, carbs: 80, fat: 20 },
      ],
    });
    await goalProposalService.putLatest({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      targets: {
        calories: 1750,
        protein: 125,
        carbs: 180,
        fat: 55,
      },
    });
    await mealNumericProposalService.putLatest({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      input: {
        mealId: meal.id,
        expectedMealRevisionId: meal.mealRevisionId,
        updateInput: { protein: 15 },
        affectedFields: [{ field: "protein", before: 30, after: 15 }],
        sourceOperator: "half",
      },
    });

    const result = await orchestrator.handleMessage(deviceId, "取消餐點修改");

    assert.ok("reply" in result);
    assert.equal(result.reply, renderMealNumericCancelCopy());
    assert.equal(result.didMutateMeal, false);
    assert.equal(mockLLM.chatCalls.length, 0);
    assert.ok(await goalProposalService.getLatest({ deviceId, sessionId: DEFAULT_SESSION_ID }));
    assert.equal(await mealNumericProposalService.getLatest({ deviceId, sessionId: DEFAULT_SESSION_ID }), undefined);
  });

  it("applies only the stored meal proposal on kind-specific meal approval without a model round", async () => {
    const meal = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:00:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 650, protein: 30, carbs: 80, fat: 20 },
      ],
    });
    await goalProposalService.putLatest({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      targets: {
        calories: 1750,
        protein: 125,
        carbs: 180,
        fat: 55,
      },
    });
    await mealNumericProposalService.putLatest({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      input: {
        mealId: meal.id,
        expectedMealRevisionId: meal.mealRevisionId,
        updateInput: { protein: 15 },
        affectedFields: [{ field: "protein", before: 30, after: 15 }],
        sourceOperator: "half",
      },
    });

    const result = await orchestrator.handleMessage(deviceId, "套用餐點修改");

    assert.ok("reply" in result);
    assert.match(result.reply, /已更新.*雞腿飯.*蛋白質 15 g/);
    assert.equal(result.didLogMeal, false);
    assert.equal(result.didMutateMeal, true);
    assert.equal(result.finalReplySource, "renderer");
    assert.equal(result.finalReplyShape, "plain_text");
    assert.equal(mockLLM.chatCalls.length, 0);
    assert.ok(await goalProposalService.getLatest({ deviceId, sessionId: DEFAULT_SESSION_ID }));
    assert.equal(await mealNumericProposalService.getLatest({ deviceId, sessionId: DEFAULT_SESSION_ID }), undefined);
    const meals = await foodLoggingService.getMealsByDate(deviceId, new Date("2026-04-19T12:00:00.000Z"));
    assert.equal(meals.find((current) => current.id === meal.id)?.protein, 15);
  });

  it("confirms the active delete proposal by consuming before deleting exactly that meal", async () => {
    const firstMeal = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:00:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 650, protein: 30, carbs: 80, fat: 20 },
      ],
    });
    const secondMeal = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T10:00:00.000Z",
      items: [
        { foodName: "鮭魚飯", calories: 520, protein: 32, carbs: 58, fat: 14 },
      ],
    });
    await mealDeleteProposalService.putLatest({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      input: {
        mealId: firstMeal.id,
        expectedMealRevisionId: firstMeal.mealRevisionId,
        snapshot: {
          mealId: firstMeal.id,
          expectedMealRevisionId: firstMeal.mealRevisionId,
          mealLabel: "雞腿飯",
          calories: 650,
          protein: 30,
          carbs: 80,
          fat: 20,
          dateKey: "2026-04-19",
          loggedAt: firstMeal.loggedAt,
          mealPeriod: "lunch",
        },
      },
    });
    const deleteCalls: Array<{ mealId: string; expectedMealRevisionId?: string | null }> = [];
    let clearPendingSelectionCalls = 0;
    const trackedMealCorrectionService = {
      ...mealCorrectionService,
      async deleteMeal(...args: Parameters<typeof mealCorrectionService.deleteMeal>) {
        deleteCalls.push({ mealId: args[1], expectedMealRevisionId: args[2] });
        return mealCorrectionService.deleteMeal(...args);
      },
      async clearPendingSelection(...args: Parameters<typeof mealCorrectionService.clearPendingSelection>) {
        clearPendingSelectionCalls += 1;
        return mealCorrectionService.clearPendingSelection(...args);
      },
    };
    const trackedProposalActionService = createProposalActionService({
      db,
      chatService,
      proposalCardService,
      goalProposalService,
      mealDeleteProposalService,
      mealNumericProposalService,
      mealCorrectionService: trackedMealCorrectionService,
      deviceService,
      publisher,
    });
    const approvalOrchestrator = createOrchestrator({
      llmProvider: mockLLM,
      chatService,
      summaryService,
      foodLoggingService,
      mealCorrectionService: trackedMealCorrectionService,
      deviceService,
      goalProposalService,
      mealDeleteProposalService,
      mealNumericProposalService,
      proposalActionService: trackedProposalActionService,
    });

    const result = await approvalOrchestrator.handleMessage(deviceId, "確認");

    assert.ok("reply" in result);
    assert.match(result.reply, /已刪除4\/19 雞腿飯，已從當日紀錄移除。/);
    assert.equal(result.didMutateMeal, true);
    assert.equal(result.deletedMealId, firstMeal.id);
    assert.equal(mockLLM.chatCalls.length, 0);
    assert.deepEqual(deleteCalls, [{ mealId: firstMeal.id, expectedMealRevisionId: firstMeal.mealRevisionId }]);
    assert.equal(clearPendingSelectionCalls, 1);
    assert.equal(await mealDeleteProposalService.getLatest({ deviceId, sessionId: DEFAULT_SESSION_ID }), undefined);
    const meals = await foodLoggingService.getMealsByDate(deviceId, new Date("2026-04-19T12:00:00.000Z"));
    assert.equal(meals.some((meal) => meal.id === firstMeal.id), false);
    assert.equal(meals.some((meal) => meal.id === secondMeal.id), true);
  });

  it("clears an active delete proposal on cancel without deleting or calling the model", async () => {
    const meal = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:00:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 650, protein: 30, carbs: 80, fat: 20 },
      ],
    });
    await mealDeleteProposalService.putLatest({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      input: {
        mealId: meal.id,
        expectedMealRevisionId: meal.mealRevisionId,
        snapshot: {
          mealId: meal.id,
          expectedMealRevisionId: meal.mealRevisionId,
          mealLabel: "雞腿飯",
          calories: 650,
          protein: 30,
          carbs: 80,
          fat: 20,
          dateKey: "2026-04-19",
          loggedAt: meal.loggedAt,
          mealPeriod: "lunch",
        },
      },
    });

    const result = await orchestrator.handleMessage(deviceId, "取消");

    assert.ok("reply" in result);
    assert.equal(result.reply, renderMealDeleteCancelCopy());
    assert.equal(result.didMutateMeal, false);
    assert.equal(mockLLM.chatCalls.length, 0);
    assert.equal(await mealDeleteProposalService.getLatest({ deviceId, sessionId: DEFAULT_SESSION_ID }), undefined);
    const meals = await foodLoggingService.getMealsByDate(deviceId, new Date("2026-04-19T12:00:00.000Z"));
    assert.equal(meals.some((current) => current.id === meal.id), true);
  });

  it("fails closed when delete proposal consume returns no payload", async () => {
    const meal = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:00:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 650, protein: 30, carbs: 80, fat: 20 },
      ],
    });
    const proposal = await mealDeleteProposalService.putLatest({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      input: {
        mealId: meal.id,
        expectedMealRevisionId: meal.mealRevisionId,
        snapshot: {
          mealId: meal.id,
          expectedMealRevisionId: meal.mealRevisionId,
          mealLabel: "雞腿飯",
          calories: 650,
          protein: 30,
          carbs: 80,
          fat: 20,
          dateKey: "2026-04-19",
          loggedAt: meal.loggedAt,
          mealPeriod: "lunch",
        },
      },
    });
    let deleteCalls = 0;
    const authorityFailureMealCorrectionService = {
      ...mealCorrectionService,
      async deleteMeal(...args: Parameters<typeof mealCorrectionService.deleteMeal>) {
        deleteCalls += 1;
        return mealCorrectionService.deleteMeal(...args);
      },
    };
    const authorityFailureMealDeleteProposalService = {
      ...mealDeleteProposalService,
      async getLatest() {
        return proposal;
      },
      async consumeLatest() {
        return undefined;
      },
    };
    const authorityFailureProposalActionService = createProposalActionService({
      db,
      chatService,
      proposalCardService,
      goalProposalService,
      mealDeleteProposalService: authorityFailureMealDeleteProposalService,
      mealNumericProposalService,
      mealCorrectionService: authorityFailureMealCorrectionService,
      deviceService,
      publisher,
    });
    const authorityFailureOrchestrator = createOrchestrator({
      llmProvider: mockLLM,
      chatService,
      summaryService,
      foodLoggingService,
      mealCorrectionService: authorityFailureMealCorrectionService,
      deviceService,
      goalProposalService,
      mealDeleteProposalService: authorityFailureMealDeleteProposalService,
      mealNumericProposalService,
      proposalActionService: authorityFailureProposalActionService,
    });

    const result = await authorityFailureOrchestrator.handleMessage(deviceId, "好");

    assert.ok("reply" in result);
    assert.equal(result.reply, renderProposalInactiveCopy({ proposalKind: "meal_delete", status: "stale" }));
    assert.equal(result.didMutateMeal, false);
    assert.equal(deleteCalls, 0);
    assert.equal(mockLLM.chatCalls.length, 0);
    const meals = await foodLoggingService.getMealsByDate(deviceId, new Date("2026-04-19T12:00:00.000Z"));
    assert.equal(meals.some((current) => current.id === meal.id), true);
  });

  it("returns stale delete copy when the previewed meal revision changed before confirmation", async () => {
    const meal = await foodLoggingService.logGroupedMeal(deviceId, {
      loggedAt: "2026-04-19T04:00:00.000Z",
      items: [
        { foodName: "雞腿飯", calories: 650, protein: 30, carbs: 80, fat: 20 },
      ],
    });
    await mealDeleteProposalService.putLatest({
      deviceId,
      sessionId: DEFAULT_SESSION_ID,
      input: {
        mealId: meal.id,
        expectedMealRevisionId: meal.mealRevisionId,
        snapshot: {
          mealId: meal.id,
          expectedMealRevisionId: meal.mealRevisionId,
          mealLabel: "雞腿飯",
          calories: 650,
          protein: 30,
          carbs: 80,
          fat: 20,
          dateKey: "2026-04-19",
          loggedAt: meal.loggedAt,
          mealPeriod: "lunch",
        },
      },
    });
    await mealCorrectionService.updateMeal(
      deviceId,
      meal.id,
      { patch: { foodName: "新版雞腿飯", calories: 700, protein: 35, carbs: 82, fat: 22 } },
      meal.mealRevisionId,
    );

    const result = await orchestrator.handleMessage(deviceId, "好");

    assert.ok("reply" in result);
    assert.equal(result.reply, renderProposalInactiveCopy({ proposalKind: "meal_delete", status: "stale" }));
    assert.equal(result.didMutateMeal, false);
    assert.equal(mockLLM.chatCalls.length, 0);
    assert.equal(await mealDeleteProposalService.getLatest({ deviceId, sessionId: DEFAULT_SESSION_ID }), undefined);
    const meals = await foodLoggingService.getMealsByDate(deviceId, new Date("2026-04-19T12:00:00.000Z"));
    assert.equal(meals.some((current) => current.id === meal.id), true);
  });
});
