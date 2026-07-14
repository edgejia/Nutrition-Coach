import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

function sourcePath(relativePath: string) {
  return fileURLToPath(new URL(relativePath, import.meta.url));
}

async function readSource(relativePath: string) {
  return readFile(sourcePath(relativePath), "utf8");
}

function escapedPattern(source: string) {
  return new RegExp(source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}

const sources = {
  home: await readSource("../../client/src/components/HomeScreen.tsx"),
  primitives: await readSource("../../client/src/components/SportPrimitives.tsx"),
  css: await readSource("../../client/src/app.css"),
};

describe("Home canonical Sport kit source parity", () => {
  it("uses canonical calorie hero copy and type roles instead of the adapted client layer", () => {
    for (const required of [
      "今日熱量 · kcal",
      "完成率",
      "sp-display",
      "sp-num",
      "sp-label",
      "sp-zh",
      "fontSize: 72",
      "fontSize: 13",
      "fontSize: 9",
      "fontSize: 12",
      "kcal · 還能吃",
    ]) {
      assert.match(sources.home, escapedPattern(required));
    }

    for (const blocked of ["energy · today", ">pct<", "SP_SUMMARY", "SP_TARGETS", "SP_MEALS", "window."]) {
      assert.doesNotMatch(sources.home, escapedPattern(blocked));
    }
  });

  it("keeps the canonical ring size and top accent tick while preserving production data binding", () => {
    assert.match(sources.home, /function useHomeNutritionTimeline/);
    assert.match(sources.home, /getHomeCalorieDisplay\(dailySummary, dailyTargets\)/);
    assert.match(sources.home, /getHomeMacroDisplays\(dailySummary, dailyTargets\)/);
    assert.match(sources.home, /frameAt\(start, end, easeShared\(progress\)\)/);
    assert.match(sources.home, /<SportRing[\s\S]*value=\{frame\.ringValue\}[\s\S]*accentTick[\s\S]*drivenExternally[\s\S]*size=\{120\}[\s\S]*stroke=\{9\}/);
    assert.match(sources.home, /\{frame\.kcal\.toLocaleString\("en-US"\)\}/);
    assert.match(sources.home, /\{frame\.percent\}/);
    assert.doesNotMatch(sources.home, /animatedRingValue/);
    assert.match(sources.primitives, /accentTick\?: boolean/);
    assert.match(sources.primitives, /drivenExternally\?: boolean/);
    assert.match(sources.primitives, /center - radius/);
    assert.match(sources.primitives, /fill="var\(--sp-ink-3\)"/);
  });

  it("keeps production-only Home behavior as explicit adapters", () => {
    assert.match(sources.home, /dailySummary/);
    assert.match(sources.home, /dailyTargets/);
    assert.match(sources.home, /setPendingHomeChatDraft/);
    assert.match(sources.home, /setActiveScreen\("chat"\)/);
    assert.match(sources.home, /openSecondaryScreen\("settings", "home"\)/);
    assert.doesNotMatch(sources.home, /openSecondaryScreen\("mealEdit"/);
  });

  it("still carries canonical Sport kit primitive styles in app CSS", () => {
    for (const required of [
      ".sp-display",
      ".sp-num",
      ".sp-label",
      ".sp-zh",
      ".sp-card-glow",
      "--sp-font-display",
      "--sp-font-mono",
      "--sp-font-zh",
    ]) {
      assert.match(sources.css, escapedPattern(required));
    }
  });

  it("renders Today meal rows through fixed meal-level thumbnail slots", () => {
    for (const required of [
      'import { PersistedAssetImage } from "./PersistedAssetImage.js";',
      "home-sport-meal-media",
      "home-sport-meal-image",
      "home-sport-meal-fallback",
      "meal.imageUrl",
      "無照片",
    ]) {
      assert.match(sources.home, escapedPattern(required));
    }

    assert.match(
      sources.home,
      /<PersistedAssetImage[\s\S]*src=\{meal\.imageUrl\}[\s\S]*imgClassName="home-sport-meal-image"[\s\S]*fallbackClassName="home-sport-meal-fallback"/,
    );
  });

  it("keeps Today meal thumbnail and fallback slots at fixed 40px dimensions", () => {
    const mediaRule = /\.home-sport-meal-media\s*\{[\s\S]*?width:\s*40px;[\s\S]*?height:\s*40px;[\s\S]*?flex:\s*0 0 40px;[\s\S]*?\}/;
    assert.match(sources.css, mediaRule);

    for (const required of [".home-sport-meal-image", ".home-sport-meal-fallback"]) {
      assert.match(sources.css, escapedPattern(required));
    }
  });
});
