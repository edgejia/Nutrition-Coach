import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, rm } from "node:fs/promises";
import { createScenarioApp } from "../app-fixture.js";
import { StreamingLLMProvider } from "../streaming-llm.js";
import { parseSSEEvents, readStreamUntilEvent } from "../sse.js";
import { validJpegBytes } from "../../fixtures/image-bytes.js";
import type {
  VerificationScenario,
  ScenarioContext,
  ScenarioResult,
  ScenarioStepResult,
} from "../scenario-types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCENARIO_UPLOADS_DIR = path.resolve(__dirname, "..", "tmp", "protein-trust", "uploads");
const SCENARIO_ASSETS_DIR = path.resolve(__dirname, "..", "tmp", "protein-trust", "assets");

const STEP_NAMES = [
  "mixed_lunchbox",
  "plant_protein",
  "carb_dominant_small_protein",
  "high_uncertainty_image",
] as const;
const FORBIDDEN_USER_COPY_TERMS = ["headline", "先抓低", "保守估算"] as const;

type StepName = typeof STEP_NAMES[number];

interface DonePayload {
  didLogMeal?: boolean;
  dailySummary?: {
    totalProtein?: number;
    mealCount?: number;
    date?: string;
  };
}

interface MealDto {
  foodName: string;
  protein: number;
  calories: number;
  carbs: number;
  fat: number;
  imageAssetId?: string | null;
  imageUrl?: string | null;
}

interface HistoryDto {
  role: string;
  content: string;
}

interface ProteinTrustCase {
  stepName: StepName;
  message: string;
  imageMode?: boolean;
  toolArgs: Record<string, unknown>;
  streamedReply?: string;
  expectedProtein: number;
  rawProtein: number;
  expectedFoodName: string;
  expectedReplyPatterns: RegExp[];
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
): ScenarioResult {
  return {
    ok: false,
    failedStep: failedStepName,
    steps,
    artifacts,
    consoleSummary: `FAIL ${scenarioName} ${failedStepName}`,
  };
}

function makeJpegBytes(): ArrayBuffer {
  return validJpegBytes();
}

function toCookieHeader(rawHeader: string | string[] | undefined) {
  const values = Array.isArray(rawHeader) ? rawHeader : rawHeader ? [rawHeader] : [];
  return values.map((value) => value.split(";", 1)[0]).join("; ");
}

async function createFreshDevice(app: ScenarioContext["app"]): Promise<{ deviceId: string; cookieHeader: string }> {
  const res = await app.inject({
    method: "POST",
    url: "/api/device",
    payload: { goal: "fat_loss" },
  });
  if (res.statusCode !== 200 && res.statusCode !== 201) {
    throw new Error(`device seed failed: ${res.statusCode}`);
  }
  return {
    deviceId: (res.json() as { deviceId: string }).deviceId,
    cookieHeader: toCookieHeader(res.headers["set-cookie"]),
  };
}

function parseReplyText(rawSSE: string): string {
  const tokens = parseSSEEvents(rawSSE)
    .filter((event) => event.event === "chunk")
    .map((event, index) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(event.data);
      } catch (error) {
        throw new Error(`Malformed chunk JSON at index ${index}: ${error instanceof Error ? error.message : String(error)}`);
      }
      const token = (parsed as { token?: unknown }).token;
      if (typeof token !== "string" || token.trim().length === 0) {
        throw new Error(`Malformed chunk payload at index ${index}: missing non-empty token`);
      }
      return token;
    });
  const replyText = tokens.join("");
  if (replyText.trim().length === 0) {
    throw new Error("Assembled chunk reply text is empty");
  }
  return replyText;
}

function parseDonePayload(rawSSE: string): DonePayload | undefined {
  const doneEvent = parseSSEEvents(rawSSE).find((event) => event.event === "done");
  if (!doneEvent) {
    return undefined;
  }
  try {
    return JSON.parse(doneEvent.data) as DonePayload;
  } catch {
    return undefined;
  }
}

function assertNoForbiddenUserCopy(label: string, text: string) {
  const matchedTerms = FORBIDDEN_USER_COPY_TERMS.filter((term) => text.includes(term));
  if (matchedTerms.length > 0) {
    throw new Error(`${label} contains forbidden copy: ${matchedTerms.join(", ")}`);
  }
}

async function fetchMeals(address: string, cookieHeader: string): Promise<MealDto[]> {
  const res = await fetch(`${address}/api/meals`, {
    headers: { cookie: cookieHeader },
  });
  const json = await res.json() as { meals: MealDto[] };
  return json.meals;
}

async function fetchHistory(address: string, cookieHeader: string): Promise<HistoryDto[]> {
  const res = await fetch(`${address}/api/chat/history?limit=10`, {
    headers: { cookie: cookieHeader },
  });
  const json = await res.json() as { messages: HistoryDto[] };
  return json.messages;
}

