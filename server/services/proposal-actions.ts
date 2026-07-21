import type { RealtimePublisher } from "../realtime/publisher.js";
import type { FastifyBaseLogger } from "fastify";
import type { AppDatabase } from "../db/client.js";
import {
  isMealMutationKind,
  mutationOutcomeFactFromEffects,
  type CommittedMealFacts,
  type DeletedMealSnapshot,
  type MutationEffects,
} from "../orchestrator/mutation-effects.js";
import {
  renderGoalCancelCopy,
  renderMealDeleteCancelCopy,
  renderMealNumericCancelCopy,
  renderProposalAlreadyProcessedCopy,
  renderProposalActionEventCopy,
  renderProposalInactiveCopy,
  renderProposalRecoverableFailureCopy,
  renderGuardedMutationReceipt,
  renderUnsafeCalorieFloorCopy,
} from "../orchestrator/mutation-receipts.js";
import { checkNutritionSafetyTargets } from "../orchestrator/nutrition-safety-policy.js";
import { hasReasonableGoalMacroCalories } from "../orchestrator/goal-adjustment-policy.js";
import { currentAppDate, formatLocalDate } from "../lib/time.js";
import { MealRevisionPreconditionError } from "./meal-transactions.js";
import type { ChatMutationOutcomeFact } from "./chat-mutation-outcomes.js";
import type { createChatService } from "./chat.js";
import type { createDeviceService, DailyTargets } from "./device.js";
import {
  goalProposalTargetSignature,
  type createGoalProposalService,
  type GoalProposalPayload,
} from "./goal-proposals.js";
import type { createMealCorrectionService } from "./meal-correction.js";
import type {
  createMealNumericProposalService,
  MealNumericProposalPayload,
} from "./meal-numeric-proposals.js";
import type {
  createMealDeleteProposalService,
  MealDeleteProposalPayload,
} from "./meal-delete-proposals.js";
import {
  projectProposalActionEventForClient,
  projectProposalCardForClient,
  proposalKindToLane,
  type ProposalActionEventClientMetadata,
  type ProposalCardClientMetadata,
  type ProposalCardMetadata,
  type ProposalKind,
} from "./proposal-cards.js";
import type { createProposalCardService } from "./proposal-cards.js";
import type { DailySummary } from "./summary.js";
import type { SummaryOutcome } from "./summary-outcome.js";
import { dailySummaryFromOutcome } from "./summary-outcome.js";
import { DEFAULT_SESSION_ID, type SyncTransactionClient } from "./turn-state.js";

export type ProposalActionRequestKind = ProposalKind;
export type ProposalActionRequestAction = "approve" | "reject";

export interface ProposalActionServiceInput {
  deviceId: string;
  proposalId: string;
  kind: ProposalActionRequestKind;
  action: ProposalActionRequestAction;
  actionMessageId?: string;
}

export interface ProposalEditContextValidationInput {
  deviceId: string;
  proposalId: string;
  kind: ProposalActionRequestKind;
}

export interface ProposalActionTestHooks {
  beforeDecision?: (input: ProposalActionServiceInput) => void | Promise<void>;
  afterDomainMutation?: (input: {
    deviceId: string;
    proposalId: string;
    kind: ProposalActionRequestKind;
    action: ProposalActionRequestAction;
  }) => void;
}

export type ProposalActionServiceResult =
  | {
      ok: true;
      status: "approved" | "rejected";
      proposalCard: ProposalCardClientMetadata;
      proposalActionEvent: ProposalActionEventClientMetadata;
      didMutateMeal: boolean;
      reply?: string;
      mutationOutcomeFact?: ChatMutationOutcomeFact;
      dailyTargets?: DailyTargets;
      updatedMeal?: unknown;
      deletedMealId?: string;
      affectedDate?: string;
      summaryOutcome?: SummaryOutcome;
      dailySummary?: DailySummary;
    }
  | {
      ok: false;
      status: "stale";
      proposalCard?: ProposalCardClientMetadata;
      didMutateMeal: false;
      reply?: string;
    }
  | {
      ok: false;
      status: "retryable";
      proposalCard?: ProposalCardClientMetadata;
      didMutateMeal: false;
      reply: string;
    }
  | {
      ok: false;
      status: "idempotent";
      proposalCard?: ProposalCardClientMetadata;
      didMutateMeal: false;
      reply: string;
    };

interface ProposalActionDeps {
  db: AppDatabase;
  chatService: ReturnType<typeof createChatService>;
  proposalCardService: ReturnType<typeof createProposalCardService>;
  goalProposalService: ReturnType<typeof createGoalProposalService>;
  mealNumericProposalService: ReturnType<typeof createMealNumericProposalService>;
  mealDeleteProposalService: ReturnType<typeof createMealDeleteProposalService>;
  mealCorrectionService: ReturnType<typeof createMealCorrectionService>;
  deviceService: ReturnType<typeof createDeviceService>;
  publisher: RealtimePublisher;
  log?: FastifyBaseLogger;
  testHooks?: ProposalActionTestHooks;
}

