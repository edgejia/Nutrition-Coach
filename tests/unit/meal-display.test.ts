import { describe, it } from "node:test";
import assert from "node:assert/strict";

type MealDisplayItem = { foodName: string };
type MealDisplayProjection = { foodName: string; itemCount: number };

async function loadProjectMealDisplay() {
  const modulePath = "../../server/services/meal-display.js";
  const mealDisplay = await import(modulePath) as {
    projectMealDisplay: (items: MealDisplayItem[]) => MealDisplayProjection;
  };
  return mealDisplay.projectMealDisplay;
}

describe("projectMealDisplay", () => {
  it("projects one item with the full food name and itemCount", async () => {
    const projectMealDisplay = await loadProjectMealDisplay();

    assert.deepEqual(projectMealDisplay([{ foodName: "雞腿" }]), {
      foodName: "雞腿",
      itemCount: 1,
    });
  });

  it("projects two item names without collapse copy", async () => {
    const projectMealDisplay = await loadProjectMealDisplay();

    assert.deepEqual(projectMealDisplay([{ foodName: "雞腿" }, { foodName: "白飯" }]), {
      foodName: "雞腿、白飯",
      itemCount: 2,
    });
  });

  it("projects three item names without 等 truncation", async () => {
    const projectMealDisplay = await loadProjectMealDisplay();
    const projection = projectMealDisplay([
      { foodName: "雞腿" },
      { foodName: "白飯" },
      { foodName: "滷蛋" },
    ]);

    assert.deepEqual(projection, {
      foodName: "雞腿、白飯、滷蛋",
      itemCount: 3,
    });
    assert.doesNotMatch(projection.foodName, /等/);
  });

  it("projects five item names without 等 truncation", async () => {
    const projectMealDisplay = await loadProjectMealDisplay();
    const projection = projectMealDisplay([
      { foodName: "雞腿" },
      { foodName: "白飯" },
      { foodName: "滷蛋" },
      { foodName: "青菜" },
      { foodName: "豆干" },
    ]);

    assert.deepEqual(projection, {
      foodName: "雞腿、白飯、滷蛋、青菜、豆干",
      itemCount: 5,
    });
    assert.doesNotMatch(projection.foodName, /等/);
  });
});
