import type { FastifyBaseLogger } from "fastify";
import type { ProviderErrorMetadata } from "../llm/types.js";

export type RedactedObservabilityEventName =
  | "onboarding_submit_started"
  | "onboarding_validation_failed"
  | "onboarding_submit_succeeded"
  | "home_cta_intent_selected"
  | "home_cta_option_sent"
  | "chat_turn_completed"
  | "chat_route_fallback"
  | "device_goals_validation_failed"
  | "device_goals_updated_rest"
  | "sse_connection_state";

export type OnboardingSource = "server";
export type ChatTurnSource = "json" | "sse";
export type RouteFallbackSource = "orchestrator" | "route_hallucination" | "route_catch";
export type RouteFallbackReason =
  | "llm_error"
  | "partial_success"
  | "max_rounds"
  | "hallucination_detected"
  | "route_catch";
export type RouteCatchSite = "json_outer" | "sse_outer" | "sse_persist";
export type SseConnectionState = "opened" | "closed" | "rejected";

const INTAKE_FIELDS = [
  "goal",
  "goalClarification",
  "sex",
  "age",
  "heightCm",
  "weightKg",
  "activityLevel",
  "trainingFrequency",
  "allergies",
  "bodyFatPercent",
  "tdee",
  "advancedNotes",
] as const;
const GOAL_UPDATE_FIELDS = ["calories", "protein", "carbs", "fat"] as const;
const GOAL_VALIDATION_CODES = ["invalid_body", "invalid_field_value", "empty_valid_fields"] as const;

const INTAKE_FIELD_SET = new Set<string>(INTAKE_FIELDS);
const GOAL_UPDATE_FIELD_SET = new Set<string>(GOAL_UPDATE_FIELDS);
const GOAL_VALIDATION_CODE_SET = new Set<string>(GOAL_VALIDATION_CODES);
const VALID_IDENTIFIER = /^[a-z0-9_-]{1,64}$/;
const VALID_CODE = /^[A-Z0-9_]{1,64}$/;
const VALID_GOAL_VALIDATION_CODE = /^[a-z0-9_]{1,64}$/;
const SAFE_ROUTE_ERROR_TEXT = /^[A-Za-z0-9 .:_/-]+$/;
const ROUTE_ERROR_NAME_LIMIT = 80;
const ROUTE_ERROR_MESSAGE_LIMIT = 160;
const UNSAFE_ROUTE_ERROR_TERMS = [
  "prompt",
  "message",
  "messages",
  "user",
  "nutrition",
  "provider",
  "body",
  "header",
  "authorization",
  "bearer",
  "tool",
  "payload",
  "guest_session",
  "session",
  "cookie",
  "image",
  "data:image",
  "assistant",
  "final reply",
  "stack",
  "cause",
  "device",
  "upload",
] as const;

export type IntakeObservabilityField = (typeof INTAKE_FIELDS)[number];
export type GoalUpdateField = (typeof GOAL_UPDATE_FIELDS)[number];

export interface OnboardingSubmitStartedEvent {
  event: "onboarding_submit_started";
  source: OnboardingSource;
}

export interface OnboardingValidationFailedEvent {
  event: "onboarding_validation_failed";
  source: OnboardingSource;
  step: 1 | 2 | 3 | 4 | 5;
  fields: IntakeObservabilityField[];
  codes: string[];
}

export interface OnboardingSubmitSucceededEvent {
  event: "onboarding_submit_succeeded";
  usedTargetFallback: boolean;
}

export interface HomeCtaIntentSelectedEvent {
  event: "home_cta_intent_selected";
  intent: string;
}

export interface HomeCtaOptionSentEvent {
  event: "home_cta_option_sent";
  intent: string;
  promptKey: string;
}

export interface ChatTurnCompletedEvent {
  event: "chat_turn_completed";
  source: ChatTurnSource;
  turnId: string;
  didLogMeal: boolean;
  didMutateMeal: boolean;
  hadImage: boolean;
  latencyMs: number;
  stopped?: boolean;
  tokensStreamed?: number;
}

export interface ChatRouteFallbackEvent {
  event: "chat_route_fallback";
  source: ChatTurnSource;
  turnId: string;
  fallbackSource: RouteFallbackSource;
  didLogMeal: boolean;
  didMutateMeal: boolean;
  hadImage: boolean;
  latencyMs: number;
  reason?: RouteFallbackReason;
  catchSite?: RouteCatchSite;
  providerMetadata?: ProviderErrorMetadata;
  errorName?: string;
  errorMessage?: string;
  round?: number;
  lastTool?: string;
}

