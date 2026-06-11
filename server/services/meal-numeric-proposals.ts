import type { AppDatabase } from "../db/client.js";
import { createTurnStateService } from "./turn-state.js";

export const MEAL_NUMERIC_PROPOSAL_KIND = "meal_numeric_correction_proposal";
export const MEAL_NUMERIC_PROPOSAL_TTL_MS = 30 * 60 * 1000;

export const MEAL_NUMERIC_FIELDS = ["calories", "protein", "carbs", "fat"] as const;
export type MealNumericField = (typeof MEAL_NUMERIC_FIELDS)[number];

export interface MealNumericAffectedField {
  field: MealNumericField;
  before: number;
  after: number;
}

export interface MealNumericProposalItem {
  foodName: string;
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

export type MealNumericUpdateInput = Partial<Record<MealNumericField, number>>;

export interface MealNumericProposalInput {
  mealId: string;
  expectedMealRevisionId: string;
  updateInput?: MealNumericUpdateInput;
  items?: MealNumericProposalItem[];
  affectedFields: MealNumericAffectedField[];
  sourceOperator: string;
}

export interface MealNumericProposalPayload extends MealNumericProposalInput {
  proposalId: string;
  createdAt: string;
  expiresAt: string;
}

function assertValidProposalInput(input: MealNumericProposalInput): void {
  const hasUpdateInput = input.updateInput !== undefined;
  const hasItems = input.items !== undefined;
  if (hasUpdateInput === hasItems) {
    throw new Error("meal numeric proposal requires exactly one backend-computed update shape");
  }
}

export function createMealNumericProposalService(db: AppDatabase) {
  const turnStateService = createTurnStateService(db);

  return {
    async putLatest({
      deviceId,
      sessionId,
      input,
    }: {
      deviceId: string;
      sessionId: string;
      input: MealNumericProposalInput;
    }): Promise<MealNumericProposalPayload> {
      assertValidProposalInput(input);

      const now = new Date();
      const proposal: MealNumericProposalPayload = {
        proposalId: crypto.randomUUID(),
        mealId: input.mealId,
        expectedMealRevisionId: input.expectedMealRevisionId,
        ...(input.updateInput ? { updateInput: { ...input.updateInput } } : {}),
        ...(input.items ? { items: input.items.map((item) => ({ ...item })) } : {}),
        affectedFields: input.affectedFields.map((field) => ({ ...field })),
        sourceOperator: input.sourceOperator,
        createdAt: now.toISOString(),
        expiresAt: new Date(now.getTime() + MEAL_NUMERIC_PROPOSAL_TTL_MS).toISOString(),
      };

      await turnStateService.putState({
        deviceId,
        sessionId,
        kind: MEAL_NUMERIC_PROPOSAL_KIND,
        payload: proposal,
        ttlMs: MEAL_NUMERIC_PROPOSAL_TTL_MS,
      });

      return proposal;
    },

    async getLatest({
      deviceId,
      sessionId,
    }: {
      deviceId: string;
      sessionId: string;
    }): Promise<MealNumericProposalPayload | undefined> {
      const payload = await turnStateService.getState({
        deviceId,
        sessionId,
        kind: MEAL_NUMERIC_PROPOSAL_KIND,
      });
      return payload as MealNumericProposalPayload | undefined;
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
    }): Promise<MealNumericProposalPayload | undefined> {
      const payload = await turnStateService.consumeState({
        deviceId,
        sessionId,
        kind: MEAL_NUMERIC_PROPOSAL_KIND,
        proposalId,
        expectedMealRevisionId,
      });
      return payload as MealNumericProposalPayload | undefined;
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
        kind: MEAL_NUMERIC_PROPOSAL_KIND,
      });
    },
  };
}
