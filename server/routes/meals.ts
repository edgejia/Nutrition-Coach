import type { FastifyBaseLogger, FastifyInstance, FastifyReply } from "fastify";
import { buildAssetUrl, parseAssetRef } from "../services/assets.js";
import type { createFoodLoggingService } from "../services/food-logging.js";
import {
  MealRevisionPreconditionError,
  type MealTransactionItemInput,
} from "../services/meal-transactions.js";
import type { createSummaryService, DailySummary } from "../services/summary.js";
import type { createDeviceService } from "../services/device.js";
import type { createGuestSessionService } from "../services/guest-session.js";
import type { createAssetService } from "../services/assets.js";
import type { RealtimePublisher } from "../realtime/publisher.js";
import { formatLocalDate } from "../lib/time.js";
import { resolveGuestSession } from "../lib/guest-session-resolver.js";
import {
  buildSummaryOutcomeAfterMealCommit,
  dailySummaryFromOutcome,
  type SummaryOutcome,
} from "../services/summary-outcome.js";

interface Deps {
  foodLoggingService: ReturnType<typeof createFoodLoggingService>;
  summaryService: ReturnType<typeof createSummaryService>;
  deviceService: ReturnType<typeof createDeviceService>;
  guestSessionService: ReturnType<typeof createGuestSessionService>;
  assetService: ReturnType<typeof createAssetService>;
  publisher: RealtimePublisher;
}

interface ScalarMealUpdateBody {
  kind: "scalar";
  foodName: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  imageAssetId?: string | null;
  expectedMealRevisionId?: string;
}

interface GroupedMealUpdateBody {
  kind: "items";
  items: MealTransactionItemInput[];
  expectedMealRevisionId?: string;
}

type ParsedMealUpdateBody = ScalarMealUpdateBody | GroupedMealUpdateBody;

function isFiniteNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function hasOwn(input: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(input, key);
}