async function runProteinTrustCase(
  fixture: Awaited<ReturnType<typeof createScenarioApp>>,
  llm: StreamingLLMProvider,
  trustCase: ProteinTrustCase,
): Promise<Record<string, unknown>> {
  llm.reset();
  const { deviceId, cookieHeader } = await createFreshDevice(fixture.app);

  llm.queueRoundResponse({
    toolCalls: [{
      id: `${trustCase.stepName}_log_food`,
      type: "function",
      function: {
        name: "log_food",
        arguments: JSON.stringify(trustCase.toolArgs),
      },
    }],
  });
  if (trustCase.streamedReply) {
    llm.queueChatStream([trustCase.streamedReply]);
  }

  const form = new FormData();
  form.append("message", trustCase.imageMode ? "" : trustCase.message);
  if (trustCase.imageMode) {
    form.append("image", new Blob([makeJpegBytes()], { type: "image/jpeg" }), "meal.jpg");
  }

  const res = await fetch(`${fixture.address}/api/chat`, {
    method: "POST",
    headers: {
      cookie: cookieHeader,
      "Accept": "text/event-stream",
    },
    body: form,
  });

  if (!res.ok || !res.body) {
    throw new Error(`chat request failed with ${res.status}`);
  }

  const rawSSE = await readStreamUntilEvent(res.body.getReader(), "done", 60);
  const donePayload = parseDonePayload(rawSSE);
  const replyText = parseReplyText(rawSSE);
  const history = await fetchHistory(fixture.address, cookieHeader);
  const meals = await fetchMeals(fixture.address, cookieHeader);
  const meal = meals.find((entry) => entry.foodName === trustCase.expectedFoodName);
  const assistantReply = history.filter((message) => message.role === "assistant").at(-1)?.content ?? "";
  const statusLabels = parseSSEEvents(rawSSE)
    .filter((event) => event.event === "status")
    .map((event) => {
      try {
        return (JSON.parse(event.data) as { label: string }).label;
      } catch {
        return event.data;
      }
    });

  if (donePayload?.didLogMeal !== true) {
    throw new Error(`expected didLogMeal=true, got ${JSON.stringify(donePayload)}`);
  }
  if (!donePayload.dailySummary || donePayload.dailySummary.totalProtein !== trustCase.expectedProtein) {
    throw new Error(
      `expected dailySummary.totalProtein=${trustCase.expectedProtein}, got ${JSON.stringify(donePayload?.dailySummary)}`,
    );
  }
  if (!meal) {
    throw new Error(`expected persisted meal "${trustCase.expectedFoodName}"`);
  }
  if (meal.protein !== trustCase.expectedProtein) {
    throw new Error(`expected meal.protein=${trustCase.expectedProtein}, got ${meal.protein}`);
  }
  if (!(meal.protein < trustCase.rawProtein || meal.protein === trustCase.rawProtein)) {
    throw new Error(`expected persisted protein to be <= raw proposal ${trustCase.rawProtein}`);
  }
  if (trustCase.expectedProtein < trustCase.rawProtein && !(meal.protein < trustCase.rawProtein)) {
    throw new Error(`expected persisted protein ${meal.protein} to be lower than raw proposal ${trustCase.rawProtein}`);
  }
  for (const pattern of trustCase.expectedReplyPatterns) {
    if (!pattern.test(replyText)) {
      throw new Error(`reply "${replyText}" did not match ${String(pattern)}`);
    }
    if (!pattern.test(assistantReply)) {
      throw new Error(`assistant history "${assistantReply}" did not match ${String(pattern)}`);
    }
  }
  assertNoForbiddenUserCopy("reply", replyText);
  assertNoForbiddenUserCopy("assistant history", assistantReply);

  return {
    caseName: trustCase.stepName,
    rawProtein: trustCase.rawProtein,
    expectedProtein: trustCase.expectedProtein,
    statusLabels,
    donePayload,
    replyText,
    assistantReply,
    meals,
    history,
  };
}

