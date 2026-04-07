import type { LLMProvider, ChatMessage } from "../llm/types.js";
import type { Goal, IntakeFields, DailyTargets } from "./device.js";
import { getGoalDefaults } from "./device.js";

interface TargetGenerationResult {
  dailyTargets: DailyTargets;
  coachExplanation: string;
  usedFallback: boolean;
}

interface LLMTargetResponse {
  dailyTargets?: Partial<DailyTargets>;
  explanation?: string;
  coachExplanation?: string;
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
}

const CALORIE_BOUNDS: Record<Goal, { min: number; max: number }> = {
  fat_loss: { min: 1200, max: 4000 },
  muscle_gain: { min: 1500, max: 5000 },
};

const FALLBACK_EXPLANATIONS: Record<Goal, string> = {
  fat_loss: "先用預設目標，之後可再微調。",
  muscle_gain: "先用預設目標，之後可再微調。",
};

function buildIntakePayload(intake: IntakeFields): Record<string, unknown> {
  return {
    sex: intake.sex,
    age: intake.age,
    heightCm: intake.heightCm,
    weightKg: intake.weightKg,
    activityLevel: intake.activityLevel,
    trainingFrequency: intake.trainingFrequency,
    allergies: intake.allergies ?? null,
    goalClarification: intake.goalClarification ?? null,
    bodyFatPercent: intake.bodyFatPercent ?? null,
    tdee: intake.tdee ?? null,
    advancedNotes: intake.advancedNotes ?? null,
  };
}

function buildMessages(goal: Goal, intake: IntakeFields): ChatMessage[] {
  const payload = buildIntakePayload(intake);
  return [
    {
      role: "system",
      content:
        "你是一位嚴謹的營養教練。請只輸出 JSON，不要加說明文字、Markdown 或工具呼叫。" +
        "請根據目標與體態資料生成每日熱量與三大營養素目標，並附上一句簡短的繁體中文教練說明。",
    },
    {
      role: "user",
      content: `目標: ${goal}\n\nIntake 資料:\n${JSON.stringify(payload, null, 2)}`,
    },
  ];
}

function cleanJsonContent(content: string): string {
  const trimmed = content.trim();
  const fencedMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fencedMatch ? fencedMatch[1].trim() : trimmed;
}

function readFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readExplanation(parsed: LLMTargetResponse): string | null {
  const explanation = parsed.explanation ?? parsed.coachExplanation;
  if (typeof explanation !== "string") {
    return null;
  }

  const trimmed = explanation.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseTargetResponse(content: string): { dailyTargets: DailyTargets; coachExplanation: string } {
  const cleaned = cleanJsonContent(content);
  const parsed = JSON.parse(cleaned) as LLMTargetResponse;
  const rawTargets = parsed.dailyTargets ?? parsed;
  const calories = readFiniteNumber(rawTargets.calories);
  const protein = readFiniteNumber(rawTargets.protein);
  const carbs = readFiniteNumber(rawTargets.carbs);
  const fat = readFiniteNumber(rawTargets.fat);
  const coachExplanation = readExplanation(parsed);

  if (calories === null || protein === null || carbs === null || fat === null || coachExplanation === null) {
    throw new Error("Invalid target response");
  }

  const dailyTargets: DailyTargets = {
    calories,
    protein,
    carbs,
    fat,
  };
  return { dailyTargets, coachExplanation };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function validateTargets(goal: Goal, targets: DailyTargets): boolean {
  const bounds = CALORIE_BOUNDS[goal];
  if (!isFiniteNumber(targets.calories) || targets.calories < bounds.min || targets.calories > bounds.max) {
    return false;
  }
  if (!isFiniteNumber(targets.protein) || targets.protein <= 0) {
    return false;
  }
  if (!isFiniteNumber(targets.fat) || targets.fat <= 0) {
    return false;
  }
  if (!isFiniteNumber(targets.carbs) || targets.carbs < 0) {
    return false;
  }

  const macroCalories = targets.protein * 4 + targets.carbs * 4 + targets.fat * 9;
  const diffRatio = Math.abs(macroCalories - targets.calories) / targets.calories;
  return diffRatio <= 0.1;
}

function getFallbackResult(goal: Goal): TargetGenerationResult {
  return {
    dailyTargets: getGoalDefaults(goal),
    coachExplanation: FALLBACK_EXPLANATIONS[goal],
    usedFallback: true,
  };
}

export function createTargetGenerationService(llmProvider: LLMProvider) {
  return {
    async generateTargets(goal: Goal, intake: IntakeFields): Promise<TargetGenerationResult> {
      const messages = buildMessages(goal, intake);

      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const response = await llmProvider.chat(messages, []);
          if (!response.content) {
            continue;
          }

          const parsed = parseTargetResponse(response.content);
          if (!validateTargets(goal, parsed.dailyTargets)) {
            continue;
          }

          return {
            dailyTargets: parsed.dailyTargets,
            coachExplanation: parsed.coachExplanation,
            usedFallback: false,
          };
        } catch {
          if (attempt === 1) {
            break;
          }
        }
      }

      return getFallbackResult(goal);
    },
  };
}
