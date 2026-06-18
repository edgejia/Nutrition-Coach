import type { FastifyBaseLogger } from "fastify";
import type {
  ProviderErrorMetadata,
  ProviderOperation,
  StructuredOutputFailureReason,
  StructuredOutputNoContentSubtype,
} from "../llm/types.js";
import {
  sanitizeRouteFallbackCatchField,
  sanitizeRouteFallbackCatchFields,
} from "./route-fallback-redaction.js";

export type RedactedObservabilityEventName =
  | "onboarding_submit_started"
  | "onboarding_validation_failed"
  | "onboarding_submit_succeeded"
  | "target_generation_attempt_failed"
  | "target_generation_fallback_used"
  | "home_cta_intent_selected"
  | "home_cta_option_sent"
  | "chat_turn_completed"
  | "chat_route_fallback"
  | "mutation_receipt_guard_tripped"
  | "ownership_bypass_blocked"
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
export type TargetGenerationTargetReason =
  | "provider_error"
  | "invalid_json"
  | "no_content"
  | "missing_field"
  | "schema_validation"
  | "bounds_failed"
  | "macro_calorie_mismatch";
export type TargetGenerationField = "calories" | "protein" | "carbs" | "fat" | "coachExplanation" | "root";

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
const OWNERSHIP_BYPASS_BLOCKED_REASONS = ["legacy_device_id_rejected", "raw_device_id_param"] as const;
const OWNERSHIP_BYPASS_BLOCKED_ROUTES = [
  "api_device_session",
  "api_proposals_actions",
  "api_chat_stop",
  "api_chat",
] as const;
const OWNERSHIP_BYPASS_BLOCKED_OPERATIONS = [
  "legacy_session_bootstrap",
  "proposal_action",
  "chat_stop",
  "chat_message",
] as const;
const MUTATION_RECEIPT_GUARD_OPERATIONS = ["orchestrator_receipt", "proposal_action"] as const;
const MUTATION_RECEIPT_GUARD_VERBS = ["log", "update", "delete", "goals"] as const;
const TARGET_GENERATION_FIELDS = ["calories", "protein", "carbs", "fat", "coachExplanation", "root"] as const;
const TARGET_GENERATION_NO_CONTENT_SUBTYPES = ["no_choices", "missing_content", "empty_content"] as const;

const INTAKE_FIELD_SET = new Set<string>(INTAKE_FIELDS);
const GOAL_UPDATE_FIELD_SET = new Set<string>(GOAL_UPDATE_FIELDS);
const GOAL_VALIDATION_CODE_SET = new Set<string>(GOAL_VALIDATION_CODES);
const OWNERSHIP_BYPASS_BLOCKED_REASON_SET = new Set<string>(OWNERSHIP_BYPASS_BLOCKED_REASONS);
const OWNERSHIP_BYPASS_BLOCKED_ROUTE_SET = new Set<string>(OWNERSHIP_BYPASS_BLOCKED_ROUTES);
const OWNERSHIP_BYPASS_BLOCKED_OPERATION_SET = new Set<string>(OWNERSHIP_BYPASS_BLOCKED_OPERATIONS);
const MUTATION_RECEIPT_GUARD_OPERATION_SET = new Set<string>(MUTATION_RECEIPT_GUARD_OPERATIONS);
const MUTATION_RECEIPT_GUARD_VERB_SET = new Set<string>(MUTATION_RECEIPT_GUARD_VERBS);
const TARGET_GENERATION_FIELD_SET = new Set<string>(TARGET_GENERATION_FIELDS);
const TARGET_GENERATION_NO_CONTENT_SUBTYPE_SET = new Set<string>(TARGET_GENERATION_NO_CONTENT_SUBTYPES);
const VALID_IDENTIFIER = /^[a-z0-9_-]{1,64}$/;
const VALID_CODE = /^[A-Z0-9_]{1,64}$/;
const VALID_GOAL_VALIDATION_CODE = /^[a-z0-9_]{1,64}$/;
const VALID_TARGET_GENERATION_CODE = /^[a-z0-9_]{1,64}$/;
const ROUTE_ERROR_NAME_LIMIT = 80;
const ROUTE_ERROR_MESSAGE_LIMIT = 160;
const UNSAFE_PROVIDER_METADATA_LABEL_FRAGMENTS = [
  "authorization",
  "bearer",
  "cookie",
  "data:image",
  "device",
  "guest_session",
  "message",
  "prompt",
  "provider",
  "raw",
  "secret",
  "sk-",
  "token",
  "upload",
] as const;
export type IntakeObservabilityField = (typeof INTAKE_FIELDS)[number];
export type GoalUpdateField = (typeof GOAL_UPDATE_FIELDS)[number];
export type OwnershipBypassBlockedReason = (typeof OWNERSHIP_BYPASS_BLOCKED_REASONS)[number];
export type OwnershipBypassBlockedRoute = (typeof OWNERSHIP_BYPASS_BLOCKED_ROUTES)[number];
export type OwnershipBypassBlockedOperation = (typeof OWNERSHIP_BYPASS_BLOCKED_OPERATIONS)[number];
export type MutationReceiptGuardOperation = (typeof MUTATION_RECEIPT_GUARD_OPERATIONS)[number];
export type MutationReceiptGuardVerb = (typeof MUTATION_RECEIPT_GUARD_VERBS)[number];

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

