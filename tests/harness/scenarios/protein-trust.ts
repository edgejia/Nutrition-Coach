import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, rm } from "node:fs/promises";
import { createScenarioApp } from "../app-fixture.js";
import { StreamingLLMProvider } from "../streaming-llm.js";
import { parseSSEEvents, readStreamUntilEvent } from "../sse.js";
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
  const bytes = new Uint8Array([
    0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
    0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00,
    ...new Array(50).fill(0x00),
    0xFF, 0xD9,
  ]);
  return bytes.buffer as ArrayBuffer;
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
  return parseSSEEvents(rawSSE)
    .filter((event) => event.event === "chunk")
    .map((event) => {
      try {
        return (JSON.parse(event.data) as { token: string }).token;
      } catch {
        return "";
      }
    })
    .join("");
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
          food_name: "雞腿便當",
          calories: 640,
          protein: 30,
          carbs: 78,
          fat: 20,
          protein_sources: [
            { name: "雞腿", protein: 24, is_primary: true, certainty: "clear" },
            { name: "白飯", protein: 4, is_primary: false, certainty: "clear" },
            { name: "青菜", protein: 2, is_primary: false, certainty: "clear" },
          ],
        },
        streamedReply: "已幫你記錄雞腿便當。蛋白質先按雞腿作為主要來源估算，其他配菜不列入 headline。",
        expectedProtein: 24,
        rawProtein: 30,
        expectedFoodName: "雞腿便當",
        expectedReplyPatterns: [/雞腿/, /headline/],
      },
      {
        stepName: "plant_protein",
        message: "我吃了豆腐和豆漿",
        toolArgs: {
          food_name: "豆腐豆漿餐",
          calories: 420,
          protein: 30,
          carbs: 24,
          fat: 20,
          protein_sources: [
            { name: "豆腐", protein: 20, is_primary: true, certainty: "clear" },
            { name: "豆漿", protein: 10, is_primary: true, certainty: "clear" },
          ],
        },
        streamedReply: "已幫你記錄豆腐豆漿餐。蛋白質先按豆腐和豆漿作為主要來源估算。",
        expectedProtein: 30,
        rawProtein: 30,
        expectedFoodName: "豆腐豆漿餐",
        expectedReplyPatterns: [/豆腐/, /豆漿/],
      },
      {
        stepName: "carb_dominant_small_protein",
        message: "我晚餐吃咖哩飯",
        toolArgs: {
          food_name: "咖哩飯",
          calories: 560,
          protein: 16,
          carbs: 85,
          fat: 14,
          protein_sources: [
            { name: "雞肉", protein: 6, is_primary: true, certainty: "clear" },
            { name: "白飯", protein: 6, is_primary: false, certainty: "clear" },
            { name: "馬鈴薯", protein: 2, is_primary: false, certainty: "clear" },
            { name: "紅蘿蔔", protein: 2, is_primary: false, certainty: "clear" },
          ],
        },
        streamedReply: "已幫你記錄咖哩飯。蛋白質先按雞肉作為主要來源估算，其他配菜不列入 headline。",
        expectedProtein: 6,
        rawProtein: 16,
        expectedFoodName: "咖哩飯",
        expectedReplyPatterns: [/雞肉/, /headline/],
      },
      {
        stepName: "high_uncertainty_image",
        message: "",
        imageMode: true,
        toolArgs: {
          food_name: "豆腐便當",
          calories: 520,
          protein: 18,
          carbs: 60,
          fat: 18,
          protein_sources: [
            { name: "豆腐", protein: 18, is_primary: true, certainty: "uncertain" },
            { name: "白飯", protein: 4, is_primary: false, certainty: "clear" },
            { name: "青菜", protein: 2, is_primary: false, certainty: "clear" },
          ],
        },
        expectedProtein: 18,
        rawProtein: 18,
        expectedFoodName: "豆腐便當",
        expectedReplyPatterns: [/保守估算/, /豆腐/, /先抓低一些/],
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
