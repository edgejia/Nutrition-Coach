import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  classifyProteinSource,
  normalizeTrustedProteinEstimate,
} from "../../server/orchestrator/protein-trust.js";

describe("protein trust helper", () => {
  it("counts explicit anchor sources toward trusted protein", () => {
    const result = normalizeTrustedProteinEstimate({
      mealName: "雞腿便當",
      proposedProtein: 32,
      proteinSources: [
        { name: "雞腿", protein: 24, isPrimary: true, certainty: "clear" },
        { name: "水煮蛋", protein: 8, isPrimary: true, certainty: "clear" },
      ],
    });

    assert.equal(result.trustedProtein, 32);
    assert.deepEqual(
      result.countedSources.map((source) => source.name),
      ["雞腿", "水煮蛋"],
    );
    assert.deepEqual(result.excludedSources, []);
  });

  it("excludes trace-only sources from trusted protein", () => {
    const result = normalizeTrustedProteinEstimate({
      mealName: "便當",
      proposedProtein: 11,
      proteinSources: [
        { name: "白飯", protein: 4, isPrimary: false, certainty: "clear" },
        { name: "青菜", protein: 3, isPrimary: false, certainty: "clear" },
        { name: "醬汁", protein: 4, isPrimary: false, certainty: "clear" },
      ],
    });

    assert.equal(result.trustedProtein, 0);
    assert.equal(result.countedSources.length, 0);
    assert.deepEqual(
      result.excludedSources.map((source) => source.reason),
      ["trace", "trace", "trace"],
    );
  });

  it("counts conditional plant sources only when they are primary", () => {
    const sideDish = normalizeTrustedProteinEstimate({
      mealName: "毛豆飯糰",
      proposedProtein: 9,
      proteinSources: [
        { name: "毛豆", protein: 7, isPrimary: false, certainty: "clear" },
        { name: "白飯", protein: 2, isPrimary: false, certainty: "clear" },
      ],
    });
    assert.equal(sideDish.trustedProtein, 0);
    assert.equal(sideDish.countedSources.length, 0);
    assert.deepEqual(
      sideDish.excludedSources.map((source) => source.reason),
      ["not_primary", "trace"],
    );

    const mainDish = normalizeTrustedProteinEstimate({
      mealName: "毛豆碗",
      proposedProtein: 14,
      proteinSources: [
        { name: "毛豆", protein: 12, isPrimary: true, certainty: "clear" },
        { name: "白飯", protein: 2, isPrimary: false, certainty: "clear" },
      ],
    });
    assert.equal(mainDish.trustedProtein, 12);
    assert.equal(mainDish.countedSources[0]?.name, "毛豆");
    assert.equal(mainDish.excludedSources[0]?.name, "白飯");
  });

  it("marks uncertain primary sources as conservative without adding extra grams", () => {
    const result = normalizeTrustedProteinEstimate({
      mealName: "模糊豆腐餐",
      proposedProtein: 18,
      proteinSources: [
        { name: "豆腐", protein: 16.4, isPrimary: true, certainty: "uncertain" },
        { name: "花椰菜", protein: 1.8, isPrimary: false, certainty: "uncertain" },
      ],
    });

    assert.equal(result.trustedProtein, 16.4);
    assert.equal(result.usedConservativeAssumption, true);
    assert.deepEqual(
      result.countedSources.map((source) => source.name),
      ["豆腐"],
    );
    assert.deepEqual(
      result.excludedSources.map((source) => source.name),
      ["花椰菜"],
    );
  });

  it("classifies representative source names across anchor, conditional, trace, and unknown buckets", () => {
    assert.equal(classifyProteinSource("希臘優格"), "anchor");
    assert.equal(classifyProteinSource("燒肉便當"), "anchor");
    assert.equal(classifyProteinSource("燕麥"), "conditional");
    assert.equal(classifyProteinSource("白飯"), "trace");
    assert.equal(classifyProteinSource("海苔"), "unknown");
  });
});