export interface TargetGenerationAttemptFailedEvent {
  event: "target_generation_attempt_failed";
  attempt: number;
  providerReason: StructuredOutputFailureReason;
  targetReason: TargetGenerationTargetReason;
  metadataContext: string;
  issueCount?: number;
  fields?: TargetGenerationField[];
  codes?: string[];
  noContentSubtype?: StructuredOutputNoContentSubtype;
}

export interface TargetGenerationFallbackUsedEvent {
  event: "target_generation_fallback_used";
  attempt: number;
  providerReason: StructuredOutputFailureReason;
  targetReason: TargetGenerationTargetReason;
  metadataContext: string;
  issueCount?: number;
  fields?: TargetGenerationField[];
  codes?: string[];
  noContentSubtype?: StructuredOutputNoContentSubtype;
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

export interface OwnershipBypassBlockedEvent {
  event: "ownership_bypass_blocked";
  reason: OwnershipBypassBlockedReason;
  route: OwnershipBypassBlockedRoute;
  operation: OwnershipBypassBlockedOperation;
  requestId: string;
  turnId?: string;
}

export interface MutationReceiptGuardTrippedEvent {
  event: "mutation_receipt_guard_tripped";
  operation: MutationReceiptGuardOperation;
  verb: MutationReceiptGuardVerb;
  requestId?: string;
  turnId?: string;
}

export interface SseConnectionStateEvent {
  event: "sse_connection_state";
  state: SseConnectionState;
}

export type RedactedObservabilityEvent =
  | OnboardingSubmitStartedEvent
  | OnboardingValidationFailedEvent
  | OnboardingSubmitSucceededEvent
  | TargetGenerationAttemptFailedEvent
  | TargetGenerationFallbackUsedEvent
  | HomeCtaIntentSelectedEvent
  | HomeCtaOptionSentEvent
  | ChatTurnCompletedEvent
  | ChatRouteFallbackEvent
  | MutationReceiptGuardTrippedEvent
  | OwnershipBypassBlockedEvent
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

function sanitizeTargetGenerationFields(fields: readonly string[]): TargetGenerationField[] {
  return uniqueSorted(fields.filter((field) => TARGET_GENERATION_FIELD_SET.has(field))) as TargetGenerationField[];
}

function sanitizeTargetGenerationCodes(codes: readonly string[]): string[] {
  return uniqueSorted(codes.filter((code) => VALID_TARGET_GENERATION_CODE.test(code)));
}

function sanitizeNoContentSubtype(value: unknown): StructuredOutputNoContentSubtype | undefined {
  return typeof value === "string" && TARGET_GENERATION_NO_CONTENT_SUBTYPE_SET.has(value)
    ? value as StructuredOutputNoContentSubtype
    : undefined;
}

function sanitizeOwnershipBypassBlockedReason(value: unknown): OwnershipBypassBlockedReason {
  return typeof value === "string" && OWNERSHIP_BYPASS_BLOCKED_REASON_SET.has(value)
    ? value as OwnershipBypassBlockedReason
    : "raw_device_id_param";
}

function sanitizeOwnershipBypassBlockedRoute(value: unknown): OwnershipBypassBlockedRoute {
  return typeof value === "string" && OWNERSHIP_BYPASS_BLOCKED_ROUTE_SET.has(value)
    ? value as OwnershipBypassBlockedRoute
    : "api_device_session";
}

function sanitizeOwnershipBypassBlockedOperation(value: unknown): OwnershipBypassBlockedOperation {
  return typeof value === "string" && OWNERSHIP_BYPASS_BLOCKED_OPERATION_SET.has(value)
    ? value as OwnershipBypassBlockedOperation
    : "legacy_session_bootstrap";
}

function sanitizeMutationReceiptGuardOperation(value: unknown): MutationReceiptGuardOperation {
  return typeof value === "string" && MUTATION_RECEIPT_GUARD_OPERATION_SET.has(value)
    ? value as MutationReceiptGuardOperation
    : "orchestrator_receipt";
}

function sanitizeMutationReceiptGuardVerb(value: unknown): MutationReceiptGuardVerb {
  return typeof value === "string" && MUTATION_RECEIPT_GUARD_VERB_SET.has(value)
    ? value as MutationReceiptGuardVerb
    : "log";
}

function sanitizeCorrelationIdentifier(value: unknown): string {
  return isIdentifier(value) ? value : "redacted";
}

function sanitizeIssueCount(issueCount: number | undefined): number | undefined {
  if (typeof issueCount !== "number" || !Number.isFinite(issueCount)) {
    return undefined;
  }
  return Math.max(0, Math.round(issueCount));
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && VALID_IDENTIFIER.test(value);
}

const SAFE_PROVIDER_OPERATIONS = new Set<ProviderOperation>([
  "chat",
  "chat_round_initial",
  "chat_round_stream_continuation",
  "chat_stream_initial",
  "chat_stream_continuation",
]);

function sanitizeProviderOperation(operation: ProviderErrorMetadata["operation"]): ProviderOperation {
  return SAFE_PROVIDER_OPERATIONS.has(operation) ? operation : "chat";
}

function sanitizeProviderMetadataLabel(value: string): string {
  const normalized = value.toLowerCase();
  if (
    !/^[A-Za-z0-9_.:-]+$/.test(value)
    || UNSAFE_PROVIDER_METADATA_LABEL_FRAGMENTS.some((fragment) => normalized.includes(fragment))
  ) {
    return "redacted";
  }
  return value;
}

function sanitizeProviderMetadata(metadata: ProviderErrorMetadata): ProviderErrorMetadata {
  const sanitized: ProviderErrorMetadata = {
    provider: "openai",
    operation: sanitizeProviderOperation(metadata.operation),
    model: sanitizeProviderMetadataLabel(metadata.model),
    aborted: metadata.aborted,
  };

  if (typeof metadata.status === "number") {
    sanitized.status = metadata.status;
  }
  if (metadata.providerRequestId !== undefined) {
    sanitized.providerRequestId = sanitizeProviderMetadataLabel(metadata.providerRequestId);
  }
  if (metadata.errorName !== undefined) {
    sanitized.errorName = sanitizeProviderMetadataLabel(metadata.errorName);
  }
  if (metadata.errorType !== undefined) {
    sanitized.errorType = sanitizeProviderMetadataLabel(metadata.errorType);
  }
  if (metadata.errorCode !== undefined) {
    sanitized.errorCode = sanitizeProviderMetadataLabel(metadata.errorCode);
  }

  return sanitized;
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

export function buildTargetGenerationAttemptFailedEvent(params: {
  attempt: number;
  providerReason: StructuredOutputFailureReason;
  targetReason: TargetGenerationTargetReason;
  metadataContext: string;
  issueCount?: number;
  fields?: readonly string[];
  codes?: readonly string[];
  noContentSubtype?: unknown;
}): TargetGenerationAttemptFailedEvent {
  const fields = sanitizeTargetGenerationFields(params.fields ?? []);
  const codes = sanitizeTargetGenerationCodes(params.codes ?? []);
  const issueCount = sanitizeIssueCount(params.issueCount);
  const noContentSubtype = sanitizeNoContentSubtype(params.noContentSubtype);

  return {
    event: "target_generation_attempt_failed",
    attempt: Math.max(1, Math.round(params.attempt)),
    providerReason: params.providerReason,
    targetReason: params.targetReason,
    metadataContext: isIdentifier(params.metadataContext) ? params.metadataContext : "redacted",
    ...(issueCount !== undefined ? { issueCount } : {}),
    ...(fields.length > 0 ? { fields } : {}),
    ...(codes.length > 0 ? { codes } : {}),
    ...(noContentSubtype !== undefined ? { noContentSubtype } : {}),
  };
}

export function logTargetGenerationAttemptFailed(
  log: FastifyBaseLogger,
  params: Parameters<typeof buildTargetGenerationAttemptFailedEvent>[0],
) {
  logRedactedEvent(log, buildTargetGenerationAttemptFailedEvent(params), "Target generation attempt failed");
}

export function buildTargetGenerationFallbackUsedEvent(params: {
  attempt: number;
  providerReason: StructuredOutputFailureReason;
  targetReason: TargetGenerationTargetReason;
  metadataContext: string;
  issueCount?: number;
  fields?: readonly string[];
  codes?: readonly string[];
  noContentSubtype?: unknown;
}): TargetGenerationFallbackUsedEvent {
  const failed = buildTargetGenerationAttemptFailedEvent(params);
  return {
    ...failed,
    event: "target_generation_fallback_used",
  };
}

export function logTargetGenerationFallbackUsed(
  log: FastifyBaseLogger,
  params: Parameters<typeof buildTargetGenerationFallbackUsedEvent>[0],
) {
  logRedactedEvent(log, buildTargetGenerationFallbackUsedEvent(params), "Target generation fallback used");
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
  const catchFields = sanitizeRouteFallbackCatchFields({
    errorName: params.errorName,
    errorMessage: params.errorMessage,
  });

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
    ...catchFields,
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

export function buildMutationReceiptGuardTrippedEvent(params: {
  operation: MutationReceiptGuardOperation;
  verb: MutationReceiptGuardVerb;
  requestId?: string;
  turnId?: string;
}): MutationReceiptGuardTrippedEvent {
  return {
    event: "mutation_receipt_guard_tripped",
    operation: sanitizeMutationReceiptGuardOperation(params.operation),
    verb: sanitizeMutationReceiptGuardVerb(params.verb),
    ...(params.requestId !== undefined ? { requestId: sanitizeCorrelationIdentifier(params.requestId) } : {}),
    ...(params.turnId !== undefined ? { turnId: sanitizeCorrelationIdentifier(params.turnId) } : {}),
  };
}

export function logMutationReceiptGuardTripped(
  log: FastifyBaseLogger,
  params: Parameters<typeof buildMutationReceiptGuardTrippedEvent>[0],
) {
  logRedactedEvent(log, buildMutationReceiptGuardTrippedEvent(params), "Mutation receipt guard tripped");
}

export function buildOwnershipBypassBlockedEvent(params: {
  reason: OwnershipBypassBlockedReason;
  route: OwnershipBypassBlockedRoute;
  operation: OwnershipBypassBlockedOperation;
  requestId: string;
  turnId?: string;
}): OwnershipBypassBlockedEvent {
  return {
    event: "ownership_bypass_blocked",
    reason: sanitizeOwnershipBypassBlockedReason(params.reason),
    route: sanitizeOwnershipBypassBlockedRoute(params.route),
    operation: sanitizeOwnershipBypassBlockedOperation(params.operation),
    requestId: sanitizeCorrelationIdentifier(params.requestId),
    ...(params.turnId !== undefined ? { turnId: sanitizeCorrelationIdentifier(params.turnId) } : {}),
  };
}

export function logOwnershipBypassBlocked(
  log: FastifyBaseLogger,
  params: Parameters<typeof buildOwnershipBypassBlockedEvent>[0],
) {
  logRedactedEvent(log, buildOwnershipBypassBlockedEvent(params), "Ownership bypass blocked");
}

export function sanitizeRouteCatchError(
  error: unknown,
): Pick<ChatRouteFallbackEvent, "errorName" | "errorMessage"> {
  if (!(error instanceof Error)) {
    return {};
  }

  const errorMessage = sanitizeRouteFallbackCatchField(error.message, ROUTE_ERROR_MESSAGE_LIMIT);
  if (!errorMessage) {
    return {};
  }

  return sanitizeRouteFallbackCatchFields({
    errorName: error.name,
    errorMessage,
  });
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
