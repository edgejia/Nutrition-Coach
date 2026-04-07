import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MockLLMProvider } from "../../server/llm/mock.js";
import { createTargetGenerationService } from "../../server/services/target-generation.js";
import type { Goal, IntakeFields } from "../../server/services/device.js";

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
    advancedNotes: "晚餐常外食",
    ...overrides,
  };
}

function extractUserContent(mockLLM: MockLLMProvider, callIndex = 0): string {
  const content = mockLLM.chatCalls[callIndex]?.messages[1]?.content;
  if (typeof content !== "string") {
    throw new Error("expected user message content to be a string");
  }
  return content;
}

describe("target-generation service", () => {
  it("passes intake fields to the LLM prompt and calls with no tools", async () => {
    const mockLLM = new MockLLMProvider();
    const service = createTargetGenerationService(mockLLM);
    const intake = createIntake();

    mockLLM.queueChatResponse({
      content: JSON.stringify({
        dailyTargets: { calories: 1800, protein: 150, carbs: 180, fat: 50 },
        coachExplanation: "好",
      }),
    });

    await service.generateTargets("fat_loss", intake);

    assert.equal(mockLLM.chatCalls.length, 1);
    assert.equal(mockLLM.chatCalls[0].tools.length, 0);
    const userContent = extractUserContent(mockLLM);
    assert.match(userContent, /goalClarification/);
    assert.match(userContent, /希望減脂但保住重訓表現/);
    assert.match(userContent, /bodyFatPercent/);
    assert.match(userContent, /24/);
    assert.match(userContent, /advancedNotes/);
    assert.match(userContent, /晚餐常外食/);
  });

  it("generates targets from a fenced JSON LLM response", async () => {
    const mockLLM = new MockLLMProvider();
    const service = createTargetGenerationService(mockLLM);

    mockLLM.queueChatResponse({
      content: "```json\n{\"dailyTargets\":{\"calories\":1750,\"protein\":145,\"carbs\":175,\"fat\":49},\"explanation\":\"可先這樣試 2 週\"}\n```",
    });

    const result = await service.generateTargets("fat_loss", createIntake());

    assert.equal(result.usedFallback, false);
    assert.deepEqual(result.dailyTargets, {
      calories: 1750,
      protein: 145,
      carbs: 175,
      fat: 49,
    });
    assert.equal(result.coachExplanation, "可先這樣試 2 週");
  });

  it("rejects malformed numeric fields and retries once before succeeding", async () => {
    const mockLLM = new MockLLMProvider();
    const service = createTargetGenerationService(mockLLM);

    mockLLM.queueChatResponse({
      content: JSON.stringify({
        dailyTargets: { calories: null, protein: 150, carbs: 180, fat: 50 },
        explanation: "第一次不合格",
      }),
    });
    mockLLM.queueChatResponse({
      content: JSON.stringify({
        dailyTargets: { calories: 1850, protein: 150, carbs: 180, fat: 55 },
        explanation: "第二次也不合格",
      }),
    });

    const result = await service.generateTargets("fat_loss", createIntake());

    assert.equal(mockLLM.chatCalls.length, 2);
    assert.equal(result.usedFallback, false);
    assert.deepEqual(result.dailyTargets, {
      calories: 1850,
      protein: 150,
      carbs: 180,
      fat: 55,
    });
    assert.equal(result.coachExplanation, "第二次也不合格");
  });

  it("rejects missing explanation and retries once before falling back", async () => {
    const mockLLM = new MockLLMProvider();
    const service = createTargetGenerationService(mockLLM);

    mockLLM.queueChatResponse({
      content: JSON.stringify({
        dailyTargets: { calories: 1800, protein: 150, carbs: 180, fat: 50 },
      }),
    });
    mockLLM.queueChatResponse({
      content: JSON.stringify({
        dailyTargets: { calories: 1100, protein: 150, carbs: 180, fat: 55 },
      }),
    });

    const result = await service.generateTargets("fat_loss", createIntake());

    assert.equal(mockLLM.chatCalls.length, 2);
    assert.equal(result.usedFallback, true);
    assert.deepEqual(result.dailyTargets, {
      calories: 1500,
      protein: 120,
      carbs: 150,
      fat: 50,
    });
  });

  it("rejects macro sums that diverge by more than 10% and retries once", async () => {
    const mockLLM = new MockLLMProvider();
    const service = createTargetGenerationService(mockLLM);

    mockLLM.queueChatResponse({
      content: JSON.stringify({
        dailyTargets: { calories: 2500, protein: 150, carbs: 200, fat: 55 },
        coachExplanation: "第一次不合格",
      }),
    });
    mockLLM.queueChatResponse({
      content: JSON.stringify({
        dailyTargets: { calories: 1850, protein: 150, carbs: 180, fat: 55 },
        coachExplanation: "第二次可用",
      }),
    });

    const result = await service.generateTargets("fat_loss", createIntake());

    assert.equal(mockLLM.chatCalls.length, 2);
    assert.equal(result.usedFallback, false);
    assert.deepEqual(result.dailyTargets, {
      calories: 1850,
      protein: 150,
      carbs: 180,
      fat: 55,
    });
    assert.equal(result.coachExplanation, "第二次可用");
  });

  it("rejects zero fat and retries once", async () => {
    const mockLLM = new MockLLMProvider();
    const service = createTargetGenerationService(mockLLM);

    mockLLM.queueChatResponse({
      content: JSON.stringify({
        dailyTargets: { calories: 1800, protein: 150, carbs: 180, fat: 0 },
        coachExplanation: "第一次不合格",
      }),
    });
    mockLLM.queueChatResponse({
      content: JSON.stringify({
        dailyTargets: { calories: 1850, protein: 150, carbs: 180, fat: 55 },
        coachExplanation: "第二次可用",
      }),
    });

    const result = await service.generateTargets("fat_loss", createIntake());

    assert.equal(mockLLM.chatCalls.length, 2);
    assert.equal(result.usedFallback, false);
    assert.deepEqual(result.dailyTargets, {
      calories: 1850,
      protein: 150,
      carbs: 180,
      fat: 55,
    });
    assert.equal(result.coachExplanation, "第二次可用");
  });

  it("rejects zero protein and retries once", async () => {
    const mockLLM = new MockLLMProvider();
    const service = createTargetGenerationService(mockLLM);

    mockLLM.queueChatResponse({
      content: JSON.stringify({
        dailyTargets: { calories: 1800, protein: 0, carbs: 180, fat: 50 },
        coachExplanation: "第一次不合格",
      }),
    });
    mockLLM.queueChatResponse({
      content: JSON.stringify({
        dailyTargets: { calories: 1850, protein: 150, carbs: 180, fat: 55 },
        coachExplanation: "第二次可用",
      }),
    });

    const result = await service.generateTargets("fat_loss", createIntake());

    assert.equal(mockLLM.chatCalls.length, 2);
    assert.equal(result.usedFallback, false);
    assert.deepEqual(result.dailyTargets, {
      calories: 1850,
      protein: 150,
      carbs: 180,
      fat: 55,
    });
    assert.equal(result.coachExplanation, "第二次可用");
  });

  it("retries once on a sanity check failure then falls back", async () => {
    const mockLLM = new MockLLMProvider();
    const service = createTargetGenerationService(mockLLM);

    mockLLM.queueChatResponse({
      content: JSON.stringify({
        dailyTargets: { calories: 1100, protein: 150, carbs: 180, fat: 50 },
        coachExplanation: "第一次不合格",
      }),
    });
    mockLLM.queueChatResponse({
      content: JSON.stringify({
        dailyTargets: { calories: 1100, protein: 150, carbs: 180, fat: 0 },
        coachExplanation: "第二次仍不合格",
      }),
    });

    const result = await service.generateTargets("fat_loss", createIntake());

    assert.equal(mockLLM.chatCalls.length, 2);
    assert.equal(result.usedFallback, true);
    assert.deepEqual(result.dailyTargets, {
      calories: 1500,
      protein: 120,
      carbs: 150,
      fat: 50,
    });
    assert.match(result.coachExplanation, /預設/);
  });

  it("falls back on an LLM error", async () => {
    const mockLLM = new MockLLMProvider();
    const service = createTargetGenerationService(mockLLM);

    mockLLM.queueChatError(new Error("API timeout"));
    mockLLM.queueChatError(new Error("API timeout"));

    const result = await service.generateTargets("muscle_gain", createIntake());

    assert.equal(mockLLM.chatCalls.length, 2);
    assert.equal(result.usedFallback, true);
    assert.deepEqual(result.dailyTargets, {
      calories: 2500,
      protein: 180,
      carbs: 300,
      fat: 70,
    });
  });

  it("falls back on an unparseable LLM response", async () => {
    const mockLLM = new MockLLMProvider();
    const service = createTargetGenerationService(mockLLM);

    mockLLM.queueChatResponse({ content: "not json at all" });
    mockLLM.queueChatResponse({ content: "still not json" });

    const result = await service.generateTargets("fat_loss", createIntake());

    assert.equal(mockLLM.chatCalls.length, 2);
    assert.equal(result.usedFallback, true);
    assert.deepEqual(result.dailyTargets, {
      calories: 1500,
      protein: 120,
      carbs: 150,
      fat: 50,
    });
  });

  it("uses the correct calorie bounds for each goal", async () => {
    const mockLLM = new MockLLMProvider();
    const service = createTargetGenerationService(mockLLM);

    mockLLM.queueChatResponse({
      content: JSON.stringify({
        dailyTargets: { calories: 1550, protein: 120, carbs: 150, fat: 50 },
        coachExplanation: "fat loss ok",
      }),
    });
    mockLLM.queueChatResponse({
      content: JSON.stringify({
        dailyTargets: { calories: 1400, protein: 120, carbs: 150, fat: 50 },
        coachExplanation: "still below range",
      }),
    });
    mockLLM.queueChatResponse({
      content: JSON.stringify({
        dailyTargets: { calories: 1900, protein: 150, carbs: 200, fat: 55 },
        coachExplanation: "muscle gain ok",
      }),
    });

    const fatLoss = await service.generateTargets("fat_loss", createIntake());
    const muscleGain = await service.generateTargets("muscle_gain", createIntake());

    assert.equal(fatLoss.usedFallback, false);
    assert.deepEqual(fatLoss.dailyTargets, {
      calories: 1550,
      protein: 120,
      carbs: 150,
      fat: 50,
    });
    assert.equal(muscleGain.usedFallback, false);
    assert.deepEqual(muscleGain.dailyTargets, {
      calories: 1900,
      protein: 150,
      carbs: 200,
      fat: 55,
    });
  });
});
