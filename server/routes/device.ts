import type { FastifyInstance, FastifyReply } from "fastify";
import type { createDeviceService, Goal, IntakeFields } from "../services/device.js";
import type { createGuestSessionService } from "../services/guest-session.js";
import type { createTargetGenerationService } from "../services/target-generation.js";
import { resolveGuestSession } from "../lib/guest-session-resolver.js";

interface Deps {
  deviceService: ReturnType<typeof createDeviceService>;
  guestSessionService: ReturnType<typeof createGuestSessionService>;
  targetGenerationService: ReturnType<typeof createTargetGenerationService>;
}

const VALID_GOALS = ["fat_loss", "muscle_gain"] as const;
const VALID_SEXES = ["male", "female"] as const;
const VALID_ACTIVITY_LEVELS = ["sedentary", "light", "moderate", "active", "very_active"] as const;
const VALID_TRAINING_FREQUENCIES = ["none", "1_2", "3_4", "5_plus"] as const;
const REQUIRED_INTAKE_KEYS = ["sex", "age", "heightCm", "weightKg", "activityLevel", "trainingFrequency"] as const;
const OPTIONAL_INTAKE_KEYS = ["allergies", "goalClarification", "bodyFatPercent", "tdee", "advancedNotes"] as const;
const INTAKE_KEYS = [...REQUIRED_INTAKE_KEYS, ...OPTIONAL_INTAKE_KEYS] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isGoal(value: unknown): value is Goal {
  return typeof value === "string" && VALID_GOALS.includes(value as Goal);
}

function hasAnyIntakeField(body: Record<string, unknown>): boolean {
  return INTAKE_KEYS.some((key) => key in body);
}

function hasAllRequiredIntakeFields(body: Record<string, unknown>): boolean {
  return REQUIRED_INTAKE_KEYS.every((key) => key in body);
}

function readRequiredString(body: Record<string, unknown>, key: (typeof REQUIRED_INTAKE_KEYS)[number]): string | null {
  return typeof body[key] === "string" ? (body[key] as string) : null;
}

function readOptionalString(body: Record<string, unknown>, key: (typeof OPTIONAL_INTAKE_KEYS)[number]): string | undefined | null {
  if (!(key in body)) return undefined;
  return typeof body[key] === "string" ? (body[key] as string) : null;
}

