import { createLlmTraceRecorder } from "../../../server/orchestrator/llm-trace.js";
import { validPngBytes } from "../../fixtures/image-bytes.js";
import { createScenarioApp } from "../app-fixture.js";
import { StreamingLLMProvider } from "../streaming-llm.js";
import type { ScenarioContext, ScenarioResult, ScenarioStepResult, VerificationScenario } from "../scenario-types.js";

const STEP_NAMES = [
  "bootstrap",
  "correction_duplicate_guard",
  "text_non_food_no_save",
  "photo_analysis_no_write",
  "photo_fast_log_inverse",
  "verify_artifacts",
] as const;

const TEXT_NON_FOOD_NO_SAVE_REPLY: string = "我沒有把這段內容存成餐點紀錄。這個版本目前只支援飲食與餐點紀錄；如果你要記餐，請直接告訴我吃了什麼和份量。";
const FAILED_RECOGNITION_NO_SAVE_REPLY: string = "我沒有把這張照片存成餐點紀錄。請先補充餐點內容和份量，我再幫你估算。";

interface ChatResponsePayload {
  reply?: string;
  didLogMeal?: boolean;
  didMutateMeal?: boolean;
  loggedMeal?: {
    mealId?: string;
    mealRevisionId?: string;
    foodName?: string;
    itemCount?: number;
  };
  dailySummary?: {
    mealCount?: number;
    totalCalories?: number;
  };
  summaryOutcome?: unknown;
  proposalCard?: {
    proposalKind?: string;
    status?: string;
    isActionable?: boolean;
  };
}

