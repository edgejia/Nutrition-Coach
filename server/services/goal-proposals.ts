import type { AppDatabase } from "../db/client.js";
import type { DailyTargets } from "./device.js";
import { createTurnStateService } from "./turn-state.js";

export const GOAL_PROPOSAL_KIND = "goal_proposal";
export const GOAL_PROPOSAL_TTL_MS = 30 * 60 * 1000;

export interface GoalProposalPayload {
  proposalId: string;
  targets: DailyTargets;
  targetSignature: string;
  createdAt: string;
}

export function goalProposalTargetSignature(targets: DailyTargets): string {
  return [
    `calories:${targets.calories}`,
    `protein:${targets.protein}`,
    `carbs:${targets.carbs}`,
    `fat:${targets.fat}`,
  ].join("|");
}

export function createGoalProposalService(db: AppDatabase) {
  const turnStateService = createTurnStateService(db);

  return {
    async putLatest({
      deviceId,
      sessionId,
      targets,
    }: {
      deviceId: string;
      sessionId: string;
      targets: DailyTargets;
    }): Promise<GoalProposalPayload> {
      const proposal: GoalProposalPayload = {
        proposalId: crypto.randomUUID(),
        targets: { ...targets },
        targetSignature: goalProposalTargetSignature(targets),
        createdAt: new Date().toISOString(),
      };

      await turnStateService.putState({
        deviceId,
        sessionId,
        kind: GOAL_PROPOSAL_KIND,
        payload: proposal,
        ttlMs: GOAL_PROPOSAL_TTL_MS,
      });

      return proposal;
    },

    async getLatest({
      deviceId,
      sessionId,
    }: {
      deviceId: string;
      sessionId: string;
    }): Promise<GoalProposalPayload | undefined> {
      const payload = await turnStateService.getState({
        deviceId,
        sessionId,
        kind: GOAL_PROPOSAL_KIND,
      });
      return payload as GoalProposalPayload | undefined;
    },

    async consumeLatest({
      deviceId,
      sessionId,
      proposalId,
    }: {
      deviceId: string;
      sessionId: string;
      proposalId: string;
    }): Promise<GoalProposalPayload | undefined> {
      const payload = await turnStateService.consumeState({
        deviceId,
        sessionId,
        kind: GOAL_PROPOSAL_KIND,
        proposalId,
      });
      return payload as GoalProposalPayload | undefined;
    },

    async clear({
      deviceId,
      sessionId,
    }: {
      deviceId: string;
      sessionId: string;
    }): Promise<void> {
      await turnStateService.clearState({ deviceId, sessionId, kind: GOAL_PROPOSAL_KIND });
    },
  };
}
