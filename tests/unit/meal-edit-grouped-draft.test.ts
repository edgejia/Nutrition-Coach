import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildGroupedMealUpdateItems,
  computeGroupedMealDraftTotals,
  createGroupedMealDraftRows,
  isGroupedMealDraftDirty,
  validateGroupedMealDraftRows,
  type GroupedMealDraftRow,
} from "../../client/src/meal-edit-grouped-draft.js";
import type { MealItemDetail } from "../../client/src/types.js";

const groupedItems: MealItemDetail[] = [
  { name: "青菜", position: 2, calories: 80, protein: 4, carbs: 10, fat: 2 },
  { name: "雞腿", position: 0, calories: 340, protein: 32, carbs: 2, fat: 18 },
  { name: "白飯", position: 1, calories: 300, protein: 6, carbs: 76, fat: 4 },
];

function row(overrides: Partial<GroupedMealDraftRow> = {}): GroupedMealDraftRow {
  return {
    name: "雞腿",
    calories: "340",
    protein: "32",
    carbs: "2",
    fat: "18",
    ...overrides,
  };
}

describe("grouped meal draft helper", () => {
  it("creates string-valued draft rows sorted by persisted position", () => {
    assert.deepEqual(createGroupedMealDraftRows(groupedItems), [
      { name: "雞腿", calories: "340", protein: "32", carbs: "2", fat: "18" },
      { name: "白飯", calories: "300", protein: "6", carbs: "76", fat: "4" },
      { name: "青菜", calories: "80", protein: "4", carbs: "10", fat: "2" },
    ]);
  });

  it("computes live totals from valid numeric draft values", () => {
    assert.deepEqual(computeGroupedMealDraftTotals(createGroupedMealDraftRows(groupedItems)), {
      calories: 720,
      protein: 42,
      carbs: 88,
      fat: 24,
    });
  });

  it("ignores invalid draft values when computing live totals", () => {
    assert.deepEqual(
      computeGroupedMealDraftTotals([
        row({ calories: "100.5", protein: "10", carbs: "11", fat: "12" }),
        row({ calories: "", protein: "x", carbs: "-3", fat: "4" }),
      ]),
      {
        calories: 100.5,
        protein: 10,
        carbs: 11,
        fat: 16,
      },
    );
  });

  it("rejects blank names, blank nutrition fields, non-numeric values, and negatives", () => {
    const validation = validateGroupedMealDraftRows([
      row({ name: "  " }),
      row({ calories: "" }),
      row({ protein: "abc" }),
      row({ carbs: "-1" }),
    ]);

    assert.equal(validation.valid, false);
    assert.equal(validation.firstInvalidIndex, 0);
    assert.deepEqual(validation.rows[0], { name: "required" });
    assert.deepEqual(validation.rows[1], { calories: "required" });
    assert.deepEqual(validation.rows[2], { protein: "invalid" });
    assert.deepEqual(validation.rows[3], { carbs: "negative" });
  });

  it("allows duplicate names and returns the first invalid nutrition row", () => {
    const validation = validateGroupedMealDraftRows([
      row({ name: "雞腿", calories: "340" }),
      row({ name: "雞腿", calories: "350" }),
      row({ name: "白飯", fat: "" }),
    ]);

    assert.equal(validation.valid, false);
    assert.equal(validation.firstInvalidIndex, 2);
    assert.deepEqual(validation.rows[0], {});
    assert.deepEqual(validation.rows[1], {});
    assert.deepEqual(validation.rows[2], { fat: "required" });
  });

  it("requires at least one item", () => {
    const validation = validateGroupedMealDraftRows([]);

    assert.equal(validation.valid, false);
    assert.equal(validation.firstInvalidIndex, 0);
    assert.deepEqual(validation.rows, []);
    assert.equal(validation.formError, "empty");
  });

  it("builds media-free grouped update items with contiguous zero-based positions", () => {
    const rows = [
      row({ name: " 白飯 ", calories: "300", protein: "6", carbs: "76", fat: "4" }),
      row({ name: "青菜", calories: "80", protein: "4", carbs: "10", fat: "2" }),
    ];

    assert.deepEqual(buildGroupedMealUpdateItems(rows), [
      { name: "白飯", position: 0, calories: 300, protein: 6, carbs: 76, fat: 4 },
      { name: "青菜", position: 1, calories: 80, protein: 4, carbs: 10, fat: 2 },
    ]);
    for (const item of buildGroupedMealUpdateItems(rows)) {
      assert.deepEqual(Object.keys(item), ["name", "position", "calories", "protein", "carbs", "fat"]);
    }
  });

  it("detects changed values, additions, deletions, and order changes", () => {
    const initial = createGroupedMealDraftRows(groupedItems);

    assert.equal(isGroupedMealDraftDirty(initial, initial.map((item) => ({ ...item }))), false);
    assert.equal(isGroupedMealDraftDirty(initial, [{ ...initial[0]!, calories: "341" }, ...initial.slice(1)]), true);
    assert.equal(isGroupedMealDraftDirty(initial, [...initial, row({ name: "豆腐" })]), true);
    assert.equal(isGroupedMealDraftDirty(initial, initial.slice(0, 2)), true);
    assert.equal(isGroupedMealDraftDirty(initial, [initial[1]!, initial[0]!, initial[2]!]), true);
  });
});