interface MealSnapshot {
  id: string;
  mealRevisionId: string;
  foodName: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

interface HistorySnapshot {
  role: string;
  didLogMeal?: boolean;
  didMutateMeal?: boolean;
  hasLoggedMeal: boolean;
  proposalKind?: string;
  contentPreview: string;
}

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

function passResult(
  scenarioName: string,
  steps: ScenarioStepResult[],
  artifacts: Record<string, unknown>,
  llmTrace?: Record<string, unknown>,
): ScenarioResult {
  const result: ScenarioResult = {
    ok: true,
    steps,
    artifacts,
    consoleSummary: `PASS ${scenarioName} ${steps.filter((step) => step.ok).length}/${STEP_NAMES.length}`,
  };
  if (llmTrace !== undefined) {
    result.llmTrace = llmTrace;
  }
  return result;
}

function sanitizeMeals(meals: Array<MealSnapshot>): MealSnapshot[] {
  return meals.map((meal) => ({
    id: meal.id,
    mealRevisionId: meal.mealRevisionId,
    foodName: meal.foodName,
    calories: meal.calories,
    protein: meal.protein,
    carbs: meal.carbs,
    fat: meal.fat,
  }));
}

function sanitizeHistory(messages: Array<{
  role: string;
  content?: string;
  didLogMeal?: boolean;
  didMutateMeal?: boolean;
  loggedMeal?: unknown;
  proposalCard?: { proposalKind?: string };
}>): HistorySnapshot[] {
  return messages.map((message) => ({
    role: message.role,
    ...(message.didLogMeal !== undefined ? { didLogMeal: message.didLogMeal } : {}),
    ...(message.didMutateMeal !== undefined ? { didMutateMeal: message.didMutateMeal } : {}),
    hasLoggedMeal: message.loggedMeal !== undefined,
    ...(message.proposalCard?.proposalKind ? { proposalKind: message.proposalCard.proposalKind } : {}),
    contentPreview: (message.content ?? "").slice(0, 80),
  }));
}

async function getMeals(address: string, cookieHeader: string): Promise<MealSnapshot[]> {
  const res = await fetch(`${address}/api/meals`, {
    headers: { cookie: cookieHeader },
  });
  if (res.status !== 200) {
    throw new Error(`GET /api/meals failed with ${res.status}`);
  }
  const body = await res.json() as { meals: MealSnapshot[] };
  return sanitizeMeals(body.meals);
}

async function getHistory(address: string, cookieHeader: string): Promise<HistorySnapshot[]> {
  const res = await fetch(`${address}/api/chat/history?limit=50`, {
    headers: { cookie: cookieHeader },
  });
  if (res.status !== 200) {
    throw new Error(`GET /api/chat/history failed with ${res.status}`);
  }
  const body = await res.json() as {
    messages: Array<{
      role: string;
      content?: string;
      didLogMeal?: boolean;
      didMutateMeal?: boolean;
      loggedMeal?: unknown;
      proposalCard?: { proposalKind?: string };
    }>;
  };
  return sanitizeHistory(body.messages);
}

async function postChatJson({
  address,
  cookieHeader,
  message,
  image,
}: {
  address: string;
  cookieHeader: string;
  message: string;
  image?: { bytes: ArrayBuffer; filename: string; type: string };
}): Promise<ChatResponsePayload> {
  const form = new FormData();
  form.append("message", message);
  if (image) {
    form.append("image", new Blob([image.bytes], { type: image.type }), image.filename);
  }
  const res = await fetch(`${address}/api/chat`, {
    method: "POST",
    headers: { cookie: cookieHeader },
    body: form,
  });
  if (res.status !== 200) {
    throw new Error(`POST /api/chat failed with ${res.status}`);
  }
  return await res.json() as ChatResponsePayload;
}

function assertNoMealWrite(response: ChatResponsePayload, label: string) {
  if (response.didLogMeal !== false || response.didMutateMeal !== false) {
    throw new Error(`${label}: expected didLogMeal/didMutateMeal false`);
  }
  if ("loggedMeal" in response || "dailySummary" in response || "summaryOutcome" in response) {
    throw new Error(`${label}: expected no loggedMeal, dailySummary, or summaryOutcome`);
  }
}

const scenario: VerificationScenario = {
  name: "meal-intent-routing",

  async run(_ctx: ScenarioContext): Promise<ScenarioResult> {
    const scenarioName = "meal-intent-routing";
    const steps: ScenarioStepResult[] = [];
    const artifacts: Record<string, unknown> = {
      evidence: [],
      llmTrace: {
        provider: "deterministic StreamingLLMProvider",
        rawToolArgumentsCaptured: false,
        liveModelCalls: false,
      },
    };
    const provider = new StreamingLLMProvider();
    const recorder = createLlmTraceRecorder();
    const trace = (status: "pass" | "fail") =>
      recorder.build({ scenario: scenarioName, status }) as unknown as Record<string, unknown>;
    const failScenario = (stepName: string, error: unknown): ScenarioResult => {
      const message = error instanceof Error ? error.message : String(error);
      steps.push(fail(stepName, message));
      return failResult(scenarioName, steps, stepName, artifacts, trace("fail"));
    };

    const fixture = await createScenarioApp({
      llmProvider: provider,
      llmTraceRecorderFactory: () => recorder,
    });

    try {
      try {
        const meals = await getMeals(fixture.address, fixture.cookieHeader);
        if (meals.length !== 0) {
          throw new Error(`expected empty bootstrap meals, got ${meals.length}`);
        }
        artifacts.bootstrap = {
          auth: "cookieHeader from createScenarioApp; no raw deviceId selector",
          mealsSnapshot: meals,
        };
        steps.push(pass("bootstrap", { meals: meals.length }));
      } catch (error) {
        return failScenario("bootstrap", error);
      }

      try {
        provider.queueRoundResponse({
          toolCalls: [{
            id: "seed_recent_meal_for_harness",
            type: "function",
            function: {
              name: "log_food",
              arguments: JSON.stringify({
                items: [
                  { food_name: "黑胡椒雞胸肉", calories: 260, protein: 32, carbs: 0, fat: 8 },
                  { food_name: "白飯", calories: 280, protein: 4, carbs: 62, fat: 0.5 },
                  { food_name: "蔬菜", calories: 60, protein: 3, carbs: 10, fat: 1 },
                ],
                protein_sources: [
                  { name: "黑胡椒雞胸肉", protein: 32, is_primary: true, certainty: "clear" },
                  { name: "白飯", protein: 4, is_primary: false, certainty: "clear" },
                  { name: "蔬菜", protein: 3, is_primary: false, certainty: "clear" },
                ],
              }),
            },
          }],
        });
        const seedResponse = await postChatJson({
          address: fixture.address,
          cookieHeader: fixture.cookieHeader,
          message: "黑胡椒雞胸肉餐盒",
        });
        if (seedResponse.didLogMeal !== true || seedResponse.dailySummary?.mealCount !== 1) {
          throw new Error("seed meal did not log exactly one meal");
        }
        const beforeCorrection = await getMeals(fixture.address, fixture.cookieHeader);
        const original = beforeCorrection[0];
        if (!original) {
          throw new Error("missing seeded meal");
        }

        provider.queueRoundResponse({
          toolCalls: [{
            id: "duplicate_correction_guard_harness",
            type: "function",
            function: {
              name: "log_food",
              arguments: JSON.stringify({
                items: [
                  { food_name: "黑胡椒雞胸肉", calories: 165, protein: 24, carbs: 0, fat: 4 },
                  { food_name: "白飯", calories: 195, protein: 3, carbs: 43, fat: 0.3 },
                  { food_name: "蔬菜", calories: 50, protein: 2, carbs: 9, fat: 1 },
                ],
                protein_sources: [
                  { name: "黑胡椒雞胸肉", protein: 24, is_primary: true, certainty: "clear" },
                  { name: "白飯", protein: 3, is_primary: false, certainty: "clear" },
                  { name: "蔬菜", protein: 2, is_primary: false, certainty: "clear" },
                ],
              }),
            },
          }],
        });
        const correctionResponse = await postChatJson({
          address: fixture.address,
          cookieHeader: fixture.cookieHeader,
          message: "蛋白質應該沒這麼多 我目測約100g 飯約150g 其他都是蔬菜",
        });
        assertNoMealWrite(correctionResponse, "correction duplicate guard");
        if (correctionResponse.proposalCard?.proposalKind !== "meal_estimate") {
          throw new Error("expected meal_estimate proposal card for duplicate correction guard");
        }
        if (!correctionResponse.reply?.includes("其實是新的一餐 -> 照常記錄")) {
          throw new Error("expected new-meal escape hatch copy");
        }
        const afterCorrection = await getMeals(fixture.address, fixture.cookieHeader);
        if (afterCorrection.length !== 1 || afterCorrection[0]?.id !== original.id) {
          throw new Error("correction duplicate guard changed meal row count or identity");
        }
        const history = await getHistory(fixture.address, fixture.cookieHeader);
        artifacts.correction_duplicate_guard = {
          seedResponse: {
            didLogMeal: seedResponse.didLogMeal,
            mealCount: seedResponse.dailySummary?.mealCount,
            loggedFoodName: seedResponse.loggedMeal?.foodName,
          },
          responsePayload: {
            didLogMeal: correctionResponse.didLogMeal,
            didMutateMeal: correctionResponse.didMutateMeal,
            proposalKind: correctionResponse.proposalCard?.proposalKind,
            hasEscapeHatch: correctionResponse.reply.includes("其實是新的一餐 -> 照常記錄"),
          },
          mealsSnapshot: afterCorrection,
          historySnapshot: history,
        };
        (artifacts.evidence as unknown[]).push({ step: "correction_duplicate_guard", ok: true });
        steps.push(pass("correction_duplicate_guard", {
          mealCount: afterCorrection.length,
          proposalKind: correctionResponse.proposalCard.proposalKind,
        }));
      } catch (error) {
        return failScenario("correction_duplicate_guard", error);
      }

      try {
        provider.queueRoundResponse({
          toolCalls: [{
            id: "text_non_food_no_save_harness",
            type: "function",
            function: {
              name: "log_food",
              arguments: JSON.stringify({
                items: [
                  { food_name: "重量訓練", calories: 0, protein: 0, carbs: 0, fat: 0 },
                ],
              }),
            },
          }],
        });
        const before = await getMeals(fixture.address, fixture.cookieHeader);
        const response = await postChatJson({
          address: fixture.address,
          cookieHeader: fixture.cookieHeader,
          message: "80公斤 5下5組",
        });
        assertNoMealWrite(response, "text non-food no-save");
        if (response.reply !== TEXT_NON_FOOD_NO_SAVE_REPLY) {
          throw new Error("expected text/non-food no-save copy");
        }
        if (response.reply === FAILED_RECOGNITION_NO_SAVE_REPLY) {
          throw new Error("text path reused photo failed-recognition copy");
        }
        const after = await getMeals(fixture.address, fixture.cookieHeader);
        if (after.length !== before.length) {
          throw new Error("text non-food no-save changed meal count");
        }
        artifacts.text_non_food_no_save = {
          responsePayload: {
            didLogMeal: response.didLogMeal,
            didMutateMeal: response.didMutateMeal,
            copyKind: "text_non_food_no_save",
            usedPhotoCopy: response.reply === FAILED_RECOGNITION_NO_SAVE_REPLY,
          },
          mealsSnapshot: after,
          historySnapshot: await getHistory(fixture.address, fixture.cookieHeader),
        };
        (artifacts.evidence as unknown[]).push({ step: "text_non_food_no_save", ok: true });
        steps.push(pass("text_non_food_no_save", { mealCount: after.length }));
      } catch (error) {
        return failScenario("text_non_food_no_save", error);
      }

      try {
        provider.queueRoundResponse({
          content: "這張照片看起來像雞胸餐盒；如果你還沒要記錄，我可以先估熱量與營養素給你參考。",
        });
        const before = await getMeals(fixture.address, fixture.cookieHeader);
        const response = await postChatJson({
          address: fixture.address,
          cookieHeader: fixture.cookieHeader,
          message: "這張照片幫我分析熱量和營養素，先不要記錄",
          image: {
            bytes: validPngBytes(),
            filename: "analysis.png",
            type: "image/png",
          },
        });
        assertNoMealWrite(response, "photo analysis no-write");
        const after = await getMeals(fixture.address, fixture.cookieHeader);
        if (after.length !== before.length) {
          throw new Error("photo analysis no-write changed meal count");
        }
        artifacts.photo_analysis_no_write = {
          responsePayload: {
            didLogMeal: response.didLogMeal,
            didMutateMeal: response.didMutateMeal,
            hasLoggedMeal: response.loggedMeal !== undefined,
          },
          mealsSnapshot: after,
          historySnapshot: await getHistory(fixture.address, fixture.cookieHeader),
        };
        (artifacts.evidence as unknown[]).push({ step: "photo_analysis_no_write", ok: true });
        steps.push(pass("photo_analysis_no_write", { mealCount: after.length }));
      } catch (error) {
        return failScenario("photo_analysis_no_write", error);
      }

      try {
        const before = await getMeals(fixture.address, fixture.cookieHeader);
        provider.queueRoundResponse({
          toolCalls: [{
            id: "photo_fast_log_inverse_harness",
            type: "function",
            function: {
              name: "log_food",
              arguments: JSON.stringify({
                items: [
                  { food_name: "鮭魚飯", calories: 520, protein: 28, carbs: 58, fat: 16 },
                ],
                protein_sources: [
                  { name: "鮭魚", protein: 24, is_primary: true, certainty: "clear" },
                ],
              }),
            },
          }],
        });
        const response = await postChatJson({
          address: fixture.address,
          cookieHeader: fixture.cookieHeader,
          message: "",
          image: {
            bytes: validPngBytes(),
            filename: "image-only.png",
            type: "image/png",
          },
        });
        if (response.didLogMeal !== true || response.didMutateMeal !== true || !response.loggedMeal) {
          throw new Error("photo fast-log inverse did not persist a meal");
        }
        const after = await getMeals(fixture.address, fixture.cookieHeader);
        if (after.length !== before.length + 1) {
          throw new Error("photo fast-log inverse did not increase meal count by one");
        }
        artifacts.photo_fast_log_inverse = {
          responsePayload: {
            didLogMeal: response.didLogMeal,
            didMutateMeal: response.didMutateMeal,
            loggedFoodName: response.loggedMeal.foodName,
            mealCount: response.dailySummary?.mealCount,
          },
          mealsSnapshot: after,
          historySnapshot: await getHistory(fixture.address, fixture.cookieHeader),
        };
        (artifacts.evidence as unknown[]).push({ step: "photo_fast_log_inverse", ok: true });
        steps.push(pass("photo_fast_log_inverse", { mealCount: after.length }));
      } catch (error) {
        return failScenario("photo_fast_log_inverse", error);
      }

      try {
        const requiredArtifactKeys = [
          "correction_duplicate_guard",
          "text_non_food_no_save",
          "photo_analysis_no_write",
          "photo_fast_log_inverse",
          "llmTrace",
        ];
        const missing = requiredArtifactKeys.filter((key) => !(key in artifacts));
        if (missing.length > 0) {
          throw new Error(`missing artifact keys: ${missing.join(", ")}`);
        }
        steps.push(pass("verify_artifacts", { artifactKeys: Object.keys(artifacts) }));
      } catch (error) {
        return failScenario("verify_artifacts", error);
      }

      return passResult(scenarioName, steps, artifacts, trace("pass"));
    } finally {
      await fixture.close();
    }
  },
};

export default scenario;
