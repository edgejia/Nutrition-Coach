import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildSystemPrompt } from "../../server/orchestrator/system-prompt.js";

describe("buildSystemPrompt", () => {
  it("includes intake profile when provided", () => {
    const prompt = buildSystemPrompt(
      "fat_loss",
      {
        calories: 1800,
        protein: 175,
        carbs: 175,
        fat: 80,
      },
      {
        sex: "male",
        age: 30,
        heightCm: 175,
        weightKg: 80,
        activityLevel: "moderate",
        trainingFrequency: "3_4",
        allergies: "花生",
        goalClarification: "不想影響重訓表現",
        bodyFatPercent: 18,
        tdee: 1800,
        advancedNotes: "晚餐常外食",
      },
    );

    assert.match(prompt, /使用者背景資料/);
    assert.match(prompt, /性別：男/);
    assert.match(prompt, /年齡：30/);
    assert.match(prompt, /身高：175 cm/);
    assert.match(prompt, /體重：80 kg/);
    assert.match(prompt, /活動量：moderate/);
    assert.match(prompt, /訓練頻率：3_4/);
    assert.match(prompt, /過敏\/飲食限制：花生/);
    assert.match(prompt, /目標補充：不想影響重訓表現/);
    assert.match(prompt, /體脂率：18%/);
    assert.match(prompt, /TDEE：1800 kcal/);
    assert.match(prompt, /備註：晚餐常外食/);
  });

  it("omits intake background for legacy devices when intake is undefined", () => {
    const prompt = buildSystemPrompt(
      "fat_loss",
      {
        calories: 1500,
        protein: 120,
        carbs: 150,
        fat: 50,
      }
    );

    assert.match(prompt, /使用者的目標是「減脂」/);
    assert.doesNotMatch(prompt, /使用者背景資料/);
    assert.doesNotMatch(prompt, /未提供/);
  });

  it("omits intake background for legacy devices when intake fields are all null", () => {
    const prompt = buildSystemPrompt(
      "fat_loss",
      {
        calories: 1500,
        protein: 120,
        carbs: 150,
        fat: 50,
      },
      {
        sex: null,
        age: null,
        heightCm: null,
        weightKg: null,
        activityLevel: null,
        trainingFrequency: null,
        allergies: null,
        goalClarification: null,
        bodyFatPercent: null,
        tdee: null,
        advancedNotes: null,
      },
    );

    assert.match(prompt, /使用者的目標是「減脂」/);
    assert.doesNotMatch(prompt, /使用者背景資料/);
    assert.doesNotMatch(prompt, /未提供/);
  });

  it("renders partial intake data without placeholder noise", () => {
    const prompt = buildSystemPrompt(
      "muscle_gain",
      {
        calories: 2500,
        protein: 180,
        carbs: 300,
        fat: 70,
      },
      {
        sex: "female",
        age: 25,
        heightCm: 165,
        weightKg: 58,
        activityLevel: "active",
        trainingFrequency: "5_plus",
        allergies: "蛋",
        goalClarification: "想先增肌",
        bodyFatPercent: null,
        tdee: null,
        advancedNotes: null,
      },
    );

    assert.match(prompt, /使用者背景資料/);
    assert.match(prompt, /性別：女/);
    assert.match(prompt, /年齡：25/);
    assert.match(prompt, /身高：165 cm/);
    assert.match(prompt, /體重：58 kg/);
    assert.match(prompt, /活動量：active/);
    assert.match(prompt, /訓練頻率：5_plus/);
    assert.match(prompt, /過敏\/飲食限制：蛋/);
    assert.match(prompt, /目標補充：想先增肌/);
    assert.doesNotMatch(prompt, /未提供/);
  });
});
