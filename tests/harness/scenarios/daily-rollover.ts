/**
 * Deterministic daily summary rollover scenario.
 *
 * Proves Asia/Taipei calendar-day isolation with fixed loggedAt timestamps
 * while keeping artifact generation owned by the harness runner.
 */

import { createScenarioApp } from "../app-fixture.js";
import { parseSSEEvents, readStreamUntilEvent } from "../sse.js";
import type { VerificationScenario, ScenarioContext, ScenarioResult, ScenarioStepResult } from "../scenario-types.js";

interface DailySummaryEnvelope {
  summary?: { date?: unknown };
  affectedDate?: string;
  source?: "initial" | "meal_mutation";
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
  return { ok: false, failedStep: failedStepName, steps, artifacts, consoleSummary: `FAIL ${scenarioName} ${failedStepName}` };
}

const STEP_NAMES = [
  "bootstrap",
  "seed_midnight_meals",
  "verify_before_midnight_summary",
  "verify_after_midnight_summary",
  "subscribe_summary",
  "verify_artifacts",
] as const;

const beforeMidnightLoggedAt = "2026-03-25T15:59:00.000Z";
const afterMidnightLoggedAt = "2026-03-25T16:01:00.000Z";

function parseDailySummaryDate(data: string): { date?: unknown } {
  const parsed = JSON.parse(data) as Record<string, unknown>;
  if ("summary" in parsed && parsed.summary) {
    return parsed.summary as { date?: unknown };
  }
  return { date: parsed.date };
}

