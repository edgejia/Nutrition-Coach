import { formatLocalDate } from "../lib/time.js";
import type { createFoodLoggingService } from "./food-logging.js";
import type { createSummaryService } from "./summary.js";

export interface DaySnapshot {
  date: string;
  summary: Awaited<ReturnType<ReturnType<typeof createSummaryService>["getDailySummary"]>>;
  meals: Awaited<ReturnType<ReturnType<typeof createFoodLoggingService>["getMealsByDate"]>>;
}

interface Deps {
  summaryService: ReturnType<typeof createSummaryService>;
  foodLoggingService: ReturnType<typeof createFoodLoggingService>;
}

const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function parseDayKey(dateKey: string): Date {
  if (!DAY_KEY_PATTERN.test(dateKey)) {
    throw new Error("INVALID_DATE_KEY");
  }

  const parsedDate = new Date(`${dateKey}T12:00:00`);
  if (Number.isNaN(parsedDate.getTime()) || formatLocalDate(parsedDate) !== dateKey) {
    throw new Error("INVALID_DATE_KEY");
  }

  return parsedDate;
}

export function createDaySnapshotService(deps: Deps) {
  const { summaryService, foodLoggingService } = deps;

  return {
    async getDaySnapshot(deviceId: string, dateKey: string): Promise<DaySnapshot> {
      const date = parseDayKey(dateKey);
      const [summary, meals] = await Promise.all([
        summaryService.getDailySummary(deviceId, date),
        foodLoggingService.getMealsByDate(deviceId, date),
      ]);

      return {
        date: dateKey,
        summary,
        meals,
      };
    },
  };
}
