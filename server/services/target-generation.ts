import type { FastifyBaseLogger } from "fastify";
import { z } from "zod";
import type {
  ChatMessage,
  GenerateObjectRequest,
  StructuredJsonSchemaHint,
  StructuredValidationIssue,
  StructuredValidationResult,
  LLMProvider,
} from "../llm/types.js";
import type { Goal, IntakeFields, DailyTargets } from "./device.js";
import { getGoalDefaults } from "./device.js";

export const TARGET_GENERATION_METADATA_CONTEXT = "target_generation";
export const TARGET_GENERATION_MAX_COACH_EXPLANATION_CHARS = 160;

const TARGET_GENERATION_FIELDS = ["calories", "protein", "carbs", "fat", "coachExplanation"] as const;

export const targetGenerationOutputSchema = z.strictObject({
  calories: z.number().int().positive(),
  protein: z.number().int().positive(),
  carbs: z.number().int().nonnegative(),
  fat: z.number().int().positive(),
  coachExplanation: z.string().trim().min(1).max(TARGET_GENERATION_MAX_COACH_EXPLANATION_CHARS),
});

export type TargetGenerationOutput = z.infer<typeof targetGenerationOutputSchema>;

export const TARGET_GENERATION_SCHEMA_HINT: StructuredJsonSchemaHint = {
  name: "onboarding_target_generation",
  description: "Daily nutrition targets and one short Traditional Chinese coach explanation.",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: TARGET_GENERATION_FIELDS,
    properties: {
      calories: {
        type: "integer",
        minimum: 1,
      },
      protein: {
        type: "integer",
        minimum: 1,
      },
      carbs: {
        type: "integer",
        minimum: 0,
      },
      fat: {
        type: "integer",
        minimum: 1,
      },
      coachExplanation: {
        type: "string",
        minLength: 1,
        maxLength: TARGET_GENERATION_MAX_COACH_EXPLANATION_CHARS,
      },
    },
  },
};

interface TargetGenerationResult {
  dailyTargets: DailyTargets;
  coachExplanation: string;
  usedFallback: boolean;
}

const CALORIE_BOUNDS: Record<Goal, { min: number; max: number }> = {
  fat_loss: { min: 1200, max: 4000 },
  muscle_gain: { min: 1500, max: 5000 },
  maintain: { min: 1200, max: 5000 },
};

const FALLBACK_EXPLANATIONS: Record<Goal, string> = {
  fat_loss: "先用預設目標，之後可再微調。",
  muscle_gain: "先用預設目標，之後可再微調。",
  maintain: "先用預設目標，之後可再微調。",
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function issuePath(issue: z.core.$ZodIssue): string {
  return issue.path.length > 0 ? issue.path.join(".") : "root";
}

function issueCode(issue: z.core.$ZodIssue): string {
  return typeof issue.code === "string" && issue.code.length > 0 ? issue.code : "custom";
}

function buildMissingFieldIssues(raw: unknown): StructuredValidationIssue[] {
  if (!isRecord(raw)) {
    return [];
  }

  return TARGET_GENERATION_FIELDS
    .filter((field) => !Object.hasOwn(raw, field))
    .map((field) => ({ path: field, code: "missing_required" }));
}

export function validateStructuredTargetOutput(raw: unknown): StructuredValidationResult<TargetGenerationOutput> {
  const parsed = targetGenerationOutputSchema.safeParse(raw);
  if (parsed.success) {
    return { ok: true, value: parsed.data };
  }

  const missingIssues = buildMissingFieldIssues(raw);
  const missingPaths = new Set(missingIssues.map((issue) => issue.path));
  const zodIssues = parsed.error.issues
    .map((issue) => ({ path: issuePath(issue), code: issueCode(issue) }))
    .filter((issue) => !(missingPaths.has(issue.path) && issue.code === "invalid_type"));

  return {
    ok: false,
    issues: [...missingIssues, ...zodIssues],
  };
}

export function buildTargetGenerationRequest(): GenerateObjectRequest<TargetGenerationOutput> {
  return {
    validate: validateStructuredTargetOutput,
    schemaHint: TARGET_GENERATION_SCHEMA_HINT,
    metadataContext: TARGET_GENERATION_METADATA_CONTEXT,
    maxCompletionTokens: 300,
  };
}

function validateTargets(goal: Goal, targets: DailyTargets): boolean {
  const bounds = CALORIE_BOUNDS[goal];
  if (targets.calories < bounds.min || targets.calories > bounds.max) {
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
          const response = await llmProvider.generateObject(messages, buildTargetGenerationRequest());
          if (!response.ok) {
            continue;
          }

          const dailyTargets: DailyTargets = {
            calories: response.value.calories,
            protein: response.value.protein,
            carbs: response.value.carbs,
            fat: response.value.fat,
          };

          if (!validateTargets(goal, dailyTargets)) {
            continue;
          }

          return {
            dailyTargets,
            coachExplanation: response.value.coachExplanation,
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
