import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { FastifyBaseLogger } from "fastify";
import { isLLMProviderError } from "../../server/llm/errors.js";
import { MockLLMProvider } from "../../server/llm/mock.js";
import {
  buildTargetGenerationAttemptFailedEvent,
  buildTargetGenerationFallbackUsedEvent,
} from "../../server/observability/events.js";
import {
  TARGET_GENERATION_MAX_COACH_EXPLANATION_CHARS,
  TARGET_GENERATION_METADATA_CONTEXT,
  createTargetGenerationService,
} from "../../server/services/target-generation.js";
import { getGoalDefaults, type Goal, type IntakeFields } from "../../server/services/device.js";

interface CapturedLog {
  payload: Record<string, unknown>;
  message: string;
}

const validTargets = {
  calories: 1800,
  protein: 140,
  carbs: 180,
  fat: 60,
  coachExplanation: "先用這組目標執行兩週，再依體重和訓練表現調整。",
};

const forbiddenLogSentinels = [
  "raw-model-output-sentinel",
  "user-intake-sentinel",
  "provider body",
  "authorization",
  "x-request-id",
  "1100",
  "1200",
  "4000",
  "Expected",
  "Too small",
  "Invalid input",
  "希望減脂但保住重訓表現",
  "晚餐常外食",
];

function createIntake(overrides: Partial<IntakeFields> = {}): IntakeFields {
  return {
    sex: "female",
    age: 32,
    heightCm: 164,
    weightKg: 58,
    activityLevel: "moderate",
    trainingFrequency: "3_4",
    allergies: "花生",
    goalClarification: "希望減脂但保住重訓表現",
    bodyFatPercent: 24,
    tdee: 1980,
    advancedNotes: "晚餐常外食 user-intake-sentinel",
    ...overrides,
  };
}

function queueObject(mockLLM: MockLLMProvider, value: unknown) {
  mockLLM.queueObjectContent(JSON.stringify(value));
}

function queueValidObject(mockLLM: MockLLMProvider, overrides: Partial<typeof validTargets> = {}) {
  queueObject(mockLLM, { ...validTargets, ...overrides });
}

function extractUserContent(mockLLM: MockLLMProvider, callIndex = 0): string {
  const content = mockLLM.objectCalls[callIndex]?.messages[1]?.content;
  if (typeof content !== "string") {
    throw new Error("expected user message content to be a string");
  }
  return content;
}

function createLoggerCapture() {
  const entries: CapturedLog[] = [];
  const logger = {
    info(payload: Record<string, unknown>, message: string) {
      entries.push({ payload, message });
    },
    warn(payload: Record<string, unknown>, message: string) {
      entries.push({ payload, message });
    },
  } as unknown as FastifyBaseLogger;
  return { entries, logger };
}

function assertNoForbiddenLogContent(value: unknown) {
  const serialized = JSON.stringify(value);
  for (const sentinel of forbiddenLogSentinels) {
    assert.equal(serialized.includes(sentinel), false, `leaked forbidden log content: ${sentinel}`);
  }
}

function attemptEvents(entries: CapturedLog[]) {
  return entries
    .map((entry) => entry.payload)
    .filter((payload) => payload.event === "target_generation_attempt_failed");
}

function fallbackEvents(entries: CapturedLog[]) {
  return entries
    .map((entry) => entry.payload)
    .filter((payload) => payload.event === "target_generation_fallback_used");
}

async function generateWithFirstFailureThenSuccess(
  queueFailure: (mockLLM: MockLLMProvider) => void,
  goal: Goal = "fat_loss",
) {
  const mockLLM = new MockLLMProvider();
  const { entries, logger } = createLoggerCapture();
  const service = createTargetGenerationService(mockLLM, logger);

  queueFailure(mockLLM);
  queueValidObject(mockLLM);

  const result = await service.generateTargets(goal, createIntake());
  return { entries, mockLLM, result };
}

