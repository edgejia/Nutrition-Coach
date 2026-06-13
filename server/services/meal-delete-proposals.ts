import type { AppDatabase } from "../db/client.js";
import type { MealPeriod } from "../lib/meal-period.js";
import { createTurnStateService } from "./turn-state.js";

export const MEAL_DELETE_PROPOSAL_KIND = "meal_delete_proposal";
export const MEAL_DELETE_PROPOSAL_TTL_MS = 30 * 60 * 1000;

export interface MealDeleteProposalItemSnapshot {
  foodName: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface MealDeleteProposalSnapshot {
  mealId: string;
  expectedMealRevisionId: string;
  mealLabel: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
  dateKey: string;
  loggedAt: string;
  mealPeriod: MealPeriod;
  items?: MealDeleteProposalItemSnapshot[];
}

export interface MealDeleteProposalInput {
  mealId: string;
  expectedMealRevisionId: string;
  snapshot: MealDeleteProposalSnapshot;
}

export interface MealDeleteProposalPayload extends MealDeleteProposalInput {
  proposalId: string;
  createdAt: string;
  expiresAt: string;
}

function cloneSnapshot(snapshot: MealDeleteProposalSnapshot): MealDeleteProposalSnapshot {
  return {
    ...snapshot,
    ...(snapshot.items ? { items: snapshot.items.map((item) => ({ ...item })) } : {}),
  };
}

export function createMealDeleteProposalService(db: AppDatabase) {
  const turnStateService = createTurnStateService(db);

  return {
    async putLatest({
      deviceId,
      sessionId,
      input,
    }: {
      deviceId: string;
      sessionId: string;
      input: MealDeleteProposalInput;
    }): Promise<MealDeleteProposalPayload> {
      const now = new Date();
      const proposal: MealDeleteProposalPayload = {
        proposalId: crypto.randomUUID(),
        mealId: input.mealId,
        expectedMealRevisionId: input.expectedMealRevisionId,
        snapshot: cloneSnapshot(input.snapshot),
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + MEAL_DELETE_PROPOSAL_TTL_MS).toISOString(),
      };

      await turnStateService.putState({
        deviceId,
        sessionId,
        kind: MEAL_DELETE_PROPOSAL_KIND,
        payload: proposal,
        ttlMs: MEAL_DELETE_PROPOSAL_TTL_MS,
      });

      return proposal;
    },

    async getLatest({
      deviceId,
      sessionId,
    }: {
      deviceId: string;
      sessionId: string;
    }): Promise<MealDeleteProposalPayload | undefined> {
      const payload = await turnStateService.getState({
        deviceId,
        sessionId,
        kind: MEAL_DELETE_PROPOSAL_KIND,
      });
      return payload as MealDeleteProposalPayload | undefined;
    },

    async consumeLatest({
      deviceId,
      sessionId,
      proposalId,
      expectedMealRevisionId,
    }: {
      deviceId: string;
      sessionId: string;
      proposalId: string;
      expectedMealRevisionId: string;
    }): Promise<MealDeleteProposalPayload | undefined> {
      const payload = await turnStateService.consumeState({
        deviceId,
        sessionId,
        kind: MEAL_DELETE_PROPOSAL_KIND,
        proposalId,
        expectedMealRevisionId,
      });
      return payload as MealDeleteProposalPayload | undefined;
    },

    async clear({
      deviceId,
      sessionId,
    }: {
      deviceId: string;
      sessionId: string;
    }): Promise<void> {
      await turnStateService.clearState({
        deviceId,
        sessionId,
        kind: MEAL_DELETE_PROPOSAL_KIND,
      });
    },
  };
}
