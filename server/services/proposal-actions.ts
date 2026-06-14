import type { RealtimePublisher } from "../realtime/publisher.js";
import type { AppDatabase } from "../db/client.js";
import {
  renderProposalActionEventCopy,
  renderProposalInactiveCopy,
} from "../orchestrator/mutation-receipts.js";
import { MealRevisionPreconditionError } from "./meal-transactions.js";
import type { createChatService } from "./chat.js";
import type { createDeviceService, DailyTargets } from "./device.js";
import type { createGoalProposalService, GoalProposalPayload } from "./goal-proposals.js";
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
import { DEFAULT_SESSION_ID } from "./turn-state.js";

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
  async function runDurableDecision<T extends ProposalActionServiceResult>(
    fn: () => Promise<DurableDecision<T>>,
  ): Promise<DurableDecision<T>> {
    deps.db.$client.prepare("BEGIN IMMEDIATE").run();
    let transactionOpen = true;
    try {
      const decision = await fn();
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

  async function loadCard(input: {
    deviceId: string;
    proposalId: string;
  }): Promise<ProposalCardMetadata | undefined> {
    return deps.proposalCardService.getLatestCardForProposal(input);
  }

  async function markStale(input: {
    deviceId: string;
    proposalId: string;
    kind: ProposalActionRequestKind;
    card?: ProposalCardMetadata;
  }): Promise<ProposalActionServiceResult> {
    const card = input.card ?? await loadCard(input);
    if (!card) {
      return { ok: false, status: "stale", didMutateMeal: false };
    }
    if (card.status !== "active") {
      return {
        ok: false,
        status: "stale",
        didMutateMeal: false,
        proposalCard: projectProposalCardForClient(card),
      };
    }
    await deps.proposalCardService.markProposalStatus({
      deviceId: input.deviceId,
      proposalId: input.proposalId,
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

  async function completeActiveAction(input: {
    deviceId: string;
    proposalId: string;
    kind: ProposalActionRequestKind;
    action: ProposalActionRequestAction;
    card: ProposalCardMetadata;
    actionMessageId?: string;
    mutation?: {
      didMutateMeal: boolean;
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
    return {
      ok: true,
      status: input.action === "approve" ? "approved" : "rejected",
      proposalCard: projectProposalCardForClient(card),
      proposalActionEvent: event,
      didMutateMeal: input.mutation?.didMutateMeal ?? false,
      ...(input.mutation?.dailyTargets ? { dailyTargets: input.mutation.dailyTargets } : {}),
      ...(input.mutation?.updatedMeal ? { updatedMeal: input.mutation.updatedMeal } : {}),
      ...(input.mutation?.deletedMealId ? { deletedMealId: input.mutation.deletedMealId } : {}),
      ...(input.mutation?.affectedDate ? { affectedDate: input.mutation.affectedDate } : {}),
      ...(input.mutation?.summaryOutcome ? { summaryOutcome: input.mutation.summaryOutcome } : {}),
      ...(input.mutation?.dailySummary ? { dailySummary: input.mutation.dailySummary } : {}),
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

  return {
    async validateEditContext(
      input: ProposalEditContextValidationInput,
    ): Promise<{ ok: true } | Extract<ProposalActionServiceResult, { ok: false }>> {
      const card = await ensureActiveCard(input);
      if (!card) {
        return markStale(input);
      }
      if (!await activeProposalMatchesContext(input)) {
        return markStale({ ...input, card });
      }
      return { ok: true };
    },

    async handleAction(input: ProposalActionServiceInput): Promise<ProposalActionServiceResult> {
      const card = await ensureActiveCard(input);
      if (!card) {
        return markStale(input);
      }

      const decision = await runDurableDecision(async () => {
        if (input.kind === "goal") {
          const proposal = await deps.goalProposalService.getLatest({
            deviceId: input.deviceId,
            sessionId: DEFAULT_SESSION_ID,
          });
          if (!activeProposalIdMatches(proposal, input.proposalId) || !activeKindMatches({ kind: input.kind, proposal })) {
            return { result: await markStale({ ...input, card }) };
          }
          if (input.action === "reject") {
            await deps.goalProposalService.clear({ deviceId: input.deviceId, sessionId: DEFAULT_SESSION_ID });
            return { result: await completeActiveAction({ ...input, card }) };
          }
          const consumed = await deps.goalProposalService.consumeLatest({
            deviceId: input.deviceId,
            sessionId: DEFAULT_SESSION_ID,
            proposalId: input.proposalId,
          });
          if (!consumed) {
            return { result: await markStale({ ...input, card }) };
          }
          const dailyTargets = await deps.deviceService.updateGoals(input.deviceId, consumed.targets);
          deps.testHooks?.afterDomainMutation?.(input);
          return {
            result: await completeActiveAction({
              ...input,
              card,
              mutation: { didMutateMeal: false, dailyTargets },
            }),
            publish: { type: "goals_update", targets: dailyTargets },
          };
        }

        if (input.kind === "meal_numeric" || input.kind === "meal_estimate") {
          const proposal = await deps.mealNumericProposalService.getLatest({
            deviceId: input.deviceId,
            sessionId: DEFAULT_SESSION_ID,
          });
          if (!activeProposalIdMatches(proposal, input.proposalId) || !activeKindMatches({ kind: input.kind, proposal })) {
            return { result: await markStale({ ...input, card }) };
          }
          if (input.action === "reject") {
            await deps.mealNumericProposalService.clear({ deviceId: input.deviceId, sessionId: DEFAULT_SESSION_ID });
            return { result: await completeActiveAction({ ...input, card }) };
          }
          const activeProposal = proposal as MealNumericProposalPayload;
          const consumed = await deps.mealNumericProposalService.consumeLatest({
            deviceId: input.deviceId,
            sessionId: DEFAULT_SESSION_ID,
            proposalId: input.proposalId,
            expectedMealRevisionId: activeProposal.expectedMealRevisionId,
          });
          if (!consumed) {
            return { result: await markStale({ ...input, card }) };
          }
          try {
            const updated = await deps.mealCorrectionService.updateMeal(
              input.deviceId,
              consumed.mealId,
              consumed.items ? { items: consumed.items } : { patch: consumed.updateInput ?? {} },
              consumed.expectedMealRevisionId,
            );
            deps.testHooks?.afterDomainMutation?.(input);
            await deps.mealCorrectionService.clearPendingSelection({
              deviceId: input.deviceId,
              sessionId: DEFAULT_SESSION_ID,
            });
            return {
              result: await completeActiveAction({
                ...input,
                card,
                mutation: {
                  didMutateMeal: true,
                  updatedMeal: updated.updatedMeal,
                  affectedDate: updated.affectedDate,
                  summaryOutcome: updated.summaryOutcome,
                  ...(updated.dailySummary ? { dailySummary: updated.dailySummary } : {}),
                },
              }),
              ...(updated.dailySummary
                ? {
                    publish: {
                      type: "daily_summary" as const,
                      summary: updated.dailySummary,
                      affectedDate: updated.affectedDate,
                    },
                  }
                : {}),
            };
          } catch (error) {
            if (error instanceof MealRevisionPreconditionError) {
              return { result: await markStale({ ...input, card }) };
            }
            throw error;
          }
        }

        const proposal = await deps.mealDeleteProposalService.getLatest({
          deviceId: input.deviceId,
          sessionId: DEFAULT_SESSION_ID,
        });
        if (!activeProposalIdMatches(proposal, input.proposalId) || !activeKindMatches({ kind: input.kind, proposal })) {
          return { result: await markStale({ ...input, card }) };
        }
        if (input.action === "reject") {
          await deps.mealDeleteProposalService.clear({ deviceId: input.deviceId, sessionId: DEFAULT_SESSION_ID });
          return { result: await completeActiveAction({ ...input, card }) };
        }
        const activeProposal = proposal as MealDeleteProposalPayload;
        const consumed = await deps.mealDeleteProposalService.consumeLatest({
          deviceId: input.deviceId,
          sessionId: DEFAULT_SESSION_ID,
          proposalId: input.proposalId,
          expectedMealRevisionId: activeProposal.expectedMealRevisionId,
        });
        if (!consumed) {
          return { result: await markStale({ ...input, card }) };
        }
        try {
          const deleted = await deps.mealCorrectionService.deleteMeal(
            input.deviceId,
            consumed.mealId,
            consumed.expectedMealRevisionId,
          );
          deps.testHooks?.afterDomainMutation?.(input);
          await deps.mealCorrectionService.clearPendingSelection({
            deviceId: input.deviceId,
            sessionId: DEFAULT_SESSION_ID,
          });
          return {
            result: await completeActiveAction({
              ...input,
              card,
              mutation: {
                didMutateMeal: true,
                deletedMealId: deleted.deletedMealId,
                affectedDate: deleted.affectedDate,
                summaryOutcome: deleted.summaryOutcome,
                ...(deleted.dailySummary ? { dailySummary: deleted.dailySummary } : {}),
              },
            }),
            ...(deleted.dailySummary
              ? {
                  publish: {
                    type: "daily_summary" as const,
                    summary: deleted.dailySummary,
                    affectedDate: deleted.affectedDate,
                  },
                }
              : {}),
          };
        } catch (error) {
          if (error instanceof MealRevisionPreconditionError) {
            return { result: await markStale({ ...input, card }) };
          }
          throw error;
        }
      });
      publishAfterCommit(decision.publish, input.deviceId);
      return decision.result;
    },
  };
}