describe("target-generation service", () => {
  it("uses generateObject with target-generation metadata and a strict schema hint", async () => {
    const mockLLM = new MockLLMProvider();
    const service = createTargetGenerationService(mockLLM);
    const intake = createIntake();
    queueValidObject(mockLLM);

    const result = await service.generateTargets("fat_loss", intake);

    assert.equal(result.usedFallback, false);
    assert.deepEqual(result.dailyTargets, {
      calories: validTargets.calories,
      protein: validTargets.protein,
      carbs: validTargets.carbs,
      fat: validTargets.fat,
    });
    assert.equal(result.coachExplanation, validTargets.coachExplanation);
    assert.equal(mockLLM.chatCalls.length, 0);
    assert.equal(mockLLM.objectCalls.length, 1);

    const request = mockLLM.objectCalls[0].request;
    assert.equal(request.metadataContext, TARGET_GENERATION_METADATA_CONTEXT);
    assert.equal(request.schemaHint?.strict, true);
    assert.equal(request.schemaHint?.schema.additionalProperties, false);
    assert.deepEqual(request.schemaHint?.schema.required, [
      "calories",
      "protein",
      "carbs",
      "fat",
      "coachExplanation",
    ]);
    assert.deepEqual(request.schemaHint?.schema.properties, {
      calories: { type: "integer", minimum: 1 },
      protein: { type: "integer", minimum: 1 },
      carbs: { type: "integer", minimum: 0 },
      fat: { type: "integer", minimum: 1 },
      coachExplanation: {
        type: "string",
        minLength: 1,
        maxLength: TARGET_GENERATION_MAX_COACH_EXPLANATION_CHARS,
      },
    });

    const userContent = extractUserContent(mockLLM);
    assert.match(userContent, /goalClarification/);
    assert.match(userContent, /希望減脂但保住重訓表現/);
    assert.match(userContent, /bodyFatPercent/);
    assert.match(userContent, /24/);
    assert.match(userContent, /advancedNotes/);
    assert.match(userContent, /晚餐常外食/);
  });

  const strictFailureCases: Array<{
    name: string;
    queueFailure: (mockLLM: MockLLMProvider) => void;
  }> = [
    {
      name: "legacy nested dailyTargets with explanation alias",
      queueFailure: (mockLLM) => queueObject(mockLLM, {
        dailyTargets: { calories: 1750, protein: 145, carbs: 175, fat: 49 },
        explanation: "raw-model-output-sentinel",
      }),
    },
    {
      name: "fenced JSON text",
      queueFailure: (mockLLM) => mockLLM.queueObjectContent(
        "```json\n{\"calories\":1750,\"protein\":145,\"carbs\":175,\"fat\":49,\"coachExplanation\":\"raw-model-output-sentinel\"}\n```",
      ),
    },
    {
      name: "extra key",
      queueFailure: (mockLLM) => queueObject(mockLLM, {
        ...validTargets,
        raw_model_payload: "raw-model-output-sentinel",
      }),
    },
    {
      name: "decimal number",
      queueFailure: (mockLLM) => queueObject(mockLLM, { ...validTargets, calories: 1800.5 }),
    },
    {
      name: "empty coachExplanation",
      queueFailure: (mockLLM) => queueObject(mockLLM, { ...validTargets, coachExplanation: "   " }),
    },
    {
      name: "overlong coachExplanation",
      queueFailure: (mockLLM) => queueObject(mockLLM, {
        ...validTargets,
        coachExplanation: "說".repeat(TARGET_GENERATION_MAX_COACH_EXPLANATION_CHARS + 1),
      }),
    },
  ];

  for (const testCase of strictFailureCases) {
    it(`rejects ${testCase.name} before trusting the second structured object`, async () => {
      const { entries, mockLLM, result } = await generateWithFirstFailureThenSuccess(testCase.queueFailure);

      assert.equal(mockLLM.objectCalls.length, 2);
      assert.equal(mockLLM.chatCalls.length, 0);
      assert.equal(result.usedFallback, false);
      assert.deepEqual(result.dailyTargets, {
        calories: validTargets.calories,
        protein: validTargets.protein,
        carbs: validTargets.carbs,
        fat: validTargets.fat,
      });
      assert.equal(attemptEvents(entries).length, 1);
      assertNoForbiddenLogContent(entries);
    });
  }

  it("maps missing canonical fields to missing_field without raw validation messages", async () => {
    const { entries, result } = await generateWithFirstFailureThenSuccess((mockLLM) => {
      queueObject(mockLLM, {
        calories: 1800,
        protein: 140,
        carbs: 180,
        fat: 60,
        raw: "raw-model-output-sentinel",
      });
    });

    assert.equal(result.usedFallback, false);
    const [event] = attemptEvents(entries);
    assert.equal(event.providerReason, "schema_validation");
    assert.equal(event.targetReason, "missing_field");
    assert.equal(event.metadataContext, TARGET_GENERATION_METADATA_CONTEXT);
    assert.deepEqual(event.fields, ["coachExplanation", "root"]);
    assert.ok(Array.isArray(event.codes));
    assert.ok((event.codes as string[]).includes("missing_required"));
    assertNoForbiddenLogContent(entries);
  });

  it("maps calorie bounds failures to bounds_failed without logging rejected values or bounds", async () => {
    const { entries, result } = await generateWithFirstFailureThenSuccess((mockLLM) => {
      queueObject(mockLLM, { ...validTargets, calories: 1100 });
    });

    assert.equal(result.usedFallback, false);
    const [event] = attemptEvents(entries);
    assert.equal(event.providerReason, "schema_validation");
    assert.equal(event.targetReason, "bounds_failed");
    assert.deepEqual(event.fields, ["calories"]);
    assert.deepEqual(event.codes, ["bounds_failed"]);
    assertNoForbiddenLogContent(entries);
  });

  it("maps macro calorie mismatch failures to macro_calorie_mismatch without logging macro totals", async () => {
    const { entries, result } = await generateWithFirstFailureThenSuccess((mockLLM) => {
      queueObject(mockLLM, {
        ...validTargets,
        calories: 1800,
        protein: 30,
        carbs: 30,
        fat: 30,
      });
    });

    assert.equal(result.usedFallback, false);
    const [event] = attemptEvents(entries);
    assert.equal(event.providerReason, "schema_validation");
    assert.equal(event.targetReason, "macro_calorie_mismatch");
    assert.deepEqual(event.fields, ["calories", "carbs", "fat", "protein"]);
    assert.deepEqual(event.codes, ["macro_calorie_mismatch"]);
    assertNoForbiddenLogContent(entries);
  });

  const retryableReasonCases: Array<{
    name: string;
    targetReason: string;
    queueFailure: (mockLLM: MockLLMProvider) => void;
  }> = [
    {
      name: "provider_error",
      targetReason: "provider_error",
      queueFailure: (mockLLM) => mockLLM.queueObjectProviderError(),
    },
    {
      name: "invalid_json",
      targetReason: "invalid_json",
      queueFailure: (mockLLM) => mockLLM.queueObjectContent("raw-model-output-sentinel not json"),
    },
    {
      name: "no_content",
      targetReason: "no_content",
      queueFailure: (mockLLM) => mockLLM.queueObjectNoContent("empty_content"),
    },
    {
      name: "missing_field",
      targetReason: "missing_field",
      queueFailure: (mockLLM) => queueObject(mockLLM, {
        calories: 1800,
        protein: 140,
        carbs: 180,
        fat: 60,
      }),
    },
    {
      name: "schema_validation",
      targetReason: "schema_validation",
      queueFailure: (mockLLM) => queueObject(mockLLM, { ...validTargets, calories: 1800.5 }),
    },
    {
      name: "bounds_failed",
      targetReason: "bounds_failed",
      queueFailure: (mockLLM) => queueObject(mockLLM, { ...validTargets, calories: 1100 }),
    },
    {
      name: "macro_calorie_mismatch",
      targetReason: "macro_calorie_mismatch",
      queueFailure: (mockLLM) => queueObject(mockLLM, {
        ...validTargets,
        calories: 1800,
        protein: 30,
        carbs: 30,
        fat: 30,
      }),
    },
  ];

  for (const testCase of retryableReasonCases) {
    it(`retries once after ${testCase.name} and accepts the second structured object`, async () => {
      const { entries, mockLLM, result } = await generateWithFirstFailureThenSuccess(testCase.queueFailure);

      assert.equal(mockLLM.objectCalls.length, 2);
      assert.equal(result.usedFallback, false);
      const [event] = attemptEvents(entries);
      assert.equal(event.targetReason, testCase.targetReason);
      assert.equal(fallbackEvents(entries).length, 0);
      assertNoForbiddenLogContent(entries);
    });
  }

  it("returns deterministic fallback defaults after the second normal failure", async () => {
    const mockLLM = new MockLLMProvider();
    const { entries, logger } = createLoggerCapture();
    const service = createTargetGenerationService(mockLLM, logger);

    queueObject(mockLLM, {
      calories: 1800,
      protein: 140,
      carbs: 180,
      fat: 60,
      raw: "raw-model-output-sentinel",
    });
    queueObject(mockLLM, { ...validTargets, calories: 1100 });

    const result = await service.generateTargets("fat_loss", createIntake());

    assert.equal(mockLLM.objectCalls.length, 2);
    assert.equal(result.usedFallback, true);
    assert.deepEqual(result.dailyTargets, getGoalDefaults("fat_loss"));
    assert.match(result.coachExplanation, /預設/);
    assert.equal(attemptEvents(entries).length, 2);
    const [fallback] = fallbackEvents(entries);
    assert.equal(fallback.providerReason, "schema_validation");
    assert.equal(fallback.targetReason, "bounds_failed");
    assertNoForbiddenLogContent(entries);
  });

  it("uses goal-specific fallback defaults", async () => {
    const mockLLM = new MockLLMProvider();
    const service = createTargetGenerationService(mockLLM);

    mockLLM.queueObjectProviderError();
    mockLLM.queueObjectProviderError();

    const result = await service.generateTargets("muscle_gain", createIntake());

    assert.equal(result.usedFallback, true);
    assert.deepEqual(result.dailyTargets, getGoalDefaults("muscle_gain"));
  });

  it("propagates provider aborts without returning fallback or logging fallback usage", async () => {
    const mockLLM = new MockLLMProvider();
    const { entries, logger } = createLoggerCapture();
    const service = createTargetGenerationService(mockLLM, logger);

    mockLLM.queueObjectAbort();

    await assert.rejects(
      () => service.generateTargets("fat_loss", createIntake()),
      (error) => isLLMProviderError(error) && error.providerMetadata.aborted === true,
    );
    assert.equal(mockLLM.objectCalls.length, 1);
    assert.equal(fallbackEvents(entries).length, 0);
    assertNoForbiddenLogContent(entries);
  });

  it("passes caller abort signals into generateObject without returning fallback", async () => {
    const mockLLM = new MockLLMProvider();
    const { entries, logger } = createLoggerCapture();
    const service = createTargetGenerationService(mockLLM, logger);
    const controller = new AbortController();
    controller.abort();

    await assert.rejects(
      () => service.generateTargets("fat_loss", createIntake(), { signal: controller.signal }),
      (error) => isLLMProviderError(error) && error.providerMetadata.aborted === true,
    );

    assert.equal(mockLLM.objectCalls.length, 1);
    assert.equal(mockLLM.objectCalls[0].opts?.signal, controller.signal);
    assert.equal(attemptEvents(entries).length, 0);
    assert.equal(fallbackEvents(entries).length, 0);
  });

  it("drops unsafe runtime noContentSubtype values from target-generation events", () => {
    const unsafeSubtype = "authorization raw provider body user-intake-sentinel";

    const attempt = buildTargetGenerationAttemptFailedEvent({
      attempt: 1,
      providerReason: "no_content",
      targetReason: "no_content",
      metadataContext: TARGET_GENERATION_METADATA_CONTEXT,
      noContentSubtype: unsafeSubtype,
    });
    const fallback = buildTargetGenerationFallbackUsedEvent({
      attempt: 2,
      providerReason: "no_content",
      targetReason: "no_content",
      metadataContext: TARGET_GENERATION_METADATA_CONTEXT,
      noContentSubtype: unsafeSubtype,
    });

    assert.equal("noContentSubtype" in attempt, false);
    assert.equal("noContentSubtype" in fallback, false);
    assertNoForbiddenLogContent([attempt, fallback]);
  });
});
