import type { LLMProvider, ChatMessage } from "../llm/types.js";
import type { Goal, IntakeFields, DailyTargets } from "./device.js";
import type { FastifyBaseLogger } from "fastify";
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

const RESPONSE_SCHEMA_EXAMPLE = '{"calories":1800,"protein":140,"carbs":180,"fat":60,"coachExplanation":"一句繁體中文說明"}';

function buildMessages(goal: Goal, intake: IntakeFields): ChatMessage[] {
  const payload = buildIntakePayload(intake);
  return [
    {
      role: "system",
      content:
        "你是一位嚴謹的營養教練。請只輸出 JSON，不要加說明文字、Markdown 或工具呼叫。\n" +
        "根據目標與體態資料生成每日熱量與三大營養素目標，並附上一句簡短的繁體中文教練說明。\n" +
        "必須嚴格使用以下欄位名稱（不可加 _g、_kcal 後綴，不可使用巢狀結構）：\n" +
        RESPONSE_SCHEMA_EXAMPLE,
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

const EXPLANATION_KEYS = ["coachExplanation", "explanation", "note", "coachNote", "message", "coach_explanation"];

function readExplanation(obj: Record<string, unknown>): string | null {
  // Check known keys first
  for (const key of EXPLANATION_KEYS) {
    const value = obj[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  // Fallback: any key containing "note", "explanation", or "coach"
  for (const key of Object.keys(obj)) {
    const lower = key.toLowerCase();
    if (lower.includes("note") || lower.includes("explanation") || lower.includes("coach")) {
      const value = obj[key];
      if (typeof value === "string" && value.trim().length > 0) return value.trim();
    }
  }
  return null;
}

function readMacroNumber(obj: Record<string, unknown>, key: string): number | null {
  return readFiniteNumber(obj[key] ?? obj[`${key}_g`] ?? obj[`${key}_kcal`]);
}

function parseTargetResponse(content: string): { dailyTargets: DailyTargets; coachExplanation: string } {
  const cleaned = cleanJsonContent(content);
  const parsed = JSON.parse(cleaned) as Record<string, unknown>;
  // Support nested "macros" or "dailyTargets" sub-objects
  const macros = (parsed.macros ?? parsed.dailyTargets ?? parsed) as Record<string, unknown>;

  const calories = readMacroNumber(parsed, "calories") ?? readMacroNumber(macros, "calories");
  const protein = readMacroNumber(macros, "protein") ?? readMacroNumber(parsed, "protein");
  const carbs = readMacroNumber(macros, "carbs") ?? readMacroNumber(parsed, "carbs");
  const fat = readMacroNumber(macros, "fat") ?? readMacroNumber(parsed, "fat");
  const coachExplanation = readExplanation(parsed);

  if (calories === null || protein === null || carbs === null || fat === null || coachExplanation === null) {
    throw new Error("Invalid target response");
  }

  const dailyTargets: DailyTargets = { calories, protein, carbs, fat };
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

export function createTargetGenerationService(llmProvider: LLMProvider, log?: FastifyBaseLogger) {
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

      log?.warn({ event: "target_gen_fallback", reason: "llm_attempts_exhausted" }, "Target generation fallback");
      return getFallbackResult(goal);
    },
  };
}
