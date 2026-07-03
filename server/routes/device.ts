import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { createDeviceService, DailyTargets, Goal, IntakeFields } from "../services/device.js";
import type { createGuestSessionService } from "../services/guest-session.js";
import type { createTargetGenerationService } from "../services/target-generation.js";
import { config, isDeployedLikeRuntime } from "../config.js";
import {
  checkNutritionSafetyTargets,
  UNSAFE_CALORIE_FLOOR_REASON,
} from "../orchestrator/nutrition-safety-policy.js";
import { isGoalMacroCaloriesOverAllocated } from "../orchestrator/goal-adjustment-policy.js";
import {
  logDeviceGoalsValidationFailed,
  logDeviceGoalsUpdatedRest,
  logOnboardingSubmitStarted,
  logOnboardingSubmitSucceeded,
  logOnboardingValidationFailed,
  logOwnershipBypassBlocked,
} from "../observability/events.js";
import { getProtectedOwner, PROTECTED_ROUTE_META, registerProtectedRoute } from "./protected-route.js";

interface Deps {
  deviceService: ReturnType<typeof createDeviceService>;
  guestSessionService: ReturnType<typeof createGuestSessionService>;
  targetGenerationService: ReturnType<typeof createTargetGenerationService>;
}

const VALID_GOALS = ["fat_loss", "muscle_gain", "maintain"] as const;
const VALID_SEXES = ["male", "female"] as const;
const VALID_ACTIVITY_LEVELS = ["sedentary", "light", "moderate", "active", "very_active"] as const;
const VALID_TRAINING_FREQUENCIES = ["none", "1_2", "3_4", "5_plus"] as const;
const REQUIRED_INTAKE_KEYS = ["sex", "age", "heightCm", "weightKg", "activityLevel", "trainingFrequency"] as const;
const OPTIONAL_INTAKE_KEYS = ["allergies", "goalClarification", "bodyFatPercent", "tdee", "advancedNotes"] as const;
const INTAKE_KEYS = [...REQUIRED_INTAKE_KEYS, ...OPTIONAL_INTAKE_KEYS] as const;
const STEP_TEXT_LIMITS = {
  goalClarification: 300,
  allergies: 300,
  advancedNotes: 500,
} as const;
const GOAL_TARGET_BOUNDS = {
  calories: { min: 500, max: 8000 },
  protein: { min: 0, max: 400 },
  carbs: { min: 0, max: 1000 },
  fat: { min: 0, max: 300 },
} as const;

type IntakeValidationStep = 1 | 2 | 3 | 4 | 5;
type GoalTargetField = keyof typeof GOAL_TARGET_BOUNDS;
type IntakeValidationField =
  | "goal"
  | "goalClarification"
  | "sex"
  | "age"
  | "heightCm"
  | "weightKg"
  | "activityLevel"
  | "trainingFrequency"
  | "allergies"
  | "bodyFatPercent"
  | "tdee"
  | "advancedNotes";

