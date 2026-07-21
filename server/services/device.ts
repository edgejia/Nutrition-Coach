// server/services/device.ts
import { eq, sql } from "drizzle-orm";
import { devices } from "../db/schema.js";
import type { AppDatabase } from "../db/client.js";
import type { SyncTransactionClient } from "./turn-state.js";
import { checkNutritionSafetyTargets } from "../orchestrator/nutrition-safety-policy.js";
import { isGoalMacroCaloriesOverAllocated } from "../orchestrator/goal-adjustment-policy.js";

const GOAL_DEFAULTS = {
  fat_loss: { calories: 1500, protein: 120, carbs: 150, fat: 50 },
  muscle_gain: { calories: 2500, protein: 180, carbs: 300, fat: 70 },
  maintain: { calories: 2000, protein: 150, carbs: 220, fat: 60 },
} as const;

export interface DailyTargets {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export type Goal = keyof typeof GOAL_DEFAULTS;

export type DeviceGoalsValidationCode = "UNSAFE_CALORIE_FLOOR" | "MACRO_CALORIE_INCONSISTENT";

export class DeviceGoalsValidationError extends Error {
  readonly code: DeviceGoalsValidationCode;

  constructor(code: DeviceGoalsValidationCode) {
    super(code);
    this.name = "DeviceGoalsValidationError";
    this.code = code;
  }
}

export interface IntakeFields {
  sex: string;
  age: number;
  heightCm: number;
  weightKg: number;
  activityLevel: string;
  trainingFrequency: string;
  allergies?: string;
  goalClarification?: string;
  bodyFatPercent?: number;
  tdee?: number;
  advancedNotes?: string;
}

export function getGoalDefaults(goal: Goal): DailyTargets {
  const defaults = GOAL_DEFAULTS[goal];
  if (!defaults) throw new Error(`Invalid goal: ${goal}`);
  return { ...defaults };
}

export function createDeviceService(db: AppDatabase) {
  function getDeviceSync(deviceId: string, client: SyncTransactionClient = db.$client) {
    return client
      .prepare(`
        SELECT
          id,
          daily_calories AS dailyCalories,
          daily_protein AS dailyProtein,
          daily_carbs AS dailyCarbs,
          daily_fat AS dailyFat
        FROM devices
        WHERE id = ?
        LIMIT 1
      `)
      .get(deviceId) as {
        id: string;
        dailyCalories: number;
        dailyProtein: number;
        dailyCarbs: number;
        dailyFat: number;
      } | undefined;
  }

  function updateGoalsSync(
    deviceId: string,
    goals: Partial<DailyTargets>,
    client: SyncTransactionClient = db.$client,
  ): DailyTargets {
    const device = getDeviceSync(deviceId, client);
    if (!device) throw new Error("Device not found");
    const updated = {
      dailyCalories: goals.calories ?? device.dailyCalories,
      dailyProtein: goals.protein ?? device.dailyProtein,
      dailyCarbs: goals.carbs ?? device.dailyCarbs,
      dailyFat: goals.fat ?? device.dailyFat,
    };
    const candidateTargets: DailyTargets = {
      calories: updated.dailyCalories,
      protein: updated.dailyProtein,
      carbs: updated.dailyCarbs,
      fat: updated.dailyFat,
    };
    if (!checkNutritionSafetyTargets(candidateTargets).ok) {
      throw new DeviceGoalsValidationError("UNSAFE_CALORIE_FLOOR");
    }
    if (isGoalMacroCaloriesOverAllocated(candidateTargets)) {
      throw new DeviceGoalsValidationError("MACRO_CALORIE_INCONSISTENT");
    }

    const columns: Array<[keyof Partial<DailyTargets>, string, number | undefined]> = [
      ["calories", "daily_calories", goals.calories],
      ["protein", "daily_protein", goals.protein],
      ["carbs", "daily_carbs", goals.carbs],
      ["fat", "daily_fat", goals.fat],
    ];
    const supplied = columns.filter(([, , value]) => value !== undefined);
    if (supplied.length === 0) throw new Error("At least one goal field is required");
    const assignments = supplied.map(([, column]) => `${column} = ?`).join(", ");
    client.prepare(`UPDATE devices SET ${assignments} WHERE id = ?`).run(
      ...supplied.map(([, , value]) => value as number),
      deviceId,
    );
    return {
      calories: updated.dailyCalories,
      protein: updated.dailyProtein,
      carbs: updated.dailyCarbs,
      fat: updated.dailyFat,
    };
  }

  return {
    async createDevice(
      goal: Goal,
      intake?: IntakeFields,
      targets?: DailyTargets,
      coachExplanation?: string,
    ) {
      const goalDefaults = getGoalDefaults(goal);
      const defaults = targets ?? goalDefaults;
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await db.insert(devices).values({
        id,
        goal,
        sex: intake?.sex ?? null,
        age: intake?.age ?? null,
        heightCm: intake?.heightCm ?? null,
        weightKg: intake?.weightKg ?? null,
        activityLevel: intake?.activityLevel ?? null,
        trainingFrequency: intake?.trainingFrequency ?? null,
        allergies: intake?.allergies ?? null,
        goalClarification: intake?.goalClarification ?? null,
        bodyFatPercent: intake?.bodyFatPercent ?? null,
        tdee: intake?.tdee ?? null,
        advancedNotes: intake?.advancedNotes ?? null,
        coachExplanation: coachExplanation ?? null,
        dailyCalories: defaults.calories,
        dailyProtein: defaults.protein,
        dailyCarbs: defaults.carbs,
        dailyFat: defaults.fat,
        createdAt: now,
      });
      return { deviceId: id, dailyTargets: { ...defaults } };
    },

    async getDevice(deviceId: string) {
      const rows = await db.select().from(devices).where(eq(devices.id, deviceId));
      return rows[0];
    },

    getDeviceSync,

    async bumpSessionVersion(deviceId: string) {
      await db
        .update(devices)
        .set({ sessionVersion: sql`${devices.sessionVersion} + 1` })
        .where(eq(devices.id, deviceId));
    },

    async updateGoals(deviceId: string, goals: Partial<DailyTargets>): Promise<DailyTargets> {
      db.$client.prepare("BEGIN IMMEDIATE").run();
      try {
        const updated = updateGoalsSync(deviceId, goals, db.$client);
        db.$client.prepare("COMMIT").run();
        return updated;
      } catch (error) {
        try {
          db.$client.prepare("ROLLBACK").run();
        } catch {
          // Preserve the original validation or persistence error.
        }
        throw error;
      }
    },

    updateGoalsSync,
  };
}