export interface DeviceGoalsUpdatedRestEvent {
  event: "device_goals_updated_rest";
  updatedFields: string[];
}

export interface DeviceGoalsValidationFailedEvent {
  event: "device_goals_validation_failed";
  fields: GoalUpdateField[];
  codes: string[];
}

export interface SseConnectionStateEvent {
  event: "sse_connection_state";
  state: SseConnectionState;
}

export type RedactedObservabilityEvent =
  | OnboardingSubmitStartedEvent
  | OnboardingValidationFailedEvent
  | OnboardingSubmitSucceededEvent
  | HomeCtaIntentSelectedEvent
  | HomeCtaOptionSentEvent
  | ChatTurnCompletedEvent
  | ChatRouteFallbackEvent
  | DeviceGoalsValidationFailedEvent
  | DeviceGoalsUpdatedRestEvent
  | SseConnectionStateEvent;

export type HomeCtaClientEvent = HomeCtaIntentSelectedEvent | HomeCtaOptionSentEvent;

export type ParseHomeCtaClientEventResult =
  | { ok: true; event: HomeCtaClientEvent }
  | { ok: false; error: "Invalid client event" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function uniqueSorted(values: string[]) {
  return [...new Set(values)].sort();
}

function sanitizeFields(fields: readonly string[]): IntakeObservabilityField[] {
  return uniqueSorted(fields.filter((field) => INTAKE_FIELD_SET.has(field))) as IntakeObservabilityField[];
}

function sanitizeCodes(codes: readonly string[]): string[] {
  return uniqueSorted(codes.filter((code) => VALID_CODE.test(code)));
}

function sanitizeUpdatedFields(fields: readonly string[]): string[] {
  return uniqueSorted(fields.filter((field) => GOAL_UPDATE_FIELD_SET.has(field)));
}

function sanitizeGoalUpdateFields(fields: readonly string[]): GoalUpdateField[] {
  return uniqueSorted(fields.filter((field) => GOAL_UPDATE_FIELD_SET.has(field))) as GoalUpdateField[];
}

function sanitizeGoalValidationCodes(codes: readonly string[]): string[] {
  return uniqueSorted(
    codes.filter((code) => VALID_GOAL_VALIDATION_CODE.test(code) && GOAL_VALIDATION_CODE_SET.has(code)),
  );
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && VALID_IDENTIFIER.test(value);
}

function sanitizeProviderMetadata(metadata: ProviderErrorMetadata): ProviderErrorMetadata {
  return {
    provider: metadata.provider,
    operation: metadata.operation,
    model: metadata.model,
    aborted: metadata.aborted,
    ...(metadata.status !== undefined ? { status: metadata.status } : {}),
    ...(metadata.providerRequestId !== undefined ? { providerRequestId: metadata.providerRequestId } : {}),
    ...(metadata.errorName !== undefined ? { errorName: metadata.errorName } : {}),
    ...(metadata.errorType !== undefined ? { errorType: metadata.errorType } : {}),
    ...(metadata.errorCode !== undefined ? { errorCode: metadata.errorCode } : {}),
  };
}

function sanitizeRouteErrorText(value: string, limit: number): string | undefined {
  const text = value.slice(0, limit).trim();
  if (!text || !SAFE_ROUTE_ERROR_TEXT.test(text)) {
    return undefined;
  }
  const lower = text.toLowerCase();
  if (UNSAFE_ROUTE_ERROR_TERMS.some((term) => lower.includes(term))) {
    return undefined;
  }
  return text;
}

function logRedactedEvent(log: FastifyBaseLogger, payload: RedactedObservabilityEvent, message: string) {
  log.info(payload, message);
}

export function buildOnboardingSubmitStartedEvent(params: {
  source: OnboardingSource;
}): OnboardingSubmitStartedEvent {
  return {
    event: "onboarding_submit_started",
    source: params.source,
  };
}

export function logOnboardingSubmitStarted(
  log: FastifyBaseLogger,
  params: Parameters<typeof buildOnboardingSubmitStartedEvent>[0],
) {
  logRedactedEvent(log, buildOnboardingSubmitStartedEvent(params), "Onboarding submit started");
}

export function buildOnboardingValidationFailedEvent(params: {
  source: OnboardingSource;
  step: 1 | 2 | 3 | 4 | 5;
  fields: readonly string[];
  codes: readonly string[];
}): OnboardingValidationFailedEvent {
  return {
    event: "onboarding_validation_failed",
    source: params.source,
    step: params.step,
    fields: sanitizeFields(params.fields),
    codes: sanitizeCodes(params.codes),
  };
}

export function logOnboardingValidationFailed(
  log: FastifyBaseLogger,
  params: Parameters<typeof buildOnboardingValidationFailedEvent>[0],
) {
  logRedactedEvent(log, buildOnboardingValidationFailedEvent(params), "Onboarding validation failed");
}

export function buildOnboardingSubmitSucceededEvent(params: {
  usedTargetFallback: boolean;
}): OnboardingSubmitSucceededEvent {
  return {
    event: "onboarding_submit_succeeded",
    usedTargetFallback: params.usedTargetFallback,
  };
}

export function logOnboardingSubmitSucceeded(
  log: FastifyBaseLogger,
  params: Parameters<typeof buildOnboardingSubmitSucceededEvent>[0],
) {
  logRedactedEvent(log, buildOnboardingSubmitSucceededEvent(params), "Onboarding submit succeeded");
}

export function buildHomeCtaIntentSelectedEvent(params: {
  intent: string;
}): HomeCtaIntentSelectedEvent {
  return {
    event: "home_cta_intent_selected",
    intent: params.intent,
  };
}

export function logHomeCtaIntentSelected(
  log: FastifyBaseLogger,
  params: Parameters<typeof buildHomeCtaIntentSelectedEvent>[0],
) {
  logRedactedEvent(log, buildHomeCtaIntentSelectedEvent(params), "Home CTA intent selected");
}

export function buildHomeCtaOptionSentEvent(params: {
  intent: string;
  promptKey: string;
}): HomeCtaOptionSentEvent {
  return {
    event: "home_cta_option_sent",
    intent: params.intent,
    promptKey: params.promptKey,
  };
}

export function logHomeCtaOptionSent(
  log: FastifyBaseLogger,
  params: Parameters<typeof buildHomeCtaOptionSentEvent>[0],
) {
  logRedactedEvent(log, buildHomeCtaOptionSentEvent(params), "Home CTA option sent");
}

export function buildChatTurnCompletedEvent(params: {
  source: ChatTurnSource;
  turnId: string;
  didLogMeal: boolean;
  didMutateMeal: boolean;
  hadImage: boolean;
  latencyMs: number;
  stopped?: boolean;
  tokensStreamed?: number;
}): ChatTurnCompletedEvent {
  return {
    event: "chat_turn_completed",
    source: params.source,
    turnId: params.turnId,
    didLogMeal: params.didLogMeal,
    didMutateMeal: params.didMutateMeal,
    hadImage: params.hadImage,
    latencyMs: Math.max(0, Math.round(params.latencyMs)),
    ...(params.stopped !== undefined ? { stopped: params.stopped } : {}),
    ...(params.tokensStreamed !== undefined
      ? { tokensStreamed: Math.max(0, Math.round(params.tokensStreamed)) }
      : {}),
  };
}

export function logChatTurnCompleted(
  log: FastifyBaseLogger,
  params: Parameters<typeof buildChatTurnCompletedEvent>[0],
) {
  logRedactedEvent(log, buildChatTurnCompletedEvent(params), "Chat turn completed");
}

export function buildChatRouteFallbackEvent(params: {
  source: ChatTurnSource;
  turnId: string;
  fallbackSource: RouteFallbackSource;
  didLogMeal: boolean;
  didMutateMeal: boolean;
  hadImage: boolean;
  latencyMs: number;
  reason?: RouteFallbackReason;
  catchSite?: RouteCatchSite;
  providerMetadata?: ProviderErrorMetadata;
  errorName?: string;
  errorMessage?: string;
  round?: number;
  lastTool?: string;
}): ChatRouteFallbackEvent {
  return {
    event: "chat_route_fallback",
    source: params.source,
    turnId: params.turnId,
    fallbackSource: params.fallbackSource,
    didLogMeal: params.didLogMeal,
    didMutateMeal: params.didMutateMeal,
    hadImage: params.hadImage,
    latencyMs: Math.max(0, Math.round(params.latencyMs)),
    ...(params.reason !== undefined ? { reason: params.reason } : {}),
    ...(params.catchSite !== undefined ? { catchSite: params.catchSite } : {}),
    ...(params.providerMetadata !== undefined
      ? { providerMetadata: sanitizeProviderMetadata(params.providerMetadata) }
      : {}),
    ...(params.errorName !== undefined ? { errorName: params.errorName } : {}),
    ...(params.errorMessage !== undefined ? { errorMessage: params.errorMessage } : {}),
    ...(params.round !== undefined ? { round: Math.max(0, Math.round(params.round)) } : {}),
    ...(params.lastTool !== undefined ? { lastTool: params.lastTool } : {}),
  };
}

export function logChatRouteFallback(
  log: FastifyBaseLogger,
  params: Parameters<typeof buildChatRouteFallbackEvent>[0],
) {
  logRedactedEvent(log, buildChatRouteFallbackEvent(params), "Chat route fallback");
}

export function sanitizeRouteCatchError(
  error: unknown,
): Pick<ChatRouteFallbackEvent, "errorName" | "errorMessage"> {
  if (!(error instanceof Error)) {
    return {};
  }

  const errorMessage = sanitizeRouteErrorText(error.message, ROUTE_ERROR_MESSAGE_LIMIT);
  if (!errorMessage) {
    return {};
  }

  const errorName = sanitizeRouteErrorText(error.name, ROUTE_ERROR_NAME_LIMIT);
  return {
    ...(errorName !== undefined ? { errorName } : {}),
    errorMessage,
  };
}

export function buildDeviceGoalsValidationFailedEvent(params: {
  fields: readonly string[];
  codes: readonly string[];
}): DeviceGoalsValidationFailedEvent {
  return {
    event: "device_goals_validation_failed",
    fields: sanitizeGoalUpdateFields(params.fields),
    codes: sanitizeGoalValidationCodes(params.codes),
  };
}

export function logDeviceGoalsValidationFailed(
  log: FastifyBaseLogger,
  params: Parameters<typeof buildDeviceGoalsValidationFailedEvent>[0],
) {
  logRedactedEvent(log, buildDeviceGoalsValidationFailedEvent(params), "Device goals validation failed");
}

export function buildDeviceGoalsUpdatedRestEvent(params: {
  updatedFields: readonly string[];
}): DeviceGoalsUpdatedRestEvent {
  return {
    event: "device_goals_updated_rest",
    updatedFields: sanitizeUpdatedFields(params.updatedFields),
  };
}

export function logDeviceGoalsUpdatedRest(
  log: FastifyBaseLogger,
  params: Parameters<typeof buildDeviceGoalsUpdatedRestEvent>[0],
) {
  logRedactedEvent(log, buildDeviceGoalsUpdatedRestEvent(params), "Device goals updated via REST");
}

export function buildSseConnectionStateEvent(params: {
  state: SseConnectionState;
}): SseConnectionStateEvent {
  return {
    event: "sse_connection_state",
    state: params.state,
  };
}

export function logSseConnectionState(
  log: FastifyBaseLogger,
  params: Parameters<typeof buildSseConnectionStateEvent>[0],
) {
  logRedactedEvent(log, buildSseConnectionStateEvent(params), "SSE connection state");
}

export function parseHomeCtaClientEvent(body: unknown): ParseHomeCtaClientEventResult {
  if (!isRecord(body) || typeof body.event !== "string") {
    return { ok: false, error: "Invalid client event" };
  }

  if (body.event === "home_cta_intent_selected") {
    if (!isIdentifier(body.intent)) {
      return { ok: false, error: "Invalid client event" };
    }
    return {
      ok: true,
      event: buildHomeCtaIntentSelectedEvent({ intent: body.intent }),
    };
  }

  if (body.event === "home_cta_option_sent") {
    if (!isIdentifier(body.intent) || !isIdentifier(body.promptKey)) {
      return { ok: false, error: "Invalid client event" };
    }
    return {
      ok: true,
      event: buildHomeCtaOptionSentEvent({ intent: body.intent, promptKey: body.promptKey }),
    };
  }

  return { ok: false, error: "Invalid client event" };
}