interface IntakeValidationIssue {
  field: IntakeValidationField;
  code: string;
  step: IntakeValidationStep;
  message: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasRawDeviceIdSelector(request: FastifyRequest, body: Record<string, unknown>) {
  return (
    "deviceId" in body
    || request.headers["x-device-id"] !== undefined
    || (isRecord(request.query) && "deviceId" in request.query)
  );
}

function isGoal(value: unknown): value is Goal {
  return typeof value === "string" && VALID_GOALS.includes(value as Goal);
}

function hasAnyIntakeField(body: Record<string, unknown>): boolean {
  return INTAKE_KEYS.some((key) => key in body);
}

function isAllowedSex(value: string): value is IntakeFields["sex"] {
  return VALID_SEXES.includes(value as (typeof VALID_SEXES)[number]);
}

function isAllowedActivityLevel(value: string): value is IntakeFields["activityLevel"] {
  return VALID_ACTIVITY_LEVELS.includes(value as (typeof VALID_ACTIVITY_LEVELS)[number]);
}

function isAllowedTrainingFrequency(value: string): value is IntakeFields["trainingFrequency"] {
  return VALID_TRAINING_FREQUENCIES.includes(value as (typeof VALID_TRAINING_FREQUENCIES)[number]);
}

function validateRange(value: number, min: number, max: number) {
  return value >= min && value <= max;
}

function createValidationIssue(
  field: IntakeValidationField,
  code: string,
  step: IntakeValidationStep,
  message: string,
): IntakeValidationIssue {
  return { field, code, step, message };
}

function readTrimmedOptionalString(body: Record<string, unknown>, key: "allergies" | "goalClarification" | "advancedNotes") {
  if (!(key in body)) return { present: false as const };
  if (typeof body[key] !== "string") return { present: true as const, valid: false as const };

  const trimmed = (body[key] as string).trim();
  return {
    present: true as const,
    valid: true as const,
    value: trimmed.length > 0 ? trimmed : undefined,
  };
}

function readRequiredFiniteNumber(body: Record<string, unknown>, key: "age" | "heightCm" | "weightKg") {
  if (!(key in body)) return { present: false as const };
  if (typeof body[key] !== "number" || !Number.isFinite(body[key])) {
    return { present: true as const, valid: false as const };
  }

  return { present: true as const, valid: true as const, value: body[key] as number };
}

function readOptionalFiniteNumber(body: Record<string, unknown>, key: "bodyFatPercent" | "tdee") {
  if (!(key in body)) return { present: false as const };
  if (typeof body[key] !== "number" || !Number.isFinite(body[key])) {
    return { present: true as const, valid: false as const };
  }

  return { present: true as const, valid: true as const, value: body[key] as number };
}

function setGuestSessionCookies(
  reply: FastifyReply,
  guestSessionService: ReturnType<typeof createGuestSessionService>,
  deviceId: string,
  sessionVersion: number,
) {
  reply.header("set-cookie", guestSessionService.issue(deviceId, sessionVersion).cookies);
}

function clearGuestSessionCookies(
  reply: FastifyReply,
  guestSessionService: ReturnType<typeof createGuestSessionService>,
) {
  reply.header("set-cookie", guestSessionService.clearSessionCookies());
}

function buildDeviceSessionResponse(device: Awaited<ReturnType<ReturnType<typeof createDeviceService>["getDevice"]>>) {
  if (!device) {
    return null;
  }

  return {
    deviceId: device.id,
    goal: device.goal,
    dailyTargets: {
      calories: device.dailyCalories,
      protein: device.dailyProtein,
      carbs: device.dailyCarbs,
      fat: device.dailyFat,
    },
  };
}

async function findCurrentSessionDeviceForLogout(
  request: FastifyRequest,
  { deviceService, guestSessionService }: Pick<Deps, "deviceService" | "guestSessionService">,
) {
  const { activeToken, resumeToken } = guestSessionService.readTokens(request.headers.cookie);

  const activeSession = guestSessionService.verifyActiveSession(activeToken);
  if (activeSession.ok) {
    const device = await deviceService.getDevice(activeSession.deviceId);
    if (device && activeSession.version === device.sessionVersion) {
      return device;
    }
  }

  const resumedSession = guestSessionService.verifyResumeSession(resumeToken);
  if (resumedSession.ok) {
    const device = await deviceService.getDevice(resumedSession.deviceId);
    if (device && resumedSession.version === device.sessionVersion) {
      return device;
    }
  }

  return null;
}

function buildGoalValidationIssue(): IntakeValidationIssue {
  return createValidationIssue("goal", "INVALID_GOAL", 1, "請選擇減脂、增肌或維持目標");
}

function logOnboardingValidationIssues(
  log: Parameters<typeof logOnboardingValidationFailed>[0],
  errors: readonly IntakeValidationIssue[],
) {
  const earliestStep = Math.min(...errors.map((error) => error.step)) as IntakeValidationStep;
  logOnboardingValidationFailed(log, {
    source: "server",
    step: earliestStep,
    fields: errors.map((error) => error.field),
    codes: errors.map((error) => error.code),
  });
}

function buildIntake(
  body: Record<string, unknown>,
): { ok: true; goal: Goal; intake: IntakeFields } | { ok: false; errors: IntakeValidationIssue[] } {
  const errors: IntakeValidationIssue[] = [];

  let goal: Goal | null = null;
  if (!isGoal(body.goal)) {
    errors.push(buildGoalValidationIssue());
  } else {
    goal = body.goal;
  }

  let sex: IntakeFields["sex"] | undefined;
  if (!("sex" in body) || typeof body.sex !== "string" || body.sex.trim().length === 0) {
    errors.push(createValidationIssue("sex", "MISSING_SEX", 3, "請選擇性別"));
  } else {
    const trimmed = body.sex.trim();
    if (!isAllowedSex(trimmed)) {
      errors.push(createValidationIssue("sex", "INVALID_SEX", 3, "請選擇有效的性別"));
    } else {
      sex = trimmed;
    }
  }

  const ageResult = readRequiredFiniteNumber(body, "age");
  let age: number | undefined;
  if (!ageResult.present) {
    errors.push(createValidationIssue("age", "MISSING_AGE", 3, "請輸入年齡"));
  } else if (!ageResult.valid) {
    errors.push(createValidationIssue("age", "INVALID_AGE", 3, "請輸入有效的年齡"));
  } else if (!validateRange(ageResult.value, 10, 120)) {
    errors.push(createValidationIssue("age", "AGE_OUT_OF_RANGE", 3, "年齡需介於 10-120"));
  } else {
    age = ageResult.value;
  }

  const heightResult = readRequiredFiniteNumber(body, "heightCm");
  let heightCm: number | undefined;
  if (!heightResult.present) {
    errors.push(createValidationIssue("heightCm", "MISSING_HEIGHT_CM", 3, "請輸入身高"));
  } else if (!heightResult.valid) {
    errors.push(createValidationIssue("heightCm", "INVALID_HEIGHT_CM", 3, "請輸入有效的身高"));
  } else if (!validateRange(heightResult.value, 50, 300)) {
    errors.push(createValidationIssue("heightCm", "HEIGHT_OUT_OF_RANGE", 3, "身高需介於 50-300 cm"));
  } else {
    heightCm = heightResult.value;
  }

  const weightResult = readRequiredFiniteNumber(body, "weightKg");
  let weightKg: number | undefined;
  if (!weightResult.present) {
    errors.push(createValidationIssue("weightKg", "MISSING_WEIGHT_KG", 3, "請輸入體重"));
  } else if (!weightResult.valid) {
    errors.push(createValidationIssue("weightKg", "INVALID_WEIGHT_KG", 3, "請輸入有效的體重"));
  } else if (!validateRange(weightResult.value, 20, 500)) {
    errors.push(createValidationIssue("weightKg", "WEIGHT_OUT_OF_RANGE", 3, "體重需介於 20-500 kg"));
  } else {
    weightKg = weightResult.value;
  }

  let activityLevel: IntakeFields["activityLevel"] | undefined;
  if (!("activityLevel" in body) || typeof body.activityLevel !== "string" || body.activityLevel.trim().length === 0) {
    errors.push(createValidationIssue("activityLevel", "MISSING_ACTIVITY_LEVEL", 4, "請選擇活動量"));
  } else {
    const trimmed = body.activityLevel.trim();
    if (!isAllowedActivityLevel(trimmed)) {
      errors.push(createValidationIssue("activityLevel", "INVALID_ACTIVITY_LEVEL", 4, "請選擇有效的活動量"));
    } else {
      activityLevel = trimmed;
    }
  }

  let trainingFrequency: IntakeFields["trainingFrequency"] | undefined;
  if (
    !("trainingFrequency" in body) ||
    typeof body.trainingFrequency !== "string" ||
    body.trainingFrequency.trim().length === 0
  ) {
    errors.push(createValidationIssue("trainingFrequency", "MISSING_TRAINING_FREQUENCY", 4, "請選擇訓練頻率"));
  } else {
    const trimmed = body.trainingFrequency.trim();
    if (!isAllowedTrainingFrequency(trimmed)) {
      errors.push(
        createValidationIssue("trainingFrequency", "INVALID_TRAINING_FREQUENCY", 4, "請選擇有效的訓練頻率"),
      );
    } else {
      trainingFrequency = trimmed;
    }
  }

  const goalClarificationResult = readTrimmedOptionalString(body, "goalClarification");
  let goalClarification: string | undefined;
  if (goalClarificationResult.present && !goalClarificationResult.valid) {
    errors.push(
      createValidationIssue("goalClarification", "INVALID_GOAL_CLARIFICATION", 2, "目標補充需為文字"),
    );
  } else if (goalClarificationResult.present) {
    if ((goalClarificationResult.value?.length ?? 0) > STEP_TEXT_LIMITS.goalClarification) {
      errors.push(
        createValidationIssue(
          "goalClarification",
          "GOAL_CLARIFICATION_TOO_LONG",
          2,
          "目標補充最多 300 字",
        ),
      );
    } else {
      goalClarification = goalClarificationResult.value;
    }
  }

  const allergiesResult = readTrimmedOptionalString(body, "allergies");
  let allergies: string | undefined;
  if (allergiesResult.present && !allergiesResult.valid) {
    errors.push(createValidationIssue("allergies", "INVALID_ALLERGIES", 4, "過敏資訊需為文字"));
  } else if (allergiesResult.present) {
    if ((allergiesResult.value?.length ?? 0) > STEP_TEXT_LIMITS.allergies) {
      errors.push(createValidationIssue("allergies", "ALLERGIES_TOO_LONG", 4, "過敏資訊最多 300 字"));
    } else {
      allergies = allergiesResult.value;
    }
  }

  const bodyFatResult = readOptionalFiniteNumber(body, "bodyFatPercent");
  let bodyFatPercent: number | undefined;
  if (bodyFatResult.present && !bodyFatResult.valid) {
    errors.push(
      createValidationIssue("bodyFatPercent", "INVALID_BODY_FAT_PERCENT", 5, "請輸入有效的體脂率"),
    );
  } else if (bodyFatResult.present) {
    if (!validateRange(bodyFatResult.value, 2, 70)) {
      errors.push(
        createValidationIssue("bodyFatPercent", "BODY_FAT_OUT_OF_RANGE", 5, "體脂率需介於 2-70"),
      );
    } else {
      bodyFatPercent = bodyFatResult.value;
    }
  }

  const tdeeResult = readOptionalFiniteNumber(body, "tdee");
  let tdee: number | undefined;
  if (tdeeResult.present && !tdeeResult.valid) {
    errors.push(createValidationIssue("tdee", "INVALID_TDEE", 5, "請輸入有效的 TDEE"));
  } else if (tdeeResult.present) {
    if (!validateRange(tdeeResult.value, 500, 8000)) {
      errors.push(createValidationIssue("tdee", "TDEE_OUT_OF_RANGE", 5, "TDEE 需介於 500-8000"));
    } else {
      tdee = tdeeResult.value;
    }
  }

  const advancedNotesResult = readTrimmedOptionalString(body, "advancedNotes");
  let advancedNotes: string | undefined;
  if (advancedNotesResult.present && !advancedNotesResult.valid) {
    errors.push(createValidationIssue("advancedNotes", "INVALID_ADVANCED_NOTES", 5, "備註需為文字"));
  } else if (advancedNotesResult.present) {
    if ((advancedNotesResult.value?.length ?? 0) > STEP_TEXT_LIMITS.advancedNotes) {
      errors.push(
        createValidationIssue("advancedNotes", "ADVANCED_NOTES_TOO_LONG", 5, "其他備註最多 500 字"),
      );
    } else {
      advancedNotes = advancedNotesResult.value;
    }
  }

  if (errors.length > 0 || goal === null || !sex || age === undefined || heightCm === undefined || weightKg === undefined || !activityLevel || !trainingFrequency) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    goal,
    intake: {
      sex,
      age,
      heightCm,
      weightKg,
      activityLevel,
      trainingFrequency,
      allergies,
      goalClarification,
      bodyFatPercent,
      tdee,
      advancedNotes,
    },
  };
}