const scenario: VerificationScenario = {
  name: "protein-trust",

  async run(_ctx: ScenarioContext): Promise<ScenarioResult> {
    const steps: ScenarioStepResult[] = [];
    const artifacts: Record<string, unknown> = { caseNames: [...STEP_NAMES] };

    await mkdir(SCENARIO_UPLOADS_DIR, { recursive: true });
    await mkdir(SCENARIO_ASSETS_DIR, { recursive: true });

    const llm = new StreamingLLMProvider();
    const fixture = await createScenarioApp({
      llmProvider: llm,
      uploadsDir: SCENARIO_UPLOADS_DIR,
      assetsDir: SCENARIO_ASSETS_DIR,
    });

    const cases: ProteinTrustCase[] = [
      {
        stepName: "mixed_lunchbox",
        message: "我午餐吃雞腿便當",
        toolArgs: {
          items: [
            { food_name: "雞腿便當", calories: 640, protein: 30, carbs: 78, fat: 20 },
          ],
          protein_sources: [
            { name: "雞腿", protein: 24, is_primary: true, certainty: "clear" },
            { name: "白飯", protein: 4, is_primary: false, certainty: "clear" },
            { name: "青菜", protein: 2, is_primary: false, certainty: "clear" },
          ],
        },
        streamedReply: "已幫你記錄雞腿便當。蛋白質先按雞腿作為主要來源估算，其他配菜不列入主要蛋白質。",
        expectedProtein: 24,
        rawProtein: 30,
        expectedFoodName: "雞腿便當",
        expectedReplyPatterns: [/雞腿便當/, /蛋白質 24 g/],
      },
      {
        stepName: "plant_protein",
        message: "我吃了豆腐和豆漿",
        toolArgs: {
          items: [
            { food_name: "豆腐豆漿餐", calories: 420, protein: 30, carbs: 24, fat: 20 },
          ],
          protein_sources: [
            { name: "豆腐", protein: 20, is_primary: true, certainty: "clear" },
            { name: "豆漿", protein: 10, is_primary: true, certainty: "clear" },
          ],
        },
        streamedReply: "已幫你記錄豆腐豆漿餐。蛋白質先按豆腐和豆漿作為主要來源估算。",
        expectedProtein: 30,
        rawProtein: 30,
        expectedFoodName: "豆腐豆漿餐",
        expectedReplyPatterns: [/豆腐豆漿餐/, /蛋白質 30 g/],
      },
      {
        stepName: "carb_dominant_small_protein",
        message: "我晚餐吃咖哩飯",
        toolArgs: {
          // Plan 83-03: top-level aggregates removed — the grouped-only strict
          // logFoodSchema rejects them; items[] is the sole input shape.
          items: [
            { food_name: "雞肉", calories: 90, protein: 6, carbs: 0, fat: 4 },
            { food_name: "白飯", calories: 360, protein: 6, carbs: 78, fat: 1 },
            { food_name: "馬鈴薯", calories: 70, protein: 2, carbs: 7, fat: 4 },
            { food_name: "紅蘿蔔", calories: 40, protein: 2, carbs: 0, fat: 5 },
          ],
          protein_sources: [
            { name: "雞肉", protein: 6, is_primary: true, certainty: "clear" },
            { name: "白飯", protein: 6, is_primary: false, certainty: "clear" },
            { name: "馬鈴薯", protein: 2, is_primary: false, certainty: "clear" },
            { name: "紅蘿蔔", protein: 2, is_primary: false, certainty: "clear" },
          ],
        },
        streamedReply: "已幫你記錄咖哩飯。蛋白質先按雞肉作為主要來源估算，其他配菜不列入主要蛋白質。",
        expectedProtein: 6,
        rawProtein: 16,
        expectedFoodName: "雞肉、白飯、馬鈴薯、紅蘿蔔",
        expectedReplyPatterns: [/雞肉、白飯、馬鈴薯、紅蘿蔔/, /蛋白質 6 g/],
      },
      {
        stepName: "high_uncertainty_image",
        message: "",
        imageMode: true,
        toolArgs: {
          items: [
            { food_name: "豆腐便當", calories: 520, protein: 18, carbs: 60, fat: 18 },
          ],
          protein_sources: [
            { name: "豆腐", protein: 18, is_primary: true, certainty: "uncertain" },
            { name: "白飯", protein: 4, is_primary: false, certainty: "clear" },
            { name: "青菜", protein: 2, is_primary: false, certainty: "clear" },
          ],
        },
        expectedProtein: 18,
        rawProtein: 18,
        expectedFoodName: "豆腐便當",
        expectedReplyPatterns: [/豆腐便當/, /蛋白質 18 g/, /若份量不同/],
      },
    ];

    try {
      for (const trustCase of cases) {
        try {
          const actual = await runProteinTrustCase(fixture, llm, trustCase);
          artifacts[trustCase.stepName] = actual;
          steps.push(pass(trustCase.stepName, {
            expectedProtein: trustCase.expectedProtein,
            reply: (actual as { replyText?: string }).replyText,
          }));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          steps.push(fail(trustCase.stepName, message));
          return failResult("protein-trust", steps, trustCase.stepName, artifacts);
        }
      }

      return {
        ok: true,
        steps,
        artifacts,
        consoleSummary: `PASS protein-trust ${steps.filter((step) => step.ok).length}/${steps.length}`,
      };
    } finally {
      await fixture.close();
      await rm(path.resolve(__dirname, "..", "tmp", "protein-trust"), {
        recursive: true,
        force: true,
      });
    }
  },
};

export default scenario;
