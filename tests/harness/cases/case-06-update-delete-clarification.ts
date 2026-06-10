import {
  assertNoInternalLeakage,
  assertNoUnauthorizedMutation,
  assertTraditionalChinese,
  type BehaviorAssertionResult,
  type BehaviorCaseOutcome,
} from "../behavior-assertions.js";
import { createScenarioApp } from "../app-fixture.js";
import { StreamingLLMProvider } from "../streaming-llm.js";

interface MealSnapshot {
  id: string;
  foodName: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

interface ClarificationSubCase {
  name: "ambiguous_update" | "ambiguous_delete";
  message: string;
  action: "update" | "delete";
  reply: string;
}

interface ClarificationSubCaseEvidence {
  name: "ambiguous_update" | "ambiguous_delete";
  allowedTools: string[];
  observedTools: string[];
  unauthorizedTools: string[];
  beforeMeals: MealSnapshot[];
  afterMeals: MealSnapshot[];
  persistedDiff: Record<string, unknown>;
  reply: string;
}

const FIXED_NOW = "2026-04-19T12:00:00+08:00";
const MUTATION_TOOLS = new Set(["log_food", "update_meal", "delete_meal", "update_goals"]);

const CASES: ClarificationSubCase[] = [
  {
    name: "ambiguous_update",
    message: "把今天雞腿飯的蛋白質改成 35 克",
    action: "update",
    reply: "我找到多筆今天的雞腿飯，請回覆你要修改哪一筆，我再幫你改蛋白質。",
  },
  {
    name: "ambiguous_delete",
    message: "把今天的雞腿飯刪掉",
    action: "delete",
    reply: "我找到多筆今天的雞腿飯，請回覆要刪除哪一筆。",
  },
];

export async function runCase06UpdateDeleteClarification(): Promise<BehaviorCaseOutcome> {
  const subCases = [];
  for (const subCase of CASES) {
    subCases.push(await withFixedDate(() => runAmbiguousMealSubCase(subCase)));
  }

  const assertions = subCases.flatMap((subCase) => subCase.assertions);
  const ok = assertions.every((assertion) => assertion.ok);

  return {
    caseId: "CASE-06",
    status: ok ? "passed" : "failed",
    ok,
    assertions,
    evidence: {
      subCases: subCases.map((subCase) => subCase.evidence),
      allowedTools: ["find_meals"],
      observedTools: subCases.flatMap((subCase) => subCase.evidence.observedTools),
      unauthorizedTools: subCases.flatMap((subCase) => subCase.evidence.unauthorizedTools),
      beforeMeals: subCases.map((subCase) => ({
        name: subCase.evidence.name,
        meals: subCase.evidence.beforeMeals,
      })),
      afterMeals: subCases.map((subCase) => ({
        name: subCase.evidence.name,
        meals: subCase.evidence.afterMeals,
      })),
      persistedDiff: Object.fromEntries(
        subCases.map((subCase) => [subCase.evidence.name, subCase.evidence.persistedDiff]),
      ),
    },
  };
}

async function runAmbiguousMealSubCase(subCase: ClarificationSubCase): Promise<{
  assertions: BehaviorAssertionResult[];
  evidence: ClarificationSubCaseEvidence;
}> {
  const llmProvider = new StreamingLLMProvider();
  const ctx = await createScenarioApp({ llmProvider });

  try {
    await seedSharedMultiCandidateMeals(ctx.deviceId, ctx.services.foodLoggingService);
    const beforeMeals = await readMeals(ctx.address, ctx.cookieHeader);
    llmProvider.queueRoundResponse({
      toolCalls: [{
        id: `case_06_find_meals_${subCase.name}`,
        type: "function",
        function: {
          name: "find_meals",
          arguments: JSON.stringify({
            action: subCase.action,
            query: subCase.message,
          }),
        },
      }],
    });
    llmProvider.queueRoundResponse({ content: subCase.reply });

    const response = await postChat(ctx.address, ctx.cookieHeader, subCase.message);
    const afterMeals = await readMeals(ctx.address, ctx.cookieHeader);
    const observedTools = collectObservedTools(llmProvider);
    const unauthorizedTools = collectUnauthorizedTools(observedTools, ["find_meals"]);
    const persistedDiff = diffMeals(beforeMeals, afterMeals);
    const evidence: ClarificationSubCaseEvidence = {
      name: subCase.name,
      allowedTools: ["find_meals"],
      observedTools,
      unauthorizedTools,
      beforeMeals,
      afterMeals,
      persistedDiff,
      reply: response.reply,
    };

    return {
      assertions: [
        namedAssertion(`case_06_${subCase.name}_http_ok`, response.status === 200, evidence),
        namedAssertion(
          `case_06_${subCase.name}_find_meals_called`,
          observedTools.includes("find_meals"),
          evidence,
        ),
        namedAssertion(
          `case_06_${subCase.name}_no_update_or_delete`,
          !observedTools.includes("update_meal") && !observedTools.includes("delete_meal"),
          evidence,
        ),
        namedAssertion(
          `case_06_${subCase.name}_clarifying_question`,
          /哪一筆|多筆|請回覆/.test(response.reply),
          evidence,
        ),
        namedAssertion(
          `case_06_${subCase.name}_meals_unchanged`,
          Object.keys(persistedDiff).length === 0,
          evidence,
        ),
        assertTraditionalChinese(response.reply),
        assertNoInternalLeakage(response.reply),
        assertNoUnauthorizedMutation({
          allowedTools: ["find_meals"],
          observedTools,
          persistedDiff,
        }),
      ],
      evidence,
    };
  } finally {
    await ctx.close();
  }
}

async function seedSharedMultiCandidateMeals(
  deviceId: string,
  foodLoggingService: {
    logGroupedMeal(deviceId: string, input: {
      items: Array<{
        foodName: string;
        calories: number;
        protein: number;
        carbs: number;
        fat: number;
      }>;
      loggedAt?: string;
    }): Promise<unknown>;
  },
): Promise<void> {
  await foodLoggingService.logGroupedMeal(deviceId, {
    items: [
      { foodName: "雞腿飯", calories: 650, protein: 30, carbs: 80, fat: 20 },
    ],
    loggedAt: "2026-04-19T04:00:00.000Z",
  });
  await foodLoggingService.logGroupedMeal(deviceId, {
    items: [
      { foodName: "雞腿飯", calories: 620, protein: 28, carbs: 76, fat: 18 },
    ],
    loggedAt: "2026-04-19T04:30:00.000Z",
  });
}

async function postChat(
  address: string,
  cookieHeader: string,
  message: string,
): Promise<{ status: number; reply: string }> {
  const form = new FormData();
  form.append("message", message);

  const res = await fetch(`${address}/api/chat`, {
    method: "POST",
    headers: { cookie: cookieHeader },
    body: form,
  });
  const body = await res.json() as { reply?: string };
  return { status: res.status, reply: body.reply ?? "" };
}

async function readMeals(address: string, cookieHeader: string): Promise<MealSnapshot[]> {
  const res = await fetch(`${address}/api/meals`, {
    headers: { cookie: cookieHeader },
  });
  const body = await res.json() as { meals: MealSnapshot[] };
  return body.meals.map((meal) => ({
    id: meal.id,
    foodName: meal.foodName,
    calories: meal.calories,
    protein: meal.protein,
    carbs: meal.carbs,
    fat: meal.fat,
  }));
}

function collectObservedTools(llmProvider: StreamingLLMProvider): string[] {
  const observed: string[] = [];
  for (const call of llmProvider.chatCalls) {
    for (const message of call.messages) {
      if (!("tool_calls" in message) || !Array.isArray(message.tool_calls)) continue;
      for (const toolCall of message.tool_calls) {
        const name = toolCall?.function?.name;
        if (typeof name === "string") observed.push(name);
      }
    }
  }
  return observed;
}

function collectUnauthorizedTools(observedTools: string[], allowedTools: string[]): string[] {
  const allowed = new Set(allowedTools);
  return observedTools.filter((tool) => MUTATION_TOOLS.has(tool) && !allowed.has(tool));
}

function diffMeals(before: MealSnapshot[], after: MealSnapshot[]): Record<string, unknown> {
  if (before.length !== after.length) {
    return { mealCount: { before: before.length, after: after.length } };
  }

  const changedMeals: Array<{ id: string; before?: MealSnapshot; after?: MealSnapshot }> = [];
  const beforeById = new Map(before.map((meal) => [meal.id, meal]));
  const afterById = new Map(after.map((meal) => [meal.id, meal]));
  for (const id of new Set([...beforeById.keys(), ...afterById.keys()])) {
    const beforeMeal = beforeById.get(id);
    const afterMeal = afterById.get(id);
    if (JSON.stringify(beforeMeal) !== JSON.stringify(afterMeal)) {
      changedMeals.push({ id, before: beforeMeal, after: afterMeal });
    }
  }

  return changedMeals.length > 0 ? { changedMeals } : {};
}

async function withFixedDate<T>(run: () => Promise<T>): Promise<T> {
  const RealDate = globalThis.Date;
  const fixedNow = new RealDate(FIXED_NOW);

  class FixedDate extends RealDate {
    constructor(...args: any[]) {
      switch (args.length) {
        case 0:
          super(fixedNow);
          break;
        case 1:
          super(args[0]);
          break;
        case 2:
          super(args[0], args[1]);
          break;
        case 3:
          super(args[0], args[1], args[2]);
          break;
        case 4:
          super(args[0], args[1], args[2], args[3]);
          break;
        case 5:
          super(args[0], args[1], args[2], args[3], args[4]);
          break;
        case 6:
          super(args[0], args[1], args[2], args[3], args[4], args[5]);
          break;
        default:
          super(args[0], args[1], args[2], args[3], args[4], args[5], args[6]);
      }
    }

    static now(): number {
      return fixedNow.getTime();
    }
  }

  globalThis.Date = FixedDate as DateConstructor;
  try {
    return await run();
  } finally {
    globalThis.Date = RealDate;
  }
}

function namedAssertion(
  name: string,
  ok: boolean,
  evidence: object,
): BehaviorAssertionResult {
  return ok
    ? { name, ok: true, evidence: { ...evidence } }
    : { name, ok: false, message: `${name} failed`, evidence: { ...evidence } };
}
