/**
 * Deterministic daily summary rollover scenario.
 *
 * Proves Asia/Taipei calendar-day isolation with fixed loggedAt timestamps
 * while keeping artifact generation owned by the harness runner.
 */

import { parseSSEEvents, readStreamUntilEvent } from "../sse.js";
import type { VerificationScenario, ScenarioContext, ScenarioResult, ScenarioStepResult } from "../scenario-types.js";
import { currentAppDate, formatLocalDate } from "../../../server/lib/time.js";
import type { DailySummary } from "../../../server/services/summary.js";
import { buildPositiveScenarioResult } from "../positive-metadata.js";

interface DailySummaryEnvelope {
  summary?: unknown;
  affectedDate?: string;
  source?: "initial" | "meal_mutation";
}

interface SummarySnapshot {
  totalCalories: number;
  totalProtein: number;
  totalCarbs: number;
  totalFat: number;
  mealCount: number;
  date: string;
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
  return buildPositiveScenarioResult(scenarioName, false, steps, failedStepName);
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
const beforeMidnightExpectedSummary: SummarySnapshot = {
  totalCalories: 100,
  totalProtein: 10,
  totalCarbs: 12,
  totalFat: 3,
  mealCount: 1,
  date: "2026-03-25",
};
const afterMidnightExpectedSummary: SummarySnapshot = {
  totalCalories: 200,
  totalProtein: 20,
  totalCarbs: 24,
  totalFat: 6,
  mealCount: 1,
  date: "2026-03-26",
};
const mutationExpectedSummary: SummarySnapshot = {
  totalCalories: 210,
  totalProtein: 21,
  totalCarbs: 25,
  totalFat: 7,
  mealCount: 1,
  date: "2026-03-26",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function summarizeDailySummary(summary: DailySummary): SummarySnapshot {
  return {
    totalCalories: summary.totalCalories,
    totalProtein: summary.totalProtein,
    totalCarbs: summary.totalCarbs,
    totalFat: summary.totalFat,
    mealCount: summary.mealCount,
    date: summary.date,
  };
}

function summarizeSummaryLike(summary: unknown): SummarySnapshot | null {
  if (!isRecord(summary)) {
    return null;
  }
  const { totalCalories, totalProtein, totalCarbs, totalFat, mealCount, date } = summary;
  if (
    typeof totalCalories !== "number" ||
    typeof totalProtein !== "number" ||
    typeof totalCarbs !== "number" ||
    typeof totalFat !== "number" ||
    typeof mealCount !== "number" ||
    typeof date !== "string"
  ) {
    return null;
  }
  return { totalCalories, totalProtein, totalCarbs, totalFat, mealCount, date };
}

function findSummaryMismatch(actual: SummarySnapshot | null, expected: SummarySnapshot): string | null {
  if (!actual) {
    return "Expected a complete daily summary payload";
  }
  for (const key of Object.keys(expected) as Array<keyof SummarySnapshot>) {
    if (actual[key] !== expected[key]) {
      return `Expected ${key} ${expected[key]}, got ${actual[key]}`;
    }
  }
  return null;
}

function parseDailySummaryEnvelope(data: string): DailySummaryEnvelope {
  const parsed = JSON.parse(data) as Record<string, unknown>;
  if ("summary" in parsed && parsed.summary) {
    return {
      summary: parsed.summary,
      affectedDate: typeof parsed.affectedDate === "string" ? parsed.affectedDate : undefined,
      source: parsed.source === "initial" || parsed.source === "meal_mutation" ? parsed.source : undefined,
    };
  }
  return {
    summary: parsed,
    affectedDate: typeof parsed.date === "string" ? parsed.date : undefined,
  };
}

const dailyRolloverScenario: VerificationScenario = {
  name: "daily-rollover",

  async run(ctx: ScenarioContext): Promise<ScenarioResult> {
    const scenarioName = "daily-rollover";
    const steps: ScenarioStepResult[] = [];
    const artifacts: Record<string, unknown> = {};
    const fixture = ctx;
    let afterMealForMutation: { id: string; mealRevisionId: string } | undefined;

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
        const beforeMeal = await fixture.services.foodLoggingService.logGroupedMeal(fixture.deviceId, {
          items: [
            { foodName: "TPE 23:59 meal", calories: 100, protein: 10, carbs: 12, fat: 3 },
          ],
          loggedAt: beforeMidnightLoggedAt,
        });
        const afterMeal = await fixture.services.foodLoggingService.logGroupedMeal(fixture.deviceId, {
          items: [
            { foodName: "TPE 00:01 meal", calories: 200, protein: 20, carbs: 24, fat: 6 },
          ],
          loggedAt: afterMidnightLoggedAt,
        });
        afterMealForMutation = {
          id: afterMeal.id,
          mealRevisionId: afterMeal.mealRevisionId,
        };
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
        const beforeMidnightSnapshot = summarizeDailySummary(beforeMidnightSummary);
        artifacts.beforeMidnightSummary = beforeMidnightSnapshot;
        const mismatch = findSummaryMismatch(beforeMidnightSnapshot, beforeMidnightExpectedSummary);
        if (mismatch) {
          steps.push(fail(
            "verify_before_midnight_summary",
            `Expected March 25 summary to contain exactly the 23:59 meal: ${mismatch}`,
            { actual: beforeMidnightSnapshot, expected: beforeMidnightExpectedSummary },
          ));
          return failResult(scenarioName, steps, "verify_before_midnight_summary", artifacts);
        }
        steps.push(pass("verify_before_midnight_summary", beforeMidnightSnapshot));
      } catch (err) {
        steps.push(fail("verify_before_midnight_summary", err instanceof Error ? err.message : String(err)));
        return failResult(scenarioName, steps, "verify_before_midnight_summary", artifacts);
      }

      try {
        const afterMidnightSummary = await fixture.services.summaryService.getDailySummary(
          fixture.deviceId,
          new Date("2026-03-26T12:00:00+08:00"),
        );
        const afterMidnightSnapshot = summarizeDailySummary(afterMidnightSummary);
        artifacts.afterMidnightSummary = afterMidnightSnapshot;
        const mismatch = findSummaryMismatch(afterMidnightSnapshot, afterMidnightExpectedSummary);
        if (mismatch) {
          steps.push(fail(
            "verify_after_midnight_summary",
            `Expected March 26 summary to contain exactly the 00:01 meal: ${mismatch}`,
            { actual: afterMidnightSnapshot, expected: afterMidnightExpectedSummary },
          ));
          return failResult(scenarioName, steps, "verify_after_midnight_summary", artifacts);
        }
        steps.push(pass("verify_after_midnight_summary", afterMidnightSnapshot));
      } catch (err) {
        steps.push(fail("verify_after_midnight_summary", err instanceof Error ? err.message : String(err)));
        return failResult(scenarioName, steps, "verify_after_midnight_summary", artifacts);
      }

      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        try {
          const sseRes = await fetch(`${fixture.address}/api/sse`, {
            headers: { cookie: fixture.cookieHeader, Accept: "text/event-stream" },
            signal: controller.signal,
          });
          if (sseRes.status !== 200 || !sseRes.body) {
            steps.push(fail("subscribe_summary", `Expected SSE 200 with body, got ${sseRes.status}`));
            return failResult(scenarioName, steps, "subscribe_summary", artifacts);
          }

          reader = sseRes.body.getReader();
          const initialText = await readStreamUntilEvent(reader, "daily_summary", 20);

          const summaryEvent = parseSSEEvents(initialText).find((event) => event.event === "daily_summary");
          if (!summaryEvent) {
            steps.push(fail("subscribe_summary", "Did not receive initial daily_summary event"));
            return failResult(scenarioName, steps, "subscribe_summary", artifacts);
          }

          const initialEnvelope = parseDailySummaryEnvelope(summaryEvent.data);
          const initialSummary = summarizeSummaryLike(initialEnvelope.summary);
          const expectedSseDate = formatLocalDate(currentAppDate());
          artifacts.initialSseSummary = initialSummary;
          artifacts.initialSseSummaryExpectedDate = expectedSseDate;
          const dateEvidence = {
            source: initialEnvelope.source,
            affectedDate: initialEnvelope.affectedDate,
            actualDate: initialSummary?.date,
            expectedDate: expectedSseDate,
          };
          if (
            initialEnvelope.source !== "initial" ||
            initialEnvelope.affectedDate !== expectedSseDate ||
            initialSummary?.date !== expectedSseDate
          ) {
            steps.push(fail(
              "subscribe_summary",
              "Initial SSE daily_summary date did not match the current Asia/Taipei local date",
              dateEvidence,
            ));
            return failResult(scenarioName, steps, "subscribe_summary", artifacts);
          }

          if (!afterMealForMutation) {
            steps.push(fail("subscribe_summary", "Missing seeded March 26 meal for SSE mutation proof"));
            return failResult(scenarioName, steps, "subscribe_summary", artifacts);
          }
          const patchRes = await fetch(`${fixture.address}/api/meals/${afterMealForMutation.id}`, {
            method: "PATCH",
            headers: {
              cookie: fixture.cookieHeader,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              foodName: "TPE 00:01 corrected meal",
              calories: mutationExpectedSummary.totalCalories,
              protein: mutationExpectedSummary.totalProtein,
              carbs: mutationExpectedSummary.totalCarbs,
              fat: mutationExpectedSummary.totalFat,
              expectedMealRevisionId: afterMealForMutation.mealRevisionId,
            }),
          });
          if (patchRes.status !== 200) {
            steps.push(fail("subscribe_summary", `Expected PATCH /api/meals/:id 200, got ${patchRes.status}`));
            return failResult(scenarioName, steps, "subscribe_summary", artifacts);
          }
          const patchPayload = await patchRes.json() as Record<string, unknown>;
          const patchSummary = summarizeSummaryLike(patchPayload.dailySummary);
          const patchMismatch = findSummaryMismatch(patchSummary, mutationExpectedSummary);
          artifacts.mutationRouteSummary = {
            affectedDate: patchPayload.affectedDate,
            summary: patchSummary,
          };
          if (patchPayload.affectedDate !== mutationExpectedSummary.date || patchMismatch) {
            steps.push(fail(
              "subscribe_summary",
              `Meal mutation route did not return exact March 26 summary: ${patchMismatch ?? "affectedDate mismatch"}`,
              { actual: artifacts.mutationRouteSummary, expected: mutationExpectedSummary },
            ));
            return failResult(scenarioName, steps, "subscribe_summary", artifacts);
          }

          const mutationText = await readStreamUntilEvent(reader, "daily_summary", 20);
          const mutationEnvelope = parseSSEEvents(mutationText)
            .filter((event) => event.event === "daily_summary")
            .map((event) => parseDailySummaryEnvelope(event.data))
            .find((event) => event.source === "meal_mutation");
          const mutationSummary = summarizeSummaryLike(mutationEnvelope?.summary);
          const mutationMismatch = findSummaryMismatch(mutationSummary, mutationExpectedSummary);
          artifacts.mutationSseSummary = {
            source: mutationEnvelope?.source,
            affectedDate: mutationEnvelope?.affectedDate,
            summary: mutationSummary,
          };
          if (
            !mutationEnvelope ||
            mutationEnvelope.affectedDate !== mutationExpectedSummary.date ||
            mutationMismatch
          ) {
            steps.push(fail(
              "subscribe_summary",
              `Expected SSE meal_mutation summary for March 26 corrected meal: ${mutationMismatch ?? "missing envelope"}`,
              { actual: artifacts.mutationSseSummary, expected: mutationExpectedSummary },
            ));
            return failResult(scenarioName, steps, "subscribe_summary", artifacts);
          }
          steps.push(pass("subscribe_summary", {
            initial: dateEvidence,
            mutation: artifacts.mutationSseSummary,
          }));
        } finally {
          await reader?.cancel().catch(() => undefined);
          controller.abort();
          clearTimeout(timeout);
        }
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
          "initialSseSummaryExpectedDate",
          "mutationRouteSummary",
          "mutationSseSummary",
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
      return buildPositiveScenarioResult(scenarioName, true, steps, undefined, {
        counts: { expectedStepCount: STEP_NAMES.length, passedStepCount: passedCount },
      });
  },
};

export default dailyRolloverScenario;