function parseExpectedMealRevisionIdValue(value: unknown): string | undefined | null {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

function parseGroupedMealItems(value: unknown): MealTransactionItemInput[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  const expectedKeys = ["calories", "carbs", "fat", "name", "position", "protein"].sort();
  const items: MealTransactionItemInput[] = [];

  for (const [index, item] of value.entries()) {
    if (!isPlainRecord(item)) {
      return null;
    }

    const itemKeys = Object.keys(item).sort();
    if (itemKeys.length !== expectedKeys.length || itemKeys.some((key, i) => key !== expectedKeys[i])) {
      return null;
    }

    const name = typeof item.name === "string" ? item.name.trim() : "";
    if (!name) {
      return null;
    }

    if (!Number.isInteger(item.position) || item.position !== index) {
      return null;
    }

    if (
      !isFiniteNonNegativeNumber(item.calories) ||
      !isFiniteNonNegativeNumber(item.protein) ||
      !isFiniteNonNegativeNumber(item.carbs) ||
      !isFiniteNonNegativeNumber(item.fat)
    ) {
      return null;
    }

    items.push({
      foodName: name,
      calories: item.calories,
      protein: item.protein,
      carbs: item.carbs,
      fat: item.fat,
    });
  }

  const totals = items.reduce(
    (sum, item) => ({
      calories: sum.calories + item.calories,
      protein: sum.protein + item.protein,
      carbs: sum.carbs + item.carbs,
      fat: sum.fat + item.fat,
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
  if (!Object.values(totals).every(Number.isFinite)) {
    return null;
  }

  return items;
}

function parseMealUpdateBody(body: unknown): ParsedMealUpdateBody | null {
  if (!isPlainRecord(body)) {
    return null;
  }

  const input = body;
  if (hasOwn(input, "items")) {
    const topLevelKeys = Object.keys(input).sort();
    const expectedTopLevelKeys = hasOwn(input, "expectedMealRevisionId")
      ? ["expectedMealRevisionId", "items"]
      : ["items"];
    if (
      topLevelKeys.length !== expectedTopLevelKeys.length ||
      topLevelKeys.some((key, i) => key !== expectedTopLevelKeys[i])
    ) {
      return null;
    }

    const expectedMealRevisionId = parseExpectedMealRevisionIdValue(input.expectedMealRevisionId);
    if (expectedMealRevisionId === null) {
      return null;
    }

    const items = parseGroupedMealItems(input.items);
    if (!items) {
      return null;
    }

    return {
      kind: "items",
      items,
      ...(expectedMealRevisionId ? { expectedMealRevisionId } : {}),
    };
  }

  const foodName = typeof input.foodName === "string" ? input.foodName.trim() : "";
  const imageAssetId =
    typeof input.imageAssetId === "string" && input.imageAssetId.trim()
      ? input.imageAssetId.trim()
      : null;

  if (!foodName) {
    return null;
  }

  if (
    !isFiniteNonNegativeNumber(input.calories) ||
    !isFiniteNonNegativeNumber(input.protein) ||
    !isFiniteNonNegativeNumber(input.carbs) ||
    !isFiniteNonNegativeNumber(input.fat)
  ) {
    return null;
  }

  return {
    kind: "scalar",
    foodName,
    calories: input.calories,
    protein: input.protein,
    carbs: input.carbs,
    fat: input.fat,
    imageAssetId,
    ...(typeof input.expectedMealRevisionId === "string" && input.expectedMealRevisionId.trim()
      ? { expectedMealRevisionId: input.expectedMealRevisionId.trim() }
      : {}),
  };
}

function parseExpectedMealRevisionId(body: unknown): string | undefined {
  if (!body || typeof body !== "object") {
    return undefined;
  }

  const input = body as Record<string, unknown>;
  return typeof input.expectedMealRevisionId === "string" && input.expectedMealRevisionId.trim()
    ? input.expectedMealRevisionId.trim()
    : undefined;
}

function sendMealRevisionConflict(reply: FastifyReply, error: MealRevisionPreconditionError) {
  return reply.code(409).send({
    error: error.code,
    mealId: error.mealId,
    affectedDate: error.affectedDate,
    currentMealRevisionId: error.currentMealRevisionId,
  });
}

function publishDailySummarySafe(input: {
  publisher: RealtimePublisher;
  deviceId: string;
  dailySummary: DailySummary | undefined;
  summaryOutcome: SummaryOutcome;
  affectedDate: string;
  log: FastifyBaseLogger;
}): void {
  const { publisher, deviceId, dailySummary, summaryOutcome, affectedDate, log } = input;
  if (!dailySummary || dailySummary.date !== affectedDate) {
    return;
  }

  try {
    publisher.publishDailySummary(deviceId, {
      summary: dailySummary,
      affectedDate,
      source: "meal_mutation",
    });
    log.info(
      { event: "summary_publish_success", affectedDate, summaryStatus: summaryOutcome.status },
      "Summary publish success",
    );
  } catch {
    log.warn(
      { event: "summary_publish_failed", affectedDate, summaryStatus: summaryOutcome.status },
      "Summary publish failed (non-fatal)",
    );
  }
}

export function registerMealRoutes(app: FastifyInstance, deps: Deps) {
  const { foodLoggingService, summaryService, deviceService, guestSessionService, assetService, publisher } = deps;

  app.get("/api/meals", async (request, reply) => {
    const session = await resolveGuestSession(request, { deviceService, guestSessionService });
    if (!session.ok) {
      if (session.clearCookies) {
        reply.header("set-cookie", guestSessionService.clearSessionCookies());
      }
      return reply.code(401).send({ error: session.error });
    }
    const { deviceId } = session;
    if (session.setCookies) {
      reply.header("set-cookie", session.setCookies);
    }

    if (request.headers["x-refresh-reason"] === "day_rollover") {
      request.log.info({ event: "day_rollover" }, "Day rollover meals refresh");
    }

    const meals = await foodLoggingService.getMealsByDate(deviceId, new Date());
    return {
      meals: meals.map((meal) => {
        const imageAssetId = parseAssetRef(meal.imagePath);
        return {
          id: meal.id,
          mealRevisionId: meal.mealRevisionId,
          foodName: meal.foodName,
          itemCount: meal.itemCount ?? 1,
          calories: meal.calories,
          protein: meal.protein,
          carbs: meal.carbs,
          fat: meal.fat,
          imageAssetId,
          imageUrl: imageAssetId ? buildAssetUrl(imageAssetId) : null,
          loggedAt: meal.loggedAt,
          ...(meal.items ? { items: meal.items } : {}),
          ...(meal.mealPeriod ? { mealPeriod: meal.mealPeriod } : {}),
        };
      }),
    };
  });

  app.patch("/api/meals/:id", async (request, reply) => {
    const session = await resolveGuestSession(request, { deviceService, guestSessionService });
    if (!session.ok) {
      if (session.clearCookies) {
        reply.header("set-cookie", guestSessionService.clearSessionCookies());
      }
      return reply.code(401).send({ error: session.error });
    }
    const { deviceId } = session;
    if (session.setCookies) {
      reply.header("set-cookie", session.setCookies);
    }

    const update = parseMealUpdateBody(request.body);
    if (!update) {
      return reply.code(400).send({ error: "Invalid meal update" });
    }

    const { id } = request.params as { id: string };
    let affectedDateKey: string;
    let updatedMeal: Awaited<ReturnType<typeof foodLoggingService.updateMeal>>;
    try {
      if (update.kind === "scalar") {
        const mutationGuard = await foodLoggingService.getMealMutationGuard(
          deviceId,
          id,
          update.expectedMealRevisionId,
        );
        if (mutationGuard.itemCount > 1) {
          return reply.code(409).send({
            error: "MEAL_REQUIRES_GROUPED_UPDATE",
            message: "Grouped meals must be corrected through chat.",
          });
        }

        if (update.imageAssetId) {
          const ownedAsset = await assetService.getOwnedAsset(deviceId, update.imageAssetId);
          if (!ownedAsset) {
            return reply.code(400).send({ error: "Invalid meal image asset" });
          }
        }

        updatedMeal = await foodLoggingService.updateMeal(deviceId, id, {
          expectedMealRevisionId: update.expectedMealRevisionId,
          imagePath: update.imageAssetId ? `asset:${update.imageAssetId}` : null,
          items: [
            {
              foodName: update.foodName,
              calories: update.calories,
              protein: update.protein,
              carbs: update.carbs,
              fat: update.fat,
            },
          ],
        });
      } else {
        updatedMeal = await foodLoggingService.updateMeal(deviceId, id, {
          expectedMealRevisionId: update.expectedMealRevisionId,
          items: update.items,
        });
      }
      affectedDateKey = formatLocalDate(new Date(updatedMeal.loggedAt));
    } catch (error) {
      if (error instanceof Error && error.message === "MEAL_NOT_FOUND") {
        return reply.code(404).send({ error: "Meal not found" });
      }
      if (error instanceof MealRevisionPreconditionError) {
        return sendMealRevisionConflict(reply, error);
      }
      throw error;
    }

    const summaryOutcome = await buildSummaryOutcomeAfterMealCommit({
      deviceId,
      affectedDate: affectedDateKey,
      summaryService,
      foodLoggingService,
    });
    const dailySummary = dailySummaryFromOutcome(summaryOutcome);
    publishDailySummarySafe({
      publisher,
      deviceId,
      dailySummary,
      summaryOutcome,
      affectedDate: affectedDateKey,
      log: request.log,
    });

    const imageAssetId = parseAssetRef(updatedMeal.imagePath);
    return {
      affectedDate: affectedDateKey,
      summaryOutcome,
      ...(dailySummary ? { dailySummary } : {}),
      meal: {
        id: updatedMeal.id,
        mealRevisionId: updatedMeal.mealRevisionId,
        foodName: updatedMeal.foodName,
        itemCount: updatedMeal.itemCount ?? 1,
        calories: updatedMeal.calories,
        protein: updatedMeal.protein,
        carbs: updatedMeal.carbs,
        fat: updatedMeal.fat,
        imageAssetId,
        imageUrl: imageAssetId ? buildAssetUrl(imageAssetId) : null,
        loggedAt: updatedMeal.loggedAt,
        ...(updatedMeal.mealPeriod ? { mealPeriod: updatedMeal.mealPeriod } : {}),
      },
    };
  });

  app.delete("/api/meals/:id", async (request, reply) => {
    const session = await resolveGuestSession(request, { deviceService, guestSessionService });
    if (!session.ok) {
      if (session.clearCookies) {
        reply.header("set-cookie", guestSessionService.clearSessionCookies());
      }
      return reply.code(401).send({ error: session.error });
    }
    const { deviceId } = session;
    if (session.setCookies) {
      reply.header("set-cookie", session.setCookies);
    }

    const { id } = request.params as { id: string };
    const expectedMealRevisionId = parseExpectedMealRevisionId(request.body);
    let affectedDateKey: string;
    let deletedMealId: string;
    try {
      const deleted = await foodLoggingService.deleteMeal(deviceId, id, expectedMealRevisionId);
      affectedDateKey = deleted.affectedDateKey;
      deletedMealId = deleted.transactionId;
    } catch (error) {
      if (error instanceof Error && error.message === "MEAL_NOT_FOUND") {
        return reply.code(404).send({ error: "Meal not found" });
      }
      if (error instanceof MealRevisionPreconditionError) {
        return sendMealRevisionConflict(reply, error);
      }
      throw error;
    }

    const summaryOutcome = await buildSummaryOutcomeAfterMealCommit({
      deviceId,
      affectedDate: affectedDateKey,
      summaryService,
      foodLoggingService,
    });
    const dailySummary = dailySummaryFromOutcome(summaryOutcome);
    publishDailySummarySafe({
      publisher,
      deviceId,
      dailySummary,
      summaryOutcome,
      affectedDate: affectedDateKey,
      log: request.log,
    });
    return {
      affectedDate: affectedDateKey,
      deletedMealId,
      summaryOutcome,
      ...(dailySummary ? { dailySummary } : {}),
    };
  });
}
