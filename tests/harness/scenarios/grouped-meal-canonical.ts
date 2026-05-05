import { createScenarioApp } from "../app-fixture.js";
import { StreamingLLMProvider } from "../streaming-llm.js";
import { parseSSEEvents, readStreamUntilEvent } from "../sse.js";
import type {
  ScenarioContext,
  ScenarioResult,
  ScenarioStepResult,
  VerificationScenario,
} from "../scenario-types.js";

const STEP_NAMES = [
  "bootstrap",
  "image_grouped_log",
  "text_single_log",
  "chat_grouped_edit",
  "direct_edit_block",
  "verify_history",
  "verify_artifacts",
] as const;

type StepName = (typeof STEP_NAMES)[number];

interface MealDto {
  id: string;
  foodName: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

function pass(name: StepName, actual?: unknown): ScenarioStepResult {
  return { name, ok: true, actual };
}

function fail(name: StepName, error: string, actual?: unknown): ScenarioStepResult {
  return { name, ok: false, error, actual };
}

function failResult(
  steps: ScenarioStepResult[],
  failedStepName: StepName,
  artifacts: Record<string, unknown>,
): ScenarioResult {
  return {
    ok: false,
    failedStep: failedStepName,
    steps,
    artifacts,
    consoleSummary: `FAIL grouped-meal-canonical ${failedStepName}`,
  };
}

function passResult(steps: ScenarioStepResult[], artifacts: Record<string, unknown>): ScenarioResult {
  return {
    ok: true,
    steps,
    artifacts,
    consoleSummary: `PASS grouped-meal-canonical ${steps.filter((step) => step.ok).length}/${STEP_NAMES.length}`,
  };
}

function makeJpegBytes(): ArrayBuffer {
  const bytes = new Uint8Array([
    0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    ...new Array(32).fill(0x00),
    0xFF, 0xD9,
  ]);
  return bytes.buffer as ArrayBuffer;
}

async function postChatStream(
  address: string,
  cookieHeader: string,
  form: FormData,
): Promise<{ status: number; events: Array<{ event: string; data: string }>; donePayload?: any }> {
  const res = await fetch(`${address}/api/chat`, {
    method: "POST",
    headers: {
      cookie: cookieHeader,
      Accept: "text/event-stream",
    },
    body: form,
  });

  if (!res.body) {
    return { status: res.status, events: [] };
  }

  const raw = await readStreamUntilEvent(res.body.getReader(), "done", 80);
  const events = parseSSEEvents(raw);
  const doneEvent = events.find((event) => event.event === "done");
  let donePayload: any;
  if (doneEvent) {
    try {
      donePayload = JSON.parse(doneEvent.data);
    } catch {
      donePayload = undefined;
    }
  }

  return { status: res.status, events, donePayload };
}

async function getMeals(address: string, cookieHeader: string): Promise<MealDto[]> {
  const res = await fetch(`${address}/api/meals`, {
    headers: { cookie: cookieHeader },
  });
  if (res.status !== 200) {
    throw new Error(`GET /api/meals failed with ${res.status}`);
  }
  const body = await res.json() as { meals: MealDto[] };
  return body.meals;
}

const groupedMealCanonicalScenario: VerificationScenario = {
  name: "grouped-meal-canonical",

  async run(_ctx: ScenarioContext): Promise<ScenarioResult> {
    const steps: ScenarioStepResult[] = [];
    const artifacts: Record<string, unknown> = {};
    const llmProvider = new StreamingLLMProvider();
    const fixture = await createScenarioApp({ llmProvider });

    try {
      const ping = await fetch(`${fixture.address}/api/meals`, {
        headers: { cookie: fixture.cookieHeader },
      });
      if (ping.status !== 200) {
        steps.push(fail("bootstrap", `Expected /api/meals 200, got ${ping.status}`));
        return failResult(steps, "bootstrap", artifacts);
      }
      steps.push(pass("bootstrap", { status: ping.status }));

      llmProvider.queueRoundResponse({
        toolCalls: [{
          id: "image_grouped_log",
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
      llmProvider.queueChatStream(["已記錄雞腿、白飯、青菜，估約 620 kcal，蛋白質 24 g。"]);

      const imageForm = new FormData();
      imageForm.append("message", "這是晚餐照片");
      imageForm.append("image", new Blob([makeJpegBytes()], { type: "image/jpeg" }), "grouped.jpg");
      const imageGroupedLog = await postChatStream(fixture.address, fixture.cookieHeader, imageForm);
      artifacts.imageGroupedLog = imageGroupedLog;
      if (imageGroupedLog.status !== 200 || imageGroupedLog.donePayload?.didLogMeal !== true) {
        steps.push(fail("image_grouped_log", "Expected grouped image log to finish with didLogMeal true", imageGroupedLog));
        return failResult(steps, "image_grouped_log", artifacts);
      }
      const groupedMeal = (await getMeals(fixture.address, fixture.cookieHeader)).find((meal) =>
        meal.foodName.includes("雞腿"),
      );
      if (!groupedMeal) {
        steps.push(fail("image_grouped_log", "Grouped meal was not persisted", await getMeals(fixture.address, fixture.cookieHeader)));
        return failResult(steps, "image_grouped_log", artifacts);
      }
      steps.push(pass("image_grouped_log", { mealId: groupedMeal.id, foodName: groupedMeal.foodName }));

      llmProvider.queueRoundResponse({
        toolCalls: [{
          id: "text_single_log",
          type: "function",
          function: {
            name: "log_food",
            arguments: JSON.stringify({
              food_name: "蘋果",
              calories: 95,
              protein: 1,
              carbs: 25,
              fat: 0.3,
              protein_sources: [
                { name: "蘋果", protein: 1, is_primary: false, certainty: "clear" },
              ],
            }),
          },
        }],
      });
      llmProvider.queueChatStream(["已記錄蘋果，估約 95 kcal，蛋白質 0 g。"]);

      const textForm = new FormData();
      textForm.append("message", "我吃了蘋果");
      const textSingleLog = await postChatStream(fixture.address, fixture.cookieHeader, textForm);
      artifacts.textSingleLog = textSingleLog;
      if (textSingleLog.status !== 200 || textSingleLog.donePayload?.didLogMeal !== true) {
        steps.push(fail("text_single_log", "Expected text single log to finish with didLogMeal true", textSingleLog));
        return failResult(steps, "text_single_log", artifacts);
      }
      steps.push(pass("text_single_log", { donePayload: textSingleLog.donePayload }));

      llmProvider.queueRoundResponse({
        toolCalls: [{
          id: "find_grouped_meal",
          type: "function",
          function: {
            name: "find_meals",
            arguments: JSON.stringify({
              action: "update",
              query: "把剛剛那餐雞腿白飯蛋白質改成 22g",
            }),
          },
        }],
      });
      llmProvider.queueRoundResponse({
        toolCalls: [{
          id: "chat_grouped_edit",
          type: "function",
          function: {
            name: "update_meal",
            arguments: JSON.stringify({
              meal_id: groupedMeal.id,
              protein: 22,
            }),
          },
        }],
      });
      llmProvider.queueChatStream(["已更新原本那筆雞腿、白飯、青菜，蛋白質 22 g。"]);

      const editForm = new FormData();
      editForm.append("message", "把剛剛那餐雞腿白飯蛋白質改成 22g");
      const chatGroupedEdit = await postChatStream(fixture.address, fixture.cookieHeader, editForm);
      artifacts.chatGroupedEdit = chatGroupedEdit;
      if (chatGroupedEdit.status !== 200 || chatGroupedEdit.donePayload?.didMutateMeal !== true) {
        steps.push(fail("chat_grouped_edit", "Expected grouped chat edit to mutate the meal", chatGroupedEdit));
        return failResult(steps, "chat_grouped_edit", artifacts);
      }
      steps.push(pass("chat_grouped_edit", { donePayload: chatGroupedEdit.donePayload }));

      const directEditRes = await fetch(`${fixture.address}/api/meals/${groupedMeal.id}`, {
        method: "PATCH",
        headers: {
          cookie: fixture.cookieHeader,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          foodName: "雞腿飯",
          calories: 540,
          protein: 22,
          carbs: 62,
          fat: 12.5,
          imageAssetId: null,
        }),
      });
      const directEditBody = await directEditRes.json().catch(() => ({}));
      const directEditBlock = { status: directEditRes.status, body: directEditBody };
      artifacts.directEditBlock = directEditBlock;
      if (directEditRes.status !== 409 || directEditBody.error !== "MEAL_REQUIRES_GROUPED_UPDATE") {
        steps.push(fail("direct_edit_block", "Expected 409 MEAL_REQUIRES_GROUPED_UPDATE", directEditBlock));
        return failResult(steps, "direct_edit_block", artifacts);
      }
      steps.push(pass("direct_edit_block", directEditBlock));

      const historyRes = await fetch(`${fixture.address}/api/chat/history?limit=20`, {
        headers: { cookie: fixture.cookieHeader },
      });
      const historySnapshot = await historyRes.json();
      artifacts.historySnapshot = historySnapshot;
      if (historyRes.status !== 200) {
        steps.push(fail("verify_history", `Expected history 200, got ${historyRes.status}`, historySnapshot));
        return failResult(steps, "verify_history", artifacts);
      }
      steps.push(pass("verify_history", { status: historyRes.status }));

      const missingArtifactKeys = [
        "imageGroupedLog",
        "textSingleLog",
        "chatGroupedEdit",
        "directEditBlock",
        "historySnapshot",
      ].filter((key) => !(key in artifacts));
      if (missingArtifactKeys.length > 0) {
        steps.push(fail("verify_artifacts", `Missing artifact keys: ${missingArtifactKeys.join(", ")}`, artifacts));
        return failResult(steps, "verify_artifacts", artifacts);
      }
      steps.push(pass("verify_artifacts", { artifactKeys: Object.keys(artifacts) }));

      return passResult(steps, artifacts);
    } finally { await fixture.close(); }
  },
};

export default groupedMealCanonicalScenario;
