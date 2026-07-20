import { StreamingLLMProvider } from "../streaming-llm.js";
import { parseSSEEvents, readStreamUntilEvent } from "../sse.js";
import { validJpegBytes } from "../../fixtures/image-bytes.js";
import { buildPositiveScenarioResult } from "../positive-metadata.js";
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
  foodName?: string;
  display?: { title?: string };
  itemCount: number;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
  nutrition?: {
    calories?: number;
    protein?: number;
    carbs?: number;
    fat?: number;
  };
}

interface LoggedMealDto {
  mealId?: string;
  mealRevisionId?: string;
  dateKey?: string;
  foodName?: string;
  itemCount?: number;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
}

interface ChatDonePayload {
  didLogMeal?: boolean;
  didMutateMeal?: boolean;
  loggedMeal?: LoggedMealDto;
  affectedDate?: string;
}

interface ChatMessageDto {
  role: string;
  content: string;
  loggedMeal?: LoggedMealDto;
  toolName?: string | null;
}

interface ChatHistoryResponse {
  messages: ChatMessageDto[];
}

interface HistoryDayResponse {
  date: string;
  meals: MealDto[];
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
  return buildPositiveScenarioResult("grouped-meal-canonical", false, steps, failedStepName);
}

function passResult(steps: ScenarioStepResult[], artifacts: Record<string, unknown>): ScenarioResult {
  return buildPositiveScenarioResult("grouped-meal-canonical", true, steps, undefined, {
    counts: { expectedStepCount: STEP_NAMES.length },
  });
}

function makeJpegBytes(): ArrayBuffer {
  return validJpegBytes();
}

