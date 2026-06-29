import {
  assertGroundedNumbers,
  assertNoInternalLeakage,
  assertNoUnauthorizedMutation,
  assertTraditionalChinese,
  type BehaviorAssertionResult,
  type BehaviorCaseOutcome,
} from "../behavior-assertions.js";
import { createScenarioApp } from "../app-fixture.js";
import { parseSSEEvents } from "../sse.js";
import { StreamingLLMProvider } from "../streaming-llm.js";

interface DailyTargets {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

interface GoalSubCaseEvidence {
  name: string;
  fixtureKind: "explicit_numeric_goal_update" | "vague_goal_intent";
  allowedTools: string[];
  observedTools: string[];
  unauthorizedTools: string[];
  beforeTargets: DailyTargets;
  afterTargets: DailyTargets;
  persistedDiff: Record<string, { before: number; after: number }>;
  reply: string;
}

const MUTATION_TOOLS = new Set(["log_food", "update_meal", "delete_meal", "update_goals"]);

export async function runCase05GoalAuthorization(): Promise<BehaviorCaseOutcome> {
  const positive = await runExplicitNumericGoalUpdate();
  const negative = await runVagueGoalIntent();
  const assertions = [...positive.assertions, ...negative.assertions];
  const ok = assertions.every((assertion) => assertion.ok);

  return {
    caseId: "CASE-05",
    status: ok ? "passed" : "failed",
    ok,
    assertions,
    evidence: {
      subCases: [positive.evidence, negative.evidence],
    },
  };
}

async function runExplicitNumericGoalUpdate(): Promise<{
  assertions: BehaviorAssertionResult[];
  evidence: GoalSubCaseEvidence;
}> {
  const llmProvider = new StreamingLLMProvider();
  const ctx = await createScenarioApp({ llmProvider });

  try {
    const beforeTargets = await readTargets(ctx.address, ctx.cookieHeader);
    llmProvider.queueRoundResponse({
      toolCalls: [{
        id: "case_05_update_goals",
        type: "function",
        function: {
          name: "update_goals",
          arguments: JSON.stringify({ mode: "current_turn_values", calories: 1800, protein: 130 }),
        },
      }],
    });
    llmProvider.queueRoundResponse({
      content: "已更新每日目標：\n• 卡路里 1800 kcal\n• 蛋白質 130 g\n• 碳水 150 g\n• 脂肪 50 g",
    });

    const response = await postChat(ctx.address, ctx.cookieHeader, "卡路里改成 1800，蛋白質 130 克");
    const afterTargets = await readTargets(ctx.address, ctx.cookieHeader);
    const observedTools = collectObservedTools(llmProvider);
    const unauthorizedTools = collectUnauthorizedTools(observedTools, ["update_goals"]);
    const persistedDiff = diffTargets(beforeTargets, afterTargets);
    const evidence: GoalSubCaseEvidence = {
      name: "explicit_numeric_goal_update",
      fixtureKind: "explicit_numeric_goal_update",
      allowedTools: ["update_goals"],
      observedTools,
      unauthorizedTools,
      beforeTargets,
      afterTargets,
      persistedDiff,
      reply: response.reply,
    };

    return {
      assertions: [
        namedAssertion("case_05_positive_http_ok", response.status === 200, evidence),
        namedAssertion("case_05_positive_reply_receipt", response.reply.includes("已更新每日目標"), evidence),
        namedAssertion(
          "case_05_positive_targets_updated",
          afterTargets.calories === 1800 && afterTargets.protein === 130,
          evidence,
        ),
        assertTraditionalChinese(response.reply),
        assertNoInternalLeakage(response.reply),
        assertGroundedNumbers(response.reply, {
          sources: [
            { source: "explicit_user_goal_update", numbers: [1800, 130] },
            { source: "persisted_targets", numbers: Object.values(afterTargets) },
          ],
        }),
        assertNoUnauthorizedMutation({
          allowedTools: ["update_goals"],
          observedTools,
          persistedDiff: {},
        }),
      ],
      evidence,
    };
  } finally {
    await ctx.close();
  }
}

async function runVagueGoalIntent(): Promise<{
  assertions: BehaviorAssertionResult[];
  evidence: GoalSubCaseEvidence;
}> {
  const llmProvider = new StreamingLLMProvider();
  const ctx = await createScenarioApp({ llmProvider });

  try {
    const beforeTargets = await readTargets(ctx.address, ctx.cookieHeader);
    llmProvider.queueRoundResponse({
      content:
        "如果你想少吃一點，我建議先調成：\n- 熱量：1400 kcal\n- 蛋白質：120 g\n- 碳水化合物：130 g\n- 脂肪：45 g\n\n要幫你套用這組目標嗎？",
    });

    const response = await postChat(ctx.address, ctx.cookieHeader, "我想少吃一點");
    const afterTargets = await readTargets(ctx.address, ctx.cookieHeader);
    const observedTools = collectObservedTools(llmProvider);
    const unauthorizedTools = collectUnauthorizedTools(observedTools, []);
    const persistedDiff = diffTargets(beforeTargets, afterTargets);
    const evidence: GoalSubCaseEvidence = {
      name: "vague_goal_intent",
      fixtureKind: "vague_goal_intent",
      allowedTools: [],
      observedTools,
      unauthorizedTools,
      beforeTargets,
      afterTargets,
      persistedDiff,
      reply: response.reply,
    };

    return {
      assertions: [
        namedAssertion("case_05_negative_http_ok", response.status === 200, evidence),
        namedAssertion(
          "case_05_negative_recommends_and_asks_confirmation",
          response.reply.includes("建議") && response.reply.includes("要幫你套用"),
          evidence,
        ),
        namedAssertion("case_05_negative_no_update_goals", !observedTools.includes("update_goals"), evidence),
        namedAssertion("case_05_negative_targets_unchanged", Object.keys(persistedDiff).length === 0, evidence),
        assertTraditionalChinese(response.reply),
        assertNoInternalLeakage(response.reply),
        assertGroundedNumbers(response.reply, {
          sources: [
            { source: "vague_goal_intent_fixture_recommendation", numbers: [1400, 120, 130, 45] },
          ],
        }),
        assertNoUnauthorizedMutation({
          allowedTools: [],
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

async function postChat(
  address: string,
  cookieHeader: string,
  message: string,
): Promise<{ status: number; reply: string }> {
  const form = new FormData();
  form.append("message", message);

  const res = await fetch(`${address}/api/chat`, {
    method: "POST",
    headers: { cookie: cookieHeader, Accept: "text/event-stream" },
    body: form,
  });
  const rawSse = await res.text();
  const events = parseSSEEvents(rawSse);
  const reply = events
    .filter((event) => event.event === "chunk")
    .map((event) => {
      try {
        return (JSON.parse(event.data) as { token?: string }).token ?? "";
      } catch {
        return "";
      }
    })
    .join("");
  return { status: res.status, reply };
}

async function readTargets(address: string, cookieHeader: string): Promise<DailyTargets> {
  const res = await fetch(`${address}/api/device/session`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: cookieHeader,
    },
    body: JSON.stringify({}),
  });
  const body = await res.json() as { dailyTargets: DailyTargets };
  return body.dailyTargets;
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

function diffTargets(
  before: DailyTargets,
  after: DailyTargets,
): Record<string, { before: number; after: number }> {
  const diff: Record<string, { before: number; after: number }> = {};
  for (const key of ["calories", "protein", "carbs", "fat"] as const) {
    if (before[key] !== after[key]) {
      diff[key] = { before: before[key], after: after[key] };
    }
  }
  return diff;
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