const dailyRolloverScenario: VerificationScenario = {
  name: "daily-rollover",

  async run(_ctx: ScenarioContext): Promise<ScenarioResult> {
    const scenarioName = "daily-rollover";
    const steps: ScenarioStepResult[] = [];
    const artifacts: Record<string, unknown> = {};
    const fixture = await createScenarioApp({});

    try {
      try {
        const pingRes = await fetch(`${fixture.address}/api/meals`, {
          headers: { cookie: fixture.cookieHeader },
        });
        if (pingRes.status !== 200) {
          steps.push(fail("bootstrap", `Expected 200 from /api/meals, got ${pingRes.status}`));
          return failResult(scenarioName, steps, "bootstrap", artifacts);
        }
        steps.push(pass("bootstrap", { status: pingRes.status }));
      } catch (err) {
        steps.push(fail("bootstrap", err instanceof Error ? err.message : String(err)));
        return failResult(scenarioName, steps, "bootstrap", artifacts);
      }

      try {
        const beforeMeal = await fixture.services.foodLoggingService.logFood(fixture.deviceId, {
          foodName: "TPE 23:59 meal",
          calories: 100,
          protein: 10,
          carbs: 12,
          fat: 3,
          loggedAt: beforeMidnightLoggedAt,
        });
        const afterMeal = await fixture.services.foodLoggingService.logFood(fixture.deviceId, {
          foodName: "TPE 00:01 meal",
          calories: 200,
          protein: 20,
          carbs: 24,
          fat: 6,
          loggedAt: afterMidnightLoggedAt,
        });
        artifacts.seededMealTimestamps = {
          beforeMidnight: beforeMeal.loggedAt,
          afterMidnight: afterMeal.loggedAt,
        };
        steps.push(pass("seed_midnight_meals", artifacts.seededMealTimestamps));
      } catch (err) {
        steps.push(fail("seed_midnight_meals", err instanceof Error ? err.message : String(err)));
        return failResult(scenarioName, steps, "seed_midnight_meals", artifacts);
      }

      try {
        const beforeMidnightSummary = await fixture.services.summaryService.getDailySummary(
          fixture.deviceId,
          new Date("2026-03-25T12:00:00+08:00"),
        );
        artifacts.beforeMidnightSummary = beforeMidnightSummary;
        if (beforeMidnightSummary.date !== "2026-03-25" || beforeMidnightSummary.mealCount !== 1) {
          steps.push(fail(
            "verify_before_midnight_summary",
            "Expected March 25 summary to contain exactly the 23:59 meal",
            beforeMidnightSummary,
          ));
          return failResult(scenarioName, steps, "verify_before_midnight_summary", artifacts);
        }
        steps.push(pass("verify_before_midnight_summary", beforeMidnightSummary));
      } catch (err) {
        steps.push(fail("verify_before_midnight_summary", err instanceof Error ? err.message : String(err)));
        return failResult(scenarioName, steps, "verify_before_midnight_summary", artifacts);
      }

      try {
        const afterMidnightSummary = await fixture.services.summaryService.getDailySummary(
          fixture.deviceId,
          new Date("2026-03-26T12:00:00+08:00"),
        );
        artifacts.afterMidnightSummary = afterMidnightSummary;
        if (afterMidnightSummary.date !== "2026-03-26" || afterMidnightSummary.mealCount !== 1) {
          steps.push(fail(
            "verify_after_midnight_summary",
            "Expected March 26 summary to contain exactly the 00:01 meal",
            afterMidnightSummary,
          ));
          return failResult(scenarioName, steps, "verify_after_midnight_summary", artifacts);
        }
        steps.push(pass("verify_after_midnight_summary", afterMidnightSummary));
      } catch (err) {
        steps.push(fail("verify_after_midnight_summary", err instanceof Error ? err.message : String(err)));
        return failResult(scenarioName, steps, "verify_after_midnight_summary", artifacts);
      }

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const sseRes = await fetch(`${fixture.address}/api/sse`, {
          headers: { cookie: fixture.cookieHeader, Accept: "text/event-stream" },
          signal: controller.signal,
        });
        if (sseRes.status !== 200 || !sseRes.body) {
          clearTimeout(timeout);
          steps.push(fail("subscribe_summary", `Expected SSE 200 with body, got ${sseRes.status}`));
          return failResult(scenarioName, steps, "subscribe_summary", artifacts);
        }

        const reader = sseRes.body.getReader();
        const initialText = await readStreamUntilEvent(reader, "daily_summary", 20);
        controller.abort();
        clearTimeout(timeout);

        const summaryEvent = parseSSEEvents(initialText).find((event) => event.event === "daily_summary");
        if (!summaryEvent) {
          steps.push(fail("subscribe_summary", "Did not receive initial daily_summary event"));
          return failResult(scenarioName, steps, "subscribe_summary", artifacts);
        }

        const initialSummary = parseDailySummaryDate(summaryEvent.data);
        artifacts.initialSseSummary = initialSummary;
        if (typeof initialSummary.date !== "string") {
          steps.push(fail("subscribe_summary", "Initial SSE daily_summary did not include date", initialSummary));
          return failResult(scenarioName, steps, "subscribe_summary", artifacts);
        }
        steps.push(pass("subscribe_summary", { date: initialSummary.date }));
      } catch (err) {
        steps.push(fail("subscribe_summary", err instanceof Error ? err.message : String(err)));
        return failResult(scenarioName, steps, "subscribe_summary", artifacts);
      }

      try {
        const requiredArtifactKeys = [
          "seededMealTimestamps",
          "beforeMidnightSummary",
          "afterMidnightSummary",
          "initialSseSummary",
        ];
        const missing = requiredArtifactKeys.filter((key) => !(key in artifacts));
        if (missing.length > 0) {
          steps.push(fail("verify_artifacts", `Missing artifact keys: ${missing.join(", ")}`, artifacts));
          return failResult(scenarioName, steps, "verify_artifacts", artifacts);
        }
        steps.push(pass("verify_artifacts", { artifactKeys: requiredArtifactKeys }));
      } catch (err) {
        steps.push(fail("verify_artifacts", err instanceof Error ? err.message : String(err)));
        return failResult(scenarioName, steps, "verify_artifacts", artifacts);
      }

      const passedCount = steps.filter((step) => step.ok).length;
      return {
        ok: true,
        steps,
        artifacts,
        consoleSummary: `PASS ${scenarioName} ${passedCount}/${STEP_NAMES.length}`,
      };
    } finally {
      await fixture.close();
    }
  },
};

export default dailyRolloverScenario;
