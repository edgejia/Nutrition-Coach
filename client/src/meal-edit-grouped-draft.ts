import type { MealItemDetail } from "./types.js";

export type GroupedMealDraftField = "name" | "calories" | "protein" | "carbs" | "fat";
export type GroupedMealDraftFieldError = "required" | "invalid" | "negative";
export type GroupedMealDraftFieldErrors = Partial<Record<GroupedMealDraftField, GroupedMealDraftFieldError>>;

export interface GroupedMealDraftRow {
  name: string;
  calories: string;
  protein: string;
  carbs: string;
  fat: string;
}

export interface GroupedMealDraftValidation {
  valid: boolean;
  firstInvalidIndex: number | null;
  rows: GroupedMealDraftFieldErrors[];
  formError?: "empty";
}

export interface GroupedMealDraftTotals {
  calories: number;
  protein: number;
  carbs: number;
  fat: number;
}

const NUTRITION_FIELDS = ["calories", "protein", "carbs", "fat"] as const;

function formatDraftNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(value);
}

function parseNonNegativeNumber(value: string): number | null {
  if (value.trim() === "") {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function createGroupedMealDraftRows(items: MealItemDetail[]): GroupedMealDraftRow[] {
  return [...items]
    .sort((a, b) => a.position - b.position)
    .map((item) => ({
      name: item.name,
      calories: formatDraftNumber(item.calories),
      protein: formatDraftNumber(item.protein),
      carbs: formatDraftNumber(item.carbs),
      fat: formatDraftNumber(item.fat),
    }));
}

export function computeGroupedMealDraftTotals(rows: GroupedMealDraftRow[]): GroupedMealDraftTotals {
  return rows.reduce<GroupedMealDraftTotals>(
    (totals, row) => {
      for (const field of NUTRITION_FIELDS) {
        const value = parseNonNegativeNumber(row[field]);
        if (value !== null) {
          totals[field] += value;
        }
      }
      return totals;
    },
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );
}

export function validateGroupedMealDraftRows(rows: GroupedMealDraftRow[]): GroupedMealDraftValidation {
  if (rows.length === 0) {
    return {
      valid: false,
      firstInvalidIndex: 0,
      rows: [],
      formError: "empty",
    };
  }

  let firstInvalidIndex: number | null = null;
  const rowErrors = rows.map((row, index): GroupedMealDraftFieldErrors => {
    const errors: GroupedMealDraftFieldErrors = {};

    if (row.name.trim() === "") {
      errors.name = "required";
    }

    for (const field of NUTRITION_FIELDS) {
      const rawValue = row[field];
      if (rawValue.trim() === "") {
        errors[field] = "required";
        continue;
      }

      const parsed = Number(rawValue);
      if (!Number.isFinite(parsed)) {
        errors[field] = "invalid";
      } else if (parsed < 0) {
        errors[field] = "negative";
      }
    }

    if (firstInvalidIndex === null && Object.keys(errors).length > 0) {
      firstInvalidIndex = index;
    }

    return errors;
  });

  return {
    valid: firstInvalidIndex === null,
    firstInvalidIndex,
    rows: rowErrors,
  };
}

export function buildGroupedMealUpdateItems(rows: GroupedMealDraftRow[]): MealItemDetail[] {
  return rows.map((row, index) => ({
    name: row.name.trim(),
    position: index,
    calories: Number(row.calories),
    protein: Number(row.protein),
    carbs: Number(row.carbs),
    fat: Number(row.fat),
  }));
}

export function isGroupedMealDraftDirty(
  initialRows: GroupedMealDraftRow[],
  rows: GroupedMealDraftRow[],
): boolean {
  if (initialRows.length !== rows.length) {
    return true;
  }

  return rows.some((row, index) => {
    const initialRow = initialRows[index];
    return (
      !initialRow ||
      row.name !== initialRow.name ||
      row.calories !== initialRow.calories ||
      row.protein !== initialRow.protein ||
      row.carbs !== initialRow.carbs ||
      row.fat !== initialRow.fat
    );
  });
}
