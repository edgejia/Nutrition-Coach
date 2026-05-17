import type { AppDatabase } from "../db/client.js";
import type { DailyTargets } from "./device.js";
import { createTurnStateService } from "./turn-state.js";

export const GOAL_PROPOSAL_KIND = "goal_proposal";
export const GOAL_PROPOSAL_TTL_MS = 30 * 60 * 1000;

export interface GoalProposalPayload {
  proposalId: string;
  targets: DailyTargets;
  createdAt: string;
}

export function createGoalProposalService(db: AppDatabase) {
  const turnStateService = createTurnStateService(db);

  return {
    async putLatest(deviceId: string, targets: DailyTargets): Promise<GoalProposalPayload> {
      const proposal: GoalProposalPayload = {
        proposalId: crypto.randomUUID(),
        targets: { ...targets },
        createdAt: new Date().toISOString(),
      };

      await turnStateService.putState(
        deviceId,
        GOAL_PROPOSAL_KIND,
        proposal,
        GOAL_PROPOSAL_TTL_MS,
      );

      return proposal;
    },

    async getLatest(deviceId: string): Promise<GoalProposalPayload | undefined> {
      return turnStateService.getState<GoalProposalPayload>(deviceId, GOAL_PROPOSAL_KIND);
    },

    async clear(deviceId: string): Promise<void> {
      await turnStateService.clearState(deviceId, GOAL_PROPOSAL_KIND);
    },
  };
}