function readOptionalNumber(body: Record<string, unknown>, key: "bodyFatPercent" | "tdee"): number | undefined | null {
  if (!(key in body)) return undefined;
  return typeof body[key] === "number" && Number.isFinite(body[key]) ? (body[key] as number) : null;
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

function setGuestSessionCookies(
  reply: FastifyReply,
  guestSessionService: ReturnType<typeof createGuestSessionService>,
  deviceId: string,
) {
  reply.header("set-cookie", guestSessionService.issue(deviceId).cookies);
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

function buildIntake(body: Record<string, unknown>): IntakeFields | null {
  const sex = readRequiredString(body, "sex");
  const activityLevel = readRequiredString(body, "activityLevel");
  const trainingFrequency = readRequiredString(body, "trainingFrequency");
  const age = typeof body.age === "number" && Number.isFinite(body.age) ? body.age : null;
  const heightCm = typeof body.heightCm === "number" && Number.isFinite(body.heightCm) ? body.heightCm : null;
  const weightKg = typeof body.weightKg === "number" && Number.isFinite(body.weightKg) ? body.weightKg : null;
  const bodyFatPercent = readOptionalNumber(body, "bodyFatPercent");
  const tdee = readOptionalNumber(body, "tdee");

  if (
    sex === null ||
    activityLevel === null ||
    trainingFrequency === null ||
    age === null ||
    heightCm === null ||
    weightKg === null
  ) {
    return null;
  }

  if (!isAllowedSex(sex) || !isAllowedActivityLevel(activityLevel) || !isAllowedTrainingFrequency(trainingFrequency)) {
    return null;
  }

  if (!validateRange(age, 10, 120)) return null;
  if (!validateRange(heightCm, 50, 300)) return null;
  if (!validateRange(weightKg, 20, 500)) return null;
  if (bodyFatPercent !== undefined && (bodyFatPercent === null || !validateRange(bodyFatPercent, 2, 70))) {
    return null;
  }
  if (tdee !== undefined && (tdee === null || !validateRange(tdee, 500, 8000))) {
    return null;
  }

  const allergies = readOptionalString(body, "allergies");
  const goalClarification = readOptionalString(body, "goalClarification");
  const advancedNotes = readOptionalString(body, "advancedNotes");
  if (allergies === null || goalClarification === null || advancedNotes === null) {
    return null;
  }

  return {
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

    const { goal } = body;
    if (!isGoal(goal)) {
      return reply.code(400).send({ error: "Invalid goal. Must be fat_loss or muscle_gain." });
    }

    if (!hasAnyIntakeField(body)) {
      const result = await deviceService.createDevice(goal as Goal);
      setGuestSessionCookies(reply, guestSessionService, result.deviceId);
      return { ...result, coachExplanation: null };
    }

    if (!hasAllRequiredIntakeFields(body)) {
      return reply.code(400).send({ error: "Incomplete intake data" });
    }

    const intake = buildIntake(body);
    if (intake === null) {
      return reply.code(400).send({ error: "Invalid intake data" });
    }

    const { dailyTargets, coachExplanation } = await targetGenerationService.generateTargets(goal, intake);
    const result = await deviceService.createDevice(goal as Goal, intake, dailyTargets, coachExplanation);
    setGuestSessionCookies(reply, guestSessionService, result.deviceId);
    return { ...result, coachExplanation };
  });

  app.post("/api/device/session", async (request, reply) => {
    if (request.body !== undefined && !isRecord(request.body)) {
      return reply.code(400).send({ error: "Request body must be a JSON object." });
    }

    const body = isRecord(request.body) ? request.body : {};
    const { activeToken, resumeToken } = guestSessionService.readTokens(request.headers.cookie);

    const activeSession = guestSessionService.verifyActiveSession(activeToken);
    if (activeSession.ok) {
      const device = buildDeviceSessionResponse(await deviceService.getDevice(activeSession.deviceId));
      if (!device) {
        clearGuestSessionCookies(reply, guestSessionService);
        return reply.code(401).send({ error: "Invalid guest session" });
      }
      return { ...device, establishedBy: "active" as const };
    }

    const resumedSession = guestSessionService.resumeSession(resumeToken);
    if (resumedSession.ok) {
      const device = buildDeviceSessionResponse(await deviceService.getDevice(resumedSession.deviceId));
      if (!device) {
        clearGuestSessionCookies(reply, guestSessionService);
        return reply.code(401).send({ error: "Invalid guest session" });
      }
      reply.header("set-cookie", resumedSession.cookies);
      return { ...device, establishedBy: "resume" as const };
    }

    if ("legacyDeviceId" in body && typeof body.legacyDeviceId !== "string") {
      return reply.code(400).send({ error: "legacyDeviceId must be a string." });
    }

    const legacyDeviceId = typeof body.legacyDeviceId === "string" ? body.legacyDeviceId.trim() : "";
    if (!legacyDeviceId) {
      return reply.code(401).send({ error: "No guest session available" });
    }

    const device = buildDeviceSessionResponse(await deviceService.getDevice(legacyDeviceId));
    if (!device) {
      return reply.code(401).send({ error: "Invalid device ID" });
    }

    setGuestSessionCookies(reply, guestSessionService, device.deviceId);
    return { ...device, establishedBy: "legacy_migration" as const };
  });

  app.delete("/api/device/session", async (_request, reply) => {
    clearGuestSessionCookies(reply, guestSessionService);
    return reply.code(204).send();
  });

  app.put("/api/device/goals", async (request, reply) => {
    const session = await resolveGuestSession(request, { deviceService, guestSessionService });
    if (!session.ok) {
      if (session.clearCookies) {
        clearGuestSessionCookies(reply, guestSessionService);
      }
      return reply.code(401).send({ error: session.error });
    }
    const { deviceId } = session;
    if (session.setCookies) {
      reply.header("set-cookie", session.setCookies);
    }

    const body = request.body;
    if (!isRecord(body)) {
      return reply.code(400).send({ error: "Invalid request body" });
    }
    const validKeys = ["calories", "protein", "carbs", "fat"];
    const goals: Record<string, number> = {};
    for (const key of validKeys) {
      if (key in body) {
        const raw = body[key];
        if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) {
          return reply.code(400).send({ error: `Invalid value for ${key}: must be a non-negative number` });
        }
        goals[key] = raw;
      }
    }
    if (Object.keys(goals).length === 0) {
      return reply.code(400).send({ error: "Request must include at least one valid goal field (calories, protein, carbs, fat)" });
    }
    const dailyTargets = await deviceService.updateGoals(deviceId, goals);
    return { dailyTargets };
  });
}
