import type { FastifyBaseLogger } from "fastify";
import { z } from "zod";
import type {
  ChatMessage,
  GenerateObjectResult,
  GenerateObjectRequest,
  StructuredJsonSchemaHint,
  StructuredOutputFailureReason,
  StructuredValidationIssue,
  StructuredValidationResult,
  LLMCallOptions,
  LLMProvider,
} from "../llm/types.js";
import { isLLMProviderError } from "../llm/errors.js";
import {
  logTargetGenerationAttemptFailed,
  logTargetGenerationFallbackUsed,
  type TargetGenerationTargetReason,
} from "../observability/events.js";
import type { Goal, IntakeFields, DailyTargets } from "./device.js";
import { getGoalDefaults } from "./device.js";
import {
  AdmissionRejectedError,
  type AdmissionLimiter,
  type AdmissionSubject,
} from "./admission-limiter.js";

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

export type { TargetGenerationTargetReason };

export interface TargetGenerationFailureSummary {
  providerReason: StructuredOutputFailureReason;
  targetReason: TargetGenerationTargetReason;
  metadataContext: typeof TARGET_GENERATION_METADATA_CONTEXT;
  issueCount?: number;
  fields?: string[];
  codes?: string[];
  noContentSubtype?: "no_choices" | "missing_content" | "empty_content";
}

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

export const MIN_ADULT_AGE = 18;
export const MAX_INTAKE_AGE = 120;

export function isAdultIntakeAge(age: number) {
  return Number.isFinite(age) && age >= MIN_ADULT_AGE && age <= MAX_INTAKE_AGE;
}