async function postChatStream(
  address: string,
  cookieHeader: string,
  form: FormData,
): Promise<{ status: number; events: Array<{ event: string; data: string }>; donePayload?: ChatDonePayload; replyText: string }> {
  const res = await fetch(`${address}/api/chat`, {
    method: "POST",
    headers: {
      cookie: cookieHeader,
      Accept: "text/event-stream",
    },
    body: form,
  });

  if (!res.body) {
    return { status: res.status, events: [], replyText: "" };
  }

  const raw = await readStreamUntilEvent(res.body.getReader(), "done", 80);
  const events = parseSSEEvents(raw);
  const doneEvent = events.find((event) => event.event === "done");
  let donePayload: ChatDonePayload | undefined;
  if (doneEvent) {
    try {
      donePayload = JSON.parse(doneEvent.data) as ChatDonePayload;
    } catch {
      donePayload = undefined;
    }
  }

  const replyText = events
    .filter((event) => event.event === "chunk")
    .map((event) => {
      try {
        return (JSON.parse(event.data) as { token?: string }).token ?? "";
      } catch {
        return "";
      }
    })
    .join("");

  return { status: res.status, events, donePayload, replyText };
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

async function getChatHistory(address: string, cookieHeader: string): Promise<ChatHistoryResponse> {
  const res = await fetch(`${address}/api/chat/history?limit=20`, {
    headers: { cookie: cookieHeader },
  });
  if (res.status !== 200) {
    throw new Error(`GET /api/chat/history failed with ${res.status}`);
  }
  return await res.json() as ChatHistoryResponse;
}

async function getHistoryDay(address: string, cookieHeader: string, dateKey: string): Promise<HistoryDayResponse> {
  const res = await fetch(`${address}/api/history/days/${dateKey}`, {
    headers: { cookie: cookieHeader },
  });
  if (res.status !== 200) {
    throw new Error(`GET /api/history/days/${dateKey} failed with ${res.status}`);
  }
  return await res.json() as HistoryDayResponse;
}

function findMealByName(meals: MealDto[], foodName: string): MealDto | undefined {
  return meals.find((meal) => (meal.foodName ?? meal.display?.title) === foodName);
}

function failIf(
  condition: boolean,
  steps: ScenarioStepResult[],
  name: StepName,
  error: string,
  actual?: unknown,
): boolean {
  if (!condition) return false;
  steps.push(fail(name, error, actual));
  return true;
}

function replyHasRequiredReceiptShape(replyText: string): boolean {
  return (
    replyText.length <= 120 &&
    replyText.includes("已記錄") &&
    replyText.includes("kcal") &&
    replyText.includes("蛋白質")
  );
}

function containsInternalToolName(text: string): boolean {
  return /\b(?:log_food|update_meal|find_meals|protein_sources|usedConservativeAssumption|quantityUncertaintyReason|missing_quantity)\b/.test(text);
}

const groupedMealCanonicalScenario: VerificationScenario = {
  name: "grouped-meal-canonical",

  prepareApp() {
    const llmProvider = new StreamingLLMProvider();
    return { appOptions: { llmProvider }, state: { llmProvider } };
  },

  async run(ctx: ScenarioContext): Promise<ScenarioResult> {
    const steps: ScenarioStepResult[] = [];
    const artifacts: Record<string, unknown> = {};
    const llmProvider = (ctx.prepared as { llmProvider: StreamingLLMProvider }).llmProvider;
    const fixture = ctx;

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

      const imageForm = new FormData();
      imageForm.append("message", "這是晚餐照片");
      imageForm.append("image", new Blob([makeJpegBytes()], { type: "image/jpeg" }), "grouped.jpg");
      const imageGroupedLog = await postChatStream(fixture.address, fixture.cookieHeader, imageForm);
      artifacts.imageGroupedLog = imageGroupedLog;
      if (imageGroupedLog.status !== 200 || imageGroupedLog.donePayload?.didLogMeal !== true) {
        steps.push(fail("image_grouped_log", "Expected grouped image log to finish with didLogMeal true", imageGroupedLog));
        return failResult(steps, "image_grouped_log", artifacts);
      }
      if (
        failIf(
          imageGroupedLog.donePayload.loggedMeal?.foodName !== "雞腿、白飯、青菜" ||
            imageGroupedLog.donePayload.loggedMeal?.itemCount !== 3,
          steps,
          "image_grouped_log",
          "Expected grouped loggedMeal to expose full name and itemCount 3",
          imageGroupedLog.donePayload.loggedMeal,
        )
      ) {
        return failResult(steps, "image_grouped_log", artifacts);
      }
      if (
        failIf(
          !replyHasRequiredReceiptShape(imageGroupedLog.replyText) ||
            containsInternalToolName(imageGroupedLog.replyText),
          steps,
          "image_grouped_log",
          "Expected compact successful image reply with receipt fields and no internal names",
          { replyText: imageGroupedLog.replyText, length: imageGroupedLog.replyText.length },
        )
      ) {
        return failResult(steps, "image_grouped_log", artifacts);
      }
      const todayAfterImage = await getMeals(fixture.address, fixture.cookieHeader);
      const groupedMeal = findMealByName(todayAfterImage, "雞腿、白飯、青菜");
      artifacts.todayAfterImageGroupedLog = todayAfterImage;
      if (!groupedMeal) {
        steps.push(fail("image_grouped_log", "Grouped meal was not persisted with full display name", todayAfterImage));
        return failResult(steps, "image_grouped_log", artifacts);
      }
      if (groupedMeal.itemCount !== 3 || todayAfterImage.length !== 1) {
        steps.push(fail("image_grouped_log", "Expected one grouped transaction with itemCount 3 in Today", {
          todayAfterImage,
          expected: { transactionCount: 1, itemCount: 3 },
        }));
        return failResult(steps, "image_grouped_log", artifacts);
      }
      steps.push(pass("image_grouped_log", {
        mealId: groupedMeal.id,
        foodName: groupedMeal.foodName,
        itemCount: 3,
        replyLength: imageGroupedLog.replyText.length,
      }));

      llmProvider.queueRoundResponse({
        toolCalls: [{
          id: "text_single_log",
          type: "function",
          function: {
            name: "log_food",
            arguments: JSON.stringify({
              items: [
                {
                  food_name: "蘋果",
                  calories: 95,
                  protein: 1,
                  carbs: 25,
                  fat: 0.3,
                },
              ],
              protein_sources: [
                { name: "蘋果", protein: 1, is_primary: false, certainty: "clear" },
              ],
            }),
          },
        }],
      });

      const textForm = new FormData();
      textForm.append("message", "我吃了蘋果");
      const textSingleLog = await postChatStream(fixture.address, fixture.cookieHeader, textForm);
      artifacts.textSingleLog = textSingleLog;
      if (textSingleLog.status !== 200 || textSingleLog.donePayload?.didLogMeal !== true) {
        steps.push(fail("text_single_log", "Expected text single log to finish with didLogMeal true", textSingleLog));
        return failResult(steps, "text_single_log", artifacts);
      }
      if (
        failIf(
          textSingleLog.donePayload.loggedMeal?.foodName !== "蘋果" ||
            textSingleLog.donePayload.loggedMeal?.itemCount !== 1,
          steps,
          "text_single_log",
          "Expected single-shape text log to normalize to itemCount 1",
          textSingleLog.donePayload.loggedMeal,
        )
      ) {
        return failResult(steps, "text_single_log", artifacts);
      }
      if (
        failIf(
          !replyHasRequiredReceiptShape(textSingleLog.replyText) ||
            containsInternalToolName(textSingleLog.replyText) ||
            !textSingleLog.replyText.includes("蘋果") ||
            textSingleLog.replyText.includes("雞腿、白飯、青菜"),
          steps,
          "text_single_log",
          "Expected compact fresh text reply for 蘋果 with no internal names or stale grouped receipt",
          { replyText: textSingleLog.replyText, length: textSingleLog.replyText.length },
        )
      ) {
        return failResult(steps, "text_single_log", artifacts);
      }
      const todayAfterText = await getMeals(fixture.address, fixture.cookieHeader);
      artifacts.todayAfterTextSingleLog = todayAfterText;
      const singleMeal = findMealByName(todayAfterText, "蘋果");
      if (!singleMeal || singleMeal.itemCount !== 1 || todayAfterText.length !== 2) {
        steps.push(fail("text_single_log", "Expected a second single-item transaction with itemCount 1 in Today", {
          todayAfterText,
          expected: { transactionCount: 2, singleItemCount: 1 },
        }));
        return failResult(steps, "text_single_log", artifacts);
      }
      artifacts.freshReplyIsolation = {
        textSingleFoodName: textSingleLog.donePayload.loggedMeal?.foodName,
        textSingleReply: textSingleLog.replyText,
        excludesPreviousGroupedReceipt: !textSingleLog.replyText.includes("雞腿、白飯、青菜"),
      };
      steps.push(pass("text_single_log", {
        donePayload: textSingleLog.donePayload,
        itemCount: 1,
        replyText: textSingleLog.replyText,
      }));

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

      const editForm = new FormData();
      editForm.append("message", "把剛剛那餐雞腿白飯蛋白質改成 22g");
      const chatGroupedEdit = await postChatStream(fixture.address, fixture.cookieHeader, editForm);
      artifacts.chatGroupedEdit = chatGroupedEdit;
      if (chatGroupedEdit.status !== 200 || chatGroupedEdit.donePayload?.didMutateMeal !== true) {
        steps.push(fail("chat_grouped_edit", "Expected grouped chat edit to mutate the meal", chatGroupedEdit));
        return failResult(steps, "chat_grouped_edit", artifacts);
      }
      if (
        failIf(
          chatGroupedEdit.donePayload.loggedMeal?.mealId !== groupedMeal.id ||
            chatGroupedEdit.donePayload.loggedMeal.foodName !== "雞腿、白飯、青菜" ||
            chatGroupedEdit.donePayload.loggedMeal.itemCount !== 3 ||
            chatGroupedEdit.donePayload.loggedMeal.protein !== 22,
          steps,
          "chat_grouped_edit",
          "Expected chat numeric grouped edit to preserve grouped identity and itemCount 3",
          chatGroupedEdit.donePayload.loggedMeal,
        )
      ) {
        return failResult(steps, "chat_grouped_edit", artifacts);
      }
      steps.push(pass("chat_grouped_edit", {
        mealId: groupedMeal.id,
        foodName: "雞腿、白飯、青菜",
        itemCount: 3,
        protein: 22,
      }));

      const groupedMealRevisionId = chatGroupedEdit.donePayload.loggedMeal?.mealRevisionId;
      if (!groupedMealRevisionId) {
        steps.push(fail("direct_edit_block", "Expected chat grouped edit receipt to expose mealRevisionId", chatGroupedEdit.donePayload.loggedMeal));
        return failResult(steps, "direct_edit_block", artifacts);
      }
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
          expectedMealRevisionId: groupedMealRevisionId,
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

      const historySnapshot = await getChatHistory(fixture.address, fixture.cookieHeader);
      artifacts.historySnapshot = historySnapshot;
      const dateKey = imageGroupedLog.donePayload.loggedMeal?.dateKey;
      if (!dateKey) {
        steps.push(fail("verify_history", "Expected grouped loggedMeal dateKey for History/Day proof", imageGroupedLog.donePayload.loggedMeal));
        return failResult(steps, "verify_history", artifacts);
      }
      const historyDaySnapshot = await getHistoryDay(fixture.address, fixture.cookieHeader, dateKey);
      artifacts.historyDaySnapshot = historyDaySnapshot;

      const groupedHistoryMessage = historySnapshot.messages.find((message) =>
        message.loggedMeal?.foodName === "雞腿、白飯、青菜" &&
        message.loggedMeal.itemCount === 3,
      );
      const groupedCorrectionMessage = historySnapshot.messages.find((message) =>
        message.content.includes("已更新") &&
        message.loggedMeal?.foodName === "雞腿、白飯、青菜" &&
        message.loggedMeal.itemCount === 3 &&
        message.loggedMeal.protein === 22,
      );
      const historyDayMeal = findMealByName(historyDaySnapshot.meals, "雞腿、白飯、青菜");

      if (!groupedHistoryMessage || !groupedCorrectionMessage || historyDayMeal?.itemCount !== 3) {
        steps.push(fail("verify_history", "Expected full grouped name and itemCount 3 in chat history, correction snapshot, and History/Day", {
          groupedHistoryMessage,
          groupedCorrectionMessage,
          historyDayMeal,
        }));
        return failResult(steps, "verify_history", artifacts);
      }
      steps.push(pass("verify_history", {
        chatHistoryFoodName: groupedHistoryMessage.loggedMeal?.foodName,
        correctionFoodName: groupedCorrectionMessage.loggedMeal?.foodName,
        historyDayFoodName: historyDayMeal.foodName,
        itemCount: 3,
      }));

      artifacts.replyCopy = {
        image: {
          text: imageGroupedLog.replyText,
          length: imageGroupedLog.replyText.length,
          includes: ["已記錄", "kcal", "蛋白質"],
          noInternalToolNames: !containsInternalToolName(imageGroupedLog.replyText),
        },
        text: {
          text: textSingleLog.replyText,
          length: textSingleLog.replyText.length,
          includes: ["已記錄", "kcal", "蛋白質"],
          noInternalToolNames: !containsInternalToolName(textSingleLog.replyText),
        },
      };
      artifacts.securityNotes = {
        auth: "Scenario uses runner-provided cookieHeader for protected route requests and no raw deviceId header.",
        directEditBlock: "Grouped direct PATCH returned 409 MEAL_REQUIRES_GROUPED_UPDATE before single-shape mutation.",
        internalToolLeakage: "Successful user-visible replies were checked for log_food, update_meal, find_meals, protein_sources, usedConservativeAssumption, quantityUncertaintyReason, and missing_quantity.",
      };

      const missingArtifactKeys = [
        "imageGroupedLog",
        "textSingleLog",
        "chatGroupedEdit",
        "directEditBlock",
        "historySnapshot",
        "replyCopy",
        "securityNotes",
      ].filter((key) => !(key in artifacts));
      if (missingArtifactKeys.length > 0) {
        steps.push(fail("verify_artifacts", `Missing artifact keys: ${missingArtifactKeys.join(", ")}`, artifacts));
        return failResult(steps, "verify_artifacts", artifacts);
      }
      steps.push(pass("verify_artifacts", { artifactKeys: Object.keys(artifacts) }));

      return passResult(steps, artifacts);
  },
};

export default groupedMealCanonicalScenario;