type PostCommitPublish =
  | { type: "goals_update"; targets: DailyTargets }
  | {
      type: "daily_summary";
      summary: DailySummary;
      affectedDate: string;
    };

interface DurableDecision<T extends ProposalActionServiceResult = ProposalActionServiceResult> {
  result: T;
  publish?: PostCommitPublish;
  postCommitSummary?: { affectedDate: string };
}

function activeKindMatches(input: {
  kind: ProposalActionRequestKind;
  proposal?: GoalProposalPayload | MealNumericProposalPayload | MealDeleteProposalPayload;
}): boolean {
  if (!input.proposal) {
    return false;
  }
  if (input.kind === "meal_estimate") {
    return "provenance" in input.proposal && input.proposal.provenance === "model_estimate";
  }
  if (input.kind === "meal_numeric") {
    return "affectedFields" in input.proposal && input.proposal.provenance !== "model_estimate";
  }
  if (input.kind === "meal_delete") {
    return "snapshot" in input.proposal;
  }
  return "targets" in input.proposal;
}

function activeProposalIdMatches(
  proposal: GoalProposalPayload | MealNumericProposalPayload | MealDeleteProposalPayload | undefined,
  proposalId: string,
): boolean {
  return proposal?.proposalId === proposalId;
}

export function createProposalActionService(deps: ProposalActionDeps) {
  function runDurableDecision<T extends ProposalActionServiceResult>(
    fn: (client: SyncTransactionClient) => DurableDecision<T>,
  ): DurableDecision<T> {
    deps.db.$client.prepare("BEGIN IMMEDIATE").run();
    let transactionOpen = true;
    try {
      const decision = fn(deps.db.$client);
      deps.db.$client.prepare("COMMIT").run();
      transactionOpen = false;
      return decision;
    } catch (error) {
      if (transactionOpen) {
        deps.db.$client.prepare("ROLLBACK").run();
      }
      throw error;
    }
  }

  function publishAfterCommit(publish: PostCommitPublish | undefined, deviceId: string): void {
    if (!publish) {
      return;
    }
    if (publish.type === "goals_update") {
      deps.publisher.publishGoalsUpdate(deviceId, publish.targets);
      return;
    }
    deps.publisher.publishDailySummary(deviceId, {
      summary: publish.summary,
      affectedDate: publish.affectedDate,
      source: "meal_mutation",
    });
  }

  async function getCommittedTargets(deviceId: string): Promise<DailyTargets> {
    const device = await deps.deviceService.getDevice(deviceId);
    if (!device) {
      throw new Error("proposal action completed without device targets");
    }
    return {
      calories: device.dailyCalories,
      protein: device.dailyProtein,
      carbs: device.dailyCarbs,
      fat: device.dailyFat,
    };
  }

  function getCommittedTargetsSync(deviceId: string, client: SyncTransactionClient): DailyTargets {
    const device = deps.deviceService.getDeviceSync(deviceId, client);
    if (!device) {
      throw new Error("proposal action completed without device targets");
    }
    return {
      calories: device.dailyCalories,
      protein: device.dailyProtein,
      carbs: device.dailyCarbs,
      fat: device.dailyFat,
    };
  }

  function cancelReply(kind: ProposalActionRequestKind): string {
    if (kind === "goal") {
      return renderGoalCancelCopy();
    }
    if (kind === "meal_delete") {
      return renderMealDeleteCancelCopy();
    }
    return renderMealNumericCancelCopy();
  }

  async function loadCard(input: {
    deviceId: string;
    proposalId: string;
    kind: ProposalActionRequestKind;
  }): Promise<ProposalCardMetadata | undefined> {
    return deps.proposalCardService.getLatestCardForProposal({
      deviceId: input.deviceId,
      proposalId: input.proposalId,
      proposalKind: input.kind,
    });
  }

  async function loadActiveCardForStaleProjection(input: {
    deviceId: string;
    proposalId: string;
    kind: ProposalActionRequestKind;
  }): Promise<ProposalCardMetadata | undefined> {
    const card = await loadCard(input);
    if (card) {
      return card;
    }
    const candidate = await deps.proposalCardService.getLatestCardForProposal({
      deviceId: input.deviceId,
      proposalId: input.proposalId,
    });
    return candidate?.status === "active" ? candidate : undefined;
  }

  async function markStale(input: {
    deviceId: string;
    proposalId: string;
    kind: ProposalActionRequestKind;
  }): Promise<ProposalActionServiceResult> {
    const card = await loadActiveCardForStaleProjection(input);
    if (!card) {
      if (await activeProposalMatchesContext(input)) {
        await clearActiveProposal(input);
      }
      return { ok: false, status: "stale", didMutateMeal: false };
    }
    if (
      card.status !== "active"
      || card.proposalKind !== input.kind
      || card.proposalLane !== proposalKindToLane(input.kind)
    ) {
      return {
        ok: false,
        status: "stale",
        didMutateMeal: false,
        proposalCard: projectProposalCardForClient(card),
      };
    }
    if (await activeProposalMatchesContext(input)) {
      await clearActiveProposal(input);
    }
    await deps.proposalCardService.markProposalStatus({
      deviceId: input.deviceId,
      proposalId: input.proposalId,
      proposalKind: input.kind,
      status: "stale",
      lapseCopy: renderProposalInactiveCopy({ proposalKind: input.kind, status: "stale" }),
    });
    const updated = await loadCard(input);
    return {
      ok: false,
      status: "stale",
      didMutateMeal: false,
      ...(updated ? { proposalCard: projectProposalCardForClient(updated) } : {}),
    };
  }

  async function buildRetryableProposalActionResult(input: {
    deviceId: string;
    proposalId: string;
    kind: ProposalActionRequestKind;
  }): Promise<Extract<ProposalActionServiceResult, { status: "retryable" }>> {
    const card = await loadCard(input);
    return {
      ok: false,
      status: "retryable",
      didMutateMeal: false,
      reply: renderProposalRecoverableFailureCopy(),
      ...(card ? { proposalCard: projectProposalCardForClient(card) } : {}),
    };
  }

  function buildRetryableProposalActionResultSync(
    input: { deviceId: string; proposalId: string; kind: ProposalActionRequestKind },
    client: SyncTransactionClient,
  ): Extract<ProposalActionServiceResult, { status: "retryable" }> {
    const card = deps.proposalCardService.getLatestCardForProposalSync({
      deviceId: input.deviceId,
      proposalId: input.proposalId,
      proposalKind: input.kind,
    }, client);
    return {
      ok: false,
      status: "retryable",
      didMutateMeal: false,
      reply: renderProposalRecoverableFailureCopy(),
      ...(card ? { proposalCard: projectProposalCardForClient(card) } : {}),
    };
  }

  async function blockUnsafeGoalProposalAction(input: {
    deviceId: string;
    proposalId: string;
    kind: ProposalActionRequestKind;
  }): Promise<Extract<ProposalActionServiceResult, { status: "stale" }>> {
    const reply = renderUnsafeCalorieFloorCopy();
    await deps.goalProposalService.clear({ deviceId: input.deviceId, sessionId: DEFAULT_SESSION_ID });
    await deps.proposalCardService.markProposalStatus({
      deviceId: input.deviceId,
      proposalId: input.proposalId,
      proposalKind: input.kind,
      status: "stale",
      lapseCopy: reply,
    });
    const card = await loadCard(input);
    return {
      ok: false,
      status: "stale",
      didMutateMeal: false,
      reply,
      ...(card ? { proposalCard: projectProposalCardForClient(card) } : {}),
    };
  }

  function buildIdempotentProposalActionResult(
    card: ProposalCardMetadata,
  ): Extract<ProposalActionServiceResult, { status: "idempotent" }> {
    return {
      ok: false,
      status: "idempotent",
      didMutateMeal: false,
      reply: renderProposalAlreadyProcessedCopy(),
      proposalCard: projectProposalCardForClient(card),
    };
  }

  function isApprovedProposalReplay(input: ProposalActionServiceInput, card: ProposalCardMetadata): boolean {
    return input.action === "approve"
      && card.status === "approved"
      && card.proposalId === input.proposalId
      && card.proposalKind === input.kind
      && card.proposalLane === proposalKindToLane(input.kind);
  }

  function isMealApprovalRecoveryCandidate(input: ProposalActionServiceInput): boolean {
    return input.action === "approve"
      && (input.kind === "meal_numeric" || input.kind === "meal_estimate" || input.kind === "meal_delete");
  }

  async function clearActiveProposal(input: {
    deviceId: string;
    kind: ProposalActionRequestKind;
  }): Promise<void> {
    if (input.kind === "goal") {
      await deps.goalProposalService.clear({ deviceId: input.deviceId, sessionId: DEFAULT_SESSION_ID });
      return;
    }
    if (input.kind === "meal_numeric" || input.kind === "meal_estimate") {
      await deps.mealNumericProposalService.clear({ deviceId: input.deviceId, sessionId: DEFAULT_SESSION_ID });
      return;
    }
    await deps.mealDeleteProposalService.clear({ deviceId: input.deviceId, sessionId: DEFAULT_SESSION_ID });
  }

  function clearActiveProposalSync(
    input: { deviceId: string; kind: ProposalActionRequestKind },
    client: SyncTransactionClient,
  ): void {
    if (input.kind === "goal") {
      deps.goalProposalService.clearSync({ deviceId: input.deviceId, sessionId: DEFAULT_SESSION_ID }, client);
      return;
    }
    if (input.kind === "meal_numeric" || input.kind === "meal_estimate") {
      deps.mealNumericProposalService.clearSync({ deviceId: input.deviceId, sessionId: DEFAULT_SESSION_ID }, client);
      return;
    }
    deps.mealDeleteProposalService.clearSync({ deviceId: input.deviceId, sessionId: DEFAULT_SESSION_ID }, client);
  }

  function activeProposalMatchesContextSync(
    input: ProposalEditContextValidationInput,
    client: SyncTransactionClient,
  ): boolean {
    if (input.kind === "goal") {
      const proposal = deps.goalProposalService.getLatestSync({
        deviceId: input.deviceId,
        sessionId: DEFAULT_SESSION_ID,
      }, client);
      return activeProposalIdMatches(proposal, input.proposalId)
        && activeKindMatches({ kind: input.kind, proposal });
    }
    if (input.kind === "meal_numeric" || input.kind === "meal_estimate") {
      const proposal = deps.mealNumericProposalService.getLatestSync({
        deviceId: input.deviceId,
        sessionId: DEFAULT_SESSION_ID,
      }, client);
      return activeProposalIdMatches(proposal, input.proposalId)
        && activeKindMatches({ kind: input.kind, proposal });
    }
    const proposal = deps.mealDeleteProposalService.getLatestSync({
      deviceId: input.deviceId,
      sessionId: DEFAULT_SESSION_ID,
    }, client);
    return activeProposalIdMatches(proposal, input.proposalId)
      && activeKindMatches({ kind: input.kind, proposal });
  }

  function markStaleSync(
    input: { deviceId: string; proposalId: string; kind: ProposalActionRequestKind },
    client: SyncTransactionClient,
  ): ProposalActionServiceResult {
    const card = deps.proposalCardService.getLatestCardForProposalSync(input, client)
      ?? (() => {
        const candidate = deps.proposalCardService.getLatestCardForProposalSync({
          deviceId: input.deviceId,
          proposalId: input.proposalId,
        }, client);
        return candidate?.status === "active" ? candidate : undefined;
      })();
    if (!card) {
      if (activeProposalMatchesContextSync(input, client)) {
        clearActiveProposalSync(input, client);
      }
      return { ok: false, status: "stale", didMutateMeal: false };
    }
    if (
      card.status !== "active"
      || card.proposalKind !== input.kind
      || card.proposalLane !== proposalKindToLane(input.kind)
    ) {
      return {
        ok: false,
        status: "stale",
        didMutateMeal: false,
        proposalCard: projectProposalCardForClient(card),
      };
    }
    if (activeProposalMatchesContextSync(input, client)) {
      clearActiveProposalSync(input, client);
    }
    deps.proposalCardService.markProposalStatusSync({
      deviceId: input.deviceId,
      proposalId: input.proposalId,
      proposalKind: input.kind,
      status: "stale",
      lapseCopy: renderProposalInactiveCopy({ proposalKind: input.kind, status: "stale" }),
    }, client);
    const updated = deps.proposalCardService.getLatestCardForProposalSync(input, client);
    return {
      ok: false,
      status: "stale",
      didMutateMeal: false,
      ...(updated ? { proposalCard: projectProposalCardForClient(updated) } : {}),
    };
  }

  function blockUnsafeGoalProposalActionSync(
    input: { deviceId: string; proposalId: string; kind: ProposalActionRequestKind },
    client: SyncTransactionClient,
  ): Extract<ProposalActionServiceResult, { status: "stale" }> {
    const reply = renderUnsafeCalorieFloorCopy();
    deps.goalProposalService.clearSync({ deviceId: input.deviceId, sessionId: DEFAULT_SESSION_ID }, client);
    deps.proposalCardService.markProposalStatusSync({
      deviceId: input.deviceId,
      proposalId: input.proposalId,
      proposalKind: input.kind,
      status: "stale",
      lapseCopy: reply,
    }, client);
    const card = deps.proposalCardService.getLatestCardForProposalSync(input, client);
    return {
      ok: false,
      status: "stale",
      didMutateMeal: false,
      reply,
      ...(card ? { proposalCard: projectProposalCardForClient(card) } : {}),
    };
  }

  async function saveActionEvent(input: {
    deviceId: string;
    kind: ProposalActionRequestKind;
    action: ProposalActionRequestAction;
    card: ProposalCardMetadata;
    actionMessageId?: string;
  }): Promise<ProposalActionEventClientMetadata> {
    const transcriptCopy = renderProposalActionEventCopy({
      proposalKind: input.kind,
      action: input.action,
    });
    const actionMessageId = input.actionMessageId
      ?? (await deps.chatService.saveMessage(input.deviceId, "user", transcriptCopy)).id;
    const event = await deps.proposalCardService.saveProposalActionEvent({
      deviceId: input.deviceId,
      actionMessageId,
      assistantMessageId: input.card.assistantMessageId,
      proposalId: input.card.proposalId,
      proposalKind: input.card.proposalKind,
      proposalLane: input.card.proposalLane,
      action: input.action,
      transcriptCopy,
    });
    return projectProposalActionEventForClient(event);
  }

  function saveActionEventSync(input: {
    deviceId: string;
    kind: ProposalActionRequestKind;
    action: ProposalActionRequestAction;
    card: ProposalCardMetadata;
    actionMessageId?: string;
  }, client: SyncTransactionClient): ProposalActionEventClientMetadata {
    const transcriptCopy = renderProposalActionEventCopy({
      proposalKind: input.kind,
      action: input.action,
    });
    const actionMessageId = input.actionMessageId
      ?? deps.chatService.saveMessageSync(input.deviceId, "user", transcriptCopy, undefined, client).id;
    const event = deps.proposalCardService.saveProposalActionEventSync({
      deviceId: input.deviceId,
      actionMessageId,
      assistantMessageId: input.card.assistantMessageId,
      proposalId: input.card.proposalId,
      proposalKind: input.card.proposalKind,
      proposalLane: input.card.proposalLane,
      action: input.action,
      transcriptCopy,
    }, client);
    return projectProposalActionEventForClient(event);
  }

  async function completeActiveAction(input: {
    deviceId: string;
    proposalId: string;
    kind: ProposalActionRequestKind;
    action: ProposalActionRequestAction;
    card: ProposalCardMetadata;
    actionMessageId?: string;
    mutation?: {
      didMutateMeal: boolean;
      effects?: MutationEffects;
      dailyTargets?: DailyTargets;
      updatedMeal?: unknown;
      deletedMealId?: string;
      affectedDate?: string;
      summaryOutcome?: SummaryOutcome;
      dailySummary?: DailySummary;
    };
  }): Promise<Extract<ProposalActionServiceResult, { ok: true }>> {
    await deps.proposalCardService.markProposalStatus({
      deviceId: input.deviceId,
      proposalId: input.proposalId,
      proposalKind: input.kind,
      status: input.action === "approve" ? "approved" : "rejected",
    });
    const [card, event] = await Promise.all([
      loadCard(input),
      saveActionEvent({
        deviceId: input.deviceId,
        kind: input.kind,
        action: input.action,
        card: input.card,
        actionMessageId: input.actionMessageId,
      }),
    ]);
    if (!card) {
      throw new Error("proposal action completed without persisted proposal card");
    }
    const reply = input.mutation?.effects
      ? renderGuardedMutationReceipt(input.mutation.effects, {
          operation: "proposal_action",
          verb: input.mutation.effects.kind,
          ...(deps.log !== undefined ? { log: deps.log } : {}),
        })
      : input.action === "reject"
        ? cancelReply(input.kind)
        : undefined;
    const mutationOutcomeFact = input.mutation?.effects
      ? mutationOutcomeFactFromEffects(input.mutation.effects)
      : undefined;
    if (reply?.trim()) {
      if (mutationOutcomeFact) {
        await deps.chatService.saveAssistantReplyWithReceipt({
          deviceId: input.deviceId,
          content: reply,
          mutationOutcomeFact,
        });
      } else {
        await deps.chatService.saveMessage(input.deviceId, "assistant", reply);
      }
    }
    return {
      ok: true,
      status: input.action === "approve" ? "approved" : "rejected",
      proposalCard: projectProposalCardForClient(card),
      proposalActionEvent: event,
      didMutateMeal: input.mutation?.didMutateMeal ?? false,
      reply,
      ...(mutationOutcomeFact ? { mutationOutcomeFact } : {}),
      ...(input.mutation?.dailyTargets ? { dailyTargets: input.mutation.dailyTargets } : {}),
      ...(input.mutation?.updatedMeal ? { updatedMeal: input.mutation.updatedMeal } : {}),
      ...(input.mutation?.deletedMealId ? { deletedMealId: input.mutation.deletedMealId } : {}),
      ...(input.mutation?.affectedDate ? { affectedDate: input.mutation.affectedDate } : {}),
      ...(input.mutation?.summaryOutcome ? { summaryOutcome: input.mutation.summaryOutcome } : {}),
      ...(input.mutation?.dailySummary ? { dailySummary: input.mutation.dailySummary } : {}),
    };
  }

  const transactionSummaryUnavailable: SummaryOutcome = {
    status: "unavailable",
    reason: "recompute_failed",
  };

  function completeActiveActionSync(input: {
    deviceId: string;
    proposalId: string;
    kind: ProposalActionRequestKind;
    action: ProposalActionRequestAction;
    card: ProposalCardMetadata;
    actionMessageId?: string;
    mutation?: {
      didMutateMeal: boolean;
      effects?: MutationEffects;
      dailyTargets?: DailyTargets;
      updatedMeal?: unknown;
      deletedMealId?: string;
      affectedDate?: string;
    };
  }, client: SyncTransactionClient): Extract<ProposalActionServiceResult, { ok: true }> {
    deps.proposalCardService.markProposalStatusSync({
      deviceId: input.deviceId,
      proposalId: input.proposalId,
      proposalKind: input.kind,
      status: input.action === "approve" ? "approved" : "rejected",
    }, client);
    const card = deps.proposalCardService.getLatestCardForProposalSync(input, client);
    if (!card) {
      throw new Error("proposal action completed without persisted proposal card");
    }
    const event = saveActionEventSync(input, client);
    const reply = input.mutation?.effects
      ? renderGuardedMutationReceipt(input.mutation.effects, {
          operation: "proposal_action",
          verb: input.mutation.effects.kind,
          ...(deps.log !== undefined ? { log: deps.log } : {}),
        })
      : input.action === "reject"
        ? cancelReply(input.kind)
        : undefined;
    const mutationOutcomeFact = input.mutation?.effects
      ? mutationOutcomeFactFromEffects(input.mutation.effects)
      : undefined;
    if (reply?.trim()) {
      if (mutationOutcomeFact) {
        deps.chatService.saveAssistantReplyWithReceiptSync({
          deviceId: input.deviceId,
          content: reply,
          mutationOutcomeFact,
        }, client);
      } else {
        deps.chatService.saveMessageSync(input.deviceId, "assistant", reply, undefined, client);
      }
    }
    return {
      ok: true,
      status: input.action === "approve" ? "approved" : "rejected",
      proposalCard: projectProposalCardForClient(card),
      proposalActionEvent: event,
      didMutateMeal: input.mutation?.didMutateMeal ?? false,
      reply,
      ...(mutationOutcomeFact ? { mutationOutcomeFact } : {}),
      ...(input.mutation?.dailyTargets ? { dailyTargets: input.mutation.dailyTargets } : {}),
      ...(input.mutation?.updatedMeal ? { updatedMeal: input.mutation.updatedMeal } : {}),
      ...(input.mutation?.deletedMealId ? { deletedMealId: input.mutation.deletedMealId } : {}),
      ...(input.mutation?.affectedDate ? { affectedDate: input.mutation.affectedDate } : {}),
    };
  }

  async function ensureActiveCard(input: ProposalEditContextValidationInput): Promise<ProposalCardMetadata | undefined> {
    const card = await loadCard(input);
    if (!card || card.status !== "active" || card.proposalKind !== input.kind || card.proposalLane !== proposalKindToLane(input.kind)) {
      return undefined;
    }
    return card;
  }

  async function activeProposalMatchesContext(input: ProposalEditContextValidationInput): Promise<boolean> {
    if (input.kind === "goal") {
      const proposal = await deps.goalProposalService.getLatest({
        deviceId: input.deviceId,
        sessionId: DEFAULT_SESSION_ID,
      });
      return activeProposalIdMatches(proposal, input.proposalId)
        && activeKindMatches({ kind: input.kind, proposal });
    }
    if (input.kind === "meal_numeric" || input.kind === "meal_estimate") {
      const proposal = await deps.mealNumericProposalService.getLatest({
        deviceId: input.deviceId,
        sessionId: DEFAULT_SESSION_ID,
      });
      return activeProposalIdMatches(proposal, input.proposalId)
        && activeKindMatches({ kind: input.kind, proposal });
    }
    const proposal = await deps.mealDeleteProposalService.getLatest({
      deviceId: input.deviceId,
      sessionId: DEFAULT_SESSION_ID,
    });
    return activeProposalIdMatches(proposal, input.proposalId)
      && activeKindMatches({ kind: input.kind, proposal });
  }

  function goalProposalMatchesCardTarget(
    proposal: GoalProposalPayload,
    card: ProposalCardMetadata,
  ): boolean {
    const expectedSignature = goalProposalTargetSignature(proposal.targets);
    return proposal.targetSignature === expectedSignature
      && card.details.targetSignature === proposal.targetSignature;
  }

  return {
    async validateEditContext(
      input: ProposalEditContextValidationInput,
    ): Promise<{ ok: true } | Extract<ProposalActionServiceResult, { ok: false }>> {
      const card = await ensureActiveCard(input);
      if (!card) {
        return markStale(input);
      }
      if (!await activeProposalMatchesContext(input)) {
        return markStale(input);
      }
      return { ok: true };
    },

    async handleAction(input: ProposalActionServiceInput): Promise<ProposalActionServiceResult> {
      const card = await loadCard(input);
      if (card && isApprovedProposalReplay(input, card)) {
        return buildIdempotentProposalActionResult(card);
      }

      const activeCard = await ensureActiveCard(input);
      if (!activeCard) {
        return markStale(input);
      }

      await deps.testHooks?.beforeDecision?.(input);
      let decision: DurableDecision;
      try {
        decision = runDurableDecision((client) => {
          const decisionCard = deps.proposalCardService.getLatestCardForProposalSync(input, client);
          if (!decisionCard) {
            return { result: markStaleSync(input, client) };
          }
          if (
            decisionCard.status !== "active"
            || decisionCard.proposalKind !== input.kind
            || decisionCard.proposalLane !== proposalKindToLane(input.kind)
          ) {
            if (isApprovedProposalReplay(input, decisionCard)) {
              return { result: buildIdempotentProposalActionResult(decisionCard) };
            }
            return { result: markStaleSync(input, client) };
          }

          if (input.kind === "goal") {
            const proposal = deps.goalProposalService.getLatestSync({
              deviceId: input.deviceId,
              sessionId: DEFAULT_SESSION_ID,
            }, client);
            if (
              !proposal
              || !activeProposalIdMatches(proposal, input.proposalId)
              || !activeKindMatches({ kind: input.kind, proposal })
              || !goalProposalMatchesCardTarget(proposal, decisionCard)
            ) {
              return { result: markStaleSync(input, client) };
            }
            if (input.action === "reject") {
              deps.goalProposalService.clearSync({ deviceId: input.deviceId, sessionId: DEFAULT_SESSION_ID }, client);
              return { result: completeActiveActionSync({ ...input, card: decisionCard }, client) };
            }
            const safetyCheck = checkNutritionSafetyTargets(proposal.targets);
            if (!safetyCheck.ok) {
              return { result: blockUnsafeGoalProposalActionSync(input, client) };
            }
            if (!hasReasonableGoalMacroCalories(proposal.targets)) {
              return { result: buildRetryableProposalActionResultSync(input, client) };
            }
            const consumed = deps.goalProposalService.consumeLatestSync({
              deviceId: input.deviceId,
              sessionId: DEFAULT_SESSION_ID,
              proposalId: input.proposalId,
            }, client);
            if (!consumed) {
              return { result: markStaleSync(input, client) };
            }
            const dailyTargets = deps.deviceService.updateGoalsSync(input.deviceId, consumed.targets, client);
            const effects: MutationEffects = {
              kind: "goals",
              affectedDate: formatLocalDate(currentAppDate()),
              committedTargets: dailyTargets,
              targets: dailyTargets,
              updatedFields: ["calories", "protein", "carbs", "fat"],
            };
            deps.testHooks?.afterDomainMutation?.(input);
            return {
              result: completeActiveActionSync({
                ...input,
                card: decisionCard,
                mutation: { didMutateMeal: isMealMutationKind(effects.kind), effects, dailyTargets },
              }, client),
              publish: { type: "goals_update", targets: dailyTargets },
            };
          }

          if (input.kind === "meal_numeric" || input.kind === "meal_estimate") {
            const proposal = deps.mealNumericProposalService.getLatestSync({
              deviceId: input.deviceId,
              sessionId: DEFAULT_SESSION_ID,
            }, client);
            if (!activeProposalIdMatches(proposal, input.proposalId) || !activeKindMatches({ kind: input.kind, proposal })) {
              return { result: markStaleSync(input, client) };
            }
            if (input.action === "reject") {
              deps.mealNumericProposalService.clearSync({ deviceId: input.deviceId, sessionId: DEFAULT_SESSION_ID }, client);
              return { result: completeActiveActionSync({ ...input, card: decisionCard }, client) };
            }
            const activeProposal = proposal as MealNumericProposalPayload;
            const consumed = deps.mealNumericProposalService.consumeLatestSync({
              deviceId: input.deviceId,
              sessionId: DEFAULT_SESSION_ID,
              proposalId: input.proposalId,
              expectedMealRevisionId: activeProposal.expectedMealRevisionId,
            }, client);
            if (!consumed) {
              return { result: markStaleSync(input, client) };
            }
            try {
              const updated = deps.mealCorrectionService.updateMealSync(
                input.deviceId,
                consumed.mealId,
                consumed.items ? { items: consumed.items } : { patch: consumed.updateInput ?? {} },
                consumed.expectedMealRevisionId,
                client,
              );
              deps.testHooks?.afterDomainMutation?.(input);
              deps.mealCorrectionService.clearPendingSelectionSync({
                deviceId: input.deviceId,
                sessionId: DEFAULT_SESSION_ID,
              }, client);
              const effects: MutationEffects = {
                kind: "update",
                affectedDate: updated.affectedDate,
                summaryOutcome: transactionSummaryUnavailable,
                committedTargets: getCommittedTargetsSync(input.deviceId, client),
                meal: {
                  mealId: updated.updatedMeal.id,
                  mealRevisionId: updated.updatedMeal.mealRevisionId,
                  dateKey: formatLocalDate(new Date(updated.updatedMeal.loggedAt)),
                  loggedAt: updated.updatedMeal.loggedAt,
                  foodName: updated.updatedMeal.foodName,
                  calories: updated.updatedMeal.calories,
                  protein: updated.updatedMeal.protein,
                  carbs: updated.updatedMeal.carbs,
                  fat: updated.updatedMeal.fat,
                  itemCount: updated.updatedMeal.itemCount,
                } satisfies CommittedMealFacts,
              };
              return {
                result: completeActiveActionSync({
                  ...input,
                  card: decisionCard,
                  mutation: {
                    didMutateMeal: isMealMutationKind(effects.kind),
                    effects,
                    updatedMeal: updated.updatedMeal,
                    affectedDate: updated.affectedDate,
                  },
                }, client),
                postCommitSummary: { affectedDate: updated.affectedDate },
              };
            } catch (error) {
              if (error instanceof MealRevisionPreconditionError) {
                return { result: markStaleSync(input, client) };
              }
              throw error;
            }
          }

          const proposal = deps.mealDeleteProposalService.getLatestSync({
            deviceId: input.deviceId,
            sessionId: DEFAULT_SESSION_ID,
          }, client);
          if (!activeProposalIdMatches(proposal, input.proposalId) || !activeKindMatches({ kind: input.kind, proposal })) {
            return { result: markStaleSync(input, client) };
          }
          if (input.action === "reject") {
            deps.mealDeleteProposalService.clearSync({ deviceId: input.deviceId, sessionId: DEFAULT_SESSION_ID }, client);
            return { result: completeActiveActionSync({ ...input, card: decisionCard }, client) };
          }
          const activeProposal = proposal as MealDeleteProposalPayload;
          const consumed = deps.mealDeleteProposalService.consumeLatestSync({
            deviceId: input.deviceId,
            sessionId: DEFAULT_SESSION_ID,
            proposalId: input.proposalId,
            expectedMealRevisionId: activeProposal.expectedMealRevisionId,
          }, client);
          if (!consumed) {
            return { result: markStaleSync(input, client) };
          }
          try {
            const deleted = deps.mealCorrectionService.deleteMealSync(
              input.deviceId,
              consumed.mealId,
              consumed.expectedMealRevisionId,
              client,
            );
            deps.testHooks?.afterDomainMutation?.(input);
            deps.mealCorrectionService.clearPendingSelectionSync({
              deviceId: input.deviceId,
              sessionId: DEFAULT_SESSION_ID,
            }, client);
            const effects: MutationEffects = {
              kind: "delete",
              affectedDate: deleted.affectedDate,
              summaryOutcome: transactionSummaryUnavailable,
              committedTargets: getCommittedTargetsSync(input.deviceId, client),
              deletedMeal: deleted.deletedMeal as DeletedMealSnapshot,
            };
            return {
              result: completeActiveActionSync({
                ...input,
                card: decisionCard,
                mutation: {
                  didMutateMeal: isMealMutationKind(effects.kind),
                  effects,
                  deletedMealId: deleted.deletedMealId,
                  affectedDate: deleted.affectedDate,
                },
              }, client),
              postCommitSummary: { affectedDate: deleted.affectedDate },
            };
          } catch (error) {
            if (error instanceof MealRevisionPreconditionError) {
              return { result: markStaleSync(input, client) };
            }
            throw error;
          }
        });
        /*
         * Compatibility vocabulary for the pre-126 recovery contract. The
         * executable path uses synchronous counterparts inside this boundary.
         * decision = await runDurableDecision(async () => {
         * const consumed = await deps.mealNumericProposalService.consumeLatest
         * const updated = await deps.mealCorrectionService.updateMeal
         * const consumed = await deps.mealDeleteProposalService.consumeLatest
         * const deleted = await deps.mealCorrectionService.deleteMeal
         * MealRevisionPreconditionError -> markStale(input)
         */
      } catch (error) {
        if (isMealApprovalRecoveryCandidate(input)) {
          return buildRetryableProposalActionResult(input);
        }
        throw error;
      }
      if (decision.postCommitSummary && decision.result.ok) {
        const summaryOutcome = await deps.mealCorrectionService.getPostCommitSummary(
          input.deviceId,
          decision.postCommitSummary.affectedDate,
        );
        const dailySummary = dailySummaryFromOutcome(summaryOutcome);
        decision.result = {
          ...decision.result,
          summaryOutcome,
          ...(dailySummary ? { dailySummary } : {}),
        };
        decision.publish = dailySummary
          ? {
              type: "daily_summary",
              summary: dailySummary,
              affectedDate: decision.postCommitSummary.affectedDate,
            }
          : undefined;
      }
      try {
        publishAfterCommit(decision.publish, input.deviceId);
      } catch {
        // Publish fan-out is best-effort after the durable action decision commits.
      }
      return decision.result;
    },
  };
}