export interface TargetGenerationOptions extends LLMCallOptions {
  admissionSubject?: AdmissionSubject;
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

function fieldFromIssuePath(path: string): string {
  const first = path.split(".")[0];
  return TARGET_GENERATION_FIELDS.includes(first as (typeof TARGET_GENERATION_FIELDS)[number]) ? first : "root";
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

export function validateTargetDomain(
  goal: Goal,
  output: TargetGenerationOutput,
): { ok: true; dailyTargets: DailyTargets } | { ok: false; failure: TargetGenerationFailureSummary } {
  const dailyTargets: DailyTargets = {
    calories: output.calories,
    protein: output.protein,
    carbs: output.carbs,
    fat: output.fat,
  };
  const bounds = CALORIE_BOUNDS[goal];
  if (dailyTargets.calories < bounds.min || dailyTargets.calories > bounds.max) {
    return {
      ok: false,
      failure: {
        providerReason: "schema_validation",
        targetReason: "bounds_failed",
        metadataContext: TARGET_GENERATION_METADATA_CONTEXT,
        issueCount: 1,
        fields: ["calories"],
        codes: ["bounds_failed"],
      },
    };
  }

  const macroCalories = dailyTargets.protein * 4 + dailyTargets.carbs * 4 + dailyTargets.fat * 9;
  const diffRatio = Math.abs(macroCalories - dailyTargets.calories) / dailyTargets.calories;
  if (diffRatio > 0.1) {
    return {
      ok: false,
      failure: {
        providerReason: "schema_validation",
        targetReason: "macro_calorie_mismatch",
        metadataContext: TARGET_GENERATION_METADATA_CONTEXT,
        issueCount: 4,
        fields: ["calories", "protein", "carbs", "fat"],
        codes: ["macro_calorie_mismatch"],
      },
    };
  }

  return { ok: true, dailyTargets };
}

function getFallbackResult(goal: Goal): TargetGenerationResult {
  return {
    dailyTargets: getGoalDefaults(goal),
    coachExplanation: FALLBACK_EXPLANATIONS[goal],
    usedFallback: true,
  };
}

function getProviderMetadataContext(response: GenerateObjectResult<TargetGenerationOutput>): typeof TARGET_GENERATION_METADATA_CONTEXT {
  if ("metadataContext" in response.metadata && response.metadata.metadataContext === TARGET_GENERATION_METADATA_CONTEXT) {
    return TARGET_GENERATION_METADATA_CONTEXT;
  }
  return TARGET_GENERATION_METADATA_CONTEXT;
}

export function classifyProviderFailure(
  response: Exclude<GenerateObjectResult<TargetGenerationOutput>, { ok: true }>,
): TargetGenerationFailureSummary {
  if (response.reason === "provider_error") {
    return {
      providerReason: "provider_error",
      targetReason: "provider_error",
      metadataContext: TARGET_GENERATION_METADATA_CONTEXT,
    };
  }

  if (response.reason === "invalid_json") {
    return {
      providerReason: "invalid_json",
      targetReason: "invalid_json",
      metadataContext: getProviderMetadataContext(response),
    };
  }

  if (response.reason === "no_content") {
    return {
      providerReason: "no_content",
      targetReason: "no_content",
      metadataContext: getProviderMetadataContext(response),
      noContentSubtype: response.metadata.noContentSubtype,
    };
  }

  const issues = response.metadata.issues ?? [];
  const fields = issues.map((issue) => fieldFromIssuePath(issue.path));
  const codes = issues.map((issue) => issue.code);
  const hasMissingCanonicalField = issues.some((issue) =>
    issue.code === "missing_required"
    && TARGET_GENERATION_FIELDS.includes(issue.path as (typeof TARGET_GENERATION_FIELDS)[number])
  );

  return {
    providerReason: "schema_validation",
    targetReason: hasMissingCanonicalField ? "missing_field" : "schema_validation",
    metadataContext: getProviderMetadataContext(response),
    issueCount: response.metadata.issueCount ?? issues.length,
    fields,
    codes,
  };
}

function classifyThrownFailure(error: unknown): TargetGenerationFailureSummary {
  if (isLLMProviderError(error) && error.providerMetadata.aborted === true) {
    throw error;
  }

  return {
    providerReason: "provider_error",
    targetReason: "provider_error",
    metadataContext: TARGET_GENERATION_METADATA_CONTEXT,
  };
}

function logAttemptFailure(
  log: FastifyBaseLogger | undefined,
  attempt: number,
  failure: TargetGenerationFailureSummary,
) {
  if (!log) {
    return;
  }
  logTargetGenerationAttemptFailed(log, {
    attempt,
    providerReason: failure.providerReason,
    targetReason: failure.targetReason,
    metadataContext: failure.metadataContext,
    issueCount: failure.issueCount,
    fields: failure.fields,
    codes: failure.codes,
    noContentSubtype: failure.noContentSubtype,
  });
}

function logFallback(
  log: FastifyBaseLogger | undefined,
  attempt: number,
  failure: TargetGenerationFailureSummary,
) {
  if (!log) {
    return;
  }
  logTargetGenerationFallbackUsed(log, {
    attempt,
    providerReason: failure.providerReason,
    targetReason: failure.targetReason,
    metadataContext: failure.metadataContext,
    issueCount: failure.issueCount,
    fields: failure.fields,
    codes: failure.codes,
    noContentSubtype: failure.noContentSubtype,
  });
}

export function createTargetGenerationService(
  llmProvider: LLMProvider,
  log?: FastifyBaseLogger,
  admissionLimiter?: AdmissionLimiter,
) {
  return {
    async generateTargets(goal: Goal, intake: IntakeFields, opts?: TargetGenerationOptions): Promise<TargetGenerationResult> {
      if (!isAdultIntakeAge(intake.age)) {
        throw new Error("Adult intake is required");
      }

      const admission = admissionLimiter?.tryAcquire("provider", opts?.admissionSubject);
      if (admission && !admission.ok) {
        throw new AdmissionRejectedError(admission);
      }
      const permit = admission?.permit;

      try {
        const messages = buildMessages(goal, intake);
        let finalFailure: TargetGenerationFailureSummary | undefined;

        for (let attempt = 1; attempt <= 2; attempt++) {
          try {
            const response = await llmProvider.generateObject(
              messages,
              buildTargetGenerationRequest(),
              opts?.signal ? { signal: opts.signal } : undefined,
            );
            if (!response.ok) {
              finalFailure = classifyProviderFailure(response);
              logAttemptFailure(log, attempt, finalFailure);
              continue;
            }

            const domainResult = validateTargetDomain(goal, response.value);
            if (!domainResult.ok) {
              finalFailure = domainResult.failure;
              logAttemptFailure(log, attempt, finalFailure);
              continue;
            }

            return {
              dailyTargets: domainResult.dailyTargets,
              coachExplanation: response.value.coachExplanation,
              usedFallback: false,
            };
          } catch (error) {
            finalFailure = classifyThrownFailure(error);
            logAttemptFailure(log, attempt, finalFailure);
          }
        }

        logFallback(log, 2, finalFailure ?? {
          providerReason: "provider_error",
          targetReason: "provider_error",
          metadataContext: TARGET_GENERATION_METADATA_CONTEXT,
        });
        return getFallbackResult(goal);
      } finally {
        permit?.release();
      }
    },
  };
}
