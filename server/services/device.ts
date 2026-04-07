// server/services/device.ts
import { eq } from "drizzle-orm";
import { devices } from "../db/schema.js";
import type { AppDatabase } from "../db/client.js";

const GOAL_DEFAULTS = {
  fat_loss: { calories: 1500, protein: 120, carbs: 150, fat: 50 },
  muscle_gain: { calories: 2500, protein: 180, carbs: 300, fat: 70 },
} as const;

export interface DailyTargets {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export type Goal = keyof typeof GOAL_DEFAULTS;

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

    async updateGoals(deviceId: string, goals: Partial<DailyTargets>): Promise<DailyTargets> {
      const device = (await db.select().from(devices).where(eq(devices.id, deviceId)))[0];
      if (!device) throw new Error("Device not found");
      const updated = {
        dailyCalories: goals.calories ?? device.dailyCalories,
        dailyProtein: goals.protein ?? device.dailyProtein,
        dailyCarbs: goals.carbs ?? device.dailyCarbs,
        dailyFat: goals.fat ?? device.dailyFat,
      };
      await db.update(devices).set(updated).where(eq(devices.id, deviceId));
      return {
        calories: updated.dailyCalories,
        protein: updated.dailyProtein,
        carbs: updated.dailyCarbs,
        fat: updated.dailyFat,
      };
    },
  };
}