export function registerDeviceRoutes(
  app: FastifyInstance,
  { deviceService, guestSessionService, targetGenerationService }: Deps,
) {
  app.post("/api/device", async (request, reply) => {
    const body = request.body;
    if (!isRecord(body)) {
      return reply.code(400).send({ error: "Request body must be a JSON object." });
    }
    logOnboardingSubmitStarted(request.log, { source: "server" });

    if (!hasAnyIntakeField(body)) {
      if (!isGoal(body.goal)) {
        const errors = [buildGoalValidationIssue()];
        logOnboardingValidationIssues(request.log, errors);
        return reply.code(400).send({ error: "VALIDATION_ERROR", errors });
      }

      const result = await deviceService.createDevice(body.goal);
      logOnboardingSubmitSucceeded(request.log, { usedTargetFallback: false });
      setGuestSessionCookies(reply, guestSessionService, result.deviceId, 0);
      return { ...result, coachExplanation: null, usedFallback: false };
    }

    const intakeResult = buildIntake(body);
    if (!intakeResult.ok) {
      logOnboardingValidationIssues(request.log, intakeResult.errors);
      return reply.code(400).send({ error: "VALIDATION_ERROR", errors: intakeResult.errors });
    }

    const { dailyTargets, coachExplanation, usedFallback } = await targetGenerationService.generateTargets(
      intakeResult.goal,
      intakeResult.intake,
    );
    const result = await deviceService.createDevice(
      intakeResult.goal,
      intakeResult.intake,
      dailyTargets,
      coachExplanation,
    );
    logOnboardingSubmitSucceeded(request.log, { usedTargetFallback: usedFallback });
    setGuestSessionCookies(reply, guestSessionService, result.deviceId, 0);
    return { ...result, coachExplanation, usedFallback };
  });

  app.post("/api/device/session", async (request, reply) => {
    if (request.body !== undefined && !isRecord(request.body)) {
      return reply.code(400).send({ error: "Request body must be a JSON object." });
    }

    const body = isRecord(request.body) ? request.body : {};
    const { activeToken, resumeToken } = guestSessionService.readTokens(request.headers.cookie);

    const activeSession = guestSessionService.verifyActiveSession(activeToken);
    if (activeSession.ok) {
      const deviceRow = await deviceService.getDevice(activeSession.deviceId);
      if (!deviceRow || activeSession.version !== deviceRow.sessionVersion) {
        clearGuestSessionCookies(reply, guestSessionService);
        return reply.code(401).send({ error: "Invalid guest session" });
      }
      const device = buildDeviceSessionResponse(deviceRow);
      if (!device) {
        clearGuestSessionCookies(reply, guestSessionService);
        return reply.code(401).send({ error: "Invalid guest session" });
      }
      return { ...device, establishedBy: "active" as const };
    }

    const resumedSession = guestSessionService.verifyResumeSession(resumeToken);
    if (resumedSession.ok) {
      const deviceRow = await deviceService.getDevice(resumedSession.deviceId);
      if (!deviceRow || resumedSession.version !== deviceRow.sessionVersion) {
        clearGuestSessionCookies(reply, guestSessionService);
        return reply.code(401).send({ error: "Invalid guest session" });
      }
      const device = buildDeviceSessionResponse(deviceRow);
      if (!device) {
        clearGuestSessionCookies(reply, guestSessionService);
        return reply.code(401).send({ error: "Invalid guest session" });
      }
      reply.header("set-cookie", guestSessionService.issue(resumedSession.deviceId, deviceRow.sessionVersion).cookies);
      return { ...device, establishedBy: "resume" as const };
    }

    if (activeToken || resumeToken) {
      clearGuestSessionCookies(reply, guestSessionService);
      return reply.code(401).send({ error: "Invalid guest session" });
    }

    if ("legacyDeviceId" in body && typeof body.legacyDeviceId !== "string") {
      return reply.code(400).send({ error: "legacyDeviceId must be a string." });
    }
    if ("legacyDeviceId" in body && hasRawDeviceIdSelector(request, body)) {
      return reply.code(400).send({ error: "legacyDeviceId cannot be combined with raw device selectors." });
    }

    const legacyDeviceId = typeof body.legacyDeviceId === "string" ? body.legacyDeviceId.trim() : "";
    if (!legacyDeviceId) {
      return reply.code(401).send({ error: "No guest session available" });
    }

    if (isDeployedLikeRuntime({ nodeEnv: config.nodeEnv, guestSessionCookieSecure: config.guestSessionCookieSecure })) {
      logOwnershipBypassBlocked(request.log, {
        reason: "legacy_device_id_rejected",
        route: "api_device_session",
        operation: "legacy_session_bootstrap",
        requestId: request.id,
      });
      return reply.code(401).send({ error: "No guest session available" });
    }

    const deviceRow = await deviceService.getDevice(legacyDeviceId);
    const device = buildDeviceSessionResponse(deviceRow);
    if (!deviceRow || !device) {
      return reply.code(401).send({ error: "Invalid device ID" });
    }

    setGuestSessionCookies(reply, guestSessionService, device.deviceId, deviceRow.sessionVersion);
    return { ...device, establishedBy: "legacy_migration" as const };
  });

  app.delete("/api/device/session", async (request, reply) => {
    const device = await findCurrentSessionDeviceForLogout(request, { deviceService, guestSessionService });
    if (device) {
      await deviceService.bumpSessionVersion(device.id);
    }
    clearGuestSessionCookies(reply, guestSessionService);
    return reply.code(204).send();
  });

  const updateGoalsHandler = async (request: FastifyRequest, reply: FastifyReply) => {
    const { deviceId } = getProtectedOwner(request);

    const body = request.body;
    if (!isRecord(body)) {
      logDeviceGoalsValidationFailed(request.log, { fields: [], codes: ["invalid_body"] });
      return reply.code(400).send({ error: "Invalid request body" });
    }
    const validKeys = Object.keys(GOAL_TARGET_BOUNDS) as GoalTargetField[];
    const goals: Partial<Record<GoalTargetField, number>> = {};
    for (const key of validKeys) {
      if (key in body) {
        const raw = body[key];
        const bounds = GOAL_TARGET_BOUNDS[key];
        if (typeof raw !== "number" || !Number.isFinite(raw) || raw < bounds.min || raw > bounds.max) {
          logDeviceGoalsValidationFailed(request.log, { fields: [key], codes: ["invalid_field_value"] });
          return reply.code(400).send({ error: `Invalid value for ${key}: outside supported target range` });
        }
        goals[key] = raw;
      }
    }
    if (Object.keys(goals).length === 0) {
      logDeviceGoalsValidationFailed(request.log, { fields: [], codes: ["empty_valid_fields"] });
      return reply.code(400).send({ error: "Request must include at least one valid goal field (calories, protein, carbs, fat)" });
    }
    const current = await deviceService.getDevice(deviceId);
    if (!current) {
      return reply.code(404).send({ error: "Device not found" });
    }
    const candidateTargets: DailyTargets = {
      calories: goals.calories ?? current.dailyCalories,
      protein: goals.protein ?? current.dailyProtein,
      carbs: goals.carbs ?? current.dailyCarbs,
      fat: goals.fat ?? current.dailyFat,
    };
    const safetyCheck = checkNutritionSafetyTargets(candidateTargets);
    if (!safetyCheck.ok) {
      logDeviceGoalsValidationFailed(request.log, {
        fields: safetyCheck.fields,
        codes: [UNSAFE_CALORIE_FLOOR_REASON],
      });
      return reply.code(400).send({
        error: "Unsafe calorie target",
        reason: UNSAFE_CALORIE_FLOOR_REASON,
      });
    }
    if (isGoalMacroCaloriesOverAllocated(candidateTargets)) {
      const targetFields = Object.keys(candidateTargets) as Array<keyof DailyTargets>;
      logDeviceGoalsValidationFailed(request.log, {
        fields: targetFields,
        codes: ["macro_calorie_inconsistent"],
      });
      return reply.code(400).send({
        error: "Macro targets exceed calorie target",
        reason: "macro_calorie_inconsistent",
      });
    }
    const dailyTargets = await deviceService.updateGoals(deviceId, goals);
    logDeviceGoalsUpdatedRest(request.log, { updatedFields: Object.keys(goals) });
    return { dailyTargets };
  };

  // PATCH is the canonical partial-update entrypoint; PUT is a compatibility alias. Both routes intentionally share identical behavior.
  registerProtectedRoute(app, { deviceService, guestSessionService }, {
    method: "PATCH",
    url: "/api/device/goals",
    protectedMeta: PROTECTED_ROUTE_META.deviceGoalsPatch,
    handler: updateGoalsHandler,
  });
  registerProtectedRoute(app, { deviceService, guestSessionService }, {
    method: "PUT",
    url: "/api/device/goals",
    protectedMeta: PROTECTED_ROUTE_META.deviceGoalsPut,
    handler: updateGoalsHandler,
  });
}
